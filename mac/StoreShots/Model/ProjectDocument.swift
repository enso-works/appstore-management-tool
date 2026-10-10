import Foundation
import Observation

/// One app open in the window: the engine's snapshot, the drafts being edited
/// (manifest and copy per locale, as ordered JSON), what is shown, and saving.
///
/// Every edit goes through `edit(_:)`, which records one undo step and marks
/// the documents dirty; an autosave follows a moment after the last edit. As in
/// the web editor, a save marks clean only what it sent, so an edit made while
/// it runs is saved by the next one.
@MainActor
@Observable
final class ProjectDocument {
  let name: String
  /// Replaced when the engine comes back on another port; the drafts stay.
  var api: APIClient

  // MARK: Engine state (read-only here)
  private(set) var info: SnapshotInfo?
  private(set) var config: JSONValue = .null
  private(set) var loadError: String?
  private(set) var issues: [Issue] = []
  private(set) var readiness: ReadinessReport?
  private(set) var etags: (manifest: String, content: [String: String], config: String) = ("", [:], "")

  // MARK: Drafts
  private(set) var manifest: JSONValue = ["screens": []]
  private(set) var content: [String: JSONValue] = [:]

  // MARK: What is shown
  var targetId = ""
  var locale = ""
  /// "" is the default page; otherwise a named set.
  var pageId = ""
  var screenId = "" {
    didSet { if screenId != oldValue { followScreenDevice() } }
  }
  var mode: CanvasMode = .single
  /// "phone", "background", "text:<slice>" or "layer:<id>".
  var selected = "phone"
  var storeLook = false
  var guides = false
  /// The storefront whose live listing shows under the strip (nil: not shown).
  var liveCountry: String?
  /// The live listing's version, or why it is not there.
  var liveStatus: String?

  /// Per screen, bumped when its capture changes on disk: its previews and thumbnail render again.
  private(set) var captureRevisions: [String: Int] = [:]
  /// What happened to the last dropped capture, for the canvas status line.
  var captureMessage: String?
  /// A capture waiting for the user to confirm replacing a file other frames read too.
  var pendingCapture: PendingCapture?

  struct PendingCapture: Identifiable {
    let id = UUID()
    let data: Data
    let screenId: String
    let path: String
    /// Why it needs a yes, in the engine's words.
    let reason: String
  }

  // MARK: The selected preview, as the canvas reports it
  var preview = PreviewState()

  // MARK: Saving and generating
  private(set) var saveStatus: SaveStatus = .saved
  private(set) var generation: GenerationState?
  /// The app keywords per locale (fastlane metadata), for custom pages.
  private(set) var appKeywords: [String: [String]] = [:]

  /// Set by the window so edits land in its Edit menu.
  var undoManager: UndoManager?

  enum CanvasMode: String, CaseIterable, Identifiable {
    case single, strip, locales
    var id: String { rawValue }
    var title: String {
      switch self {
      case .single: "One"
      case .strip: "Strip"
      case .locales: "All Languages"
      }
    }
  }

  enum SaveStatus: Equatable {
    case saved, unsaved, saving
    case failed(String)
  }

  struct PreviewState: Equatable {
    var loading = false
    var error: String?
    var sourceExists: Bool?
    var budgets: [String: Int] = [:]
    var checks: PreviewChecks?
    var fits: [FitResult] = []
  }

  struct GenerationState: Equatable {
    var running: Bool
    var done = 0
    var total = 0
    var rendered = 0
    var unchanged = 0
    var failed = 0
    var skipped = 0
    var log: [String] = []
    var error: String?
    /// Files that differ from the run before: "~ changed", "+ new", "- removed".
    var changes: [String] = []
  }

  /// The last run's log is shown (Generate menu, or the status under the canvas).
  var showGenerationLog = false

  private var manifestRevision = 0
  private var contentRevision: [String: Int] = [:]
  private var dirtyManifest = false
  private var dirtyContent: Set<String> = []
  /// The pending autosave's timer (only the wait is cancelled, never a save in flight).
  private var autosaveTimer: Task<Void, Never>?
  /// The save running now, for callers that must wait until the drafts are on disk.
  private var currentSave: Task<Void, Never>?
  /// Config writes run one after another, each with the etag the previous one returned.
  private var configQueue: Task<Void, Never>?
  private var lastCoalesce: (key: String, at: Date)?
  /// The store text editor's state, kept with the app so leaving Listing loses nothing.
  @ObservationIgnored lazy var listing = ListingModel(document: self)

