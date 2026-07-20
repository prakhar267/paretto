import SwiftUI

@main
struct PasAPasApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            AppEntryView()
                .environmentObject(model)
                .tint(.pasBlue)
                .task { await model.load() }
        }
    }
}
