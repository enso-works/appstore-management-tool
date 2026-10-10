import UniformTypeIdentifiers
import SwiftUI

/// The inspector: what was clicked on the canvas, in tabs.
struct InspectorView: View {
  @Bindable var document: ProjectDocument

  enum Tab: String, CaseIterable, Identifiable {
    case text, layout, background, layers, screen
    var id: String { rawValue }
    var title: String {
      switch self {
      case .text: "Text"
      case .layout: "Layout"
      case .background: "Background"
      case .layers: "Layers"
      case .screen: "Screen"
      }
    }
  }

  /// The tab follows the canvas selection; picking a tab selects that element.
  private var tab: Binding<Tab> {
    Binding(
      get: {
        let s = document.selected
        if s.hasPrefix("text") { return .text }
        if s.hasPrefix("layer:") || s == "layers" { return .layers }
        if s == "background" { return .background }
        if s == "screen" { return .screen }
        return .layout
      },
      set: { t in
        switch t {
        case .text: document.selected = "text:0"
        case .layout: document.selected = "phone"
        case .background: document.selected = "background"
        case .layers: document.selected = document.screen?.layers.first?["id"]?.string.map { "layer:\($0)" } ?? "layers"
        case .screen: document.selected = "screen"
        }
      })
  }

  var body: some View {
    VStack(spacing: 0) {
      if document.page != nil {
        PageInspector(document: document)
        Divider()
      }
      if document.screen != nil {
        Picker("Inspector", selection: tab) {
          ForEach(Tab.allCases) { t in Text(t.title).tag(t) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(10)
        ScrollView {
          Group {
            switch tab.wrappedValue {
            case .text: TextInspector(document: document)
            case .layout: LayoutInspector(document: document)
            case .background: BackgroundInspector(document: document)
            case .layers: LayersInspector(document: document)
            case .screen: ScreenInspector(document: document)
            }
          }
          .padding(.horizontal, 14)
          .padding(.bottom, 14)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      } else {
        ContentUnavailableView("No Screen", systemImage: "rectangle.dashed", description: Text("Add a screen in the list."))
      }
    }
  }
}

/// A titled group of controls in the inspector.
struct InspectorSection<Content: View>: View {
  let title: String
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.headline)
      content
    }
    .padding(.top, 10)
  }
}

// MARK: Text

struct TextInspector: View {
  @Bindable var document: ProjectDocument
  @State private var creating = false

  var body: some View {
    let template = document.template
    let slices = document.screen?.slices ?? 1
    VStack(alignment: .leading, spacing: 12) {
      if document.issues.contains(where: { $0.code == "content.missing-locale" }) {
        HStack {
          Label("Some languages have no text file yet", systemImage: "exclamationmark.triangle")
            .foregroundStyle(.orange)
          Spacer()
          Button("Create from \(LocaleName.of(document.defaultLocale))") {
            Task {
              creating = true
              _ = try? await document.api.send("POST", document.api.project(document.name, "bootstrap-locales"))
              await document.load()
              creating = false
            }
          }
          .disabled(creating)
          .help("Each new file starts with the default language's text, to translate")
        }
        .font(.callout)
      }
      LanguageStatusPicker(document: document)
      ForEach(0..<slices, id: \.self) { slice in
        if slices > 1 { Text("Slide \(slice + 1)").font(.headline).padding(.top, 6) }
        ForEach((template?.requiredFields ?? []) + (template?.optionalFields ?? []), id: \.self) { base in
          let field = slice == 0 ? base : "\(base)\(slice + 1)"
          CopyField(
            document: document, field: field,
            required: slice == 0 && (template?.requiredFields.contains(base) ?? false),
            highlighted: highlighted(slice: slice))
        }
      }
      if document.page != nil {
        Text("Text you edit now applies to this page only.")
          .font(.callout)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.top, 4)
  }

  /// Text clicked on the canvas marks its slide's fields; the keyboard stays with the canvas.
  private func highlighted(slice: Int) -> Bool {
    let s = document.selected
    guard s.hasPrefix("text") else { return false }
    return (Int(s.split(separator: ":").last ?? "0") ?? 0) == slice
  }
}

/// The language shown, with whether each one has this screen's copy.
struct LanguageStatusPicker: View {
  @Bindable var document: ProjectDocument

  var body: some View {
    Picker("Language", selection: $document.locale) {
      ForEach(document.locales, id: \.self) { l in
        Label(LocaleName.of(l), systemImage: icon(for: l)).tag(l)
      }
    }
    .pickerStyle(.menu)
  }

