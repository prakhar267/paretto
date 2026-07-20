import { requireAdmin } from "@/app/server-auth";
import { apiError, apiJson, isOpaqueId, logApiError } from "@/app/api/_lib/api-utils";
import {
  auditRecordFromRow,
  getCmsDatabase,
  type AuditRow,
} from "@/app/api/_lib/cms-database";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  if (
    entityType !== null &&
    entityType !== "content" &&
    entityType !== "support_request" &&
    entityType !== "operation" &&
    entityType !== "legal_hold"
  ) {
    return apiError(400, "Invalid audit entity type.");
  }
  if (entityId !== null && !isOpaqueId(entityId)) {
    return apiError(400, "Invalid audit entity ID.");
  }
  const limit = Number(url.searchParams.get("limit") ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return apiError(400, "Limit must be an integer from 1 to 100.");
  }
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === null ? null : parseAuditCursor(rawCursor);
  if (rawCursor !== null && !cursor) {
    return apiError(400, "Invalid audit cursor.");
  }

  const conditions: string[] = [];
  const values: unknown[] = [];
  if (entityType) {
    conditions.push("entity_type = ?");
    values.push(entityType);
  }
  if (entityId) {
    conditions.push("entity_id = ?");
    values.push(entityId);
  }
  if (cursor) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    values.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const database = await getCmsDatabase();
    const result = await database
      .prepare(
        `SELECT id, entity_type, entity_id, actor_email, action,
                from_revision, to_revision, details, created_at
         FROM admin_audit_log ${where}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(...values, limit + 1)
      .all<AuditRow>();
    const page = result.results.slice(0, limit);
    const last = page.at(-1);
    return apiJson({
      events: page.map(auditRecordFromRow),
      nextCursor:
        result.results.length > limit && last
          ? `${last.created_at}:${last.id}`
          : null,
    });
  } catch (error) {
    logApiError("admin_audit_list_failed", error);
    return apiError(503, "Audit history is temporarily unavailable.");
  }
}

function parseAuditCursor(
  value: string,
): { createdAt: number; id: number } | null {
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  const createdAt = Number(value.slice(0, separator));
  const id = Number(value.slice(separator + 1));
  if (
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    !Number.isSafeInteger(id) ||
    id < 1
  ) {
    return null;
  }
  return { createdAt, id };
}
