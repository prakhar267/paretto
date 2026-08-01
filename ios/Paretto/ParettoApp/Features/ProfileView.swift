import ParettoCore
import SwiftUI
import UniformTypeIdentifiers

func profileProgressSummary(xp: Int, coins: Int, streak: Int) -> String {
    let coinNoun = coins == 1 ? "coin" : "coins"
    return "\(xp) XP · \(coins) \(coinNoun) · \(streak)-day streak"
}

func curriculumSizeSummary(_ curriculum: CurriculumBundle) -> String {
    let contextCount = Set(curriculum.words.map(\.regionID)).count
    let lessonCount = Set(
        curriculum.words.map { "\($0.regionID):\($0.lesson)" }
    ).count
    let contextNoun = contextCount == 1 ? "region" : "regions"
    let lessonNoun = lessonCount == 1 ? "lesson" : "lessons"
    let wordNoun = curriculum.words.count == 1 ? "word" : "words"
    return "\(contextCount) \(contextNoun) · \(lessonCount) \(lessonNoun) · \(curriculum.words.count) \(wordNoun)"
}

struct ProfileView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage("dailyReminderEnabled") private var reminderEnabled = false
    @AppStorage("dailyReminderHour") private var reminderHour = 19
    @State private var deleteConfirmation = false
    @State private var exportDocument: LearningExportDocument?
    @State private var exporting = false
    @State private var reminderTask: Task<Void, Never>?
    @State private var signOutConfirmation = false
    @State private var accountActionInProgress = false

    var body: some View {
        Form {
            Section {
                (dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                    : AnyLayout(HStackLayout(alignment: .center, spacing: 16))) {
                    Text(model.state.displayName.initials.isEmpty ? "P" : model.state.displayName.initials)
                        .font(.title.bold())
                        .frame(width: 58, height: 58)
                        .foregroundStyle(.white)
                        .background(Color.parettoBlue, in: Circle())
                    VStack(alignment: .leading) {
                        ParettoEyebrow(text: "Your Paretto profile")
                        Text(model.state.displayName)
                            .font(.system(.title2, design: .serif, weight: .bold))
                            .foregroundStyle(Color.parettoNavy)
                        Text(
                            profileProgressSummary(
                                xp: model.state.xp,
                                coins: model.state.coins,
                                streak: model.state.streak
                            )
                        )
                            .foregroundStyle(Color.parettoMuted)
                    }
                }
                .accessibilityElement(children: .combine)
            }

            Section("Learning preferences") {
                Toggle("French audio", isOn: setting(\.sound))
                Toggle("Show phonetics", isOn: setting(\.phonetics))
                Toggle("Reduce motion", isOn: setting(\.reducedMotion))
            }

            Section("Reminder") {
                Toggle("Daily session reminder", isOn: $reminderEnabled)
                    .onChange(of: reminderEnabled) { _, enabled in scheduleReminder(enabled: enabled) }
                if reminderEnabled {
                    Picker("Reminder time", selection: $reminderHour) {
                        ForEach(7..<22, id: \.self) { hour in
                            Text(DateComponents(calendar: .current, hour: hour).date?.formatted(date: .omitted, time: .shortened) ?? "\(hour):00")
                                .tag(hour)
                        }
                    }
                    .onChange(of: reminderHour) { _, _ in scheduleReminder(enabled: true) }
                }
            }

            Section("Your data") {
                Button("Export learning data", systemImage: "square.and.arrow.up") {
                    do {
                        exportDocument = LearningExportDocument(data: try model.exportData())
                        exporting = true
                    } catch {
                        model.alertMessage = error.localizedDescription
                    }
                }
                Button(deleteButtonTitle, systemImage: "trash", role: .destructive) {
                    deleteConfirmation = true
                }
            }

            Section("Carnet collection") {
                HStack(spacing: 12) {
                    ForEach(CollectibleCatalog.all) { collectible in
                        Text(model.state.collectibles.contains(collectible.id) ? collectible.emoji : "?")
                            .font(.title2)
                            .frame(maxWidth: .infinity)
                            .accessibilityHidden(true)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(model.state.collectibles.count) of \(CollectibleCatalog.all.count) keepsakes collected")
                NavigationLink("View postcards and keepsakes") {
                    CollectiblesDetailView()
                }
            }

            if model.environment.allowsGuestMode && model.authSession == nil {
                Section("Cloud sync") {
                    Text("Progress is private to this device. Continue with Apple to add secure cross-device sync.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    SecureAppleSignInButton()
                        .frame(height: 48)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            } else if let session = model.authSession {
                Section("Cloud sync") {
                    Label(
                        session.sharesWebProgress
                            ? "Shared Paretto account"
                            : "Apple-device account",
                        systemImage: session.sharesWebProgress
                            ? "checkmark.icloud"
                            : "icloud"
                    )
                    Text(
                        session.sharesWebProgress
                            ? "Progress uses the same account on the web and on signed-in Apple devices."
                            : "Progress syncs on signed-in Apple devices. Sign in again after connecting the same Apple identity on the web to complete account linking."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                Section {
                    Button(
                        accountActionInProgress ? "Signing out…" : "Sign out",
                        role: .destructive
                    ) {
                        signOutConfirmation = true
                    }
                    .disabled(accountActionInProgress)
                }
            }

            Section("About") {
                Label(curriculumSizeSummary(model.curriculum), systemImage: "map")
                Label("Synthetic French audio with attribution", systemImage: "waveform")
                Text("Paretto is designed toward WCAG 2.2 AA and contains no advertising or tracking SDKs.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if let privacy = model.environment.serviceURL(path: "/privacy"),
               let terms = model.environment.serviceURL(path: "/terms"),
               let support = model.environment.serviceURL(path: "/support"),
               let accessibility = model.environment.serviceURL(path: "/accessibility"),
               let attributions = model.environment.serviceURL(path: "/attributions") {
                Section("Help and legal") {
                    Link("Privacy policy", destination: privacy)
                    Link("Terms of use", destination: terms)
                    Link("Accessibility", destination: accessibility)
                    Link("Audio attributions", destination: attributions)
                    Link("Support", destination: support)
                }
            }
        }
        .navigationTitle("Profile")
        .parettoInlineNavigationTitle()
        .scrollContentBackground(.hidden)
        .background(Color.parettoCream.ignoresSafeArea())
        .tint(Color.parettoBlue)
        .confirmationDialog(
            model.authSession == nil ? "Delete learning data?" : "Delete your account permanently?",
            isPresented: $deleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete permanently", role: .destructive) {
                Task { await model.deleteLearningData() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(model.authSession == nil
                ? "This removes all learning progress from this device. This cannot be undone."
                : "This removes learning progress from this device and from the Paretto service. This cannot be undone.")
        }
        .confirmationDialog(
            "Sign out and clear this device?",
            isPresented: $signOutConfirmation,
            titleVisibility: .visible
        ) {
            Button("Sign out and clear", role: .destructive) {
                accountActionInProgress = true
                Task {
                    await model.signOut()
                    accountActionInProgress = false
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Offline progress is removed from this device so another account cannot see it. Wait for “Progress saved” before signing out if you have recent changes.")
        }
        .fileExporter(
            isPresented: $exporting,
            document: exportDocument,
            contentType: .json,
            defaultFilename: "paretto-progress"
        ) { result in
            if case .failure(let error) = result { model.alertMessage = error.localizedDescription }
        }
    }

    private func setting(_ keyPath: WritableKeyPath<LearningSettings, Bool>) -> Binding<Bool> {
        Binding(
            get: { model.state.settings[keyPath: keyPath] },
            set: { value in model.updateSettings { $0[keyPath: keyPath] = value } }
        )
    }

    private var deleteButtonTitle: String {
        model.authSession == nil ? "Delete learning data" : "Delete account and learning data"
    }

    private func scheduleReminder(enabled: Bool) {
        reminderTask?.cancel()
        reminderTask = Task {
            do {
                try await ReminderScheduler.setDailyReminder(
                    enabled: enabled,
                    hour: reminderHour,
                    minute: 0
                )
            } catch is CancellationError {
                return
            } catch {
                reminderEnabled = false
                model.alertMessage = error.localizedDescription
            }
        }
    }
}

struct LearningExportDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    let data: Data

    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        self.data = configuration.file.regularFileContents ?? Data()
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
