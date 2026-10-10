import SwiftUI
import UniformTypeIdentifiers

/// The screen's background: a colour, a gradient or any CSS, with an image or pattern on top.
struct BackgroundInspector: View {
  @Bindable var document: ProjectDocument
  @State private var assets: [String] = []
  @State private var message: String?

  enum Fill: String, CaseIterable, Identifiable {
    case standard, color, gradient, custom
    var id: String { rawValue }
    var title: String {
      switch self {
      case .standard: "App Default"
      case .color: "Colour"
      case .gradient: "Gradient"
      case .custom: "CSS"
      }
    }
  }

  private var css: String? { document.screen?.overrides["background"]?.string }

  private var fill: Fill {
    guard let css, !css.isEmpty else { return .standard }
    if CSSColor.nsColor(css) != nil { return .color }
    if SimpleGradient(css: css) != nil { return .gradient }
    return .custom
  }

  private var brandPrimary: String { document.config["brand"]?["primary"]?.string ?? "#333333" }

  var body: some View {
    Form {
      Section("Fill") {
        Picker(
          "Fill",
          selection: Binding(get: { fill }, set: { setFill($0) })
        ) {
          ForEach(Fill.allCases) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        switch fill {
        case .standard:
          Text("The app's default background (Settings, or the brand colour).")
            .font(.callout)
            .foregroundStyle(.secondary)
        case .color:
          ColorPicker(
            "Colour",
            selection: Binding(
              get: { CSSColor.color(css ?? brandPrimary) ?? .black },
              set: { set("background", .string(CSSColor.css($0)), coalesce: "bg-color") }))
        case .gradient:
          let g = SimpleGradient(css: css ?? "") ?? SimpleGradient(angle: 165, from: brandPrimary, to: "#000000")
          ColorPicker(
            "From",
            selection: Binding(
              get: { CSSColor.color(g.from) ?? .black },
              set: { var n = g; n.from = CSSColor.css($0); set("background", .string(n.css), coalesce: "bg-from") }))
          ColorPicker(
            "To",
            selection: Binding(
              get: { CSSColor.color(g.to) ?? .black },
              set: { var n = g; n.to = CSSColor.css($0); set("background", .string(n.css), coalesce: "bg-to") }))
          LabeledContent("Angle") {
            Slider(
              value: Binding(
                get: { g.angle },
                set: { var n = g; n.angle = $0.rounded(); set("background", .string(n.css), coalesce: "bg-angle") }),
              in: 0...360)
          }
        case .custom:
          TextField(
            "CSS",
            text: Binding(get: { css ?? "" }, set: { set("background", .string($0), coalesce: "bg-css") }),
            axis: .vertical)
          .font(.callout.monospaced())
          .lineLimit(2...6)
        }
      }

      Section("On Top") {
        let image = document.screen?.overrides["backgroundImage"]?.string ?? ""
        Picker(
          "Image",
          selection: Binding(get: { image }, set: { set("backgroundImage", $0.isEmpty ? nil : .string($0)) })
        ) {
          Text("App default").tag("")
          Text("Nothing").tag("none")
          Section("Patterns") {
            Text("Waves").tag("pattern:waves")
            Text("Dots").tag("pattern:dots")
            Text("Grid").tag("pattern:grid")
          }
          if !assets.isEmpty {
            Section("Images") {
              ForEach(assets, id: \.self) { a in Text(a).tag("asset:\(a)") }
            }
          }
          if image.hasPrefix("asset:"), !assets.contains(String(image.dropFirst(6))) {
            Text(String(image.dropFirst(6))).tag(image)
          }
        }
        if image.hasPrefix("pattern:") {
          OverrideColor(document: document, key: "patternColor", label: "Pattern colour", fallback: "rgba(255,255,255,0.08)")
        }
        Button("Add Image...") { addImage() }
      }

      Section {
        Button("Use for Every Screen") { Task { await useEverywhere() } }
          .help("Make this the app's default background, used by every screen without its own")
        Button("Clear Every Screen's Own Background") { document.clearBackgroundsEverywhere() }
          .help("Every screen then shows the app's default")
        if let message { Text(message).font(.callout).foregroundStyle(.secondary) }
      }
    }
    .formStyle(.grouped)
    .padding(.horizontal, -14)
    .scrollDisabled(true)
    .task { assets = await document.loadBackgroundAssets() }
  }

  private func set(_ key: String, _ value: JSONValue?, coalesce: String? = nil) {
    document.setOverrides([key: value], name: "Change Background", coalesce: coalesce)
  }

  private func setFill(_ f: Fill) {
    switch f {
    case .standard: set("background", nil)
    case .color: set("background", .string(brandPrimary))
    case .gradient: set("background", .string(SimpleGradient(angle: 165, from: brandPrimary, to: "#000000").css))
    case .custom: set("background", .string(css ?? brandPrimary))
    }
  }

  private func useEverywhere() async {
    let o = document.screen?.overrides ?? JSONObject()
    var values = JSONObject()
    for k in ["background", "backgroundImage", "patternColor", "patternScale"] { values[k] = o[k] }
    do {
      try await document.putConfig("brand-background", JSONObject([("values", values.isEmpty ? .null : .object(values))]))
      await document.load()
      message = "Every screen without its own background now uses this one."
    } catch {
      message = error.localizedDescription
    }
  }

  private func addImage() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.png, .jpeg, .webP]
    panel.message = "Choose a background image; it is copied into the app's store/assets/backgrounds."
    guard panel.runModal() == .OK, let url = panel.url, let data = try? Data(contentsOf: url) else { return }
    Task {
      do {
        let answer = try await document.api.send(
          "POST", document.api.project(document.name, "assets"),
          body: ["fileName": .string(url.lastPathComponent), "dataBase64": .string(data.base64EncodedString())])
        assets = await document.loadBackgroundAssets(refresh: true)
        if let rel = answer["asset"]?["rel"]?.string { set("backgroundImage", .string("asset:\(rel)")) }
      } catch {
        message = error.localizedDescription
      }
    }
  }
}
