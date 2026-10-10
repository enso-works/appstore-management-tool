import QuickLook
import SwiftUI

/// The release review (`GET /release`): every generated file per device and language.
struct ReleaseStatus: Decodable, Sendable {
  struct Shot: Decodable, Hashable, Sendable {
    let rel: String
    let kind: String?
    let screen: String
    let slice: Int
    let state: String
    let reason: String?
  }
  struct Set: Decodable, Sendable {
    let target: String
    let locale: String
    let shots: [Shot]
    let ok: Int
    let stale: Int
    let missing: Int
    let blocked: Int
  }
  struct Signoff: Decodable, Sendable {
    let at: String
  }
  let appVersion: String?
  let generatedAt: String?
  let sets: [Set]
  let signoffs: [String: Signoff]
  let signoffsStale: Bool?
}

/// Ship: what still blocks a release, a look at every file, and the uploads.
struct ShipView: View {
  @Bindable var document: ProjectDocument
  @Environment(Workspace.self) private var workspace
  @State private var release: ReleaseStatus?
  @State private var tab = "checks"

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider()
      Group {
        switch tab {
        case "review": ReviewGrid(document: document, release: release) { await loadRelease() }
        case "upload": UploadPanel(document: document)
        default: ChecksList(document: document)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .toolbar {
      ToolbarItem(placement: .principal) {
        Picker("Ship", selection: $tab) {
          Text("Checks").tag("checks")
          Text("Review").tag("review")
          Text("Upload").tag("upload")
        }
        .pickerStyle(.segmented)
      }
      ToolbarItem {
        GenerateButton(document: document)
      }
      ToolbarItem {
        Button {
          Task {
            await document.refreshReadiness()
            await loadRelease()
          }
        } label: {
          Label("Check Again", systemImage: "arrow.clockwise")
        }
      }
    }
    .task { await loadRelease() }
    .onChange(of: document.generation?.running) { _, running in
      if running == false { Task { await loadRelease() } }
    }
  }

  private var header: some View {
    let r = document.readiness
    let failing = r?.failing.count ?? 0
    let warning = r?.warning.count ?? 0
    return HStack(spacing: 14) {
      Image(systemName: failing > 0 ? "xmark.seal.fill" : warning > 0 ? "exclamationmark.triangle.fill" : "checkmark.seal.fill")
        .font(.system(size: 30))
        .foregroundStyle(failing > 0 ? .red : warning > 0 ? .orange : .green)
      VStack(alignment: .leading, spacing: 2) {
        Text(failing > 0 ? "Not ready to ship" : warning > 0 ? "Ready, with things to look at" : "Ready to ship")
          .font(.title2.weight(.semibold))
        Text(subtitle).foregroundStyle(.secondary)
      }
      Spacer()
    }
    .padding(18)
  }

  private var subtitle: String {
    var parts: [String] = []
    if let v = release?.appVersion { parts.append("Version \(v)") }
    let r = document.readiness
    if let r { parts.append("\(r.failing.count) to fix, \(r.warning.count) to look at") }
    if let sets = release?.sets {
      let missing = sets.reduce(0) { $0 + $1.missing + $1.stale }
      if missing > 0 { parts.append("\(missing) screenshots to generate") }
    }
    return parts.joined(separator: " · ")
  }

  private func loadRelease() async {
    if let body = try? await document.api.get(document.api.project(document.name, "release")) {
      release = try? JSONDecoder().decode(ReleaseStatus.self, from: (body["release"] ?? .null).data)
    }
  }
}

// MARK: Checks

struct ChecksList: View {
  let document: ProjectDocument
  @Environment(Workspace.self) private var workspace
  @State private var showFine = false

  var body: some View {
    let checks = document.readiness?.checks ?? []
    List {
      section("Must Fix", checks.filter { $0.status == "fail" }, icon: "xmark.circle.fill", color: .red)
      section("Should Look At", checks.filter { $0.status == "warn" }, icon: "exclamationmark.triangle.fill", color: .orange)
      Section {
        DisclosureGroup("Fine (\(checks.filter { $0.status == "pass" || $0.status == "skip" }.count))", isExpanded: $showFine) {
          ForEach(checks.filter { $0.status == "pass" || $0.status == "skip" }) { c in
            Label(c.title, systemImage: c.status == "pass" ? "checkmark.circle.fill" : "minus.circle")
              .foregroundStyle(c.status == "pass" ? .green : .secondary)
          }
        }
      }
    }
  }

