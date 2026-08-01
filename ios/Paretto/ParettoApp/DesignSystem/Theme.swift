import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

extension Color {
    // These values mirror the production web design tokens in app/globals.css.
    static let parettoCream = Color(red: 1.00, green: 0.973, blue: 0.933)
    static let parettoPaper = Color.white
    static let parettoPaperWarm = Color(red: 0.965, green: 0.945, blue: 0.910)
    static let parettoNavy = Color(red: 0.090, green: 0.137, blue: 0.231)
    static let parettoMuted = Color(red: 0.349, green: 0.404, blue: 0.478)
    static let parettoLine = Color(red: 0.847, green: 0.871, blue: 0.914)
    static let parettoLineSoft = Color(red: 0.914, green: 0.898, blue: 0.871)
    static let parettoBlue = Color(red: 0.129, green: 0.302, blue: 0.722)
    static let parettoBlueDark = Color(red: 0.098, green: 0.239, blue: 0.580)
    static let parettoBlueSoft = Color(red: 0.918, green: 0.941, blue: 1.00)
    static let parettoCoral = Color(red: 0.722, green: 0.231, blue: 0.208)
    static let parettoCoralSoft = Color(red: 0.992, green: 0.929, blue: 0.925)
    static let parettoGold = Color(red: 0.949, green: 0.788, blue: 0.298)
    static let parettoGoldSoft = Color(red: 1.00, green: 0.961, blue: 0.784)
    static let parettoGreen = Color(red: 0.086, green: 0.475, blue: 0.294)
    static let parettoSurface = Color.parettoPaper
    static let parettoBackground = Color.parettoCream
    static let parettoTertiaryFill = Color.parettoPaperWarm
}

struct BrandCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(20)
            .background(Color.parettoPaper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.parettoLineSoft, lineWidth: 1)
            }
            .shadow(color: Color.parettoNavy.opacity(0.07), radius: 15, y: 8)
    }
}

struct PrimaryActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 16)
            .foregroundStyle(.white)
            .background(
                backgroundColor(configuration: configuration),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .shadow(
                color: isEnabled ? Color.parettoBlue.opacity(0.18) : .clear,
                radius: 10,
                y: 5
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(isEnabled ? 1 : 0.68)
    }

    private func backgroundColor(configuration: Configuration) -> Color {
        guard isEnabled else { return Color.parettoMuted }
        return Color.parettoBlue.opacity(configuration.isPressed ? 0.82 : 1)
    }
}

struct SecondaryActionStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .foregroundStyle(Color.parettoBlue)
            .background(
                configuration.isPressed ? Color.parettoBlueSoft : Color.parettoPaper,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.parettoBlue.opacity(0.35), lineWidth: 1.5)
            }
    }
}

struct ParettoBrandMark: View {
    var compact = false

    var body: some View {
        HStack(spacing: compact ? 8 : 10) {
            Text("P")
                .font(.system(size: compact ? 18 : 22, weight: .black, design: .serif))
                .foregroundStyle(Color.parettoNavy)
                .frame(width: compact ? 34 : 40, height: compact ? 34 : 40)
                .background(Color.parettoGold, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Text("Paretto")
                .font(.system(compact ? .headline : .title3, design: .rounded, weight: .bold))
                .foregroundStyle(Color.parettoNavy)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Paretto")
    }
}

struct ParettoEyebrow: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.black))
            .tracking(1.5)
            .foregroundStyle(Color.parettoBlue)
    }
}

struct ParettoSectionHeading: View {
    let eyebrow: String?
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let eyebrow { ParettoEyebrow(text: eyebrow) }
            Text(title)
                .font(.system(.title, design: .serif, weight: .bold))
                .foregroundStyle(Color.parettoNavy)
        }
    }
}

struct MetricPill: View {
    let symbol: String
    let value: String
    let label: String
    let tone: Color

    init(symbol: String, value: String, label: String, tone: Color = .parettoBlue) {
        self.symbol = symbol
        self.value = value
        self.label = label
        self.tone = tone
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(tone)
            VStack(alignment: .leading, spacing: 0) {
                Text(value)
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(Color.parettoNavy)
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(Color.parettoMuted)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.parettoPaper, in: Capsule())
        .overlay { Capsule().stroke(Color.parettoLineSoft, lineWidth: 1) }
        .shadow(color: Color.parettoNavy.opacity(0.05), radius: 7, y: 3)
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
    func parettoPageBackground() -> some View {
        background(Color.parettoCream.ignoresSafeArea())
            .foregroundStyle(Color.parettoNavy)
            .tint(Color.parettoBlue)
    }

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
    func parettoHiddenNavigationBar() -> some View {
        #if os(iOS)
        toolbar(.hidden, for: .navigationBar)
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
