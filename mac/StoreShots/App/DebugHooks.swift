#if DEBUG
import AppKit
import WebKit

/// Debug builds only: lets a script drive the window and photograph it, for
/// checking the UI without screen-recording rights.
///
///   notify com.bavrk.storeshots.debug "open:<app>:<section>"   (section: design, pages, ...)
///   notify com.bavrk.storeshots.debug "apps"
///   notify com.bavrk.storeshots.debug "mode:<single|strip|locales>"
///   notify com.bavrk.storeshots.debug "snapshot:/path/to/file.png"
@MainActor
enum DebugHooks {
  static var workspace: Workspace?
  private static var observer: NSObjectProtocol?

  static func install(workspace: Workspace) {
    self.workspace = workspace
    guard observer == nil else { return }
    observer = DistributedNotificationCenter.default().addObserver(
      forName: Notification.Name("com.bavrk.storeshots.debug"), object: nil, queue: .main
    ) { note in
      let command = note.object as? String ?? ""
      MainActor.assumeIsolated { handle(command) }
    }
  }

  private static func handle(_ command: String) {
    let parts = command.split(separator: ":", maxSplits: 2).map(String.init)
    switch parts.first {
    case "open" where parts.count == 3:
      workspace?.open(parts[1], section: SidebarItem.Section(rawValue: parts[2]) ?? .design)
    case "apps":
      workspace?.selection = .apps
    case "mode" where parts.count == 2:
      workspace?.currentDocument?.mode = ProjectDocument.CanvasMode(rawValue: parts[1]) ?? .single
    case "select" where parts.count == 2:
      workspace?.currentDocument?.selected = parts[1]
    case "field" where parts.count == 3:
      workspace?.currentDocument?.setField(parts[1], .string(parts[2]))
    case "nudge":
      if let d = workspace?.currentDocument, let id = d.screen?.id {
        let x = d.screen?.overrides["screenshotOffsetX"]?.number ?? 0
        d.patchScreen(id, patch: ["overrides": .object({ var o = d.screen!.overrides; o["screenshotOffsetX"] = .number(x + 0.01); return o }())])
      }
    case "capture" where parts.count == 3:
      if let d = workspace?.currentDocument {
        Task { await d.saveCapture(URL(fileURLWithPath: parts[2]), screen: parts[1]) }
      }
    case "undo":
      workspace?.currentDocument?.undoManager?.undo()
    case "redo":
      workspace?.currentDocument?.undoManager?.redo()
    case "dump" where parts.count == 2:
      dump(to: parts[1])
    case "snapshot" where parts.count == 2:
      Task { await snapshot(to: parts[1]) }
    default:
      break
    }
  }

  /// The window drawn from its layer tree (toolbar, sidebar and inspector included), with
  /// each web view's own snapshot drawn where it sits: no screen-recording rights needed.
  private static func snapshot(to path: String) async {
    guard let window = NSApp.windows.first(where: { $0.isVisible && $0.title != "" && $0.contentView != nil }),
      let frameView = window.contentView?.superview, let root = frameView.layer
    else { return }
    let scale = window.backingScaleFactor
    let size = frameView.bounds.size
    guard
      let ctx = CGContext(
        data: nil, width: Int(size.width * scale), height: Int(size.height * scale), bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return }
    ctx.setFillColor(NSColor.windowBackgroundColor.cgColor)
    ctx.fill(CGRect(origin: .zero, size: CGSize(width: size.width * scale, height: size.height * scale)))
    ctx.scaleBy(x: scale, y: scale)
    if root.contentsAreFlipped() || frameView.isFlipped {
      ctx.translateBy(x: 0, y: size.height)
      ctx.scaleBy(x: 1, y: -1)
    }
    root.render(in: ctx)
    guard let base = ctx.makeImage() else { return }
    let image = NSImage(size: size)
    image.lockFocus()
    NSImage(cgImage: base, size: size).draw(in: CGRect(origin: .zero, size: size))
    for web in webViews(in: frameView) where !web.isHiddenOrHasHiddenAncestor {
      guard let shot = try? await web.takeSnapshot(configuration: nil) else { continue }
      shot.draw(in: web.convert(web.bounds, to: nil))
    }
    image.unlockFocus()
    guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:])
    else { return }
    try? png.write(to: URL(fileURLWithPath: path))
  }

  /// The window's state as text, for checking behaviour from a script.
  private static func dump(to path: String) {
    var out: [String] = []
    out.append("selection: \(String(describing: workspace?.selection))")
    if let d = workspace?.currentDocument {
      out.append("app: \(d.projectTitle) loaded=\(d.info != nil) error=\(d.loadError ?? "-")")
      out.append("target: \(d.targetId) locale: \(d.locale) page: '\(d.pageId)' screen: \(d.screenId) mode: \(d.mode.rawValue)")
      out.append("selected: \(d.selected) save: \(d.saveStatus) dirty: \(d.isDirty)")
      out.append("pageScreens: \(d.pageScreens.map(\.id).joined(separator: ","))")
      out.append("preview: loading=\(d.preview.loading) budgets=\(d.preview.budgets) error=\(d.preview.error ?? "-")")
      out.append("issues: \(d.issues.count) readiness: \(d.readiness?.summary ?? "-")")
      out.append("thumbnails: \(Thumbnails.shared.images.count) \(Thumbnails.shared.debugState)")
      if let g = d.generation { out.append("generation: \(g)") }
      out.append("undo: \(d.undoManager?.canUndo ?? false) \(d.undoManager?.undoActionName ?? "")")
      out.append("capture: rev=\(d.captureRevisions) \(d.captureMessage ?? "-") pending=\(d.pendingCapture?.path ?? "-")")
    }
    try? out.joined(separator: "\n").write(toFile: path, atomically: true, encoding: .utf8)
  }

  private static func webViews(in view: NSView) -> [WKWebView] {
    (view as? WKWebView).map { [$0] } ?? view.subviews.flatMap(webViews)
  }
}
#endif
