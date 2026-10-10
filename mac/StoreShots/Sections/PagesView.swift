import SwiftUI

/// What App Store Connect has, as `GET /asc/status` reports it.
struct AscStatus: Decodable, Sendable {
  struct Version: Decodable, Sendable {
    let version: String
    let state: String?
  }
  struct Page: Decodable, Sendable {
    struct PageVersion: Decodable, Sendable {
      let state: String?
    }
    let id: String
    let name: String
    let url: String?
    let versions: [PageVersion]
    let set: String?
  }
  struct Experiment: Decodable, Sendable {
    struct Treatment: Decodable, Sendable {
      let id: String
      let name: String
      let set: String?
    }
    let id: String
    let name: String
    let state: String?
    let treatments: [Treatment]
  }
  let versions: [Version]
  let pages: [Page]
  let experiments: [Experiment]
}

/// Apple's states in plain words.
enum AscState {
  static func words(_ s: String?) -> String {
    switch s {
    case "PREPARE_FOR_SUBMISSION": "Draft"
    case "READY_FOR_REVIEW": "Ready to submit"
    case "WAITING_FOR_REVIEW": "Waiting for review"
    case "IN_REVIEW": "In review"
    case "ACCEPTED", "APPROVED": "Approved"
    case "READY_FOR_DISTRIBUTION", "READY_FOR_SALE": "Live"
    case "REJECTED", "DEVELOPER_REJECTED", "METADATA_REJECTED": "Rejected"
    case "COMPLETED", "COMPLETE": "Finished"
    case "STOPPED": "Stopped"
    case nil: "Not uploaded"
    default: s!.replacingOccurrences(of: "_", with: " ").capitalized
    }
  }
}

/// Pages: the default product page, custom pages and optimization tests.
struct PagesView: View {
  @Bindable var document: ProjectDocument
  @State private var status: AscStatus?
  @State private var statusError: String?
  @State private var newPageKind: String?

  var body: some View {
    HSplitView {
      List(selection: $document.pageId) {
        Section("Default") {
          PageRow(document: document, page: nil, state: liveState).tag("")
        }
        let custom = document.sets.filter(\.isCustom)
        Section("Custom Product Pages") {
          if custom.isEmpty { Text("None yet").foregroundStyle(.secondary) }
          ForEach(custom) { p in PageRow(document: document, page: p, state: state(of: p)).tag(p.id) }
        }
        let tests = Dictionary(grouping: document.sets.filter { !$0.isCustom }) { $0.experiment ?? "store-shots" }
        Section("Optimization Tests") {
          if tests.isEmpty { Text("None yet").foregroundStyle(.secondary) }
          ForEach(tests.keys.sorted(), id: \.self) { name in
            Text(name).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(tests[name] ?? []) { p in PageRow(document: document, page: p, state: state(of: p)).tag(p.id) }
          }
        }
      }
      .frame(minWidth: 280, idealWidth: 340, maxWidth: 440)
      PageDetail(document: document, status: status) { Task { await loadStatus() } }
        .frame(minWidth: 480)
    }
    .toolbar {
      ToolbarItemGroup {
        Button {
          newPageKind = "custom"
        } label: {
          Label("New Custom Page", systemImage: "plus.rectangle.on.rectangle")
        }
        Button {
          newPageKind = "ppo"
        } label: {
          Label("New Treatment", systemImage: "flask")
        }
        Button {
          Task { await loadStatus() }
        } label: {
          Label("Refresh App Store Connect", systemImage: "arrow.clockwise")
        }
        .help(statusError ?? "Read what App Store Connect has (read-only)")
      }
    }
    .sheet(item: $newPageKind) { kind in
      NewPageSheet(kind: kind) { name in
        if let name { document.newPage(kind: kind, name: name) }
        newPageKind = nil
      }
    }
    .task { await loadStatus() }
    .task { await document.loadAppKeywords() }
  }

  private var liveState: String? {
    status.map { s in AscState.words(s.versions.first?.state) }
  }

  private func state(of p: PageSet) -> String? {
    guard let status else { return nil }
    if p.isCustom {
      guard let page = status.pages.first(where: { $0.set == p.id }) else { return "Not uploaded" }
      return AscState.words(page.versions.last?.state)
    }
    guard let exp = status.experiments.first(where: { $0.treatments.contains { $0.set == p.id } }) else {
      return "Not uploaded"
    }
    return AscState.words(exp.state)
  }

