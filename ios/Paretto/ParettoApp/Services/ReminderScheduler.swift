import Foundation
import UserNotifications

enum ReminderScheduler {
    static func setDailyReminder(enabled: Bool, hour: Int, minute: Int) async throws {
        let center = UNUserNotificationCenter.current()
        guard enabled else {
            center.removePendingNotificationRequests(withIdentifiers: ["daily-french"])
            return
        }
        let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
        try Task.checkCancellation()
        guard granted else { throw ReminderError.permissionDenied }

        let content = UNMutableNotificationContent()
        content.title = "Your French journey is ready"
        content.body = "Five useful cards are enough for today."
        content.sound = .default
        let trigger = UNCalendarNotificationTrigger(
            dateMatching: DateComponents(hour: hour, minute: minute),
            repeats: true
        )
        center.removePendingNotificationRequests(withIdentifiers: ["daily-french"])
        try await center.add(
            UNNotificationRequest(identifier: "daily-french", content: content, trigger: trigger)
        )
    }
}

enum ReminderError: LocalizedError {
    case permissionDenied
    var errorDescription: String? { "Notifications are disabled for Paretto in Settings." }
}
