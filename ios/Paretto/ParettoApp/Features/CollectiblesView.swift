import ParettoCore
import SwiftUI

struct CollectiblesDetailView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 180), spacing: 14)],
                spacing: 14
            ) {
                ForEach(CollectibleCatalog.all) { collectible in
                    collectibleCard(collectible)
                }
            }
            .padding(18)
        }
        .navigationTitle("Carnet collection")
    }

    private func collectibleCard(_ collectible: Collectible) -> some View {
        let collected = model.state.collectibles.contains(collectible.id)
        return BrandCard {
            VStack(alignment: .leading, spacing: 9) {
                Text(collected ? collectible.emoji : "?")
                    .font(.system(size: 44))
                    .accessibilityHidden(true)
                Text(collectible.rarity.uppercased())
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                Text(collectible.name).font(.headline)
                Text(collected
                    ? collectible.description
                    : "Unlocks at \(collectible.unlockAtXP) XP")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 160, alignment: .topLeading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(collected
            ? "\(collectible.name), collected, \(collectible.description)"
            : "\(collectible.name), locked, unlocks at \(collectible.unlockAtXP) XP")
    }
}
