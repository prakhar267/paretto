import Foundation
import ParettoCore

struct AuthSession: Codable, Equatable, Sendable {
    let accessToken: String
    let expiresAt: Date
    let displayName: String?
}

struct ProgressEnvelope: Codable, Sendable {
    let state: LearningState
    let revision: Int
    let savedAt: Date?
}

enum APIError: LocalizedError {
    case notConfigured
    case unauthorized
    case conflict(ProgressEnvelope)
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: "Cloud sync is not configured for this build."
        case .unauthorized: "Your session has expired. Please sign in again."
        case .conflict: "Your progress changed on another device."
        case .invalidResponse: "The server returned an unreadable response."
        case .server(let message): message
        }
    }
}

actor APIClient {
    private let environment: AppEnvironment
    private let session: URLSession

    init(environment: AppEnvironment = .current, session: URLSession = .shared) {
        self.environment = environment
        self.session = session
    }

    func signInWithApple(
        identityToken: Data,
        authorizationCode: Data?,
        rawNonce: String,
        displayName: String?
    ) async throws -> AuthSession {
        let token = String(decoding: identityToken, as: UTF8.self)
        let code = authorizationCode.map { String(decoding: $0, as: UTF8.self) }
        return try await request(
            path: "/api/native/auth/apple",
            method: "POST",
            body: AppleAuthenticationRequest(
                identityToken: token,
                authorizationCode: code,
                rawNonce: rawNonce,
                displayName: displayName
            ),
            accessToken: nil,
            response: AuthSession.self
        )
    }

    func loadProgress(accessToken: String) async throws -> ProgressEnvelope {
        try await request(
            path: "/api/native/progress",
            method: "GET",
            body: Optional<EmptyBody>.none,
            accessToken: accessToken,
            response: ProgressEnvelope.self
        )
    }

    func saveProgress(
        _ state: LearningState,
        revision: Int,
        accessToken: String
    ) async throws -> ProgressEnvelope {
        do {
            return try await request(
                path: "/api/native/progress",
                method: "PUT",
                body: SaveProgressRequest(state: state, revision: revision),
                accessToken: accessToken,
                response: ProgressEnvelope.self
            )
        } catch APIError.server(let message) where message.hasPrefix("CONFLICT:") {
            let fresh = try await loadProgress(accessToken: accessToken)
            throw APIError.conflict(fresh)
        }
    }

    func deleteAccount(accessToken: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/native/account",
            method: "DELETE",
            body: Optional<EmptyBody>.none,
            accessToken: accessToken,
            response: EmptyResponse.self,
            acceptsEmptyResponse: true
        )
    }

    func revokeSession(accessToken: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/native/session",
            method: "DELETE",
            body: Optional<EmptyBody>.none,
            accessToken: accessToken,
            response: EmptyResponse.self,
            acceptsEmptyResponse: true
        )
    }

    private func request<Body: Encodable, Response: Decodable>(
        path: String,
        method: String,
        body: Body?,
        accessToken: String?,
        response: Response.Type,
        acceptsEmptyResponse: Bool = false
    ) async throws -> Response {
        guard let baseURL = environment.apiBaseURL,
              let url = URL(string: path, relativeTo: baseURL)?.absoluteURL
        else { throw APIError.notConfigured }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try APIJSONCoding.encoder().encode(body)
        }

        let (data, urlResponse) = try await session.data(for: request)
        guard let http = urlResponse as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if http.statusCode == 409 { throw APIError.server("CONFLICT:progress") }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? APIJSONCoding.decoder().decode(ErrorResponse.self, from: data)
            throw APIError.server(payload?.error ?? payload?.message ?? "The service is temporarily unavailable.")
        }
        if acceptsEmptyResponse && data.isEmpty,
           let empty = EmptyResponse() as? Response {
            return empty
        }
        guard !data.isEmpty else { throw APIError.invalidResponse }
        do {
            return try APIJSONCoding.decoder().decode(Response.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }

}

enum APIJSONCoding {
    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(
                date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
            )
        }
        return encoder
    }

    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = try? Date(
                raw,
                strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)
            ) {
                return date
            }
            if let date = try? Date(
                raw,
                strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: false)
            ) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected an RFC 3339 timestamp."
            )
        }
        return decoder
    }
}

private struct AppleAuthenticationRequest: Codable {
    let identityToken: String
    let authorizationCode: String?
    let rawNonce: String
    let displayName: String?
}

private struct SaveProgressRequest: Codable {
    let state: LearningState
    let revision: Int
}

private struct ErrorResponse: Codable {
    let error: String?
    let message: String?
}
private struct EmptyBody: Codable {}
private struct EmptyResponse: Codable { init() {} }
