import type {
  CmsContentPayload,
  ContentKind,
  LessonContent,
  VocabularyContent,
} from "./admin/admin-types";
import {
  CURRICULUM_PLAN,
  REGIONS,
  WORDS,
  type RegionId,
} from "./learning-data";
import { DEFAULT_COURSE_ID, type CourseId } from "./course-catalog";

export type CompiledCurriculumDraft = {
  courseId: CourseId;
  kind: ContentKind;
  slug: string;
  title: string;
  content: CmsContentPayload;
};

/**
 * Creates the exact draft payloads used by the admin CMS seed workflow.
 *
 * The normal content-create API persists each payload, its immutable stable key,
 * first revision, author and audit event. Nothing here publishes or approves a
 * record; the author/approver separation remains mandatory.
 */
export function compiledCurriculumDrafts(
  regionId: RegionId,
): CompiledCurriculumDraft[] {
  const region = REGIONS.find((candidate) => candidate.id === regionId);
  if (!region) throw new Error(`Unknown compiled curriculum region: ${regionId}.`);

  const plans = CURRICULUM_PLAN[regionId];
  const regionalWords = WORDS.filter((word) => word.regionId === regionId);
  const vocabulary = regionalWords.map<CompiledCurriculumDraft>((word) => ({
    courseId: DEFAULT_COURSE_ID,
    kind: "vocabulary",
    slug: word.id,
    title: `${word.french} — ${word.english}`,
    content: {
      french: word.french,
      english: word.english,
      ipa: word.ipa,
      partOfSpeech: word.partOfSpeech,
      gender: word.gender,
      regionId: word.regionId,
      exampleFr: word.exampleFr,
      exampleEn: word.exampleEn,
      cefr: word.cefr,
      lesson: word.lesson,
      topic: word.topic,
      emoji: word.emoji,
      sensitive: false,
      tags: [word.topic.toLocaleLowerCase("fr")],
    } satisfies VocabularyContent,
  }));

  const lessons = plans.map<CompiledCurriculumDraft>((plan) => {
    const vocabularyIds = regionalWords
      .filter((word) => word.lesson === plan.lesson)
      .map((word) => word.id);
    if (vocabularyIds.length !== 5) {
      throw new Error(
        `${regionId} lesson ${plan.lesson} must contain exactly five compiled cards.`,
      );
    }

    return {
      courseId: DEFAULT_COURSE_ID,
      kind: "lesson",
      slug: `${regionId}-lesson-${plan.lesson}`,
      title: plan.title,
      content: {
        summary: `Practise five ${plan.topic} cards from ${region.name}.`,
        regionId,
        cefr: plan.cefr,
        lesson: plan.lesson,
        topic: plan.topic,
        sensitive: false,
        introduction: region.cultureNote,
        estimatedMinutes: 5,
        vocabularyIds,
        blocks: [
          {
            type: "text",
            content: region.cultureNote,
          },
          {
            type: "exercise",
            content:
              "Listen to each card, reveal its meaning, and use the French example aloud.",
          },
        ],
      } satisfies LessonContent,
    };
  });

  return [...vocabulary, ...lessons];
}
