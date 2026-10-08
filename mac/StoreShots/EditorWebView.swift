import AppKit
import Observation
import SwiftUI
import WebKit

/// Owns the editor's web view so the toolbar and menus can drive it.
@MainActor
@Observable
final class EditorBrowser: NSObject {
  let webView: WKWebView
  /// The app open in the editor (`/projects/<name>`), nil on the project list.
  private(set) var currentProject: String?
  private(set) var isLoading = false

  private var observations: [NSKeyValueObservation] = []
  private var loadedBase: URL?

  override init() {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    configuration.preferences.isElementFullscreenEnabled = true
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init()

    webView.navigationDelegate = self
    webView.uiDelegate = self
    // Swipes would leave the editor mid-drag; the editor has its own undo.
    webView.allowsBackForwardNavigationGestures = false
    webView.allowsMagnification = false
    webView.isInspectable = true
    webView.setValue(false, forKey: "drawsBackground")

    observations = [
      // WebKit reports these on the main thread.
      webView.observe(\.url, options: [.new]) { [weak self] webView, _ in
        MainActor.assumeIsolated { self?.urlChanged(webView.url) }
      },
      webView.observe(\.isLoading, options: [.new]) { [weak self] webView, _ in
        MainActor.assumeIsolated { self?.isLoading = webView.isLoading }
      },
    ]
  }

  /// Loads the editor from a (new) server, reopening the last project.
  func attach(to base: URL) {
    guard loadedBase != base else { return }
    loadedBase = base
    if let last = AppSettings.lastProject {
      webView.load(URLRequest(url: Self.projectURL(base: base, name: last)))
    } else {
      webView.load(URLRequest(url: base))
    }
  }

  func detach() {
    loadedBase = nil
  }

  func open(project name: String?) {
    guard let base = loadedBase else { return }
    let url = name.map { Self.projectURL(base: base, name: $0) } ?? base
    webView.load(URLRequest(url: url))
  }

  func reload() {
    webView.reload()
  }

  func openInBrowser() {
    guard let url = webView.url ?? loadedBase else { return }
    NSWorkspace.shared.open(url)
  }

  private func urlChanged(_ url: URL?) {
    guard let url, Self.isEditorURL(url, base: loadedBase) else { return }
    let parts = url.pathComponents
    if parts.count >= 3, parts[1] == "projects" {
      currentProject = parts[2]
      AppSettings.lastProject = parts[2]
    } else if url.path.isEmpty || url.path == "/" {
      currentProject = nil
      AppSettings.lastProject = nil
    }
  }

  private static func projectURL(base: URL, name: String) -> URL {
    base.appending(path: "projects").appending(path: name)
  }

  /// The editor itself, as opposed to links out of it (App Store pages, docs).
  private static func isEditorURL(_ url: URL, base: URL?) -> Bool {
    guard let base else { return false }
    return url.scheme == base.scheme && url.host() == base.host() && url.port == base.port
  }

  private static func isInPage(_ url: URL) -> Bool {
    ["about", "blob", "data", "javascript"].contains(url.scheme ?? "")
  }
}

// MARK: Navigation

extension EditorBrowser: WKNavigationDelegate {
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction
  ) async -> WKNavigationActionPolicy {
    guard let url = navigationAction.request.url else { return .allow }
    if Self.isInPage(url) || Self.isEditorURL(url, base: loadedBase) { return .allow }
    // Anything else leaves the editor: hand it to the default browser.
    if navigationAction.targetFrame?.isMainFrame ?? true {
      NSWorkspace.shared.open(url)
      return .cancel
    }
    return .allow
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    showLoadError(error)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    showLoadError(error)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    webView.reload()
  }

  private func showLoadError(_ error: Error) {
    let nsError = error as NSError
    // Cancelled loads (a newer navigation replaced this one) are not failures.
    guard nsError.code != NSURLErrorCancelled, nsError.code != 102 else { return }
    let message = nsError.localizedDescription.replacingOccurrences(of: "<", with: "&lt;")
    webView.loadHTMLString(
      """
      <body style="font: 13px -apple-system; color: #888; display: grid; place-items: center; height: 90vh">
      <div>The editor did not load: \(message)<br>Reload with Command-R, or restart it from the Server menu.</div>
      </body>
      """, baseURL: nil)
  }
}

// MARK: Browser UI the editor uses (dialogs, file inputs, new windows)

extension EditorBrowser: WKUIDelegate {
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    // target=_blank and window.open: editor pages stay in this window, the rest
    // open in the default browser.
    if let url = navigationAction.request.url {
      if Self.isEditorURL(url, base: loadedBase) {
        webView.load(URLRequest(url: url))
      } else {
        NSWorkspace.shared.open(url)
      }
    }
    return nil
  }

  func webView(
    _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo
  ) async {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "OK")
    await present(alert)
  }

  func webView(
    _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo
  ) async -> Bool {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    return await present(alert) == .alertFirstButtonReturn
  }

  func webView(
    _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
    defaultText: String?, initiatedByFrame frame: WKFrameInfo
  ) async -> String? {
    let alert = NSAlert()
    alert.messageText = prompt
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    let field = NSTextField(string: defaultText ?? "")
    field.frame = NSRect(x: 0, y: 0, width: 280, height: 24)
    alert.accessoryView = field
    alert.window.initialFirstResponder = field
    return await present(alert) == .alertFirstButtonReturn ? field.stringValue : nil
  }

  func webView(
    _ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo
  ) async -> [URL]? {
    let panel = NSOpenPanel()
    panel.canChooseFiles = true
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    guard let window = webView.window else {
      return panel.runModal() == .OK ? panel.urls : nil
    }
    let response = await panel.beginSheetModal(for: window)
    return response == .OK ? panel.urls : nil
  }

  @discardableResult
  private func present(_ alert: NSAlert) async -> NSApplication.ModalResponse {
    guard let window = webView.window else { return alert.runModal() }
    return await alert.beginSheetModal(for: window)
  }
}

/// Puts the browser's web view in the SwiftUI hierarchy.
struct EditorWebView: NSViewRepresentable {
  let browser: EditorBrowser

  func makeNSView(context: Context) -> WKWebView { browser.webView }
  func updateNSView(_ nsView: WKWebView, context: Context) {}
}
