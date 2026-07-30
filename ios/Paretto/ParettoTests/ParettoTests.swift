import Foundation
import ParettoCore
import Testing
@testable import Paretto

private let accountScopeA = String(repeating: "a", count: 64)
private let accountScopeB = String(repeating: "b", count: 64)
private let recreatedAccountScopeA = String(repeating: "c", count: 64)
private let authorizedAppleCredentialState = AppleCredentialStateChecking {
    _ in .authorized
}

@Suite("Native app integration")
struct ParettoTests {
    @Test("Guest learning remains available in every app environment")
    func guestLearningAvailableInEveryEnvironment() {
        #expect(AppEnvironment.debug.allowsGuestMode)
        #expect(AppEnvironment.staging.allowsGuestMode)
        #expect(AppEnvironment.production.allowsGuestMode)
    }

    @Test("Profile progress summary uses natural singular and compound-day grammar")
    func profileProgressSummaryGrammar() {
        #expect(
            profileProgressSummary(xp: 10, coins: 1, streak: 1)
                == "10 XP · 1 coin · 1-day streak"
        )
        #expect(
            profileProgressSummary(xp: 20, coins: 2, streak: 2)
                == "20 XP · 2 coins · 2-day streak"
        )
        #expect(
            profileProgressSummary(xp: 0, coins: 0, streak: 0)
                == "0 XP · 0 coins · 0-day streak"
        )
    }

    @Test("Profile curriculum scale is derived from the bundled export")
    func profileCurriculumScale() throws {
        let curriculum = try CurriculumLoader.bundled()
        #expect(
            curriculumSizeSummary(curriculum)
                == "18 regions · 54 lessons · 270 words"
        )
    }

    @MainActor
    @Test("Fresh learner review remains unavailable")
    func freshReviewUnavailable() {
        let model = makeModel()
        #expect(model.startReview() == false)
        #expect(model.lessonWords.isEmpty)
    }

    @MainActor
    @Test("Learning lesson contains exactly five cards")
    func lessonSize() {
        let model = makeModel()
        #expect(model.startLearning())
        #expect(model.lessonWords.count == 5)
    }

    @MainActor
    @Test("Locked regions cannot be opened through the model")
    func lockedRegionCannotStart() throws {
        let model = makeModel()
        let locked = try #require(model.curriculum.regions.dropFirst().first)
        #expect(model.startLearning(regionID: locked.id) == false)
        #expect(model.lessonWords.isEmpty)
    }

    @MainActor
    @Test("Practice modes stay locked until words are learned")
    func practiceModesRequireLearning() {
        let model = makeModel()
        #expect(model.challengeWords().isEmpty)
        #expect(model.rollDice(stake: 1) == nil)

        for word in model.curriculum.words.prefix(3) {
            model.markKnown(word)
        }

        #expect(model.challengeWords().count == 3)
        #expect(model.rollDice(stake: 1) != nil)
        #expect(model.state.dice.lastPlayedDate != nil)
    }

    @MainActor
    @Test("Native challenge rotates learned words by the learner's local day")
    func challengeRotation() throws {
        let model = makeModel()
        for word in model.curriculum.words.prefix(8) {
            model.markKnown(word)
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(secondsFromGMT: 0))
        let firstDay = try #require(
            calendar.date(
                from: DateComponents(year: 2026, month: 7, day: 20, hour: 12)
            )
        )
        let secondDay = try #require(
            calendar.date(byAdding: .day, value: 1, to: firstDay)
        )

        let first = model.challengeWords(now: firstDay, calendar: calendar)
        let replay = model.challengeWords(now: firstDay, calendar: calendar)
        let second = model.challengeWords(now: secondDay, calendar: calendar)

        #expect(first.count == 5)
        #expect(first.map(\.id) == replay.map(\.id))
        #expect(first.map(\.id) != second.map(\.id))
        #expect(
            Set(first.map(\.id))
                .union(second.map(\.id))
                .isSubset(of: Set(model.curriculum.words.prefix(8).map(\.id)))
        )
    }

    @MainActor
    @Test("Native onboarding never opts a learner into analytics")
    func onboardingKeepsAnalyticsDisabled() {
        let model = makeModel()
        model.completeOnboarding(name: "Camille", dailyGoal: 5)
        #expect(model.state.onboarded)
        #expect(model.state.settings.analytics == false)
    }

    @MainActor
    @Test("Legacy privacy suppression flags migrate across both rebrands")
    func legacySuppressionFlagsMigrate() {
        let defaults = isolatedDefaults()
        defaults.set(true, forKey: "loquivo.ignore-persisted-progress")
        defaults.set(true, forKey: "pas-a-pas.ignore-keychain-session")

        _ = AppModel(
            environment: .debug,
            repositoryURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("paretto-migration-\(UUID().uuidString).json"),
            loadsKeychain: false,
            userDefaults: defaults
        )

        #expect(defaults.bool(forKey: AppModel.progressSuppressionKey))
        #expect(defaults.bool(forKey: AppModel.authSuppressionKey))
        #expect(defaults.object(forKey: "loquivo.ignore-persisted-progress") == nil)
        #expect(defaults.object(forKey: "pas-a-pas.ignore-persisted-progress") == nil)
        #expect(defaults.object(forKey: "loquivo.ignore-keychain-session") == nil)
        #expect(defaults.object(forKey: "pas-a-pas.ignore-keychain-session") == nil)
    }

    @Test("Sign in nonce is random, URL safe, and SHA-256 hashed")
    func appleNonce() throws {
        let first = try AppleSignInNonce.make()
        let second = try AppleSignInNonce.make()
        #expect(first != second)
        #expect(!first.contains("="))
        #expect(!first.contains("+"))
        #expect(!first.contains("/"))
        #expect(
            AppleSignInNonce.hash("test")
                == "n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg"
        )
    }

    @Test("API dates accept JavaScript fractional RFC 3339 timestamps")
    func fractionalAPIDates() throws {
        let data = Data(#"{"date":"2026-07-21T12:34:56.123Z"}"#.utf8)
        let decoded = try APIJSONCoding.decoder().decode(DateFixture.self, from: data)
        #expect(abs(decoded.date.timeIntervalSince1970 - 1_784_637_296.123) < 0.001)

        let encoded = try APIJSONCoding.encoder().encode(decoded)
        let json = try #require(String(data: encoded, encoding: .utf8))
        #expect(json.contains(".123"))
    }

    @Test("Legacy Keychain sessions decode conservatively and unified sessions are explicit")
    func authSessionSyncScopeMigration() throws {
        let legacy = Data(
            """
            {
              "accessToken": "\(String(repeating: "a", count: 43))",
              "expiresAt": "2026-07-26T12:00:00.000Z",
              "displayName": "Camille"
            }
            """.utf8
        )
        let decodedLegacy = try APIJSONCoding.decoder().decode(
            AuthSession.self,
            from: legacy
        )
        #expect(decodedLegacy.syncScope == nil)
        #expect(decodedLegacy.appleUserID == nil)
        #expect(decodedLegacy.sharesWebProgress == false)

        let unified = Data(
            """
            {
              "accessToken": "\(String(repeating: "b", count: 43))",
              "expiresAt": "2026-07-26T12:00:00.000Z",
              "displayName": "Camille",
              "syncScope": "unified"
            }
            """.utf8
        )
        let decodedUnified = try APIJSONCoding.decoder().decode(
            AuthSession.self,
            from: unified
        )
        #expect(decodedUnified.syncScope == .unified)
        #expect(decodedUnified.appleUserID == nil)
        #expect(decodedUnified.sharesWebProgress)
    }

    @Test("Privacy manifest declares synced device and gameplay data without tracking")
    func privacyManifestDeclaresSyncedData() throws {
        let projectRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let manifest = projectRoot
            .appendingPathComponent("ParettoApp/PrivacyInfo.xcprivacy")
        let data = try Data(contentsOf: manifest)
        let propertyList = try #require(
            PropertyListSerialization.propertyList(
                from: data,
                options: [],
                format: nil
            ) as? [String: Any]
        )
        let declarations = try #require(
            propertyList["NSPrivacyCollectedDataTypes"] as? [[String: Any]]
        )
        let byType = Dictionary(
            uniqueKeysWithValues: declarations.compactMap { declaration in
                (declaration["NSPrivacyCollectedDataType"] as? String)
                    .map { ($0, declaration) }
            }
        )

        for dataType in [
            "NSPrivacyCollectedDataTypeDeviceID",
            "NSPrivacyCollectedDataTypeGameplayContent",
        ] {
            let declaration = try #require(byType[dataType])
            #expect(declaration["NSPrivacyCollectedDataTypeLinked"] as? Bool == true)
            #expect(declaration["NSPrivacyCollectedDataTypeTracking"] as? Bool == false)
            #expect(
                declaration["NSPrivacyCollectedDataTypePurposes"] as? [String]
                    == ["NSPrivacyCollectedDataTypePurposeAppFunctionality"]
            )
        }
    }

    @Test("Deployment API origins fail closed outside Debug")
    func deploymentAPIOriginValidation() {
        #expect(
            AppEnvironment.staging.validatedAPIURL(
                "https://paretto-staging.example"
            )?.absoluteString == "https://paretto-staging.example"
        )
        #expect(
            AppEnvironment.production.validatedAPIURL(
                "https://paretto.example"
            )?.absoluteString == "https://paretto.example"
        )
        #expect(
            AppEnvironment.production.validatedAPIURL(
                "http://paretto.example"
            ) == nil
        )
        #expect(
            AppEnvironment.production.validatedAPIURL(
                "https://user:password@paretto.example"
            ) == nil
        )
        #expect(
            AppEnvironment.production.validatedAPIURL(
                "$(PARETTO_PRODUCTION_API_BASE_URL)"
            ) == nil
        )
        #expect(
            AppEnvironment.debug.validatedAPIURL(
                "http://localhost:3000"
            )?.absoluteString == "http://localhost:3000"
        )
    }

    @Test("Packaged audio paths resolve to the shipped fr resource directory")
    func packagedAudioResourceContract() throws {
        let curriculum = try CurriculumLoader.bundled()
        let resources = try curriculum.words.map { word in
            try #require(
                FrenchAudioPlayer.bundledResource(
                    for: word,
                    course: curriculum.course
                )
            )
        }
        let sample = try #require(
            zip(curriculum.words, resources)
                .first(where: { $0.0.id == "idf-metro" })?
                .1
        )

        #expect(resources.count == 270)
        #expect(Set(resources.map(\.name)).count == 270)
        #expect(resources.allSatisfy { $0.fileExtension == "wav" })
        #expect(resources.allSatisfy { $0.subdirectory == "fr/v2" })
        #expect(sample.name == "idf-metro")

        #if os(iOS)
        for resource in resources {
            #expect(
                Bundle.main.url(
                    forResource: resource.name,
                    withExtension: resource.fileExtension,
                    subdirectory: resource.subdirectory
                ) != nil
            )
        }
        #endif
    }

    @MainActor
    @Test("Offline work immediately after Apple sign-in remains account scoped")
    func offlinePostSignInProgressSurvivesRelaunch() async throws {
        let progress = TestProgressStore(
            state: nil,
            accountScope: nil,
            serverGeneration: nil
        )
        let sessionProbe = SessionStoreProbe(session: nil)
        let api = SignInThenOfflineNativeAPI(session: testSession())
        let defaults = isolatedDefaults()
        let model = AppModel(
            environment: .production,
            loadsKeychain: false,
            progressStore: progress,
            apiClient: api,
            sessionStore: sessionProbe.store,
            appleCredentialState: authorizedAppleCredentialState,
            userDefaults: defaults
        )

        await model.load()
        await model.authenticate(
            identityToken: Data("verified-identity-token".utf8),
            authorizationCode: Data("verified-authorization-code".utf8),
            appleUserID: "apple-user-offline-test",
            rawNonce: String(repeating: "n", count: 32),
            displayName: "Camille"
        )
        model.completeOnboarding(name: "Camille", dailyGoal: 5)
        try await Task.sleep(for: .milliseconds(500))

        let persisted = await progress.currentProgress()
        #expect(persisted?.accountScope == accountScopeA)
        #expect(persisted?.serverGeneration == nil)
        #expect(persisted?.state.onboarded == true)
        #expect(sessionProbe.session?.appleUserID == "apple-user-offline-test")

        let relaunched = AppModel(
            environment: .production,
            loadsKeychain: true,
            progressStore: progress,
            apiClient: api,
            sessionStore: sessionProbe.store,
            appleCredentialState: authorizedAppleCredentialState,
            userDefaults: defaults
        )
        await relaunched.load()

        #expect(relaunched.authSession?.accountScope == accountScopeA)
        #expect(relaunched.state.onboarded)
        #expect(relaunched.state.displayName == "Camille")
        #expect(await progress.currentProgress()?.accountScope == accountScopeA)
    }

    @MainActor
    @Test("Revoked Apple credential clears scoped local data and session")
    func revokedAppleCredentialClearsLocalAccount() async {
        let privateState = LearningState(
            onboarded: true,
            displayName: "Private learner",
            xp: 42
        )
        let progress = TestProgressStore(
            state: privateState,
            accountScope: accountScopeA,
            serverGeneration: 0
        )
        let api = SignInThenOfflineNativeAPI(session: testSession())
        let sessionProbe = SessionStoreProbe(session: testSession())
        let defaults = isolatedDefaults()
        let model = AppModel(
            environment: .production,
            loadsKeychain: true,
            progressStore: progress,
            apiClient: api,
            sessionStore: sessionProbe.store,
            appleCredentialState: AppleCredentialStateChecking {
                _ in .revoked
            },
            userDefaults: defaults
        )

        await model.load()

        #expect(model.authSession == nil)
        #expect(model.state.onboarded == false)
        #expect(model.state.xp == 0)
        #expect(sessionProbe.session == nil)
        #expect(await progress.currentProgress() == nil)
        #expect(await api.revocations() == 1)
        #expect(model.requiresReauthentication)
        #expect(model.alertMessage?.contains("Apple access changed") == true)
    }

    @MainActor
    @Test("Offline Apple credential lookup preserves an authorized scoped session")
    func offlineAppleCredentialLookupPreservesSession() async {
        let privateState = LearningState(
            onboarded: true,
            displayName: "Offline learner",
            xp: 42
        )
        let progress = TestProgressStore(
            state: privateState,
            accountScope: accountScopeA,
            serverGeneration: 0
        )
        let api = SignInThenOfflineNativeAPI(session: testSession())
        let session = testSession()
        let sessionProbe = SessionStoreProbe(session: session)
        let model = AppModel(
            environment: .production,
            loadsKeychain: true,
            progressStore: progress,
            apiClient: api,
            sessionStore: sessionProbe.store,
            appleCredentialState: AppleCredentialStateChecking { _ in
                throw TestFailure.expected
            },
            userDefaults: isolatedDefaults()
        )

        await model.load()

        #expect(model.authSession == session)
        #expect(model.state.displayName == "Offline learner")
        #expect(model.state.xp == 42)
        #expect(await progress.currentProgress()?.accountScope == accountScopeA)
        #expect(await api.revocations() == 0)
    }

    @MainActor
    @Test("Sign-out fails closed when the Keychain session cannot be removed")
    func signOutRetainsAccountWhenKeychainDeleteFails() async {
        let stale = LearningState(onboarded: true, displayName: "Camille", xp: 42)
        let progress = TestProgressStore(state: stale)
        let api = TestNativeAPI()
        let session = testSession()
        let sessionProbe = SessionStoreProbe(
            session: session,
            deleteError: TestFailure.expected
        )
        let defaults = isolatedDefaults()
        let model = AppModel(
            environment: .production,
            loadsKeychain: true,
            progressStore: progress,
            apiClient: api,
            sessionStore: sessionProbe.store,
            appleCredentialState: authorizedAppleCredentialState,
            userDefaults: defaults
        )

        await model.load()
        await model.signOut()

        #expect(model.authSession == session)
        #expect(model.state.xp == 42)
        #expect(sessionProbe.session == session)
        #expect(model.alertMessage?.contains("could not securely remove") == true)
        #expect(defaults.bool(forKey: AppModel.progressSuppressionKey) == false)
        #expect(await api.revocations() == 0)
    }

    @MainActor
    @Test("Offline server revocation cannot block a secure local sign-out")
    func signOutCompletesWhenRevocationFails() async {
        let stale = LearningState(onboarded: true, displayName: "Camille", xp: 42)
        let progress = TestProgressStore(
            state: stale,
            deleteError: TestFailure.expected
        )
        let api = TestNativeAPI(revokeError: TestFailure.expected)
        let sessionProbe = SessionStoreProbe(session: testSession())
        let defaults = isolatedDefaults()
        let model = AppModel(
            environment: .production,
            loadsKeychain: true,
            progressStore: progress,
            apiClient: api,
            sessionStore: sessionProbe.store,
            appleCredentialState: authorizedAppleCredentialState,
            userDefaults: defaults
        )

        await model.load()
        await model.signOut()

        #expect(model.authSession == nil)
        #expect(model.state.onboarded == false)
        #expect(model.state.xp == 0)
        #expect(sessionProbe.session == nil)
        let persisted = await progress.currentState()
        #expect(persisted?.onboarded == false)
        #expect(persisted?.displayName.isEmpty == true)
        #expect(persisted?.xp == 0)
        #expect(persisted?.wordProgress.isEmpty == true)
        #expect(persisted?.sessions.isEmpty == true)
        #expect(defaults.bool(forKey: AppModel.progressSuppressionKey) == false)
        #expect(await api.revocations() == 1)
    }

    @MainActor
    @Test("Unremovable progress stays quarantined across relaunch")
    func signOutQuarantinesUnremovableProgress() async {
        let stale = LearningState(onboarded: true, displayName: "Camille", xp: 42)
        let progress = TestProgressStore(
            state: stale,
            saveError: TestFailure.expected,
            deleteError: TestFailure.expected
        )
        let api = TestNativeAPI()
        let sessionProbe = SessionStoreProbe(session: testSession())
        let defaults = isolatedDefaults()
        let model = AppModel(
            environment: .production,
            loadsKeychain: true,
            progressStore: progress,
            apiClient: api,
            sessionStore: sessionProbe.store,
            appleCredentialState: authorizedAppleCredentialState,
            userDefaults: defaults
        )

        await model.load()
        #expect(await progress.loadCount() == 1)
        await model.signOut()

        #expect(model.authSession == nil)
        #expect(model.state.onboarded == false)
        #expect(defaults.bool(forKey: AppModel.progressSuppressionKey))
        #expect(model.alertMessage?.contains("quarantined") == true)

        let relaunched = AppModel(
            environment: .production,
            loadsKeychain: true,
            progressStore: progress,
            apiClient: api,
            sessionStore: sessionProbe.store,
            appleCredentialState: authorizedAppleCredentialState,
            userDefaults: defaults
        )
        await relaunched.load()

        #expect(relaunched.state.onboarded == false)
        #expect(relaunched.state.xp == 0)
        #expect(await progress.loadCount() == 1)
        #expect(defaults.bool(forKey: AppModel.progressSuppressionKey))
    }

    @MainActor
    @Test("A server reset generation discards stale native progress instead of merging it")
    func remoteResetGenerationWins() async {
        let stale = LearningState(
            onboarded: true,
            displayName: "Stale native learner",
            xp: 900
        )
        let progress = TestProgressStore(
            state: stale,
            accountScope: accountScopeA,
            serverGeneration: 0
        )
        let remote = ProgressEnvelope(
            state: LearningState(),
            revision: 0,
            generation: 1,
            accountScope: accountScopeA,
            savedAt: nil
        )
        let api = GenerationNativeAPI(remote: remote)
        let sessionProbe = SessionStoreProbe(session: testSession())
        let defaults = isolatedDefaults()
        let model = AppModel(
            environment: .production,
            loadsKeychain: true,
            progressStore: progress,
            apiClient: api,
            sessionStore: sessionProbe.store,
            appleCredentialState: authorizedAppleCredentialState,
            userDefaults: defaults
        )

        await model.load()

        #expect(model.state.onboarded == false)
        #expect(model.state.xp == 0)
        #expect(model.state.wordProgress.isEmpty)
        #expect(await api.saveCalls() == 0)
        #expect(defaults.object(forKey: AppModel.progressGenerationKey) == nil)
        #expect(await progress.currentState()?.xp == 0)
        #expect(await progress.currentProgress()?.serverGeneration == 1)
        #expect(await progress.currentProgress()?.accountScope == accountScopeA)
    }

    @MainActor
    @Test("Expired, revoked, or deleted account A cannot leak progress into account B")
    func endedAccountNeverCrossesIntoAnotherAccount() async {
        for scenario in ["expired", "revoked", "deleted"] {
            let alice = LearningState(
                onboarded: true,
                displayName: "Alice private",
                xp: 900
            )
            let progress = TestProgressStore(
                state: alice,
                accountScope: accountScopeA,
                serverGeneration: 0
            )
            let aliceSession = testSession(
                accessToken: String(repeating: "a", count: 43),
                expiresAt: scenario == "expired"
                    ? .now.addingTimeInterval(-60)
                    : .now.addingTimeInterval(3_600),
                accountScope: accountScopeA
            )
            let sessionProbe = SessionStoreProbe(session: aliceSession)
            let endedAPI = ScopedNativeAPI(loadUnauthorized: true)
            let defaults = isolatedDefaults()
            let endedModel = AppModel(
                environment: .production,
                loadsKeychain: true,
                progressStore: progress,
                apiClient: endedAPI,
                sessionStore: sessionProbe.store,
                appleCredentialState: authorizedAppleCredentialState,
                userDefaults: defaults
            )

            await endedModel.load()

            #expect(endedModel.authSession == nil)
            #expect(endedModel.state.xp == 0)
            #expect(await progress.currentProgress() == nil)
            #expect(endedModel.requiresReauthentication)

            let bob = LearningState(
                onboarded: true,
                displayName: "Bob",
                xp: 12
            )
            let bobAPI = ScopedNativeAPI(
                remote: ProgressEnvelope(
                    state: bob,
                    revision: 3,
                    generation: 0,
                    accountScope: accountScopeB,
                    savedAt: .now
                )
            )
            sessionProbe.session = testSession(
                accessToken: String(repeating: "b", count: 43),
                accountScope: accountScopeB
            )
            let bobModel = AppModel(
                environment: .production,
                loadsKeychain: true,
                progressStore: progress,
                apiClient: bobAPI,
                sessionStore: sessionProbe.store,
                appleCredentialState: authorizedAppleCredentialState,
                userDefaults: defaults
            )

            await bobModel.load()

            #expect(bobModel.state.displayName == "Bob")
            #expect(bobModel.state.xp == 12)
            #expect(await bobAPI.saveCalls() == 0)
            #expect(
                await progress.currentProgress()?.accountScope == accountScopeB
            )
            #expect(
                await progress.currentState()?.displayName == "Bob"
            )
        }
    }

    @MainActor
    @Test("Recreated Apple account receives a new scope and cannot resurrect deleted progress")
    func recreatedAccountDoesNotRestoreDeletedProgress() async {
        let deleted = LearningState(
            onboarded: true,
            displayName: "Deleted Alice",
            xp: 1_200
        )
        let progress = TestProgressStore(
            state: deleted,
            accountScope: accountScopeA,
            serverGeneration: 0
        )
        let recreated = LearningState(
            onboarded: true,
            displayName: "Recreated Alice",
            xp: 0
        )
        let api = ScopedNativeAPI(
            remote: ProgressEnvelope(
                state: recreated,
                revision: 0,
                generation: 0,
                accountScope: recreatedAccountScopeA,
                savedAt: nil
            )
        )
        let sessionProbe = SessionStoreProbe(
            session: testSession(accountScope: recreatedAccountScopeA)
        )
        let model = AppModel(
            environment: .production,
            loadsKeychain: true,
            progressStore: progress,
            apiClient: api,
            sessionStore: sessionProbe.store,
            appleCredentialState: authorizedAppleCredentialState,
            userDefaults: isolatedDefaults()
        )

        await model.load()

        #expect(model.state.displayName == "Recreated Alice")
        #expect(model.state.xp == 0)
        #expect(await api.saveCalls() == 0)
        #expect(
            await progress.currentProgress()?.accountScope ==
                recreatedAccountScopeA
        )
        #expect(await progress.currentState()?.xp == 0)
    }

    @Test("Generated project attaches the shared configuration to every app build")
    func generatedProjectUsesSharedConfiguration() throws {
        let projectRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let project = projectRoot
            .appendingPathComponent("Paretto.xcodeproj/project.pbxproj")
        let contents = try String(contentsOf: project, encoding: .utf8)
        let references = contents.components(
            separatedBy: "baseConfigurationReference"
        ).count - 1

        #expect(contents.contains("Shared.xcconfig"))
        #expect(references >= 3)
    }

    @MainActor
    @Test("Apple sign-in explains relay-email handling accurately")
    func appleRelayPrivacyCopy() {
        #expect(SignInView.applePrivacyCopy.contains("protected account identifier"))
        #expect(SignInView.applePrivacyCopy.contains("relay email"))
        #expect(SignInView.applePrivacyCopy.contains("never shown to other learners"))
    }

    @MainActor
    private func makeModel() -> AppModel {
        AppModel(
            environment: .debug,
            repositoryURL: FileManager.default.temporaryDirectory
                .appendingPathComponent("paretto-test-\(UUID().uuidString).json"),
            loadsKeychain: false,
            userDefaults: isolatedDefaults()
        )
    }

    @MainActor
    private func isolatedDefaults() -> UserDefaults {
        let suite = "com.paretto.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    private func testSession(
        accessToken: String = String(repeating: "a", count: 43),
        expiresAt: Date = Date.now.addingTimeInterval(3_600),
        accountScope: String = accountScopeA,
        appleUserID: String = "apple-test-user"
    ) -> AuthSession {
        AuthSession(
            accessToken: accessToken,
            expiresAt: expiresAt,
            displayName: "Camille",
            accountScope: accountScope,
            appleUserID: appleUserID
        )
    }
}

