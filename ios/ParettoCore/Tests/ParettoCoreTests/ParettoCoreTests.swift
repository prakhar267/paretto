import Foundation
import Testing
@testable import ParettoCore

@Suite("Paretto core")
struct ParettoCoreTests {
    @Test("Bundled curriculum is complete and stable")
    func curriculumIntegrity() throws {
        let curriculum = try CurriculumLoader.bundled()
        #expect(curriculum.regions.count == 18)
        #expect(curriculum.lessons.count == 54)
        #expect(curriculum.words.count == 270)
        #expect(Set(curriculum.words.map(\.id)).count == 270)
        #expect(curriculum.course == .frenchFromEnglish)
        for region in curriculum.regions {
            #expect(curriculum.words(in: region.id).count == 15)
            for lesson in 1...3 {
                #expect(curriculum.words(in: region.id, lesson: lesson).count == 5)
            }
        }
    }

    @Test("A new learner never receives unseen review cards")
    func freshReviewIsEmpty() throws {
        let curriculum = try CurriculumLoader.bundled()
        let state = LearningState()
        #expect(LearningEngine.dueWords(state: state, curriculum: curriculum).isEmpty)
        #expect(LearningEngine.practiceWords(state: state, curriculum: curriculum).isEmpty)
    }

    @Test("Rating a card schedules it and records progress")
    func ratingSchedulesCard() throws {
        let curriculum = try CurriculumLoader.bundled()
        let word = try #require(curriculum.words.first)
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        var state = LearningState()
        let progress = try LearningEngine.rate(wordID: word.id, rating: .good, state: &state, now: now)
        #expect(progress.stage == 1)
        #expect(progress.seen == 1)
        #expect(progress.correct == 1)
        #expect(state.xp == 10)
        #expect(state.coins == 13)
        #expect(LearningEngine.learnedCount(state, curriculum: curriculum) == 1)
    }

    @Test("Again moves one memory stage back instead of erasing mastery")
    func againMovesBackOneStage() throws {
        let curriculum = try CurriculumLoader.bundled()
        let word = try #require(curriculum.words.first)
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        var state = LearningState()
        state.wordProgress[word.id] = WordProgress(
            stage: 4,
            seen: 8,
            correct: 7,
            incorrect: 1,
            nextReviewAt: now,
            lastReviewedAt: now.addingTimeInterval(-100)
        )

        let progress = try LearningEngine.rate(
            wordID: word.id,
            rating: .again,
            state: &state,
            now: now
        )

        #expect(progress.stage == 3)
        #expect(progress.incorrect == 2)
        #expect(progress.nextReviewAt == now.addingTimeInterval(10 * 60))
    }

    @Test("A completed region repeats its latest lesson, not its first")
    func completedRegionUsesLatestLesson() throws {
        let curriculum = try CurriculumLoader.bundled()
        let region = try #require(curriculum.regions.first)
        var state = LearningState()
        for word in curriculum.words(in: region.id) {
            try LearningEngine.markKnown(wordID: word.id, state: &state)
        }

        let lesson = LearningEngine.nextLesson(
            state: state,
            curriculum: curriculum,
            regionID: region.id
        )

        #expect(lesson.count == 5)
        #expect(lesson.allSatisfy { $0.lesson == 3 })
    }

    @Test("Reconciliation always preserves a valid unlocked current region")
    func reconciliationRepairsRegions() throws {
        let curriculum = try CurriculumLoader.bundled()
        var state = LearningState(
            currentRegionID: "removed-region",
            unlockedRegionIDs: ["removed-region", "removed-region"]
        )
        state.wordProgress["removed-word"] = WordProgress(
            stage: 1,
            seen: 1,
            correct: 1,
            incorrect: 0,
            nextReviewAt: .now,
            lastReviewedAt: .now
        )

        let repaired = LearningEngine.reconciled(state, curriculum: curriculum)

        #expect(repaired.currentRegionID == curriculum.regions.first?.id)
        #expect(repaired.unlockedRegionIDs == [curriculum.regions[0].id])
        #expect(repaired.wordProgress.isEmpty)
    }