  private func icon(for l: String) -> String {
    guard let screen = document.screen, let template = document.template else { return "circle" }
    let fields = document.fields(locale: l, screen: screen.id)
    let missing = template.requiredFields.contains { (fields[$0]?.string ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
    if missing { return "exclamationmark.circle" }
    if l != document.defaultLocale {
      let ref = document.fields(locale: document.defaultLocale, screen: screen.id)
      if template.requiredFields.allSatisfy({ fields[$0] == ref[$0] }) { return "circle.dashed" }
    }
    return "checkmark.circle"
  }
}

struct CopyField: View {
  @Bindable var document: ProjectDocument
  let field: String
  let required: Bool
  var highlighted = false

  var body: some View {
    let screenId = document.screen?.id ?? ""
    let value = document.fields(locale: document.locale, screen: screenId)[field]
    let text = value?.string ?? ""
    let ref = document.locale == document.defaultLocale
      ? nil : document.fields(locale: document.defaultLocale, screen: screenId)[field]?.string
    let budget = document.preview.budgets[field]
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(FieldName.of(field) + (required ? "" : " (optional)"))
          .font(.subheadline.weight(.medium))
        Spacer()
        if let budget, budget > 0 {
          Text("\(text.count) of about \(budget)")
            .font(.caption)
            .monospacedDigit()
            .foregroundStyle(text.count > budget ? .orange : .secondary)
            .help("About \(budget) characters fit before the text shrinks")
        } else if !text.isEmpty {
          Text("\(text.count)").font(.caption).monospacedDigit().foregroundStyle(.secondary)
        }
      }
      if value == .null {
        HStack {
          Text("Left empty on purpose").foregroundStyle(.secondary)
          Spacer()
          Button("Add Text") { document.setField(field, .string("")) }
            .buttonStyle(.link)
        }
      } else {
        TextField(
          FieldName.of(field), text: Binding(get: { text }, set: { document.setField(field, .string($0)) }),
          prompt: Text(required ? "Required" : "Optional"), axis: .vertical
        )
        .lineLimit(2...5)
        .textFieldStyle(.roundedBorder)
        .labelsHidden()
        .overlay(
          RoundedRectangle(cornerRadius: 6).strokeBorder(Color.accentColor, lineWidth: highlighted ? 2 : 0)
            .allowsHitTesting(false))
      }
      HStack(spacing: 10) {
        if let ref, !ref.isEmpty {
          Text("\(LocaleName.of(document.defaultLocale)): \(ref)")
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(2)
          if text.isEmpty {
            Button("Use This") { document.setField(field, .string(ref)) }
              .buttonStyle(.link)
              .font(.caption)
          }
        }
        Spacer()
        if !required, value != .null {
          Button("Leave Empty") { document.setField(field, .null) }
            .buttonStyle(.link)
            .font(.caption)
            .help("Keep this field empty on purpose, so it is not reported as missing")
        }
      }
    }
  }
}

// MARK: Layout

/// One numeric override with a slider, its number, and the template default when unset.
struct OverrideSlider: View {
  @Bindable var document: ProjectDocument
  let key: String
  let label: String
  let range: ClosedRange<Double>
  let step: Double
  var fallback: Double = 0

  var body: some View {
    let value = document.screen?.overrides[key]?.number
    LabeledContent(label) {
      HStack {
        Slider(
          value: Binding(
            get: { value ?? fallback },
            set: { document.setOverrides([key: .number(($0 / step).rounded() * step)], coalesce: "override:\(key)") }),
          in: range
        )
        .controlSize(.small)
        TextField(
          label,
          value: Binding(
            get: { value },
            set: { v in document.setOverrides([key: v.map { .number($0) }], coalesce: "override:\(key)") }),
          format: .number.precision(.fractionLength(0...3)), prompt: Text("Auto")
        )
        .labelsHidden()
        .frame(width: 56)
        .textFieldStyle(.roundedBorder)
      }
    }
  }
}

/// A choice override; "Auto" is the template's default.
struct OverridePicker: View {
  @Bindable var document: ProjectDocument
  let key: String
  let label: String
  let options: [(String, String)]

