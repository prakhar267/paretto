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

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                NavigationSplitView {
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
                        Label(section.title, systemImage: section.symbol).tag(section)
                    }
                    .navigationTitle("Paretto")
                } detail: {
                    NavigationStack { destination(selection) }
                }
            } else {
                TabView(selection: $selection) {
                    ForEach(AppSection.allCases) { section in
                        NavigationStack { destination(section) }
                            .tabItem { Label(section.title, systemImage: section.symbol) }
                            .tag(section)
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