    @Test("Cloud reconciliation unions learning without replaying rewards")
    func cloudMergePreservesBothDevices() throws {
        let curriculum = try CurriculumLoader.bundled()
        let remoteWord = curriculum.words[0]
        let localWord = curriculum.words[1]
        let remoteDate = Date(timeIntervalSince1970: 1_700_000_000)
        let localDate = remoteDate.addingTimeInterval(60)
        var remote = LearningState(
            onboarded: true,
            displayName: "Camille",
            xp: 80,
            coins: 11,
            updatedAt: remoteDate
        )
        remote.wordProgress[remoteWord.id] = WordProgress(
            stage: 2,
            seen: 2,
            correct: 2,
            incorrect: 0,
            nextReviewAt: remoteDate,
            lastReviewedAt: remoteDate
        )
        var local = LearningState(
            onboarded: true,
            displayName: "Camille",
            xp: 50,
            coins: 4,
            updatedAt: localDate
        )
        local.wordProgress[localWord.id] = WordProgress(
            stage: 1,
            seen: 1,
            correct: 1,
            incorrect: 0,
            nextReviewAt: localDate,
            lastReviewedAt: localDate
        )

        let merged = try LearningEngine.merged(
            server: remote,
            local: local,
            curriculum: curriculum
        )

        #expect(merged.wordProgress.count == 2)
        #expect(merged.xp == 80)
        #expect(merged.coins == 11)
        #expect(merged.updatedAt == localDate)
    }

    @Test("Concurrent devices keep both reward deltas without replay")
    func cloudMergeAddsIndependentRewardCounters() throws {
        let curriculum = try CurriculumLoader.bundled()
        let base = LearningState()
        var remote = base
        var local = base
        let now = Date(timeIntervalSince1970: 1_700_000_000)

        try LearningEngine.rate(
            wordID: curriculum.words[0].id,
            rating: .good,
            state: &remote,
            now: now,
            rewardReplicaID: "ios:11111111-1111-4111-8111-111111111111"
        )
        try LearningEngine.rate(
            wordID: curriculum.words[1].id,
            rating: .good,
            state: &local,
            now: now.addingTimeInterval(60),
            rewardReplicaID: "ios:22222222-2222-4222-8222-222222222222"
        )

        let merged = try LearningEngine.merged(
            server: remote,
            local: local,
            curriculum: curriculum
        )
        let replayed = try LearningEngine.merged(
            server: merged,
            local: local,
            curriculum: curriculum
        )

        #expect(merged.xp == 20)
        #expect(merged.coins == 14)
        #expect(merged.wordProgress.count == 2)
        #expect(replayed.xp == 20)
        #expect(replayed.coins == 14)
    }

    @Test("An existing cloud profile wins over a pristine new install")
    func cloudProfileWinsOverPristineInstall() throws {
        let curriculum = try CurriculumLoader.bundled()
        var remote = LearningState(onboarded: true, displayName: "Élodie")
        remote.dailyGoal = 15
        let merged = try LearningEngine.merged(
            server: remote,
            local: LearningState(),
            curriculum: curriculum
        )

        #expect(merged.displayName == "Élodie")
        #expect(merged.dailyGoal == 15)
        #expect(merged.onboarded)
    }

