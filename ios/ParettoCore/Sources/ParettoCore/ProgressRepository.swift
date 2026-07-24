import Foundation

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
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        return try decoder.decode(LearningState.self, from: Data(contentsOf: fileURL))
    }

    public func save(_ state: LearningState) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try encoder.encode(state).write(to: fileURL, options: [.atomic, .completeFileProtection])
    }

    public func export(_ state: LearningState, to destination: URL) throws {
        try encoder.encode(state).write(to: destination, options: .atomic)
    }

    public func delete() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }
}
