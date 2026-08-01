import ParettoCore
import SwiftUI

struct ChallengeView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let questions: [FrenchWord]
    let rewardEligible: Bool

    @State private var index = 0
    @State private var selectedID: String?
    @State private var score = 0
    @State private var complete = false
    @State private var reward = ChallengeReward(xp: 0, coins: 0)
    @AccessibilityFocusState private var feedbackFocused: Bool
    @AccessibilityFocusState private var completionFocused: Bool

    private var current: FrenchWord? {
        questions.indices.contains(index) ? questions[index] : nil
    }

    var body: some View {
        NavigationStack {
            Group {
                if complete {
                    completionView
                } else if let current {
                    questionView(current)
                } else {
                    ContentUnavailableView(
                        "Learn three words first",
                        systemImage: "building.columns",
                        description: Text("Your Château Challenge will use words already in your wordbook.")
                    )
                }
            }
            .navigationTitle("Château Challenge")
            .parettoInlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") {
                        model.audio.stop()
                        dismiss()
                    }
                }
            }
            .parettoPageBackground()
        }
        .interactiveDismissDisabled(!complete)
        .onDisappear { model.audio.stop() }
    }

    private func questionView(_ word: FrenchWord) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Label("Château gate", systemImage: "building.columns.fill")
                        .font(.headline)
                    Spacer()
                    Text("\(score)/\(questions.count)")
                        .font(.headline.monospacedDigit())
                }
                ProgressView(value: Double(score), total: Double(max(1, questions.count)))
                    .tint(.parettoGold)
                    .accessibilityLabel("Château gate progress")
                    .accessibilityValue("\(score) of \(questions.count) correct")

                Text("Question \(index + 1) of \(questions.count)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                VStack(alignment: .leading, spacing: 4) {
                    Text("What does this mean?")
                        .font(.title2.bold())
                    Text("“\(word.french)”")
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .parettoAccessibilityLanguage("fr-FR")
                }

                Button {
                    model.audio.play(
                        word,
                        course: model.curriculum.course,
                        enabled: model.state.settings.sound
                    )
                } label: {
                    Label("Hear the prompt", systemImage: "speaker.wave.2.fill")
                }
                .buttonStyle(.bordered)
                .disabled(!model.state.settings.sound)
                .accessibilityValue(model.audio.lastPlaybackSourceDescription)

                VStack(spacing: 10) {
                    ForEach(options(for: word)) { option in
                        optionButton(option, correctWord: word)
                    }
                }

                if let selectedID {
                    let isCorrect = selectedID == word.id
                    BrandCard {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(isCorrect ? "Bien joué!" : "The answer is “\(word.english).”")
                                .font(.headline)
                                .accessibilityFocused($feedbackFocused)
                            Text(feedbackCopy(isCorrect: isCorrect))
                                .foregroundStyle(.secondary)
                            Button(index == questions.count - 1 ? "See result" : "Next question") {
                                moveNext()
                            }
                            .buttonStyle(PrimaryActionStyle())
                        }
                    }
                }
            }
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
            .padding(22)
        }
        .parettoPageBackground()
    }

    private func optionButton(_ option: FrenchWord, correctWord: FrenchWord) -> some View {
        let selected = selectedID == option.id
        let correct = selectedID != nil && option.id == correctWord.id
        let incorrectSelection = selected && !correct
        return Button {
            choose(option, correctWord: correctWord)
        } label: {
            HStack(spacing: 12) {
                Text(option.english)
                    .font(.headline)
                    .multilineTextAlignment(.leading)
                Spacer()
                if correct {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                } else if incorrectSelection {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .background(optionBackground(correct: correct, incorrect: incorrectSelection), in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .stroke(correct ? Color.green : incorrectSelection ? Color.red : Color.primary.opacity(0.14), lineWidth: 1.5)
            }
        }
        .buttonStyle(.plain)
        .disabled(selectedID != nil)
        .accessibilityLabel(optionAccessibilityLabel(option, correct: correct, incorrect: incorrectSelection))
    }

    private var completionView: some View {
        ScrollView {
            VStack(spacing: 22) {
                Image(systemName: "trophy.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(Color.parettoGold)
                    .accessibilityHidden(true)
                Text(score >= 3 ? "Mission complete." : "A brave first attempt.")
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)
                    .accessibilityFocused($completionFocused)
                Text(rewardEligible
                    ? "You recalled \(score) of \(questions.count) words. Their review schedules are updated."
                    : "You recalled \(score) of \(questions.count) words in reward-free practice.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if rewardEligible {
                    (dynamicTypeSize.isAccessibilitySize
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                        : AnyLayout(HStackLayout(alignment: .center, spacing: 24))) {
                        MetricPill(symbol: "bolt.fill", value: "+\(reward.xp)", label: "XP")
                        MetricPill(
                            symbol: "circle.hexagongrid.fill",
                            value: "+\(reward.coins)",
                            label: reward.coins == 1 ? "coin" : "coins"
                        )
                    }
                } else {
                    Text("Practice mode · no rewards used")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }

                Button("Return to practice") { dismiss() }
                    .buttonStyle(PrimaryActionStyle())
            }
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity)
            .padding(28)
        }
        .parettoPageBackground()
        .onAppear { completionFocused = true }
    }

    private func choose(_ option: FrenchWord, correctWord: FrenchWord) {
        guard selectedID == nil else { return }
        let correct = option.id == correctWord.id
        selectedID = option.id
        if correct { score += 1 }
        model.rateChallengeAnswer(
            correctWord,
            correct: correct,
            rewardEligible: rewardEligible
        )
        feedbackFocused = true
    }

    private func moveNext() {
        if index + 1 < questions.count {
            index += 1
            selectedID = nil
            feedbackFocused = false
            return
        }
        reward = model.finishChallenge(
            words: questions,
            correct: score,
            rewardEligible: rewardEligible
        )
        complete = true
        completionFocused = true
    }

    private func options(for word: FrenchWord) -> [FrenchWord] {
        let samePart = questions.filter {
            $0.id != word.id && $0.partOfSpeech == word.partOfSpeech
        }
        let remaining = questions.filter { candidate in
            candidate.id != word.id
                && candidate.partOfSpeech != word.partOfSpeech
                && !samePart.contains(where: { $0.id == candidate.id })
        }
        let options = [word] + Array((samePart + remaining).prefix(3))
        let shift = word.id.unicodeScalars.reduce(0) { $0 + Int($1.value) } % options.count
        return Array(options[shift...]) + Array(options[..<shift])
    }

    private func feedbackCopy(isCorrect: Bool) -> String {
        guard rewardEligible else { return "Practice mode leaves XP and review schedules unchanged." }
        return isCorrect
            ? "The gate opens a little farther."
            : "This card will return sooner so it can stick."
    }

    private func optionBackground(correct: Bool, incorrect: Bool) -> Color {
        if correct { return .green.opacity(0.12) }
        if incorrect { return .red.opacity(0.10) }
        return .parettoSurface
    }

    private func optionAccessibilityLabel(
        _ option: FrenchWord,
        correct: Bool,
        incorrect: Bool
    ) -> String {
        if correct { return "\(option.english), correct answer" }
        if incorrect { return "\(option.english), incorrect answer" }
        return option.english
    }
}