  var body: some View {
    Picker(
      label,
      selection: Binding(
        get: { document.screen?.overrides[key]?.string ?? "" },
        set: { document.setOverrides([key: $0.isEmpty ? nil : .string($0)]) })
    ) {
      Text("Auto").tag("")
      ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
    }
  }
}

/// A colour override with the native picker; the CSS value stays editable.
struct OverrideColor: View {
  @Bindable var document: ProjectDocument
  let key: String
  let label: String
  let fallback: String

  var body: some View {
    let css = document.screen?.overrides[key]?.string
    LabeledContent(label) {
      HStack {
        ColorPicker(
          label,
          selection: Binding(
            get: { CSSColor.color(css ?? fallback) ?? .white },
            set: { document.setOverrides([key: .string(CSSColor.css($0))], coalesce: "color:\(key)") }),
          supportsOpacity: true
        )
        .labelsHidden()
        TextField(
          label, text: Binding(get: { css ?? "" }, set: { document.setOverrides([key: .string($0)], coalesce: "css:\(key)") }),
          prompt: Text("Auto"))
        .labelsHidden()
        .textFieldStyle(.roundedBorder)
        if css != nil {
          Button {
            document.setOverrides([key: nil])
          } label: {
            Image(systemName: "arrow.uturn.backward")
          }
          .buttonStyle(.borderless)
          .help("Back to the default")
        }
      }
    }
  }
}

struct LayoutInspector: View {
  @Bindable var document: ProjectDocument
  @State private var frames: [String] = []

  var body: some View {
    let keys = Set(document.template?.overrideKeys ?? [])
    let brand = document.config["brand"]
    Form {
      Picker(
        "Template",
        selection: Binding(
          get: { document.screen?.template ?? "" },
          set: { t in if let id = document.screen?.id { document.updateScreen(id, "Change Template") { $0["template"] = .string(t) } } })
      ) {
        ForEach(document.templates.filter { $0.families.contains(document.target?.family ?? "iphone") }) { t in
          Text(t.name).tag(t.id)
        }
      }

      Section("Phone") {
        if keys.contains("screenshotScale") {
          OverrideSlider(
            document: document, key: "screenshotScale", label: "Size", range: 0.3...1.8, step: 0.01,
            fallback: document.target?.family == "ipad" ? 0.72 : 0.8)
        }
        if keys.contains("screenshotOffsetX") {
          OverrideSlider(document: document, key: "screenshotOffsetX", label: "Across", range: -1...1, step: 0.005)
        }
        if keys.contains("screenshotOffsetY") {
          OverrideSlider(document: document, key: "screenshotOffsetY", label: "Down", range: -1.2...1.2, step: 0.005)
        }
        if keys.contains("deviceTilt") {
          OverrideSlider(document: document, key: "deviceTilt", label: "Tilt", range: -30...30, step: 0.5)
        }
        if keys.contains("shell") { ShellPicker(document: document, frames: frames) }
        HStack {
          Button("Center") { document.setOverrides(["screenshotOffsetX": nil]) }
          Button("Reset Phone") {
            document.setOverrides(
              ["screenshotOffsetX": nil, "screenshotOffsetY": nil, "screenshotScale": nil, "deviceTilt": nil],
              name: "Reset Phone")
          }
        }
      }

      if !keys.isDisjoint(with: ["textWidth", "textSide", "textAlign", "textColor", "accentColor", "textOffsetX"]) {
        Section("Text") {
          if keys.contains("textWidth") {
            OverrideSlider(document: document, key: "textWidth", label: "Width", range: 0.25...1, step: 0.01, fallback: 1)
          }
          if keys.contains("textSide") {
            OverridePicker(document: document, key: "textSide", label: "Side", options: [("start", "Leading"), ("end", "Trailing")])
          }
          if keys.contains("textAlign") {
            OverridePicker(
              document: document, key: "textAlign", label: "Alignment",
              options: [("start", "Leading"), ("center", "Center"), ("end", "Trailing")])
          }
          if keys.contains("textOffsetX") {
            OverrideSlider(document: document, key: "textOffsetX", label: "Across", range: -1...1, step: 0.005)
          }
          if keys.contains("textOffsetY") {
            OverrideSlider(document: document, key: "textOffsetY", label: "Down", range: -0.3...1, step: 0.005)
          }
          if keys.contains("textColor") {
            OverrideColor(
              document: document, key: "textColor", label: "Colour", fallback: brand?["onPrimary"]?.string ?? "#ffffff")
          }
          if keys.contains("accentColor") {
            OverrideColor(
              document: document, key: "accentColor", label: "Accent",
              fallback: brand?["accent"]?.string ?? brand?["onPrimary"]?.string ?? "#ffffff")
          }
          Button("Reset Text Position") {
            let slice = Int(document.selected.split(separator: ":").last ?? "0") ?? 0
            let sx = slice == 0 ? "" : "\(slice + 1)"
            document.setOverrides(["textOffsetX\(sx)": nil, "textOffsetY\(sx)": nil], name: "Reset Text Position")
          }
        }
      }

      if keys.contains("cardPosition") || keys.contains("cardColor") {
        Section("Card") {
          if keys.contains("cardPosition") {
            OverridePicker(document: document, key: "cardPosition", label: "Position", options: [("top", "Top"), ("bottom", "Bottom")])
          }
          if keys.contains("cardColor") {
            OverrideColor(document: document, key: "cardColor", label: "Colour", fallback: brand?["primary"]?.string ?? "#000000")
          }
        }
      }

      PresetsSection(document: document)
    }
    .formStyle(.grouped)
    .padding(.horizontal, -14)
    .scrollDisabled(true)
    .task { frames = await document.loadFrames() }
  }
}

/// The device around the capture: a neutral shell or an official frame, per device family.
struct ShellPicker: View {
  @Bindable var document: ProjectDocument
  let frames: [String]

