import Foundation

public struct DiceReward: Equatable, Sendable {
    public let multiplier: Double
    public let xp: Int
    public let stake: Int

    public init(multiplier: Double, xp: Int, stake: Int) {
        self.multiplier = multiplier
        self.xp = xp
        self.stake = stake
    }
}

public struct ChallengeReward: Equatable, Sendable {
    public let xp: Int
    public let coins: Int

    public init(xp: Int, coins: Int) {
        self.xp = xp
        self.coins = coins
    }
}

public enum LearningEngine {
    private static let intervals: [TimeInterval] = [
        10 * 60,
        24 * 60 * 60,
        3 * 24 * 60 * 60,
        7 * 24 * 60 * 60,
        14 * 24 * 60 * 60,
        30 * 24 * 60 * 60,
        90 * 24 * 60 * 60,
    ]

    public static func dueWords(
        state: LearningState,
        curriculum: CurriculumBundle,
        now: Date = .now,
        limit: Int = 5
    ) -> [FrenchWord] {
        curriculum.words
            .filter { word in
                guard let progress = state.wordProgress[word.id] else { return false }
                return progress.nextReviewAt <= now
            }
            .sorted { left, right in
                let leftDate = state.wordProgress[left.id]?.nextReviewAt ?? .distantFuture
                let rightDate = state.wordProgress[right.id]?.nextReviewAt ?? .distantFuture
                return leftDate < rightDate
            }
            .prefix(max(0, limit))
            .map { $0 }
    }

    public static func practiceWords(
        state: LearningState,
        curriculum: CurriculumBundle,
        limit: Int = 5
    ) -> [FrenchWord] {
        curriculum.words
            .filter { state.wordProgress[$0.id] != nil }
            .sorted {
                let left = state.wordProgress[$0.id]?.lastReviewedAt ?? .distantPast
                let right = state.wordProgress[$1.id]?.lastReviewedAt ?? .distantPast
                return left < right
            }
            .prefix(max(0, limit))
            .map { $0 }
    }

    public static func nextLesson(
        state: LearningState,
        curriculum: CurriculumBundle,
        regionID: String? = nil
    ) -> [FrenchWord] {
        let selectedRegion = regionID ?? state.currentRegionID
        let regional = curriculum.words(in: selectedRegion)
        let lessonNumbers = Set(regional.map(\.lesson)).sorted()
        for lesson in lessonNumbers {
            let remaining = regional.filter {
                $0.lesson == lesson && state.wordProgress[$0.id] == nil
            }
            if !remaining.isEmpty { return Array(remaining.prefix(5)) }
        }

        // Once a chapter is complete, keep practice anchored to its most
        // recent lesson instead of unexpectedly jumping back to lesson one.
        guard let lastLesson = lessonNumbers.last else { return [] }
        return Array(regional.filter { $0.lesson == lastLesson }.prefix(5))
    }

    @discardableResult
    public static func rate(
        wordID: String,
        rating: MasteryRating,
        state: inout LearningState,
        now: Date = .now
    ) -> WordProgress {
        let current = state.wordProgress[wordID]
        let currentStage = current?.stage ?? 0
        let nextStage: Int
        switch rating {
        case .again: nextStage = max(0, currentStage - 1)
        case .hard: nextStage = min(6, max(0, currentStage))
        case .good: nextStage = min(6, currentStage + 1)
        }

        let interval: TimeInterval
        switch rating {
        case .again: interval = intervals[0]
        case .hard: interval = max(4 * 60 * 60, intervals[nextStage] * 0.5)
        case .good: interval = intervals[nextStage]
        }

        let progress = WordProgress(
            stage: nextStage,
            seen: (current?.seen ?? 0) + 1,
            correct: (current?.correct ?? 0) + (rating == .again ? 0 : 1),
            incorrect: (current?.incorrect ?? 0) + (rating == .again ? 1 : 0),
            nextReviewAt: now.addingTimeInterval(interval),
            lastReviewedAt: now
        )
        state.wordProgress[wordID] = progress
        state.xp += rating == .good ? 10 : rating == .hard ? 6 : 2
        if rating == .good { state.coins += 1 }
        refreshCollectibles(state: &state)
        state.updatedAt = now
        return progress
    }

