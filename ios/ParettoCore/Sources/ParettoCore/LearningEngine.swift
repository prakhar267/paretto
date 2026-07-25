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

public enum RewardJournalError: Error, Equatable, Sendable {
    case capacityReached
    case epochMismatch
    case retiredClaim
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
        now: Date = .now,
        rewardReplicaID: String? = nil,
        awardReward: Bool = true
    ) throws -> WordProgress {
        let rewardReplicaID = rewardReplicaID ?? installationRewardReplicaID()
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
        if awardReward {
            try applyRewardDelta(
                xpEarned: rating == .good ? 10 : rating == .hard ? 6 : 2,
                coinsEarned: rating == .good ? 1 : 0,
                replicaID: rewardReplicaID,
                state: &state
            )
        }
        refreshCollectibles(state: &state)
        state.updatedAt = now
        return progress
    }

    public static func markKnown(
        wordID: String,
        state: inout LearningState,
        now: Date = .now,
        rewardReplicaID: String? = nil
    ) throws {
        let rewardReplicaID = rewardReplicaID ?? installationRewardReplicaID()
        state.wordProgress[wordID] = WordProgress(
            stage: 6,
            seen: max(1, state.wordProgress[wordID]?.seen ?? 0),
            correct: max(1, state.wordProgress[wordID]?.correct ?? 0),
            incorrect: state.wordProgress[wordID]?.incorrect ?? 0,
            nextReviewAt: now.addingTimeInterval(intervals[6]),
            lastReviewedAt: now
        )
        try applyRewardDelta(
            xpEarned: 5,
            replicaID: rewardReplicaID,
            state: &state
        )
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
        calendar: Calendar = .current,
        rewardReplicaID: String? = nil,
        awardReward: Bool = true
    ) throws {
        let rewardReplicaID = rewardReplicaID ?? installationRewardReplicaID()
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
        if awardReward {
            try applyRewardDelta(
                xpEarned: xpEarned,
                coinsEarned: max(1, correct / 2),
                replicaID: rewardReplicaID,
                state: &state
            )
        }
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
        calendar: Calendar = .current,
        rewardReplicaID: String? = nil
    ) throws {
        let rewardReplicaID = rewardReplicaID ?? installationRewardReplicaID()
        guard rewardEligible, state.wordProgress[wordID] != nil else { return }
        try rate(
            wordID: wordID,
            rating: correct ? .good : .again,
            state: &state,
            now: now,
            rewardReplicaID: rewardReplicaID,
            awardReward: false
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
        calendar: Calendar = .current,
        rewardReplicaID: String? = nil
    ) throws -> ChallengeReward {
        let rewardReplicaID = rewardReplicaID ?? installationRewardReplicaID()
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
        try completeSession(
            mode: "challenge",
            regionID: regionID,
            words: words,
            correct: safeCorrect,
            xpEarned: bonusXP,
            curriculum: curriculum,
            state: &state,
            now: now,
            calendar: calendar,
            rewardReplicaID: rewardReplicaID,
            awardReward: false
        )
        try applyRewardClaim(
            claimID: "daily:challenge:\(dayKey(now, calendar: calendar))",
            xpEarned: answerXP + bonusXP,
            coinsEarned: coins,
            replicaID: rewardReplicaID,
            state: &state
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
        calendar: Calendar = .current,
        rewardReplicaID: String? = nil
    ) throws -> DiceReward? {
        let rewardReplicaID = rewardReplicaID ?? installationRewardReplicaID()
        let today = dayKey(now, calendar: calendar)
        guard [1, 3, 5].contains(stake),
              !state.wordProgress.isEmpty,
              state.coins >= stake,
              state.dice.lastPlayedDate != today,
              diceMultipliers.indices.contains(multiplierIndex)
        else { return nil }

        let multiplier = diceMultipliers[multiplierIndex]
        let xp = Int((Double(12 * stake) * multiplier).rounded())
        try applyRewardClaim(
            claimID: "daily:dice:\(today)",
            xpEarned: xp,
            coinsSpent: stake,
            replicaID: rewardReplicaID,
            state: &state
        )
        state.dice.lastPlayedDate = today
        state.dice.lastPlayedResult = DiceResult(
            date: today,
            multiplier: multiplier,
            xp: xp,
            stake: stake
        )
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
        normalizeRewardJournal(state: &next)
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
        next.activeCourseID = curriculum.course.id
        let existingCourseMetadata = next.courseProgress[curriculum.course.id]
        next.courseProgress[curriculum.course.id] = CourseProgressMetadata(
            currentContextId: next.currentRegionID,
            curriculumRevision: curriculum.revision,
            updatedAt: existingCourseMetadata?.updatedAt ?? next.updatedAt
        )
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
    ) throws -> LearningState {
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
        for (courseID, metadata) in server.courseProgress {
            if let existing = result.courseProgress[courseID],
               existing.updatedAt >= metadata.updatedAt {
                continue
            }
            result.courseProgress[courseID] = metadata
        }
        for (courseID, metadata) in local.courseProgress {
            if let existing = result.courseProgress[courseID],
               existing.updatedAt >= metadata.updatedAt {
                continue
            }
            result.courseProgress[courseID] = metadata
        }
        result.schemaVersion = max(server.schemaVersion, local.schemaVersion)
        result.onboarded = server.onboarded || local.onboarded
        result.rewardJournal = try mergedRewardJournal(
            server.rewardJournal,
            local.rewardJournal,
            serverUpdatedAt: server.updatedAt,
            localUpdatedAt: local.updatedAt
        )
        let rewardTotals = rewardTotals(result.rewardJournal)
        result.xp = rewardTotals.xp
        result.coins = rewardTotals.coins
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
        let latestDiceDate = laterDayKey(
            server.dice.lastPlayedDate,
            local.dice.lastPlayedDate
        )
        let diceCandidates = [
            newer.dice.lastPlayedResult,
            local.dice.lastPlayedResult,
            server.dice.lastPlayedResult,
        ]
            .compactMap { $0 }
        let diceClaimID = latestDiceDate.map { "daily:dice:\($0)" }
        let diceClaim = diceClaimID.flatMap {
            result.rewardJournal.claims[$0]
        }
        let admittedClaims = admittedRewardClaimIDs(result.rewardJournal)
        let latestDiceResult: DiceResult?
        if let diceClaimID, let diceClaim {
            latestDiceResult = admittedClaims.contains(diceClaimID)
                ? diceCandidates.first {
                    $0.date == latestDiceDate
                        && $0.xp == diceClaim.xpEarned
                        && $0.stake == diceClaim.coinsSpent
                }
                : nil
        } else {
            latestDiceResult = diceCandidates.first {
                $0.date == latestDiceDate
            }
        }
        result.dice = DiceProgress(
            lastPlayedDate: latestDiceDate,
            lastPlayedResult: latestDiceResult
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

    private static func applyRewardDelta(
        xpEarned: Int = 0,
        coinsEarned: Int = 0,
        coinsSpent: Int = 0,
        replicaID: String,
        state: inout LearningState
    ) throws {
        precondition(
            xpEarned >= 0 && coinsEarned >= 0 && coinsSpent >= 0,
            "Reward counters are grow-only."
        )
        precondition(
            coinsSpent == 0,
            "Spend rewards require an idempotent claim."
        )
        guard state.rewardJournal.replicas[replicaID] != nil ||
                state.rewardJournal.replicas.count < maximumActiveRewardReplicas
        else { throw RewardJournalError.capacityReached }
        var counter = state.rewardJournal.replicas[replicaID] ?? RewardReplicaCounter()
        counter.xpEarned += xpEarned
        counter.coinsEarned += coinsEarned
        counter.coinsSpent += coinsSpent
        state.rewardJournal.replicas[replicaID] = counter
        state.rewardJournal.legacyBaseline = false
        let totals = rewardTotals(state.rewardJournal)
        state.xp = totals.xp
        state.coins = totals.coins
    }

    private static func applyRewardClaim(
        claimID: String,
        xpEarned: Int = 0,
        coinsEarned: Int = 0,
        coinsSpent: Int = 0,
        replicaID: String,
        state: inout LearningState
    ) throws {
        precondition(
            xpEarned >= 0 && coinsEarned >= 0 && coinsSpent >= 0,
            "Reward claims must be non-negative."
        )
        guard !isRetiredRewardClaim(
            claimID,
            floor: state.rewardJournal.claimDayFloor
        ) else { throw RewardJournalError.retiredClaim }
        guard state.rewardJournal.claims[claimID] == nil else { return }
        guard state.rewardJournal.claims.count < maximumActiveRewardClaims
        else { throw RewardJournalError.capacityReached }
        state.rewardJournal.claims[claimID] = RewardClaim(
            replicaId: replicaID,
            xpEarned: xpEarned,
            coinsEarned: coinsEarned,
            coinsSpent: coinsSpent
        )
        state.rewardJournal.legacyBaseline = false
        let totals = rewardTotals(state.rewardJournal)
        state.xp = totals.xp
        state.coins = totals.coins
    }

    private static func normalizeRewardJournal(state: inout LearningState) {
        state.rewardJournal.claims = state.rewardJournal.claims.filter {
            !isRetiredRewardClaim(
                $0.key,
                floor: state.rewardJournal.claimDayFloor
            )
        }
        guard !state.rewardJournal.legacyBaseline else { return }
        let totals = rewardTotals(state.rewardJournal)
        state.xp = totals.xp
        state.coins = totals.coins
    }

    private static func mergedRewardJournal(
        _ server: RewardJournal,
        _ local: RewardJournal,
        serverUpdatedAt: Date,
        localUpdatedAt: Date
    ) throws -> RewardJournal {
        guard server.replicaEpoch == local.replicaEpoch else {
            throw RewardJournalError.epochMismatch
        }
        guard server.claimDayFloor == local.claimDayFloor else {
            throw RewardJournalError.epochMismatch
        }
        if server.legacyBaseline || local.legacyBaseline {
            return mergedLegacyRewardJournal(
                server,
                local,
                serverUpdatedAt: serverUpdatedAt,
                localUpdatedAt: localUpdatedAt
            )
        }
        var replicas: [String: RewardReplicaCounter] = [:]
        for replicaID in Set(server.replicas.keys).union(local.replicas.keys) {
            let remote = server.replicas[replicaID] ?? RewardReplicaCounter()
            let device = local.replicas[replicaID] ?? RewardReplicaCounter()
            replicas[replicaID] = RewardReplicaCounter(
                xpEarned: max(remote.xpEarned, device.xpEarned),
                coinsEarned: max(remote.coinsEarned, device.coinsEarned),
                coinsSpent: max(remote.coinsSpent, device.coinsSpent)
            )
        }
        guard replicas.count <= maximumActiveRewardReplicas else {
            throw RewardJournalError.capacityReached
        }
        var claims: [String: RewardClaim] = [:]
        let claimDayFloor = server.claimDayFloor
        for claimID in Set(server.claims.keys).union(local.claims.keys) {
            if isRetiredRewardClaim(claimID, floor: claimDayFloor) {
                continue
            }
            switch (server.claims[claimID], local.claims[claimID]) {
            case (.some(let remote), .some(let device)):
                claims[claimID] = stableRewardClaim(remote, device)
            case (.some(let remote), .none):
                claims[claimID] = remote
            case (.none, .some(let device)):
                claims[claimID] = device
            case (.none, .none):
                break
            }
        }
        let merged = RewardJournal(
            baselineXp: max(server.baselineXp, local.baselineXp),
            baselineCoins: max(server.baselineCoins, local.baselineCoins),
            replicas: replicas,
            replicaEpoch: server.replicaEpoch,
            claims: claims,
            claimDayFloor: claimDayFloor,
            legacyBaseline: false
        )
        guard merged.claims.count <= maximumActiveRewardClaims else {
            throw RewardJournalError.capacityReached
        }
        return merged
    }

    private static func rewardTotals(_ journal: RewardJournal) -> (xp: Int, coins: Int) {
        var result = (xp: max(0, journal.baselineXp), coins: journal.baselineCoins)
        var legacySpend = 0
        for counter in journal.replicas.values {
            result.xp += counter.xpEarned
            result.coins += counter.coinsEarned
            legacySpend += counter.coinsSpent
        }
        result.coins = max(0, result.coins - legacySpend)
        for claimID in journal.claims.keys.sorted() {
            guard let claim = journal.claims[claimID],
                  claim.coinsSpent <= result.coins
            else { continue }
            result.xp += claim.xpEarned
            result.coins += claim.coinsEarned - claim.coinsSpent
        }
        result.xp = min(100_000_000, max(0, result.xp))
        result.coins = min(100_000_000, max(0, result.coins))
        return result
    }

    private static func admittedRewardClaimIDs(
        _ journal: RewardJournal
    ) -> Set<String> {
        var coins = journal.baselineCoins
        var legacySpend = 0
        for counter in journal.replicas.values {
            coins += counter.coinsEarned
            legacySpend += counter.coinsSpent
        }
        coins = max(0, coins - legacySpend)
        var admitted: Set<String> = []
        for claimID in journal.claims.keys.sorted() {
            guard let claim = journal.claims[claimID],
                  claim.coinsSpent <= coins
            else { continue }
            admitted.insert(claimID)
            coins += claim.coinsEarned - claim.coinsSpent
        }
        return admitted
    }

    private static func mergedLegacyRewardJournal(
        _ server: RewardJournal,
        _ local: RewardJournal,
        serverUpdatedAt: Date,
        localUpdatedAt: Date
    ) -> RewardJournal {
        if server.legacyBaseline && local.legacyBaseline {
            return RewardJournal(
                baselineXp: max(server.baselineXp, local.baselineXp),
                baselineCoins: localUpdatedAt >= serverUpdatedAt
                    ? rewardTotals(local).coins
                    : rewardTotals(server).coins,
                replicaEpoch: server.replicaEpoch,
                claimDayFloor: laterDayKey(
                    server.claimDayFloor,
                    local.claimDayFloor
                )
            )
        }
        let modern = server.legacyBaseline ? local : server
        let legacy = server.legacyBaseline ? server : local
        let modernTotals = rewardTotals(modern)
        let legacyTotals = rewardTotals(legacy)
        let legacyIsNewer = server.legacyBaseline
            ? serverUpdatedAt >= localUpdatedAt
            : localUpdatedAt >= serverUpdatedAt
        var merged = modern
        merged.baselineXp += max(0, legacyTotals.xp - modernTotals.xp)
        if legacyIsNewer {
            merged.baselineCoins += legacyTotals.coins - modernTotals.coins
        }
        merged.legacyBaseline = false
        return merged
    }

    private static func stableRewardClaim(
        _ left: RewardClaim,
        _ right: RewardClaim
    ) -> RewardClaim {
        let leftKey = [
            left.replicaId,
            String(left.xpEarned),
            String(left.coinsEarned),
            String(left.coinsSpent),
        ].joined(separator: ":")
        let rightKey = [
            right.replicaId,
            String(right.xpEarned),
            String(right.coinsEarned),
            String(right.coinsSpent),
        ].joined(separator: ":")
        return leftKey <= rightKey ? left : right
    }

    public static func rewardReplicaID(
        identityScope: String,
        userDefaults: UserDefaults = .standard
    ) -> String {
        let key = "paretto.reward-replica.v2.\(identityScope)"
        let defaults = userDefaults
        if let stored = defaults.string(forKey: key),
           validStoredReplicaID(stored) {
            return stored
        }
        let created = [
            "ios2",
            String(Int(Date().timeIntervalSince1970 * 1_000), radix: 36),
            UUID().uuidString.lowercased(),
        ].joined(separator: ":")
        defaults.set(created, forKey: key)
        return created
    }

    private static func installationRewardReplicaID() -> String {
        rewardReplicaID(identityScope: "guest")
    }

    private static let maximumActiveRewardReplicas = 512
    private static let maximumActiveRewardClaims = 512

    private static func isRetiredRewardClaim(
        _ claimID: String,
        floor: String?
    ) -> Bool {
        guard let day = dailyRewardClaimDay(claimID),
              let floor
        else { return false }
        return day <= floor
    }

    private static func dailyRewardClaimDay(_ claimID: String) -> String? {
        let parts = claimID.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts[0] == "daily",
              parts[1] == "challenge" || parts[1] == "dice"
        else { return nil }
        let day = String(parts[2])
        let pieces = day.split(separator: "-", omittingEmptySubsequences: false)
        guard pieces.count == 3,
              pieces[0].count == 4,
              pieces[1].count == 2,
              pieces[2].count == 2,
              let year = Int(pieces[0]),
              let month = Int(pieces[1]),
              let dayValue = Int(pieces[2])
        else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = calendar.date(
            from: DateComponents(year: year, month: month, day: dayValue)
        ) else { return nil }
        return calendar.dateComponents([.year, .month, .day], from: date)
            == DateComponents(year: year, month: month, day: dayValue)
            ? day
            : nil
    }

    private static func validStoredReplicaID(_ replicaID: String) -> Bool {
        if replicaID.hasPrefix("ios:") {
            return UUID(uuidString: String(replicaID.dropFirst(4))) != nil
        }
        let parts = replicaID.split(separator: ":", omittingEmptySubsequences: false)
        return parts.count == 3
            && parts[0] == "ios2"
            && Int(parts[1], radix: 36) != nil
            && UUID(uuidString: String(parts[2])) != nil
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
