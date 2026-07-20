import Foundation

public enum MasteryRating: String, Codable, CaseIterable, Sendable {
    case again
    case hard
    case good
}

public struct WordProgress: Codable, Equatable, Sendable {
    public var stage: Int
    public var seen: Int
    public var correct: Int
    public var incorrect: Int
    public var nextReviewAt: Date
    public var lastReviewedAt: Date

    public init(
        stage: Int,
        seen: Int,
        correct: Int,
        incorrect: Int,
        nextReviewAt: Date,
        lastReviewedAt: Date
    ) {
        self.stage = stage
        self.seen = seen
        self.correct = correct
        self.incorrect = incorrect
        self.nextReviewAt = nextReviewAt
        self.lastReviewedAt = lastReviewedAt
    }
}

public struct LearningSettings: Codable, Equatable, Sendable {
    public var sound = true
    public var phonetics = true
    public var reducedMotion = false
    public var analytics = false

    public init(
        sound: Bool = true,
        phonetics: Bool = true,
        reducedMotion: Bool = false,
        analytics: Bool = false
    ) {
        self.sound = sound
        self.phonetics = phonetics
        self.reducedMotion = reducedMotion
        self.analytics = analytics
    }
}

public struct LearningSession: Codable, Identifiable, Equatable, Sendable {
    public let id: UUID
    public let mode: String
    public let regionID: String
    public let wordIDs: [String]
    public let correct: Int
    public let xpEarned: Int
    public let completedAt: Date

    public init(
        id: UUID = UUID(),
        mode: String,
        regionID: String,
        wordIDs: [String],
        correct: Int,
        xpEarned: Int,
        completedAt: Date
    ) {
        self.id = id
        self.mode = mode
        self.regionID = regionID
        self.wordIDs = wordIDs
        self.correct = correct
        self.xpEarned = xpEarned
        self.completedAt = completedAt
    }
}

public struct ChallengeProgress: Codable, Equatable, Sendable {
    public var lastPlayedDate: String?
    public var bestScore: Int

    public init(lastPlayedDate: String? = nil, bestScore: Int = 0) {
        self.lastPlayedDate = lastPlayedDate
        self.bestScore = bestScore
    }
}

public struct DiceProgress: Codable, Equatable, Sendable {
    public var lastPlayedDate: String?

    public init(lastPlayedDate: String? = nil) {
        self.lastPlayedDate = lastPlayedDate
    }
}

public struct LearningState: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var onboarded: Bool
    public var displayName: String
    public var dailyGoal: Int
    public var currentRegionID: String
    public var unlockedRegionIDs: [String]
    public var xp: Int
    public var coins: Int
    public var streak: Int
    public var longestStreak: Int
    public var lastActiveDate: String?
    public var wordProgress: [String: WordProgress]
    public var sessions: [LearningSession]
    public var collectibles: [String]
    public var challenge: ChallengeProgress
    public var dice: DiceProgress
    public var settings: LearningSettings
    public var updatedAt: Date

    public init(
        schemaVersion: Int = 1,
        onboarded: Bool = false,
        displayName: String = "",
        dailyGoal: Int = 5,
        currentRegionID: String = "ile-de-france",
        unlockedRegionIDs: [String] = ["ile-de-france"],
        xp: Int = 0,
        coins: Int = 12,
        streak: Int = 0,
        longestStreak: Int = 0,
        lastActiveDate: String? = nil,
        wordProgress: [String: WordProgress] = [:],
        sessions: [LearningSession] = [],
        collectibles: [String] = [],
        challenge: ChallengeProgress = .init(),
        dice: DiceProgress = .init(),
        settings: LearningSettings = .init(),
        updatedAt: Date = .now
    ) {
        self.schemaVersion = schemaVersion
        self.onboarded = onboarded
        self.displayName = displayName
        self.dailyGoal = dailyGoal
        self.currentRegionID = currentRegionID
        self.unlockedRegionIDs = unlockedRegionIDs
        self.xp = xp
        self.coins = coins
        self.streak = streak
        self.longestStreak = longestStreak
        self.lastActiveDate = lastActiveDate
        self.wordProgress = wordProgress
        self.sessions = sessions
        self.collectibles = collectibles
        self.challenge = challenge
        self.dice = dice
        self.settings = settings
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, onboarded, displayName, dailyGoal, currentRegionID
        case unlockedRegionIDs, xp, coins, streak, longestStreak, lastActiveDate
        case wordProgress, sessions, collectibles, challenge, dice, settings, updatedAt
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try values.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        onboarded = try values.decodeIfPresent(Bool.self, forKey: .onboarded) ?? false
        displayName = try values.decodeIfPresent(String.self, forKey: .displayName) ?? ""
        dailyGoal = try values.decodeIfPresent(Int.self, forKey: .dailyGoal) ?? 5
        currentRegionID = try values.decodeIfPresent(String.self, forKey: .currentRegionID) ?? "ile-de-france"
        unlockedRegionIDs = try values.decodeIfPresent([String].self, forKey: .unlockedRegionIDs) ?? ["ile-de-france"]
        xp = try values.decodeIfPresent(Int.self, forKey: .xp) ?? 0
        coins = try values.decodeIfPresent(Int.self, forKey: .coins) ?? 12
        streak = try values.decodeIfPresent(Int.self, forKey: .streak) ?? 0
        longestStreak = try values.decodeIfPresent(Int.self, forKey: .longestStreak) ?? 0
        lastActiveDate = try values.decodeIfPresent(String.self, forKey: .lastActiveDate)
        wordProgress = try values.decodeIfPresent([String: WordProgress].self, forKey: .wordProgress) ?? [:]
        sessions = try values.decodeIfPresent([LearningSession].self, forKey: .sessions) ?? []
        collectibles = try values.decodeIfPresent([String].self, forKey: .collectibles) ?? []
        challenge = try values.decodeIfPresent(ChallengeProgress.self, forKey: .challenge) ?? .init()
        dice = try values.decodeIfPresent(DiceProgress.self, forKey: .dice) ?? .init()
        settings = try values.decodeIfPresent(LearningSettings.self, forKey: .settings) ?? .init()
        updatedAt = try values.decodeIfPresent(Date.self, forKey: .updatedAt) ?? .now
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(schemaVersion, forKey: .schemaVersion)
        try values.encode(onboarded, forKey: .onboarded)
        try values.encode(displayName, forKey: .displayName)
        try values.encode(dailyGoal, forKey: .dailyGoal)
        try values.encode(currentRegionID, forKey: .currentRegionID)
        try values.encode(unlockedRegionIDs, forKey: .unlockedRegionIDs)
        try values.encode(xp, forKey: .xp)
        try values.encode(coins, forKey: .coins)
        try values.encode(streak, forKey: .streak)
        try values.encode(longestStreak, forKey: .longestStreak)
        try values.encodeIfPresent(lastActiveDate, forKey: .lastActiveDate)
        try values.encode(wordProgress, forKey: .wordProgress)
        try values.encode(sessions, forKey: .sessions)
        try values.encode(collectibles, forKey: .collectibles)
        try values.encode(challenge, forKey: .challenge)
        try values.encode(dice, forKey: .dice)
        try values.encode(settings, forKey: .settings)
        try values.encode(updatedAt, forKey: .updatedAt)
    }
}
