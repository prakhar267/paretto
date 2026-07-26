import {
  CONTENT_KINDS,
  CONTENT_STATUSES,
  SUPPORT_CATEGORIES,
  SUPPORT_STATUSES,
  type CmsContentPayload,
  type ContentKind,
  type ContentStatus,
  type LessonBlock,
  type SupportCategory,
  type SupportStatus,
  type VocabularyContent,
} from "@/app/admin/admin-types";
import {
  CEFR_LEVELS,
  MAX_CURRICULUM_LESSON_NUMBER,
  MIN_CURRICULUM_LESSON_NUMBER,
  isCurriculumLessonNumber,
} from "@/app/curriculum-metadata";
import {
  COURSE_CATALOG,
  courseFromId,
  DEFAULT_COURSE_ID,
  publishedCourseFromId,
  type CourseId,
} from "@/app/course-catalog";
import { REGIONS } from "@/app/learning-data";
import { isRecord } from "./api-utils";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const REGION_IDS = new Set<string>(REGIONS.map((region) => region.id));
const PARTS_OF_SPEECH = new Set([
  "noun",
  "verb",
  "pronominal verb",
  "adjective",
  "adverb",
  "phrase",
]);
const BLOCK_TYPES = new Set(["text", "tip", "exercise"]);

export function validateContentCreate(value: unknown): ValidationResult<{
  courseId: CourseId;
  kind: ContentKind;
  slug: string;
  title: string;
  content: CmsContentPayload;
}> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      ["kind", "slug", "title", "content", "courseId"],
      ["courseId"],
    )
  ) {
    return invalid("Expected courseId, kind, slug, title, and content only.");
  }
  if (!isOneOf(value.kind, CONTENT_KINDS)) return invalid("Invalid content kind.");
  const course = courseFromId(value.courseId ?? DEFAULT_COURSE_ID);
  if (!course) return invalid("Invalid course.");
  const common = validateCommonFields(value.slug, value.title);
  if (!common.ok) return common;
  const content = validatePayload(value.kind, value.content, false, course.id);
  if (!content.ok) return content;
  return {
    ok: true,
    value: {
      courseId: course.id,
      kind: value.kind,
      ...common.value,
      content: content.value,
    },
  };
}

export function validateContentUpdate(
  value: unknown,
  kind: ContentKind,
  courseId: CourseId = DEFAULT_COURSE_ID,
): ValidationResult<{
  revision: number;
  slug: string;
  title: string;
  content: CmsContentPayload;
}> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["revision", "slug", "title", "content"])) {
    return invalid("Expected revision, slug, title, and content only.");
  }
  const revision = validateRevision(value.revision);
  if (!revision.ok) return revision;
  const common = validateCommonFields(value.slug, value.title);
  if (!common.ok) return common;
  const content = validatePayload(kind, value.content, false, courseId);
  if (!content.ok) return content;
  return {
    ok: true,
    value: { revision: revision.value, ...common.value, content: content.value },
  };
}

export function validateRevisionBody(
  value: unknown,
): ValidationResult<{ revision: number }> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["revision"])) {
    return invalid("Expected a revision only.");
  }
  const revision = validateRevision(value.revision);
  return revision.ok
    ? { ok: true, value: { revision: revision.value } }
    : revision;
}

export function validatePublicationBody(value: unknown): ValidationResult<{
  revision: number;
  action: "publish" | "unpublish";
}> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["revision", "action"])) {
    return invalid("Expected revision and action only.");
  }
  const revision = validateRevision(value.revision);
  if (!revision.ok) return revision;
  if (value.action !== "publish" && value.action !== "unpublish") {
    return invalid("Action must be publish or unpublish.");
  }
  return { ok: true, value: { revision: revision.value, action: value.action } };
}

