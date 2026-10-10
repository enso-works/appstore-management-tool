import SwiftUI

/// Every app: its first screenshots, its state, and what to do next.
struct AppsOverview: View {
  let api: APIClient
  @Binding var importing: Bool
  @Environment(EditorServer.self) private var server
  @Environment(Workspace.self) private var workspace

  var body: some View {
    ScrollView {
      if server.projects.isEmpty {
        ContentUnavailableView {
          Label("No Apps Yet", systemImage: "square.grid.2x2")
        } description: {
          Text("Import an app folder to make its store screenshots here.")
        } actions: {
          Button("Import App...") { importing = true }
            .buttonStyle(.borderedProminent)
        }
        .padding(.top, 80)
      } else {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 340, maximum: 460), spacing: 20)], spacing: 20) {
          ForEach(server.projects) { p in
            AppCard(api: api, project: p)
          }
        }
        .padding(24)
      }
    }
    .navigationSubtitle("\(server.projects.count) apps")
    .toolbar {
      ToolbarItem {
        Button {
          importing = true
        } label: {
          Label("Import App", systemImage: "plus")
        }
        .help("Import an app folder (Command-O)")
      }
      ToolbarItem {
        Button {
          Task { await server.refreshProjects() }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .help("Check every app again")
      }
    }
  }
}

/// One app: the first screenshots as search shows them, readiness, and the way in.
struct AppCard: View {
  let api: APIClient
  let project: ProjectSummary
  @Environment(Workspace.self) private var workspace
  @State private var preview: CardPreview?

  struct CardPreview {
    var bodies: [(key: String, body: JSONValue, size: CGSize)]
    var readiness: ReadinessReport?
    var version: String?
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline) {
        Text(project.title).font(.title3.weight(.semibold))
        if let v = preview?.version { Text(v).foregroundStyle(.secondary) }
        Spacer()
        status
      }
      HStack(spacing: 8) {
        ForEach(preview?.bodies.prefix(3).map(\.key) ?? [], id: \.self) { key in
          ZStack {
            RoundedRectangle(cornerRadius: 8).fill(.quaternary)
            if let image = Thumbnails.shared.images[key] {
              Image(nsImage: image).resizable().aspectRatio(contentMode: .fit)
            }
          }
          .frame(height: 170)
          .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        if preview == nil {
          RoundedRectangle(cornerRadius: 8).fill(.quaternary).frame(height: 170)
        }
      }
      if let r = preview?.readiness {
        let todo = r.failing + r.warning
        if todo.isEmpty {
          Label("Ready to ship", systemImage: "checkmark.seal").foregroundStyle(.green)
        } else {
          VStack(alignment: .leading, spacing: 3) {
            ForEach(todo.prefix(3)) { c in
              Label(c.title, systemImage: c.status == "fail" ? "xmark.circle" : "exclamationmark.circle")
                .foregroundStyle(c.status == "fail" ? .red : .orange)
                .lineLimit(1)
            }
            if todo.count > 3 {
              Text("and \(todo.count - 3) more").foregroundStyle(.secondary)
            }
          }
          .font(.callout)
        }
      } else if let error = project.error {
        Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red).font(.callout)
      }
      HStack {
        Button("Open") { workspace.open(project.name) }
          .buttonStyle(.borderedProminent)
          .disabled(project.error != nil)
        Button("Ship") { workspace.open(project.name, section: .ship) }
          .disabled(project.error != nil)
        Spacer()
        Button {
          NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.root)])
        } label: {
          Image(systemName: "folder")
        }
        .buttonStyle(.borderless)
        .help("Show in Finder")
      }
    }
    .padding(16)
    .background(.background, in: RoundedRectangle(cornerRadius: 14))
    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.separator))
    .task(id: project.name) { await load() }
  }

  @ViewBuilder
  private var status: some View {
    switch project.readiness {
    case "pass": Label("Ready", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
    case "warn": Label("Check", systemImage: "exclamationmark.circle.fill").foregroundStyle(.orange)
    case "fail": Label("To fix", systemImage: "xmark.circle.fill").foregroundStyle(.red)
    default: EmptyView()
    }
  }

  /// The app's first three screens of the default page, in its first device and language.
  private func load() async {
    guard project.error == nil, let data = try? await api.getData(api.project(project.name)),
      let json = try? JSONValue.parse(data), let info = try? JSONDecoder().decode(SnapshotInfo.self, from: data)
    else { return }
    let locale = json["config"]?["defaultLocale"]?.string ?? ""
    guard let target = info.targets.first(where: { ["iphone", "ipad"].contains($0.family) }) ?? info.targets.first else { return }
    let screens = (json["manifest"]?["screens"]?.array ?? []).compactMap { $0.object.map(Screen.init) }
      .filter { $0.enabled && !$0.isOptInOnly(targets: info.targets) }
      .sorted { $0.order < $1.order }
    var bodies: [(String, JSONValue, CGSize)] = []
    for s in screens.prefix(3) {
      let fields = json["content"]?[locale]?["screens"]?[s.id]?.object ?? JSONObject()
      let body: JSONValue = [
        "targetId": .string(target.id), "locale": .string(locale), "screen": .object(s.json), "fields": .object(fields),
      ]
      var h = Hasher()
      h.combine(body)
      bodies.append(("\(project.name)/\(h.finalize())", body, CGSize(width: target.width, height: target.height)))
    }
    preview = CardPreview(
      bodies: bodies, readiness: info.readiness,
      version: json["config"]?["appVersion"]?.string)
    for b in bodies {
      Thumbnails.shared.request(key: b.0, api: api, project: project.name, body: b.1, size: b.2)
    }
  }
}
