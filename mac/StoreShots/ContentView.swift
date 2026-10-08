import AppKit
import SwiftUI

struct ContentView: View {
  @Environment(EditorServer.self) private var server
  @Environment(EditorBrowser.self) private var browser
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    ZStack {
      EditorWebView(browser: browser)
        .opacity(server.baseURL == nil ? 0 : 1)
      if server.baseURL == nil {
        placeholder
      }
    }
    .frame(minWidth: 960, minHeight: 640)
    .navigationTitle(windowTitle)
    .toolbar { toolbar }
    .task { server.start() }
    .onChange(of: browser.currentProject) { _, name in
      // An app imported in the editor is not in the list yet.
      if let name, !server.projects.contains(where: { $0.name == name }) {
        Task { await server.refreshProjects() }
      }
    }
    .onChange(of: server.baseURL, initial: true) { _, base in
      if let base {
        browser.attach(to: base)
      } else {
        browser.detach()
      }
    }
  }

  private var windowTitle: String {
    guard let name = browser.currentProject else { return "Store Shots" }
    return server.projects.first { $0.name == name }?.title ?? name
  }

  // MARK: Toolbar

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .navigation) {
      projectMenu
    }
    ToolbarItemGroup(placement: .primaryAction) {
      Button {
        browser.chooseAppToImport()
      } label: {
        Label("Import App", systemImage: "plus")
      }
      .help("Import an app folder (Command-O)")
      .disabled(server.baseURL == nil)

      Button {
        browser.reload()
      } label: {
        Label("Reload", systemImage: "arrow.clockwise")
      }
      .help("Reload the editor (Command-R)")
      .disabled(server.baseURL == nil)

      Button {
        revealCurrentProject()
      } label: {
        Label("Show in Finder", systemImage: "folder")
      }
      .help("Show the app's folder in Finder")
      .disabled(currentRoot == nil)

      Button {
        browser.openInBrowser()
      } label: {
        Label("Open in Browser", systemImage: "safari")
      }
      .help("Open this page in your default browser")
      .disabled(server.baseURL == nil)

      Button {
        openWindow(id: "log")
      } label: {
        ServerStatusLabel(state: server.state)
      }
      .help("\(server.statusText). Click for the server log.")
    }
  }

  private var projectMenu: some View {
    Menu {
      Button("All Apps") { browser.open(project: nil) }
      if !server.projects.isEmpty {
        Divider()
        ForEach(server.projects) { project in
          Button {
            browser.open(project: project.name)
          } label: {
            Text(project.title)
            if let readiness = project.readiness {
              Text(readiness)
            }
          }
          .disabled(project.error != nil)
        }
      }
      Divider()
      Button("Import App...") { browser.chooseAppToImport() }
      Button("Refresh List") {
        Task { await server.refreshProjects() }
      }
    } label: {
      Label(windowTitle, systemImage: "square.stack.3d.up")
        .labelStyle(.titleAndIcon)
    }
    .menuIndicator(.visible)
    .help("Switch app")
    .disabled(server.baseURL == nil)
  }

  private var currentRoot: String? {
    guard let name = browser.currentProject else { return nil }
    return server.projects.first { $0.name == name }?.root
  }

  private func revealCurrentProject() {
    guard let root = currentRoot else { return }
    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: root)])
  }

  // MARK: Placeholder

  @ViewBuilder
  private var placeholder: some View {
    VStack(spacing: 14) {
      switch server.state {
      case .failed(let message):
        Image(systemName: "exclamationmark.triangle")
          .font(.system(size: 34))
          .foregroundStyle(.orange)
        Text("The editor is not running")
          .font(.title3.weight(.semibold))
        Text(message)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .frame(maxWidth: 520)
          .textSelection(.enabled)
        HStack {
          Button("Try Again") { server.restart() }
            .keyboardShortcut(.defaultAction)
          Button("Server Log") { openWindow(id: "log") }
          SettingsLink { Text("Settings...") }
        }
      default:
        ProgressView()
        Text("Starting the editor")
          .font(.title3.weight(.semibold))
        Text(lastLogLine)
          .font(.callout.monospaced())
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.middle)
          .frame(maxWidth: 520)
      }
    }
    .padding(40)
  }

  private var lastLogLine: String {
    server.log.split(whereSeparator: \.isNewline).last.map(String.init) ?? " "
  }
}

struct ServerStatusLabel: View {
  let state: EditorServer.State

  var body: some View {
    Label {
      Text("Server")
    } icon: {
      Image(systemName: "circle.fill")
        .foregroundStyle(color)
        .imageScale(.small)
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

struct LogView: View {
  @Environment(EditorServer.self) private var server

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        Text(server.log.isEmpty ? "Nothing logged yet." : server.log)
          .font(.system(size: 11, design: .monospaced))
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(10)
        Color.clear.frame(height: 1).id("end")
      }
      .onChange(of: server.log, initial: true) {
        proxy.scrollTo("end", anchor: .bottom)
      }
    }
    .frame(minWidth: 640, minHeight: 360)
    .toolbar {
      ToolbarItem {
        Text(server.statusText)
          .foregroundStyle(.secondary)
      }
      ToolbarItem {
        Button("Restart") { server.restart() }
      }
    }
  }
}
