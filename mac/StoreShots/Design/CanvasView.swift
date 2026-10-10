import SwiftUI
import WebKit

/// The web canvas (/projects/<app>/canvas): it shows the drafts the document
/// holds and reports clicks, drags and preview checks back (docs/canvas-bridge.md).
@MainActor
final class CanvasController: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  let webView: WKWebView
  private weak var document: ProjectDocument?
  private var ready = false
  private var lastSent: String?
  private var pendingSend: Task<Void, Never>?
  /// Zoom and wrap as the canvas reports them, for the toolbar.
  private(set) var view = CanvasViewState()

  struct CanvasViewState: Equatable {
    var scale = 1.0
    var wrap = false
    var canWrap = false
  }

  var onViewChange: ((CanvasViewState) -> Void)?

  override init() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    webView = WKWebView(frame: .zero, configuration: config)
    super.init()
    config.userContentController.add(WeakHandler(self), name: "storeShots")
    webView.navigationDelegate = self
    webView.setValue(false, forKey: "drawsBackground")
    webView.allowsMagnification = false
  }

  func load(document: ProjectDocument) {
    self.document = document
    ready = false
    lastSent = nil
    webView.load(URLRequest(url: document.api.url("projects/\(document.name)/canvas")))
  }

  /// Send the state the canvas shows; skipped when nothing changed since the last send.
  func sync() {
    guard ready, let document else { return }
    pendingSend?.cancel()
    pendingSend = Task { @MainActor [weak self] in
      // Coalesce a burst of changes (typing) into one update.
      try? await Task.sleep(for: .milliseconds(30))
      guard !Task.isCancelled, let self else { return }
      let state = Self.state(of: document)
      guard state != self.lastSent else { return }
      self.lastSent = state
      _ = try? await self.webView.evaluateJavaScript("window.storeShots && window.storeShots.update(\(state))")
    }
  }

  func command(_ action: String) {
    guard ready else { return }
    webView.evaluateJavaScript("window.storeShots && window.storeShots.command({action: '\(action)'})")
  }

  private static func state(of d: ProjectDocument) -> String {
    let targets = (try? JSONValue.parse(JSONEncoder().encode(d.targets.map(TargetJSON.init)))) ?? []
    let issues = (try? JSONValue.parse(JSONEncoder().encode(d.issues.map(IssueJSON.init)))) ?? []
    let state: JSONValue = .object(
      JSONObject([
        ("v", 1),
        ("manifest", d.manifest),
        ("content", .object(JSONObject(d.locales.compactMap { l in d.content[l].map { (l, $0) } }))),
        ("targets", targets),
        ("targetId", .string(d.targetId)),
        ("locale", .string(d.locale)),
        ("pageId", .string(d.pageId)),
        ("screenId", .string(d.screenId)),
        ("mode", .string(d.mode.rawValue)),
        ("storeLook", .bool(d.storeLook)),
        ("guides", .bool(d.guides)),
        ("selected", .string(d.selected)),
        ("issues", issues),
        ("failOnOverflow", d.config["validation"]?["failOnOverflow"] ?? true),
        ("failOnTextOverlap", d.config["validation"]?["failOnTextOverlap"] ?? false),
      ]))
    return state.serialized
  }

  // MARK: Messages from the canvas

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any],
      let data = try? JSONSerialization.data(withJSONObject: body),
      let m = try? JSONValue.parse(data),
      let type = m["type"]?.string,
      let document
    else { return }
    switch type {
    case "ready":
      ready = true
      lastSent = nil
      sync()
    case "patchScreen":
      if let id = m["screenId"]?.string, let patch = m["patch"]?.object { document.patchScreen(id, patch: patch) }
    case "select":
      if let el = m["element"]?.string { document.selected = el }
    case "selectItem":
      if let id = m["id"]?.string {
        if document.mode == .locales { document.locale = id } else { document.screenId = id }
      }
    case "openItem":
      if let id = m["id"]?.string {
        if document.mode == .locales { document.locale = id } else { document.screenId = id }
        document.mode = .single
      }
    case "deleteLayer":
      if let layer = m["layerId"]?.string { document.deleteLayer(layer) }
    case "toggleGuides":
      document.guides.toggle()
    case "preview":
      guard m["screenId"]?.string == document.screenId, m["locale"]?.string == document.locale else { return }
      var p = ProjectDocument.PreviewState()
      p.loading = m["loading"]?.bool ?? false
      p.error = m["error"]?.string
      p.sourceExists = m["sourceExists"]?.bool
      for (k, v) in m["budgets"]?.object ?? JSONObject() { p.budgets[k] = v.int }
      if let c = m["checks"], !c.isNull { p.checks = try? JSONDecoder().decode(PreviewChecks.self, from: c.data) }
      if let f = m["fits"], !f.isNull { p.fits = (try? JSONDecoder().decode([FitResult].self, from: f.data)) ?? [] }
      document.preview = p
    case "view":
      view = CanvasViewState(
        scale: m["scale"]?.number ?? 1, wrap: m["wrap"]?.bool ?? false, canWrap: m["canWrap"]?.bool ?? false)
      onViewChange?(view)
    default:
      break
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {}

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    if let document { load(document: document) }
  }
}

/// WKUserContentController retains its handlers; this breaks the cycle.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
  weak var target: (any WKScriptMessageHandler)?
  init(_ target: any WKScriptMessageHandler) { self.target = target }
  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(c, didReceive: message)
  }
}

/// Encodable copies of the read-only models, to hand them back to the canvas.
private struct TargetJSON: Encodable {
  let id, platform, family, displayClass, orientation, fileToken: String
  let width, height: Int
  init(_ t: Target) {
    id = t.id
    platform = t.platform
    family = t.family
    displayClass = t.displayClass
    orientation = t.orientation
    fileToken = t.fileToken
    width = t.width
    height = t.height
  }
}

private struct IssueJSON: Encodable {
  let level, code, message: String
  let key: String?
  init(_ i: Issue) {
    level = i.level
    code = i.code
    message = i.message
    key = i.key
  }
}

struct CanvasView: NSViewRepresentable {
  let controller: CanvasController

  func makeNSView(context: Context) -> WKWebView { controller.webView }
  func updateNSView(_ nsView: WKWebView, context: Context) {}
}
