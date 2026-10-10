import SwiftUI

/// Design: the page's screens on the left, the canvas, the inspector on the right.
struct DesignView: View {
  @Bindable var document: ProjectDocument
  @State private var canvas = CanvasController()
  @State private var canvasView = CanvasController.CanvasViewState()
  @State private var showInspector = true
  @State private var newPageKind: String?
  @State private var newPageName = ""
  @SceneStorage("design.filmstripWidth") private var filmstripWidth = 210.0

  var body: some View {
    HSplitView {
      Filmstrip(document: document)
        .frame(minWidth: 170, idealWidth: filmstripWidth, maxWidth: 320)
      ZStack(alignment: .bottom) {
        CanvasView(controller: canvas)
        CanvasStatus(document: document)
          .padding(10)
      }
      .frame(minWidth: 420)
    }
    .inspector(isPresented: $showInspector) {
      InspectorView(document: document)
        .inspectorColumnWidth(min: 280, ideal: 320, max: 440)
    }
    .toolbar { toolbar }
    .onAppear {
      canvas.onViewChange = { canvasView = $0 }
      canvas.load(document: document)
    }
    .onChange(of: syncKey) { canvas.sync() }
    .focusedSceneValue(\.canvas, canvas)
    .sheet(item: $newPageKind) { kind in
      NewPageSheet(kind: kind) { name in
        if let name { document.newPage(kind: kind, name: name) }
        newPageKind = nil
      }
    }
  }

  /// Everything the canvas shows; any change sends it again.
  private var syncKey: Int {
    var h = Hasher()
    h.combine(document.manifest)
    h.combine(document.content)
    h.combine(document.targetId)
    h.combine(document.locale)
    h.combine(document.pageId)
    h.combine(document.screenId)
    h.combine(document.mode)
    h.combine(document.storeLook)
    h.combine(document.guides)
    h.combine(document.selected)
    h.combine(document.issues)
    return h.finalize()
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .navigation) {
      PageMenu(document: document) { newPageKind = $0 }
    }
    ToolbarItemGroup(placement: .principal) {
      Picker("Device", selection: $document.targetId) {
        ForEach(document.targets) { t in
          Label(t.label(among: document.targets), systemImage: t.systemImage).tag(t.id)
        }
      }
      .pickerStyle(.menu)
      .help("Device")
      .frame(minWidth: 130)

      Picker("Language", selection: $document.locale) {
        ForEach(document.locales, id: \.self) { l in
          Text(LocaleName.of(l)).tag(l)
        }
      }
      .pickerStyle(.menu)
      .help("Language")

      Picker("View", selection: $document.mode) {
        ForEach(ProjectDocument.CanvasMode.allCases) { m in Text(m.title).tag(m) }
      }
      .pickerStyle(.segmented)
      .help("One screen, the page's screens side by side, or this screen in every language")
    }
    ToolbarItemGroup {
      ControlGroup {
        Button { canvas.command("zoomOut") } label: { Label("Zoom Out", systemImage: "minus.magnifyingglass") }
        Button { canvas.command("fit") } label: {
          Text("\(Int((canvasView.scale * 100).rounded()))%").monospacedDigit().frame(minWidth: 38)
        }
        .help("Zoom to fit")
        Button { canvas.command("zoomIn") } label: { Label("Zoom In", systemImage: "plus.magnifyingglass") }
      }
      Toggle(isOn: $document.guides) { Label("Guides", systemImage: "squareshape.split.3x3") }
        .help("Layout guides (G)")
      GenerateButton(document: document)
      Button {
        showInspector.toggle()
      } label: {
        Label("Inspector", systemImage: "sidebar.right")
      }
      .help("Show or hide the inspector")
    }
  }
}

extension String: @retroactive Identifiable {
  public var id: String { self }
}

/// The page shown: the default page, a custom product page or a treatment.
struct PageMenu: View {
  @Bindable var document: ProjectDocument
  var onNew: (String) -> Void

