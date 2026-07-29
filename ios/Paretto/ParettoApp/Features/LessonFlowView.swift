import ParettoCore
import SwiftUI

struct LessonFlowView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var index = 0
    @State private var revealed = false
    @State private var complete = false
    @State private var correct = 0
    @State private var earnedXP = 0
    @AccessibilityFocusState private var completionFocused: Bool
    @AccessibilityFocusState private var answerFocused: Bool

    private var word: FrenchWord? {
        model.lessonWords.indices.contains(index) ? model.lessonWords[index] : nil
    }

    var body: some View {
        NavigationStack {
            Group {
                if complete {
                    completion
                } else if let word {
                    lessonCard(word)
                } else {
                    ContentUnavailableView("No cards available", systemImage: "text.book.closed")
                }
            }
            .navigationTitle(model.lessonMode == "review" ? "Review" : "Lesson")
            .parettoInlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") {
                        model.audio.stop()
                        model.lessonWords = []
                        dismiss()
                    }
                }
            }
        }
        .interactiveDismissDisabled(!complete)
        .onDisappear { model.audio.stop() }
    }

    private func lessonCard(_ word: FrenchWord) -> some View {
        ScrollView {
            VStack(spacing: 24) {
                ProgressView(value: Double(index + 1), total: Double(model.lessonWords.count))
                    .accessibilityLabel("Card \(index + 1) of \(model.lessonWords.count)")

                Text(word.emoji)
                    .font(.system(size: 66))
                    .accessibilityHidden(true)
                Text(word.french)
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    .multilineTextAlignment(.center)
                    .parettoAccessibilityLanguage("fr-FR")
                if model.state.settings.phonetics {
                    Text(word.ipa)
                        .font(.title3.monospaced())
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("Pronunciation \(word.ipa)")
                }

                Button {
                    model.audio.play(
                        word,
                        course: model.curriculum.course,
                        enabled: model.state.settings.sound
                    )
                } label: {
                    Label(
                        model.audio.playingWordID == word.id ? "Playing French" : "Hear the French",
                        systemImage: model.audio.playingWordID == word.id ? "speaker.wave.3.fill" : "speaker.wave.2.fill"
                    )
                }
                .buttonStyle(.bordered)
                .disabled(!model.state.settings.sound)
                .accessibilityIdentifier("lesson-french-audio")
                .accessibilityValue(model.audio.lastPlaybackSourceDescription)

                if revealed {
                    BrandCard {
                        VStack(spacing: 14) {
                            Text(word.english).font(.title2.bold())
                                .accessibilityFocused($answerFocused)
                            if let gender = word.gender {
                                Text(gender.capitalized)
                                    .font(.caption.bold())
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    .background(Color.parettoGold.opacity(0.18), in: Capsule())
                            }
                            Divider()
                            Text(word.exampleFr)
                                .font(.headline)
                                .parettoAccessibilityLanguage("fr-FR")
                            Text(word.exampleEn).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                    }

                    Text("How did that feel?").font(.headline)
                    (dynamicTypeSize.isAccessibilitySize
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                        : AnyLayout(HStackLayout(alignment: .center, spacing: 10))) {
                        RatingButton(title: "Again", subtitle: "10 min", color: .parettoCoral, foregroundColor: .white) {
                            advance(word, rating: .again)
                        }
                        RatingButton(title: "Almost", subtitle: "Later today", color: .parettoGold, foregroundColor: .parettoNavy) {
                            advance(word, rating: .hard)
                        }
                        RatingButton(title: "Got it", subtitle: "Build interval", color: .parettoBlue, foregroundColor: .white) {
                            advance(word, rating: .good)
                        }
                    }
                } else {
                    Text(model.lessonMode == "review" ? "Recall the meaning before revealing it." : "Notice the sound and article. What might it mean?")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Button("Reveal the card") {
                        revealed = true
                        answerFocused = true
                    }
                        .buttonStyle(PrimaryActionStyle())
                    if model.lessonMode == "learn" && model.state.wordProgress[word.id] == nil {
                        Button("I already know this") {
                            model.markKnown(word)
                            correct += 1
                            earnedXP += 5
                            moveForward()
                        }
                    }
                }
            }
            .padding(22)
        }
    }

    private var completion: some View {
        ScrollView {
            VStack(spacing: 22) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(Color.parettoBlue)
                    .accessibilityHidden(true)
                Text("Très bien, \(model.state.displayName).")
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)
                    .accessibilityFocused($completionFocused)
                Text("You recalled \(correct) of \(model.lessonWords.count) \(model.lessonWords.count == 1 ? "word" : "words").")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                (dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                    : AnyLayout(HStackLayout(alignment: .center, spacing: 24))) {
                    MetricPill(
                        symbol: "bolt.fill",
                        value: "+\(earnedXP + AppModel.sessionCompletionBonusXP)",
                        label: "XP"
                    )
                    MetricPill(symbol: "flame.fill", value: "\(model.state.streak)", label: "day streak")
                }
                Button("Back to today") {
                    model.lessonWords = []
                    dismiss()
                }
                .buttonStyle(PrimaryActionStyle())
            }
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity)
            .padding(28)
        }
        .onAppear { completionFocused = true }
    }

    private func advance(_ word: FrenchWord, rating: MasteryRating) {
        model.rate(word, rating: rating)
        if rating != .again { correct += 1 }
        earnedXP += rating == .good ? 10 : rating == .hard ? 6 : 2
        moveForward()
    }

    private func moveForward() {
        if index + 1 < model.lessonWords.count {
            index += 1
            revealed = false
            answerFocused = false
            return
        }
        model.finishLesson(correct: correct)
        complete = true
    }
}

private struct RatingButton: View {
    let title: String
    let subtitle: String
    let color: Color
    let foregroundColor: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Text(title).font(.headline)
                Text(subtitle).font(.caption2)
            }
            .frame(maxWidth: .infinity, minHeight: 58)
            .foregroundStyle(foregroundColor)
        }
        .buttonStyle(.borderedProminent)
        .tint(color)
        .accessibilityLabel("\(title), \(subtitle)")
    }
}
