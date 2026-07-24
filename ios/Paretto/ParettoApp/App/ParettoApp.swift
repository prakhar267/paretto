import SwiftUI

@main
struct ParettoApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            AppEntryView()
                .environmentObject(model)
                .tint(.parettoBlue)
                .task { await model.load() }
        }
    }
}