  @ViewBuilder
  private func section(_ title: String, _ checks: [ReadinessCheck], icon: String, color: Color) -> some View {
    if !checks.isEmpty {
      Section(title) {
        ForEach(checks) { c in
          HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).foregroundStyle(color)
            VStack(alignment: .leading, spacing: 4) {
              Text(c.title).font(.headline)
              ForEach(c.details, id: \.self) { d in
                Text(d).foregroundStyle(.secondary).textSelection(.enabled)
              }
              if let hint = c.hint { Text(hint).font(.callout).foregroundStyle(.tertiary) }
            }
            Spacer()
            fix(for: c)
          }
          .padding(.vertical, 4)
        }
      }
    }
  }

  /// The way to the fix, where the tool has one.
  @ViewBuilder
  private func fix(for c: ReadinessCheck) -> some View {
    switch c.id {
    case "screenshots", "screenshot-consistency":
      Button("Generate") { Task { await document.generate(.all) } }
    case "metadata-locales", "metadata-limits", "metadata-keywords", "placeholders":
      Button("Open Listing") { workspace.open(document.name, section: .listing) }
    case "dark-mode":
      Button("Open Design") { workspace.open(document.name, section: .design) }
    case "required-sizes":
      Button("Devices") { workspace.open(document.name, section: .settings) }
    case "creative-assets":
      Button("Open Pages") { workspace.open(document.name, section: .pages) }
    case "icon", "icon-variants", "credentials", "version", "app-previews":
      Button("Show App in Finder") {
        if let root = document.info?.root { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: root)]) }
      }
    default:
      EmptyView()
    }
  }
}

// MARK: Review

struct ReviewGrid: View {
  let document: ProjectDocument
  let release: ReleaseStatus?
  var reload: () async -> Void
  @State private var quickLook: URL?

  var body: some View {
    if let release {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 24) {
          ForEach(document.locales, id: \.self) { locale in
            localeSection(locale, release: release)
          }
        }
        .padding(20)
      }
      .quickLookPreview($quickLook)
    } else {
      ProgressView()
    }
  }

  @ViewBuilder
  private func localeSection(_ locale: String, release: ReleaseStatus) -> some View {
    let sets = release.sets.filter { $0.locale == locale }
    let reviewed = release.signoffs[locale] != nil && release.signoffsStale != true
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text(LocaleName.of(locale)).font(.title3.weight(.semibold))
        Spacer()
        Toggle(
          "Reviewed",
          isOn: Binding(
            get: { reviewed },
            set: { on in
              Task {
                _ = try? await document.api.send(
                  "POST", document.api.project(document.name, "release"),
                  body: ["locale": .string(locale), "reviewed": .bool(on)])
                await reload()
              }
            }))
        .toggleStyle(.checkbox)
      }
      ForEach(sets, id: \.target) { set in
        let target = document.targets.first { $0.id == set.target }
        VStack(alignment: .leading, spacing: 6) {
          HStack {
            Text(target?.label(among: document.targets) ?? set.target).foregroundStyle(.secondary)
            if set.missing + set.stale + set.blocked > 0 {
              Text("\(set.missing + set.stale) to generate\(set.blocked > 0 ? ", \(set.blocked) blocked" : "")")
                .font(.caption)
                .foregroundStyle(.orange)
              Button("Generate") { Task { await document.generate(.all) } }
                .controlSize(.small)
            }
          }
          ScrollView(.horizontal) {
            HStack(spacing: 8) {
              ForEach(set.shots, id: \.self) { shot in
                ShotThumb(url: fileURL(shot), shot: shot, aspect: target.map { CGFloat($0.width) / CGFloat($0.height) } ?? 0.46)
                  .onTapGesture { quickLook = fileURL(shot) }
              }
            }
          }
        }
      }
    }
  }

  /// The file on disk: deliver's folder for screenshots, the generated folder for the rest.
  private func fileURL(_ shot: ReleaseStatus.Shot) -> URL? {
    guard let root = document.info?.root else { return nil }
    let paths = document.config["paths"]
    let base = shot.kind == "generated"
      ? paths?["generated"]?.string ?? "store/generated" : paths?["outputScreenshots"]?.string ?? "fastlane/screenshots"
    return URL(fileURLWithPath: root).appending(path: base).appending(path: shot.rel)
  }
}

struct ShotThumb: View {
  let url: URL?
  let shot: ReleaseStatus.Shot
  let aspect: CGFloat
  @State private var image: NSImage?

