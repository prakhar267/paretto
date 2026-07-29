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
    @Published private(set) var lastPlaybackSourceDescription = "Ready"
    private var player: AVAudioPlayer?
    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func play(_ word: FrenchWord, course: CourseMetadata, enabled: Bool) {
        guard enabled else { return }
        stop()
        configureAudioSession()
        if let url = bundledURL(for: word, course: course),
           let player = try? AVAudioPlayer(contentsOf: url) {
            self.player = player
            player.delegate = self
            playingWordID = word.id
            player.prepareToPlay()
            if player.play() {
                lastPlaybackSourceDescription = "High-quality French female recording"
                return
            }
            self.player = nil
        }
        let utterance = AVSpeechUtterance(string: word.french)
        utterance.voice = Self.preferredFemaleVoice(locale: course.audioLocale)
            ?? AVSpeechSynthesisVoice(language: course.audioLocale)
        utterance.rate = 0.42
        utterance.pitchMultiplier = 1
        utterance.volume = 1
        utterance.preUtteranceDelay = 0.024
        utterance.postUtteranceDelay = 0.080
        synthesizer.speak(utterance)
        playingWordID = word.id
        lastPlaybackSourceDescription = "Device French female voice"
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

        guard let path = word.audioPath else { return nil }
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

    private func configureAudioSession() {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.duckOthers]
            )
            try session.setActive(true)
        } catch {
            // A bundled clip can still play with the system's existing session.
        }
        #endif
    }

    nonisolated static func preferredFemaleVoice(
        locale: String,
        voices: [AVSpeechSynthesisVoice] = AVSpeechSynthesisVoice.speechVoices()
    ) -> AVSpeechSynthesisVoice? {
        let normalizedLocale = locale.lowercased()
        let language = normalizedLocale.split(separator: "-").first.map(String.init)
        let candidates = voices.filter { voice in
            let voiceLocale = voice.language.lowercased()
            return voiceLocale == normalizedLocale ||
                (language.map { voiceLocale.hasPrefix($0) } ?? false)
        }
        let femaleCandidates = candidates.filter { $0.gender == .female }
        let rankedCandidates = femaleCandidates.isEmpty ? candidates : femaleCandidates
        return rankedCandidates.max { left, right in
            voiceScore(left, locale: normalizedLocale) <
                voiceScore(right, locale: normalizedLocale)
        }
    }

    nonisolated private static func voiceScore(
        _ voice: AVSpeechSynthesisVoice,
        locale: String
    ) -> Int {
        let exactLocale = voice.language.lowercased() == locale ? 1_000 : 500
        let female = voice.gender == .female ? 200 : 0
        return exactLocale + female + voice.quality.rawValue
    }
}
