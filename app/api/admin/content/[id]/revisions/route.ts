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
  REVISION_COLUMNS,
  contentRecordFromRow,
  contentRevisionFromRow,
  getCmsDatabase,
  type ContentRevisionRow,
  type ContentRow,
} from "@/app/api/_lib/cms-database";
import { validateContentRestoreBody } from "@/app/api/_lib/content-validation";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;
  const { id } = await context.params;
  if (!isOpaqueId(id)) return apiError(400, "Invalid content ID.");

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return apiError(400, "Limit must be an integer from 1 to 100.");
  }
  const rawBeforeRevision = url.searchParams.get("beforeRevision");
  const beforeRevision = rawBeforeRevision === null ? null : Number(rawBeforeRevision);
  if (
    beforeRevision !== null &&
    (!Number.isInteger(beforeRevision) || beforeRevision < 1)
  ) {
    return apiError(400, "beforeRevision must be a positive integer.");
  }

  try {
    const database = await getCmsDatabase();
    const result = await database
      .prepare(
        `SELECT ${REVISION_COLUMNS}
         FROM cms_content_revisions
         WHERE content_id = ? ${beforeRevision === null ? "" : "AND revision < ?"}
         ORDER BY revision DESC
         LIMIT ?`,
      )
      .bind(
        id,
        ...(beforeRevision === null ? [] : [beforeRevision]),
        limit + 1,
      )
      .all<ContentRevisionRow>();
    const page = result.results.slice(0, limit);
    const revisions = page.map(contentRevisionFromRow);
    if (revisions.some((entry) => entry === null)) {
      return apiError(500, "Stored revision history is invalid.");
    }
    return apiJson({
      revisions,
      nextBeforeRevision:
        result.results.length > limit ? page.at(-1)?.revision ?? null : null,
    });
  } catch (error) {
    logApiError("admin_content_revisions_list_failed", error);
    return apiError(503, "Revision history is temporarily unavailable.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;
  const { id } = await context.params;
  if (!isOpaqueId(id)) return apiError(400, "Invalid content ID.");

  const body = await readJsonBody(request, 2 * 1024);
  if (!body.ok) return body.response;
  const parsed = validateContentRestoreBody(body.value);
  if (!parsed.ok) return apiError(400, parsed.error);

  try {
    const database = await getCmsDatabase();
    const existing = await database
      .prepare(`SELECT ${CONTENT_COLUMNS} FROM cms_content WHERE id = ?`)
      .bind(id)
      .first<ContentRow>();
    if (!existing) return apiError(404, "Content item not found.");
    if (existing.revision !== parsed.value.revision) return revisionConflict();
    if (existing.status === "published") {
      return apiError(
        409,
        "Unpublish this item before restoring a prior revision.",
        "STATUS_CONFLICT",
      );
    }

    const sourceRow = await database
      .prepare(
        `SELECT ${REVISION_COLUMNS}
         FROM cms_content_revisions
         WHERE content_id = ? AND revision = ?`,
      )
      .bind(id, parsed.value.sourceRevision)
      .first<ContentRevisionRow>();
    if (!sourceRow) return apiError(404, "Source revision not found.");
    const source = contentRevisionFromRow(sourceRow);
    if (!source || source.kind !== existing.kind) {
      return apiError(422, "The selected revision cannot be restored.");
    }

    const now = Date.now();
    const nextRevision = existing.revision + 1;
    const results = await database.batch([
      database
        .prepare(
          `UPDATE cms_content
           SET slug = ?, title = ?, content = ?, status = 'draft',
               published_at = NULL, revision = revision + 1,
               updated_at = ?, updated_by_email = ?, review_status = 'draft',
               reviewed_by_email = NULL, reviewed_at = NULL,
               approved_revision = NULL
           WHERE id = ? AND revision = ? AND status = 'draft'
             AND NOT EXISTS (
               SELECT 1 FROM cms_slug_tombstones AS retired_slug
               WHERE retired_slug.kind = cms_content.kind
                 AND retired_slug.slug = ?
                 AND retired_slug.content_id <> cms_content.id
             )`,
        )
        .bind(
          source.slug,
          source.title,
          sourceRow.content,
          now,
          admin.email,
          id,
          existing.revision,
          source.slug,
        ),
      database
        .prepare(
          `INSERT INTO cms_content_revisions (
            content_id, revision, kind, slug, stable_key, title, content, status,
            published_at, actor_email, action, created_at
          )
          SELECT id, revision, kind, slug, stable_key, title, content, status,
                 published_at, ?, 'RESTORE', ?
          FROM cms_content
          WHERE id = ? AND revision = ? AND status = 'draft'
            AND slug = ? AND title = ? AND content = ?
            AND published_at IS NULL
            AND updated_at = ? AND updated_by_email = ?
            AND changes() = 1`,
        )
        .bind(
          admin.email,
          now,
          id,
          nextRevision,
          source.slug,
          source.title,
          sourceRow.content,
          now,
          admin.email,
        ),
      database
        .prepare(
          `INSERT INTO admin_audit_log (
            entity_type, entity_id, actor_email, action, from_revision,
            to_revision, details, created_at
          )
          SELECT 'content', id, ?, 'RESTORE', ?, ?, ?, ?
          FROM cms_content
          WHERE id = ? AND revision = ? AND status = 'draft'
            AND slug = ? AND title = ? AND content = ?
            AND published_at IS NULL
            AND updated_at = ? AND updated_by_email = ?
            AND changes() = 1`,
        )
        .bind(
          admin.email,
          existing.revision,
          nextRevision,
          JSON.stringify({ sourceRevision: parsed.value.sourceRevision }),
          now,
          id,
          nextRevision,
          source.slug,
          source.title,
          sourceRow.content,
          now,
          admin.email,
        ),
      database
        .prepare(
          `INSERT OR IGNORE INTO cms_slug_tombstones (
            kind, slug, stable_key, content_id, retired_at, retired_by_email
          )
          SELECT kind, ?, stable_key, id, ?, ?
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
          source.slug,
          source.title,
          sourceRow.content,
          now,
          admin.email,
          existing.slug,
          source.slug,
        ),
      database
        .prepare(
          `INSERT OR IGNORE INTO cms_vocabulary_aliases (
            alias, content_id, stable_key, created_at
          )
          SELECT slug, id, stable_key, ?
          FROM cms_content
          WHERE id = ? AND revision = ? AND kind = 'vocabulary'`,
        )
        .bind(now, id, nextRevision),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) {
      const retired = await database
        .prepare(
          `SELECT content_id FROM cms_slug_tombstones
           WHERE kind = ? AND slug = ? AND content_id <> ?`,
        )
        .bind(existing.kind, source.slug, id)
        .first<{ content_id: string }>();
      if (retired) {
        return apiError(
          409,
          "The historical slug is reserved by other retired content.",
          "SLUG_RETIRED",
        );
      }
      return revisionConflict();
    }

    const entry = contentRecordFromRow({
      ...existing,
      slug: source.slug,
      title: source.title,
      content: sourceRow.content,
      status: "draft",
      revision: nextRevision,
      published_at: null,
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
      return apiError(409, "The historical slug is already in use.");
    }
    logApiError("admin_content_revision_restore_failed", error);
    return apiError(503, "The selected revision could not be restored.");
  }
}

function revisionConflict() {
  return apiError(
    409,
    "This item changed after it was opened. Refresh and try again.",
    "REVISION_CONFLICT",
  );
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}
