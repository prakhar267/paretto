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
  getCmsDatabase,
  type ContentRow,
} from "@/app/api/_lib/cms-database";
import {
  validateContentUpdate,
  validateRevisionBody,
} from "@/app/api/_lib/content-validation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;
  const id = await contentId(context);
  if (!id) return apiError(400, "Invalid content ID.");

  try {
    const database = await getCmsDatabase();
    const row = await findContent(database, id);
    if (!row) return apiError(404, "Content item not found.");
    const entry = contentRecordFromRow(row);
    if (!entry) return apiError(500, "Stored content is invalid.");
    return apiJson({ entry });
  } catch (error) {
    logApiError("admin_content_read_failed", error);
    return apiError(503, "Content is temporarily unavailable.");
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;
  const id = await contentId(context);
  if (!id) return apiError(400, "Invalid content ID.");

  const body = await readJsonBody(request, 64 * 1024);
  if (!body.ok) return body.response;

  try {
    const database = await getCmsDatabase();
    const existing = await findContent(database, id);
    if (!existing) return apiError(404, "Content item not found.");
    if (existing.status === "published") {
      return apiError(
        409,
        "Unpublish this item before editing it.",
        "STATUS_CONFLICT",
      );
    }
    const parsed = validateContentUpdate(
      body.value,
      existing.kind,
      existing.course_id,
    );
    if (!parsed.ok) return apiError(400, parsed.error);
    if (parsed.value.revision !== existing.revision) return revisionConflict();

    const now = Date.now();
    const nextRevision = existing.revision + 1;
    const contentJson = JSON.stringify(parsed.value.content);
    const results = await database.batch([
      database
        .prepare(
          `UPDATE cms_content
           SET slug = ?, title = ?, content = ?, revision = revision + 1,
               updated_at = ?, updated_by_email = ?, review_status = 'draft',
               reviewed_by_email = NULL, reviewed_at = NULL,
               approved_revision = NULL
           WHERE id = ? AND revision = ? AND status = 'draft'
             AND NOT EXISTS (
               SELECT 1 FROM cms_slug_tombstones AS retired_slug
               WHERE retired_slug.course_id = cms_content.course_id
                 AND retired_slug.kind = cms_content.kind
                 AND retired_slug.slug = ?
                 AND retired_slug.content_id <> cms_content.id
             )`,
        )
        .bind(
          parsed.value.slug,
          parsed.value.title,
          contentJson,
          now,
          admin.email,
          id,
          existing.revision,
          parsed.value.slug,
        ),
      database
        .prepare(
          `INSERT INTO cms_content_revisions (
            course_id, content_id, revision, kind, slug, stable_key, title, content, status,
            published_at, actor_email, action, created_at
          )
          SELECT course_id, id, revision, kind, slug, stable_key, title, content, status,
                 published_at, ?, 'UPDATE', ?
          FROM cms_content
          WHERE id = ? AND revision = ? AND status = 'draft'
            AND slug = ? AND title = ? AND content = ?
            AND updated_at = ? AND updated_by_email = ?
            AND changes() = 1`,
        )
        .bind(
          admin.email,
          now,
          id,
          nextRevision,
          parsed.value.slug,
          parsed.value.title,
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
          SELECT 'content', id, ?, 'UPDATE', ?, ?, ?, ?
          FROM cms_content
          WHERE id = ? AND revision = ? AND status = 'draft'
            AND slug = ? AND title = ? AND content = ?
            AND updated_at = ? AND updated_by_email = ?
            AND changes() = 1`,
        )
        .bind(
          admin.email,
          existing.revision,
          nextRevision,
          JSON.stringify({
            courseId: existing.course_id,
            slug: parsed.value.slug,
          }),
          now,
          id,
          nextRevision,
          parsed.value.slug,
          parsed.value.title,
          contentJson,
          now,
          admin.email,
        ),
      database
        .prepare(
          `INSERT OR IGNORE INTO cms_slug_tombstones (
            course_id, kind, slug, stable_key, content_id, retired_at, retired_by_email
          )
          SELECT course_id, kind, ?, stable_key, id, ?, ?
          FROM cms_content
          WHERE id = ? AND revision = ? AND status = 'draft'
            AND slug = ? AND title = ? AND content = ?
            AND updated_at = ? AND updated_by_email = ?
            AND changes() = 1
            AND ? <> ?`,
        )
        .bind(
          existing.slug,
          now,
          admin.email,
          id,
          nextRevision,
          parsed.value.slug,
          parsed.value.title,
          contentJson,
          now,
          admin.email,
          existing.slug,
          parsed.value.slug,
        ),
      database
        .prepare(
          `INSERT OR IGNORE INTO cms_vocabulary_aliases (
            course_id, alias, content_id, stable_key, created_at
          )
          SELECT course_id, slug, id, stable_key, ?
          FROM cms_content
          WHERE id = ? AND revision = ? AND kind = 'vocabulary'`,
        )
        .bind(now, id, nextRevision),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) {
      const retired = await database
        .prepare(
          `SELECT content_id FROM cms_slug_tombstones
           WHERE course_id = ? AND kind = ? AND slug = ? AND content_id <> ?`,
        )
        .bind(
          existing.course_id,
          existing.kind,
          parsed.value.slug,
          id,
        )
        .first<{ content_id: string }>();
      if (retired) {
        return apiError(
          409,
          "This slug belongs to retired content and cannot be reused.",
          "SLUG_RETIRED",
        );
      }
      return revisionConflict();
    }

    const entry = contentRecordFromRow({
      ...existing,
      slug: parsed.value.slug,
      title: parsed.value.title,
      content: contentJson,
      revision: nextRevision,
      updated_at: now,
      updated_by_email: admin.email,
      review_status: "draft",
      reviewed_by_email: null,
      reviewed_at: null,
      approved_revision: null,
    });
    return apiJson({ entry });
  } catch (error) {
    if (isUniqueConstraint(error)) {
      return apiError(409, "A content item with this kind and slug already exists.");
    }
    logApiError("admin_content_update_failed", error);
    return apiError(503, "Content could not be updated.");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;
  const id = await contentId(context);
  if (!id) return apiError(400, "Invalid content ID.");

  const body = await readJsonBody(request, 2 * 1024);
  if (!body.ok) return body.response;
  const parsed = validateRevisionBody(body.value);
  if (!parsed.ok) return apiError(400, parsed.error);

  try {
    const database = await getCmsDatabase();
    const existing = await findContent(database, id);
    if (!existing) return apiError(404, "Content item not found.");
    if (parsed.value.revision !== existing.revision) return revisionConflict();
    if (existing.status === "published") {
      return apiError(409, "Unpublish this item before deleting it.", "STATUS_CONFLICT");
    }
    const now = Date.now();
    const results = await database.batch([
      database
        .prepare(
          `INSERT OR IGNORE INTO cms_slug_tombstones (
            course_id, kind, slug, stable_key, content_id, retired_at, retired_by_email
          )
          SELECT course_id, kind, slug, stable_key, id, ?, ?
          FROM cms_content
          WHERE id = ? AND revision = ? AND status = 'draft'`,
        )
        .bind(now, admin.email, id, existing.revision),
      database
        .prepare(
          `INSERT INTO admin_audit_log (
            entity_type, entity_id, actor_email, action, from_revision,
            to_revision, details, created_at
          )
          SELECT 'content', id, ?, 'DELETE', revision, NULL, ?, ?
          FROM cms_content WHERE id = ? AND revision = ?`,
        )
        .bind(
          admin.email,
          JSON.stringify({
            kind: existing.kind,
            courseId: existing.course_id,
            slug: existing.slug,
            status: existing.status,
          }),
          now,
          id,
          existing.revision,
        ),
      database
        .prepare("DELETE FROM cms_content WHERE id = ? AND revision = ?")
        .bind(id, existing.revision),
    ]);
    if ((results[2].meta.changes ?? 0) !== 1) return revisionConflict();
    return apiJson({ deleted: true, id });
  } catch (error) {
    logApiError("admin_content_delete_failed", error);
    return apiError(503, "Content could not be deleted.");
  }
}

async function contentId(context: RouteContext): Promise<string | null> {
  const { id } = await context.params;
  return isOpaqueId(id) ? id : null;
}

function findContent(database: D1Database, id: string): Promise<ContentRow | null> {
  return database
    .prepare(`SELECT ${CONTENT_COLUMNS} FROM cms_content WHERE id = ?`)
    .bind(id)
    .first<ContentRow>();
}

function revisionConflict() {
  return apiError(
    409,
    "This item changed after it was opened. Refresh and try again.",
    "REVISION_CONFLICT",
  );
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    /unique|cms_content_kind_slug_unique/i.test(error.message)
  );
}
