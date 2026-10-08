import AppKit
import SwiftUI

@main
struct StoreShotsApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @State private var server = EditorServer()
  @State private var browser = EditorBrowser()

  var body: some Scene {
    Window("Store Shots", id: "main") {
      ContentView()
        .environment(server)
        .environment(browser)
        .onAppear { appDelegate.server = server }
    }
    .defaultSize(width: 1440, height: 900)
    .commands {
      CommandGroup(replacing: .newItem) {
        Button("Import App...") { browser.chooseAppToImport() }
          .keyboardShortcut("o")
          .disabled(server.baseURL == nil)
      }
      CommandMenu("App") {
        Button("All Apps") { browser.open(project: nil) }
          .keyboardShortcut("0")
        Divider()
        ForEach(Array(server.projects.prefix(9).enumerated()), id: \.element.id) { index, project in
          Button(project.title) { browser.open(project: project.name) }
            .keyboardShortcut(KeyEquivalent(Character(String(index + 1))))
        }
        if server.projects.count > 9 {
          ForEach(server.projects.dropFirst(9)) { project in
            Button(project.title) { browser.open(project: project.name) }
          }
        }
        Divider()
        Button("Reload") { browser.reload() }
          .keyboardShortcut("r")
        Button("Open in Browser") { browser.openInBrowser() }
          .keyboardShortcut("b", modifiers: [.command, .shift])
      }
      CommandMenu("Server") {
        Text(server.statusText)
        Divider()
        Button("Restart Editor") { server.restart() }
        LogWindowButton()
      }
    }

    Window("Server Log", id: "log") {
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

private struct LogWindowButton: View {
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    Button("Show Server Log") { openWindow(id: "log") }
      .keyboardShortcut("l", modifiers: [.command, .shift])
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  @MainActor var server: EditorServer?
  private var terminationSource: DispatchSourceSignal?

  @MainActor
  func applicationDidFinishLaunching(_ notification: Notification) {
    // `kill` and logout send SIGTERM, which skips applicationWillTerminate and
    // would leave a started editor running: quit properly instead.
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
    // Stops only an editor this app started; an attached one keeps running.
    server?.stop()
  }
}
