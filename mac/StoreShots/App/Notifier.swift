import AppKit
import UserNotifications

/// A system notification when a long job finishes while you are in another app.
@MainActor
enum Notifier {
  private static var asked = false

  static func finished(_ title: String, _ body: String) {
    guard !NSApp.isActive else { return }
    let center = UNUserNotificationCenter.current()
    Task {
      if !asked {
        asked = true
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
      }
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = .default
      try? await center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
  }
}
