import AuthenticationServices
import Combine
import Foundation
import PasAPasCore

enum SyncStatus: Equatable {
    case local
    case syncing
    case saved(Date?)
    case offline
    case error(String)
}

@MainActor
final class AppModel: ObservableObject {
    static let sessionCompletionBonusXP = 18
    static let progressSuppressionKey = "pas-a-pas.ignore-persisted-progress"
    static let authSuppressionKey = "pas-a-pas.ignore-keychain-session"

    @Published private(set) var state: LearningState
    @Published private(set) var curriculum: CurriculumBundle
    @Published private(set) var isReady = false
    @Published private(set) var startupError: String?
    @Published private(set) var authSession: AuthSession?
    @Published private(set) var syncStatus: SyncStatus = .local
    @Published var lessonWords: [FrenchWord] = []
    @Published var lessonMode = "learn"
    @Published var alertMessage: String?

    let environment: AppEnvironment
    let audio = FrenchAudioPlayer()

    private let repository: any ProgressStoring
    private let api: any NativeAPIProviding
    private let sessionStore: AuthenticationSessionStore
    private let userDefaults: UserDefaults
    private var serverRevision = 0
    private var saveTask: Task<Void, Never>?

    init(
        environment: AppEnvironment = .current,
        repositoryURL: URL? = nil,
        loadsKeychain: Bool = true,
        progressStore: (any ProgressStoring)? = nil,
        apiClient: (any NativeAPIProviding)? = nil,
        sessionStore: AuthenticationSessionStore = .keychain,
        userDefaults: UserDefaults = .standard
    ) {
        self.environment = environment
        self.sessionStore = sessionStore
        self.userDefaults = userDefaults
        var startupMessages: [String] = []
        do {
            self.curriculum = try CurriculumLoader.bundled()
        } catch {
            self.curriculum = CurriculumBundle(
                schemaVersion: 1,
                revision: "unavailable",
                audioAssetVersion: "unavailable",
                audioAttributionPath: "",
                regions: [],
                lessons: [],
                words: []
            )
            startupMessages.append("The bundled French curriculum is missing or unreadable.")
        }
        if let progressStore {
            self.repository = progressStore
        } else if let repositoryURL {
            self.repository = ProgressRepository(fileURL: repositoryURL)
        } else {
            do {
                self.repository = ProgressRepository(
                    fileURL: try ProgressRepository.applicationSupportURL()
                )
            } catch {
                self.repository = ProgressRepository(
                    fileURL: FileManager.default.temporaryDirectory
                        .appendingPathComponent("pas-a-pas-unavailable-state.json")
                )
                startupMessages.append("Protected on-device storage is unavailable.")
            }
        }
        self.api = apiClient ?? APIClient(environment: environment)
        self.state = LearningState()
        do {
            self.authSession = loadsKeychain
                && !userDefaults.bool(forKey: Self.authSuppressionKey)
                ? try sessionStore.load()
                : nil
        } catch {
            self.authSession = nil
            self.alertMessage = "Your secure session could not be read. Please sign in again."
        }
        self.startupError = startupMessages.isEmpty
            ? nil
            : startupMessages.joined(separator: " ")
    }

    var isAuthenticated: Bool {
        if environment.allowsGuestMode && authSession == nil { return true }
        guard let authSession else { return false }
        return authSession.expiresAt > .now
    }

    func load() async {
        if ProcessInfo.processInfo.arguments.contains("-reset-state") {
            userDefaults.set(true, forKey: Self.progressSuppressionKey)
            if await clearPersistedProgress() {
                userDefaults.removeObject(forKey: Self.progressSuppressionKey)
            }
            do {
                try sessionStore.delete()
                userDefaults.removeObject(forKey: Self.authSuppressionKey)
            } catch {
                userDefaults.set(true, forKey: Self.authSuppressionKey)
            }
            state = LearningState()
            authSession = nil
        }
        if userDefaults.bool(forKey: Self.progressSuppressionKey) {
            state = LearningState()
            if await clearPersistedProgress() {
                userDefaults.removeObject(forKey: Self.progressSuppressionKey)
            } else {
                syncStatus = .error("Old progress is quarantined on this device.")
                alertMessage = "An old local progress file could not be erased, so Pas à Pas will not load it."
            }
        } else {
            do {
                if let cached = try await repository.load() {
                    state = LearningEngine.reconciled(cached, curriculum: curriculum)
                }
            } catch {
                syncStatus = .error("Saved progress could not be read on this device.")
                alertMessage = "Saved progress could not be read. Signed-in progress will be recovered from the service when available."
            }
        }
        isReady = true
        guard let token = authSession?.accessToken else { return }
        await synchronize(accessToken: token)
    }