  private func loadStatus() async {
    do {
      status = try await document.api.get(AscStatus.self, document.api.project(document.name, "asc/status"))
      statusError = nil
    } catch {
      statusError = error.localizedDescription
    }
  }
}

struct PageRow: View {
  let document: ProjectDocument
  let page: PageSet?
  let state: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Image(systemName: page == nil ? "app" : page!.isCustom ? "rectangle.stack" : "flask")
        Text(page?.name ?? "Default Page").fontWeight(.medium)
        Spacer()
        if let state {
          Text(state)
            .font(.caption)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.quaternary, in: Capsule())
        }
      }
      Text("\(screenCount) screens").font(.caption).foregroundStyle(.secondary)
    }
    .padding(.vertical, 3)
  }

  private var screenCount: Int {
    page?.screens.count ?? document.screens.filter { $0.enabled && !$0.isOptInOnly(targets: document.targets) }.count
  }
}

/// The selected page: its screens, text, keywords and App Store Connect.
struct PageDetail: View {
  @Bindable var document: ProjectDocument
  let status: AscStatus?
  var refresh: () -> Void
  @Environment(Workspace.self) private var workspace
  @State private var confirmDelete = false

  var body: some View {
    let page = document.page
    Form {
      Section {
        if let page {
          TextField(
            "Name",
            text: Binding(
              get: { page.name }, set: { v in document.patchPage(page.id, name: "Rename Page") { $0["name"] = .string(v) } }))
        } else {
          LabeledContent("Page", value: "Default product page")
        }
        PageScreensRow(document: document)
        Button("Edit Screens in Design") { workspace.open(document.name, section: .design) }
      }

      if let page, page.isCustom {
        Section("Custom Product Page") {
          TextField(
            "Deep link",
            text: Binding(
              get: { page.deepLink ?? "" },
              set: { v in document.patchPage(page.id, name: "Change Deep Link") { $0["deepLink"] = v.isEmpty ? nil : .string(v) } }),
            prompt: Text("myapp://screen"))
          if let url = status?.pages.first(where: { $0.set == page.id })?.url, let link = URL(string: url) {
            Link("Open in the App Store", destination: link)
          }
        }
        PageTextSection(document: document)
      } else if let page {
        Section("Optimization Treatment") {
          TextField(
            "Experiment",
            text: Binding(
              get: { page.experiment ?? "" },
              set: { v in document.patchPage(page.id, name: "Change Experiment") { $0["experiment"] = v.isEmpty ? nil : .string(v) } }),
            prompt: Text("store-shots"))
          TextField(
            "App icon",
            text: Binding(
              get: { page.appIconName ?? "" },
              set: { v in document.patchPage(page.id, name: "Change Icon") { $0["appIconName"] = v.isEmpty ? nil : .string(v) } }),
            prompt: Text("The app's default icon"))
          Text("Treatments in one experiment are tested together; App Store Connect runs a test only for an app that is live.")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
      }

      CreativeSummary(document: document)

      AscSection(document: document, onDone: refresh)

      if let page {
        Section {
          if page.ascId != nil {
            Button("Unlink from App Store Connect") {
              document.patchPage(page.id, name: "Unlink") { $0["ascId"] = "" }
            }
            .help("Forget its App Store Connect id, e.g. after deleting it there; the next upload matches by name")
          }
          Button("Delete Page...", role: .destructive) { confirmDelete = true }
        }
      }
    }
    .formStyle(.grouped)
    .confirmationDialog("Delete \"\(page?.name ?? "")\"?", isPresented: $confirmDelete) {
      Button("Delete", role: .destructive) { if let page { document.deletePage(page.id) } }
    } message: {
      Text("Its text in every language goes too. You can undo this. App Store Connect keeps its draft until you delete it there.")
    }
  }
}

/// The page's screens as small pictures, in its order.
struct PageScreensRow: View {
  let document: ProjectDocument

  var body: some View {
    ScrollView(.horizontal) {
      HStack(spacing: 8) {
        ForEach(document.pageScreens.filter { !$0.isOptInOnly(targets: document.targets) }) { s in
          ScreenRow(document: document, screen: s, number: nil)
            .labelsHidden()
            .frame(width: 70)
            .clipped()
        }
      }
    }
    .frame(height: 64)
  }
}

/// A custom page's promotional text and keywords in one language.
struct PageTextSection: View {
  @Bindable var document: ProjectDocument

