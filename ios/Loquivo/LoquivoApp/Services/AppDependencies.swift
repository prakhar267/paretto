import Foundation
import LoquivoCore

protocol ProgressStoring: Sendable {
    func load() async throws -> LearningState?
    func save(_ state: LearningState) async throws
    func delete() async throws
}

extension ProgressRepository: ProgressStoring {}

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
        accessToken: String
    ) async throws -> ProgressEnvelope
    func revokeSession(accessToken: String) async throws
    func deleteAccount(accessToken: String) async throws
}

extension APIClient: NativeAPIProviding {}