    func completeOnboarding(name: String, dailyGoal: Int) {
        state.onboarded = true
        state.displayName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        state.dailyGoal = dailyGoal
        // Retained in the persisted schema for compatibility only. The native
        // app does not emit product analytics events.
        state.settings.analytics = false
        state.updatedAt = .now
        persistAndSync()
    }

    @discardableResult
    func startLearning(regionID: String? = nil) -> Bool {
        let selected = regionID ?? state.currentRegionID
        guard state.unlockedRegionIDs.contains(selected),
              curriculum.region(id: selected) != nil
        else { return false }
        let changedRegion = state.currentRegionID != selected
        state.currentRegionID = selected
        lessonMode = "learn"
        lessonWords = LearningEngine.nextLesson(
            state: state,
            curriculum: curriculum,
            regionID: selected
        )
        if changedRegion {
            state.updatedAt = .now
            persistAndSync()
        }
        return !lessonWords.isEmpty
    }

    @discardableResult
    func startReview() -> Bool {
        let due = LearningEngine.dueWords(state: state, curriculum: curriculum)
        let practice = LearningEngine.practiceWords(state: state, curriculum: curriculum)
        lessonMode = "review"
        lessonWords = due.isEmpty ? practice : due
        return !lessonWords.isEmpty
    }

    func rate(_ word: FrenchWord, rating: MasteryRating) {
        LearningEngine.rate(wordID: word.id, rating: rating, state: &state)
        persistAndSync()
    }

    func markKnown(_ word: FrenchWord) {
        LearningEngine.markKnown(wordID: word.id, state: &state)
        persistAndSync()
    }

    func challengeWords() -> [FrenchWord] {
        Array(
            curriculum.words
                .filter { state.wordProgress[$0.id] != nil }
                .prefix(5)
        )
    }

    func rateChallengeAnswer(
        _ word: FrenchWord,
        correct: Bool,
        rewardEligible: Bool
    ) {
        LearningEngine.rateChallengeAnswer(
            wordID: word.id,
            correct: correct,
            rewardEligible: rewardEligible,
            state: &state
        )
        if rewardEligible { persistAndSync() }
    }

    @discardableResult
    func finishChallenge(
        words: [FrenchWord],
        correct: Int,
        rewardEligible: Bool
    ) -> ChallengeReward {
        let reward = LearningEngine.completeChallenge(
            regionID: words.first?.regionID ?? state.currentRegionID,
            words: words,
            correct: correct,
            rewardEligible: rewardEligible,
            curriculum: curriculum,
            state: &state
        )
        persistAndSync()
        return reward
    }

    @discardableResult
    func rollDice(stake: Int) -> DiceReward? {
        guard let reward = LearningEngine.rollDice(
            stake: stake,
            multiplierIndex: Int.random(in: LearningEngine.diceMultipliers.indices),
            state: &state
        ) else { return nil }
        persistAndSync()
        return reward
    }

    func finishLesson(correct: Int) {
        guard !lessonWords.isEmpty else { return }
        LearningEngine.completeSession(
            mode: lessonMode,
            regionID: lessonWords[0].regionID,
            words: lessonWords,
            correct: correct,
            xpEarned: Self.sessionCompletionBonusXP,
            curriculum: curriculum,
            state: &state
        )
        persistAndSync()
    }

    func updateSettings(_ mutate: (inout LearningSettings) -> Void) {
        mutate(&state.settings)
        state.updatedAt = .now
        persistAndSync()
    }