export function validateContentRestoreBody(value: unknown): ValidationResult<{
  revision: number;
  sourceRevision: number;
}> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["revision", "sourceRevision"])) {
    return invalid("Expected revision and sourceRevision only.");
  }
  const revision = validateRevision(value.revision);
  if (!revision.ok) return revision;
  const sourceRevision = validateRevision(value.sourceRevision);
  if (!sourceRevision.ok) return sourceRevision;
  return {
    ok: true,
    value: { revision: revision.value, sourceRevision: sourceRevision.value },
  };
}

export function validateContentReviewBody(value: unknown): ValidationResult<{
  revision: number;
  action: "submit" | "approve" | "request_changes";
  note: string | null;
}> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["revision", "action", "note"], ["note"])
  ) {
    return invalid("Expected revision, review action, and optional note only.");
  }
  const revision = validateRevision(value.revision);
  if (!revision.ok) return revision;
  if (
    value.action !== "submit" &&
    value.action !== "approve" &&
    value.action !== "request_changes"
  ) {
    return invalid("Review action must be submit, approve, or request_changes.");
  }
  let note: string | null = null;
  if (value.note !== undefined && value.note !== null && value.note !== "") {
    note = boundedText(value.note, 2, 500);
    if (!note) return invalid("Review note must be between 2 and 500 characters.");
  }
  if (value.action === "request_changes" && !note) {
    return invalid("A review note is required when requesting changes.");
  }
  return {
    ok: true,
    value: { revision: revision.value, action: value.action, note },
  };
}

export function validateSupportCreate(value: unknown): ValidationResult<{
  replyEmail: string | null;
  category: SupportCategory;
  subject: string;
  body: string;
  turnstileToken: string;
}> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      ["replyEmail", "category", "subject", "body", "turnstileToken"],
      ["replyEmail"],
    )
  ) {
    return invalid(
      "Expected category, subject, body, security token, and optional replyEmail only.",
    );
  }
  if (!isOneOf(value.category, SUPPORT_CATEGORIES)) {
    return invalid("Invalid support category.");
  }
  const subject = boundedText(value.subject, 3, 120);
  if (!subject) return invalid("Subject must be between 3 and 120 characters.");
  const body = boundedText(value.body, 10, 4_000);
  if (!body) return invalid("Message must be between 10 and 4,000 characters.");
  if (
    typeof value.turnstileToken !== "string" ||
    value.turnstileToken.length < 1 ||
    value.turnstileToken.length > 2_048 ||
    /[\u0000-\u001f\u007f]/.test(value.turnstileToken)
  ) {
    return invalid("The security check is required.");
  }

  let replyEmail: string | null = null;
  if (value.replyEmail !== undefined && value.replyEmail !== null && value.replyEmail !== "") {
    if (typeof value.replyEmail !== "string") return invalid("Reply email is invalid.");
    replyEmail = value.replyEmail.trim().toLowerCase();
    if (
      replyEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail)
    ) {
      return invalid("Reply email is invalid.");
    }
  }
  return {
    ok: true,
    value: {
      replyEmail,
      category: value.category,
      subject,
      body,
      turnstileToken: value.turnstileToken,
    },
  };
}

export function validateSupportStatusUpdate(value: unknown): ValidationResult<{
  revision: number;
  status: SupportStatus;
}> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["revision", "status"])) {
    return invalid("Expected revision and status only.");
  }
  const revision = validateRevision(value.revision);
  if (!revision.ok) return revision;
  if (!isOneOf(value.status, SUPPORT_STATUSES)) {
    return invalid("Invalid support status.");
  }
  return { ok: true, value: { revision: revision.value, status: value.status } };
}

export function parseContentStatus(value: string | null): ContentStatus | null {
  return isOneOf(value, CONTENT_STATUSES) ? value : null;
}

export function parseContentKind(value: string | null): ContentKind | null {
  return isOneOf(value, CONTENT_KINDS) ? value : null;
}

export function parseCourseId(value: string | null): CourseId | null {
  const course = courseFromId(value);
  return course?.id ?? null;
}

export function parsePublishedCourseId(
  value: string | null,
): CourseId | null {
  const course = publishedCourseFromId(value);
  return course?.id ?? null;
}

