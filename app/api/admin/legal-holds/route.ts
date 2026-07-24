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

export const LEGAL_HOLD_DATA_CLASSES = [
  "product_events",
  "support_requests",
  "admin_audit_log",
] as const;

export type LegalHoldDataClass = (typeof LEGAL_HOLD_DATA_CLASSES)[number];

type LegalHoldRow = {
  id: string;
  data_class: LegalHoldDataClass;
  record_key: string | null;
  reason: string;
  status: "active" | "released";
  created_by_email: string;
  created_at: number;
  released_by_email: string | null;
  released_at: number | null;
};

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return apiError(400, "Limit must be an integer from 1 to 100.");
  }
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === null ? null : parseLegalHoldCursor(rawCursor);
  if (rawCursor !== null && !cursor) {
    return apiError(400, "Invalid legal-hold cursor.");
  }

  const values: unknown[] = [];
  let where = "";
  if (cursor) {
    where = `WHERE (
      CASE status WHEN 'active' THEN 0 ELSE 1 END > ?
      OR (
        CASE status WHEN 'active' THEN 0 ELSE 1 END = ?
        AND (created_at < ? OR (created_at = ? AND id < ?))
      )
    )`;
    values.push(
      cursor.statusRank,
      cursor.statusRank,
      cursor.createdAt,
      cursor.createdAt,
      cursor.id,
    );
  }

  try {
    const result = await (await getDatabase())
      .prepare(
        `SELECT id, data_class, record_key, reason, status, created_by_email,
                created_at, released_by_email, released_at
         FROM retention_legal_holds
         ${where}
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                  created_at DESC,
                  id DESC
         LIMIT ?`,
      )
      .bind(...values, limit + 1)
      .all<LegalHoldRow>();
    const page = result.results.slice(0, limit);
    const last = page.at(-1);
    return apiJson({
      holds: page.map(legalHoldFromRow),
      nextCursor:
        result.results.length > limit && last
          ? `${legalHoldStatusRank(last.status)}:${last.created_at}:${last.id}`
          : null,
    });
  } catch (error) {
    logApiError("admin_legal_holds_list_failed", error);
    return apiError(503, "Legal holds are temporarily unavailable.");
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;
  const body = await readJsonBody(request, 4 * 1024);
  if (!body.ok) return body.response;
  if (
    !isRecord(body.value) ||
    Object.keys(body.value).some(
      (key) => !["dataClass", "recordKey", "reason"].includes(key),
    ) ||
    !LEGAL_HOLD_DATA_CLASSES.includes(
      body.value.dataClass as LegalHoldDataClass,
    ) ||
    (body.value.recordKey !== null &&
      body.value.recordKey !== undefined &&
      (typeof body.value.recordKey !== "string" ||
        !/^[A-Za-z0-9:_-]{1,128}$/.test(body.value.recordKey))) ||
    typeof body.value.reason !== "string"
  ) {
    return apiError(400, "A valid data class, optional record key, and reason are required.");
  }
  const reason = body.value.reason.trim().replace(/\s+/g, " ");
  if (reason.length < 10 || reason.length > 500) {
    return apiError(400, "The legal-hold reason must be 10 to 500 characters.");
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const dataClass = body.value.dataClass as LegalHoldDataClass;
  const recordKey =
    typeof body.value.recordKey === "string" ? body.value.recordKey : null;
  try {
    const database = await getDatabase();
    await database.batch([
      database
        .prepare(
          `INSERT INTO retention_legal_holds (
             id, data_class, record_key, reason, status, created_by_email,
             created_at, released_by_email, released_at
           ) VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, NULL)`,
        )
        .bind(id, dataClass, recordKey, reason, admin.email, now),
      database
        .prepare(
          `INSERT INTO admin_audit_log (
             entity_type, entity_id, actor_email, action, from_revision,
             to_revision, details, created_at
           ) VALUES ('legal_hold', ?, ?, 'LEGAL_HOLD_CREATED', NULL, NULL, ?, ?)`,
        )
        .bind(
          id,
          admin.email,
          JSON.stringify({ dataClass, recordKey, reason }),
          now,
        ),
    ]);
    return apiJson(
      {
        hold: legalHoldFromRow({
          id,
          data_class: dataClass,
          record_key: recordKey,
          reason,
          status: "active",
          created_by_email: admin.email,
          created_at: now,
          released_by_email: null,
          released_at: null,
        }),
      },
      201,
    );
  } catch (error) {
    logApiError("admin_legal_hold_create_failed", error);
    return apiError(503, "The legal hold could not be created.");
  }
}

function legalHoldFromRow(row: LegalHoldRow) {
  return {
    id: row.id,
    dataClass: row.data_class,
    recordKey: row.record_key,
    reason: row.reason,
    status: row.status,
    createdByEmail: row.created_by_email,
    createdAt: new Date(row.created_at).toISOString(),
    releasedByEmail: row.released_by_email,
    releasedAt:
      row.released_at === null ? null : new Date(row.released_at).toISOString(),
  };
}

function parseLegalHoldCursor(
  value: string,
): { statusRank: 0 | 1; createdAt: number; id: string } | null {
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const statusRank = Number(parts[0]);
  const createdAt = Number(parts[1]);
  const id = parts[2];
  if (
    (statusRank !== 0 && statusRank !== 1) ||
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0 ||
    !isOpaqueId(id)
  ) {
    return null;
  }
  return { statusRank, createdAt, id };
}

function legalHoldStatusRank(status: LegalHoldRow["status"]): 0 | 1 {
  return status === "active" ? 0 : 1;
}
