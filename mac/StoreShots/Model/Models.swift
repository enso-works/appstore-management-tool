import Foundation

/// A target profile as the engine lists it (lib/targets.ts).
struct Target: Decodable, Identifiable, Hashable, Sendable {
  let id: String
  let platform: String
  let family: String
  let displayClass: String
  let orientation: String
  let width: Int
  let height: Int
  let fileToken: String

  /// Apple's name for it: iPhone 6.9", iPad 13", Header, Search results...
  var label: String {
    if id.hasPrefix("iphone-duo-") { return "iPhone \(displayClass)" }
    if id.hasPrefix("appreview-") { return "Preview \(inches ?? "")\"" }
    switch family {
    case "iphone": return "iPhone \(inches ?? "")\""
    case "ipad": return "iPad \(inches ?? "")\""
    case "event": return displayClass == "event card" ? "Event card" : "Event details"
    case "creative":
      return id.hasPrefix("header-") ? "Header" : id.hasPrefix("search-") ? "Search results" : "Header + search"
    case "feature-graphic": return "Feature graphic"
    default: return "Play \(family)"
    }
  }

  /// The label, with the orientation when the same device also appears the other way round.
  func label(among all: [Target]) -> String {
    let twin = all.contains { $0.id != id && $0.family == family && $0.displayClass == displayClass }
    return twin ? "\(label) \(orientation)" : label
  }

  var isLandscape: Bool { orientation == "landscape" }

  /// "6.9" from "6.9-inch", "13" from "13-inch".
  private var inches: String? {
    let n = String(displayClass.prefix { "0123456789.".contains($0) })
    return n.isEmpty ? nil : n
  }

  var systemImage: String {
    switch family {
    case "ipad": "ipad"
    case "creative": "rectangle.on.rectangle"
    case "event": "calendar"
    case "feature-graphic", "phone", "tablet": "android"
    default: isLandscape ? "iphone.landscape" : "iphone"
    }
  }
}

/// A screen template the engine offers (templates/types.ts).
struct TemplateInfo: Decodable, Identifiable, Hashable, Sendable {
  let id: String
  let name: String
  let requiredFields: [String]
  let optionalFields: [String]
  let families: [String]
  let orientations: [String]
  let overrideKeys: [String]
}

/// A validation finding (lib/issues.ts).
struct Issue: Decodable, Hashable, Sendable {
  let level: String
  let code: String
  let message: String
  let key: String?
  let file: String?
  let hint: String?

  var isError: Bool { level == "error" }
  var isWarning: Bool { level == "warn" }
}

/// One readiness check (lib/readiness.ts).
struct ReadinessCheck: Decodable, Identifiable, Hashable, Sendable {
  let id: String
  let title: String
  let status: String
  let details: [String]
  let hint: String?
}

struct ReadinessReport: Decodable, Hashable, Sendable {
  let checks: [ReadinessCheck]
  let status: String

  var failing: [ReadinessCheck] { checks.filter { $0.status == "fail" } }
  var warning: [ReadinessCheck] { checks.filter { $0.status == "warn" } }
  /// "Ready", or how many checks need attention.
  var summary: String {
    let n = failing.count + warning.count
    return n == 0 ? "Ready" : "\(n) to fix"
  }
}

struct FontInfo: Decodable, Hashable, Sendable {
  struct Entry: Decodable, Hashable, Sendable {
    let family: String
    let source: String?
  }
  struct Available: Decodable, Hashable, Sendable {
    let app: [Entry]
    let bundled: [Entry]
  }
  let stack: [Entry]
  let missing: [String]
  let available: Available
}

/// The typed, read-only parts of `GET /api/projects/<name>`. The documents the
/// app edits (config, manifest, content) are kept as ordered JSON instead.
struct SnapshotInfo: Decodable, Sendable {
  struct Validation: Decodable, Sendable {
    let issues: [Issue]
  }
  let name: String
  let root: String
  let manifestEtag: String
  let contentEtags: [String: String]
  let configEtag: String
  let validation: Validation
  let readiness: ReadinessReport
  let templates: [TemplateInfo]
  let targets: [Target]
  /// Every target the engine knows (settings lists them all).
  let allTargets: [Target]?
  let fonts: FontInfo
}

/// The in-page checks and fit results for the selected preview (lib/render/checks.ts, fit.ts).
struct PreviewChecks: Decodable, Hashable, Sendable {
  struct Overflow: Decodable, Hashable, Sendable {
    let id: String
  }
  let fontsFailed: [String]
  let missingImages: [String]
  let overflow: [Overflow]
  let textOverlapsDevice: [String]
}

struct FitResult: Decodable, Hashable, Sendable {
  let id: String
  let scale: Double
  let fits: Bool
}

// MARK: Screen view

/// Typed access to one screen of the manifest, read from and written back to its JSON.
struct Screen: Identifiable, Hashable {
  var json: JSONObject

  var id: String { json["id"]?.string ?? "" }
  var order: Int { json["order"]?.int ?? 0 }
  var enabled: Bool { json["enabled"]?.bool ?? true }
  var template: String { json["template"]?.string ?? "" }
  var overrides: JSONObject { json["overrides"]?.object ?? JSONObject() }
  var layers: [JSONValue] { json["layers"]?.array ?? [] }
  var slices: Int { json["panorama"]?["slices"]?.int ?? 1 }
  var isDark: Bool { json["appearance"]?.string == "dark" }
  var targets: [String]? { json["targets"]?.array?.compactMap(\.string) }
  var filePattern: String { json["source"]?["filePattern"]?.string ?? "" }
  var localizedCaptures: Bool { json["source"]?["localized"]?.bool ?? true }

  /// Made only for opt-in targets (a header, an event card): not a screenshot.
  func isOptInOnly(targets all: [Target]) -> Bool {
    guard let list = targets, !list.isEmpty else { return false }
    return list.allSatisfy { id in
      guard let t = all.first(where: { $0.id == id }) else { return false }
      return ["event", "feature-graphic", "creative"].contains(t.family)
    }
  }
}

/// A named set: a custom product page or an optimization treatment.
struct PageSet: Identifiable, Hashable {
  var json: JSONObject

  var id: String { json["id"]?.string ?? "" }
  var kind: String { json["kind"]?.string ?? "custom" }
  var name: String { json["name"]?.string ?? id }
  var screens: [String] { json["screens"]?.array?.compactMap(\.string) ?? [] }
  var ascId: String? { json["ascId"]?.string.flatMap { $0.isEmpty ? nil : $0 } }
  var deepLink: String? { json["deepLink"]?.string }
  var experiment: String? { json["experiment"]?.string }
  var appIconName: String? { json["appIconName"]?.string }
  var isCustom: Bool { kind == "custom" }
}