  init(name: String, api: APIClient) {
    self.name = name
    self.api = api
  }

  // MARK: Derived

  var targets: [Target] { info?.targets ?? [] }
  var templates: [TemplateInfo] { info?.templates ?? [] }
  var target: Target? { targets.first { $0.id == targetId } }
  var locales: [String] { config["locales"]?.array?.compactMap(\.string) ?? [] }
  var defaultLocale: String { config["defaultLocale"]?.string ?? locales.first ?? "" }
  var projectTitle: String { config["projectName"]?.string ?? name }
  var isDirty: Bool { dirtyManifest || !dirtyContent.isEmpty }

  /// The device a screen renders for: a header screen shows on its own size, a screenshot on a screenshot size.
  func device(for screen: Screen) -> Target? {
    let optIn = ["event", "feature-graphic", "creative"]
    if screen.isOptInOnly(targets: targets) {
      return targets.first { t in screen.targets?.contains(t.id) == true }
    }
    if let current = target, !optIn.contains(current.family), screen.targets?.contains(current.id) ?? true { return current }
    return targets.first { t in !optIn.contains(t.family) && (screen.targets?.contains(t.id) ?? true) }
  }

  private func followScreenDevice() {
    guard let screen, let t = device(for: screen), t.id != targetId else { return }
    targetId = t.id
  }

  /// Every screen, in manifest order.
  var screens: [Screen] {
    (manifest["screens"]?.array ?? []).compactMap { $0.object.map(Screen.init) }
      .sorted { $0.order != $1.order ? $0.order < $1.order : $0.id < $1.id }
  }

  var sets: [PageSet] { (manifest["sets"]?.array ?? []).compactMap { $0.object.map(PageSet.init) } }
  var page: PageSet? { pageId.isEmpty ? nil : sets.first { $0.id == pageId } }
  var screen: Screen? { screens.first { $0.id == screenId } }
  var template: TemplateInfo? { templates.first { $0.id == screen?.template } }

  /// The screens the shown page has, in its order (the default page: every enabled one).
  var pageScreens: [Screen] {
    if let page { return page.screens.compactMap { id in screens.first { $0.id == id } } }
    return screens.filter(\.enabled)
  }

  /// A screen's copy as the shown page renders it: the page's own fields over the default page's.
  func fields(locale: String, screen: String) -> JSONObject {
    var out = content[locale]?["screens"]?[screen]?.object ?? JSONObject()
    if let page, let own = content[locale]?["sets"]?[page.id]?["screens"]?[screen]?.object {
      for (k, v) in own { out[k] = v }
    }
    return out
  }

  /// Issues about one screen in the shown locale and target.
  func issues(for screen: Screen) -> [Issue] {
    let keys: Set<String> = [screen.id, "\(locale)/\(screen.id)", "\(targetId)/\(locale)/\(screen.id)"]
    return issues.filter { $0.key.map(keys.contains) ?? false }
  }

  // MARK: Loading

  /// Read everything from the engine again. Unsaved drafts are written first, and undo
  /// steps from before are dropped: they would restore files as they were before the reload.
  func load() async {
    await save()
    if isDirty, case .failed = saveStatus { return }
    do {
      try apply(snapshot: try await api.getData(api.project(name)))
      undoManager?.removeAllActions(withTarget: self)
    } catch {
      loadError = error.localizedDescription
    }
  }

