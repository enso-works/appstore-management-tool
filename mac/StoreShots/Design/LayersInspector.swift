import SwiftUI

/// Extra images and text on the screen: add, pick, position, and choose where they show.
struct LayersInspector: View {
  @Bindable var document: ProjectDocument
  @State private var assets: [String] = []

  private var layers: [JSONObject] { (document.screen?.layers ?? []).compactMap(\.object) }
  private var selectedId: String? {
    document.selected.hasPrefix("layer:") ? String(document.selected.dropFirst(6)) : nil
  }

  var body: some View {
    Form {
      Section("Elements") {
        if layers.isEmpty {
          Text("Images and extra text, placed freely on the screen.")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
        ForEach(layers, id: \.self) { l in
          let id = l["id"]?.string ?? ""
          Button {
            document.selected = "layer:\(id)"
          } label: {
            HStack {
              Image(systemName: l["type"]?.string == "text" ? "textformat" : "photo")
              Text(id)
              Spacer()
              if selectedId == id { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
        HStack {
          Menu("Add Image") {
            ForEach(assets, id: \.self) { a in Button(a) { add(image: a) } }
            if assets.isEmpty { Text("No images in store/assets yet") }
          }
          Button("Add Text") { add(text: true) }
        }
      }
      if let id = selectedId, let layer = layers.first(where: { $0["id"]?.string == id }) {
        LayerEditor(document: document, layer: layer)
      }
    }
    .formStyle(.grouped)
    .padding(.horizontal, -14)
    .scrollDisabled(true)
    .task { assets = await document.loadBackgroundAssets() }
  }

  private func nextId(_ base: String) -> String {
    var n = 1
    while layers.contains(where: { $0["id"]?.string == "\(base)-\(n)" }) { n += 1 }
    return "\(base)-\(n)"
  }

  private func add(image asset: String) {
    let id = nextId("image")
    document.editLayers("Add Image") { list in
      list.append(["type": "image", "id": .string(id), "asset": .string(asset), "x": 0.5, "y": 0.5, "width": 0.3])
    }
    document.selected = "layer:\(id)"
  }

  private func add(text: Bool) {
    let id = nextId("text")
    document.editLayers("Add Text") { list in
      list.append(["type": "text", "id": .string(id), "x": 0.5, "y": 0.5, "width": 0.5])
    }
    document.setField(id, .string("Text"))
    document.selected = "layer:\(id)"
  }
}

struct LayerEditor: View {
  @Bindable var document: ProjectDocument
  let layer: JSONObject

  private var id: String { layer["id"]?.string ?? "" }
  private var isText: Bool { layer["type"]?.string == "text" }

  var body: some View {
    Section(isText ? "Text Element" : "Image Element") {
      if isText {
        TextField(
          "Text",
          text: Binding(
            get: { document.fields(locale: document.locale, screen: document.screenId)[id]?.string ?? "" },
            set: { document.setField(id, .string($0)) }),
          axis: .vertical)
        .lineLimit(1...4)
        number("size", "Size", 0.01...0.3, step: 0.001, fallback: 0.045)
        Picker("Weight", selection: intBinding("weight", fallback: 600)) {
          ForEach([300, 400, 500, 600, 700, 800, 900], id: \.self) { Text("\($0)").tag($0) }
        }
        Picker("Alignment", selection: stringBinding("align", fallback: "center")) {
          Text("Leading").tag("start")
          Text("Center").tag("center")
          Text("Trailing").tag("end")
        }
        Picker("Font", selection: stringBinding("font", fallback: "body")) {
          Text("Body").tag("body")
          Text("Headline").tag("headline")
        }
        ColorPicker(
          "Colour",
          selection: Binding(
            get: { CSSColor.color(layer["color"]?.string ?? "#ffffff") ?? .white },
            set: { c in document.updateLayer(id, coalesce: "layer-color") { $0["color"] = .string(CSSColor.css(c)) } }))
      } else {
        LabeledContent("Image", value: layer["asset"]?.string ?? "")
      }
      number("x", "Across", -0.5...3.5, step: 0.005, fallback: 0.5)
      number("y", "Down", -0.5...3.5, step: 0.005, fallback: 0.5)
      number("width", "Width", 0.02...2, step: 0.005, fallback: isText ? 0.5 : 0.3)
      number("rotate", "Rotation", -180...180, step: 0.5, fallback: 0)
      number("opacity", "Opacity", 0.05...1, step: 0.01, fallback: 1)
    }
    Section("Shows On") {
      let targets = layer["targets"]?.array?.compactMap(\.string)
      Toggle(
        "Every device",
        isOn: Binding(
          get: { targets == nil },
          set: { all in
            document.updateLayer(id) { $0["targets"] = all ? nil : .array([.string(document.targetId)]) }
          }))
      if let targets {
        ForEach(document.targets) { t in
          Toggle(
            t.label(among: document.targets),
            isOn: Binding(
              get: { targets.contains(t.id) },
              set: { on in
                var list = targets
                if on { list.append(t.id) } else { list.removeAll { $0 == t.id } }
                document.updateLayer(id) { $0["targets"] = list.isEmpty ? nil : .array(list.map { .string($0) }) }
              }))
        }
      }
    }
    Section {
      Button("Delete Element", role: .destructive) { document.deleteLayer(id) }
    }
  }

  private func number(_ key: String, _ label: String, _ range: ClosedRange<Double>, step: Double, fallback: Double)
    -> some View
  {
    LabeledContent(label) {
      HStack {
        Slider(
          value: Binding(
            get: { layer[key]?.number ?? fallback },
            set: { v in
              document.updateLayer(id, coalesce: "layer:\(key)") { $0[key] = .number((v / step).rounded() * step) }
            }),
          in: range
        )
        .controlSize(.small)
        Text((layer[key]?.number ?? fallback).formatted(.number.precision(.fractionLength(0...3))))
          .monospacedDigit()
          .foregroundStyle(.secondary)
          .frame(width: 48, alignment: .trailing)
      }
    }
  }

  private func intBinding(_ key: String, fallback: Int) -> Binding<Int> {
    Binding(
      get: { layer[key]?.int ?? fallback },
      set: { v in document.updateLayer(id) { $0[key] = .number(Double(v)) } })
  }

  private func stringBinding(_ key: String, fallback: String) -> Binding<String> {
    Binding(
      get: { layer[key]?.string ?? fallback },
      set: { v in document.updateLayer(id) { $0[key] = .string(v) } })
  }
}
