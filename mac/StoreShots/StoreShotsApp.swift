import AppKit
import SwiftUI

@main
struct StoreShotsApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @State private var server = EditorServer()
  @State private var workspace = Workspace()

  var body: some Scene {
    Window("Store Shots", id: "main") {
      MainWindow()
        .environment(server)
        .environment(workspace)
        .onAppear {
          appDelegate.server = server
          appDelegate.workspace = workspace
          #if DEBUG
            DebugHooks.install(workspace: workspace)
          #endif
        }
    }
    .defaultSize(width: 1500, height: 940)
    .commands {
      AppCommands(server: server, workspace: workspace)
    }

    Window("Engine Log", id: "log") {
      LogView()
        .environment(server)
    }
    .defaultSize(width: 820, height: 480)

    Settings {
      SettingsView()
        .environment(server)
    }
  }
}

/// The menu bar: every action the window has, with shortcuts.
struct AppCommands: Commands {
  let server: EditorServer
  let workspace: Workspace
  @FocusedValue(\.document) private var document
  @FocusedValue(\.canvas) private var canvas
  @FocusedValue(\.importApp) private var importApp
  @FocusedValue(\.openPalette) private var openPalette
  @Environment(\.openWindow) private var openWindow

  var body: some Commands {
    CommandGroup(replacing: .newItem) {
      Button("Import App...") { importApp?() }
        .keyboardShortcut("o")
        .disabled(importApp == nil)
    }
    CommandGroup(after: .saveItem) {
      Button("Save") { Task { await document?.save() } }
        .keyboardShortcut("s")
        .disabled(document == nil)
    }

    CommandMenu("Go") {
      Button("Go to or Do...") { openPalette?() }
        .keyboardShortcut("k")
        .disabled(openPalette == nil)
      Divider()
      Button("All Apps") { workspace.selection = .apps }
        .keyboardShortcut("0", modifiers: [.command, .option])
      Divider()
      ForEach(Array(SidebarItem.Section.allCases.enumerated()), id: \.element) { i, section in
        Button(section.title) {
          if let name = workspace.selection?.appName { workspace.open(name, section: section) }
        }
        .keyboardShortcut(KeyEquivalent(Character(String(i + 1))))
        .disabled(workspace.selection?.appName == nil)
      }
      Divider()
      ForEach(Array(server.projects.prefix(9).enumerated()), id: \.element.id) { i, project in
        Button(project.title) { workspace.open(project.name) }
          .keyboardShortcut(KeyEquivalent(Character(String(i + 1))), modifiers: [.command, .option])
      }
    }

    CommandMenu("Screen") {
      Button("Previous Screen") { step(screen: -1) }
        .keyboardShortcut(.upArrow, modifiers: [.command, .option])
      Button("Next Screen") { step(screen: 1) }
        .keyboardShortcut(.downArrow, modifiers: [.command, .option])
      Divider()
      Button("Previous Language") { step(language: -1) }
        .keyboardShortcut("[")
      Button("Next Language") { step(language: 1) }
        .keyboardShortcut("]")
      Button("Next Device") { step(device: 1) }
        .keyboardShortcut("]", modifiers: [.command, .option])
      Divider()
      Button("Generate") { Task { await document?.generate(.all) } }
        .keyboardShortcut("g")
        .disabled(document == nil || document?.generation?.running == true)
      Button("Generate This Screen") { Task { await document?.generate(.screen) } }
        .keyboardShortcut("g", modifiers: [.command, .shift])
        .disabled(document?.screen == nil || document?.generation?.running == true)
    }

    CommandGroup(before: .toolbar) {
      Picker(
        "Canvas",
        selection: Binding(get: { document?.mode ?? .single }, set: { document?.mode = $0 })
      ) {
        Text("One Screen").tag(ProjectDocument.CanvasMode.single).keyboardShortcut("1", modifiers: [.command, .shift])
        Text("Strip").tag(ProjectDocument.CanvasMode.strip).keyboardShortcut("2", modifiers: [.command, .shift])
        Text("All Languages").tag(ProjectDocument.CanvasMode.locales).keyboardShortcut("3", modifiers: [.command, .shift])
      }
      .disabled(document == nil)
      Toggle("App Store Look", isOn: Binding(get: { document?.storeLook ?? false }, set: { document?.storeLook = $0 }))
        .disabled(document == nil)
      Toggle("Layout Guides", isOn: Binding(get: { document?.guides ?? false }, set: { document?.guides = $0 }))
        .keyboardShortcut("g", modifiers: [.command, .option])
        .disabled(document == nil)
      Divider()
      Button("Zoom In") { canvas?.command("zoomIn") }
        .keyboardShortcut("=")
        .disabled(canvas == nil)
      Button("Zoom Out") { canvas?.command("zoomOut") }
        .keyboardShortcut("-")
        .disabled(canvas == nil)
      Button("Zoom to Fit") { canvas?.command("fit") }
        .keyboardShortcut("9")
        .disabled(canvas == nil)
      Button("Actual Size") { canvas?.command("actual") }
        .keyboardShortcut("0")
        .disabled(canvas == nil)
      Button("Wrap Strip into Rows") { canvas?.command("toggleWrap") }
        .disabled(canvas == nil || document?.mode == .single)
      Divider()
    }

    CommandMenu("Engine") {
      Text(server.statusText)
      Divider()
      Button("Restart Engine") {
        Task {
          await workspace.flushAll()
          server.restart()
        }
      }
      Button("Show Engine Log") { openWindow(id: "log") }
        .keyboardShortcut("l", modifiers: [.command, .shift])
      Button("Open in Browser") {
        guard let base = server.baseURL else { return }
        let path = workspace.selection?.appName.map { "projects/\($0)" } ?? ""
        NSWorkspace.shared.open(base.appending(path: path))
      }
      .keyboardShortcut("b", modifiers: [.command, .shift])
      .disabled(server.baseURL == nil)
    }
  }

  private func step(screen delta: Int) {
    guard let d = document else { return }
    let list = d.pageScreens.map(\.id)
    guard let i = list.firstIndex(of: d.screenId), list.indices.contains(i + delta) else { return }
    d.screenId = list[i + delta]
  }

  private func step(language delta: Int) {
    guard let d = document, let i = d.locales.firstIndex(of: d.locale), !d.locales.isEmpty else { return }
    d.locale = d.locales[(i + delta + d.locales.count) % d.locales.count]
  }

  private func step(device delta: Int) {
    guard let d = document, let i = d.targets.firstIndex(where: { $0.id == d.targetId }), !d.targets.isEmpty else { return }
    d.targetId = d.targets[(i + delta + d.targets.count) % d.targets.count].id
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  @MainActor var server: EditorServer?
  @MainActor var workspace: Workspace?

  /// Unsaved edits are written before the app (and an engine it started) goes.
  @MainActor
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let workspace, workspace.hasUnsavedEdits else { return .terminateNow }
    Task { @MainActor in
      await workspace.flushAll()
      sender.reply(toApplicationShouldTerminate: true)
    }
    return .terminateLater
  }
  private var terminationSource: DispatchSourceSignal?

  @MainActor
  func applicationDidFinishLaunching(_ notification: Notification) {
    // `kill` and logout send SIGTERM, which skips applicationWillTerminate and
    // would leave a started engine running: quit properly instead.
    signal(SIGTERM, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    source.setEventHandler { NSApp.terminate(nil) }
    source.resume()
    terminationSource = source
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  @MainActor
  func applicationWillTerminate(_ notification: Notification) {
    // Stops only an engine this app started; an attached one keeps running.
    server?.stop()
  }
}
