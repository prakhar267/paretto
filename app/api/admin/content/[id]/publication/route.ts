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
  QUALIFIED_CONTENT_COLUMNS,
  contentRecordFromRow,
  getCmsDatabase,
  type ContentRow,
} from "@/app/api/_lib/cms-database";
import { validatePublicationBody } from "@/app/api/_lib/content-validation";
import {
  checkPublicationReadiness,
  type PublicationDependency,
} from "@/app/api/_lib/publication-readiness";
import { vocabularyPublicId } from "@/app/curriculum-identity";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;
  const { id } = await context.params;
  if (!isOpaqueId(id)) return apiError(400, "Invalid content ID.");

  const body = await readJsonBody(request, 2 * 1024);
  if (!body.ok) return body.response;
  const parsed = validatePublicationBody(body.value);
  if (!parsed.ok) return apiError(400, parsed.error);

  try {
    const database = await getCmsDatabase();
    const existing = await database
      .prepare(`SELECT ${CONTENT_COLUMNS} FROM cms_content WHERE id = ?`)
      .bind(id)
      .first<ContentRow>();
    if (!existing) return apiError(404, "Content item not found.");
    if (existing.revision !== parsed.value.revision) return revisionConflict();

    const desiredStatus = parsed.value.action === "publish" ? "published" : "draft";
    if (existing.status === desiredStatus) {
      return apiError(409, `Content is already ${desiredStatus}.`, "STATUS_CONFLICT");
    }

    let dependencies: PublicationDependency[] = [];
    if (parsed.value.action === "publish") {
      if (
        existing.review_status !== "approved" ||
        existing.approved_revision !== existing.revision ||
        !existing.reviewed_by_email ||
        existing.reviewed_by_email.toLowerCase() ===
          existing.updated_by_email.toLowerCase()
      ) {
        return apiError(
          409,
          "A different administrator must approve the current revision before publication.",
          "REVIEW_REQUIRED",
        );
      }
      const readiness = await checkPublicationReadiness(database, existing);
      if (!readiness.ok) {
        return apiError(422, readiness.message, readiness.code);
      }
      dependencies = readiness.dependencies;
    }

    let publicationGuardSql = "";
    let publicationGuardValues: unknown[] = [];
    if (parsed.value.action === "publish") {
      publicationGuardSql = `
        AND review_status = 'approved'
        AND approved_revision = revision
        AND reviewed_by_email IS NOT NULL
        AND lower(reviewed_by_email) <> lower(updated_by_email)`;
      for (const dependency of dependencies) {
        publicationGuardSql += `
          AND EXISTS (
            SELECT 1 FROM cms_content AS live_vocabulary
            WHERE live_vocabulary.id = ?
              AND live_vocabulary.course_id = cms_content.course_id
              AND live_vocabulary.stable_key = ?
              AND live_vocabulary.revision = ?
              AND live_vocabulary.kind = 'vocabulary'
              AND live_vocabulary.status = 'published'
          )`;
        publicationGuardValues.push(
          dependency.id,
          dependency.stableKey,
          dependency.revision,
        );
      }
    }

    if (parsed.value.action === "unpublish" && existing.kind === "vocabulary") {
      const references = await vocabularyReferences(database, existing);
      const placeholders = references.map(() => "?").join(", ");
      const dependentRow = await database
        .prepare(
          `SELECT ${QUALIFIED_CONTENT_COLUMNS}
           FROM cms_content AS content,
                json_each(content.content, '$.vocabularyIds') AS vocabulary_reference
           WHERE content.kind = 'lesson'
             AND content.course_id = ?
             AND content.status = 'published'
             AND vocabulary_reference.value IN (${placeholders})
           ORDER BY content.updated_at DESC, content.id ASC
           LIMIT 1`,
        )
        .bind(existing.course_id, ...references)
        .first<ContentRow>();
      const dependentLesson = dependentRow
        ? contentRecordFromRow(dependentRow)
        : null;
      if (dependentLesson) {
        return apiError(
          409,
          `Unpublish the dependent lesson first: ${dependentLesson.title}.`,
          "CONTENT_IN_USE",
        );
      }
      publicationGuardSql = `AND NOT EXISTS (
        SELECT 1
        FROM cms_content AS dependent_lesson,
             json_each(dependent_lesson.content, '$.vocabularyIds') AS vocabulary_reference
        WHERE dependent_lesson.kind = 'lesson'
          AND dependent_lesson.course_id = cms_content.course_id
          AND dependent_lesson.status = 'published'
          AND vocabulary_reference.value IN (${placeholders})
      )`;
      publicationGuardValues = references;
    }

    const now = Date.now();
    const nextRevision = existing.revision + 1;
    const publishedAt = desiredStatus === "published" ? now : null;
    const action = desiredStatus === "published" ? "PUBLISH" : "UNPUBLISH";
    const nextReviewStatus =
      desiredStatus === "published" ? existing.review_status : "draft";
    const nextReviewedBy =
      desiredStatus === "published" ? existing.reviewed_by_email : null;
    const nextReviewedAt =
      desiredStatus === "published" ? existing.reviewed_at : null;
    const nextApprovedRevision =
      desiredStatus === "published" ? existing.approved_revision : null;

    const results = await database.batch([
      database
        .prepare(
          `UPDATE cms_content
           SET status = ?, published_at = ?, revision = revision + 1,
               updated_at = ?, review_status = ?, reviewed_by_email = ?,
               reviewed_at = ?, approved_revision = ?
           WHERE id = ? AND revision = ? AND status = ?
           ${publicationGuardSql}`,
        )
        .bind(
          desiredStatus,
          publishedAt,
          now,
          nextReviewStatus,
          nextReviewedBy,
          nextReviewedAt,
          nextApprovedRevision,
          id,
          existing.revision,
          existing.status,
          ...publicationGuardValues,
        ),
      database
        .prepare(
          `INSERT INTO cms_content_revisions (
            course_id, content_id, revision, kind, slug, stable_key, title, content, status,
            published_at, actor_email, action, created_at
          )
          SELECT course_id, id, revision, kind, slug, stable_key, title, content, status,
                 published_at, ?, ?, ?
          FROM cms_content
          WHERE id = ? AND revision = ? AND status = ?
            AND updated_at = ?
            AND ((? IS NULL AND published_at IS NULL) OR published_at = ?)
            AND changes() = 1`,
        )
        .bind(
          admin.email,
          action,
          now,
          id,
          nextRevision,
          desiredStatus,
          now,
          publishedAt,
          publishedAt,
        ),
      database
        .prepare(
          `INSERT INTO admin_audit_log (
            entity_type, entity_id, actor_email, action, from_revision,
            to_revision, details, created_at
          )
          SELECT 'content', id, ?, ?, ?, ?, ?, ?
          FROM cms_content
          WHERE id = ? AND revision = ? AND status = ?
            AND updated_at = ?
            AND ((? IS NULL AND published_at IS NULL) OR published_at = ?)
            AND changes() = 1`,
        )
        .bind(
          admin.email,
          action,
          existing.revision,
          nextRevision,
          JSON.stringify({
            courseId: existing.course_id,
            fromStatus: existing.status,
            toStatus: desiredStatus,
            approvedRevision: existing.approved_revision,
            reviewer: existing.reviewed_by_email,
          }),
          now,
          id,
          nextRevision,
          desiredStatus,
          now,
          publishedAt,
          publishedAt,
        ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) return revisionConflict();

    const entry = contentRecordFromRow({
      ...existing,
      status: desiredStatus,
      published_at: publishedAt,
      revision: nextRevision,
      updated_at: now,
      review_status: nextReviewStatus,
      reviewed_by_email: nextReviewedBy,
      reviewed_at: nextReviewedAt,
      approved_revision: nextApprovedRevision,
    });
    if (!entry) return apiError(500, "Stored content is invalid.");
    return apiJson({ entry });
  } catch (error) {
    logApiError("admin_content_publication_failed", error);
    return apiError(503, "Publication state could not be changed.");
  }
}

async function vocabularyReferences(
  database: D1Database,
  row: ContentRow,
): Promise<string[]> {
  const result = await database
    .prepare(
      `SELECT alias FROM cms_vocabulary_aliases
       WHERE course_id = ? AND (content_id = ? OR stable_key = ?)`,
    )
    .bind(row.course_id, row.id, row.stable_key)
    .all<{ alias: string }>();
  const references = new Set<string>([
    vocabularyPublicId(row.stable_key, row.course_id),
    row.stable_key,
    `cms-${row.stable_key}`,
  ]);
  for (const { alias } of result.results) {
    references.add(alias);
    references.add(`cms-${alias}`);
  }
  return [...references];
}

function revisionConflict() {
  return apiError(
    409,
    "This item changed after it was opened. Refresh and try again.",
    "REVISION_CONFLICT",
  );
}