  var body: some View {
    Section("Text in \(LocaleName.of(document.locale))") {
      Picker("Language", selection: $document.locale) {
        ForEach(document.locales, id: \.self) { Text(LocaleName.of($0)).tag($0) }
      }
      let promo = document.pageText("promotionalText")?.string ?? ""
      VStack(alignment: .leading, spacing: 4) {
        HStack {
          Text("Promotional text")
          Spacer()
          Text("\(promo.count) of 170").font(.caption).monospacedDigit().foregroundStyle(promo.count > 170 ? .red : .secondary)
        }
        TextField(
          "Promotional text",
          text: Binding(
            get: { promo }, set: { document.setPageText("promotionalText", $0.isEmpty ? nil : .string($0)) }),
          prompt: Text("Shown above the description on this page"), axis: .vertical
        )
        .lineLimit(2...4)
        .labelsHidden()
      }
      KeywordChips(document: document)
    }
  }
}

/// The keywords this page answers to, picked from the app's own keyword field.
struct KeywordChips: View {
  @Bindable var document: ProjectDocument

  var body: some View {
    let app = document.appKeywords[document.locale] ?? []
    let chosen = Set((document.pageText("keywords")?.array ?? []).compactMap { $0.string?.lowercased() })
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("Keywords")
        Spacer()
        Text("\(chosen.count) chosen").font(.caption).foregroundStyle(.secondary)
      }
      if app.isEmpty {
        Text("The app has no keywords in this language yet (Listing).").font(.callout).foregroundStyle(.secondary)
      } else {
        FlowLayout(spacing: 6) {
          ForEach(app, id: \.self) { k in
            let on = chosen.contains(k.lowercased())
            Toggle(k, isOn: Binding(get: { on }, set: { set(k, $0) }))
              .toggleStyle(.button)
              .controlSize(.small)
          }
        }
      }
    }
  }

  private func set(_ keyword: String, _ on: Bool) {
    var list = (document.pageText("keywords")?.array ?? []).compactMap(\.string)
    if on { list.append(keyword) } else { list.removeAll { $0.lowercased() == keyword.lowercased() } }
    document.setPageText("keywords", list.isEmpty ? nil : .array(list.map { .string($0) }))
  }
}

/// Header, search results and Duo for the page, from its screens.
struct CreativeSummary: View {
  let document: ProjectDocument

  /// The page's screen that renders for a target starting with one of the prefixes.
  private func screen(for prefixes: [String]) -> String? {
    let configured = Set(document.targets.map(\.id))
    return document.pageScreens.first { s in
      (s.targets ?? []).contains { t in configured.contains(t) && prefixes.contains { t.hasPrefix($0) } }
    }?.id
  }

  var body: some View {
    let header = screen(for: ["header-"]) ?? screen(for: ["universal-"])
    let search = screen(for: ["search-"]) ?? screen(for: ["universal-"])
    let duo = document.targets.first { $0.id.hasPrefix("iphone-duo-") }
    Section("Header, Search and Duo") {
      LabeledContent("Header image", value: header ?? "None")
      LabeledContent("Search results image", value: search ?? "None")
      LabeledContent("iPhone Duo", value: duo.map { $0.label } ?? "Not set up (Settings > Devices)")
      if header == nil, search == nil {
        Text("Add a screen that renders for Header, Search results or Header + search (Screen tab in Design). They show on iOS 27 and later.")
          .font(.callout)
          .foregroundStyle(.secondary)
      }
    }
  }
}

/// Check and upload: the plan first, then the upload; never a submission of the page.
struct AscSection: View {
  @Bindable var document: ProjectDocument
  var onDone: () -> Void
  @State private var plan: Reply?
  @State private var busy = false
  @State private var error: String?
  @State private var confirm = false
  @State private var submitPlan: Reply?
  @State private var confirmSubmit = false

  struct Reply: Identifiable {
    let id = UUID()
    let steps: [(action: String, what: String)]
    let applied: Bool
    var changes: Int { steps.filter { $0.action != "keep" && $0.action != "skip" }.count }
  }

  private var setId: String { document.page?.id ?? "default" }

