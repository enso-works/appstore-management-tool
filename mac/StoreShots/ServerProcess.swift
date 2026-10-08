import Darwin
import Foundation

/// A child process started in its own process group, so stopping it also stops
/// whatever it spawned (`next dev` runs its server in a worker process; signalling
/// only the parent would orphan it and keep the port bound).
final class ServerProcess: @unchecked Sendable {
  let pid: pid_t
  private let output: FileHandle
  private let exitSource: DispatchSourceProcess

  /// - Parameters:
  ///   - onOutput: called on the main queue with each chunk of stdout and stderr.
  ///   - onExit: called once on the main queue with the exit status.
  init(
    executable: String,
    arguments: [String],
    directory: String,
    environment: [String: String],
    onOutput: @escaping @MainActor (String) -> Void,
    onExit: @escaping @MainActor (Int32) -> Void
  ) throws {
    let pipe = Pipe()
    let writeFD = pipe.fileHandleForWriting.fileDescriptor

    var actions: posix_spawn_file_actions_t?
    posix_spawn_file_actions_init(&actions)
    defer { posix_spawn_file_actions_destroy(&actions) }
    posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0)
    posix_spawn_file_actions_adddup2(&actions, writeFD, 1)
    posix_spawn_file_actions_adddup2(&actions, writeFD, 2)
    posix_spawn_file_actions_addchdir_np(&actions, directory)

    var attributes: posix_spawnattr_t?
    posix_spawnattr_init(&attributes)
    defer { posix_spawnattr_destroy(&attributes) }
    // POSIX_SPAWN_CLOEXEC_DEFAULT: the child gets only the descriptors above,
    // not every file the app has open.
    posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT))
    posix_spawnattr_setpgroup(&attributes, 0)

    let argv = ([executable] + arguments).map { strdup($0) } + [nil]
    let envp = environment.map { strdup("\($0.key)=\($0.value)") } + [nil]
    defer {
      argv.forEach { free($0) }
      envp.forEach { free($0) }
    }

    var pid: pid_t = 0
    let status = posix_spawn(&pid, executable, &actions, &attributes, argv, envp)
    try? pipe.fileHandleForWriting.close()
    guard status == 0 else {
      throw NSError(
        domain: NSPOSIXErrorDomain, code: Int(status),
        userInfo: [NSLocalizedDescriptionKey: "Could not start \(executable): \(String(cString: strerror(status)))"])
    }
    self.pid = pid

    output = pipe.fileHandleForReading
    output.readabilityHandler = { handle in
      let data = handle.availableData
      guard !data.isEmpty else {
        handle.readabilityHandler = nil
        return
      }
      let text = String(decoding: data, as: UTF8.self)
      DispatchQueue.main.async { MainActor.assumeIsolated { onOutput(text) } }
    }

    exitSource = DispatchSource.makeProcessSource(identifier: pid, eventMask: .exit, queue: .main)
    exitSource.setEventHandler { [exitSource] in
      var raw: Int32 = 0
      waitpid(pid, &raw, 0)
      exitSource.cancel()
      let code = (raw & 0x7f) == 0 ? (raw >> 8) & 0xff : 128 + (raw & 0x7f)
      MainActor.assumeIsolated { onExit(code) }
    }
    exitSource.resume()
  }

  /// SIGINT to the whole group (what Ctrl+C in a terminal does), then SIGKILL if
  /// it is still there after `grace` seconds. Blocks at most `grace` seconds.
  func stop(grace: TimeInterval = 5) {
    guard kill(-pid, 0) == 0 else { return }
    kill(-pid, SIGINT)
    let deadline = Date().addingTimeInterval(grace)
    while Date() < deadline {
      if kill(-pid, 0) != 0 { return }
      usleep(100_000)
    }
    kill(-pid, SIGKILL)
  }
}