    func authenticate(
        credential: ASAuthorizationAppleIDCredential,
        rawNonce: String
    ) async {
        guard let identityToken = credential.identityToken else {
            alertMessage = "Apple did not provide a valid identity token."
            return
        }
        do {
            let appleName = [
                credential.fullName?.givenName,
                credential.fullName?.familyName,
            ]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            let session = try await api.signInWithApple(
                identityToken: identityToken,
                authorizationCode: credential.authorizationCode,
                rawNonce: rawNonce,
                displayName: appleName.isEmpty ? nil : appleName
            )
            try sessionStore.save(session)
            userDefaults.removeObject(forKey: Self.authSuppressionKey)
            authSession = session
            await synchronize(accessToken: session.accessToken)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func signOut() async {
        await cancelPendingSave()
        let token = authSession?.accessToken

        userDefaults.set(true, forKey: Self.progressSuppressionKey)
        do {
            try sessionStore.delete()
        } catch {
            userDefaults.removeObject(forKey: Self.progressSuppressionKey)
            alertMessage = "Sign-out could not securely remove this device’s session. Your local account remains open; please try again."
            return
        }

        if let token {
            // Revocation is deliberately best effort: an offline service must
            // never trap private learning data on a shared device after the
            // Keychain session has been securely removed.
            try? await api.revokeSession(accessToken: token)
        }

        userDefaults.removeObject(forKey: Self.authSuppressionKey)
        authSession = nil
        serverRevision = 0
        state = LearningState()
        lessonWords = []
        if await clearPersistedProgress() {
            userDefaults.removeObject(forKey: Self.progressSuppressionKey)
        } else {
            alertMessage = "Signed out securely. An old progress file is quarantined and will not be loaded; reinstall the app to remove it completely."
        }
        syncStatus = .local
    }

    func deleteLearningData() async {
        await cancelPendingSave()
        if let token = authSession?.accessToken {
            do {
                try await api.deleteAccount(accessToken: token)
            } catch {
                alertMessage = error.localizedDescription
                return
            }
        }

        state = LearningState()
        lessonWords = []
        authSession = nil
        serverRevision = 0
        syncStatus = .local
        userDefaults.set(true, forKey: Self.progressSuppressionKey)
        do {
            try sessionStore.delete()
            userDefaults.removeObject(forKey: Self.authSuppressionKey)
        } catch {
            userDefaults.set(true, forKey: Self.authSuppressionKey)
        }
        if await clearPersistedProgress() {
            userDefaults.removeObject(forKey: Self.progressSuppressionKey)
        } else {
            alertMessage = "Your account was deleted. An old progress file is quarantined and will not be loaded; reinstall the app to remove it completely."
        }
    }

    func exportData() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(state)
    }

    private func persistAndSync() {
        saveTask?.cancel()
        let snapshot = state
        let token = authSession?.accessToken
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            do {
                try await repository.save(snapshot)
            } catch {
                syncStatus = .error("Progress could not be saved on this device.")
                return
            }
            guard !Task.isCancelled else { return }
            if let token { await synchronize(accessToken: token) }
        }
    }

    private func synchronize(accessToken: String) async {
        syncStatus = .syncing
        do {
            let remote = try await api.loadProgress(accessToken: accessToken)
            serverRevision = remote.revision
            let remoteState = LearningEngine.reconciled(remote.state, curriculum: curriculum)
            let merged = LearningEngine.merged(
                server: remoteState,
                local: state,
                curriculum: curriculum
            )
            state = merged
            try await repository.save(merged)
            if merged == remoteState {
                syncStatus = .saved(remote.savedAt)
                return
            }
            let saved = try await api.saveProgress(
                merged,
                revision: serverRevision,
                accessToken: accessToken
            )
            serverRevision = saved.revision
            syncStatus = .saved(saved.savedAt)
        } catch APIError.conflict(let remote) {
            serverRevision = remote.revision
            let remoteState = LearningEngine.reconciled(remote.state, curriculum: curriculum)
            let merged = LearningEngine.merged(
                server: remoteState,
                local: state,
                curriculum: curriculum
            )
            state = merged
            do {
                try await repository.save(merged)
                if merged != remoteState {
                    let saved = try await api.saveProgress(
                        merged,
                        revision: serverRevision,
                        accessToken: accessToken
                    )
                    serverRevision = saved.revision
                    syncStatus = .saved(saved.savedAt)
                    return
                }
                syncStatus = .saved(remote.savedAt)
            } catch {
                syncStatus = .offline
            }
        } catch APIError.notConfigured {
            syncStatus = .local
        } catch APIError.unauthorized {
            do {
                try sessionStore.delete()
                userDefaults.removeObject(forKey: Self.authSuppressionKey)
            } catch {
                userDefaults.set(true, forKey: Self.authSuppressionKey)
            }
            authSession = nil
            serverRevision = 0
            syncStatus = .error("Please sign in again.")
        } catch {
            syncStatus = .offline
        }
    }

    private func clearPersistedProgress() async -> Bool {
        do {
            try await repository.delete()
            return true
        } catch {
            do {
                try await repository.save(LearningState())
                return true
            } catch {
                return false
            }
        }
    }

    private func cancelPendingSave() async {
        guard let pendingSave = saveTask else { return }
        saveTask = nil
        pendingSave.cancel()
        // Waiting closes the race where an already-running file write could
        // otherwise recreate private progress after sign-out has erased it.
        await pendingSave.value
    }
}