private struct DateFixture: Codable {
    let date: Date
}

private enum TestFailure: Error {
    case expected
}

private actor TestProgressStore: ProgressStoring {
    private var progress: LocalProgressSnapshot?
    private var loads = 0
    private let saveError: (any Error)?
    private let deleteError: (any Error)?

    init(
        state: LearningState?,
        accountScope: String? = accountScopeA,
        serverGeneration: Int? = 0,
        saveError: (any Error)? = nil,
        deleteError: (any Error)? = nil
    ) {
        self.progress = state.map {
            LocalProgressSnapshot(
                state: $0,
                accountScope: accountScope,
                serverGeneration: serverGeneration
            )
        }
        self.saveError = saveError
        self.deleteError = deleteError
    }

    func loadProgress() async throws -> LocalProgressSnapshot? {
        loads += 1
        return progress
    }

    func saveProgress(_ progress: LocalProgressSnapshot) async throws {
        if let saveError { throw saveError }
        self.progress = progress
    }

    func delete() async throws {
        if let deleteError { throw deleteError }
        progress = nil
    }

    func currentState() -> LearningState? { progress?.state }
    func currentProgress() -> LocalProgressSnapshot? { progress }
    func loadCount() -> Int { loads }
}

private actor TestNativeAPI: NativeAPIProviding {
    private let revokeError: (any Error)?
    private var revokeCalls = 0

    init(revokeError: (any Error)? = nil) {
        self.revokeError = revokeError
    }

    func signInWithApple(
        identityToken: Data,
        authorizationCode: Data?,
        rawNonce: String,
        displayName: String?
    ) async throws -> AuthSession {
        throw TestFailure.expected
    }

    func loadProgress(accessToken: String) async throws -> ProgressEnvelope {
        throw TestFailure.expected
    }

    func saveProgress(
        _ state: LearningState,
        revision: Int,
        generation: Int,
        accessToken: String
    ) async throws -> ProgressEnvelope {
        throw TestFailure.expected
    }

    func revokeSession(accessToken: String) async throws {
        revokeCalls += 1
        if let revokeError { throw revokeError }
    }

    func deleteAccount(accessToken: String) async throws {
        throw TestFailure.expected
    }

    func revocations() -> Int { revokeCalls }
}

