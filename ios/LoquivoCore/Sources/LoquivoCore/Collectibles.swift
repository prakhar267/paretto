public struct Collectible: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let emoji: String
    public let rarity: String
    public let description: String
    public let unlockAtXP: Int

    public init(
        id: String,
        name: String,
        emoji: String,
        rarity: String,
        description: String,
        unlockAtXP: Int
    ) {
        self.id = id
        self.name = name
        self.emoji = emoji
        self.rarity = rarity
        self.description = description
        self.unlockAtXP = unlockAtXP
    }
}

public enum CollectibleCatalog {
    public static let all: [Collectible] = [
        Collectible(
            id: "metro-ticket",
            name: "Metro Ticket",
            emoji: "🎟️",
            rarity: "Common",
            description: "Your first souvenir from the capital.",
            unlockAtXP: 100
        ),
        Collectible(
            id: "lighthouse-pin",
            name: "Lighthouse Pin",
            emoji: "🗼",
            rarity: "Uncommon",
            description: "A bright marker from the Atlantic coast.",
            unlockAtXP: 400
        ),
        Collectible(
            id: "castle-key",
            name: "Castle Key",
            emoji: "🗝️",
            rarity: "Rare",
            description: "A key said to open a Loire Valley gate.",
            unlockAtXP: 900
        ),
        Collectible(
            id: "alpine-badge",
            name: "Alpine Badge",
            emoji: "🏔️",
            rarity: "Epic",
            description: "Earned after climbing through a difficult review set.",
            unlockAtXP: 1_600
        ),
        Collectible(
            id: "golden-compass",
            name: "Golden Compass",
            emoji: "🧭",
            rarity: "Legendary",
            description: "For travellers who keep finding their way back to French.",
            unlockAtXP: 3_000
        ),
    ]
}
