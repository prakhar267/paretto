import PasAPasCore
import SwiftUI

struct JourneyView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        ScrollView {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: minimumCardWidth), spacing: 14)],
                spacing: 14
            ) {
                ForEach(model.curriculum.regions) { region in
                    let unlocked = model.state.unlockedRegionIDs.contains(region.id)
                    let words = model.curriculum.words(in: region.id)
                    let learned = words.filter { model.state.wordProgress[$0.id] != nil }.count
                    Button {
                        guard unlocked else { return }
                        _ = model.startLearning(regionID: region.id)
                    } label: {
                        BrandCard {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text(unlocked ? region.emoji : "🔒").font(.largeTitle)
                                    Spacer()
                                    Text("\(region.number)/18").font(.caption.monospacedDigit())
                                }
                                Text(region.name).font(.headline).multilineTextAlignment(.leading)
                                Text(region.theme).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                                ProgressView(value: Double(learned), total: Double(max(1, words.count)))
                                Text(unlocked ? "\(learned) of \(words.count) words" : "Complete the previous chapter")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(!unlocked)
                    .accessibilityLabel("\(region.name), \(unlocked ? "unlocked" : "locked"), \(learned) of \(words.count) words learned")
                }
            }
            .padding(18)
        }
        .navigationTitle("Journey")
    }

    private var minimumCardWidth: CGFloat {
        if dynamicTypeSize.isAccessibilitySize { return 280 }
        return horizontalSizeClass == .regular ? 250 : 160
    }
}
