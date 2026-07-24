import Foundation
import Security

enum KeychainSessionStore {
    private static let service = "com.loquivo.app.auth"
    // A one-time fallback preserves sessions created before the Loquivo
    // rebrand when both app identifiers share a Keychain access group.
    private static let legacyService = "com.pasapas.french.auth"
    private static let account = "current-session"

    static func load() throws -> AuthSession? {
        if let current = try load(service: service) {
            return current
        }
        guard let legacy = try load(service: legacyService) else {
            return nil
        }
        try save(legacy)
        try? delete(service: legacyService)
        return legacy
    }

    private static func load(service: String) throws -> AuthSession? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainError.status(status)
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(AuthSession.self, from: data)
    }

    static func save(_ session: AuthSession) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(session)
        let base: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData] = data
        add[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.status(status) }
    }

    static func delete() throws {
        try delete(service: service)
        try delete(service: legacyService)
    }

    private static func delete(service: String) throws {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }
}

enum KeychainError: Error {
    case status(OSStatus)
}