export function parseSupportStatus(value: string | null): SupportStatus | null {
  return isOneOf(value, SUPPORT_STATUSES) ? value : null;
}

export function parseSupportCategory(value: string | null): SupportCategory | null {
  return isOneOf(value, SUPPORT_CATEGORIES) ? value : null;
}

export function parseStoredContent(
  kind: ContentKind,
  value: string,
  courseId: CourseId = DEFAULT_COURSE_ID,
): CmsContentPayload | null {
  try {
    const result = validatePayload(
      kind,
      JSON.parse(value) as unknown,
      true,
      courseId,
    );
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/**
 * Publication deliberately uses the current, strict editorial contract rather
 * than the compatibility parser used to display historical rows. This keeps
 * old drafts readable while requiring an explicit editorial pass before they
 * can go live again.
 */
export function parsePublishableStoredContent(
  kind: ContentKind,
  value: string,
  courseId: CourseId = DEFAULT_COURSE_ID,
): ValidationResult<CmsContentPayload> {
  try {
    return validatePayload(kind, JSON.parse(value) as unknown, false, courseId);
  } catch {
    return invalid("Stored content is not valid JSON.");
  }
}

function validateCommonFields(
  rawSlug: unknown,
  rawTitle: unknown,
): ValidationResult<{ slug: string; title: string }> {
  if (typeof rawSlug !== "string") return invalid("Slug is required.");
  const slug = rawSlug.trim().toLowerCase();
  if (
    slug.length < 3 ||
    slug.length > 80 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  ) {
    return invalid("Slug must contain 3–80 lowercase letters, numbers, or single hyphens.");
  }
  const title = boundedText(rawTitle, 2, 120);
  if (!title) return invalid("Title must be between 2 and 120 characters.");
  return { ok: true, value: { slug, title } };
}

function validatePayload(
  kind: ContentKind,
  value: unknown,
  allowLegacy = false,
  courseId: CourseId = DEFAULT_COURSE_ID,
): ValidationResult<CmsContentPayload> {
  return kind === "vocabulary"
    ? validateVocabulary(value, allowLegacy, courseId)
    : validateLesson(value, allowLegacy, courseId);
}

function validateVocabulary(
  value: unknown,
  allowLegacy: boolean,
  courseId: CourseId,
): ValidationResult<VocabularyContent> {
  const baseKeys = [
    "french",
    "english",
    "ipa",
    "partOfSpeech",
    "gender",
    "regionId",
    "exampleFr",
    "exampleEn",
    "tags",
  ];
  const editorialKeys = [
    "cefr",
    "lesson",
    "topic",
    "emoji",
    "sensitive",
  ];
  const keys = [
    ...baseKeys,
    ...editorialKeys,
  ];
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, keys, allowLegacy ? editorialKeys : [])
  ) {
    return invalid(`Vocabulary content must contain: ${keys.join(", ")}.`);
  }

  const french = boundedText(value.french, 1, 120);
  const english = boundedText(value.english, 1, 120);
  const ipa = boundedText(value.ipa, 1, 120);
  const exampleFr = boundedText(value.exampleFr, 2, 300);
  const exampleEn = boundedText(value.exampleEn, 2, 300);
  if (!french || !english || !ipa || !exampleFr || !exampleEn) {
    return invalid("Vocabulary text fields are missing or exceed their limits.");
  }
  if (!allowLegacy && !/^\/.+\/$/u.test(ipa)) {
    return invalid("IPA must be wrapped in forward slashes.");
  }
  if (typeof value.partOfSpeech !== "string" || !PARTS_OF_SPEECH.has(value.partOfSpeech)) {
    return invalid("Invalid part of speech.");
  }
  if (
    value.gender !== null &&
    value.gender !== "masculine" &&
    value.gender !== "feminine"
  ) {
    return invalid("Gender must be masculine, feminine, or null.");
  }
  if (value.partOfSpeech === "noun" && value.gender === null) {
    return invalid("Nouns require a grammatical gender.");
  }
  if (value.partOfSpeech !== "noun" && value.gender !== null) {
    return invalid("Only nouns may have grammatical gender.");
  }
  if (
    typeof value.regionId !== "string" ||
    (courseId === DEFAULT_COURSE_ID && !REGION_IDS.has(value.regionId))
  ) {
    return invalid(
      `Invalid ${COURSE_CATALOG[courseId].taxonomy.contextSingular}.`,
    );
  }
  if (!Array.isArray(value.tags) || value.tags.length > 10) {
    return invalid("Tags must be an array of no more than 10 items.");
  }
  const tags: string[] = [];
  for (const rawTag of value.tags) {
    if (typeof rawTag !== "string") return invalid("Each tag must be text.");
    const tag = rawTag.trim().toLowerCase();
    if (tag.length < 1 || tag.length > 30 || !/^[\p{L}\p{N} -]+$/u.test(tag)) {
      return invalid("Tags may contain letters, numbers, spaces, and hyphens only.");
    }
    if (!tags.includes(tag)) tags.push(tag);
  }

  const legacyCefr = tags
    .find((tag) => /^(a1|a2|b1|b2|c1|c2)$/i.test(tag))
    ?.toUpperCase();
  const legacyLesson = tags.find((tag) => /^lesson-[1-9][0-9]{0,2}$/i.test(tag));
  const cefr = value.cefr ?? (allowLegacy ? legacyCefr ?? "A2" : null);
  const lesson = value.lesson ??
    (allowLegacy && legacyLesson
      ? Number(legacyLesson.slice("lesson-".length))
      : allowLegacy
        ? 3
        : null);
  const topic = boundedText(
    value.topic ??
      (allowLegacy
        ? tags.find(
            (tag) =>
              !/^(a1|a2|b1|b2|c1|c2|lesson-[1-9][0-9]{0,2})$/i.test(tag),
          ) ?? "editorial"
        : null),
    2,
    80,
  );
  const emoji = boundedText(value.emoji ?? (allowLegacy ? "✨" : null), 1, 12);
  const sensitive = value.sensitive ?? (allowLegacy ? false : null);
  if (!isOneOf(cefr, CEFR_LEVELS)) {
    return invalid("CEFR must be A1, A2, B1, B2, C1, or C2.");
  }
  if (!isCurriculumLessonNumber(lesson)) {
    return invalid(
      `Lesson must be an integer from ${MIN_CURRICULUM_LESSON_NUMBER} to ${MAX_CURRICULUM_LESSON_NUMBER}.`,
    );
  }
  if (!topic) return invalid("Topic must be between 2 and 80 characters.");
  if (!emoji) return invalid("A compact visual marker is required.");
  if (typeof sensitive !== "boolean") return invalid("Sensitive must be a boolean.");

  return {
    ok: true,
    value: {
      french,
      english,
      ipa,
      partOfSpeech: value.partOfSpeech as VocabularyContent["partOfSpeech"],
      gender: value.gender,
      regionId: value.regionId,
      exampleFr,
      exampleEn,
      cefr,
      lesson,
      topic,
      emoji,
      sensitive,
      tags,
    },
  };
}

