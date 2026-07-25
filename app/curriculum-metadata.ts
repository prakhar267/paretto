export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export const MIN_CURRICULUM_LESSON_NUMBER = 1;
export const MAX_CURRICULUM_LESSON_NUMBER = 999;

export function isCurriculumLessonNumber(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    Number(value) >= MIN_CURRICULUM_LESSON_NUMBER &&
    Number(value) <= MAX_CURRICULUM_LESSON_NUMBER
  );
}
