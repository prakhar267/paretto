import Foundation

public struct StoredLearningProgress: Codable, Equatable, Sendable {
    public static let currentSchemaVersion = 1

    public let schemaVersion: Int
    public let accountScope: String?
    public let serverGeneration: Int?
    public let state: LearningState

    public init(
        accountScope: String?,
        serverGeneration: Int?,
        state: LearningState
    ) {
        self.schemaVersion = Self.currentSchemaVersion
        self.accountScope = accountScope
        self.serverGeneration = serverGeneration
        self.state = state
    }
}

public actor ProgressRepository {
    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(fileURL: URL) {
        self.fileURL = fileURL
        self.encoder = JSONEncoder()
        self.encoder.dateEncodingStrategy = .deferredToDate
        self.encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .deferredToDate
    }

    public static func applicationSupportURL(
        fileManager: FileManager = .default
    ) throws -> URL {
        let base = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return try applicationSupportURL(in: base, fileManager: fileManager)
    }

    static func applicationSupportURL(
        in base: URL,
        fileManager: FileManager = .default
    ) throws -> URL {
        let directory = base.appendingPathComponent("Paretto", isDirectory: true)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let current = directory.appendingPathComponent("learning-state.json")
        // These literal directories are intentional compatibility probes,
        // ordered from newest to oldest development branding.
        let legacyLocations = [
            base.appendingPathComponent("Loquivo/learning-state.json"),
            base.appendingPathComponent("PasAPas/learning-state.json"),
        ]

        if !fileManager.fileExists(atPath: current.path) {
            for legacy in legacyLocations where fileManager.fileExists(atPath: legacy.path) {
                do {
                    try fileManager.moveItem(at: legacy, to: current)
                } catch {
                    // Reading the legacy location is safer than starting a
                    // learner from zero if a protected file cannot be moved.
                    return legacy
                }
                break
            }
        }
        return current
    }

    public func load() throws -> LearningState? {
        try loadStoredProgress()?.state
    }

    public func loadStoredProgress() throws -> StoredLearningProgress? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        let data = try Data(contentsOf: fileURL)
        if let stored = try? decoder.decode(StoredLearningProgress.self, from: data) {
            guard stored.schemaVersion == StoredLearningProgress.currentSchemaVersion,
                  stored.serverGeneration.map({ $0 >= 0 }) ?? true
            else {
                throw ProgressRepositoryError.unsupportedStoredProgress
            }
            return stored
        }
        // Development and pre-account builds wrote LearningState directly.
        // Treat it as unowned data; the app may use it only in explicit guest
        // mode and must never merge it into an authenticated account.
        return StoredLearningProgress(
            accountScope: nil,
            serverGeneration: nil,
            state: try decoder.decode(LearningState.self, from: data)
        )
    }

    public func save(_ state: LearningState) throws {
        try saveStoredProgress(
            StoredLearningProgress(
                accountScope: nil,
                serverGeneration: nil,
                state: state
            )
        )
    }

    public func saveStoredProgress(_ progress: StoredLearningProgress) throws {
        guard progress.schemaVersion == StoredLearningProgress.currentSchemaVersion,
              progress.serverGeneration.map({ $0 >= 0 }) ?? true
        else {
            throw ProgressRepositoryError.unsupportedStoredProgress
        }
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        #if os(iOS) || os(tvOS) || os(watchOS) || os(visionOS)
        let options: Data.WritingOptions = [.atomic, .completeFileProtection]
        #else
        // Data Protection classes are an iOS-family capability. Requesting
        // them from macOS can make otherwise writable temporary directories
        // fail with EPERM, which breaks package tests and macOS diagnostics.
        let options: Data.WritingOptions = [.atomic]
        #endif
        try encoder.encode(progress).write(to: fileURL, options: options)
    }

    public func export(_ state: LearningState, to destination: URL) throws {
        try encoder.encode(state).write(to: destination, options: .atomic)
    }

    public func delete() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }
}

private enum ProgressRepositoryError: Error {
    case unsupportedStoredProgress
}
