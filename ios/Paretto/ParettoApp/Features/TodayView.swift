import ParettoCore
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
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    ParettoEyebrow(text: "Bonjour, \(model.state.displayName)")
                    Text("Your French is going places.")
                        .font(.system(.largeTitle, design: .serif, weight: .bold))
                        .foregroundStyle(Color.parettoNavy)
                        .fixedSize(horizontal: false, vertical: true)
                    Label(syncCopy, systemImage: syncSymbol)
                        .font(.caption)
                        .foregroundStyle(Color.parettoMuted)
                }

                (dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                    : AnyLayout(HStackLayout(alignment: .center, spacing: 10))) {
                    MetricPill(symbol: "bolt.fill", value: "\(model.state.xp)", label: "XP", tone: .parettoGold)
                    MetricPill(symbol: "flame.fill", value: "\(model.state.streak)", label: "day streak", tone: .parettoCoral)
                    MetricPill(symbol: "text.book.closed.fill", value: "\(learned)", label: learned == 1 ? "word" : "words")
                }

                ZStack(alignment: .topTrailing) {
                    RoundedRectangle(cornerRadius: 26, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [.parettoBlue, .parettoBlueDark],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    Image(systemName: "map.fill")
                        .font(.system(size: 100, weight: .black))
                        .foregroundStyle(.white.opacity(0.08))
                        .padding(12)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(spacing: 8) {
                            Image(systemName: "location.fill")
                            Text(region?.name ?? "Île-de-France")
                        }
                        .font(.caption.weight(.black))
                        .tracking(1)
                        .foregroundStyle(Color.parettoGold)
                        .textCase(.uppercase)
                        Text("Your next French stop")
                            .font(.system(.title, design: .serif, weight: .bold))
                            .foregroundStyle(.white)
                        Text(region?.theme ?? "City rhythm and culture")
                            .foregroundStyle(.white.opacity(0.78))
                        HStack {
                            Text("\(learned) words collected")
                            Spacer()
                            Text("\(regionProgress)%")
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.86))
                        ProgressView(value: Double(regionProgress), total: 100)
                            .tint(.parettoGold)
                        Button { _ = model.startLearning() } label: {
                            Label("Start lesson", systemImage: "book.fill")
                                .font(.headline)
                                .frame(maxWidth: .infinity, minHeight: 48)
                                .foregroundStyle(Color.parettoNavy)
                                .background(Color.parettoGold, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 300)
                .shadow(color: Color.parettoBlue.opacity(0.2), radius: 18, y: 10)

                ParettoSectionHeading(eyebrow: "Today’s route", title: "A small step that sticks")
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
            .frame(maxWidth: 920)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
            .padding(.vertical, 22)
        }
        .navigationTitle("Today")
        .parettoInlineNavigationTitle()
        .parettoPageBackground()
    }

    private var regionProgress: Int {
        guard let region else { return 0 }
        let words = model.curriculum.words(in: region.id)
        guard !words.isEmpty else { return 0 }
        let regionLearned = words.filter { model.state.wordProgress[$0.id] != nil }.count
        return Int((Double(regionLearned) / Double(words.count) * 100).rounded())
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

    private var syncSymbol: String {
        switch model.syncStatus {
        case .local: "iphone"
        case .syncing: "arrow.triangle.2.circlepath.icloud"
        case .saved: "checkmark.icloud.fill"
        case .offline: "icloud.slash"
        case .error: "exclamationmark.icloud"
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
            VStack(alignment: .leading, spacing: 12) {
                Image(systemName: symbol)
                    .font(.title2)
                    .foregroundStyle(Color.parettoBlue)
                    .frame(width: 44, height: 44)
                    .background(Color.parettoBlueSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityHidden(true)
                Text(title)
                    .font(.system(.title3, design: .serif, weight: .bold))
                    .foregroundStyle(Color.parettoNavy)
                Text(copy)
                    .font(.subheadline)
                    .foregroundStyle(Color.parettoMuted)
                Spacer(minLength: 4)
                Button(action, action: perform)
                    .font(.subheadline.bold())
                    .foregroundStyle(Color.parettoBlue)
                    .disabled(disabled)
            }
            .frame(maxWidth: .infinity, minHeight: 210, alignment: .topLeading)
        }
    }
}
