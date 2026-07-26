import AVFoundation
import Combine
import ParettoCore

struct BundledAudioResource: Equatable {
    let name: String
    let fileExtension: String
    let subdirectory: String
}

@MainActor
final class FrenchAudioPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    @Published private(set) var playingWordID: String?
    private var player: AVAudioPlayer?
    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func play(_ word: FrenchWord, course: CourseMetadata, enabled: Bool) {
        guard enabled else { return }
        stop()
        if let url = bundledURL(for: word, course: course),
           let player = try? AVAudioPlayer(contentsOf: url) {
            self.player = player
            player.delegate = self
            playingWordID = word.id
            player.prepareToPlay()
            if player.play() { return }
            self.player = nil
        }
        let utterance = AVSpeechUtterance(string: word.french)
        utterance.voice = AVSpeechSynthesisVoice(language: course.audioLocale)
        utterance.rate = 0.42
        synthesizer.speak(utterance)
        playingWordID = word.id
    }

    func stop() {
        player?.stop()
        player = nil
        synthesizer.stopSpeaking(at: .immediate)
        playingWordID = nil
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            self?.playingWordID = nil
            self?.player = nil
        }
    }

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didFinish utterance: AVSpeechUtterance
    ) {
        Task { @MainActor [weak self] in self?.playingWordID = nil }
    }

    nonisolated func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        didCancel utterance: AVSpeechUtterance
    ) {
        Task { @MainActor [weak self] in self?.playingWordID = nil }
    }

    private func bundledURL(for word: FrenchWord, course: CourseMetadata) -> URL? {
        guard let resource = Self.bundledResource(for: word, course: course) else {
            return nil
        }
        return Bundle.main.url(
            forResource: resource.name,
            withExtension: resource.fileExtension,
            subdirectory: resource.subdirectory
        )
    }

    nonisolated static func bundledResource(
        for word: FrenchWord,
        course: CourseMetadata
    ) -> BundledAudioResource? {
        let assetPrefix = course.audioAssetPrefix
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let bundleDirectory = assetPrefix.split(separator: "/").last else {
            return nil
        }

        guard let path = word.audioPath else {
            return BundledAudioResource(
                name: word.id,
                fileExtension: "wav",
                subdirectory: "\(bundleDirectory)/v1"
            )
        }
        let expectedPrefix = "/\(assetPrefix)/"
        guard path.hasPrefix(expectedPrefix), path.hasSuffix(".wav") else {
            return nil
        }
        let relativePath = path.dropFirst(expectedPrefix.count)
        let components = relativePath.split(separator: "/")
        guard
            components.count >= 2,
            components.allSatisfy({ $0 != "." && $0 != ".." }),
            let file = components.last
        else { return nil }

        let filename = file.dropLast(".wav".count)
        guard !filename.isEmpty else { return nil }
        let nestedDirectory = components.dropLast().joined(separator: "/")
        return BundledAudioResource(
            name: String(filename),
            fileExtension: "wav",
            subdirectory: "\(bundleDirectory)/\(nestedDirectory)"
        )
    }
}
