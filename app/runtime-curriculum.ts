import type { CmsContentPayload, LessonContent, VocabularyContent } from "./admin/admin-types";
import { WORDS, type Word } from "./learning-data";
import { vocabularyPublicId } from "./curriculum-identity";

export type PublishedRecordInput = {
  id: string;
  kind: "vocabulary" | "lesson";
  slug: string;
  stableKey: string;
  aliases?: readonly string[];
  title: string;
  revision: number;
  updatedAt: string;
  content: CmsContentPayload;
};

export type PublishedLesson = {
  id: string;
  slug: string;
  title: string;
  revision: number;
  summary: string;
  regionId: string;
  introduction: string;
  estimatedMinutes: number;
  vocabularyIds: string[];
  blocks: LessonContent["blocks"];
};

export function buildRuntimeCurriculum(records: readonly PublishedRecordInput[]): {
  words: Word[];
  lessons: PublishedLesson[];
} {
  const wordsById = new Map(WORDS.map((word) => [word.id, word] as const));
  const vocabularyAliases = new Map<string, string>();
  const lessons: PublishedLesson[] = [];

  for (const record of records) {
    if (record.kind === "vocabulary" && isVocabulary(record.content)) {
      const id = vocabularyPublicId(record.stableKey);
      wordsById.set(id, {
        id,
        regionId: record.content.regionId,
        french: record.content.french,
        search: normalizeSearch(
          `${record.content.french} ${record.content.english} ${record.title}`,
        ),
        english: record.content.english,
        ipa: record.content.ipa,
        partOfSpeech: record.content.partOfSpeech,
        gender: record.content.gender,
        emoji: record.content.emoji,
        exampleFr: record.content.exampleFr,
        exampleEn: record.content.exampleEn,
        cefr: record.content.cefr,
        topic: record.content.topic,
        lesson: record.content.lesson,
      });
      for (const alias of [
        id,
        record.stableKey,
        `cms-${record.stableKey}`,
        record.slug,
        `cms-${record.slug}`,
        ...(record.aliases ?? []).flatMap((alias) => [alias, `cms-${alias}`]),
      ]) {
        vocabularyAliases.set(alias, id);
      }
    }
  }

  for (const record of records) {
    if (record.kind === "lesson" && isLesson(record.content)) {
      lessons.push({
        id: record.id,
        slug: record.slug,
        title: record.title,
        revision: record.revision,
        summary: record.content.summary,
        regionId: record.content.regionId,
        introduction: record.content.introduction,
        estimatedMinutes: record.content.estimatedMinutes,
        vocabularyIds: record.content.vocabularyIds.map(
          (reference) => vocabularyAliases.get(reference) ?? reference,
        ),
        blocks: record.content.blocks.map((block) => ({ ...block })),
      });
    }
  }

  return { words: [...wordsById.values()], lessons };
}

export function lessonVocabulary(
  lesson: PublishedLesson,
  words: readonly Word[],
): Word[] {
  const byId = new Map(words.map((word) => [word.id, word] as const));
  const result: Word[] = [];
  for (const requestedId of lesson.vocabularyIds) {
    const alternateId = requestedId.startsWith("cms-")
      ? requestedId.slice(4)
      : `cms-${requestedId}`;
    const word = byId.get(requestedId) ?? byId.get(alternateId);
    if (word && !result.some((item) => item.id === word.id)) result.push(word);
  }
  return result;
}

function isVocabulary(content: CmsContentPayload): content is VocabularyContent {
  return "french" in content;
}

function isLesson(content: CmsContentPayload): content is LessonContent {
  return "summary" in content;
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
