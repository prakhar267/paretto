import Foundation
import Testing
@testable import LoquivoCore

@Suite("Loquivo core")
struct LoquivoCoreTests {
    @Test("Bundled curriculum is complete and stable")
    func curriculumIntegrity() throws {
        let curriculum = try CurriculumLoader.bundled()
        #expect(curriculum.regions.count == 18)
        #expect(curriculum.lessons.count == 54)
        #expect(curriculum.words.count == 270)
        #expect(Set(curriculum.words.map(\.id)).count == 270)
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
        let progress = LearningEngine.rate(wordID: word.id, rating: .good, state: &state, now: now)
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

        let progress = LearningEngine.rate(
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
            LearningEngine.markKnown(wordID: word.id, state: &state)
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

        let merged = LearningEngine.merged(
            server: remote,
            local: local,
            curriculum: curriculum
        )

        #expect(merged.wordProgress.count == 2)
        #expect(merged.xp == 80)
        #expect(merged.coins == 11)
        #expect(merged.updatedAt == localDate)
    }

    @Test("An existing cloud profile wins over a pristine new install")
    func cloudProfileWinsOverPristineInstall() throws {
        let curriculum = try CurriculumLoader.bundled()
        var remote = LearningState(onboarded: true, displayName: "Élodie")
        remote.dailyGoal = 15
        let merged = LearningEngine.merged(
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
        let legacy = try JSONSerialization.data(withJSONObject: object)

        let decoded = try JSONDecoder().decode(LearningState.self, from: legacy)

        #expect(decoded.collectibles.isEmpty)
        #expect(decoded.challenge == ChallengeProgress())
        #expect(decoded.dice == DiceProgress())
    }

    @Test("Travel dice are bounded, once daily, and unlock keepsakes")
    func travelDiceRules() {
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

        let reward = LearningEngine.rollDice(
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
            LearningEngine.rollDice(
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
            LearningEngine.rateChallengeAnswer(
                wordID: word.id,
                correct: index < 2,
                rewardEligible: true,
                state: &state,
                now: now,
                calendar: utcCalendar
            )
        }
        let reward = LearningEngine.completeChallenge(
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
        let practiceReward = LearningEngine.completeChallenge(
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

    @Test("Legacy application-support progress migrates to Loquivo")
    func legacyProgressMigration() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: base) }
        let legacyDirectory = base.appendingPathComponent("PasAPas", isDirectory: true)
        try FileManager.default.createDirectory(
            at: legacyDirectory,
            withIntermediateDirectories: true
        )
        let legacy = legacyDirectory.appendingPathComponent("learning-state.json")
        let data = Data("legacy-progress".utf8)
        try data.write(to: legacy)

        let migrated = try ProgressRepository.applicationSupportURL(in: base)

        #expect(migrated == base.appendingPathComponent("Loquivo/learning-state.json"))
        #expect(try Data(contentsOf: migrated) == data)
        #expect(!FileManager.default.fileExists(atPath: legacy.path))
    }


    private var utcCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }
}
