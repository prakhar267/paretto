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
        Group {
            if results.isEmpty {
                ContentUnavailableView(
                    query.isEmpty ? "No learned words yet" : "No matching words",
                    systemImage: "text.book.closed",
                    description: Text(query.isEmpty ? "Finish a lesson and your wordbook will grow automatically." : "Try a French or English word.")
                )
            } else {
                List(results) { word in
                    Button { selectedWord = word } label: {
                        HStack(spacing: 14) {
                            Text(word.emoji).font(.title2).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(word.french).font(.headline).parettoAccessibilityLanguage("fr-FR")
                                Text(word.english).font(.subheadline).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(word.cefr).font(.caption.bold()).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Wordbook")
        .searchable(text: $query, prompt: "French or English")
        .sheet(item: $selectedWord) { WordDetailView(word: $0) }
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
                    Text(word.french).font(.largeTitle.bold()).parettoAccessibilityLanguage("fr-FR")
                    if model.state.settings.phonetics { Text(word.ipa).font(.title3.monospaced()).foregroundStyle(.secondary) }
                    Text(word.english).font(.title2)
                    BrandCard {
                        VStack(spacing: 10) {
                            Text(word.exampleFr).font(.headline).parettoAccessibilityLanguage("fr-FR")
                            Text(word.exampleEn).foregroundStyle(.secondary)
                        }
                    }
                    Button { model.audio.play(word, enabled: model.state.settings.sound) } label: {
                        Label("Hear the French", systemImage: "speaker.wave.2.fill")
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(22)
            }
            .navigationTitle("Word details")
            .parettoInlineNavigationTitle()
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}