  var body: some View {
    ZStack(alignment: .bottomLeading) {
      RoundedRectangle(cornerRadius: 6).fill(.quaternary)
      if let image, shot.state != "missing", shot.state != "blocked" {
        Image(nsImage: image).resizable().aspectRatio(contentMode: .fit)
      } else {
        Text(shot.screen).font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      if shot.state != "ok" {
        Text(shot.state == "stale" ? "Old" : shot.state == "blocked" ? "Blocked" : "Missing")
          .font(.caption2.weight(.semibold))
          .padding(.horizontal, 5)
          .padding(.vertical, 2)
          .background(shot.state == "stale" ? Color.orange : Color.red, in: Capsule())
          .foregroundStyle(.white)
          .padding(5)
          .help(shot.reason ?? "")
      }
    }
    .frame(width: aspect < 1 ? 180 * aspect : 260, height: aspect < 1 ? 180 : 260 / aspect)
    .clipShape(RoundedRectangle(cornerRadius: 6))
    .task(id: url) {
      guard let url else { return }
      image = await Task.detached { NSImage(contentsOf: url) }.value
    }
  }
}

// MARK: Upload

/// fastlane's lanes, each with what it sends and why it is blocked.
struct UploadPanel: View {
  let document: ProjectDocument
  @Environment(Workspace.self) private var workspace
  @State private var lanes: [String: Lane] = [:]
  @State private var running: String?
  @State private var log: [String] = []
  @State private var override = ""
  @State private var confirm: String?

  struct Lane {
    let command: String
    let uploads: Bool
    let blocked: Bool
    let reasons: [String]
  }

  private static let names: [String: (String, String)] = [
    "validate": ("Check the Listing", "fastlane checks the text against Apple's rules; nothing is uploaded"),
    "metadata": ("Upload the Listing", "The text in every language, to the version that takes edits"),
    "screenshots": ("Upload Screenshots", "The default page's screenshots, replacing what App Store Connect has"),
  ]

  var body: some View {
    Form {
      Section("fastlane") {
        ForEach(["validate", "metadata", "screenshots"], id: \.self) { key in
          let lane = lanes[key]
          HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
              Text(Self.names[key]!.0).font(.headline)
              Text(Self.names[key]!.1).font(.callout).foregroundStyle(.secondary)
              if let lane, lane.blocked {
                ForEach(lane.reasons, id: \.self) { Label($0, systemImage: "hand.raised").font(.callout).foregroundStyle(.orange) }
              }
            }
            Spacer()
            Button(running == key ? "Running..." : "Run") {
              if lane?.uploads == true { confirm = key } else { Task { await run(key) } }
            }
            .disabled(running != nil || (lane?.blocked == true && override.isEmpty))
          }
        }
        if lanes.values.contains(where: \.blocked) {
          TextField("Reason to upload anyway", text: $override, prompt: Text("Only to upload despite the checks"))
        }
      }
      Section("App Store Connect") {
        Text("Custom product pages, tests, header and search images, iPhone Duo and app previews upload from Pages.")
          .font(.callout)
          .foregroundStyle(.secondary)
        Button("Open Pages") { workspace.open(document.name, section: .pages) }
      }
      if !log.isEmpty {
        Section("Output") {
          ScrollView {
            Text(log.joined(separator: "\n"))
              .font(.system(size: 11, design: .monospaced))
              .textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .frame(minHeight: 160, maxHeight: 360)
        }
      }
    }
    .formStyle(.grouped)
    .task { await preflight() }
    .confirmationDialog("Upload to App Store Connect?", isPresented: .constant(confirm != nil), presenting: confirm) { key in
      Button(Self.names[key]!.0) {
        confirm = nil
        Task { await run(key) }
      }
      Button("Cancel", role: .cancel) { confirm = nil }
    } message: { _ in
      Text("This changes what App Store Connect has for the version. Nothing is submitted for review.")
    }
  }

  private func preflight() async {
    for key in ["validate", "metadata", "screenshots"] {
      guard let body = try? await document.api.get(document.api.project(document.name, "lane"), query: ["key": key]) else { continue }
      lanes[key] = Lane(
        command: body["command"]?.string ?? "", uploads: body["uploads"]?.bool ?? false,
        blocked: body["blocked"]?.bool ?? false, reasons: body["reasons"]?.array?.compactMap(\.string) ?? [])
    }
  }

  private func run(_ key: String) async {
    running = key
    log = ["$ \(lanes[key]?.command ?? key)"]
    defer { running = nil }
    var body = JSONObject([("key", .string(key)), ("confirmed", true)])
    if !override.isEmpty { body["overrideReason"] = .string(override) }
    do {
      for try await v in document.api.lines(document.api.project(document.name, "lane"), body: .object(body)) {
        if let l = v["line"]?.string { log.append(l) }
        if v["done"]?.bool == true { log.append("Finished with exit code \(v["exitCode"]?.int ?? -1)") }
        if let e = v["error"]?.string { log.append("Error: \(e)") }
      }
    } catch {
      log.append("Error: \(error.localizedDescription)")
    }
    await document.refreshReadiness()
  }
}
