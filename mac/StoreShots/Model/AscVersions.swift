import Foundation

/// Apple's states in plain words.
enum AscState {
  static func words(_ s: String?) -> String {
    switch s {
    case "PREPARE_FOR_SUBMISSION": "Draft"
    case "READY_FOR_REVIEW": "Ready to submit"
    case "WAITING_FOR_REVIEW": "Waiting for review"
    case "IN_REVIEW": "In review"
    case "ACCEPTED", "APPROVED": "Approved"
    case "PENDING_DEVELOPER_RELEASE": "Approved, not released"
    case "PENDING_APPLE_RELEASE", "PROCESSING_FOR_DISTRIBUTION": "Releasing"
    case "READY_FOR_DISTRIBUTION", "READY_FOR_SALE": "Live"
    case "REJECTED", "DEVELOPER_REJECTED", "METADATA_REJECTED", "INVALID_BINARY": "Rejected"
    case "COMPLETED", "COMPLETE": "Finished"
    case "STOPPED": "Stopped"
    case nil: "Not uploaded"
    default: s!.replacingOccurrences(of: "_", with: " ").capitalized
    }
  }
}

/// The app's versions at a glance, as `GET /asc/versions` reports them.
struct AscVersionsInfo: Decodable, Equatable, Sendable {
  struct Version: Decodable, Equatable, Sendable {
    let version: String
    let state: String?
  }
  let connected: Bool
  /// Why not connected: no key, no bundle id, no record in App Store Connect.
  let reason: String?
  let live: Version?
  let next: Version?
  let readAt: String?

  /// "2.1.0 Live · 2.2.0 Draft", "1.0 Waiting for review"; nil when there is nothing to say.
  var line: String? {
    guard connected else { return nil }
    let parts = [live.map { "\($0.version) Live" }, next.map { "\($0.version) \(AscState.words($0.state))" }]
      .compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  var readDate: Date? {
    guard let readAt else { return nil }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: readAt)
  }
}
