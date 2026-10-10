import SwiftUI

/// One app's settings: devices, languages, brand colours, fonts, App Store Connect key.
struct AppSettingsView: View {
  @Bindable var document: ProjectDocument
  @State private var error: String?
  @State private var newLocale = ""
  @State private var newFont = ""
  @State private var busy = false
  /// The colour panel reports every drag step: only the colour picked last is saved.
  @State private var colorSave: Task<Void, Never>?

  private var configured: [String] { document.config["targets"]?.array?.compactMap(\.string) ?? [] }
  private var allTargets: [Target] { document.info?.allTargets ?? document.targets }

  /// Device groups as Apple names them.
  private var groups: [(String, [Target])] {
    let t = allTargets
    return [
      ("iPhone", t.filter { $0.family == "iphone" && !$0.id.hasPrefix("iphone-duo-") }),
      ("iPhone Duo (required from April 2027)", t.filter { $0.id.hasPrefix("iphone-duo-") }),
      ("iPad", t.filter { $0.family == "ipad" }),
      ("Header and Search Results (iOS 27)", t.filter { $0.family == "creative" }),
      ("In-App Events", t.filter { $0.family == "event" }),
      ("App Preview Posters", t.filter { $0.id.hasPrefix("appreview-") }),
      ("Google Play", t.filter { $0.platform == "android" }),
    ].filter { !$0.1.isEmpty }
  }

  var body: some View {
    Form {
      if let error {
        Section { Text(error).foregroundStyle(.red).textSelection(.enabled) }
      }
      Section {
        LabeledContent("Folder") {
          HStack {
            Text(document.info?.root ?? "").lineLimit(1).truncationMode(.middle).textSelection(.enabled)
            Button("Show in Finder") {
              if let root = document.info?.root { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: root)]) }
            }
          }
        }
        if let credentials = document.readiness?.checks.first(where: { $0.id == "credentials" }) {
          LabeledContent("App Store Connect key") {
            Text(credentials.details.first ?? (credentials.status == "pass" ? "Found" : "Not found"))
              .foregroundStyle(credentials.status == "fail" ? .red : .secondary)
          }
        }
      }

      ForEach(groups, id: \.0) { group in
        Section(group.0) {
          ForEach(group.1) { t in
            Toggle(isOn: Binding(get: { configured.contains(t.id) }, set: { setTarget(t.id, $0) })) {
              HStack {
                Text(t.label(among: group.1))
                Text("\(t.width) x \(t.height)").foregroundStyle(.secondary).monospacedDigit()
              }
            }
            .disabled(busy)
          }
        }
      }

      Section("Languages") {
        ForEach(document.locales, id: \.self) { l in
          HStack {
            Text(LocaleName.of(l))
            Text(l).foregroundStyle(.secondary)
            Spacer()
            if l == document.defaultLocale {
              Text("Default").foregroundStyle(.secondary)
            } else {
              Button("Make Default") { Task { await save(["defaultLocale": .string(l)]) } }
                .buttonStyle(.link)
              Button {
                Task { await save(["locales": .array(document.locales.filter { $0 != l }.map { .string($0) })]) }
              } label: {
                Image(systemName: "minus.circle")
              }
              .buttonStyle(.borderless)
              .help("Remove this language from the screenshots (its files stay)")
            }
          }
        }
        HStack {
          TextField("Add language", text: $newLocale, prompt: Text("e.g. fr-FR, ja, pt-BR"))
            .onSubmit(addLocale)
          Button("Add", action: addLocale).disabled(newLocale.isEmpty)
        }
      }

      Section("Brand Colours") {
        brandColor("primary", "Primary", fallback: "#111111")
        brandColor("onPrimary", "Text on primary", fallback: "#FFFFFF")
        brandColor("accent", "Accent (eyebrow and caption)", fallback: nil)
      }

      Section("Fonts") {
        let fonts = document.info?.fonts
        let choices = (fonts?.available.app ?? []).map(\.family) + (fonts?.available.bundled ?? []).map(\.family)
        Picker(
          "Body",
          selection: Binding(
            get: { document.config["brand"]?["font"]?["family"]?.string ?? "" },
            set: { f in Task { await setFont(["font": ["family": .string(f)]]) } })
        ) {
          ForEach(Array(Set(choices)).sorted(), id: \.self) { Text($0).tag($0) }
        }
        Picker(
          "Headlines",
          selection: Binding(
            get: { document.config["brand"]?["headlineFont"]?["family"]?.string ?? "" },
            set: { f in Task { await setFont(["headlineFont": f.isEmpty ? .null : ["family": .string(f)]]) } })
        ) {
          Text("Same as body").tag("")
          ForEach(Array(Set(choices)).sorted(), id: \.self) { Text($0).tag($0) }
        }
        if let missing = fonts?.missing, !missing.isEmpty {
          Label("Missing: \(missing.joined(separator: ", "))", systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
        }
        HStack {
          TextField("Google font", text: $newFont, prompt: Text("e.g. Fraunces"))
          Button("Download") { Task { await addFont() } }.disabled(newFont.isEmpty || busy)
        }
        Text("Fonts are downloaded once into store/assets/fonts; rendering never fetches them.")
          .font(.callout)
          .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
  }

  @ViewBuilder
  private func brandColor(_ key: String, _ label: String, fallback: String?) -> some View {
    let css = document.config["brand"]?[key]?.string
    HStack {
      ColorPicker(
        label,
        selection: Binding(
          get: { CSSColor.color(css ?? fallback ?? "#888888") ?? .gray },
          set: { c in
            colorSave?.cancel()
            colorSave = Task {
              try? await Task.sleep(for: .milliseconds(400))
              guard !Task.isCancelled else { return }
              await save(["brand": [key: .string(String(CSSColor.css(c).prefix(7)).uppercased())]])
            }
          }),
        supportsOpacity: false)
      if fallback == nil, css != nil {
        Button("Remove") { Task { await save(["brand": [key: .null]]) } }.buttonStyle(.link)
      }
    }
  }

  private func setTarget(_ id: String, _ on: Bool) {
    var list = configured
    if on { list.append(id) } else { list.removeAll { $0 == id } }
    // Keep the registry's order: it is the order the store shows sets in.
    let order = allTargets.map(\.id)
    list.sort { (order.firstIndex(of: $0) ?? 0) < (order.firstIndex(of: $1) ?? 0) }
    Task { await save(["targets": .array(list.map { .string($0) })]) }
  }

  private func addLocale() {
    let code = newLocale.trimmingCharacters(in: .whitespaces)
    guard !code.isEmpty, !document.locales.contains(code) else { return }
    newLocale = ""
    Task { await save(["locales": .array((document.locales + [code]).map { .string($0) })]) }
  }

  private func save(_ patch: JSONObject) async {
    busy = true
    defer { busy = false }
    do {
      try await document.putConfig("config", patch)
      await document.load()
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func setFont(_ patch: JSONObject) async {
    do {
      try await document.putConfig("fonts", patch)
      await document.load()
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func addFont() async {
    busy = true
    defer { busy = false }
    do {
      try await document.api.send("POST", document.api.project(document.name, "fonts"), body: ["family": .string(newFont)])
      newFont = ""
      await document.load()
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }
}
