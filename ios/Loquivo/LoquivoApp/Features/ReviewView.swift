import LoquivoCore
import SwiftUI

struct ReviewView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var challengePresented = false
    @State private var dicePresented = false

    private var due: [FrenchWord] {
        LearningEngine.dueWords(state: model.state, curriculum: model.curriculum, limit: Int.max)
    }
    private var learned: Int {
        LearningEngine.learnedCount(model.state, curriculum: model.curriculum)
    }
    private var mastered: Int {
        LearningEngine.masteredCount(model.state, curriculum: model.curriculum)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                BrandCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                            .font(.largeTitle)
                            .foregroundStyle(Color.loquivoCoral)
                        Text(reviewTitle).font(.title2.bold())
                        Text(reviewCopy).foregroundStyle(.secondary)
                        Button(due.isEmpty ? practiceLabel : reviewLabel) {
                            _ = model.startReview()
                        }
                        .buttonStyle(PrimaryActionStyle())
                        .disabled(learned == 0)
                    }
                }

                (dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 14))
                    : AnyLayout(HStackLayout(alignment: .center, spacing: 14))) {
                    BrandCard {
                        MetricPill(symbol: "text.book.closed.fill", value: "\(learned)", label: learned == 1 ? "learned word" : "learned words")
                    }
                    BrandCard {
                        MetricPill(symbol: "checkmark.seal.fill", value: "\(mastered)", label: mastered == 1 ? "solid word" : "solid words")
                    }
                }

                Text("Memory studio").font(.title2.bold())
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 250), spacing: 14)],
                    spacing: 14
                ) {
                    PracticeModeCard(
                        symbol: "building.columns.fill",
                        eyebrow: "Dialogue mission",
                        title: "The Château Challenge",
                        copy: "Answer up to five prompts from words you have learned. There is no timer, and every prompt can be heard aloud.",
                        detail: challengeDetail,
                        action: challengeDoneToday ? "Play for practice" : "Begin challenge",
                        disabled: learned < 3,
                        tone: .loquivoNavy,
                        actionTint: .loquivoNavy
                    ) {
                        challengePresented = true
                    }
                    PracticeModeCard(
                        symbol: "dice.fill",
                        eyebrow: "Travel dice",
                        title: "Roll for a route boost",
                        copy: "Spend earned travel coins on a transparent one-in-six XP boost. No purchases and no hidden odds.",
                        detail: diceDoneToday
                            ? "Today’s reward collected"
                            : "\(model.state.coins) \(model.state.coins == 1 ? "coin" : "coins") available",
                        action: diceDoneToday ? "View status" : "Open the dice",
                        disabled: learned == 0,
                        tone: .loquivoGold,
                        actionTint: .loquivoNavy
                    ) {
                        dicePresented = true
                    }
                }

                Text("Seven-stage memory").font(.title2.bold())
                ForEach(Array(["New", "Discovering", "Practising", "Familiar", "Solid", "Mastered", "Acquired"].enumerated()), id: \.offset) { stage, label in
                    HStack {
                        Text("\(stage + 1)")
                            .font(.caption.bold())
                            .frame(width: 28, height: 28)
                            .background(Color.loquivoBlue.opacity(0.15), in: Circle())
                        Text(label)
                        Spacer()
                        Text("\(model.state.wordProgress.values.filter { $0.stage == stage }.count)")
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 5)
                }

                NavigationLink {
                    CollectiblesDetailView()
                } label: {
                    BrandCard {
                        HStack(spacing: 14) {
                            Image(systemName: "book.closed.fill")
                                .font(.title2)
                                .foregroundStyle(Color.loquivoBlue)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Carnet collection").font(.headline)
                                Text("\(model.state.collectibles.count) of \(CollectibleCatalog.all.count) keepsakes collected")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(.secondary)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            .padding(20)
        }
        .navigationTitle("Review")
        .loquivoFullScreenCover(isPresented: $challengePresented) {
            ChallengeView(
                questions: model.challengeWords(),
                rewardEligible: LearningEngine.challengeRewardEligible(state: model.state)
            )
            .environmentObject(model)
        }
        .sheet(isPresented: $dicePresented) {
            DiceView().environmentObject(model)
        }
    }

    private var reviewTitle: String {
        if due.count == 1 { return "1 word is ready" }
        if !due.isEmpty { return "\(due.count) words are ready" }
        return learned > 0 ? "Choose a practice round" : "Your first words will appear here"
    }

    private var reviewCopy: String {
        due.isEmpty
            ? learned > 0 ? "Nothing is overdue. Practise up to five learned words." : "Complete one lesson to create your review set."
            : "A short recovery set, never an endless backlog."
    }

    private var reviewLabel: String { "Review \(min(5, due.count)) \(min(5, due.count) == 1 ? "word" : "words")" }
    private var practiceLabel: String { "Practise \(min(5, learned)) \(min(5, learned) == 1 ? "word" : "words")" }
    private var challengeDoneToday: Bool {
        !LearningEngine.challengeRewardEligible(state: model.state)
    }
    private var diceDoneToday: Bool {
        !LearningEngine.diceRewardEligible(state: model.state)
    }
    private var challengeDetail: String {
        if challengeDoneToday { return "Completed today · practice is reward-free" }
        if learned >= 3 { return "Ready · \(min(5, learned)) learned \(min(5, learned) == 1 ? "word" : "words")" }
        return "Learn 3 words to unlock"
    }
}

private struct PracticeModeCard: View {
    let symbol: String
    let eyebrow: String
    let title: String
    let copy: String
    let detail: String
    let action: String
    let disabled: Bool
    let tone: Color
    let actionTint: Color
    let perform: () -> Void

    var body: some View {
        BrandCard {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: symbol)
                    .font(.title)
                    .foregroundStyle(tone)
                    .accessibilityHidden(true)
                Text(eyebrow.uppercased())
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                Text(title).font(.title3.bold())
                Text(copy).font(.caption).foregroundStyle(.secondary)
                Text(detail).font(.caption.bold())
                Spacer(minLength: 4)
                Button(action, action: perform)
                    .buttonStyle(.borderedProminent)
                    .tint(actionTint)
            }
            .frame(maxWidth: .infinity, minHeight: 250, alignment: .topLeading)
        }
    }
}
