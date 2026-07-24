import Foundation

enum AppEnvironment: String, Codable {
    case debug
    case staging
    case production

    static var current: AppEnvironment {
        #if DEBUG
        return .debug
        #elseif STAGING
        return .staging
        #else
        return .production
        #endif
    }

    var apiBaseURL: URL? {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "PARETTO_API_BASE_URL") as? String,
           let configuredURL = validatedAPIURL(configured) {
            return configuredURL
        }
        switch self {
        case .debug:
            return URL(string: "http://localhost:3000")
        case .staging, .production:
            return nil
        }
    }

    var allowsGuestMode: Bool { self == .debug }

    func serviceURL(path: String) -> URL? {
        guard let baseURL = apiBaseURL else { return nil }
        return URL(string: path, relativeTo: baseURL)?.absoluteURL
    }

    private func validatedAPIURL(_ value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              !trimmed.contains("$("),
              let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              url.host != nil,
              url.user == nil,
              url.password == nil
        else { return nil }

        if self == .debug, scheme == "http" || scheme == "https" { return url }
        return scheme == "https" ? url : nil
    }
}
