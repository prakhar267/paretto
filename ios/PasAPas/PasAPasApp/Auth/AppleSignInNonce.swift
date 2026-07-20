import CryptoKit
import Foundation
import Security

enum AppleSignInNonce {
    static func make() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else { throw AppleSignInNonceError.randomnessUnavailable }
        return Data(bytes)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func hash(_ rawNonce: String) -> String {
        Data(SHA256.hash(data: Data(rawNonce.utf8)))
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

enum AppleSignInNonceError: LocalizedError {
    case randomnessUnavailable

    var errorDescription: String? {
        "Secure Sign in with Apple could not start. Please try again."
    }
}
