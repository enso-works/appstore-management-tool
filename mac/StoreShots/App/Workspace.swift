import Foundation
import Observation

/// What the window shows: the apps overview, or one app's section.
enum SidebarItem: Hashable {
  case apps
  case app(String, Section)

  enum Section: String, CaseIterable, Identifiable {
    case design, pages, listing, ship, settings
    var id: String { rawValue }
    var title: String {
      switch self {
      case .design: "Design"
      case .pages: "Pages"
      case .listing: "Listing"
      case .ship: "Ship"
      case .settings: "Settings"
      }
    }
    var systemImage: String {
      switch self {
      case .design: "paintbrush.pointed"
      case .pages: "rectangle.stack"
      case .listing: "text.alignleft"
      case .ship: "shippingbox"
      case .settings: "gearshape"
      }
    }
  }

  var appName: String? {
    if case .app(let name, _) = self { return name }
    return nil
  }
}

/// The open apps (one document each, kept while the window lives) and the selection.
@MainActor
@Observable
final class Workspace {
  var selection: SidebarItem? = .apps {
    didSet {
      if case .app(let name, let section) = selection {
        AppSettings.lastProject = name
        UserDefaults.standard.set(section.rawValue, forKey: "lastSection")
      }
    }
  }
  private(set) var documents: [String: ProjectDocument] = [:]

  /// The document for an app, loaded on first use.
  func document(_ name: String, base: URL) -> ProjectDocument {
    if let d = documents[name] {
      if d.api.base != base { d.api = APIClient(base: base) }
      return d
    }
    let d = ProjectDocument(name: name, api: APIClient(base: base))
    documents[name] = d
    Task { await d.load() }
    return d
  }

  /// The engine is back, perhaps on another port: point every document at it and write
  /// what could not be saved while it was away.
  func rebase(_ base: URL) {
    for d in documents.values {
      if d.api.base != base { d.api = APIClient(base: base) }
      if d.isDirty || d.listing.isDirty { Task { await d.flush() } }
    }
  }

  /// Every unsaved edit in every open app, written before a restart or quit.
  func flushAll() async {
    for d in documents.values { await d.flush() }
  }

  var hasUnsavedEdits: Bool { documents.values.contains { $0.isDirty || $0.listing.isDirty } }

  var currentDocument: ProjectDocument? {
    selection?.appName.flatMap { documents[$0] }
  }

  func open(_ name: String, section: SidebarItem.Section = .design) {
    selection = .app(name, section)
  }

  /// The app and section shown when the app was last used.
  func restoreLast(among names: [String]) {
    guard let last = AppSettings.lastProject, names.contains(last) else { return }
    let section = UserDefaults.standard.string(forKey: "lastSection").flatMap(SidebarItem.Section.init) ?? .design
    open(last, section: section)
  }

}
