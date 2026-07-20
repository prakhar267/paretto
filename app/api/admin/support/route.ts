import { requireAdmin } from "@/app/server-auth";
import { apiError, apiJson, isOpaqueId, logApiError } from "@/app/api/_lib/api-utils";
import {
  getCmsDatabase,
  supportRecordFromRow,
  type SupportRow,
} from "@/app/api/_lib/cms-database";
import {
  parseSupportCategory,
  parseSupportStatus,
} from "@/app/api/_lib/content-validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const rawCategory = url.searchParams.get("category");
  const status = parseSupportStatus(rawStatus);
  const category = parseSupportCategory(rawCategory);
  if (rawStatus && !status) return apiError(400, "Invalid support status.");
  if (rawCategory && !category) return apiError(400, "Invalid support category.");
  const limit = Number(url.searchParams.get("limit") ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return apiError(400, "Limit must be an integer from 1 to 100.");
  }
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === null ? null : parseSupportCursor(rawCursor);
  if (rawCursor !== null && !cursor) return apiError(400, "Invalid support cursor.");

  const conditions: string[] = [];
  const values: unknown[] = [];
  if (status) {
    conditions.push("status = ?");
    values.push(status);
  }
  if (category) {
    conditions.push("category = ?");
    values.push(category);
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
        `SELECT id, reply_email, category, subject, body, status, revision,
                created_at, updated_at
         FROM support_requests ${where}
         ORDER BY updated_at DESC, id ASC LIMIT ?`,
      )
      .bind(...values, limit + 1)
      .all<SupportRow>();
    const page = result.results.slice(0, limit);
    const last = page.at(-1);
    return apiJson({
      requests: page.map(supportRecordFromRow),
      nextCursor:
        result.results.length > limit && last
          ? `${last.updated_at}:${last.id}`
          : null,
    });
  } catch (error) {
    logApiError("admin_support_list_failed", error);
    return apiError(503, "Support requests are temporarily unavailable.");
  }
}

function parseSupportCursor(
  value: string,
): { updatedAt: number; id: string } | null {
  const separator = value.indexOf(":");
  if (separator < 1) return null;
  const updatedAt = Number(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0 || !isOpaqueId(id)) return null;
  return { updatedAt, id };
}
