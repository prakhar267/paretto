import { requireAdmin } from "@/app/server-auth";
import {
  apiError,
  apiJson,
  isOpaqueId,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import {
  getCmsDatabase,
  supportRecordFromRow,
  type SupportRow,
} from "@/app/api/_lib/cms-database";
import { validateSupportStatusUpdate } from "@/app/api/_lib/content-validation";
import {
  enqueueSupportStatusNotification,
  scheduleSupportNotificationDelivery,
} from "@/app/support-notification-outbox";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;
  const { id } = await context.params;
  if (!isOpaqueId(id)) return apiError(400, "Invalid support request ID.");

  const body = await readJsonBody(request, 2 * 1024);
  if (!body.ok) return body.response;
  const parsed = validateSupportStatusUpdate(body.value);
  if (!parsed.ok) return apiError(400, parsed.error);

  try {
    const database = await getCmsDatabase();
    const existing = await database
      .prepare(
        `SELECT id, reply_email, category, subject, body, status, revision,
                created_at, updated_at
         FROM support_requests WHERE id = ?`,
      )
      .bind(id)
      .first<SupportRow>();
    if (!existing) return apiError(404, "Support request not found.");
    if (existing.revision !== parsed.value.revision) return revisionConflict();
    if (existing.status === parsed.value.status) {
      return apiError(409, `Support request is already ${existing.status}.`, "STATUS_CONFLICT");
    }

    const now = Date.now();
    const nextRevision = existing.revision + 1;
    const results = await database.batch([
      database
        .prepare(
          `UPDATE support_requests
           SET status = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .bind(parsed.value.status, now, id, existing.revision),
      database
        .prepare(
          `INSERT INTO admin_audit_log (
            entity_type, entity_id, actor_email, action, from_revision,
            to_revision, details, created_at
          )
          SELECT 'support_request', id, ?, 'SUPPORT_STATUS_CHANGED', ?, ?, ?, ?
          FROM support_requests
          WHERE id = ? AND revision = ? AND status = ?
            AND updated_at = ? AND changes() = 1`,
        )
        .bind(
          admin.email,
          existing.revision,
          nextRevision,
          JSON.stringify({
            fromStatus: existing.status,
            toStatus: parsed.value.status,
          }),
          now,
          id,
          nextRevision,
          parsed.value.status,
          now,
        ),
      enqueueSupportStatusNotification(database, {
        supportRequestId: id,
        revision: nextRevision,
        status: parsed.value.status,
        updatedAt: now,
      }),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) return revisionConflict();

    scheduleSupportNotificationDelivery(database);
    return apiJson({
      request: supportRecordFromRow({
        ...existing,
        status: parsed.value.status,
        revision: nextRevision,
        updated_at: now,
      }),
    });
  } catch (error) {
    logApiError("admin_support_update_failed", error);
    return apiError(503, "Support status could not be updated.");
  }
}

function revisionConflict() {
  return apiError(
    409,
    "This request changed after it was opened. Refresh and try again.",
    "REVISION_CONFLICT",
  );
}