private actor SignInThenOfflineNativeAPI: NativeAPIProviding {
    private let session: AuthSession
    private var revokeCalls = 0

    init(session: AuthSession) {
        self.session = session
    }

    func signInWithApple(
        identityToken: Data,
        authorizationCode: Data?,
        rawNonce: String,
        displayName: String?
    ) async throws -> AuthSession {
        session
    }

    func loadProgress(accessToken: String) async throws -> ProgressEnvelope {
        throw TestFailure.expected
    }

    func saveProgress(
        _ state: LearningState,
        revision: Int,
        generation: Int,
        accessToken: String
    ) async throws -> ProgressEnvelope {
        throw TestFailure.expected
    }

    func revokeSession(accessToken: String) async throws {
        revokeCalls += 1
    }

    func deleteAccount(accessToken: String) async throws {
        throw TestFailure.expected
    }

    func revocations() -> Int { revokeCalls }
}

private actor GenerationNativeAPI: NativeAPIProviding {
    private let remote: ProgressEnvelope
    private var saves = 0

    init(remote: ProgressEnvelope) {
        self.remote = remote
    }

    func signInWithApple(
        identityToken: Data,
        authorizationCode: Data?,
        rawNonce: String,
        displayName: String?
    ) async throws -> AuthSession {
        throw TestFailure.expected
    }

    func loadProgress(accessToken: String) async throws -> ProgressEnvelope {
        remote
    }

    func saveProgress(
        _ state: LearningState,
        revision: Int,
        generation: Int,
        accessToken: String
    ) async throws -> ProgressEnvelope {
        saves += 1
        return remote
    }

    func revokeSession(accessToken: String) async throws {}
    func deleteAccount(accessToken: String) async throws {}
    func saveCalls() -> Int { saves }
}

