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
import { validateContentReviewBody } from "@/app/api/_lib/content-validation";
import { checkPublicationReadiness } from "@/app/api/_lib/publication-readiness";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;
  const { id } = await context.params;
  if (!isOpaqueId(id)) return apiError(400, "Invalid content ID.");

  const body = await readJsonBody(request, 4 * 1024);
  if (!body.ok) return body.response;
  const parsed = validateContentReviewBody(body.value);
  if (!parsed.ok) return apiError(400, parsed.error);

  try {
    const database = await getCmsDatabase();
    const existing = await database
      .prepare(`SELECT ${CONTENT_COLUMNS} FROM cms_content WHERE id = ?`)
      .bind(id)
      .first<ContentRow>();
    if (!existing) return apiError(404, "Content item not found.");
    if (existing.revision !== parsed.value.revision) return revisionConflict();
    if (existing.status !== "draft") {
      return apiError(
        409,
        "Published content cannot enter review. Unpublish it first.",
        "STATUS_CONFLICT",
      );
    }

    const transition = reviewTransition(existing, parsed.value.action, admin.email);
    if (!transition.ok) {
      return apiError(409, transition.message, transition.code);
    }

    if (parsed.value.action === "approve") {
      const readiness = await checkPublicationReadiness(database, existing);
      if (!readiness.ok) {
        return apiError(422, readiness.message, readiness.code);
      }
    }

    const now = Date.now();
    const reviewedBy =
      parsed.value.action === "submit" ? null : admin.email.toLowerCase();
    const reviewedAt = parsed.value.action === "submit" ? null : now;
    const approvedRevision =
      parsed.value.action === "approve" ? existing.revision : null;
    const auditAction =
      parsed.value.action === "submit"
        ? "REVIEW_SUBMITTED"
        : parsed.value.action === "approve"
          ? "REVIEW_APPROVED"
          : "CHANGES_REQUESTED";

    const results = await database.batch([
      database
        .prepare(
          `UPDATE cms_content
           SET review_status = ?, reviewed_by_email = ?, reviewed_at = ?,
               approved_revision = ?
           WHERE id = ? AND revision = ? AND status = 'draft'
             AND review_status = ?`,
        )
        .bind(
          transition.nextStatus,
          reviewedBy,
          reviewedAt,
          approvedRevision,
          id,
          existing.revision,
          existing.review_status,
        ),
      database
        .prepare(
          `INSERT INTO admin_audit_log (
            entity_type, entity_id, actor_email, action, from_revision,
            to_revision, details, created_at
          )
          SELECT 'content', id, ?, ?, revision, revision, ?, ?
          FROM cms_content
          WHERE id = ? AND revision = ? AND review_status = ?
            AND changes() = 1`,
        )
        .bind(
          admin.email,
          auditAction,
          JSON.stringify({
            fromReviewStatus: existing.review_status,
            toReviewStatus: transition.nextStatus,
            note: parsed.value.note,
          }),
          now,
          id,
          existing.revision,
          transition.nextStatus,
        ),
    ]);

    if ((results[0].meta.changes ?? 0) !== 1) return revisionConflict();
    const entry = contentRecordFromRow({
      ...existing,
      review_status: transition.nextStatus,
      reviewed_by_email: reviewedBy,
      reviewed_at: reviewedAt,
      approved_revision: approvedRevision,
    });
    if (!entry) return apiError(500, "Stored content is invalid.");
    return apiJson({ entry });
  } catch (error) {
    logApiError("admin_content_review_failed", error);
    return apiError(503, "Review state could not be changed.");
  }
}

function reviewTransition(
  row: ContentRow,
  action: "submit" | "approve" | "request_changes",
  actorEmail: string,
):
  | { ok: true; nextStatus: "pending" | "approved" | "changes_requested" }
  | { ok: false; code: string; message: string } {
  if (action === "submit") {
    if (row.review_status !== "draft" && row.review_status !== "changes_requested") {
      return {
        ok: false,
        code: "REVIEW_CONFLICT",
        message: "Only a draft or requested-change revision can be submitted.",
      };
    }
    return { ok: true, nextStatus: "pending" };
  }

  if (row.review_status !== "pending") {
    return {
      ok: false,
      code: "REVIEW_CONFLICT",
      message: "Submit this revision for review before reviewing it.",
    };
  }
  if (row.updated_by_email.toLowerCase() === actorEmail.toLowerCase()) {
    return {
      ok: false,
      code: "SEPARATION_OF_DUTIES_REQUIRED",
      message: "The current revision must be reviewed by a different administrator.",
    };
  }
  return {
    ok: true,
    nextStatus: action === "approve" ? "approved" : "changes_requested",
  };
}

function revisionConflict() {
  return apiError(
    409,
    "This item changed after it was opened. Refresh and try again.",
    "REVISION_CONFLICT",
  );
}
