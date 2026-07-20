import PasAPasCore
import SwiftUI

struct DiceView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var stake = 1
    @State private var result: DiceReward?
    @AccessibilityFocusState private var resultFocused: Bool

    private var doneToday: Bool {
        !LearningEngine.diceRewardEligible(state: model.state)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack(spacing: 14) {
                        Image(systemName: "dice.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(Color.pasGold)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("A little route boost").font(.title.bold())
                            Text("Six equally likely outcomes: ×0.5, ×1, ×1.25, ×1.5, ×2 or ×3 XP.")
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let result {
                        resultView(result)
                    } else if doneToday {
                        BrandCard {
                            Label("Today’s roll is complete", systemImage: "checkmark.seal.fill")
                                .font(.headline)
                            Text("Come back tomorrow after another small French step.")
                                .foregroundStyle(.secondary)
                                .padding(.top, 4)
                        }
                    } else {
                        Label(
                            "\(model.state.coins) \(model.state.coins == 1 ? "coin" : "coins") available",
                            systemImage: "circle.hexagongrid.fill"
                        )
                        .font(.title3.bold())

                        Text("Choose your stake").font(.headline)
                        (dynamicTypeSize.isAccessibilitySize
                            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                            : AnyLayout(HStackLayout(alignment: .center, spacing: 10))) {
                            ForEach([1, 3, 5], id: \.self) { value in
                                stakeButton(value)
                            }
                        }

                        Label(
                            "Every face is equally likely. Coins are earned only through learning—there are no purchases or hidden odds.",
                            systemImage: "info.circle"
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                        Button("Roll the dice", systemImage: "dice") { roll() }
                            .buttonStyle(PrimaryActionStyle())
                            .disabled(model.state.coins < stake)
                    }
                }
                .frame(maxWidth: 620)
                .frame(maxWidth: .infinity)
                .padding(22)
            }
            .navigationTitle("Travel dice")
            .pasInlineNavigationTitle()
            .toolbar { Button("Done") { dismiss() } }
        }
    }

    private func stakeButton(_ value: Int) -> some View {
        Button {
            stake = value
        } label: {
            VStack(spacing: 3) {
                Text("\(value)").font(.title2.bold())
                Text(value == 1 ? "coin" : "coins").font(.caption)
            }
            .frame(maxWidth: .infinity, minHeight: 64)
            .foregroundStyle(stake == value ? Color.white : Color.primary)
            .background(stake == value ? Color.pasNavy : Color.pasSurface, in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(model.state.coins < value)
        .accessibilityLabel("Stake \(value) \(value == 1 ? "coin" : "coins")")
        .accessibilityAddTraits(stake == value ? .isSelected : [])
    }

    private func resultView(_ result: DiceReward) -> some View {
        VStack(spacing: 18) {
            Text("\(result.multiplier.formatted(.number.precision(.fractionLength(0...2))))×")
                .font(.system(size: 64, weight: .black, design: .rounded))
                .foregroundStyle(Color.pasNavy)
                .accessibilityFocused($resultFocused)
                .accessibilityLabel("\(result.multiplier) times multiplier")
            Text("+\(result.xp) XP").font(.largeTitle.bold())
            Text("Your \(result.stake) \(result.stake == 1 ? "coin" : "coins") became a memory boost.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Collect reward") { dismiss() }
                .buttonStyle(PrimaryActionStyle())
        }
        .frame(maxWidth: .infinity)
        .onAppear { resultFocused = true }
    }

    private func roll() {
        guard let reward = model.rollDice(stake: stake) else { return }
        result = reward
        resultFocused = true
    }
}