  var body: some View {
    Section("App Store Connect") {
      HStack {
        Button(busy ? "Checking..." : "Check") { Task { await run(apply: false) } }
          .disabled(busy)
        if let plan, !plan.applied, plan.changes > 0 {
          Button("Upload Draft (\(plan.changes))") { confirm = true }
            .buttonStyle(.borderedProminent)
            .disabled(busy)
        }
        if document.page == nil {
          Button("Check Images for Review") { Task { await submit(apply: false) } }
            .disabled(busy)
            .help("The header and search images need Apple's approval before the live page can show them")
        }
        Spacer()
        if busy { ProgressView().controlSize(.small) }
      }
      Text(
        document.page == nil
          ? "Uploads the page's screenshots, Duo, header, search and previews to the version that takes edits. Text stays with fastlane."
          : "Uploads the page as a draft. Generate it first: the upload sends its rendered files. Nothing is submitted for review."
      )
      .font(.callout)
      .foregroundStyle(.secondary)
      if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
      if let plan { steps(plan) }
      if let submitPlan {
        steps(submitPlan)
        if !submitPlan.applied, submitPlan.changes > 0 {
          Button("Submit Images for Review") { confirmSubmit = true }
        }
      }
    }
    .confirmationDialog("Upload to App Store Connect as a draft?", isPresented: $confirm) {
      Button("Upload") { Task { await run(apply: true) } }
    } message: {
      Text("Nothing is submitted for review.")
    }
    .confirmationDialog("Submit these images to Apple for review?", isPresented: $confirmSubmit) {
      Button("Submit") { Task { await submit(apply: true) } }
    } message: {
      Text("Only the Asset Library images are submitted, never the app version.")
    }
    .onChange(of: document.pageId) {
      plan = nil
      submitPlan = nil
      error = nil
    }
  }

  @ViewBuilder
  private func steps(_ reply: Reply) -> some View {
    if reply.applied {
      Label("Done", systemImage: "checkmark.circle").foregroundStyle(.green)
    } else if reply.changes == 0 {
      Label("App Store Connect is up to date", systemImage: "checkmark.circle").foregroundStyle(.green)
    }
    ForEach(Array(reply.steps.enumerated()), id: \.offset) { _, s in
      HStack(alignment: .firstTextBaseline) {
        Text(Self.verb(s.action)).font(.caption).foregroundStyle(.secondary).frame(width: 60, alignment: .leading)
        Text(s.what).font(.callout)
      }
    }
  }

  private static func verb(_ action: String) -> String {
    switch action {
    case "keep": "Same"
    case "upload": "Upload"
    case "create": "Create"
    case "update": "Change"
    case "delete": "Remove"
    case "skip": "Skip"
    default: action
    }
  }

  private static func reply(_ body: JSONValue) -> Reply {
    Reply(
      steps: (body["steps"]?.array ?? []).map { ($0["action"]?.string ?? "", $0["what"]?.string ?? "") },
      applied: body["applied"]?.bool ?? false)
  }

  private func run(apply: Bool) async {
    let pushedName = document.page?.name ?? "Default page"
    busy = true
    defer { busy = false }
    await document.save()
    do {
      let body = try await document.api.send(
        "POST", document.api.project(document.name, "asc/push"), body: ["set": .string(setId), "apply": .bool(apply)])
      plan = Self.reply(body)
      error = nil
      if apply {
        // The engine stored App Store Connect's id in the manifest: load it, or the next save drops it.
        await document.load()
        onDone()
        Notifier.finished("\(document.projectTitle): uploaded", pushedName)
      }
    } catch {
      self.error = error.localizedDescription
    }
  }

  private func submit(apply: Bool) async {
    busy = true
    defer { busy = false }
    do {
      let body = try await document.api.send(
        "POST", document.api.project(document.name, "asc/submit"), body: ["page": "default", "apply": .bool(apply)])
      submitPlan = Self.reply(body)
      error = nil
    } catch {
      self.error = error.localizedDescription
    }
  }
}

/// Wraps its children into rows, like words on a line.
struct FlowLayout: Layout {
  var spacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? 400
    var x: CGFloat = 0
    var y: CGFloat = 0
    var row: CGFloat = 0
    for s in subviews {
      let size = s.sizeThatFits(.unspecified)
      if x + size.width > width, x > 0 {
        x = 0
        y += row + spacing
        row = 0
      }
      x += size.width + spacing
      row = max(row, size.height)
    }
    return CGSize(width: width, height: y + row)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX
    var y = bounds.minY
    var row: CGFloat = 0
    for s in subviews {
      let size = s.sizeThatFits(.unspecified)
      if x + size.width > bounds.maxX, x > bounds.minX {
        x = bounds.minX
        y += row + spacing
        row = 0
      }
      s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      row = max(row, size.height)
    }
  }
}
