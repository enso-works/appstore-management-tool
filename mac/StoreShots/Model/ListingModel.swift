import Foundation
import Observation

/// The store text per language (fastlane/metadata): edited here, saved a moment after typing.
@MainActor
@Observable
final class ListingModel {
  /// The app this text belongs to; it owns the model, so the model never outlives it.
  @ObservationIgnored unowned let document: ProjectDocument
  private var api: APIClient { document.api }
  private var project: String { document.name }
  private(set) var loaded = false

  struct Field: Identifiable, Equatable {
    let field: String
    var value: String
    var etag: String
    let limit: Int
    var id: String { field }
  }

  struct Finding: Hashable {
    let level: String
    let text: String
  }

  private(set) var fields: [String: [Field]] = [:]
  private(set) var dirExists: [String: Bool] = [:]
  private(set) var findings: [String: [Finding]] = [:]
  private(set) var status: String?
  private(set) var managed: [String] = []
  private var dirty: [String: Set<String>] = [:]
  private var timer: Task<Void, Never>?
  private var running: Task<Void, Never>?

  init(document: ProjectDocument) {
    self.document = document
  }

  var isDirty: Bool { dirty.values.contains { !$0.isEmpty } }

  func load() async {
    await save()
    guard let body = try? await api.get(api.project(project, "metadata")) else { return }
    loaded = true
    managed = body["managedFields"]?.array?.compactMap(\.string) ?? []
    for (l, v) in body["locales"]?.object ?? JSONObject() {
      dirExists[l] = v["dirExists"]?.bool ?? false
      fields[l] = (v["fields"]?.array ?? []).map {
        Field(
          field: $0["field"]?.string ?? "",
          value: ($0["value"]?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
          etag: $0["etag"]?.string ?? "",
          limit: $0["limit"]?.int ?? 0)
      }
      findings[l] = (v["keywords"]?["findings"]?.array ?? []).map {
        Finding(level: $0["level"]?.string ?? "warn", text: $0["text"]?.string ?? "")
      }
    }
  }

  func value(_ locale: String, _ field: String) -> String {
    fields[locale]?.first { $0.field == field }?.value ?? ""
  }

  func set(_ locale: String, _ field: String, _ value: String) {
    guard let i = fields[locale]?.firstIndex(where: { $0.field == field }) else { return }
    fields[locale]![i].value = value
    dirty[locale, default: []].insert(field)
    status = "Edited"
    timer?.cancel()
    timer = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(900))
      guard !Task.isCancelled, let self else { return }
      // A later edit cancels only the wait, never a save in flight.
      Task { await self.save() }
    }
  }

  /// Write what changed and return once it is on disk; saves run one at a time.
  func save() async {
    while let r = running { await r.value }
    guard isDirty else { return }
    let task = Task { await performSave() }
    running = task
    await task.value
    running = nil
  }

  private func performSave() async {
    let pending = dirty
    dirty = [:]
    for (locale, names) in pending where !names.isEmpty {
      var values = JSONObject()
      var ifMatch = JSONObject()
      for f in fields[locale] ?? [] where names.contains(f.field) {
        values[f.field] = .string(f.value)
        ifMatch[f.field] = .string(f.etag)
      }
      do {
        let path = api.project(project, "metadata/\(locale.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? locale)")
        let answer = try await api.send("PUT", path, body: ["fields": .object(values), "ifMatch": .object(ifMatch)])
        for (f, e) in answer["etags"]?.object ?? JSONObject() {
          if let i = fields[locale]?.firstIndex(where: { $0.field == f }), let tag = e.string { fields[locale]![i].etag = tag }
        }
        status = "Saved"
      } catch {
        status = "Not saved: \(error.localizedDescription)"
        dirty[locale, default: []].formUnion(names)
      }
    }
    // Keyword findings follow the saved text.
    if pending.values.contains(where: { $0.contains("keywords") || $0.contains("name") || $0.contains("subtitle") }) {
      if let body = try? await api.get(api.project(project, "metadata")) {
        for (l, v) in body["locales"]?.object ?? JSONObject() {
          findings[l] = (v["keywords"]?["findings"]?.array ?? []).map {
            Finding(level: $0["level"]?.string ?? "warn", text: $0["text"]?.string ?? "")
          }
        }
      }
    }
  }

  func createLocale(_ locale: String, from source: String) async {
    let path = api.project(project, "metadata/\(locale.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? locale)")
    _ = try? await api.send("POST", path, body: ["seedFrom": .string(source)])
    await load()
  }

  /// Give every language this language's text for a field (release notes, mostly).
  func copyToAll(_ field: String, from locale: String) {
    let text = value(locale, field)
    for l in fields.keys where l != locale { set(l, field, text) }
  }
}
