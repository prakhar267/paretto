import SwiftUI

struct AppEntryView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion

    var body: some View {
        Group {
            if let startupError = model.startupError {
                ContentUnavailableView {
                    Label("Paretto cannot start", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(startupError)
                } actions: {
                    Text("Reinstall this build or contact support.")
                        .font(.footnote)
                }
            } else if !model.isReady {
                ProgressView("Preparing your French journey…")
            } else if model.requiresReauthentication ||
                (
                    !model.isAuthenticated &&
                        (
                            model.authSession != nil ||
                                !model.environment.allowsGuestMode
                        )
                ) {
                SignInView()
            } else if !model.state.onboarded {
                OnboardingView()
            } else {
                AdaptiveRootView()
            }
        }
        .background(Color.parettoBackground)
        .transaction { transaction in
            if systemReduceMotion || model.state.settings.reducedMotion {
                transaction.animation = nil
            }
        }
        .alert(
            "Paretto",
            isPresented: Binding(
                get: { model.alertMessage != nil },
                set: { if !$0 { model.alertMessage = nil } }
            ),
            actions: { Button("OK") { model.alertMessage = nil } },
            message: { Text(model.alertMessage ?? "") }
        )
    }
}

struct SignInView: View {
    static let applePrivacyCopy = "Apple creates a protected account identifier. If Apple shares a relay email, it is used only for account functions and never shown to other learners."

    @EnvironmentObject private var model: AppModel

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 28) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 34).fill(Color.parettoNavy)
                        Text("P")
                            .font(.system(size: 96, weight: .black, design: .rounded))
                            .foregroundStyle(Color.parettoCream)
                    }
                    .frame(width: 160, height: 160)
                    .accessibilityHidden(true)

                    VStack(spacing: 10) {
                        Text(
                            model.requiresReauthentication
                                ? "Your session ended"
                                : "Paretto"
                        )
                            .font(.largeTitle.bold())
                        Text(
                            model.requiresReauthentication
                                ? "Continue with Apple to restore synced progress, or begin again with a separate private profile."
                                : "Remember useful French, one small journey at a time."
                        )
                            .font(.title3)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("sign-in-tagline")
                    }

                    SecureAppleSignInButton()
                        .frame(height: 54)

                    if model.environment.allowsGuestMode {
                        Button("Continue without an account") {
                            Task { await model.signOut() }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.isAuthenticating)
                        .accessibilityHint(
                            "Starts a separate private profile on this device"
                        )
                    }

                    Text(Self.applePrivacyCopy)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    if let privacy = model.environment.serviceURL(path: "/privacy"),
                       let terms = model.environment.serviceURL(path: "/terms") {
                        HStack(spacing: 20) {
                            Link("Privacy", destination: privacy)
                            Link("Terms", destination: terms)
                        }
                        .font(.footnote)
                    }
                }
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                .padding(28)
            }
        }
    }
}
