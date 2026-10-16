import Foundation
import Observation

/// Each app's versions in App Store Connect, for the overview's cards and the toolbar.
/// The engine reads App Store Connect at most every five minutes, so asking it often is cheap.
@MainActor
@Observable
final class AscVersionsStore {
  static let shared = AscVersionsStore()

  private(set) var byApp: [String: AscVersionsInfo] = [:]

  /// Keeps the last answer when the engine or App Store Connect cannot be reached.
  func load(_ name: String, api: APIClient, fresh: Bool = false) async {
    guard
      let info = try? await api.get(
        AscVersionsInfo.self, api.project(name, "asc/versions"), query: fresh ? ["fresh": "1"] : [:])
    else { return }
    if byApp[name] != info { byApp[name] = info }
  }

  /// "Read at 10:42 from App Store Connect", for help tags.
  static func readNote(_ info: AscVersionsInfo) -> String {
    guard let date = info.readDate else { return "From App Store Connect" }
    return "Read from App Store Connect at \(date.formatted(date: .omitted, time: .shortened))"
  }
}