  var body: some View {
    let family = document.target?.family ?? "iphone"
    let raw = document.screen?.overrides["shell"]
    let current = raw?.string ?? raw?[family]?.string ?? ""
    let device = family == "ipad" ? "iPad" : "iPhone"
    Picker(
      "Frame",
      selection: Binding(get: { current }, set: { set($0, family: family) })
    ) {
      Text("Dark (default)").tag("")
      Text("Light").tag("light")
      Text("None").tag("none")
      if !frames.isEmpty {
        Section("Device Frames") {
          ForEach(frames.sorted { ($0.contains(device) ? 0 : 1, $0) < ($1.contains(device) ? 0 : 1, $1) }, id: \.self) { f in
            Text(f.replacingOccurrences(of: "Apple ", with: "")).tag("frame:\(f)")
          }
        }
      }
      if current.hasPrefix("frame:"), !frames.contains(String(current.dropFirst(6))) {
        Text(String(current.dropFirst(6))).tag(current)
      }
    }
  }

  /// With several device families, the shell is kept per family so iPhone and iPad wear their own.
  private func set(_ value: String, family: String) {
    let families = Set(document.targets.map(\.family))
    let prev = document.screen?.overrides["shell"]
    if families.count <= 1, prev?.object == nil {
      document.setOverrides(["shell": value.isEmpty ? nil : .string(value)], name: "Change Frame")
      return
    }
    var map = prev?.object ?? JSONObject()
    if let s = prev?.string, !s.isEmpty { for f in families where f != family { map[f] = .string(s) } }
    map[family] = value.isEmpty ? nil : .string(value)
    document.setOverrides(["shell": map.isEmpty ? nil : .object(map)], name: "Change Frame")
  }
}

/// Named sets of overrides in the config: apply one, or save this screen's.
struct PresetsSection: View {
  @Bindable var document: ProjectDocument
  @State private var naming = false
  @State private var name = ""
  @State private var error: String?

