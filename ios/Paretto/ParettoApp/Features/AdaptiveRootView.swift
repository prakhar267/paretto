import SwiftUI

enum AppSection: String, CaseIterable, Hashable, Identifiable {
    case today, journey, review, wordbook, profile
    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: "Today"
        case .journey: "Journey"
        case .review: "Review"
        case .wordbook: "Wordbook"
        case .profile: "Profile"
        }
    }

    var symbol: String {
        switch self {
        case .today: "sun.max.fill"
        case .journey: "map.fill"
        case .review: "arrow.triangle.2.circlepath"
        case .wordbook: "text.book.closed.fill"
        case .profile: "person.crop.circle.fill"
        }
    }
}

struct AdaptiveRootView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var selection: AppSection = .today
    @State private var profilePresented = false

    private let primarySections: [AppSection] = [.today, .journey, .review, .wordbook]

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                NavigationSplitView {
                    VStack(alignment: .leading, spacing: 12) {
                        ParettoBrandMark()
                            .padding(.horizontal, 18)
                            .padding(.top, 14)
                        List(
                            AppSection.allCases,
                            selection: Binding<AppSection?>(
                                get: { selection },
                                set: { newSelection in
                                    if let newSelection {
                                        selection = newSelection
                                    }
                                }
                            )
                        ) { section in
                            Label {
                                Text(section.title)
                                    .accessibilityIdentifier("app-section-\(section.rawValue)")
                            } icon: {
                                Image(systemName: section.symbol)
                            }
                                .tag(section)
                        }
                        .scrollContentBackground(.hidden)
                        .background(Color.parettoCream)
                    }
                    .background(Color.parettoCream)
                } detail: {
                    NavigationStack { decoratedDestination(selection) }
                }
            } else {
                TabView(selection: $selection) {
                    ForEach(primarySections) { section in
                        NavigationStack { decoratedDestination(section) }
                            .tabItem { Label(section.title, systemImage: section.symbol) }
                            .tag(section)
                    }
                }
                .tint(.parettoBlue)
            }
        }
        .sheet(isPresented: $profilePresented) {
            NavigationStack {
                ProfileView()
                    .environmentObject(model)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { profilePresented = false }
                        }
                    }
            }
        }
        .parettoFullScreenCover(
            isPresented: Binding(
                get: { !model.lessonWords.isEmpty },
                set: { if !$0 { model.lessonWords = [] } }
            )
        ) {
            LessonFlowView()
                .environmentObject(model)
        }
    }

    @ViewBuilder
    private func decoratedDestination(_ section: AppSection) -> some View {
        destination(section)
            .toolbar {
                if section != .profile {
                    ToolbarItem(placement: .principal) {
                        ParettoBrandMark(compact: true)
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            profilePresented = true
                        } label: {
                            Text(model.state.displayName.initials.isEmpty ? "P" : model.state.displayName.initials)
                                .font(.caption.bold())
                                .foregroundStyle(.white)
                                .frame(width: 34, height: 34)
                                .background(Color.parettoNavy, in: Circle())
                        }
                        .accessibilityLabel("Open profile")
                    }
                }
            }
    }

    @ViewBuilder
    private func destination(_ section: AppSection) -> some View {
        switch section {
        case .today: TodayView(selection: $selection)
        case .journey: JourneyView()
        case .review: ReviewView()
        case .wordbook: WordbookView()
        case .profile: ProfileView()
        }
    }
}
