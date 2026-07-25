import Foundation

public struct CourseTaxonomy: Codable, Equatable, Sendable {
    public let contextKey: String
    public let contextIdField: String
    public let contextSingular: String
    public let contextPlural: String
    public let journeyLabel: String
    public let wordCollectionLabel: String

    public init(
        contextKey: String,
        contextIdField: String,
        contextSingular: String,
        contextPlural: String,
        journeyLabel: String,
        wordCollectionLabel: String
    ) {
        self.contextKey = contextKey
        self.contextIdField = contextIdField
        self.contextSingular = contextSingular
        self.contextPlural = contextPlural
        self.journeyLabel = journeyLabel
        self.wordCollectionLabel = wordCollectionLabel
    }
}

public struct CourseMetadata: Codable, Equatable, Sendable {
    public let id: String
    public let sourceLanguageName: String
    public let targetLanguageName: String
    public let sourceLocale: String
    public let targetLocale: String
    public let initialContextId: String
    public let audioLocale: String
    public let audioAssetPrefix: String
    public let taxonomy: CourseTaxonomy

    public init(
        id: String,
        sourceLanguageName: String,
        targetLanguageName: String,
        sourceLocale: String,
        targetLocale: String,
        initialContextId: String,
        audioLocale: String,
        audioAssetPrefix: String,
        taxonomy: CourseTaxonomy
    ) {
        self.id = id
        self.sourceLanguageName = sourceLanguageName
        self.targetLanguageName = targetLanguageName
        self.sourceLocale = sourceLocale
        self.targetLocale = targetLocale
        self.initialContextId = initialContextId
        self.audioLocale = audioLocale
        self.audioAssetPrefix = audioAssetPrefix
        self.taxonomy = taxonomy
    }

    public static let frenchFromEnglish = CourseMetadata(
        id: "french-from-english",
        sourceLanguageName: "English",
        targetLanguageName: "French",
        sourceLocale: "en",
        targetLocale: "fr-FR",
        initialContextId: "ile-de-france",
        audioLocale: "fr-FR",
        audioAssetPrefix: "/audio/fr",
        taxonomy: CourseTaxonomy(
            contextKey: "region",
            contextIdField: "regionId",
            contextSingular: "region",
            contextPlural: "regions",
            journeyLabel: "Journey",
            wordCollectionLabel: "Wordbook"
        )
    )
}

public struct CurriculumBundle: Codable, Sendable {
    public let schemaVersion: Int
    public let revision: String
    public let audioAssetVersion: String
    public let audioAttributionPath: String
    public let course: CourseMetadata
    public let regions: [Region]
    public let lessons: [LessonPlan]
    public let words: [FrenchWord]

    public init(
        schemaVersion: Int,
        revision: String,
        audioAssetVersion: String,
        audioAttributionPath: String,
        regions: [Region],
        lessons: [LessonPlan],
        words: [FrenchWord],
        course: CourseMetadata = .frenchFromEnglish
    ) {
        self.schemaVersion = schemaVersion
        self.revision = revision
        self.audioAssetVersion = audioAssetVersion
        self.audioAttributionPath = audioAttributionPath
        self.course = course
        self.regions = regions
        self.lessons = lessons
        self.words = words
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, revision, audioAssetVersion, audioAttributionPath
        case course, regions, lessons, words
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try values.decode(Int.self, forKey: .schemaVersion)
        revision = try values.decode(String.self, forKey: .revision)
        audioAssetVersion = try values.decode(String.self, forKey: .audioAssetVersion)
        audioAttributionPath = try values.decode(String.self, forKey: .audioAttributionPath)
        course = try values.decodeIfPresent(CourseMetadata.self, forKey: .course) ?? .frenchFromEnglish
        regions = try values.decode([Region].self, forKey: .regions)
        lessons = try values.decode([LessonPlan].self, forKey: .lessons)
        words = try values.decode([FrenchWord].self, forKey: .words)
    }

    public func words(in regionID: String, lesson: Int? = nil) -> [FrenchWord] {
        words.filter { word in
            word.regionID == regionID && (lesson == nil || word.lesson == lesson)
        }
    }

    public func region(id: String) -> Region? {
        regions.first { $0.id == id }
    }
}

public struct Region: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let shortLabel: String
    public let number: Int
    public let emoji: String
    public let theme: String
    public let cultureNote: String
    public let accentColor: String
}

public struct LessonPlan: Codable, Identifiable, Hashable, Sendable {
    public var id: String { "\(regionID)-\(lesson)" }
    public let regionID: String
    public let lesson: Int
    public let title: String
    public let topic: String
    public let cefr: String

    enum CodingKeys: String, CodingKey {
        case regionID = "regionId"
        case lesson, title, topic, cefr
    }
}

public struct FrenchWord: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let regionID: String
    public let french: String
    public let search: String
    public let english: String
    public let ipa: String
    public let partOfSpeech: String
    public let gender: String?
    public let emoji: String
    public let exampleFr: String
    public let exampleEn: String
    public let cefr: String
    public let topic: String
    public let lesson: Int
    public let audioPath: String?

    enum CodingKeys: String, CodingKey {
        case id
        case regionID = "regionId"
        case french, search, english, ipa, partOfSpeech, gender, emoji
        case exampleFr, exampleEn, cefr, topic, lesson, audioPath
    }

    public var searchableText: String {
        "\(french) \(search) \(english)".foldedForSearch
    }
}

public enum CurriculumLoader {
    public static func bundled() throws -> CurriculumBundle {
        guard let url = Bundle.module.url(forResource: "curriculum", withExtension: "json") else {
            throw CurriculumError.missingResource
        }
        let data = try Data(contentsOf: url)
        let curriculum = try JSONDecoder().decode(CurriculumBundle.self, from: data)
        guard curriculum.schemaVersion == 1 else {
            throw CurriculumError.unsupportedSchema(curriculum.schemaVersion)
        }
        return curriculum
    }
}

public enum CurriculumError: Error, Equatable {
    case missingResource
    case unsupportedSchema(Int)
}

public extension String {
    var foldedForSearch: String {
        folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "fr_FR"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
