import type {
  LessonContent,
  VocabularyContent,
} from "@/app/admin/admin-types";
import {
  hasFrenchAudioAsset,
  isFrenchAudioDistributionReady,
} from "@/app/audio/french-audio-manifest";
import {
  vocabularyPublicId,
  vocabularyReferenceKey,
} from "@/app/curriculum-identity";
import { WORDS, type Word } from "@/app/learning-data";
import {
  QUALIFIED_CONTENT_COLUMNS,
  type ContentRow,
} from "./cms-database";
import { parsePublishableStoredContent } from "./content-validation";

export type PublicationReadinessError = {
  ok: false;
  code:
    | "EDITORIAL_METADATA_REQUIRED"
    | "AUDIO_NOT_PACKAGED"
    | "MISSING_VOCABULARY"
    | "NON_CANONICAL_VOCABULARY_ID"
    | "VOCABULARY_METADATA_MISMATCH";
  message: string;
};

export type PublicationDependency = {
  id: string;
  stableKey: string;
  revision: number;
};

export type PublicationReadiness =
  | { ok: true; dependencies: PublicationDependency[] }
  | PublicationReadinessError;

type AliasedVocabularyRow = ContentRow & { matched_alias: string };

const COMPILED_WORDS = new Map(WORDS.map((word) => [word.id, word] as const));

export async function checkPublicationReadiness(
  database: D1Database,
  row: ContentRow,
): Promise<PublicationReadiness> {
  const parsed = parsePublishableStoredContent(row.kind, row.content);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "EDITORIAL_METADATA_REQUIRED",
      message: `Complete the required editorial metadata before review: ${parsed.error}`,
    };
  }

  if (row.kind === "vocabulary") {
    const vocabulary = parsed.value as VocabularyContent;
    const publicId = vocabularyPublicId(row.stable_key);
    if (
      !isFrenchAudioDistributionReady() ||
      !hasFrenchAudioAsset(publicId, vocabulary.french)
    ) {
      return {
        ok: false,
        code: "AUDIO_NOT_PACKAGED",
        message: `Package reviewed French audio for ${publicId} before approval.`,
      };
    }
    return { ok: true, dependencies: [] };
  }

  const lesson = parsed.value as LessonContent;
  return checkLessonVocabulary(database, lesson);
}

async function checkLessonVocabulary(
  database: D1Database,
  lesson: LessonContent,
): Promise<PublicationReadiness> {
  const referenceKeys = lesson.vocabularyIds.map(vocabularyReferenceKey);
  if (referenceKeys.some((key) => key === null)) {
    return {
      ok: false,
      code: "MISSING_VOCABULARY",
      message: "A lesson vocabulary reference is invalid.",
    };
  }

  const keys = [...new Set(referenceKeys as string[])];
  const cmsByAlias = await readCmsVocabulary(database, keys);
  const dependencies = new Map<string, PublicationDependency>();

  for (let index = 0; index < lesson.vocabularyIds.length; index += 1) {
    const reference = lesson.vocabularyIds[index];
    const key = referenceKeys[index] as string;
    const discoveredCmsRow = cmsByAlias.get(key);
    const cmsRow =
      discoveredCmsRow?.status === "published" ? discoveredCmsRow : undefined;
    const compiled = COMPILED_WORDS.get(key);
    const canonicalId = cmsRow
      ? vocabularyPublicId(cmsRow.stable_key)
      : compiled
        ? key
        : null;

    if (!canonicalId) {
      return missingVocabulary(reference);
    }
    if (reference !== canonicalId) {
      return {
        ok: false,
        code: "NON_CANONICAL_VOCABULARY_ID",
        message: `Use the stable vocabulary ID “${canonicalId}” instead of “${reference}”.`,
      };
    }

    if (cmsRow) {
      const parsed = parsePublishableStoredContent("vocabulary", cmsRow.content);
      if (!parsed.ok || !("french" in parsed.value)) {
        return {
          ok: false,
          code: "EDITORIAL_METADATA_REQUIRED",
          message: `Referenced vocabulary “${reference}” needs an editorial update before this lesson can be approved.`,
        };
      }
      if (
        !isFrenchAudioDistributionReady() ||
        !hasFrenchAudioAsset(canonicalId, parsed.value.french)
      ) {
        return {
          ok: false,
          code: "AUDIO_NOT_PACKAGED",
          message: `Referenced vocabulary “${reference}” does not have matching packaged audio.`,
        };
      }
      const mismatch = vocabularyMismatch(lesson, parsed.value);
      if (mismatch) return mismatchError(reference, mismatch);
      dependencies.set(cmsRow.id, {
        id: cmsRow.id,
        stableKey: cmsRow.stable_key,
        revision: cmsRow.revision,
      });
      continue;
    }

    if (!compiled) return missingVocabulary(reference);
    if (
      !isFrenchAudioDistributionReady() ||
      !hasFrenchAudioAsset(compiled.id, compiled.french)
    ) {
      return {
        ok: false,
        code: "AUDIO_NOT_PACKAGED",
        message: `Referenced vocabulary “${reference}” does not have matching packaged audio.`,
      };
    }
    const mismatch = vocabularyMismatch(lesson, compiled);
    if (mismatch) return mismatchError(reference, mismatch);
  }

  return { ok: true, dependencies: [...dependencies.values()] };
}

async function readCmsVocabulary(
  database: D1Database,
  aliases: string[],
): Promise<Map<string, AliasedVocabularyRow>> {
  if (aliases.length === 0) return new Map();
  const placeholders = aliases.map(() => "?").join(", ");
  const result = await database
    .prepare(
      `SELECT vocabulary_alias.alias AS matched_alias, ${QUALIFIED_CONTENT_COLUMNS}
       FROM cms_vocabulary_aliases AS vocabulary_alias
       JOIN cms_content AS content ON content.id = vocabulary_alias.content_id
       WHERE vocabulary_alias.alias IN (${placeholders})
         AND content.kind = 'vocabulary'`,
    )
    .bind(...aliases)
    .all<AliasedVocabularyRow>();
  return new Map(result.results.map((row) => [row.matched_alias, row] as const));
}

function vocabularyMismatch(
  lesson: LessonContent,
  vocabulary:
    | Pick<Word, "regionId" | "cefr" | "lesson" | "topic">
    | Pick<
        VocabularyContent,
        "regionId" | "cefr" | "lesson" | "topic" | "sensitive"
      >,
): string | null {
  if (vocabulary.regionId !== lesson.regionId) return "region";
  if (vocabulary.cefr !== lesson.cefr) return "CEFR level";
  if (vocabulary.lesson !== lesson.lesson) return "lesson number";
  if (normalize(vocabulary.topic) !== normalize(lesson.topic)) return "topic";
  if (
    "sensitive" in vocabulary &&
    vocabulary.sensitive &&
    !lesson.sensitive
  ) {
    return "sensitive-content flag";
  }
  return null;
}

function missingVocabulary(reference: string): PublicationReadinessError {
  return {
    ok: false,
    code: "MISSING_VOCABULARY",
    message: `Publish the referenced vocabulary first: ${reference}.`,
  };
}

function mismatchError(
  reference: string,
  field: string,
): PublicationReadinessError {
  return {
    ok: false,
    code: "VOCABULARY_METADATA_MISMATCH",
    message: `Vocabulary “${reference}” does not match the lesson ${field}.`,
  };
}

function normalize(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("fr");
}
