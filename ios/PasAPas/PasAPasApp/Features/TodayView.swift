import PasAPasCore
import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Binding var selection: AppSection

    private var region: Region? { model.curriculum.region(id: model.state.currentRegionID) }
    private var learned: Int { LearningEngine.learnedCount(model.state, curriculum: model.curriculum) }
    private var due: Int {
        LearningEngine.dueWords(state: model.state, curriculum: model.curriculum, limit: Int.max).count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                (dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                    : AnyLayout(HStackLayout(alignment: .top, spacing: 12))) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Bonjour, \(model.state.displayName)")
                            .font(.largeTitle.bold())
                        Text(syncCopy).font(.caption).foregroundStyle(.secondary)
                    }
                    if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                    Text(region?.emoji ?? "🧭")
                        .font(.system(size: 44))
                        .accessibilityHidden(true)
                }

                (dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                    : AnyLayout(HStackLayout(alignment: .center, spacing: 20))) {
                    MetricPill(symbol: "bolt.fill", value: "\(model.state.xp)", label: "XP")
                    MetricPill(symbol: "flame.fill", value: "\(model.state.streak)", label: "day streak")
                    MetricPill(symbol: "text.book.closed.fill", value: "\(learned)", label: learned == 1 ? "word" : "words")
                }

                ZStack(alignment: .bottomLeading) {
                    RoundedRectangle(cornerRadius: 28).fill(Color.pasNavy)
                    VStack(alignment: .leading, spacing: 14) {
                        Text(region?.name ?? "Île-de-France")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.pasGold)
                            .textCase(.uppercase)
                        Text("Your next five-card discovery")
                            .font(.title.bold())
                            .foregroundStyle(.white)
                        Text(region?.theme ?? "City rhythm and culture")
                            .foregroundStyle(.white.opacity(0.78))
                        Button("Start lesson") { _ = model.startLearning() }
                            .buttonStyle(.borderedProminent)
                            .tint(.pasGold)
                            .foregroundStyle(Color.pasNavy)
                    }
                    .padding(24)
                }
                .frame(minHeight: 250)

                Text("Today’s route").font(.title2.bold())
                (dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                    : AnyLayout(HStackLayout(alignment: .top, spacing: 12))) {
                    RouteCard(
                        symbol: "arrow.triangle.2.circlepath",
                        title: due > 0 ? "\(due) \(due == 1 ? "review is" : "reviews are") ready" : "Memory is clear",
                        copy: learned > 0 ? "Practice only words you have already seen." : "Finish a lesson to create your first review set.",
                        action: due > 0 ? "Review" : "Practice",
                        disabled: learned == 0
                    ) { _ = model.startReview() }
                    RouteCard(
                        symbol: "map",
                        title: "\(model.state.unlockedRegionIDs.count) \(model.state.unlockedRegionIDs.count == 1 ? "region" : "regions") open",
                        copy: "Follow your cultural route across France.",
                        action: "Open journey",
                        disabled: false
                    ) { selection = .journey }
                }
            }
            .padding(20)
        }
        .navigationTitle("Today")
    }

    private var syncCopy: String {
        switch model.syncStatus {
        case .local: "Saved privately on this device"
        case .syncing: "Saving securely…"
        case .saved: "Progress saved"
        case .offline: "Offline—changes will sync later"
        case .error(let message): message
        }
    }
}

private struct RouteCard: View {
    let symbol: String
    let title: String
    let copy: String
    let action: String
    let disabled: Bool
    let perform: () -> Void

    var body: some View {
        BrandCard {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: symbol).font(.title2).foregroundStyle(Color.pasCoral)
                Text(title).font(.headline)
                Text(copy).font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Button(action, action: perform)
                    .font(.subheadline.bold())
                    .disabled(disabled)
            }
            .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
        }
    }
}