  var body: some View {
    let presets = document.config["presets"]?.object ?? JSONObject()
    Section("Presets") {
      if !presets.isEmpty {
        Menu("Apply Preset") {
          ForEach(presets.keys, id: \.self) { k in
            Button(k) {
              if let id = document.screen?.id, let p = presets[k] {
                document.updateScreen(id, "Apply Preset") { $0["overrides"] = p }
              }
            }
          }
        }
      }
      Button("Save Layout as Preset...") { naming = true }
      if let error { Text(error).foregroundStyle(.red).font(.callout) }
    }
    .alert("Save Layout as Preset", isPresented: $naming) {
      TextField("Name", text: $name)
      Button("Save") { Task { await save() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This screen's layout, under a name you can apply to other screens.")
    }
  }

  private func save() async {
    guard !name.isEmpty, let overrides = document.screen?.overrides else { return }
    var presets = document.config["presets"]?.object ?? JSONObject()
    presets[name] = .object(overrides)
    do {
      try await document.putConfig("presets", JSONObject([("presets", .object(presets))]))
      await document.load()
      error = nil
      name = ""
    } catch {
      self.error = error.localizedDescription
    }
  }
}

// MARK: Screen

struct ScreenInspector: View {
  @Bindable var document: ProjectDocument
  @State private var confirmDelete = false

  var body: some View {
    if let screen = document.screen {
      Form {
        LabeledContent("Id", value: screen.id)
        Toggle(
          "On the default page",
          isOn: Binding(
            get: { screen.enabled },
            set: { on in document.updateScreen(screen.id, on ? "Show Screen" : "Hide Screen") { $0["enabled"] = .bool(on) } }))
        Toggle(
          "Shows Dark Mode",
          isOn: Binding(
            get: { screen.isDark },
            set: { on in document.updateScreen(screen.id, "Dark Mode") { $0["appearance"] = on ? "dark" : nil } }))
        .help("Readiness asks for one Dark Mode screenshot when the app has Dark Mode")
        Picker(
          "Slides",
          selection: Binding(
            get: { screen.slices },
            set: { n in document.updateScreen(screen.id, "Change Slides") { $0["panorama"] = n > 1 ? ["slices": .number(Double(n))] : nil } })
        ) {
          Text("One screenshot").tag(1)
          Text("Two, as one wide picture").tag(2)
          Text("Three, as one wide picture").tag(3)
        }
        Section("Capture") {
          TextField(
            "File",
            text: Binding(
              get: { screen.filePattern },
              set: { v in
                document.updateScreen(screen.id, "Change Capture", coalesce: "capture:\(screen.id)") {
                  var src = $0["source"]?.object ?? JSONObject()
                  src["filePattern"] = .string(v)
                  $0["source"] = .object(src)
                }
              }))
          Toggle(
            "One per language",
            isOn: Binding(
              get: { screen.localizedCaptures },
              set: { on in
                document.updateScreen(screen.id, "Change Capture") {
                  var src = $0["source"]?.object ?? JSONObject()
                  src["localized"] = .bool(on)
                  $0["source"] = .object(src)
                }
              }))
          if document.preview.sourceExists == false {
            Label("This capture is missing", systemImage: "exclamationmark.triangle").foregroundStyle(.red)
          }
          Button("Choose Capture...") {
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [.png, .jpeg]
            panel.message = "The capture for \(screen.id) on \(document.target?.label ?? "this device") in \(LocaleName.of(document.locale)). You can also drop an image on the canvas."
            guard panel.runModal() == .OK, let url = panel.url else { return }
            Task { await document.saveCapture(url, screen: screen.id) }
          }
        }
        Section("Devices") {
          DeviceToggles(document: document, screen: screen)
        }
        Section {
          Button("Duplicate Screen") { Task { await document.duplicateScreen(screen.id) } }
          Button("Delete Screen...", role: .destructive) { confirmDelete = true }
        }
      }
      .formStyle(.grouped)
      .padding(.horizontal, -14)
      .scrollDisabled(true)
      .confirmationDialog("Delete the screen \"\(screen.id)\"?", isPresented: $confirmDelete) {
        Button("Delete", role: .destructive) { document.removeScreen(screen.id) }
      } message: {
        Text("Its copy stays in the content files. You can undo this.")
      }
    }
  }
}

/// Which devices a screen renders for: all of the app's screenshot sets, or a chosen few.
struct DeviceToggles: View {
  @Bindable var document: ProjectDocument
  let screen: Screen

  var body: some View {
    let all = screen.targets == nil
    Toggle(
      "All screenshot sizes",
      isOn: Binding(
        get: { all },
        set: { on in
          document.updateScreen(screen.id, "Change Devices") {
            $0["targets"] = on ? nil : .array(document.targets.filter { !optIn($0) }.map { .string($0.id) })
          }
        }))
    if !all {
      ForEach(document.targets) { t in
        Toggle(
          t.label(among: document.targets),
          isOn: Binding(
            get: { screen.targets?.contains(t.id) ?? false },
            set: { on in
              document.updateScreen(screen.id, "Change Devices") {
                var list = screen.targets ?? []
                if on { list.append(t.id) } else { list.removeAll { $0 == t.id } }
                $0["targets"] = list.isEmpty ? nil : .array(list.map { .string($0) })
              }
            }))
      }
    } else {
      Text("Headers, search results and event images are made by screens that name them here.")
        .font(.callout)
        .foregroundStyle(.secondary)
    }
  }

  private func optIn(_ t: Target) -> Bool { ["event", "feature-graphic", "creative"].contains(t.family) }
}