  var body: some View {
    Menu {
      Picker("Page", selection: $document.pageId) {
        Label("Default Page", systemImage: "app").tag("")
        let custom = document.sets.filter(\.isCustom)
        if !custom.isEmpty {
          Section("Custom Product Pages") {
            ForEach(custom) { p in Label(p.name, systemImage: "rectangle.stack").tag(p.id) }
          }
        }
        let tests = document.sets.filter { !$0.isCustom }
        if !tests.isEmpty {
          Section("Optimization Treatments") {
            ForEach(tests) { p in Label(p.name, systemImage: "flask").tag(p.id) }
          }
        }
      }
      .pickerStyle(.inline)
      Divider()
      Button("New Custom Product Page...") { onNew("custom") }
      Button("New Optimization Treatment...") { onNew("ppo") }
    } label: {
      Label(document.page?.name ?? "Default Page", systemImage: document.page == nil ? "app" : "rectangle.stack")
        .labelStyle(.titleAndIcon)
    }
    .help("The product page shown")
  }
}

struct NewPageSheet: View {
  let kind: String
  var done: (String?) -> Void
  @State private var name = ""

  var body: some View {
    Form {
      Text(kind == "custom" ? "New Custom Product Page" : "New Optimization Treatment")
        .font(.headline)
      TextField("Name", text: $name, prompt: Text(kind == "custom" ? "e.g. Runners" : "e.g. Bold first screen"))
      Text("It starts with the default page's screens; pick its own in the screen list.")
        .font(.callout)
        .foregroundStyle(.secondary)
    }
    .formStyle(.grouped)
    .frame(width: 420)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { done(nil) } }
      ToolbarItem(placement: .confirmationAction) {
        Button("Create") { done(name.trimmingCharacters(in: .whitespaces)) }
          .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
      }
    }
  }
}

/// Generate with progress; the menu has the narrower runs.
struct GenerateButton: View {
  let document: ProjectDocument

  var body: some View {
    if let g = document.generation, g.running {
      HStack(spacing: 6) {
        ProgressView(value: Double(g.done), total: Double(max(g.total, 1)))
          .frame(width: 80)
        Text("\(g.done)/\(g.total)").monospacedDigit().foregroundStyle(.secondary)
      }
      .help("Generating")
    } else {
      Menu {
        Button("Generate This Screen") { Task { await document.generate(.screen) } }
          .disabled(document.screen == nil)
        Button(document.page == nil ? "Generate Everything" : "Generate This Page") {
          Task { await document.generate(.all) }
        }
      } label: {
        Label("Generate", systemImage: "square.and.arrow.down.on.square")
      } primaryAction: {
        Task { await document.generate(.all) }
      }
      .help(document.page == nil ? "Render every screenshot (Command-G)" : "Render this page (Command-G)")
    }
  }
}

/// Under the canvas: rendering, problems in the shown screen, the last run.
struct CanvasStatus: View {
  let document: ProjectDocument

  var body: some View {
    let messages = self.messages
    if !messages.isEmpty {
      HStack(spacing: 10) {
        ForEach(messages, id: \.text) { m in
          Label(m.text, systemImage: m.icon)
            .foregroundStyle(m.color)
            .lineLimit(1)
        }
      }
      .font(.callout)
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .background(.regularMaterial, in: Capsule())
    }
  }

  private struct Message {
    let text: String
    let icon: String
    let color: Color
  }

  private var messages: [Message] {
    var out: [Message] = []
    let p = document.preview
    if document.mode == .single {
      if p.loading { out.append(Message(text: "Rendering", icon: "hourglass", color: .secondary)) }
      if let e = p.error { out.append(Message(text: e, icon: "xmark.octagon", color: .red)) }
      if p.sourceExists == false {
        out.append(Message(text: "Capture missing", icon: "photo.badge.exclamationmark", color: .red))
      }
      for o in p.checks?.overflow ?? [] {
        out.append(Message(text: "\(FieldName.of(o.id)) does not fit", icon: "text.badge.xmark", color: .red))
      }
      for f in p.fits where f.scale < 1 && f.fits {
        out.append(
          Message(text: "\(FieldName.of(f.id)) shrunk to \(Int(f.scale * 100))%", icon: "textformat.size", color: .orange))
      }
    }
    if let g = document.generation, !g.running {
      if let e = g.error {
        out.append(Message(text: e, icon: "xmark.octagon", color: .red))
      } else {
        out.append(
          Message(
            text: "Generated \(g.rendered), unchanged \(g.unchanged)\(g.failed > 0 ? ", failed \(g.failed)" : "")",
            icon: g.failed > 0 ? "exclamationmark.triangle" : "checkmark.circle", color: g.failed > 0 ? .orange : .secondary))
      }
    }
    if case .failed(let e) = document.saveStatus {
      out.append(Message(text: "Not saved: \(e)", icon: "exclamationmark.triangle", color: .red))
    }
    return out
  }
}
