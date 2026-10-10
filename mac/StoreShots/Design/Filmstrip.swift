import SwiftUI

/// The shown page's screens as thumbnails: drag to reorder, right-click for more.
struct Filmstrip: View {
  @Bindable var document: ProjectDocument
  @State private var adding = false
  @State private var newId = ""
  @State private var confirmDelete: String?

  var body: some View {
    let opted = document.pageScreens.filter { $0.isOptInOnly(targets: document.targets) }
    let shots = document.pageScreens.filter { !$0.isOptInOnly(targets: document.targets) }
    let off = document.screens.filter { s in !document.pageScreens.contains { $0.id == s.id } }
    List(selection: selection) {
      Section(document.page == nil ? "Screens" : "On This Page") {
        ForEach(Array(shots.enumerated()), id: \.element.id) { i, s in
          row(s, number: document.page == nil ? s.order : i + 1)
        }
        .onMove { from, to in move(shots: shots, from: from, to: to) }
      }
      if !opted.isEmpty {
        Section("Header, Search and Events") {
          ForEach(opted) { s in row(s, number: nil) }
        }
      }
      if !off.isEmpty {
        Section(document.page == nil ? "Off the Default Page" : "Not on This Page") {
          ForEach(off) { s in
            HStack {
              Text(s.id).foregroundStyle(.secondary)
              Spacer()
              if document.page != nil {
                Button {
                  document.setOnPage(s.id, true)
                } label: {
                  Image(systemName: "plus.circle")
                }
                .buttonStyle(.borderless)
                .help("Add to this page")
              }
            }
            .tag(s.id)
            .contextMenu { menu(for: s) }
          }
        }
      }
    }
    .listStyle(.sidebar)
    .safeAreaInset(edge: .bottom) {
      HStack {
        Button {
          adding = true
        } label: {
          Label("Add Screen", systemImage: "plus")
        }
        .buttonStyle(.borderless)
        .popover(isPresented: $adding, arrowEdge: .top) {
          HStack {
            TextField("Screen id", text: $newId, prompt: Text("e.g. settings"))
              .frame(width: 180)
              .onSubmit(add)
            Button("Add", action: add)
              .keyboardShortcut(.defaultAction)
          }
          .padding()
        }
        Spacer()
      }
      .padding(10)
    }
    .confirmationDialog(
      "Delete the screen \"\(confirmDelete ?? "")\"?", isPresented: .constant(confirmDelete != nil), presenting: confirmDelete
    ) { id in
      Button("Delete", role: .destructive) {
        document.removeScreen(id)
        confirmDelete = nil
      }
      Button("Cancel", role: .cancel) { confirmDelete = nil }
    } message: { _ in
      Text("Its copy stays in the content files. You can undo this.")
    }
  }

  private var selection: Binding<String?> {
    Binding(
      get: { document.screenId },
      set: { id in
        if let id {
          document.screenId = id
          if document.mode == .locales { return }
        }
      })
  }

  private func add() {
    if document.addScreen(id: newId) {
      newId = ""
      adding = false
    }
  }

  private func move(shots: [Screen], from: IndexSet, to: Int) {
    document.moveScreens(from: from, to: to)
  }

  @ViewBuilder
  private func row(_ s: Screen, number: Int?) -> some View {
    ScreenRow(document: document, screen: s, number: number)
      .tag(s.id)
      .contextMenu { menu(for: s) }
  }

  @ViewBuilder
  private func menu(for s: Screen) -> some View {
    Button("Show Alone") {
      document.screenId = s.id
      document.mode = .single
    }
    Divider()
    if let page = document.page {
      if page.screens.contains(s.id) {
        Button("Remove from This Page") { document.setOnPage(s.id, false) }
          .disabled(page.screens.count < 2)
      } else {
        Button("Add to This Page") { document.setOnPage(s.id, true) }
      }
    } else {
      Toggle(
        "On the Default Page",
        isOn: Binding(
          get: { s.enabled },
          set: { on in document.updateScreen(s.id, on ? "Show Screen" : "Hide Screen") { $0["enabled"] = .bool(on) } })
      )
    }
    Button("Duplicate...") { Task { await document.duplicateScreen(s.id) } }
    Divider()
    Button("Delete Screen...", role: .destructive) { confirmDelete = s.id }
  }
}

struct ScreenRow: View {
  let document: ProjectDocument
  let screen: Screen
  let number: Int?

  var body: some View {
    HStack(spacing: 8) {
      thumbnail
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 4) {
          if let number {
            Text(String(format: "%02d", number)).monospacedDigit().foregroundStyle(.secondary)
          }
          Text(screen.id).lineLimit(1)
        }
        if screen.slices > 1 {
          Text("\(screen.slices) slides").font(.caption).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      status
    }
    .padding(.vertical, 2)
  }

  @ViewBuilder
  private var status: some View {
    let found = document.issues(for: screen)
    if let e = found.first(where: \.isError) {
      Image(systemName: "xmark.circle.fill").foregroundStyle(.red).help(e.message)
    } else if let w = found.first(where: \.isWarning) {
      Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange).help(w.message)
    }
  }

  private var thumbnail: some View {
    let t = document.device(for: screen)
    let aspect = t.map { CGFloat($0.width * screen.slices) / CGFloat($0.height) } ?? 0.46
    let key = thumbnailKey
    let height: CGFloat = 54
    return ZStack {
      RoundedRectangle(cornerRadius: 4).fill(.quaternary)
      if let key, let image = Thumbnails.shared.images[key] {
        Image(nsImage: image).resizable().aspectRatio(contentMode: .fill)
      }
    }
    .frame(width: min(height * aspect, 110), height: height)
    .clipShape(RoundedRectangle(cornerRadius: 4))
    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(.separator))
    .task(id: key) { requestThumbnail() }
  }

  private var body_: JSONValue? {
    guard let t = document.device(for: screen) else { return nil }
    let fields = document.fields(locale: document.locale, screen: screen.id)
    var b = JSONObject()
    b["targetId"] = .string(t.id)
    b["locale"] = .string(document.locale)
    b["screen"] = .object(screen.json)
    b["fields"] = .object(fields)
    if let dir = document.content[document.locale]?["direction"] { b["direction"] = dir }
    return .object(b)
  }

  private var thumbnailKey: String? {
    guard let body = body_ else { return nil }
    var h = Hasher()
    h.combine(body)
    // Brand colours, fonts and the default background change the picture too.
    h.combine(document.config["brand"])
    return "\(document.name)/\(h.finalize())"
  }

  private func requestThumbnail() {
    guard let key = thumbnailKey, let body = body_, let t = document.device(for: screen) else { return }
    Thumbnails.shared.request(
      key: key, api: document.api, project: document.name, body: body,
      size: CGSize(width: t.width * screen.slices, height: t.height))
  }
}