    public static func markKnown(
        wordID: String,
        state: inout LearningState,
        now: Date = .now
    ) {
        state.wordProgress[wordID] = WordProgress(
            stage: 6,
            seen: max(1, state.wordProgress[wordID]?.seen ?? 0),
            correct: max(1, state.wordProgress[wordID]?.correct ?? 0),
            incorrect: state.wordProgress[wordID]?.incorrect ?? 0,
            nextReviewAt: now.addingTimeInterval(intervals[6]),
            lastReviewedAt: now
        )
        state.xp += 5
        refreshCollectibles(state: &state)
        state.updatedAt = now
    }

    public static func completeSession(
        mode: String,
        regionID: String,
        words: [FrenchWord],
        correct: Int,
        xpEarned: Int,
        curriculum: CurriculumBundle,
        state: inout LearningState,
        now: Date = .now,
        calendar: Calendar = .current
    ) {
        let today = dayKey(now, calendar: calendar)
        if state.lastActiveDate != today {
            let yesterday = calendar.date(byAdding: .day, value: -1, to: now).map {
                dayKey($0, calendar: calendar)
            }
            state.streak = state.lastActiveDate == yesterday ? state.streak + 1 : 1
            state.longestStreak = max(state.longestStreak, state.streak)
            state.lastActiveDate = today
        }
        state.sessions.insert(
            LearningSession(
                mode: mode,
                regionID: regionID,
                wordIDs: words.map(\.id),
                correct: correct,
                xpEarned: xpEarned,
                completedAt: now
            ),
            at: 0
        )
        state.sessions = Array(state.sessions.prefix(50))
        state.xp += xpEarned
        state.coins += max(1, correct / 2)
        unlockNextRegionIfEligible(regionID: regionID, curriculum: curriculum, state: &state)
        refreshCollectibles(state: &state)
        state.updatedAt = now
    }

