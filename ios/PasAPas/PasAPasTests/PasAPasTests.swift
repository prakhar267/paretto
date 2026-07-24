import Foundation
import PasAPasCore
import Testing
@testable import PasAPas

@Suite("Native app integration")
struct PasAPasTests {
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
    @Test("Native onboarding never opts a learner into analytics")
    func onboardingKeepsAnalyticsDisabled() {
        let model = makeModel()
        model.completeOnboarding(name: "Camille", dailyGoal: 5)
        #expect(model.state.onboarded)
        #expect(model.state.settings.analytics == false)
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
            userDefaults: defaults
        )
        await relaunched.load()

        #expect(relaunched.state.onboarded == false)
        #expect(relaunched.state.xp == 0)
        #expect(await progress.loadCount() == 1)
        #expect(defaults.bool(forKey: AppModel.progressSuppressionKey))
    }

    @Test("Generated project attaches the shared configuration to every app build")
    func generatedProjectUsesSharedConfiguration() throws {
        let projectRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let project = projectRoot
            .appendingPathComponent("PasAPas.xcodeproj/project.pbxproj")
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
                .appendingPathComponent("pas-a-pas-test-\(UUID().uuidString).json"),
            loadsKeychain: false,
            userDefaults: isolatedDefaults()
        )
    }

    @MainActor
    private func isolatedDefaults() -> UserDefaults {
        let suite = "com.pasapas.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    private func testSession() -> AuthSession {
        AuthSession(
            accessToken: String(repeating: "a", count: 43),
            expiresAt: Date.now.addingTimeInterval(3_600),
            displayName: "Camille"
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
    private var state: LearningState?
    private var loads = 0
    private let saveError: (any Error)?
    private let deleteError: (any Error)?

    init(
        state: LearningState?,
        saveError: (any Error)? = nil,
        deleteError: (any Error)? = nil
    ) {
        self.state = state
        self.saveError = saveError
        self.deleteError = deleteError
    }

    func load() async throws -> LearningState? {
        loads += 1
        return state
    }

    func save(_ state: LearningState) async throws {
        if let saveError { throw saveError }
        self.state = state
    }

    func delete() async throws {
        if let deleteError { throw deleteError }
        state = nil
    }

    func currentState() -> LearningState? { state }
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
