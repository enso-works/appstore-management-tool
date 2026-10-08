import AppKit
import Darwin
import Foundation
import Observation

/// One app the editor knows about, as `GET /api/projects` lists it.
struct ProjectSummary: Decodable, Identifiable, Hashable, Sendable {
  let name: String
  let root: String
  let projectName: String?
  let readiness: String?
  let error: String?

  var id: String { name }
  var title: String { projectName ?? name }
}

/// Finds a running editor or starts one, and keeps the project list.
///
/// An editor that was already running (`store-shots open`, `npm run dev`) is only
/// attached to and never stopped; one this app started is stopped on quit.
@MainActor
@Observable
final class EditorServer {
  enum State: Equatable {
    case idle
    case starting
    case ready(port: Int, owned: Bool)
    case failed(String)
  }

  private(set) var state: State = .idle
  private(set) var projects: [ProjectSummary] = []
  private(set) var log = ""

  private var process: ServerProcess?
  private var startTask: Task<Void, Never>?

  /// The same log on disk, ~/Library/Logs/Store Shots/editor.log, started fresh
  /// each launch.
  static let logURL = FileManager.default.homeDirectoryForCurrentUser
    .appending(path: "Library/Logs/Store Shots/editor.log")
  private let logFile: FileHandle? = {
    let fm = FileManager.default
    try? fm.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    fm.createFile(atPath: logURL.path, contents: nil)
    return try? FileHandle(forWritingTo: logURL)
  }()

  var baseURL: URL? {
    if case .ready(let port, _) = state { return URL(string: "http://localhost:\(port)") }
    return nil
  }

  var statusText: String {
    switch state {
    case .idle: "Stopped"
    case .starting: "Starting"
    case .ready(let port, let owned): owned ? "Running on :\(port)" : "Attached to :\(port)"
    case .failed: "Failed"
    }
  }

  // MARK: Lifecycle

  func start() {
    guard startTask == nil, process == nil else { return }
    if case .ready = state { return }
    state = .starting
    startTask = Task {
      await run()
      startTask = nil
    }
  }

  func restart() {
    stop()
    start()
  }

  /// Stops the editor if this app started it. Blocks for at most a few seconds,
  /// so it is safe to call from `applicationWillTerminate`.
  func stop() {
    startTask?.cancel()
    startTask = nil
    if let process {
      append("\n[store-shots] stopping the editor (pid \(process.pid))\n")
      process.stop()
    }
    process = nil
    state = .idle
  }

  private func run() async {
    if AppSettings.attachToRunning, let port = await Self.findRunning() {
      append("[store-shots] attached to the editor already running on port \(port)\n")
      state = .ready(port: port, owned: false)
      await refreshProjects()
      return
    }

    let root = AppSettings.toolRoot
    let next = (root as NSString).appendingPathComponent("node_modules/.bin/next")
    guard FileManager.default.isExecutableFile(atPath: next) else {
      fail("Cannot find next in \(root). Run `npm ci` there, or choose the store-shots folder in Settings.")
      return
    }
    guard let port = Self.freePort(from: AppSettings.preferredPort) else {
      fail("No free port between \(AppSettings.preferredPort) and \(AppSettings.preferredPort + 49).")
      return
    }

    // A git checkout is being worked on, so it runs dev even with a stale build
    // around; an installed copy serves its build. Same rule as `store-shots open`.
    let fm = FileManager.default
    let isCheckout = fm.fileExists(atPath: (root as NSString).appendingPathComponent(".git"))
    let built = fm.fileExists(atPath: (root as NSString).appendingPathComponent(".next/BUILD_ID"))
    let mode = !isCheckout && built ? "start" : "dev"

    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = await ShellEnvironment.path()
    environment["PORT"] = String(port)
    environment["NEXT_TELEMETRY_DISABLED"] = "1"

    append("[store-shots] next \(mode) --port \(port) in \(root)\n")
    do {
      process = try ServerProcess(
        executable: next,
        arguments: [mode, "--port", String(port)],
        directory: root,
        environment: environment,
        onOutput: { [weak self] text in self?.append(text) },
        onExit: { [weak self] code in self?.processExited(code) }
      )
    } catch {
      fail(error.localizedDescription)
      return
    }

    // The first dev compile can take a while on a cold cache.
    let deadline = Date().addingTimeInterval(120)
    while Date() < deadline, !Task.isCancelled, process != nil {
      if await Self.isEditor(port: port) {
        state = .ready(port: port, owned: true)
        await refreshProjects()
        return
      }
      try? await Task.sleep(for: .milliseconds(400))
    }
    if process != nil, !Task.isCancelled {
      fail("The editor did not come up within two minutes. See the server log.")
    }
  }