private actor ScopedNativeAPI: NativeAPIProviding {
    private let remote: ProgressEnvelope?
    private let loadUnauthorized: Bool
    private var saves = 0

    init(
        remote: ProgressEnvelope? = nil,
        loadUnauthorized: Bool = false
    ) {
        self.remote = remote
        self.loadUnauthorized = loadUnauthorized
    }

    func signInWithApple(
        identityToken: Data,
        authorizationCode: Data?,
        rawNonce: String,
        displayName: String?
    ) async throws -> AuthSession {
        throw TestFailure.expected
    }

    func loadProgress(accessToken: String) async throws -> ProgressEnvelope {
        if loadUnauthorized { throw APIError.unauthorized }
        guard let remote else { throw TestFailure.expected }
        return remote
    }

    func saveProgress(
        _ state: LearningState,
        revision: Int,
        generation: Int,
        accessToken: String
    ) async throws -> ProgressEnvelope {
        saves += 1
        guard let remote else { throw TestFailure.expected }
        return ProgressEnvelope(
            state: state,
            revision: revision + 1,
            generation: generation,
            accountScope: remote.accountScope,
            savedAt: .now
        )
    }

    func revokeSession(accessToken: String) async throws {}
    func deleteAccount(accessToken: String) async throws {}
    func saveCalls() -> Int { saves }
}

@MainActor
private final class SessionStoreProbe {
    var session: AuthSession?
    let deleteError: (any Error)?

    init(session: AuthSession?, deleteError: (any Error)? = nil) {
        self.session = session
        self.deleteError = deleteError
    }

    var store: AuthenticationSessionStore {
        AuthenticationSessionStore(
            load: { self.session },
            save: { self.session = $0 },
            delete: {
                if let deleteError = self.deleteError { throw deleteError }
                self.session = nil
            }
        )
    }
}