function validateLesson(
  value: unknown,
  allowLegacy: boolean,
  courseId: CourseId,
): ValidationResult<CmsContentPayload> {
  const editorialKeys = ["cefr", "lesson", "topic", "sensitive"];
  const keys = [
    "summary",
    "regionId",
    ...editorialKeys,
    "introduction",
    "estimatedMinutes",
    "vocabularyIds",
    "blocks",
  ];
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, keys, allowLegacy ? editorialKeys : [])
  ) {
    return invalid(`Lesson content must contain: ${keys.join(", ")}.`);
  }
  const summary = boundedText(value.summary, 10, 300);
  const introduction = boundedText(value.introduction, 10, 2_000);
  if (!summary || !introduction) {
    return invalid("Lesson summary or introduction is missing or exceeds its limit.");
  }
  if (
    typeof value.regionId !== "string" ||
    (courseId === DEFAULT_COURSE_ID && !REGION_IDS.has(value.regionId))
  ) {
    return invalid(
      `Invalid ${COURSE_CATALOG[courseId].taxonomy.contextSingular}.`,
    );
  }
  const cefr = value.cefr ?? (allowLegacy ? "A2" : null);
  const lesson = value.lesson ?? (allowLegacy ? 3 : null);
  const topic = boundedText(value.topic ?? (allowLegacy ? "editorial" : null), 2, 80);
  const sensitive = value.sensitive ?? (allowLegacy ? false : null);
  if (!isOneOf(cefr, CEFR_LEVELS)) {
    return invalid("CEFR must be A1, A2, B1, B2, C1, or C2.");
  }
  if (!isCurriculumLessonNumber(lesson)) {
    return invalid(
      `Lesson must be an integer from ${MIN_CURRICULUM_LESSON_NUMBER} to ${MAX_CURRICULUM_LESSON_NUMBER}.`,
    );
  }
  if (!topic) return invalid("Topic must be between 2 and 80 characters.");
  if (typeof sensitive !== "boolean") return invalid("Sensitive must be a boolean.");
  if (
    !Number.isInteger(value.estimatedMinutes) ||
    Number(value.estimatedMinutes) < 1 ||
    Number(value.estimatedMinutes) > 30
  ) {
    return invalid("Estimated minutes must be an integer from 1 to 30.");
  }
  if (
    !Array.isArray(value.vocabularyIds) ||
    (!allowLegacy && value.vocabularyIds.length !== 5) ||
    (allowLegacy && value.vocabularyIds.length > 30)
  ) {
    return invalid(
      allowLegacy
        ? "Vocabulary IDs must be an array of no more than 30 IDs."
        : "A publishable lesson must contain exactly five vocabulary IDs.",
    );
  }
  const vocabularyIds: string[] = [];
  for (const id of value.vocabularyIds) {
    if (
      typeof id !== "string" ||
      id.length > 80 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(id)
    ) {
      return invalid("A vocabulary ID is invalid.");
    }
    if (vocabularyIds.includes(id)) {
      if (!allowLegacy) return invalid("Lesson vocabulary IDs must be unique.");
    } else {
      vocabularyIds.push(id);
    }
  }
  if (!Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > 20) {
    return invalid("Lessons require between 1 and 20 blocks.");
  }
  const blocks: LessonBlock[] = [];
  for (const rawBlock of value.blocks) {
    if (
      !isRecord(rawBlock) ||
      !hasOnlyKeys(rawBlock, ["type", "content"]) ||
      typeof rawBlock.type !== "string" ||
      !BLOCK_TYPES.has(rawBlock.type)
    ) {
      return invalid("A lesson block is invalid.");
    }
    const content = boundedText(rawBlock.content, 2, 2_000);
    if (!content) return invalid("Lesson block content is missing or too long.");
    blocks.push({ type: rawBlock.type as LessonBlock["type"], content });
  }
  return {
    ok: true,
    value: {
      summary,
      regionId: value.regionId,
      cefr,
      lesson,
      topic,
      sensitive,
      introduction,
      estimatedMinutes: Number(value.estimatedMinutes),
      vocabularyIds,
      blocks,
    },
  };
}

function validateRevision(value: unknown): ValidationResult<number> {
  return Number.isInteger(value) && Number(value) >= 1
    ? { ok: true, value: Number(value) }
    : invalid("A positive integer revision is required.");
}

function boundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) return null;
  if (/\u0000/.test(normalized)) return null;
  return normalized;
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowedSet = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedSet.has(key))) return false;
  return allowed.every((key) => optional.includes(key) || key in record);
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  options: T,
): value is T[number] {
  return typeof value === "string" && options.includes(value as T[number]);
}

function invalid<T = never>(error: string): ValidationResult<T> {
  return { ok: false, error };
}