  private func processExited(_ code: Int32) {
    append("\n[store-shots] the editor exited with status \(code)\n")
    process = nil
    if case .idle = state { return }
    fail("The editor stopped (exit status \(code)). See the server log.")
  }

  private func fail(_ message: String) {
    append("[store-shots] \(message)\n")
    state = .failed(message)
  }

  private func append(_ text: String) {
    log += text
    logFile?.write(Data(text.utf8))
    // Keep the last ~400 KB; a dev server logs every request.
    if log.utf8.count > 500_000 {
      log = String(log.suffix(400_000))
    }
  }

  // MARK: Projects

  func refreshProjects() async {
    guard let base = baseURL else { return }
    do {
      let (data, response) = try await URLSession.shared.data(from: base.appending(path: "api/projects"))
      guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
      projects = try JSONDecoder().decode([ProjectSummary].self, from: data)
    } catch {
      append("[store-shots] could not list projects: \(error.localizedDescription)\n")
    }
  }

  // MARK: Probing

  /// An editor already answering on 3000-3009. Asking over HTTP is the only
  /// reliable signal that it is this tool and not something else on the port.
  private static func findRunning() async -> Int? {
    for port in 3000..<3010 where await isEditor(port: port) {
      return port
    }
    return nil
  }

  private static func isEditor(port: Int) async -> Bool {
    guard let url = URL(string: "http://127.0.0.1:\(port)/api/projects") else { return false }
    var request = URLRequest(url: url)
    request.timeoutInterval = 1.5
    guard let (data, response) = try? await URLSession.shared.data(for: request),
      (response as? HTTPURLResponse)?.statusCode == 200
    else { return false }
    return (try? JSONDecoder().decode([ProjectSummary].self, from: data)) != nil
  }

  /// First port from `start` that binds on the IPv6 wildcard, which is where
  /// next listens (an IPv4 loopback bind can succeed next to it on macOS).
  private static func freePort(from start: Int) -> Int? {
    (start..<(start + 50)).first(where: isFree)
  }

  private static func isFree(_ port: Int) -> Bool {
    let fd = socket(AF_INET6, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { close(fd) }
    var address = sockaddr_in6()
    address.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
    address.sin6_family = sa_family_t(AF_INET6)
    address.sin6_port = in_port_t(UInt16(port).bigEndian)
    address.sin6_addr = in6addr_any
    return withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in6>.size)) == 0
      }
    }
  }
}

/// The PATH a login shell would have. Apps launched from Finder get a minimal
/// PATH without Homebrew, nvm or ~/.local/bin, so `node` would not be found.
enum ShellEnvironment {
  private static let marker = "__STORE_SHOTS_PATH__"

  static func path() async -> String {
    let fallback = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
    return await withCheckedContinuation { continuation in
      DispatchQueue.global().async {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        // -i as well as -l: many setups add node to PATH in .zshrc only.
        process.arguments = ["-ilc", "printf '\(marker)%s' \"$PATH\""]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do {
          try process.run()
        } catch {
          continuation.resume(returning: fallback)
          return
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let output = String(decoding: data, as: UTF8.self)
        guard let range = output.range(of: marker, options: .backwards) else {
          continuation.resume(returning: fallback)
          return
        }
        let path = output[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
        continuation.resume(returning: path.isEmpty ? fallback : path)
      }
    }
  }
}