  /// Take the engine's snapshot (`GET /api/projects/<name>`): read-only parts, drafts, etags.
  func apply(snapshot data: Data) throws {
    do {
      let decoded = try JSONDecoder().decode(SnapshotInfo.self, from: data)
      let json = try JSONValue.parse(data)
      info = decoded
      config = json["config"] ?? .null
      manifest = json["manifest"]?.isNull == false ? json["manifest"]! : ["screens": []]
      var c: [String: JSONValue] = [:]
      for l in locales {
        c[l] = json["content"]?[l] ?? ["locale": .string(l), "screens": .object(JSONObject())]
      }
      content = c
      etags = (decoded.manifestEtag, decoded.contentEtags, decoded.configEtag)
      issues = decoded.validation.issues
      readiness = decoded.readiness
      dirtyManifest = false
      dirtyContent = []
      saveStatus = .saved
      loadError = nil
      if targetId.isEmpty || !targets.contains(where: { $0.id == targetId }) { targetId = targets.first?.id ?? "" }
      if locale.isEmpty || !locales.contains(locale) { locale = defaultLocale }
      if screenId.isEmpty || screen == nil { screenId = screens.first?.id ?? "" }
    }
  }

  func loadAppKeywords() async {
    guard let body = try? await api.get(api.project(name, "metadata")) else { return }
    var out: [String: [String]] = [:]
    for (l, v) in body["locales"]?.object ?? JSONObject() {
      let raw = v["fields"]?.array?.first { $0["field"]?.string == "keywords" }?["value"]?.string ?? ""
      out[l] = raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
    appKeywords = out
  }

  // MARK: Editing

  /// What an edit touches, for dirty tracking and saving.
  struct Touch: OptionSet {
    let rawValue: Int
    static let manifest = Touch(rawValue: 1)
    static let content = Touch(rawValue: 2)
  }

  /// One edit: an undo step (coalesced with the previous one when `coalesce`
  /// matches within two seconds, so typing is one step), then dirty marks and
  /// an autosave.
  func edit(
    _ name: String,
    touches: Touch,
    locales touchedLocales: [String] = [],
    coalesce: String? = nil,
    _ change: (inout JSONValue, inout [String: JSONValue]) -> Void
  ) {
    let before = (manifest, content)
    var m = manifest
    var c = content
    change(&m, &c)
    guard m != manifest || c != content else { return }
    let now = Date()
    let merge = coalesce != nil && lastCoalesce?.key == coalesce && now.timeIntervalSince(lastCoalesce!.at) < 2
    if !merge { registerUndo(name, restoring: before) }
    lastCoalesce = coalesce.map { ($0, now) }
    apply(manifest: m, content: c, touches: touches, locales: touchedLocales)
  }

  private func registerUndo(_ name: String, restoring state: (JSONValue, [String: JSONValue])) {
    guard let undoManager else { return }
    undoManager.registerUndo(withTarget: self) { doc in
      MainActor.assumeIsolated {
        let current = (doc.manifest, doc.content)
        doc.registerUndo(name, restoring: current)
        doc.lastCoalesce = nil
        let changed = Set(state.1.keys).union(current.1.keys).filter { state.1[$0] != current.1[$0] }
        doc.apply(
          manifest: state.0, content: state.1,
          touches: [state.0 != current.0 ? .manifest : [], changed.isEmpty ? [] : .content],
          locales: Array(changed))
      }
    }
    undoManager.setActionName(name)
  }

  private func apply(manifest m: JSONValue, content c: [String: JSONValue], touches: Touch, locales touched: [String]) {
    if touches.contains(.manifest), m != manifest {
      manifest = m
      dirtyManifest = true
      manifestRevision += 1
    }
    if touches.contains(.content) {
      for l in Set(touched).union(c.keys) where c[l] != content[l] {
        dirtyContent.insert(l)
        contentRevision[l, default: 0] += 1
      }
      content = c
    }
    if screen == nil { screenId = pageScreens.first?.id ?? screens.first?.id ?? "" }
    scheduleSave()
  }

  /// Index of a screen in the manifest's array.
  private static func screenIndex(_ m: JSONValue, _ id: String) -> Int? {
    m["screens"]?.array?.firstIndex { $0["id"]?.string == id }
  }

  /// Change one screen's JSON.
  func updateScreen(_ id: String, _ name: String, coalesce: String? = nil, _ change: (inout JSONObject) -> Void) {
    edit(name, touches: .manifest, coalesce: coalesce) { m, _ in
      guard var list = m["screens"]?.array, let i = Self.screenIndex(m, id), var o = list[i].object else { return }
      change(&o)
      list[i] = .object(o)
      m["screens"] = .array(list)
    }
  }

  /// Apply a patch of screen keys (from a canvas drag): each key replaces the screen's.
  func patchScreen(_ id: String, patch: JSONObject) {
    updateScreen(id, "Move") { o in
      for (k, v) in patch { o[k] = v.isNull ? nil : v }
    }
  }

  /// Set override keys; nil or "" removes a key (the template default).
  func setOverrides(_ patch: [String: JSONValue?], name: String = "Change Layout", coalesce: String? = nil) {
    guard let id = screen?.id else { return }
    updateScreen(id, name, coalesce: coalesce) { o in
      var overrides = o["overrides"]?.object ?? JSONObject()
      for (k, v) in patch {
        if let v, v != .string(""), v != .null { overrides[k] = v } else { overrides[k] = nil }
      }
      o["overrides"] = .object(overrides)
    }
  }

  /// A copy field of the selected screen in the shown locale; on a named page it is that page's own copy.
  func setField(_ field: String, _ value: JSONValue?) {
    guard let screenId = screen?.id else { return }
    let l = locale
    let pageId = page?.id
    edit("Typing", touches: .content, locales: [l], coalesce: "field:\(l):\(screenId):\(field):\(pageId ?? "")") { _, c in
      var lc = c[l] ?? ["locale": .string(l), "screens": .object(JSONObject())]
      if let pageId {
        var sets = lc["sets"]?.object ?? JSONObject()
        var own = sets[pageId]?.object ?? JSONObject([("screens", .object(JSONObject()))])
        var ownScreens = own["screens"]?.object ?? JSONObject()
        var fields = ownScreens[screenId]?.object ?? JSONObject()
        fields[field] = value
        ownScreens[screenId] = .object(fields)
        own["screens"] = .object(ownScreens)
        sets[pageId] = .object(own)
        lc["sets"] = .object(sets)
      } else {
        var screens = lc["screens"]?.object ?? JSONObject()
        var fields = screens[screenId]?.object ?? JSONObject()
        fields[field] = value
        screens[screenId] = .object(fields)
        lc["screens"] = .object(screens)
      }
      c[l] = lc
    }
  }

  // MARK: Screens

  func addScreen(id raw: String) -> Bool {
    let id = raw.lowercased().replacingOccurrences(of: "[^a-z0-9-]+", with: "-", options: .regularExpression)
      .trimmingCharacters(in: ["-"])
    guard !id.isEmpty, !screens.contains(where: { $0.id == id }) else { return false }
    let order = (screens.map(\.order).max() ?? 0) + 1
    edit("Add Screen", touches: .manifest) { m, _ in
      var list = m["screens"]?.array ?? []
      list.append([
        "id": .string(id), "order": .number(Double(order)), "enabled": true,
        "template": .string(templates.first?.id ?? "hero-top"),
        "source": ["filePattern": "{order}-{id}.png", "localized": true],
        "overrides": .object(JSONObject()), "layers": [],
      ])
      m["screens"] = .array(list)
    }
    screenId = id
    return true
  }

  func removeScreen(_ id: String) {
    edit("Remove Screen", touches: .manifest) { m, _ in
      m["screens"] = .array((m["screens"]?.array ?? []).filter { $0["id"]?.string != id })
    }
    if screenId == id { screenId = pageScreens.first?.id ?? screens.first?.id ?? "" }
  }

  /// Reorder: the default page renumbers the screens; a named page reorders its own list.
  func moveScreens(from source: IndexSet, to destination: Int) {
    if let page {
      var list = page.screens
      list.move(fromOffsets: source, toOffset: destination)
      patchPage(page.id, name: "Reorder Screens") { $0["screens"] = .array(list.map { .string($0) }) }
      return
    }
    var ordered = pageScreens.map(\.id)
    ordered.move(fromOffsets: source, toOffset: destination)
    // Disabled screens keep their numbers after the shown ones.
    let rest = screens.map(\.id).filter { !ordered.contains($0) }
    let all = ordered + rest
    edit("Reorder Screens", touches: .manifest) { m, _ in
      m["screens"] = .array(
        (m["screens"]?.array ?? []).map { s in
          guard let id = s["id"]?.string, let n = all.firstIndex(of: id) else { return s }
          var o = s.object!
          o["order"] = .number(Double(n + 1))
          return .object(o)
        })
    }
  }

  /// Change the selected screen's layer list.
  func editLayers(_ name: String, _ change: (inout [JSONValue]) -> Void) {
    guard let id = screen?.id else { return }
    updateScreen(id, name) { o in
      var list = o["layers"]?.array ?? []
      change(&list)
      o["layers"] = .array(list)
    }
  }

  /// Change one layer of the selected screen.
  func updateLayer(_ layerId: String, coalesce: String? = nil, _ change: (inout JSONObject) -> Void) {
    guard let id = screen?.id else { return }
    updateScreen(id, "Change Element", coalesce: coalesce.map { "\($0):\(layerId)" }) { o in
      var list = o["layers"]?.array ?? []
      guard let i = list.firstIndex(where: { $0["id"]?.string == layerId }), var l = list[i].object else { return }
      change(&l)
      list[i] = .object(l)
      o["layers"] = .array(list)
    }
  }

  /// Delete a layer from the selected screen; a text layer's copy goes from every locale.
  func deleteLayer(_ layerId: String) {
    guard let id = screen?.id else { return }
    let isText = screen?.layers.contains { $0["id"]?.string == layerId && $0["type"]?.string == "text" } ?? false
    edit("Delete Element", touches: [.manifest, .content], locales: isText ? locales : []) { m, c in
      guard var list = m["screens"]?.array, let i = Self.screenIndex(m, id), var o = list[i].object else { return }
      o["layers"] = .array((o["layers"]?.array ?? []).filter { $0["id"]?.string != layerId })
      list[i] = .object(o)
      m["screens"] = .array(list)
      guard isText else { return }
      for (l, lc) in c {
        guard var screens = lc["screens"]?.object, var fields = screens[id]?.object, fields[layerId] != nil else {
          continue
        }
        fields[layerId] = nil
        screens[id] = .object(fields)
        var next = lc
        next["screens"] = .object(screens)
        c[l] = next
      }
    }
    if selected == "layer:\(layerId)" { selected = "phone" }
  }

  /// The official device frames installed (`store-shots frames setup`), by name.
  private var framesCache: [String]?
  func loadFrames() async -> [String] {
    if let framesCache { return framesCache }
    let body = try? await api.get(api.project(name, "frames"))
    let list = body?["frames"]?.array?.compactMap { $0["name"]?.string } ?? []
    framesCache = list
    return list
  }

  /// Use an image file as a screen's capture for the shown device and language. A capture
  /// other languages or devices read too waits in `pendingCapture` for a confirmation.
  func saveCapture(_ file: URL, screen screenId: String) async {
    guard file.isFileURL else {
      captureMessage = "Drop an image file from Finder"
      return
    }
    let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    guard size > 0, size <= 40 * 1024 * 1024 else {
      captureMessage = size > 0 ? "\(file.lastPathComponent) is over 40 MB" : "Could not read \(file.lastPathComponent)"
      return
    }
    guard let data = await Task.detached(operation: { try? Data(contentsOf: file) }).value else {
      captureMessage = "Could not read \(file.lastPathComponent)"
      return
    }
    do {
      let where_ = try await api.get(
        api.project(name, "capture"), query: ["screenId": screenId, "targetId": targetId, "locale": locale])
      if where_["exists"]?.bool == true, let reason = where_["confirm"]?.string {
        pendingCapture = PendingCapture(data: data, screenId: screenId, path: where_["path"]?.string ?? "", reason: reason)
        return
      }
      await commitCapture(data, screen: screenId)
    } catch {
      captureMessage = error.localizedDescription
    }
  }

  /// Write a capture (after any confirmation).
  func commitCapture(_ data: Data, screen screenId: String) async {
    do {
      let answer = try await api.send(
        "POST", api.project(name, "capture"),
        body: [
          "screenId": .string(screenId), "targetId": .string(targetId), "locale": .string(locale),
          "dataBase64": .string(data.base64EncodedString()),
        ])
      captureRevisions[screenId, default: 0] += 1
      let size = "\(answer["width"]?.int ?? 0) x \(answer["height"]?.int ?? 0)"
      let kept = answer["backup"]?.string != nil ? "; the old one is in store/generated/replaced-captures" : ""
      captureMessage =
        answer["aspectFits"]?.bool == false
        ? "Capture saved, but its shape (\(size)) does not fit \(target?.label ?? "this device")\(kept)"
        : "Capture saved for \(screenId) (\(size))\(kept)"
      await refreshIssues()
    } catch {
      captureMessage = error.localizedDescription
    }
  }

  /// Validation again, after a file changed outside the drafts.
  func refreshIssues() async {
    guard let data = try? await api.getData(api.project(name)),
      let info = try? JSONDecoder().decode(SnapshotInfo.self, from: data)
    else { return }
    issues = info.validation.issues
    readiness = info.readiness
  }

  /// Images under store/assets (backgrounds, badges), as paths under it.
  private var assetsCache: [String]?
  func loadBackgroundAssets(refresh: Bool = false) async -> [String] {
    if let assetsCache, !refresh { return assetsCache }
    let body = try? await api.get(api.project(name, "assets"))
    let list = body?["assets"]?.array?.compactMap { $0["rel"]?.string } ?? []
    assetsCache = list
    return list
  }

  /// Remove every screen's own background, so all show the app's default.
  func clearBackgroundsEverywhere() {
    edit("Clear Backgrounds", touches: .manifest) { m, _ in
      m["screens"] = .array(
        (m["screens"]?.array ?? []).map { s in
          guard var o = s.object, var overrides = o["overrides"]?.object else { return s }
          for k in ["background", "backgroundImage", "patternColor", "patternScale"] { overrides[k] = nil }
          o["overrides"] = .object(overrides)
          return .object(o)
        })
    }
  }

  /// Duplicate a screen with its copy in every locale, as `<id>-copy` (then -copy-2, ...).
  func duplicateScreen(_ id: String) async {
    await save()
    var newId = "\(id)-copy"
    var n = 2
    while screens.contains(where: { $0.id == newId }) {
      newId = "\(id)-copy-\(n)"
      n += 1
    }
    var ifMatch = JSONObject([("manifest", .string(etags.manifest))])
    ifMatch["content"] = .object(JSONObject(etags.content.map { ($0.key, .string($0.value)) }))
    do {
      try await api.send(
        "POST", api.project(name, "duplicate"),
        body: ["sourceId": .string(id), "newId": .string(newId), "ifMatch": .object(ifMatch)])
      await load()
      screenId = newId
    } catch {
      saveStatus = .failed(error.localizedDescription)
    }
  }

  // MARK: Pages

  private func editSets(_ name: String, _ change: (inout [JSONValue]) -> Void) {
    edit(name, touches: .manifest) { m, _ in
      var list = m["sets"]?.array ?? []
      change(&list)
      m["sets"] = list.isEmpty ? nil : .array(list)
    }
  }

  func patchPage(_ id: String, name: String = "Change Page", _ change: (inout JSONObject) -> Void) {
    editSets(name) { list in
      guard let i = list.firstIndex(where: { $0["id"]?.string == id }), var o = list[i].object else { return }
      change(&o)
      list[i] = .object(o)
    }
  }

  /// A new custom page or treatment showing the default page's screens; returns its id.
  @discardableResult
  func newPage(kind: String, name pageName: String) -> String? {
    let base = pageName.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
      .trimmingCharacters(in: ["-"])
    var id = base.isEmpty || base == "default" ? kind : base
    var n = 2
    while sets.contains(where: { $0.id == id }) {
      id = "\(base)-\(n)"
      n += 1
    }
    let first = screens.filter(\.enabled).map(\.id)
    guard let start = first.isEmpty ? screens.first.map({ [$0.id] }) : first else { return nil }
    editSets(kind == "custom" ? "New Custom Product Page" : "New Treatment") { list in
      list.append([
        "id": .string(id), "kind": .string(kind), "name": .string(pageName),
        "screens": .array(start.map { .string($0) }),
      ])
    }
    pageId = id
    return id
  }

  func deletePage(_ id: String) {
    edit("Delete Page", touches: [.manifest, .content], locales: locales) { m, c in
      let list = (m["sets"]?.array ?? []).filter { $0["id"]?.string != id }
      m["sets"] = list.isEmpty ? nil : .array(list)
      for (l, lc) in c {
        guard var sets = lc["sets"]?.object, sets[id] != nil else { continue }
        sets[id] = nil
        var next = lc
        next["sets"] = sets.isEmpty ? nil : .object(sets)
        c[l] = next
      }
    }
    if pageId == id { pageId = "" }
  }

  /// Put a screen on the shown page or take it off.
  func setOnPage(_ screen: String, _ on: Bool) {
    guard let page else { return }
    var list = page.screens
    if on, !list.contains(screen) { list.append(screen) } else if !on, list.count > 1 { list.removeAll { $0 == screen } }
    patchPage(page.id, name: on ? "Add to Page" : "Remove from Page") { $0["screens"] = .array(list.map { .string($0) }) }
  }

  /// The shown page's promotional text or keywords in the shown locale.
  func setPageText(_ key: String, _ value: JSONValue?) {
    guard let pageId = page?.id else { return }
    let l = locale
    edit("Change Page Text", touches: .content, locales: [l], coalesce: "page:\(l):\(pageId):\(key)") { _, c in
      var lc = c[l] ?? ["locale": .string(l), "screens": .object(JSONObject())]
      var sets = lc["sets"]?.object ?? JSONObject()
      var own = sets[pageId]?.object ?? JSONObject([("screens", .object(JSONObject()))])
      own[key] = value
      sets[pageId] = .object(own)
      lc["sets"] = .object(sets)
      c[l] = lc
    }
  }

  func pageText(_ key: String) -> JSONValue? {
    guard let pageId = page?.id else { return nil }
    return content[locale]?["sets"]?[pageId]?[key]
  }

  // MARK: Saving

  private func scheduleSave() {
    saveStatus = .unsaved
    autosaveTimer?.cancel()
    autosaveTimer = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(900))
      guard !Task.isCancelled, let self else { return }
      // The save runs on its own task: a later edit cancels only the wait above.
      Task { await self.save() }
    }
  }

  /// Write the drafts and return once they are on disk (or a save failed). Saves run one at
  /// a time; an edit made while one runs is written by the next round.
  func save() async {
    while true {
      if let running = currentSave {
        await running.value
        continue
      }
      guard isDirty else {
        saveStatus = .saved
        return
      }
      let task = Task { await performSave() }
      currentSave = task
      await task.value
      currentSave = nil
      if case .failed = saveStatus { return }
    }
  }

  /// Drafts and store text, both written.
  func flush() async {
    await save()
    await listing.save()
  }

  private func performSave() async {
    saveStatus = .saving
    let sentManifest = (manifest, manifestRevision)
    let sentContent = dirtyContent.map { ($0, content[$0], contentRevision[$0] ?? 0) }
    let sendManifest = dirtyManifest
    do {
      var latest = issues
      if sendManifest {
        let body = try await put(api.project(name, "manifest"), ["manifest": sentManifest.0], etag: { $0.manifest })
        etags.manifest = body["etag"]?.string ?? etags.manifest
        latest = decodeIssues(body["issues"]) ?? latest
      }
      for (l, value, _) in sentContent {
        guard let value else { continue }
        let path = api.project(name, "content/\(l.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? l)")
        let body = try await put(path, ["content": value], etag: { $0.content[l] ?? "" })
        etags.content[l] = body["etag"]?.string ?? etags.content[l]
        latest = decodeIssues(body["issues"]) ?? latest
      }
      issues = latest
      // Only what this save sent is clean: an edit made while it ran is still unsaved.
      if sendManifest, manifestRevision == sentManifest.1 { dirtyManifest = false }
      for (l, _, rev) in sentContent where contentRevision[l] ?? 0 == rev { dirtyContent.remove(l) }
      // An unlink ("" id) has done its job once saved.
      if sets.contains(where: { $0.json["ascId"]?.string == "" }) {
        manifest["sets"] = .array(
          (manifest["sets"]?.array ?? []).map { s in
            guard s["ascId"]?.string == "" else { return s }
            var o = s.object!
            o["ascId"] = nil
            return .object(o)
          })
      }
      saveStatus = isDirty ? .unsaved : .saved
    } catch {
      saveStatus = .failed(error.localizedDescription)
    }
  }

  /// PUT with the file's etag; a conflict (the file changed on disk) reloads the etags and
  /// tries once more: this is a local single-user tool, the app's version wins.
  private func put(
    _ path: String, _ body: JSONObject, etag: (_ etags: (manifest: String, content: [String: String], config: String)) -> String
  ) async throws -> JSONValue {
    var b = body
    b["ifMatch"] = .string(etag(etags))
    do {
      return try await api.send("PUT", path, body: .object(b))
    } catch let error as APIError where error.status == 409 {
      let fresh = try await api.get(SnapshotInfo.self, api.project(name))
      etags = (fresh.manifestEtag, fresh.contentEtags, fresh.configEtag)
      b["ifMatch"] = .string(etag(etags))
      return try await api.send("PUT", path, body: .object(b))
    }
  }

  private func decodeIssues(_ value: JSONValue?) -> [Issue]? {
    guard let value, !value.isNull else { return nil }
    return try? JSONDecoder().decode([Issue].self, from: value.data)
  }

  // MARK: Config edits (fonts, presets, brand background)

  /// A config route with the config's etag, retried once after a conflict; returns the answer.
  @discardableResult
  func putConfig(_ route: String, method: String = "PUT", _ body: JSONObject) async throws -> JSONValue {
    // One config write at a time, each with the etag the one before returned.
    let previous = configQueue
    let run = Task { () -> Result<JSONValue, Error> in
      await previous?.value
      do {
        let answer = try await put(api.project(name, route), body, etag: { $0.config })
        if let etag = answer["etag"]?.string { etags.config = etag }
        if let c = answer["config"], !c.isNull { config = c }
        return .success(answer)
      } catch {
        return .failure(error)
      }
    }
    configQueue = Task { _ = await run.value }
    return try await run.value.get()
  }

  func refreshReadiness() async {
    if let body = try? await api.get(api.project(name, "readiness")),
      let r = try? JSONDecoder().decode(ReadinessReport.self, from: (body["readiness"] ?? .null).data)
    {
      readiness = r
    }
  }

  // MARK: Generating

  enum GenerateScope { case screen, all }

  func generate(_ scope: GenerateScope) async {
    if isDirty { await save() }
    var filter = JSONObject()
    if let page { filter["sets"] = [.string(page.id)] }
    if scope == .screen, let id = screen?.id {
      filter["screens"] = [.string(id)]
      filter["locales"] = [.string(locale)]
    }
    var body = JSONObject([("stream", true)])
    if !filter.isEmpty || page != nil { body["filter"] = .object(filter) }
    generation = GenerationState(running: true)
    do {
      for try await (event, data) in api.events(api.project(name, "generate"), body: .object(body)) {
        switch event {
        case "progress":
          generation?.done = data["done"]?.int ?? 0
          generation?.total = data["total"]?.int ?? 0
        case "log":
          if let line = data["line"]?.string { generation?.log.append(line) }
        case "done":
          generation?.running = false
          generation?.rendered = data["rendered"]?.int ?? 0
          generation?.unchanged = data["unchanged"]?.int ?? 0
          generation?.failed = data["failed"]?.int ?? 0
          generation?.skipped = data["skipped"]?.int ?? 0
          let c = data["changes"]
          generation?.changes =
            (c?["changed"]?.array ?? []).compactMap { $0.string.map { "~ \($0)" } }
            + (c?["added"]?.array ?? []).compactMap { $0.string.map { "+ \($0)" } }
            + (c?["removed"]?.array ?? []).compactMap { $0.string.map { "- \($0)" } }
          for issue in data["issues"]?.array ?? [] where issue["level"]?.string == "error" {
            generation?.log.append("ERROR \(issue["key"]?.string.map { "[\($0)] " } ?? "")\(issue["message"]?.string ?? "")")
          }
          if data["aborted"]?.bool == true {
            generation?.error = data["issues"]?.array?.first { $0["level"]?.string == "error" }?["message"]?.string
              ?? "Nothing was generated"
          }
        case "error":
          generation?.running = false
          generation?.error = data["error"]?.string
        default: break
        }
      }
    } catch {
      generation?.error = error.localizedDescription
    }
    generation?.running = false
    await refreshReadiness()
  }
}
