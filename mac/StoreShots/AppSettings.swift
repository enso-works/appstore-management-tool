import AppKit
import SwiftUI

/// User defaults the app reads, with the defaults it falls back to.
enum AppSettings {
  static let toolRootKey = "toolRoot"
  static let preferredPortKey = "preferredPort"
  static let lastProjectKey = "lastProject"

  /// The store-shots checkout the editor runs from: Settings, else the checkout
  /// this app was built from.
  static var toolRoot: String {
    if let custom = UserDefaults.standard.string(forKey: toolRootKey), !custom.isEmpty {
      return custom
    }
    let built = Bundle.main.object(forInfoDictionaryKey: "StoreShotsRoot") as? String ?? ""
    return (built as NSString).standardizingPath
  }

  static var preferredPort: Int {
    let value = UserDefaults.standard.integer(forKey: preferredPortKey)
    return value > 0 ? value : 3000
  }

  /// Off only for testing the start-and-stop path next to a running editor:
  /// `open -a "Store Shots" --args -attachToRunning NO`.
  static var attachToRunning: Bool {
    let defaults = UserDefaults.standard
    return defaults.object(forKey: "attachToRunning") == nil || defaults.bool(forKey: "attachToRunning")
  }

  static var lastProject: String? {
    get { UserDefaults.standard.string(forKey: lastProjectKey) }
    set { UserDefaults.standard.set(newValue, forKey: lastProjectKey) }
  }

  static func isToolRoot(_ path: String) -> Bool {
    FileManager.default.fileExists(atPath: (path as NSString).appendingPathComponent("bin/store-shots.mjs"))
  }
}

struct SettingsView: View {
  @Environment(EditorServer.self) private var server
  @AppStorage(AppSettings.toolRootKey) private var toolRoot = ""
  @AppStorage(AppSettings.preferredPortKey) private var preferredPort = 3000
  @State private var invalidFolder = false

  var body: some View {
    Form {
      Section {
        LabeledContent("store-shots folder") {
          HStack {
            Text(AppSettings.toolRoot)
              .lineLimit(1)
              .truncationMode(.middle)
              .foregroundStyle(toolRoot.isEmpty ? .secondary : .primary)
              .textSelection(.enabled)
            Button("Choose...", action: chooseFolder)
            if !toolRoot.isEmpty {
              Button("Reset") { toolRoot = "" }
            }
          }
        }
        if invalidFolder {
          Text("That folder has no bin/store-shots.mjs.")
            .font(.callout)
            .foregroundStyle(.red)
        }
        TextField("First port to try", value: $preferredPort, format: .number.grouping(.never))
          .frame(maxWidth: 260)
      } footer: {
        Text("Used when no editor is running yet. An editor already running on 3000-3009 is attached to instead, and left running on quit.")
          .font(.callout)
          .foregroundStyle(.secondary)
      }

      Section {
        Button("Restart Editor") { server.restart() }
      }
    }
    .formStyle(.grouped)
    .frame(width: 560)
    .fixedSize(horizontal: false, vertical: true)
  }

  private func chooseFolder() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.message = "Choose the store-shots checkout (the folder with bin/store-shots.mjs)."
    panel.directoryURL = URL(fileURLWithPath: AppSettings.toolRoot)
    guard panel.runModal() == .OK, let url = panel.url else { return }
    invalidFolder = !AppSettings.isToolRoot(url.path)
    if !invalidFolder { toolRoot = url.path }
  }
}
