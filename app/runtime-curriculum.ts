import type { CmsContentPayload, LessonContent, VocabularyContent } from "./admin/admin-types";
import { WORDS, type Word } from "./learning-data";
import { vocabularyPublicId } from "./curriculum-identity";
import {
  DEFAULT_COURSE_ID,
  type CourseId,
} from "./course-catalog";

export type PublishedRecordInput = {
  id: string;
  courseId?: CourseId;
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
  courseId: CourseId;
  slug: string;
  title: string;
  revision: number;
  summary: string;
  regionId: string;
  cefr: LessonContent["cefr"];
  lesson: LessonContent["lesson"];
  topic: string;
  introduction: string;
  estimatedMinutes: number;
  vocabularyIds: string[];
  blocks: LessonContent["blocks"];
};

export function buildRuntimeCurriculum(
  records: readonly PublishedRecordInput[],
  courseId: CourseId = DEFAULT_COURSE_ID,
): {
  words: Word[];
  lessons: PublishedLesson[];
} {
  const wordsById = new Map(
    (courseId === DEFAULT_COURSE_ID ? WORDS : []).map(
      (word) => [word.id, word] as const,
    ),
  );
  const vocabularyAliases = new Map<string, string>();
  const publishableVocabulary = new Map<string, Word>();
  const lessonCandidates = new Map<
    string,
    {
      record: PublishedRecordInput;
      lesson: PublishedLesson;
      words: Word[];
    }
  >();

  for (const record of records) {
    if ((record.courseId ?? DEFAULT_COURSE_ID) !== courseId) continue;
    if (record.kind === "vocabulary" && isVocabulary(record.content)) {
      const id = vocabularyPublicId(record.stableKey, courseId);
      const word: Word = {
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
      };
      const compiled = wordsById.get(id);
      const safeCompiledOverride =
        !compiled || hasSameCurriculumPlacement(word, compiled);
      if (safeCompiledOverride) {
        publishableVocabulary.set(id, word);
        // A compiled override keeps an already-valid five-card lesson intact.
        // New vocabulary is activated only by a valid published lesson below.
        if (compiled) wordsById.set(id, word);
      }
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
    if ((record.courseId ?? DEFAULT_COURSE_ID) !== courseId) continue;
    if (record.kind === "lesson" && isLesson(record.content)) {
      const vocabularyIds = record.content.vocabularyIds.map(
        (reference) => vocabularyAliases.get(reference) ?? reference,
      );
      if (
        vocabularyIds.length !== 5 ||
        new Set(vocabularyIds).size !== 5
      ) {
        continue;
      }
      const lessonWords = vocabularyIds.map(
        (id) => publishableVocabulary.get(id) ?? wordsById.get(id),
      );
      if (
        lessonWords.some((word) => !word) ||
        !(lessonWords as Word[]).every((word) =>
          wordMatchesLesson(word, record.content as LessonContent),
        )
      ) {
        continue;
      }
      const lesson: PublishedLesson = {
        id: record.id,
        courseId,
        slug: record.slug,
        title: record.title,
        revision: record.revision,
        summary: record.content.summary,
        regionId: record.content.regionId,
        cefr: record.content.cefr,
        lesson: record.content.lesson,
        topic: record.content.topic,
        introduction: record.content.introduction,
        estimatedMinutes: record.content.estimatedMinutes,
        vocabularyIds,
        blocks: record.content.blocks.map((block) => ({ ...block })),
      };
      const slot = lessonSlot(lesson.regionId, lesson.lesson);
      const existing = lessonCandidates.get(slot);
      if (!existing || isNewerRecord(record, existing.record)) {
        lessonCandidates.set(slot, {
          record,
          lesson,
          words: lessonWords as Word[],
        });
      }
    }
  }

  const lessons = [...lessonCandidates.values()]
    .sort((left, right) =>
      left.lesson.regionId.localeCompare(right.lesson.regionId) ||
      left.lesson.lesson - right.lesson.lesson ||
      left.lesson.id.localeCompare(right.lesson.id),
    )
    .map(({ lesson, words: lessonWords }) => {
      for (const [id, word] of wordsById) {
        if (
          word.regionId === lesson.regionId &&
          word.lesson === lesson.lesson
        ) {
          wordsById.delete(id);
        }
      }
      for (const word of lessonWords) wordsById.set(word.id, word);
      return lesson;
    });

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

function hasSameCurriculumPlacement(first: Word, second: Word): boolean {
  return (
    first.regionId === second.regionId &&
    first.cefr === second.cefr &&
    first.lesson === second.lesson &&
    normalizeSearch(first.topic) === normalizeSearch(second.topic)
  );
}

function wordMatchesLesson(word: Word, lesson: LessonContent): boolean {
  return (
    word.regionId === lesson.regionId &&
    word.cefr === lesson.cefr &&
    word.lesson === lesson.lesson &&
    normalizeSearch(word.topic) === normalizeSearch(lesson.topic)
  );
}

function lessonSlot(regionId: string, lesson: number): string {
  return `${regionId}:${lesson}`;
}

function isNewerRecord(
  candidate: PublishedRecordInput,
  current: PublishedRecordInput,
): boolean {
  return (
    Date.parse(candidate.updatedAt) > Date.parse(current.updatedAt) ||
    (candidate.updatedAt === current.updatedAt &&
      (candidate.revision > current.revision ||
        (candidate.revision === current.revision &&
          candidate.id.localeCompare(current.id) > 0)))
  );
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
