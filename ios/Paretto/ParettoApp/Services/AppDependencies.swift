import Foundation
import ParettoCore

struct LocalProgressSnapshot: Equatable, Sendable {
    let state: LearningState
    let accountScope: String?
    let serverGeneration: Int?
}

protocol ProgressStoring: Sendable {
    func loadProgress() async throws -> LocalProgressSnapshot?
    func saveProgress(_ progress: LocalProgressSnapshot) async throws
    func delete() async throws
}

extension ProgressRepository: ProgressStoring {
    func loadProgress() async throws -> LocalProgressSnapshot? {
        guard let stored = try loadStoredProgress() else { return nil }
        return LocalProgressSnapshot(
            state: stored.state,
            accountScope: stored.accountScope,
            serverGeneration: stored.serverGeneration
        )
    }

    func saveProgress(_ progress: LocalProgressSnapshot) async throws {
        try saveStoredProgress(
            StoredLearningProgress(
                accountScope: progress.accountScope,
                serverGeneration: progress.serverGeneration,
                state: progress.state
            )
        )
    }
}

struct AuthenticationSessionStore {
    let load: @MainActor () throws -> AuthSession?
    let save: @MainActor (AuthSession) throws -> Void
    let delete: @MainActor () throws -> Void

    static let keychain = AuthenticationSessionStore(
        load: KeychainSessionStore.load,
        save: KeychainSessionStore.save,
        delete: KeychainSessionStore.delete
    )
}

protocol NativeAPIProviding: Sendable {
    func signInWithApple(
        identityToken: Data,
        authorizationCode: Data?,
        rawNonce: String,
        displayName: String?
    ) async throws -> AuthSession
    func loadProgress(accessToken: String) async throws -> ProgressEnvelope
    func saveProgress(
        _ state: LearningState,
        revision: Int,
        generation: Int,
        accessToken: String
    ) async throws -> ProgressEnvelope
    func revokeSession(accessToken: String) async throws
    func deleteAccount(accessToken: String) async throws
}

extension APIClient: NativeAPIProviding {}
