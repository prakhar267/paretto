import AuthenticationServices
import Combine
import Foundation
import ParettoCore

enum SyncStatus: Equatable {
    case local
    case syncing
    case saved(Date?)
    case offline
    case error(String)
}

enum AppleCredentialStatus: Equatable, Sendable {
    case authorized
    case revoked
    case notFound
    case transferred
    case unknown
}

struct AppleCredentialStateChecking: Sendable {
    let state: @Sendable (String) async throws -> AppleCredentialStatus

    static let live = AppleCredentialStateChecking { userID in
        try await withCheckedThrowingContinuation { continuation in
            ASAuthorizationAppleIDProvider().getCredentialState(
                forUserID: userID
            ) { state, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                switch state {
                case .authorized:
                    continuation.resume(returning: .authorized)
                case .revoked:
                    continuation.resume(returning: .revoked)
                case .notFound:
                    continuation.resume(returning: .notFound)
                case .transferred:
                    continuation.resume(returning: .transferred)
                @unknown default:
                    continuation.resume(returning: .unknown)
                }
            }
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    static let sessionCompletionBonusXP = 18
    static let progressSuppressionKey = "paretto.ignore-persisted-progress"
    static let authSuppressionKey = "paretto.ignore-keychain-session"
    static let progressGenerationKey = "paretto.progress-reset-generation"
    // Newest legacy values win if more than one development build left data
    // behind. These literal keys must remain stable until migration is retired.
    private static let legacyProgressSuppressionKeys = [
        "loquivo.ignore-persisted-progress", // Loquivo 1.1 development builds
        "pas-a-pas.ignore-persisted-progress", // Original development builds
    ]
    private static let legacyAuthSuppressionKeys = [
        "loquivo.ignore-keychain-session", // Loquivo 1.1 development builds
        "pas-a-pas.ignore-keychain-session", // Original development builds
    ]

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
    private let appleCredentialState: AppleCredentialStateChecking
    private let userDefaults: UserDefaults
    private var serverRevision = 0
    private var serverGeneration: Int?
    private var localAccountScope: String?
    private var saveTask: Task<Void, Never>?
    private var rewardReplicaID: String {
        LearningEngine.rewardReplicaID(
            identityScope: localAccountScope ?? "guest",
            userDefaults: userDefaults
        )
    }

    init(
        environment: AppEnvironment = .current,
        repositoryURL: URL? = nil,
        loadsKeychain: Bool = true,
        progressStore: (any ProgressStoring)? = nil,
        apiClient: (any NativeAPIProviding)? = nil,
        sessionStore: AuthenticationSessionStore = .keychain,
        appleCredentialState: AppleCredentialStateChecking = .live,
        userDefaults: UserDefaults = .standard
    ) {
        self.environment = environment
        self.sessionStore = sessionStore
        self.appleCredentialState = appleCredentialState
        self.userDefaults = userDefaults
        // Reset generations used to live in one unscoped UserDefaults key.
        // They now travel atomically with the account-scoped progress record.
        userDefaults.removeObject(forKey: Self.progressGenerationKey)
        Self.migrateLegacyDefaults(in: userDefaults)
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
                        .appendingPathComponent("paretto-unavailable-state.json")
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

    private static func migrateLegacyDefaults(in defaults: UserDefaults) {
        let migrations = [
            (legacyProgressSuppressionKeys, progressSuppressionKey),
            (legacyAuthSuppressionKeys, authSuppressionKey),
        ]
        for (legacyKeys, currentKey) in migrations {
            if defaults.object(forKey: currentKey) == nil {
                for legacyKey in legacyKeys {
                    guard let legacyValue = defaults.object(forKey: legacyKey) else {
                        continue
                    }
                    defaults.set(legacyValue, forKey: currentKey)
                    break
                }
            }
            for legacyKey in legacyKeys {
                defaults.removeObject(forKey: legacyKey)
            }
        }
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
        await validateStoredAppleCredential()
        if userDefaults.bool(forKey: Self.progressSuppressionKey) {
            state = LearningState()
            if await clearPersistedProgress() {
                userDefaults.removeObject(forKey: Self.progressSuppressionKey)
            } else {
                syncStatus = .error("Old progress is quarantined on this device.")
                alertMessage = "An old local progress file could not be erased, so Paretto will not load it."
            }
        } else {
            do {
                if let cached = try await repository.loadProgress() {
                    if canLoadPersistedProgress(cached) {
                        state = LearningEngine.reconciled(
                            cached.state,
                            curriculum: curriculum
                        )
                        localAccountScope = cached.accountScope
                        serverGeneration = cached.serverGeneration
                    } else {
                        await quarantineLocalProgress(
                            message: "Progress from a different or unknown account was quarantined on this device."
                        )
                    }
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
        do {
            try LearningEngine.rate(
                wordID: word.id,
                rating: rating,
                state: &state,
                rewardReplicaID: rewardReplicaID
            )
        } catch {
            alertMessage = "This device cannot add another reward replica until progress is reconciled."
            return
        }
        persistAndSync()
    }

    func markKnown(_ word: FrenchWord) {
        do {
            try LearningEngine.markKnown(
                wordID: word.id,
                state: &state,
                rewardReplicaID: rewardReplicaID
            )
        } catch {
            alertMessage = "This device cannot add another reward replica until progress is reconciled."
            return
        }
        persistAndSync()
    }

    func challengeWords(
        now: Date = .now,
        calendar: Calendar = .current
    ) -> [FrenchWord] {
        let learned = curriculum.words.filter {
            state.wordProgress[$0.id] != nil
        }
        guard !learned.isEmpty else { return [] }

        let localDay = calendar.dateComponents(
            [.year, .month, .day],
            from: now
        )
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let utcDay = utcCalendar.date(from: localDay) else {
            return Array(learned.prefix(5))
        }
        let dayNumber = Int(floor(utcDay.timeIntervalSince1970 / 86_400))
        let offset = ((dayNumber % learned.count) + learned.count) % learned.count
        let rotated =
            Array(learned[offset...]) + Array(learned[..<offset])
        return Array(rotated.prefix(5))
    }

    func rateChallengeAnswer(
        _ word: FrenchWord,
        correct: Bool,
        rewardEligible: Bool
    ) {
        do {
            try LearningEngine.rateChallengeAnswer(
                wordID: word.id,
                correct: correct,
                rewardEligible: rewardEligible,
                state: &state,
                rewardReplicaID: rewardReplicaID
            )
        } catch {
            alertMessage = "The challenge could not update this reward journal."
            return
        }
        if rewardEligible { persistAndSync() }
    }

    @discardableResult
    func finishChallenge(
        words: [FrenchWord],
        correct: Int,
        rewardEligible: Bool
    ) -> ChallengeReward {
        let reward: ChallengeReward
        do {
            reward = try LearningEngine.completeChallenge(
                regionID: words.first?.regionID ?? state.currentRegionID,
                words: words,
                correct: correct,
                rewardEligible: rewardEligible,
                curriculum: curriculum,
                state: &state,
                rewardReplicaID: rewardReplicaID
            )
        } catch {
            alertMessage = "The challenge reward could not be recorded safely."
            return ChallengeReward(xp: 0, coins: 0)
        }
        persistAndSync()
        return reward
    }

    @discardableResult
    func rollDice(stake: Int) -> DiceReward? {
        let reward: DiceReward?
        do {
            reward = try LearningEngine.rollDice(
                stake: stake,
                multiplierIndex: Int.random(in: LearningEngine.diceMultipliers.indices),
                state: &state,
                rewardReplicaID: rewardReplicaID
            )
        } catch {
            alertMessage = "The dice reward could not be recorded safely."
            return nil
        }
        guard let reward else { return nil }
        persistAndSync()
        return reward
    }

    func finishLesson(correct: Int) {
        guard !lessonWords.isEmpty else { return }
        do {
            try LearningEngine.completeSession(
                mode: lessonMode,
                regionID: lessonWords[0].regionID,
                words: lessonWords,
                correct: correct,
                xpEarned: Self.sessionCompletionBonusXP,
                curriculum: curriculum,
                state: &state,
                rewardReplicaID: rewardReplicaID
            )
        } catch {
            alertMessage = "The lesson reward could not be recorded safely."
            return
        }
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
        let appleName = [
            credential.fullName?.givenName,
            credential.fullName?.familyName,
        ]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        await authenticate(
            identityToken: identityToken,
            authorizationCode: credential.authorizationCode,
            appleUserID: credential.user,
            rawNonce: rawNonce,
            displayName: appleName.isEmpty ? nil : appleName
        )
    }

    func authenticate(
        identityToken: Data,
        authorizationCode: Data?,
        appleUserID: String,
        rawNonce: String,
        displayName: String?
    ) async {
        guard let appleUserID = validatedAppleUserID(appleUserID) else {
            alertMessage = "Apple did not provide a valid account identifier."
            return
        }
        do {
            let remoteSession = try await api.signInWithApple(
                identityToken: identityToken,
                authorizationCode: authorizationCode,
                rawNonce: rawNonce,
                displayName: displayName
            )
            let session = AuthSession(
                accessToken: remoteSession.accessToken,
                expiresAt: remoteSession.expiresAt,
                displayName: remoteSession.displayName,
                syncScope: remoteSession.syncScope,
                accountScope: remoteSession.accountScope,
                appleUserID: appleUserID
            )
            guard let accountScope = validatedAccountScope(session.accountScope)
            else { throw APIError.invalidResponse }
            await cancelPendingSave()
            if localAccountScope != accountScope {
                await quarantineLocalProgress(
                    message: "Progress from the previous account was quarantined before sign-in."
                )
                serverRevision = 0
                serverGeneration = nil
            }
            try sessionStore.save(session)
            userDefaults.removeObject(forKey: Self.authSuppressionKey)
            authSession = session
            // Bind the verified server scope before the first progress fetch.
            // If that fetch is offline, subsequent local work must still be
            // saved under this account instead of being quarantined on relaunch.
            localAccountScope = accountScope
            await synchronize(accessToken: session.accessToken)
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    func handleAppleCredentialRevocation() async {
        guard authSession != nil else { return }
        await invalidateAppleSession(
            message: "Apple access changed. Sign in again to continue securely."
        )
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
        serverGeneration = nil
        localAccountScope = nil
        userDefaults.removeObject(forKey: Self.progressGenerationKey)
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
        serverGeneration = nil
        localAccountScope = nil
        userDefaults.removeObject(forKey: Self.progressGenerationKey)
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
        let accountScope = localAccountScope
        let generation = serverGeneration
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            do {
                try await repository.saveProgress(
                    LocalProgressSnapshot(
                        state: snapshot,
                        accountScope: accountScope,
                        serverGeneration: generation
                    )
                )
                userDefaults.removeObject(forKey: Self.progressSuppressionKey)
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
            guard let remoteScope = validatedAccountScope(remote.accountScope)
            else { throw APIError.invalidResponse }
            try adoptAccountScope(remoteScope)
            if let knownGeneration = serverGeneration,
               remote.generation < knownGeneration {
                throw APIError.invalidResponse
            }
            serverRevision = remote.revision
            let remoteState = LearningEngine.reconciled(remote.state, curriculum: curriculum)
            if localAccountScope != remoteScope {
                localAccountScope = remoteScope
                recordServerGeneration(remote.generation)
                state = remoteState
                try await saveLocalProgress(remoteState)
                syncStatus = .saved(remote.savedAt)
                return
            }
            let mayMergeLocal =
                serverGeneration == remote.generation ||
                (serverGeneration == nil && remote.generation == 0)
            let merged: LearningState
            if mayMergeLocal {
                merged = try LearningEngine.merged(
                    server: remoteState,
                    local: state,
                    curriculum: curriculum
                )
            } else {
                merged = remoteState
            }
            recordServerGeneration(remote.generation)
            state = merged
            try await saveLocalProgress(merged)
            if merged == remoteState {
                syncStatus = .saved(remote.savedAt)
                return
            }
            let saved = try await api.saveProgress(
                merged,
                revision: serverRevision,
                generation: remote.generation,
                accessToken: accessToken
            )
            guard validatedAccountScope(saved.accountScope) == remoteScope
            else { throw APIError.invalidResponse }
            serverRevision = saved.revision
            recordServerGeneration(saved.generation)
            syncStatus = .saved(saved.savedAt)
        } catch APIError.conflict(let remote) {
            guard let remoteScope = validatedAccountScope(remote.accountScope)
            else {
                syncStatus = .offline
                return
            }
            do {
                try adoptAccountScope(remoteScope)
            } catch {
                syncStatus = .offline
                return
            }
            if let knownGeneration = serverGeneration,
               remote.generation < knownGeneration {
                syncStatus = .offline
                return
            }
            let mayMergeLocal = serverGeneration == remote.generation
            serverRevision = remote.revision
            let remoteState = LearningEngine.reconciled(remote.state, curriculum: curriculum)
            let merged: LearningState
            do {
                if localAccountScope == remoteScope && mayMergeLocal {
                    merged = try LearningEngine.merged(
                        server: remoteState,
                        local: state,
                        curriculum: curriculum
                    )
                } else {
                    merged = remoteState
                }
            } catch {
                syncStatus = .offline
                return
            }
            localAccountScope = remoteScope
            recordServerGeneration(remote.generation)
            state = merged
            do {
                try await saveLocalProgress(merged)
                if merged != remoteState {
                    let saved = try await api.saveProgress(
                        merged,
                        revision: serverRevision,
                        generation: remote.generation,
                        accessToken: accessToken
                    )
                    guard validatedAccountScope(saved.accountScope) == remoteScope
                    else { throw APIError.invalidResponse }
                    serverRevision = saved.revision
                    recordServerGeneration(saved.generation)
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
            await quarantineLocalProgress(
                message: "The previous account session ended, so its local progress was quarantined."
            )
            do {
                try sessionStore.delete()
                userDefaults.removeObject(forKey: Self.authSuppressionKey)
            } catch {
                userDefaults.set(true, forKey: Self.authSuppressionKey)
            }
            authSession = nil
            serverRevision = 0
            serverGeneration = nil
            localAccountScope = nil
            userDefaults.removeObject(forKey: Self.progressGenerationKey)
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
                try await repository.saveProgress(
                    LocalProgressSnapshot(
                        state: LearningState(),
                        accountScope: nil,
                        serverGeneration: nil
                    )
                )
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

    private func recordServerGeneration(_ generation: Int) {
        serverGeneration = generation
    }

    private func canLoadPersistedProgress(
        _ progress: LocalProgressSnapshot
    ) -> Bool {
        if environment.allowsGuestMode && authSession == nil {
            return progress.accountScope == nil &&
                progress.serverGeneration == nil
        }
        guard let sessionScope = validatedAccountScope(authSession?.accountScope)
        else { return false }
        return progress.accountScope == sessionScope &&
            progress.serverGeneration.map({ $0 >= 0 }) ?? true
    }

    private func validatedAccountScope(_ value: String?) -> String? {
        guard let value,
              value.count == 64,
              value.allSatisfy({ $0.isNumber || ("a"..."f").contains($0) })
        else { return nil }
        return value
    }

    private func validatedAppleUserID(_ value: String?) -> String? {
        guard let value,
              !value.isEmpty,
              value.count <= 255,
              value.unicodeScalars.allSatisfy({
                  !CharacterSet.controlCharacters.contains($0) &&
                      !CharacterSet.whitespacesAndNewlines.contains($0)
              })
        else { return nil }
        return value
    }

    private func validateStoredAppleCredential() async {
        guard let session = authSession else { return }
        guard let appleUserID = validatedAppleUserID(session.appleUserID) else {
            await invalidateAppleSession(
                message: "Sign in again so Paretto can verify your Apple account."
            )
            return
        }
        do {
            switch try await appleCredentialState.state(appleUserID) {
            case .authorized, .unknown:
                return
            case .revoked, .notFound, .transferred:
                await invalidateAppleSession(
                    message: "Apple access changed. Sign in again to continue securely."
                )
            }
        } catch {
            // Credential-state lookup can fail offline. The scoped Keychain
            // session remains usable and the server still validates its token.
        }
    }

    private func invalidateAppleSession(message: String) async {
        await cancelPendingSave()
        let token = authSession?.accessToken
        do {
            try sessionStore.delete()
            userDefaults.removeObject(forKey: Self.authSuppressionKey)
        } catch {
            // Never reload an unremovable revoked session from Keychain.
            userDefaults.set(true, forKey: Self.authSuppressionKey)
        }
        authSession = nil
        serverRevision = 0
        serverGeneration = nil
        localAccountScope = nil
        userDefaults.removeObject(forKey: Self.progressGenerationKey)
        await quarantineLocalProgress(message: message)
        if let token {
            try? await api.revokeSession(accessToken: token)
        }
        syncStatus = .error(message)
        alertMessage = message
    }

    private func adoptAccountScope(_ remoteScope: String) throws {
        guard let session = authSession else {
            throw APIError.unauthorized
        }
        if let sessionScope = session.accountScope {
            guard validatedAccountScope(sessionScope) == remoteScope
            else { throw APIError.invalidResponse }
            return
        }
        let scoped = AuthSession(
            accessToken: session.accessToken,
            expiresAt: session.expiresAt,
            displayName: session.displayName,
            syncScope: session.syncScope,
            accountScope: remoteScope,
            appleUserID: session.appleUserID
        )
        try sessionStore.save(scoped)
        authSession = scoped
    }

    private func saveLocalProgress(_ value: LearningState) async throws {
        try await repository.saveProgress(
            LocalProgressSnapshot(
                state: value,
                accountScope: localAccountScope,
                serverGeneration: serverGeneration
            )
        )
        userDefaults.removeObject(forKey: Self.progressSuppressionKey)
    }

    private func quarantineLocalProgress(message: String) async {
        state = LearningState()
        lessonWords = []
        localAccountScope = nil
        serverRevision = 0
        serverGeneration = nil
        userDefaults.set(true, forKey: Self.progressSuppressionKey)
        if await clearPersistedProgress() {
            userDefaults.removeObject(forKey: Self.progressSuppressionKey)
        } else {
            alertMessage = message
        }
    }
}
