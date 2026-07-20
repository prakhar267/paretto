import {
  apiError,
  apiJson,
  isOpaqueId,
  isRecord,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import { requireAdmin } from "@/app/server-auth";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;
  const { id } = await context.params;
  if (!isOpaqueId(id)) return apiError(400, "Invalid legal-hold ID.");
  const body = await readJsonBody(request, 2 * 1024);
  if (!body.ok) return body.response;
  if (
    !isRecord(body.value) ||
    Object.keys(body.value).some(
      (key) => key !== "confirm" && key !== "releaseReason",
    ) ||
    body.value.confirm !== "release-legal-hold" ||
    typeof body.value.releaseReason !== "string"
  ) {
    return apiError(400, "Explicit release confirmation and a reason are required.");
  }
  const releaseReason = body.value.releaseReason.trim().replace(/\s+/g, " ");
  if (releaseReason.length < 10 || releaseReason.length > 500) {
    return apiError(400, "The release reason must be 10 to 500 characters.");
  }
  try {
    const database = await getDatabase();
    const now = Date.now();
    const [released, audited] = await database.batch([
      database
        .prepare(
          `UPDATE retention_legal_holds
           SET status = 'released', released_by_email = ?, released_at = ?
           WHERE id = ? AND status = 'active'`,
        )
        .bind(admin.email, now, id),
      database
        .prepare(
          `INSERT INTO admin_audit_log (
             entity_type, entity_id, actor_email, action, from_revision,
             to_revision, details, created_at
           )
           SELECT 'legal_hold', ?, ?, 'LEGAL_HOLD_RELEASED', NULL, NULL, ?, ?
           WHERE changes() = 1 AND EXISTS (
             SELECT 1 FROM retention_legal_holds
             WHERE id = ? AND status = 'released'
               AND released_by_email = ? AND released_at = ?
           )`,
        )
        .bind(
          id,
          admin.email,
          JSON.stringify({ releaseReason }),
          now,
          id,
          admin.email,
          now,
        ),
    ]);
    if (Number(released.meta.changes ?? 0) !== 1) {
      return apiError(404, "Active legal hold not found.");
    }
    if (Number(audited.meta.changes ?? 0) !== 1) {
      throw new Error("Legal-hold release was not audited");
    }
    return apiJson({ releasedAt: new Date(now).toISOString() });
  } catch (error) {
    logApiError("admin_legal_hold_release_failed", error);
    return apiError(503, "The legal hold could not be released.");
  }
}
