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
                VStack(alignment: .leading, spacing: 26) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Bienvenue")
                            .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        Text("A thoughtful five-minute French habit, built around recall rather than streak anxiety.")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }

                    BrandCard {
                        VStack(alignment: .leading, spacing: 18) {
                            Text("What should we call you?").font(.headline)
                            TextField("First name", text: $name)
                                .textContentType(.givenName)
                                .loquivoWordAutocapitalization()
                                .focused($nameFocused)
                                .padding(14)
                                .background(Color.loquivoTertiaryFill, in: RoundedRectangle(cornerRadius: 12))

                            Text("Daily learning goal").font(.headline)
                            dailyGoalPicker
                        }
                    }

                    Button("Begin in Île-de-France") {
                        model.completeOnboarding(
                            name: name.isEmpty ? "Traveler" : name,
                            dailyGoal: dailyGoal
                        )
                    }
                    .buttonStyle(PrimaryActionStyle())
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(22)
            }
            .navigationTitle("Your journey")
            .loquivoInlineNavigationTitle()
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
            Text("5 minutes").tag(5)
            Text("10 minutes").tag(10)
            Text("15 minutes").tag(15)
        }
    }
}
