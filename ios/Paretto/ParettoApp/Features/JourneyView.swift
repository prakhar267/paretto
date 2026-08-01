import ParettoCore
import SwiftUI

struct JourneyView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    ParettoEyebrow(text: "Your route through France")
                    Text("Every chapter is a place worth remembering.")
                        .font(.system(.largeTitle, design: .serif, weight: .bold))
                        .foregroundStyle(Color.parettoNavy)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Follow the route at your own pace. New places open as your vocabulary grows.")
                        .foregroundStyle(Color.parettoMuted)
                }

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: minimumCardWidth), spacing: 14)],
                    spacing: 14
                ) {
                    ForEach(model.curriculum.regions) { region in
                        regionCard(region)
                    }
                }
            }
            .frame(maxWidth: 960)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
            .padding(.vertical, 22)
        }
        .navigationTitle("Journey")
        .parettoInlineNavigationTitle()
        .parettoPageBackground()
    }

    private var minimumCardWidth: CGFloat {
        if dynamicTypeSize.isAccessibilitySize { return 280 }
        return horizontalSizeClass == .regular ? 320 : 300
    }

    private func regionCard(_ region: Region) -> some View {
        let unlocked = model.state.unlockedRegionIDs.contains(region.id)
        let words = model.curriculum.words(in: region.id)
        let learned = words.filter { model.state.wordProgress[$0.id] != nil }.count
        let current = region.id == model.state.currentRegionID

        return Button {
            guard unlocked else { return }
            _ = model.startLearning(regionID: region.id)
        } label: {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: unlocked ? (current ? "location.fill" : "map.fill") : "lock.fill")
                        .font(.title3)
                        .foregroundStyle(unlocked ? Color.parettoBlue : Color.parettoMuted)
                        .frame(width: 42, height: 42)
                        .background(
                            unlocked ? Color.parettoBlueSoft : Color.parettoPaperWarm,
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                        )
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Chapter \(region.number)")
                            .font(.caption2.weight(.black))
                            .tracking(1)
                            .foregroundStyle(unlocked ? Color.parettoBlue : Color.parettoMuted)
                            .textCase(.uppercase)
                        Text(region.name)
                            .font(.system(.title3, design: .serif, weight: .bold))
                            .foregroundStyle(Color.parettoNavy)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer()
                    if current {
                        Text("Current")
                            .font(.caption2.bold())
                            .foregroundStyle(Color.parettoBlue)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.parettoBlueSoft, in: Capsule())
                    }
                }
                Text(region.theme)
                    .font(.subheadline)
                    .foregroundStyle(Color.parettoMuted)
                    .multilineTextAlignment(.leading)
                ProgressView(value: Double(learned), total: Double(max(1, words.count)))
                    .tint(unlocked ? .parettoBlue : .parettoLine)
                HStack {
                    Text(unlocked ? "\(learned) of \(words.count) words collected" : "Complete the previous chapter")
                    Spacer()
                    if unlocked {
                        Image(systemName: "arrow.right")
                            .foregroundStyle(Color.parettoBlue)
                            .accessibilityHidden(true)
                    }
                }
                .font(.caption)
                .foregroundStyle(Color.parettoMuted)
            }
            .padding(20)
            .frame(maxWidth: .infinity, minHeight: 214, alignment: .topLeading)
            .background(Color.parettoPaper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(current ? Color.parettoBlue : Color.parettoLineSoft, lineWidth: current ? 2 : 1)
            }
            .shadow(color: Color.parettoNavy.opacity(unlocked ? 0.07 : 0.025), radius: 14, y: 7)
            .opacity(unlocked ? 1 : 0.72)
        }
        .buttonStyle(.plain)
        .disabled(!unlocked)
        .accessibilityLabel("\(region.name), \(unlocked ? "unlocked" : "locked"), \(learned) of \(words.count) words learned")
    }
}
