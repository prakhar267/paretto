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

public struct RewardReplicaCounter: Codable, Equatable, Sendable {
    public var xpEarned: Int
    public var coinsEarned: Int
    public var coinsSpent: Int

    public init(
        xpEarned: Int = 0,
        coinsEarned: Int = 0,
        coinsSpent: Int = 0
    ) {
        self.xpEarned = xpEarned
        self.coinsEarned = coinsEarned
        self.coinsSpent = coinsSpent
    }
}

public struct RewardClaim: Codable, Equatable, Sendable {
    public var replicaId: String
    public var xpEarned: Int
    public var coinsEarned: Int
    public var coinsSpent: Int

    public init(
        replicaId: String,
        xpEarned: Int = 0,
        coinsEarned: Int = 0,
        coinsSpent: Int = 0
    ) {
        self.replicaId = replicaId
        self.xpEarned = xpEarned
        self.coinsEarned = coinsEarned
        self.coinsSpent = coinsSpent
    }
}

public struct RewardJournal: Codable, Equatable, Sendable {
    public var baselineXp: Int
    public var baselineCoins: Int
    public var replicas: [String: RewardReplicaCounter]
    public var replicaEpoch: Int
    public var claims: [String: RewardClaim]
    public var claimDayFloor: String?
    public var legacyBaseline: Bool

    public init(
        baselineXp: Int = 0,
        baselineCoins: Int = 12,
        replicas: [String: RewardReplicaCounter] = [:],
        replicaEpoch: Int = 0,
        claims: [String: RewardClaim] = [:],
        claimDayFloor: String? = nil,
        legacyBaseline: Bool = false
    ) {
        self.baselineXp = baselineXp
        self.baselineCoins = baselineCoins
        self.replicas = replicas
        self.replicaEpoch = replicaEpoch
        self.claims = claims
        self.claimDayFloor = claimDayFloor
        self.legacyBaseline = legacyBaseline
    }

    private enum CodingKeys: String, CodingKey {
        case baselineXp, baselineCoins, replicas, replicaEpoch, claims, claimDayFloor
        case legacyBaseline
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        baselineXp = try values.decodeIfPresent(Int.self, forKey: .baselineXp) ?? 0
        baselineCoins = try values.decodeIfPresent(Int.self, forKey: .baselineCoins) ?? 12
        replicas = try values.decodeIfPresent(
            [String: RewardReplicaCounter].self,
            forKey: .replicas
        ) ?? [:]
        replicaEpoch = try values.decodeIfPresent(
            Int.self,
            forKey: .replicaEpoch
        ) ?? 0
        claims = try values.decodeIfPresent(
            [String: RewardClaim].self,
            forKey: .claims
        ) ?? [:]
        claimDayFloor = try values.decodeIfPresent(
            String.self,
            forKey: .claimDayFloor
        )
        legacyBaseline = try values.decodeIfPresent(
            Bool.self,
            forKey: .legacyBaseline
        ) ?? false
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
    public var lastPlayedResult: DiceResult?

    public init(
        lastPlayedDate: String? = nil,
        lastPlayedResult: DiceResult? = nil
    ) {
        self.lastPlayedDate = lastPlayedDate
        self.lastPlayedResult = lastPlayedResult
    }
}

public struct DiceResult: Codable, Equatable, Sendable {
    public let date: String
    public let multiplier: Double
    public let xp: Int
    public let stake: Int

    public init(date: String, multiplier: Double, xp: Int, stake: Int) {
        self.date = date
        self.multiplier = multiplier
        self.xp = xp
        self.stake = stake
    }
}

public struct CourseProgressMetadata: Codable, Equatable, Sendable {
    public var currentContextId: String
    public var curriculumRevision: String?
    public var updatedAt: Date

