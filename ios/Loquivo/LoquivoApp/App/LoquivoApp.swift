import SwiftUI

@main
struct LoquivoApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            AppEntryView()
                .environmentObject(model)
                .tint(.loquivoBlue)
                .task { await model.load() }
        }
    }
}