    @Test("Older saved states migrate challenge, dice, and collection defaults")
    func backwardCompatibleStateDecoding() throws {
        let encoded = try JSONEncoder().encode(LearningState(onboarded: true))
        var object = try #require(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        object.removeValue(forKey: "collectibles")
        object.removeValue(forKey: "challenge")
        object.removeValue(forKey: "dice")
        object.removeValue(forKey: "activeCourseId")
        object.removeValue(forKey: "courseProgress")
        let legacy = try JSONSerialization.data(withJSONObject: object)

        let decoded = try JSONDecoder().decode(LearningState.self, from: legacy)

        #expect(decoded.collectibles.isEmpty)
        #expect(decoded.challenge == ChallengeProgress())
        #expect(decoded.dice == DiceProgress())
        #expect(decoded.activeCourseID == CourseMetadata.frenchFromEnglish.id)
        #expect(
            decoded.courseProgress[decoded.activeCourseID]?.currentContextId
                == CourseMetadata.frenchFromEnglish.initialContextId
        )
    }

    @Test("Travel dice are bounded, once daily, and unlock keepsakes")
    func travelDiceRules() throws {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        var state = LearningState()
        state.wordProgress["learned-word"] = WordProgress(
            stage: 1,
            seen: 1,
            correct: 1,
            incorrect: 0,
            nextReviewAt: now,
            lastReviewedAt: now
        )

        let reward = try LearningEngine.rollDice(
            stake: 3,
            multiplierIndex: 5,
            state: &state,
            now: now,
            calendar: utcCalendar
        )

        #expect(reward == DiceReward(multiplier: 3, xp: 108, stake: 3))
        #expect(state.coins == 9)
        #expect(state.xp == 108)
        #expect(state.collectibles == ["metro-ticket"])
        #expect(
            state.dice.lastPlayedResult == DiceResult(
                date: state.dice.lastPlayedDate!,
                multiplier: 3,
                xp: 108,
                stake: 3
            )
        )
        #expect(
            try LearningEngine.rollDice(
                stake: 1,
                multiplierIndex: 0,
                state: &state,
                now: now,
                calendar: utcCalendar
            ) == nil
        )
    }

    @Test("The daily Château challenge rewards once and later runs are practice")
    func challengeRewardsOnce() throws {
        let curriculum = try CurriculumLoader.bundled()
        let words = Array(curriculum.words.prefix(3))
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        var state = LearningState()
        for word in words {
            state.wordProgress[word.id] = WordProgress(
                stage: 1,
                seen: 1,
                correct: 1,
                incorrect: 0,
                nextReviewAt: now,
                lastReviewedAt: now
            )
        }
        for (index, word) in words.enumerated() {
            try LearningEngine.rateChallengeAnswer(
                wordID: word.id,
                correct: index < 2,
                rewardEligible: true,
                state: &state,
                now: now,
                calendar: utcCalendar
            )
        }
        let reward = try LearningEngine.completeChallenge(
            regionID: words[0].regionID,
            words: words,
            correct: 2,
            rewardEligible: true,
            curriculum: curriculum,
            state: &state,
            now: now,
            calendar: utcCalendar
        )

        #expect(reward == ChallengeReward(xp: 34, coins: 3))
        #expect(state.xp == 34)
        #expect(state.coins == 15)
        #expect(state.challenge.bestScore == 2)
        #expect(state.sessions.first?.mode == "challenge")
        #expect(!LearningEngine.challengeRewardEligible(state: state, now: now, calendar: utcCalendar))

        let xpBeforePractice = state.xp
        let practiceReward = try LearningEngine.completeChallenge(
            regionID: words[0].regionID,
            words: words,
            correct: 3,
            rewardEligible: false,
            curriculum: curriculum,
            state: &state,
            now: now,
            calendar: utcCalendar
        )
        #expect(practiceReward == ChallengeReward(xp: 0, coins: 0))
        #expect(state.xp == xpBeforePractice)
        #expect(state.challenge.bestScore == 3)
    }

    @Test("Concurrent dice claims admit one reward and its matching receipt")
    func concurrentDiceClaimsAreIdempotent() throws {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        var remote = LearningState(coins: 5)
        var local = LearningState(coins: 5)
        let learned = WordProgress(
            stage: 1,
            seen: 1,
            correct: 1,
            incorrect: 0,
            nextReviewAt: now,
            lastReviewedAt: now
        )
        remote.wordProgress["learned-word"] = learned
        local.wordProgress["learned-word"] = learned
        _ = try LearningEngine.rollDice(
            stake: 5,
            multiplierIndex: 5,
            state: &remote,
            now: now,
            calendar: utcCalendar,
            rewardReplicaID: "ios:11111111-1111-4111-8111-111111111111"
        )
        _ = try LearningEngine.rollDice(
            stake: 5,
            multiplierIndex: 0,
            state: &local,
            now: now,
            calendar: utcCalendar,
            rewardReplicaID: "ios:22222222-2222-4222-8222-222222222222"
        )
        let curriculum = try CurriculumLoader.bundled()

        let merged = try LearningEngine.merged(
            server: remote,
            local: local,
            curriculum: curriculum
        )

        #expect(merged.xp == 180)
        #expect(merged.coins == 0)
        #expect(merged.rewardJournal.claims.count == 1)
        #expect(merged.dice.lastPlayedResult == remote.dice.lastPlayedResult)
    }

    @Test("Legacy numeric rewards do not replay journaled history")
    func legacyRewardMigrationDoesNotDoubleCount() throws {
        let curriculum = try CurriculumLoader.bundled()
        var modern = LearningState()
        try LearningEngine.rate(
            wordID: curriculum.words[0].id,
            rating: .good,
            state: &modern,
            rewardReplicaID: "ios:11111111-1111-4111-8111-111111111111"
        )
        let encoded = try JSONEncoder().encode(modern)
        var legacyObject = try #require(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        legacyObject.removeValue(forKey: "rewardJournal")
        let legacyData = try JSONSerialization.data(withJSONObject: legacyObject)
        let legacy = try JSONDecoder().decode(LearningState.self, from: legacyData)

        let merged = try LearningEngine.merged(
            server: modern,
            local: legacy,
            curriculum: curriculum
        )

        #expect(merged.xp == 10)
        #expect(merged.coins == 13)
    }

    @Test("Reward replica IDs are isolated by account scope")
    func rewardReplicaIdentityIsAccountScoped() throws {
        let suiteName = "reward-replica-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let accountA = LearningEngine.rewardReplicaID(
            identityScope: String(repeating: "a", count: 64),
            userDefaults: defaults
        )
        let accountB = LearningEngine.rewardReplicaID(
            identityScope: String(repeating: "b", count: 64),
            userDefaults: defaults
        )

        #expect(accountA != accountB)
        #expect(!accountA.contains(String(repeating: "a", count: 64)))
        #expect(!accountB.contains(String(repeating: "b", count: 64)))
    }

    @Test("Replica capacity and epochs fail closed without dropping offline work")
    func rewardReplicaCapacityFailsClosed() throws {
        let curriculum = try CurriculumLoader.bundled()
        var remoteReplicas: [String: RewardReplicaCounter] = [:]
        var localReplicas: [String: RewardReplicaCounter] = [:]
        for index in 0..<256 {
            remoteReplicas["ios2:r\(index):00000000-0000-4000-8000-000000000001"] =
                RewardReplicaCounter(xpEarned: 1)
        }
        for index in 0..<257 {
            localReplicas["ios2:l\(index):00000000-0000-4000-8000-000000000002"] =
                RewardReplicaCounter(xpEarned: 1)
        }
        let remote = LearningState(
            rewardJournal: RewardJournal(replicas: remoteReplicas)
        )
        let local = LearningState(
            rewardJournal: RewardJournal(replicas: localReplicas)
        )
        #expect(throws: RewardJournalError.capacityReached) {
            try LearningEngine.merged(
                server: remote,
                local: local,
                curriculum: curriculum
            )
        }

        var advanced = LearningState()
        advanced.rewardJournal.replicaEpoch = 1
        var oldOffline = LearningState()
        try LearningEngine.rate(
            wordID: curriculum.words[0].id,
            rating: .good,
            state: &oldOffline,
            rewardReplicaID: "ios:11111111-1111-4111-8111-111111111111"
        )
        #expect(throws: RewardJournalError.epochMismatch) {
            try LearningEngine.merged(
                server: advanced,
                local: oldOffline,
                curriculum: curriculum
            )
        }
        #expect(oldOffline.xp == 10)

        var fullClaimState = LearningState()
        fullClaimState.wordProgress["learned-word"] = WordProgress(
            stage: 1,
            seen: 1,
            correct: 1,
            incorrect: 0,
            nextReviewAt: .now,
            lastReviewedAt: .now
        )
        for index in 0..<512 {
            fullClaimState.rewardJournal.claims["entitlement:bounded:\(index)"] =
                RewardClaim(
                    replicaId: "ios:11111111-1111-4111-8111-111111111111"
                )
        }
        let fullClaimSnapshot = fullClaimState
        #expect(throws: RewardJournalError.capacityReached) {
            _ = try LearningEngine.rollDice(
                stake: 1,
                multiplierIndex: 1,
                state: &fullClaimState,
                rewardReplicaID: "ios:11111111-1111-4111-8111-111111111111"
            )
        }
        #expect(fullClaimState == fullClaimSnapshot)
    }

    @Test("Daily claims require coordinated compaction and never retire locally")
    func dailyClaimCompactionRequiresCoordination() throws {
        var claims: [String: RewardClaim] = [:]
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let start = try #require(
            calendar.date(from: DateComponents(year: 2026, month: 1, day: 1))
        )
        for index in 0..<70 {
            let date = try #require(
                calendar.date(byAdding: .day, value: index, to: start)
            )
            let components = calendar.dateComponents([.year, .month, .day], from: date)
            let day = String(
                format: "%04d-%02d-%02d",
                components.year!,
                components.month!,
                components.day!
            )
            claims["daily:challenge:\(day)"] = RewardClaim(
                replicaId: "ios:11111111-1111-4111-8111-111111111111",
                xpEarned: 1
            )
        }
        let state = LearningState(
            xp: 70,
            rewardJournal: RewardJournal(claims: claims)
        )
        let curriculum = try CurriculumLoader.bundled()

        let merged = try LearningEngine.merged(
            server: state,
            local: state,
            curriculum: curriculum
        )

        #expect(merged.rewardJournal.claims.count == 70)
        #expect(merged.rewardJournal.claimDayFloor == nil)
        #expect(merged.xp == 70)

        var compactedElsewhere = state
        compactedElsewhere.rewardJournal.claimDayFloor = "2026-01-05"
        #expect(throws: RewardJournalError.epochMismatch) {
            try LearningEngine.merged(
                server: compactedElsewhere,
                local: state,
                curriculum: curriculum
            )
        }
        #expect(state.rewardJournal.claims.count == 70)
        #expect(state.xp == 70)

        var paidClaims = claims
        for (claimID, claim) in paidClaims {
            paidClaims[claimID] = RewardClaim(
                replicaId: claim.replicaId,
                coinsSpent: 1
            )
        }
        let paid = LearningState(
            coins: 30,
            rewardJournal: RewardJournal(
                baselineCoins: 100,
                claims: paidClaims
            )
        )
        let oldOffline = LearningState(
            coins: 100,
            rewardJournal: RewardJournal(baselineCoins: 100)
        )
        let firstMerge = try LearningEngine.merged(
            server: paid,
            local: oldOffline,
            curriculum: curriculum
        )
        let secondMerge = try LearningEngine.merged(
            server: firstMerge,
            local: oldOffline,
            curriculum: curriculum
        )
        #expect(secondMerge.coins == 30)
        #expect(secondMerge.rewardJournal.claimDayFloor == nil)
        #expect(secondMerge.rewardJournal.claims.count == 70)
    }

    @Test("Persistence round trips and deletes safely")
    func persistenceRoundTrip() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = directory.appendingPathComponent("state.json")
        let repository = ProgressRepository(fileURL: file)
        var state = LearningState(onboarded: true, displayName: "Camille")
        state.xp = 42
        try await repository.save(state)
        #expect(try await repository.load() == state)
        try await repository.delete()
        #expect(try await repository.load() == nil)
    }

    @Test("Persistence binds progress and reset generation to an opaque account scope")
    func scopedPersistenceRoundTrip() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("state.json")
        let repository = ProgressRepository(fileURL: file)
        let state = LearningState(
            onboarded: true,
            displayName: "Scoped Camille",
            xp: 84
        )
        let stored = StoredLearningProgress(
            accountScope: String(repeating: "a", count: 64),
            serverGeneration: 3,
            state: state
        )

        try await repository.saveStoredProgress(stored)

        #expect(try await repository.loadStoredProgress() == stored)
        #expect(try await repository.load() == state)
    }

    @Test("Legacy state files decode as unowned and cannot impersonate an account")
    func legacyPersistenceIsUnowned() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        let file = directory.appendingPathComponent("state.json")
        let state = LearningState(
            onboarded: true,
            displayName: "Legacy Camille",
            xp: 42
        )
        try JSONEncoder().encode(state).write(to: file)
        let repository = ProgressRepository(fileURL: file)

        let stored = try await repository.loadStoredProgress()

        #expect(stored?.state == state)
        #expect(stored?.accountScope == nil)
        #expect(stored?.serverGeneration == nil)
    }

    @Test("Legacy application-support progress migrates to Paretto")
    func legacyProgressMigration() throws {
        // Both names are intentionally retained to prove compatibility with
        // the two development-era storage locations.
        for legacyName in ["Loquivo", "PasAPas"] {
            let base = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            defer { try? FileManager.default.removeItem(at: base) }
            let legacyDirectory = base.appendingPathComponent(legacyName, isDirectory: true)
            try FileManager.default.createDirectory(
                at: legacyDirectory,
                withIntermediateDirectories: true
            )
            let legacy = legacyDirectory.appendingPathComponent("learning-state.json")
            let data = Data("legacy-progress".utf8)
            try data.write(to: legacy)

            let migrated = try ProgressRepository.applicationSupportURL(in: base)

            #expect(migrated == base.appendingPathComponent("Paretto/learning-state.json"))
            #expect(try Data(contentsOf: migrated) == data)
            #expect(!FileManager.default.fileExists(atPath: legacy.path))
        }
    }


    private var utcCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }
}
