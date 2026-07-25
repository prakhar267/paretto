import type {
  CmsContentPayload,
  ContentKind,
} from "@/app/admin/admin-types";
import {
  CONTENT_COLUMNS,
  contentRecordFromRow,
  getCmsDatabase,
  type ContentRow,
} from "@/app/api/_lib/cms-database";
import {
  COURSE_CATALOG,
  DEFAULT_COURSE_ID,
  type CourseId,
  type PublishedCourse,
} from "@/app/course-catalog";

export type PublishedCurriculumRecord = {
  id: string;
  courseId: CourseId;
  kind: ContentKind;
  slug: string;
  stableKey: string;
  aliases: string[];
  title: string;
  revision: number;
  updatedAt: string;
  content: CmsContentPayload;
};

export type PublishedCurriculum = {
  course: PublishedCourse;
  source: "cms" | "compiled" | "compiled-fallback";
  revision: string;
  records: PublishedCurriculumRecord[];
};

const CURRICULUM_PAGE_SIZE = 250;

/**
 * Loads only validated, published curriculum. D1 outages and malformed rows
 * deliberately return an empty overlay so callers can keep using the compiled
 * curriculum without interrupting a learning session.
 */
export async function getPublishedCurriculum(
  courseId: CourseId = DEFAULT_COURSE_ID,
): Promise<PublishedCurriculum> {
  const course = COURSE_CATALOG[courseId];
  try {
    const database = await getCmsDatabase();
    const [rows, aliasesByContentId] = await Promise.all([
      readAllPublishedRows(database, courseId),
      readAllVocabularyAliases(database, courseId),
    ]);

    const records = rows.flatMap<PublishedCurriculumRecord>((row) => {
      const entry = contentRecordFromRow(row);
      if (!entry || entry.status !== "published") {
        console.error(
          JSON.stringify({
            event: "published_curriculum_row_skipped",
            contentId: row.id,
            timestamp: new Date().toISOString(),
          }),
        );
        return [];
      }
      return [
        {
          id: entry.id,
          courseId: entry.courseId as CourseId,
          kind: entry.kind,
          slug: entry.slug,
          stableKey: entry.stableKey,
          aliases: aliasesByContentId.get(entry.id) ?? [],
          title: entry.title,
          revision: entry.revision,
          updatedAt: entry.updatedAt,
          content: entry.content,
        },
      ];
    });

    return records.length === 0
      ? {
          source: rows.length === 0 ? "compiled" : "compiled-fallback",
          course,
          revision: "compiled-v1",
          records: [],
        }
      : {
          source: "cms",
          course,
          revision: curriculumRevision(records),
          records,
        };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "published_curriculum_load_failed",
        message: error instanceof Error ? error.message : "unknown error",
        timestamp: new Date().toISOString(),
      }),
    );
    return {
      course,
      source: "compiled-fallback",
      revision: "compiled-v1",
      records: [],
    };
  }
}

async function readAllVocabularyAliases(
  database: D1Database,
  courseId: CourseId,
): Promise<Map<string, string[]>> {
  const aliasesByContentId = new Map<string, string[]>();
  let aliasAfter = "";

  while (true) {
    const page = await database
      .prepare(
        `SELECT vocabulary_alias.alias, vocabulary_alias.content_id
         FROM cms_vocabulary_aliases AS vocabulary_alias
         JOIN cms_content AS content
           ON content.id = vocabulary_alias.content_id
          AND content.course_id = vocabulary_alias.course_id
         WHERE vocabulary_alias.course_id = ?
           AND vocabulary_alias.alias > ?
           AND content.kind = 'vocabulary'
           AND content.status = 'published'
         ORDER BY vocabulary_alias.alias ASC
         LIMIT ?`,
      )
      .bind(courseId, aliasAfter, CURRICULUM_PAGE_SIZE)
      .all<{ alias: string; content_id: string }>();
    for (const row of page.results) {
      const aliases = aliasesByContentId.get(row.content_id) ?? [];
      aliases.push(row.alias);
      aliasesByContentId.set(row.content_id, aliases);
    }
    if (page.results.length < CURRICULUM_PAGE_SIZE) return aliasesByContentId;
    const last = page.results.at(-1);
    if (!last || last.alias <= aliasAfter) {
      throw new Error("Vocabulary alias pagination did not advance.");
    }
    aliasAfter = last.alias;
  }
}

async function readAllPublishedRows(
  database: D1Database,
  courseId: CourseId,
): Promise<ContentRow[]> {
  const rows: ContentRow[] = [];
  let updatedAfter = -1;
  let idAfter = "";

  while (true) {
    const page = await database
      .prepare(
        `SELECT ${CONTENT_COLUMNS} FROM cms_content
         WHERE status = 'published'
           AND course_id = ?
           AND (updated_at > ? OR (updated_at = ? AND id > ?))
         ORDER BY updated_at ASC, id ASC
         LIMIT ?`,
      )
      .bind(
        courseId,
        updatedAfter,
        updatedAfter,
        idAfter,
        CURRICULUM_PAGE_SIZE,
      )
      .all<ContentRow>();
    rows.push(...page.results);
    if (page.results.length < CURRICULUM_PAGE_SIZE) return rows;

    const last = page.results.at(-1);
    if (
      !last ||
      last.updated_at < updatedAfter ||
      (last.updated_at === updatedAfter && last.id <= idAfter)
    ) {
      throw new Error("Published curriculum pagination did not advance.");
    }
    updatedAfter = last.updated_at;
    idAfter = last.id;
  }
}

function curriculumRevision(records: PublishedCurriculumRecord[]): string {
  const newestUpdate = records.reduce(
    (latest, entry) => Math.max(latest, Date.parse(entry.updatedAt) || 0),
    0,
  );
  const revisionTotal = records.reduce(
    (total, entry) => total + entry.revision,
    0,
  );
  return `cms-v1-${records.length}-${newestUpdate}-${revisionTotal}`;
}
