import { apiError, apiJson, isRecord, logApiError, readJsonBody } from "@/app/api/_lib/api-utils";
import {
  MAX_RETENTION_BATCH_LIMIT,
  RETENTION_BATCH_LIMIT,
  retentionCutoffs,
  runRetentionMaintenance,
} from "@/app/retention-policy";
import {
  getRuntimeConfigurationReadiness,
  requireAdmin,
} from "@/app/server-auth";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

type OperationsRow = {
  published_content: number;
  draft_content: number;
  open_support: number;
  expired_events: number;
  expired_support: number;
  expired_audits: number;
  active_holds: number;
};

export async function GET(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;

  try {
    const now = Date.now();
    const cutoffs = retentionCutoffs(now);
    const database = await getDatabase();
    const row = await database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM cms_content WHERE status = 'published') AS published_content,
          (SELECT COUNT(*) FROM cms_content WHERE status = 'draft') AS draft_content,
          (SELECT COUNT(*) FROM support_requests WHERE status IN ('open', 'in_progress')) AS open_support,
          (SELECT COUNT(*) FROM product_events AS events
            WHERE events.received_at < ? AND NOT EXISTS (
              SELECT 1 FROM retention_legal_holds AS holds
              WHERE holds.status = 'active' AND holds.data_class = 'product_events'
                AND (holds.record_key IS NULL OR holds.record_key = events.id OR holds.record_key = events.user_key)
            )) AS expired_events,
          (SELECT COUNT(*) FROM support_requests AS support
            WHERE support.status IN ('resolved', 'closed') AND support.updated_at < ? AND NOT EXISTS (
              SELECT 1 FROM retention_legal_holds AS holds
              WHERE holds.status = 'active' AND holds.data_class = 'support_requests'
                AND (holds.record_key IS NULL OR holds.record_key = support.id OR holds.record_key = support.user_key)
            )) AS expired_support,
          (SELECT COUNT(*) FROM admin_audit_log AS audit
            WHERE audit.created_at < ? AND NOT EXISTS (
              SELECT 1 FROM retention_legal_holds AS holds
              WHERE holds.status = 'active' AND holds.data_class = 'admin_audit_log'
                AND (holds.record_key IS NULL OR holds.record_key = CAST(audit.id AS TEXT) OR holds.record_key = audit.entity_id)
            )) AS expired_audits,
          (SELECT COUNT(*) FROM retention_legal_holds WHERE status = 'active') AS active_holds`,
      )
      .bind(
        cutoffs.productEvents,
        cutoffs.operationalRecords,
        cutoffs.operationalRecords,
      )
      .first<OperationsRow>();
    const configuration = await getRuntimeConfigurationReadiness();
    return apiJson({
      checkedAt: new Date(now).toISOString(),
      service: { status: "ready", healthPath: "/api/health" },
      configuration: {
        database: true,
        ...configuration,
      },
      content: {
        published: Number(row?.published_content ?? 0),
        drafts: Number(row?.draft_content ?? 0),
      },
      support: { open: Number(row?.open_support ?? 0) },
      retentionDue: {
        productEvents: Number(row?.expired_events ?? 0),
        supportRequests: Number(row?.expired_support ?? 0),
        auditEvents: Number(row?.expired_audits ?? 0),
      },
      activeLegalHolds: Number(row?.active_holds ?? 0),
      retentionBatchLimit: RETENTION_BATCH_LIMIT,
    });
  } catch (error) {
    logApiError("admin_operations_failed", error);
    return apiError(503, "Operations status is temporarily unavailable.");
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);
  if (!admin.ok) return admin.response;
  const body = await readJsonBody(request, 2 * 1024);
  if (!body.ok || !isRecord(body.value)) {
    return body.ok
      ? apiError(400, "Explicit retention confirmation is required.")
      : body.response;
  }
  const keys = Object.keys(body.value);
  const batchLimit = body.value.batchLimit ?? RETENTION_BATCH_LIMIT;
  if (
    keys.some((key) => key !== "confirm" && key !== "batchLimit") ||
    body.value.confirm !== "delete-expired-records" ||
    !Number.isInteger(batchLimit) ||
    Number(batchLimit) < 1 ||
    Number(batchLimit) > MAX_RETENTION_BATCH_LIMIT
  ) {
    return apiError(400, "A confirmation and batch limit from 1 to 1000 are required.");
  }

  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  let database: D1Database | null = null;
  let started = false;
  let deleted: Awaited<ReturnType<typeof runRetentionMaintenance>> | null = null;
  try {
    database = await getDatabase();
    await database
      .prepare(
        `INSERT INTO admin_audit_log (
           entity_type, entity_id, actor_email, action, from_revision,
           to_revision, details, created_at
         ) VALUES ('operation', ?, ?, 'RETENTION_RUN_STARTED', NULL, NULL, ?, ?)`,
      )
      .bind(
        runId,
        admin.email,
        JSON.stringify({ batchLimit: Number(batchLimit) }),
        startedAt,
      )
      .run();
    started = true;
    deleted = await runRetentionMaintenance(
      database,
      startedAt,
      Number(batchLimit),
    );
    const completedAt = Date.now();
    await database
      .prepare(
        `INSERT INTO admin_audit_log (
           entity_type, entity_id, actor_email, action, from_revision,
           to_revision, details, created_at
         ) VALUES ('operation', ?, ?, 'RETENTION_RUN_COMPLETED', NULL, NULL, ?, ?)`,
      )
      .bind(
        runId,
        admin.email,
        JSON.stringify({ batchLimit: Number(batchLimit), deleted }),
        completedAt,
      )
      .run();
    return apiJson({
      runId,
      completedAt: new Date(completedAt).toISOString(),
      deleted,
    });
  } catch (error) {
    if (database && started) {
      try {
        await database
          .prepare(
            `INSERT INTO admin_audit_log (
               entity_type, entity_id, actor_email, action, from_revision,
               to_revision, details, created_at
             ) VALUES ('operation', ?, ?, 'RETENTION_RUN_FAILED', NULL, NULL, ?, ?)`,
          )
          .bind(
            runId,
            admin.email,
            JSON.stringify({
              batchLimit: Number(batchLimit),
              deletionCompleted: deleted !== null,
              ...(deleted ? { deleted } : {}),
            }),
            Date.now(),
          )
          .run();
      } catch (auditError) {
        logApiError("admin_retention_failure_audit_failed", auditError);
      }
    }
    logApiError("admin_retention_failed", error);
    return apiError(503, "Retention maintenance could not be completed.");
  }
}
