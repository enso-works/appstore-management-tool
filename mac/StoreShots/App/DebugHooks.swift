#if DEBUG
import AppKit

/// Debug builds only: lets a script drive the window and photograph it, without
/// screen-recording rights (`mac/docs-shots.sh` takes the docs images this way).
///
///   notify com.bavrk.storeshots.debug "open:<app>:<section>"   (section: design, pages, ...)
///   notify com.bavrk.storeshots.debug "apps"
///   notify com.bavrk.storeshots.debug "mode:<single|strip|locales>"
///   notify com.bavrk.storeshots.debug "screen:<id>"
///   notify com.bavrk.storeshots.debug "live:<country|off>"   (the live listing under the strip)
///   notify com.bavrk.storeshots.debug "size:<width>:<height>"   (window content size, points)
///   notify com.bavrk.storeshots.debug "snapshot:/path/to/file.png"   (blank while the screen is locked)
///   notify com.bavrk.storeshots.debug "snapshot-sheet:/path/to/file.png"   (the sheet open on the window)
///   notify com.bavrk.storeshots.debug "import:/path/to/app"   (Import App with that folder read)
///   notify com.bavrk.storeshots.debug "theme"   (Screen > Theme... for the app shown)
///   notify com.bavrk.storeshots.debug "apply-theme:<id>:<#hex>"   (as Apply in that sheet; undo/redo follow)
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
    case "screen" where parts.count == 2:
      workspace?.currentDocument?.screenId = parts[1]
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
    case "import" where parts.count >= 2:
      workspace?.importRequest = parts.dropFirst().joined(separator: ":")
    case "theme":
      workspace?.currentDocument?.showThemeSheet = true
    case "apply-theme" where parts.count == 3:
      if let d = workspace?.currentDocument { Task { try? await d.applyTheme(parts[1], accent: parts[2]) } }
    case "undo":
      workspace?.currentDocument?.undoManager?.undo()
    case "redo":
      workspace?.currentDocument?.undoManager?.redo()
    case "dump" where parts.count == 2:
      dump(to: parts[1])
    case "size" where parts.count == 3:
      if let w = Double(parts[1]), let h = Double(parts[2]),
        let window = NSApp.windows.first(where: { $0.isVisible && $0.title != "" && $0.contentView != nil })
      {
        window.setFrame(window.frameRect(forContentRect: CGRect(x: 80, y: 80, width: w, height: h)), display: true)
      }
    case "live" where parts.count == 2:
      workspace?.currentDocument?.liveCountry = parts[1] == "off" ? nil : parts[1]
    case "snapshot" where parts.count == 2:
      snapshot(to: parts[1])
    case "snapshot-sheet" where parts.count == 2:
      snapshot(to: parts[1], sheet: true)
    default:
      break
    }
  }

  /// The window as the window server composes it (glass included). An app may capture its
  /// own windows without screen-recording rights; the call is looked up at run time because
  /// the macOS 15 SDK hides it.
  /// The main window, or with `sheet` the sheet open on it (a window of its own).
  private static func snapshot(to path: String, sheet: Bool = false) {
    guard let main = NSApp.windows.first(where: { $0.isVisible && $0.title != "" && $0.contentView != nil }),
      let window = sheet ? main.attachedSheet : main,
      let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage")
    else { return }
    typealias Create = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
    let create = unsafeBitCast(symbol, to: Create.self)
    // optionIncludingWindow = 8; boundsIgnoreFraming = 1, bestResolution = 8.
    guard let image = create(.null, 8, UInt32(window.windowNumber), 1 | 8)?.takeRetainedValue() else { return }
    let bitmap = NSBitmapImageRep(cgImage: image)
    try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
  }

  /// The window's state as text, for checking behaviour from a script.
  private static func dump(to path: String) {
    var out: [String] = []
    out.append("selection: \(String(describing: workspace?.selection))")
    if let w = NSApp.windows.first(where: { $0.isVisible && $0.title != "" && $0.contentView != nil }) {
      out.append("window: \(w.frame) contentMin: \(w.contentMinSize) fitting: \(w.contentView?.fittingSize ?? .zero)")
      // Each split view column: its frame, and the width it insists on (fit).
      func walk(_ v: NSView, _ depth: Int) {
        if let split = v as? NSSplitView {
          out.append(String(repeating: "  ", count: depth) + "split \(type(of: split)) \(split.frame.size)")
          for sub in split.arrangedSubviews {
            out.append(String(repeating: "  ", count: depth + 1) + "\(type(of: sub)) \(sub.frame) fit \(sub.fittingSize)")
          }
        }
        for sub in v.subviews { walk(sub, depth + (v is NSSplitView ? 1 : 0)) }
      }
      if let root = w.contentView?.superview { walk(root, 0) }
    }
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
}
#endif