    public init(
        currentContextId: String,
        curriculumRevision: String?,
        updatedAt: Date
    ) {
        self.currentContextId = currentContextId
        self.curriculumRevision = curriculumRevision
        self.updatedAt = updatedAt
    }
}

public struct LearningState: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var activeCourseID: String
    public var courseProgress: [String: CourseProgressMetadata]
    public var onboarded: Bool
    public var displayName: String
    public var dailyGoal: Int
    public var currentRegionID: String
    public var unlockedRegionIDs: [String]
    public var xp: Int
    public var coins: Int
    public var rewardJournal: RewardJournal
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
        activeCourseID: String = CourseMetadata.frenchFromEnglish.id,
        courseProgress: [String: CourseProgressMetadata]? = nil,
        onboarded: Bool = false,
        displayName: String = "",
        dailyGoal: Int = 5,
        currentRegionID: String = CourseMetadata.frenchFromEnglish.initialContextId,
        unlockedRegionIDs: [String] = [CourseMetadata.frenchFromEnglish.initialContextId],
        xp: Int = 0,
        coins: Int = 12,
        rewardJournal: RewardJournal? = nil,
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
        self.activeCourseID = activeCourseID
        self.courseProgress = courseProgress ?? [
            activeCourseID: CourseProgressMetadata(
                currentContextId: currentRegionID,
                curriculumRevision: "compiled-v1",
                updatedAt: updatedAt
            )
        ]
        self.onboarded = onboarded
        self.displayName = displayName
        self.dailyGoal = dailyGoal
        self.currentRegionID = currentRegionID
        self.unlockedRegionIDs = unlockedRegionIDs
        self.xp = xp
        self.coins = coins
        self.rewardJournal = rewardJournal ?? RewardJournal(
            baselineXp: xp,
            baselineCoins: coins
        )
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
        case schemaVersion, courseProgress, onboarded, displayName, dailyGoal, currentRegionID
        case activeCourseID = "activeCourseId"
        case unlockedRegionIDs, xp, coins, rewardJournal, streak, longestStreak, lastActiveDate
        case wordProgress, sessions, collectibles, challenge, dice, settings, updatedAt
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try values.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        activeCourseID = try values.decodeIfPresent(String.self, forKey: .activeCourseID)
            ?? CourseMetadata.frenchFromEnglish.id
        onboarded = try values.decodeIfPresent(Bool.self, forKey: .onboarded) ?? false
        displayName = try values.decodeIfPresent(String.self, forKey: .displayName) ?? ""
        dailyGoal = try values.decodeIfPresent(Int.self, forKey: .dailyGoal) ?? 5
        currentRegionID = try values.decodeIfPresent(String.self, forKey: .currentRegionID)
            ?? CourseMetadata.frenchFromEnglish.initialContextId
        unlockedRegionIDs = try values.decodeIfPresent([String].self, forKey: .unlockedRegionIDs)
            ?? [CourseMetadata.frenchFromEnglish.initialContextId]
        xp = try values.decodeIfPresent(Int.self, forKey: .xp) ?? 0
        coins = try values.decodeIfPresent(Int.self, forKey: .coins) ?? 12
        rewardJournal = try values.decodeIfPresent(
            RewardJournal.self,
            forKey: .rewardJournal
        ) ?? RewardJournal(
            baselineXp: xp,
            baselineCoins: coins,
            legacyBaseline: true
        )
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
        courseProgress = try values.decodeIfPresent(
            [String: CourseProgressMetadata].self,
            forKey: .courseProgress
        ) ?? [
            activeCourseID: CourseProgressMetadata(
                currentContextId: currentRegionID,
                curriculumRevision: "compiled-v1",
                updatedAt: updatedAt
            )
        ]
        if courseProgress[activeCourseID] == nil {
            courseProgress[activeCourseID] = CourseProgressMetadata(
                currentContextId: currentRegionID,
                curriculumRevision: "compiled-v1",
                updatedAt: updatedAt
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(schemaVersion, forKey: .schemaVersion)
        try values.encode(activeCourseID, forKey: .activeCourseID)
        try values.encode(courseProgress, forKey: .courseProgress)
        try values.encode(onboarded, forKey: .onboarded)
        try values.encode(displayName, forKey: .displayName)
        try values.encode(dailyGoal, forKey: .dailyGoal)
        try values.encode(currentRegionID, forKey: .currentRegionID)
        try values.encode(unlockedRegionIDs, forKey: .unlockedRegionIDs)
        try values.encode(xp, forKey: .xp)
        try values.encode(coins, forKey: .coins)
        try values.encode(rewardJournal, forKey: .rewardJournal)
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
