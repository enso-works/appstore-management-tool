import SwiftUI

/// Add an app: pick one found near the tool or choose its folder, check what was
/// read from it, and import. An app that already has a config keeps it unchanged.
struct ImportSheet: View {
  let api: APIClient
  var done: (String?) -> Void

  @State private var candidates: [Candidate] = []
  @State private var proposal: JSONValue?
  @State private var root = ""
  @State private var projectName = ""
  @State private var locales = ""
  @State private var orientation = "portrait"
  @State private var ipad = false
  @State private var play = false
  @State private var error: String?
  @State private var busy = false

  struct Candidate: Hashable {
    let root: String
    let name: String
    let hasConfig: Bool
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("Import App").font(.title2.weight(.semibold)).padding([.top, .horizontal], 20)
      Form {
        if proposal == nil {
          Section("Apps Next to the Tool") {
            if candidates.isEmpty { Text("None found.").foregroundStyle(.secondary) }
            ForEach(candidates, id: \.self) { c in
              Button {
                Task { await inspect(c.root) }
              } label: {
                HStack {
                  Text(c.name)
                  Spacer()
                  if c.hasConfig { Text("has a config").foregroundStyle(.secondary) }
                }
                .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
            }
          }
          Section {
            Button("Choose a Folder...") { choose() }
          }
        } else {
          Section("What Was Found") {
            LabeledContent("Folder", value: root)
            TextField("Name", text: $projectName)
            TextField("Languages", text: $locales, prompt: Text("en-US, de-DE"))
            Picker("Orientation", selection: $orientation) {
              Text("Portrait").tag("portrait")
              Text("Landscape").tag("landscape")
            }
            Toggle("iPad", isOn: $ipad)
            Toggle("Google Play", isOn: $play)
          }
          if let notes = proposal?["notes"]?.array?.compactMap(\.string), !notes.isEmpty {
            Section("Notes") {
              ForEach(notes, id: \.self) { Text($0).font(.callout).foregroundStyle(.secondary) }
            }
          }
        }
        if let error {
          Text(error).foregroundStyle(.red)
        }
      }
      .formStyle(.grouped)
    }
    .frame(width: 520, height: 520)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { done(nil) } }
      if proposal != nil {
        ToolbarItem(placement: .confirmationAction) {
          Button("Import") { Task { await importApp() } }
            .disabled(busy)
        }
      }
    }
    .task { await loadCandidates() }
  }

  private func loadCandidates() async {
    guard let body = try? await api.get("api/import") else { return }
    candidates = (body["candidates"]?.array ?? []).compactMap { c in
      guard let root = c["root"]?.string, let name = c["name"]?.string else { return nil }
      return Candidate(root: root, name: name, hasConfig: c["hasConfig"]?.bool ?? false)
    }
  }

  private func choose() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.message = "Choose the app's folder (the one with app.json, an Xcode project or capacitor.config)."
    guard panel.runModal() == .OK, let url = panel.url else { return }
    Task { await inspect(url.path) }
  }

  private func inspect(_ path: String) async {
    do {
      let p = try await api.get("api/import", query: ["path": path])
      proposal = p
      root = p["root"]?.string ?? path
      projectName = p["projectName"]?.string ?? ""
      locales = (p["locales"]?.array?.compactMap(\.string) ?? []).joined(separator: ", ")
      orientation = p["orientation"]?.string ?? "portrait"
      ipad = p["ipad"]?.bool ?? false
      play = p["play"]?.bool ?? false
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func importApp() async {
    busy = true
    defer { busy = false }
    let list = locales.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    do {
      let answer = try await api.send(
        "POST", "api/import",
        body: [
          "root": .string(root), "projectName": .string(projectName), "locales": .array(list.map { .string($0) }),
          "orientation": .string(orientation), "ipad": .bool(ipad), "play": .bool(play),
        ])
      done(answer["entry"]?["name"]?.string)
    } catch {
      self.error = error.localizedDescription
    }
  }
}
