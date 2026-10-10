import AppKit
import WebKit

/// Small pictures of screens for the screen list, rendered from the same
/// preview HTML the canvas shows, one at a time in an offscreen web view, and
/// kept by what they show so an unchanged screen is never rendered twice.
@MainActor
@Observable
final class Thumbnails: NSObject, WKNavigationDelegate {
  static let shared = Thumbnails()

  private(set) var images: [String: NSImage] = [:]
  var debugState: String { "queued=\(queue.count) running=\(running) requested=\(requested) last=\(lastError)" }
  @ObservationIgnored private var lastError = "-"
  @ObservationIgnored private var requested = 0
  private var queue: [Job] = []
  private var running = false
  private var finished: CheckedContinuation<Void, Never>?
  @ObservationIgnored private lazy var window: NSWindow = {
    let w = NSWindow(contentRect: CGRect(x: -20000, y: -20000, width: 400, height: 800), styleMask: .borderless,
      backing: .buffered, defer: false)
    w.isReleasedWhenClosed = false
    w.orderFrontRegardless()
    w.alphaValue = 0
    return w
  }()
  @ObservationIgnored private lazy var webView: WKWebView = {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    let v = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 800), configuration: config)
    v.navigationDelegate = self
    window.contentView = v
    return v
  }()

  private struct Job {
    let key: String
    let api: APIClient
    let project: String
    let body: JSONValue
    let size: CGSize
  }

  /// The thumbnail for `key`, rendering it if it is not there yet.
  func request(key: String, api: APIClient, project: String, body: JSONValue, size: CGSize) {
    requested += 1
    guard images[key] == nil, !queue.contains(where: { $0.key == key }) else { return }
    queue.append(Job(key: key, api: api, project: project, body: body, size: size))
    // One render loop at a time: they share the web view.
    if !running {
      running = true
      Task { await drain() }
    }
  }

  private func drain() async {
    while !queue.isEmpty {
      let job = queue.removeLast()  // newest first: the screen just edited
      guard images[job.key] == nil else { continue }
      if let image = await render(job) { images[job.key] = image }
    }
    running = false
  }

  private func render(_ job: Job) async -> NSImage? {
    let html: String
    do {
      let (data, _) = try await job.api.post(job.api.project(job.project, "preview"), body: job.body)
      html = String(decoding: data, as: UTF8.self)
    } catch {
      lastError = "post: \(error.localizedDescription)"
      return nil
    }
    webView.frame = CGRect(origin: .zero, size: job.size)
    window.setContentSize(job.size)
    await withCheckedContinuation { c in
      finished = c
      webView.loadHTMLString(html, baseURL: job.api.base)
      // A load that never reports back must not stall every thumbnail after it.
      Task { @MainActor [weak self] in
        try? await Task.sleep(for: .seconds(15))
        self?.resumeLoad()
      }
    }
    // Fonts and the capture image settle after the load event.
    try? await Task.sleep(for: .milliseconds(350))
    let config = WKSnapshotConfiguration()
    config.rect = CGRect(origin: .zero, size: job.size)
    config.snapshotWidth = NSNumber(value: 160)
    do {
      return try await webView.takeSnapshot(configuration: config)
    } catch {
      lastError = "snapshot: \(error.localizedDescription)"
      return nil
    }
  }

  private func resumeLoad() {
    finished?.resume()
    finished = nil
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { resumeLoad() }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { resumeLoad() }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    resumeLoad()
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { resumeLoad() }
}
