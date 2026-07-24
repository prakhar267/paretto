import AVFoundation
import Combine
import LoquivoCore

@MainActor
final class FrenchAudioPlayer: NSObject, ObservableObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    @Published private(set) var playingWordID: String?
    private var player: AVAudioPlayer?
    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func play(_ word: FrenchWord, enabled: Bool) {
        guard enabled else { return }
        stop()
        if let url = bundledURL(for: word),
           let player = try? AVAudioPlayer(contentsOf: url) {
            self.player = player
            player.delegate = self
            playingWordID = word.id
            player.prepareToPlay()
            if player.play() { return }
            self.player = nil
        }
        let utterance = AVSpeechUtterance(string: word.french)
        utterance.voice = AVSpeechSynthesisVoice(language: "fr-FR")
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

    private func bundledURL(for word: FrenchWord) -> URL? {
        if let path = word.audioPath {
            let normalized = path
                .replacingOccurrences(of: "/audio/fr/", with: "")
                .replacingOccurrences(of: ".wav", with: "")
            let components = normalized.split(separator: "/").map(String.init)
            if let filename = components.last {
                let subdirectory = components.dropLast().joined(separator: "/")
                if let url = Bundle.main.url(
                    forResource: filename,
                    withExtension: "wav",
                    subdirectory: "FrenchAudio/\(subdirectory)"
                ) { return url }
            }
        }
        return Bundle.main.url(
            forResource: word.id,
            withExtension: "wav",
            subdirectory: "FrenchAudio/v1"
        )
    }
}
