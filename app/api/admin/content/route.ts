import { requireAdmin } from "@/app/server-auth";
import {
  apiError,
  apiJson,
  isOpaqueId,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import {
  CONTENT_COLUMNS,
  contentRecordFromRow,
  contentSummaryFromRow,
  getCmsDatabase,
  type ContentRow,
} from "@/app/api/_lib/cms-database";
import {
  DEFAULT_COURSE_ID,
} from "@/app/course-catalog";
import {
  parseCourseId,
  parseContentKind,
  parseContentStatus,
  validateContentCreate,
} from "@/app/api/_lib/content-validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const rawKind = url.searchParams.get("kind");
  const rawStatus = url.searchParams.get("status");
  const rawCourseId = url.searchParams.get("courseId");
  const courseId =
    rawCourseId === null ? DEFAULT_COURSE_ID : parseCourseId(rawCourseId);
  const kind = parseContentKind(rawKind);
  const status = parseContentStatus(rawStatus);
  if (!courseId) return apiError(400, "Invalid course.");
  if (rawKind && !kind) return apiError(400, "Invalid content kind.");
  if (rawStatus && !status) return apiError(400, "Invalid content status.");

  const requestedLimit = Number(url.searchParams.get("limit") ?? 100);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    return apiError(400, "Limit must be an integer from 1 to 100.");
  }
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === null ? null : parseContentCursor(rawCursor);
  if (rawCursor !== null && !cursor) return apiError(400, "Invalid content cursor.");

  const conditions: string[] = ["course_id = ?"];
  const values: unknown[] = [courseId];
  if (kind) {
    conditions.push("kind = ?");
    values.push(kind);
  }
  if (status) {
    conditions.push("status = ?");
    values.push(status);
  }
  if (cursor) {
    conditions.push("(updated_at < ? OR (updated_at = ? AND id > ?))");
    values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const database = await getCmsDatabase();
    const result = await database
      .prepare(
        `SELECT ${CONTENT_COLUMNS} FROM cms_content ${where} ORDER BY updated_at DESC, id ASC LIMIT ?`,
      )
      .bind(...values, requestedLimit + 1)
      .all<ContentRow>();
    const page = result.results.slice(0, requestedLimit);
    const last = page.at(-1);
    return apiJson({
      entries: page.map(contentSummaryFromRow),
      nextCursor:
        result.results.length > requestedLimit && last
          ? `${last.updated_at}:${last.id}`
          : null,
    });
  } catch (error) {
    logApiError("admin_content_list_failed", error);
    return apiError(503, "Content is temporarily unavailable.");
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  const body = await readJsonBody(request, 64 * 1024);
  if (!body.ok) return body.response;
  const parsed = validateContentCreate(body.value);
  if (!parsed.ok) return apiError(400, parsed.error);

  const id = crypto.randomUUID();
  const now = Date.now();
  const contentJson = JSON.stringify(parsed.value.content);
  const row: ContentRow = {
    id,
    course_id: parsed.value.courseId,
    kind: parsed.value.kind,
    slug: parsed.value.slug,
    stable_key: parsed.value.slug,
    title: parsed.value.title,
    content: contentJson,
    status: "draft",
    revision: 1,
    created_at: now,
    updated_at: now,
    published_at: null,
    review_status: "draft",
    reviewed_by_email: null,
    reviewed_at: null,
    approved_revision: null,
    created_by_email: admin.email,
    updated_by_email: admin.email,
  };

  try {
    const database = await getCmsDatabase();
    const results = await database.batch([
      database
        .prepare(
          `INSERT INTO cms_content (
            id, course_id, kind, slug, stable_key, title, content, status, revision,
            created_at, updated_at, published_at, review_status,
            reviewed_by_email, reviewed_at, approved_revision,
            created_by_email, updated_by_email
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, NULL, 'draft',
                 NULL, NULL, NULL, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM cms_slug_tombstones
            WHERE course_id = ? AND kind = ? AND slug = ?
          )`,
        )
        .bind(
          id,
          row.course_id,
          row.kind,
          row.slug,
          row.stable_key,
          row.title,
          contentJson,
          now,
          now,
          admin.email,
          admin.email,
          row.course_id,
          row.kind,
          row.slug,
        ),
      database
        .prepare(
          `INSERT INTO cms_content_revisions (
            course_id, content_id, revision, kind, slug, stable_key, title, content, status,
            published_at, actor_email, action, created_at
          )
          SELECT course_id, id, revision, kind, slug, stable_key, title, content, status,
                 published_at, ?, 'CREATE', ?
          FROM cms_content
          WHERE id = ? AND revision = 1 AND status = 'draft'
            AND slug = ? AND title = ? AND content = ?
            AND updated_at = ? AND updated_by_email = ?
            AND changes() = 1`,
        )
        .bind(
          admin.email,
          now,
          id,
          row.slug,
          row.title,
          contentJson,
          now,
          admin.email,
        ),
      database
        .prepare(
          `INSERT INTO admin_audit_log (
            entity_type, entity_id, actor_email, action, from_revision,
            to_revision, details, created_at
          )
          SELECT 'content', id, ?, 'CREATE', NULL, 1, ?, ?
          FROM cms_content
          WHERE id = ? AND revision = 1 AND status = 'draft'
            AND slug = ? AND title = ? AND content = ?
            AND updated_at = ? AND updated_by_email = ?
            AND changes() = 1`,
        )
        .bind(
          admin.email,
          JSON.stringify({
            courseId: row.course_id,
            kind: row.kind,
            slug: row.slug,
          }),
          now,
          id,
          row.slug,
          row.title,
          contentJson,
          now,
          admin.email,
        ),
      database
        .prepare(
          `INSERT OR IGNORE INTO cms_vocabulary_aliases (
            course_id, alias, content_id, stable_key, created_at
          )
          SELECT course_id, slug, id, stable_key, ?
          FROM cms_content
          WHERE id = ? AND revision = 1 AND kind = 'vocabulary'`,
        )
        .bind(now, id),
    ]);

    if ((results[0].meta.changes ?? 0) !== 1) {
      return apiError(
        409,
        "This slug was previously retired and cannot be assigned to new content.",
        "SLUG_RETIRED",
      );
    }

    return apiJson({ entry: contentRecordFromRow(row) }, 201);
  } catch (error) {
    if (isUniqueConstraint(error)) {
      return apiError(409, "A content item with this kind and slug already exists.");
    }
    logApiError("admin_content_create_failed", error);
    return apiError(503, "Content could not be created.");
  }
}

function parseContentCursor(
  value: string,
): { updatedAt: number; id: string } | null {
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  const updatedAt = Number(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0 || !isOpaqueId(id)) return null;
  return { updatedAt, id };
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    /unique|cms_content_kind_slug_unique/i.test(error.message)
  );
}