    public static func challengeRewardEligible(
        state: LearningState,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> Bool {
        state.challenge.lastPlayedDate != dayKey(now, calendar: calendar)
    }

    public static func rateChallengeAnswer(
        wordID: String,
        correct: Bool,
        rewardEligible: Bool,
        state: inout LearningState,
        now: Date = .now,
        calendar: Calendar = .current
    ) {
        guard rewardEligible, state.wordProgress[wordID] != nil else { return }
        rate(
            wordID: wordID,
            rating: correct ? .good : .again,
            state: &state,
            now: now
        )
        state.challenge.lastPlayedDate = dayKey(now, calendar: calendar)
        state.updatedAt = now
    }

    @discardableResult
    public static func completeChallenge(
        regionID: String,
        words: [FrenchWord],
        correct: Int,
        rewardEligible: Bool,
        curriculum: CurriculumBundle,
        state: inout LearningState,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> ChallengeReward {
        let safeCorrect = min(max(0, correct), words.count)
        state.challenge.bestScore = max(state.challenge.bestScore, safeCorrect)
        let canReward = rewardEligible
            && words.count >= 3
            && words.allSatisfy { state.wordProgress[$0.id] != nil }
        guard canReward else {
            state.updatedAt = now
            return ChallengeReward(xp: 0, coins: 0)
        }

        let bonusXP = safeCorrect >= 3 ? 35 : 12
        let answerXP = safeCorrect * 10 + (words.count - safeCorrect) * 2
        let coins = safeCorrect + max(1, safeCorrect / 2)
        state.challenge.lastPlayedDate = dayKey(now, calendar: calendar)
        completeSession(
            mode: "challenge",
            regionID: regionID,
            words: words,
            correct: safeCorrect,
            xpEarned: bonusXP,
            curriculum: curriculum,
            state: &state,
            now: now,
            calendar: calendar
        )
        return ChallengeReward(xp: answerXP + bonusXP, coins: coins)
    }

    public static let diceMultipliers: [Double] = [0.5, 1, 1.25, 1.5, 2, 3]

    public static func diceRewardEligible(
        state: LearningState,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> Bool {
        state.dice.lastPlayedDate != dayKey(now, calendar: calendar)
    }

    @discardableResult
    public static func rollDice(
        stake: Int,
        multiplierIndex: Int,
        state: inout LearningState,
        now: Date = .now,
        calendar: Calendar = .current
    ) -> DiceReward? {
        let today = dayKey(now, calendar: calendar)
        guard [1, 3, 5].contains(stake),
              !state.wordProgress.isEmpty,
              state.coins >= stake,
              state.dice.lastPlayedDate != today,
              diceMultipliers.indices.contains(multiplierIndex)
        else { return nil }

        let multiplier = diceMultipliers[multiplierIndex]
        let xp = Int((Double(12 * stake) * multiplier).rounded())
        state.coins -= stake
        state.xp += xp
        state.dice.lastPlayedDate = today
        state.updatedAt = now
        refreshCollectibles(state: &state)
        return DiceReward(multiplier: multiplier, xp: xp, stake: stake)
    }

    public static func reconciled(
        _ state: LearningState,
        curriculum: CurriculumBundle
    ) -> LearningState {
        let validIDs = Set(curriculum.words.map(\.id))
        let validRegionIDs = Set(curriculum.regions.map(\.id))
        let validCollectibleIDs = Set(CollectibleCatalog.all.map(\.id))
        let firstRegionID = curriculum.regions.first?.id ?? "ile-de-france"
        var next = state
        next.wordProgress = state.wordProgress.filter { validIDs.contains($0.key) }
        next.collectibles = Array(Set(state.collectibles.filter(validCollectibleIDs.contains)))
        let requestedUnlocks = Set(state.unlockedRegionIDs.filter(validRegionIDs.contains))
            .union([firstRegionID])
        next.unlockedRegionIDs = curriculum.regions.map(\.id).filter(requestedUnlocks.contains)
        if !validRegionIDs.contains(next.currentRegionID) {
            next.currentRegionID = firstRegionID
        }
        if !next.unlockedRegionIDs.contains(next.currentRegionID) {
            next.currentRegionID = next.unlockedRegionIDs.last ?? firstRegionID
        }
        refreshCollectibles(state: &next)
        return next
    }

    /// Reconciles two independently edited device snapshots without replaying
    /// rewards. The newer meaningful snapshot owns profile preferences, while
    /// append-only learning records and region unlocks are safely unioned.
    public static func merged(
        server: LearningState,
        local: LearningState,
        curriculum: CurriculumBundle
    ) -> LearningState {
        let server = reconciled(server, curriculum: curriculum)
        let local = reconciled(local, curriculum: curriculum)
        let newer: LearningState
        if isPristine(local) && !isPristine(server) {
            newer = server
        } else if isPristine(server) && !isPristine(local) {
            newer = local
        } else {
            newer = local.updatedAt >= server.updatedAt ? local : server
        }

        var progress: [String: WordProgress] = [:]
        for id in Set(server.wordProgress.keys).union(local.wordProgress.keys) {
            switch (server.wordProgress[id], local.wordProgress[id]) {
            case (.some(let remote), .some(let device)):
                let latest = device.lastReviewedAt >= remote.lastReviewedAt ? device : remote
                let correct = max(remote.correct, device.correct)
                let incorrect = max(remote.incorrect, device.incorrect)
                progress[id] = WordProgress(
                    stage: latest.stage,
                    seen: max(remote.seen, device.seen, correct + incorrect),
                    correct: correct,
                    incorrect: incorrect,
                    nextReviewAt: latest.nextReviewAt,
                    lastReviewedAt: latest.lastReviewedAt
                )
            case (.some(let remote), .none):
                progress[id] = remote
            case (.none, .some(let device)):
                progress[id] = device
            case (.none, .none):
                break
            }
        }

        var sessionsByID: [UUID: LearningSession] = [:]
        for session in server.sessions + local.sessions {
            if let existing = sessionsByID[session.id],
               existing.completedAt > session.completedAt {
                continue
            }
            sessionsByID[session.id] = session
        }

        let unlocked = Set(server.unlockedRegionIDs)
            .union(local.unlockedRegionIDs)
            .union([newer.currentRegionID])
        let collectibles = Set(server.collectibles).union(local.collectibles)
        var result = newer
        result.schemaVersion = max(server.schemaVersion, local.schemaVersion)
        result.onboarded = server.onboarded || local.onboarded
        result.xp = max(server.xp, local.xp)
        result.coins = max(server.coins, local.coins)
        result.streak = max(server.streak, local.streak)
        result.longestStreak = max(
            server.longestStreak,
            local.longestStreak,
            server.streak,
            local.streak
        )
        result.lastActiveDate = laterDayKey(server.lastActiveDate, local.lastActiveDate)
        result.wordProgress = progress
        result.sessions = sessionsByID.values
            .sorted { $0.completedAt > $1.completedAt }
            .prefix(50)
            .map { $0 }
        result.unlockedRegionIDs = curriculum.regions.map(\.id).filter(unlocked.contains)
        result.collectibles = CollectibleCatalog.all.map(\.id).filter(collectibles.contains)
        result.challenge = ChallengeProgress(
            lastPlayedDate: laterDayKey(
                server.challenge.lastPlayedDate,
                local.challenge.lastPlayedDate
            ),
            bestScore: max(server.challenge.bestScore, local.challenge.bestScore)
        )
        result.dice = DiceProgress(
            lastPlayedDate: laterDayKey(
                server.dice.lastPlayedDate,
                local.dice.lastPlayedDate
            )
        )
        result.updatedAt = max(server.updatedAt, local.updatedAt)
        return reconciled(result, curriculum: curriculum)
    }

    public static func learnedCount(_ state: LearningState, curriculum: CurriculumBundle) -> Int {
        let liveIDs = Set(curriculum.words.map(\.id))
        return state.wordProgress.keys.filter(liveIDs.contains).count
    }

    public static func masteredCount(_ state: LearningState, curriculum: CurriculumBundle) -> Int {
        let liveIDs = Set(curriculum.words.map(\.id))
        return state.wordProgress.filter { liveIDs.contains($0.key) && $0.value.stage >= 4 }.count
    }

    private static func unlockNextRegionIfEligible(
        regionID: String,
        curriculum: CurriculumBundle,
        state: inout LearningState
    ) {
        let firstLessonIDs = Set(curriculum.words(in: regionID, lesson: 1).map(\.id))
        guard !firstLessonIDs.isEmpty,
              firstLessonIDs.allSatisfy({ state.wordProgress[$0] != nil }),
              let index = curriculum.regions.firstIndex(where: { $0.id == regionID }),
              curriculum.regions.indices.contains(index + 1)
        else { return }
        let nextID = curriculum.regions[index + 1].id
        if !state.unlockedRegionIDs.contains(nextID) {
            state.unlockedRegionIDs.append(nextID)
        }
    }

    private static func refreshCollectibles(state: inout LearningState) {
        let earned = CollectibleCatalog.all
            .filter { state.xp >= $0.unlockAtXP }
            .map(\.id)
        let collected = Set(state.collectibles).union(earned)
        state.collectibles = CollectibleCatalog.all.map(\.id).filter(collected.contains)
    }

    private static func dayKey(_ date: Date, calendar: Calendar) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }

    private static func laterDayKey(_ left: String?, _ right: String?) -> String? {
        switch (left, right) {
        case (.none, .none): nil
        case (.some(let value), .none), (.none, .some(let value)): value
        case (.some(let left), .some(let right)): max(left, right)
        }
    }

    private static func isPristine(_ state: LearningState) -> Bool {
        !state.onboarded
            && state.displayName.isEmpty
            && state.wordProgress.isEmpty
            && state.sessions.isEmpty
            && state.xp == 0
            && state.streak == 0
    }
}
