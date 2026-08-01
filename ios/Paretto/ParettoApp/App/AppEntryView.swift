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
                VStack(alignment: .leading, spacing: 26) {
                    ParettoBrandMark()

                    BrandCard {
                        VStack(alignment: .leading, spacing: 20) {
                            VStack(alignment: .leading, spacing: 10) {
                                ParettoEyebrow(text: model.requiresReauthentication ? "Welcome back" : "Your learning account")
                                Text(
                                    model.requiresReauthentication
                                        ? "Your session ended"
                                        : "Keep every word with you."
                                )
                                .font(.system(.largeTitle, design: .serif, weight: .bold))
                                .foregroundStyle(Color.parettoNavy)
                                .fixedSize(horizontal: false, vertical: true)
                                Text(
                                    model.requiresReauthentication
                                        ? "Continue with Apple to restore synced progress, or begin again with a separate private profile."
                                        : "Remember useful French, one small journey at a time."
                                )
                                .font(.title3)
                                .foregroundStyle(Color.parettoMuted)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("sign-in-tagline")
                            }

                            SecureAppleSignInButton()
                                .frame(height: 54)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                            if model.environment.allowsGuestMode {
                                Button("Continue without an account") {
                                    Task { await model.signOut() }
                                }
                                .buttonStyle(SecondaryActionStyle())
                                .disabled(model.isAuthenticating)
                                .accessibilityHint(
                                    "Starts a separate private profile on this device"
                                )
                            }

                            Divider().overlay(Color.parettoLineSoft)

                            Text(Self.applePrivacyCopy)
                                .font(.footnote)
                                .foregroundStyle(Color.parettoMuted)

                            if let privacy = model.environment.serviceURL(path: "/privacy"),
                               let terms = model.environment.serviceURL(path: "/terms") {
                                HStack(spacing: 20) {
                                    Link("Privacy", destination: privacy)
                                    Link("Terms", destination: terms)
                                }
                                .font(.footnote.bold())
                            }
                        }
                    }
                }
                .frame(maxWidth: 620)
                .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                .padding(.horizontal, 20)
                .padding(.vertical, 28)
            }
        }
        .parettoPageBackground()
    }
}
