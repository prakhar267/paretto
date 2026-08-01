import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject private var model: AppModel
    @State private var name = ""
    @State private var dailyGoal = 5
    @FocusState private var nameFocused: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    ParettoBrandMark()

                    VStack(alignment: .leading, spacing: 10) {
                        ParettoEyebrow(text: "Make it yours")
                        Text("Your first stop")
                            .font(.system(.largeTitle, design: .serif, weight: .bold))
                            .foregroundStyle(Color.parettoNavy)
                        Text("A calm five-minute French ritual, built around useful words and memorable places.")
                            .font(.body)
                            .foregroundStyle(Color.parettoMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    BrandCard {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("What should we call you?")
                                .font(.headline)
                                .foregroundStyle(Color.parettoNavy)
                            TextField("First name", text: $name)
                                .textContentType(.givenName)
                                .parettoWordAutocapitalization()
                                .focused($nameFocused)
                                .padding(16)
                                .background(Color.parettoPaperWarm, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(nameFocused ? Color.parettoBlue : Color.parettoLine, lineWidth: nameFocused ? 2 : 1)
                                }

                            Text("Daily rhythm")
                                .font(.headline)
                                .foregroundStyle(Color.parettoNavy)
                            dailyGoalPicker
                        }
                    }

                    if model.authSession == nil {
                        VStack(alignment: .leading, spacing: 12) {
                            ParettoEyebrow(text: "Already learning with Paretto?")
                            Text(
                                "Continue with Apple to restore synced progress, or start locally without an account."
                            )
                            .font(.subheadline)
                            .foregroundStyle(Color.parettoMuted)
                            SecureAppleSignInButton()
                                .frame(height: 50)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }

                    Button {
                        model.completeOnboarding(
                            name: name.isEmpty ? "Traveler" : name,
                            dailyGoal: dailyGoal
                        )
                    } label: {
                        Label("Start with Paris basics", systemImage: "location.fill")
                    }
                    .buttonStyle(PrimaryActionStyle())
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Text("Private progress stays on this device until you choose to connect an account.")
                        .font(.caption)
                        .foregroundStyle(Color.parettoMuted)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
            .parettoPageBackground()
            .parettoHiddenNavigationBar()
            .onAppear {
                if name.isEmpty, let appleName = model.authSession?.displayName {
                    name = appleName
                }
                nameFocused = name.isEmpty
            }
        }
    }

    @ViewBuilder
    private var dailyGoalPicker: some View {
        if dynamicTypeSize.isAccessibilitySize {
            goalPicker.pickerStyle(.inline)
        } else {
            goalPicker.pickerStyle(.segmented)
        }
    }

    private var goalPicker: some View {
        Picker("Daily learning goal", selection: $dailyGoal) {
            Text("5 words").tag(5)
            Text("10 words").tag(10)
            Text("15 words").tag(15)
        }
        .tint(Color.parettoBlue)
    }
}
