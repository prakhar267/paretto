import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

extension Color {
    static let parettoNavy = Color(red: 0.09, green: 0.14, blue: 0.24)
    static let parettoCream = Color(red: 1.00, green: 0.97, blue: 0.91)
    static let parettoGold = Color(red: 0.93, green: 0.64, blue: 0.08)
    static let parettoCoral = Color(red: 0.97, green: 0.34, blue: 0.23)
    static let parettoBlue = Color(red: 0.20, green: 0.42, blue: 0.66)
#if canImport(UIKit)
    static let parettoSurface = Color(uiColor: .secondarySystemBackground)
    static let parettoBackground = Color(uiColor: .systemBackground)
    static let parettoTertiaryFill = Color(uiColor: .tertiarySystemFill)
#else
    static let parettoSurface = Color(nsColor: .controlBackgroundColor)
    static let parettoBackground = Color(nsColor: .windowBackgroundColor)
    static let parettoTertiaryFill = Color(nsColor: .tertiaryLabelColor).opacity(0.12)
#endif
}

struct BrandCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(18)
            .background(Color.parettoSurface, in: RoundedRectangle(cornerRadius: 22))
            .overlay {
                RoundedRectangle(cornerRadius: 22)
                    .stroke(Color.primary.opacity(0.07), lineWidth: 1)
            }
    }
}

struct PrimaryActionStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 16)
            .foregroundStyle(.white)
            .background(Color.parettoNavy.opacity(configuration.isPressed ? 0.78 : 1), in: RoundedRectangle(cornerRadius: 16))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

struct MetricPill: View {
    let symbol: String
    let value: String
    let label: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(Color.parettoCoral)
            VStack(alignment: .leading, spacing: 0) {
                Text(value).font(.headline.monospacedDigit())
                Text(label).font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(value) \(label)")
    }
}

extension String {
    var initials: String {
        split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }
}

extension View {
    @ViewBuilder
    func parettoFullScreenCover<Content: View>(
        isPresented: Binding<Bool>,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        #if os(iOS)
        fullScreenCover(isPresented: isPresented, content: content)
        #else
        sheet(isPresented: isPresented, content: content)
        #endif
    }

    @ViewBuilder
    func parettoInlineNavigationTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    @ViewBuilder
    func parettoAccessibilityLanguage(_ languageCode: String) -> some View {
        #if os(iOS)
        environment(\.locale, Locale(identifier: languageCode))
        #else
        self
        #endif
    }

    @ViewBuilder
    func parettoWordAutocapitalization() -> some View {
        #if os(iOS)
        textInputAutocapitalization(.words)
        #else
        self
        #endif
    }
}
