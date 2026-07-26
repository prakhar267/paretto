import { WORDS } from "./learning-data";
import {
  DEFAULT_COURSE_ID,
  type CourseId,
} from "./course-catalog";

const COMPILED_WORD_IDS = new Set(WORDS.map((word) => word.id));
const SAFE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * CMS vocabulary keeps the slug used at creation as an immutable stable key.
 * Compiled overrides retain their existing learner progress ID; new CMS words
 * receive a namespaced ID that remains unchanged when their editorial slug moves.
 */
export function vocabularyPublicId(
  stableKey: string,
  courseId: CourseId = DEFAULT_COURSE_ID,
): string {
  if (!SAFE_KEY.test(stableKey)) {
    throw new Error("Invalid CMS vocabulary stable key.");
  }
  if (courseId === DEFAULT_COURSE_ID) {
    return COMPILED_WORD_IDS.has(stableKey) ? stableKey : `cms-${stableKey}`;
  }
  return `${courseId}-cms-${stableKey}`;
}

export function vocabularyReferenceKey(
  reference: string,
  courseId: CourseId = DEFAULT_COURSE_ID,
): string | null {
  const coursePrefix =
    courseId === DEFAULT_COURSE_ID ? "" : `${courseId}-`;
  const unscoped =
    coursePrefix && reference.startsWith(coursePrefix)
      ? reference.slice(coursePrefix.length)
      : reference;
  const key = unscoped.startsWith("cms-") ? unscoped.slice(4) : unscoped;
  return SAFE_KEY.test(key) ? key : null;
}

export function isCompiledWordId(value: string): boolean {
  return COMPILED_WORD_IDS.has(value);
}
