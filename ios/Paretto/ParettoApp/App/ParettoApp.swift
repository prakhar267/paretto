import AuthenticationServices
import SwiftUI

@main
struct ParettoApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            AppEntryView()
                .environmentObject(model)
                .tint(.parettoBlue)
                .task { await model.load() }
                .onReceive(
                    NotificationCenter.default.publisher(
                        for: ASAuthorizationAppleIDProvider
                            .credentialRevokedNotification
                    )
                ) { _ in
                    Task { await model.handleAppleCredentialRevocation() }
                }
        }
    }
}
