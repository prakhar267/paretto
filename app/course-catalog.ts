/**
 * Stable course identities are part of learner progress, CMS rows, audio
 * routing, and native exports. Never reuse an ID for a different language
 * pair. Adding a course to this catalog does not publish it automatically.
 */
export const DEFAULT_COURSE_ID = "french-from-english";

export const COURSE_CATALOG = {
  [DEFAULT_COURSE_ID]: {
    id: DEFAULT_COURSE_ID,
    status: "published",
    name: "French",
    sourceLanguageName: "English",
    targetLanguageName: "French",
    sourceLocale: "en",
    targetLocale: "fr-FR",
    initialContextId: "ile-de-france",
    audio: {
      locale: "fr-FR",
      assetPrefix: "/audio/fr",
    },
    taxonomy: {
      contextKey: "region",
      contextIdField: "regionId",
      contextSingular: "region",
      contextPlural: "regions",
      journeyLabel: "Journey",
      wordCollectionLabel: "Wordbook",
    },
  },
} as const satisfies Record<string, CourseDefinition>;

export type CourseId = keyof typeof COURSE_CATALOG;
export type PublishedCourse = (typeof COURSE_CATALOG)[CourseId];

export type CourseDefinition = {
  id: string;
  status: "draft" | "published";
  name: string;
  sourceLanguageName: string;
  targetLanguageName: string;
  sourceLocale: string;
  targetLocale: string;
  initialContextId: string;
  audio: {
    locale: string;
    assetPrefix: `/${string}`;
  };
  taxonomy: {
    contextKey: string;
    contextIdField: string;
    contextSingular: string;
    contextPlural: string;
    journeyLabel: string;
    wordCollectionLabel: string;
  };
};

export const DEFAULT_COURSE = COURSE_CATALOG[DEFAULT_COURSE_ID];
export const PUBLISHED_COURSE_IDS = Object.freeze(
  Object.values(COURSE_CATALOG)
    .filter((course) => course.status === "published")
    .map((course) => course.id),
) as readonly CourseId[];

const SAFE_COURSE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_CONTEXT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

for (const [catalogKey, course] of Object.entries(COURSE_CATALOG)) {
  if (
    catalogKey !== course.id ||
    !SAFE_COURSE_ID.test(course.id) ||
    !SAFE_CONTEXT_ID.test(course.initialContextId) ||
    !course.audio.assetPrefix.startsWith("/") ||
    course.audio.assetPrefix.endsWith("/")
  ) {
    throw new Error(`Invalid course catalog entry: ${catalogKey}`);
  }
}

export function isCourseId(value: unknown): value is CourseId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(COURSE_CATALOG, value)
  );
}

export function courseFromId(value: unknown): PublishedCourse | null {
  return isCourseId(value) ? COURSE_CATALOG[value] : null;
}

export function publishedCourseFromId(value: unknown): PublishedCourse | null {
  const course = courseFromId(value);
  return course?.status === "published" ? course : null;
}
