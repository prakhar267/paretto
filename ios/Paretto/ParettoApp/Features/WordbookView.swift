import ParettoCore
import SwiftUI

struct WordbookView: View {
    @EnvironmentObject private var model: AppModel
    @State private var query = ""
    @State private var selectedWord: FrenchWord?

    private var results: [FrenchWord] {
        let learned = model.curriculum.words.filter { model.state.wordProgress[$0.id] != nil }
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return learned }
        let needle = query.foldedForSearch
        return learned.filter { $0.searchableText.contains(needle) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    ParettoEyebrow(text: "Your collected French")
                    Text("Every word you have made your own.")
                        .font(.system(.largeTitle, design: .serif, weight: .bold))
                        .foregroundStyle(Color.parettoNavy)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Search by French or English, then listen and revisit it in context.")
                        .foregroundStyle(Color.parettoMuted)
                }

                if results.isEmpty {
                    BrandCard {
                        ContentUnavailableView(
                            query.isEmpty ? "No learned words yet" : "No matching words",
                            systemImage: "text.book.closed",
                            description: Text(query.isEmpty ? "Finish a lesson and your wordbook will grow automatically." : "Try a French or English word.")
                        )
                        .frame(maxWidth: .infinity, minHeight: 260)
                    }
                } else {
                    LazyVStack(spacing: 10) {
                        ForEach(results) { word in
                            Button { selectedWord = word } label: {
                                HStack(spacing: 14) {
                                    Text(word.emoji).font(.title2).accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(word.french)
                                            .font(.system(.headline, design: .serif, weight: .bold))
                                            .foregroundStyle(Color.parettoNavy)
                                            .parettoAccessibilityLanguage("fr-FR")
                                        Text(word.english).font(.subheadline).foregroundStyle(Color.parettoMuted)
                                    }
                                    Spacer()
                                    Text(word.cefr)
                                        .font(.caption.bold())
                                        .foregroundStyle(Color.parettoBlue)
                                        .padding(.horizontal, 9)
                                        .padding(.vertical, 5)
                                        .background(Color.parettoBlueSoft, in: Capsule())
                                    Image(systemName: "chevron.right")
                                        .font(.caption.bold())
                                        .foregroundStyle(Color.parettoMuted)
                                        .accessibilityHidden(true)
                                }
                                .padding(16)
                                .background(Color.parettoPaper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .stroke(Color.parettoLineSoft, lineWidth: 1)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .frame(maxWidth: 820)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
            .padding(.vertical, 22)
        }
        .navigationTitle("Wordbook")
        .parettoInlineNavigationTitle()
        .searchable(text: $query, prompt: "French or English")
        .sheet(item: $selectedWord) { WordDetailView(word: $0) }
        .parettoPageBackground()
    }
}

private struct WordDetailView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let word: FrenchWord

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    Text(word.emoji).font(.system(size: 62)).accessibilityHidden(true)
                    Text(word.french)
                        .font(.system(.largeTitle, design: .serif, weight: .bold))
                        .foregroundStyle(Color.parettoNavy)
                        .parettoAccessibilityLanguage("fr-FR")
                    if model.state.settings.phonetics { Text(word.ipa).font(.title3.monospaced()).foregroundStyle(.secondary) }
                    Text(word.english).font(.title2)
                    BrandCard {
                        VStack(spacing: 10) {
                            Text(word.exampleFr).font(.headline).parettoAccessibilityLanguage("fr-FR")
                            Text(word.exampleEn).foregroundStyle(.secondary)
                        }
                    }
                    Button {
                        model.audio.play(
                            word,
                            course: model.curriculum.course,
                            enabled: model.state.settings.sound
                        )
                    } label: {
                        Label("Hear the French", systemImage: "speaker.wave.2.fill")
                    }
                    .buttonStyle(PrimaryActionStyle())
                    .accessibilityValue(model.audio.lastPlaybackSourceDescription)
                }
                .padding(22)
            }
            .navigationTitle("Word details")
            .parettoInlineNavigationTitle()
            .toolbar { Button("Done") { dismiss() } }
            .parettoPageBackground()
        }
    }
}
