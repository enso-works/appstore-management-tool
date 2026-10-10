import SwiftUI

/// The window: apps and their sections in the sidebar, the selected section beside it.
struct MainWindow: View {
  @Environment(EditorServer.self) private var server
  @Environment(Workspace.self) private var workspace
  @Environment(\.openWindow) private var openWindow
  @State private var importing = false

  var body: some View {
    @Bindable var workspace = workspace
    NavigationSplitView {
      Sidebar(importing: $importing)
        .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 320)
    } detail: {
      detail
    }
    .frame(minWidth: 1100, minHeight: 700)
    .navigationTitle(title)
    .task { server.start() }
    .onChange(of: server.baseURL) { _, base in
      // Documents keep their drafts while the engine is away and save once it is back.
      if let base { workspace.rebase(base) }
    }
    .onChange(of: server.projects) { _, projects in
      // Reopen the app shown last time once the list is in.
      if workspace.selection == .apps, let last = AppSettings.lastProject,
        projects.contains(where: { $0.name == last }), !restoredLast
      {
        restoredLast = true
        workspace.open(last)
      }
    }
    .sheet(isPresented: $importing) {
      if let base = server.baseURL {
        ImportSheet(api: APIClient(base: base)) { name in
          Task {
            await server.refreshProjects()
            if let name { workspace.open(name) }
          }
        }
      }
    }
    .focusedSceneValue(\.importApp, server.baseURL == nil ? nil : { importing = true })
  }

  @State private var restoredLast = false

  private var title: String {
    guard let name = workspace.selection?.appName else { return "Store Shots" }
    return server.projects.first { $0.name == name }?.title ?? name
  }

  @ViewBuilder
  private var detail: some View {
    if let base = server.baseURL {
      switch workspace.selection {
      case .app(let name, let section):
        let doc = workspace.document(name, base: base)
        Group {
          if let error = doc.loadError {
            ContentUnavailableView {
              Label("Cannot open \(name)", systemImage: "exclamationmark.triangle")
            } description: {
              Text(error)
            } actions: {
              Button("Try Again") { Task { await doc.load() } }
            }
          } else if doc.info == nil {
            ProgressView("Opening \(name)")
          } else {
            SectionView(document: doc, section: section)
          }
        }
        .id(name)
      default:
        AppsOverview(api: APIClient(base: base), importing: $importing)
      }
    } else {
      ServerPlaceholder()
    }
  }
}

/// One app's section.
struct SectionView: View {
  let document: ProjectDocument
  let section: SidebarItem.Section
  @Environment(\.undoManager) private var undoManager
  @Environment(Workspace.self) private var workspace

  /// The window has one Edit menu: its undo steps belong to the app shown, never another.
  private func adoptUndo(_ manager: UndoManager?) {
    for other in workspace.documents.values where other !== document {
      manager?.removeAllActions(withTarget: other)
      if other.undoManager === manager { other.undoManager = nil }
    }
    document.undoManager = manager
  }

  var body: some View {
    Group {
      switch section {
      case .design: DesignView(document: document)
      case .pages: PagesView(document: document)
      case .listing: ListingView(document: document)
      case .ship: ShipView(document: document)
      case .settings: AppSettingsView(document: document)
      }
    }
    .onAppear { adoptUndo(undoManager) }
    .onChange(of: undoManager) { _, m in adoptUndo(m) }
    .focusedSceneValue(\.document, document)
  }
}

// MARK: Sidebar

struct Sidebar: View {
  @Environment(EditorServer.self) private var server
  @Environment(Workspace.self) private var workspace
  @Binding var importing: Bool
  @State private var expanded: Set<String> = []

  var body: some View {
    @Bindable var workspace = workspace
    List(selection: $workspace.selection) {
      Label("All Apps", systemImage: "square.grid.2x2")
        .tag(SidebarItem.apps)
      Section("Apps") {
        ForEach(server.projects) { project in
          DisclosureGroup(isExpanded: binding(for: project.name)) {
            ForEach(SidebarItem.Section.allCases) { section in
              Label(section.title, systemImage: section.systemImage)
                .tag(SidebarItem.app(project.name, section))
            }
          } label: {
            AppRow(project: project)
              .tag(SidebarItem.app(project.name, .design))
          }
          .disabled(project.error != nil)
        }
      }
    }
    .listStyle(.sidebar)
    .safeAreaInset(edge: .bottom) {
      HStack {
        Button {
          importing = true
        } label: {
          Label("Import App", systemImage: "plus")
        }
        .buttonStyle(.borderless)
        .disabled(server.baseURL == nil)
        Spacer()
        ServerStatusDot(state: server.state)
      }
      .padding(10)
    }
    .onChange(of: workspace.selection, initial: true) { _, sel in
      if let name = sel?.appName { expanded.insert(name) }
    }
  }

  private func binding(for name: String) -> Binding<Bool> {
    Binding(
      get: { expanded.contains(name) },
      set: { open in
        if open { expanded.insert(name) } else { expanded.remove(name) }
      })
  }
}

struct AppRow: View {
  let project: ProjectSummary

  var body: some View {
    HStack {
      Text(project.title)
      Spacer()
      if let r = project.readiness {
        Image(systemName: r == "pass" ? "checkmark.circle.fill" : r == "warn" ? "exclamationmark.circle.fill" : "xmark.circle.fill")
          .foregroundStyle(r == "pass" ? .green : r == "warn" ? .orange : .red)
          .help(r == "pass" ? "Ready to ship" : "Ship has things to fix")
      }
    }
  }
}

struct ServerStatusDot: View {
  @Environment(\.openWindow) private var openWindow
  let state: EditorServer.State

  var body: some View {
    Button {
      openWindow(id: "log")
    } label: {
      Image(systemName: "circle.fill")
        .imageScale(.small)
        .foregroundStyle(color)
    }
    .buttonStyle(.borderless)
    .help("Engine: \(text). Click for its log.")
  }

  private var text: String {
    switch state {
    case .ready(let port, let owned): owned ? "running on :\(port)" : "attached to :\(port)"
    case .starting: "starting"
    case .failed(let m): "failed (\(m))"
    case .idle: "stopped"
    }
  }

  private var color: Color {
    switch state {
    case .ready: .green
    case .starting: .yellow
    case .failed: .red
    case .idle: .gray
    }
  }
}

/// While the engine starts, or when it cannot.
struct ServerPlaceholder: View {
  @Environment(EditorServer.self) private var server
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    switch server.state {
    case .failed(let message):
      ContentUnavailableView {
        Label("The engine is not running", systemImage: "exclamationmark.triangle")
      } description: {
        Text(message).textSelection(.enabled)
      } actions: {
        Button("Try Again") { server.restart() }
          .keyboardShortcut(.defaultAction)
        Button("Show Log") { openWindow(id: "log") }
        SettingsLink { Text("Settings...") }
      }
    default:
      VStack(spacing: 12) {
        ProgressView()
        Text("Starting the engine")
          .font(.title3.weight(.semibold))
        Text(server.log.split(whereSeparator: \.isNewline).last.map(String.init) ?? " ")
          .font(.callout.monospaced())
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.middle)
          .frame(maxWidth: 520)
      }
    }
  }
}

// MARK: Focused values for menu commands

extension FocusedValues {
  @Entry var document: ProjectDocument?
  @Entry var importApp: (() -> Void)?
  @Entry var canvas: CanvasController?
}
