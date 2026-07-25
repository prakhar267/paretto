import {
  LEARNER_DELETION_STAGE_TIMEOUT_MS,
  processPendingLearnerDataDeletions,
} from "@/app/learner-data-deletion";
import { BETTER_AUTH_RATE_LIMIT_RETENTION_MS } from "@/app/learner-auth-rate-limit";
import {
  processSupportNotificationOutbox,
  SUPPORT_NOTIFICATION_COMPLETED_RETENTION_MS,
} from "@/app/support-notification-outbox";

export const PRODUCT_EVENT_RETENTION_DAYS = 400;
export const OPERATIONAL_RECORD_RETENTION_DAYS = 730;
export const RETENTION_BATCH_LIMIT = 500;
export const MAX_RETENTION_BATCH_LIMIT = 1_000;
export const ADMIN_LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const AUTH_TRANSIENT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const SUPPORT_RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const LEARNER_DELETION_TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const SCHEDULED_RETENTION_JOB_NAME = "scheduled_retention";
export const SCHEDULED_RETENTION_MAX_PAGES = 10;
export const RETENTION_SCHEDULE_MISSED_AFTER_MS = 36 * 60 * 60 * 1000;
export const RETENTION_RUN_STALE_AFTER_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RETENTION_ERROR_LENGTH = 500;

export type RetentionMaintenanceResult = {
  productEvents: number;
  supportRequests: number;
  auditEvents: number;
  nativeSessions: number;
  nativeIdentityTokens: number;
  adminLoginAttempts: number;
  learnerSessions: number;
  learnerVerifications: number;
  learnerAuthRateLimits: number;
  supportRateLimits: number;
  learnerDeletionJobsCompleted: number;
  learnerDeletionJobsHeld: number;
  learnerDeletionJobsWaiting: number;
  learnerDeletionStagesCancelled: number;
  learnerDeletionTombstones: number;
  supportNotificationJobsExamined: number;
  supportNotificationJobsCompleted: number;
  supportNotificationJobsFailed: number;
  supportNotificationJobsDeleted: number;
};

export function retentionCutoffs(now = Date.now()) {
  return {
    productEvents: now - PRODUCT_EVENT_RETENTION_DAYS * DAY_MS,
    operationalRecords: now - OPERATIONAL_RECORD_RETENTION_DAYS * DAY_MS,
    adminLoginAttempts: now - ADMIN_LOGIN_ATTEMPT_RETENTION_MS,
    authTransients: now - AUTH_TRANSIENT_RETENTION_MS,
    learnerAuthRateLimits:
      now - BETTER_AUTH_RATE_LIMIT_RETENTION_MS,
    supportRateLimits: now - SUPPORT_RATE_LIMIT_RETENTION_MS,
  };
}

/**
 * Deletes one bounded page from every expired retention class as a D1 batch.
 * Active class-wide or record/user/entity legal holds are excluded. Repeated
 * scheduled runs drain a backlog without creating an unbounded transaction.
 */
export async function runRetentionMaintenance(
  database: D1Database,
  now = Date.now(),
  batchLimit = RETENTION_BATCH_LIMIT,
  operationalQueues: {
    learnerDeletions?: boolean;
    supportNotifications?: boolean;
  } = {},
): Promise<RetentionMaintenanceResult> {
  if (
    !Number.isInteger(batchLimit) ||
    batchLimit < 1 ||
    batchLimit > MAX_RETENTION_BATCH_LIMIT
  ) {
    throw new Error("Retention batch limit is outside the supported range.");
  }
  const cutoffs = retentionCutoffs(now);
  const learnerDeletions =
    operationalQueues.learnerDeletions !== false
    ? await processPendingLearnerDataDeletions(database, now)
    : {
        completed: 0,
        held: 0,
        waitingForUserDeletion: 0,
        cancelled: 0,
      };
  const [
    events,
    support,
    audit,
    sessions,
    identityTokens,
    adminAttempts,
    learnerSessions,
    learnerVerifications,
    learnerAuthRateLimits,
    supportRateLimits,
    learnerDeletionTombstones,
    supportNotificationJobsDeleted,
  ] = await database.batch([
    database
      .prepare(
        `DELETE FROM product_events WHERE id IN (
           SELECT events.id FROM product_events AS events
           WHERE events.received_at < ?
             AND NOT EXISTS (
               SELECT 1 FROM retention_legal_holds AS holds
               WHERE holds.status = 'active'
                 AND holds.data_class = 'product_events'
                 AND (
                   holds.record_key IS NULL OR
                   holds.record_key = events.id OR
                   holds.record_key = events.user_key
                 )
             )
           ORDER BY events.received_at ASC, events.id ASC
           LIMIT ?
         )`,
      )
      .bind(cutoffs.productEvents, batchLimit),
    database
      .prepare(
        `DELETE FROM support_requests WHERE id IN (
           SELECT support.id FROM support_requests AS support
           WHERE support.status IN ('resolved', 'closed')
             AND support.updated_at < ?
             AND NOT EXISTS (
               SELECT 1 FROM retention_legal_holds AS holds
               WHERE holds.status = 'active'
                 AND holds.data_class = 'support_requests'
                 AND (
                   holds.record_key IS NULL OR
                   holds.record_key = support.id OR
                   holds.record_key = support.user_key
                 )
             )
           ORDER BY support.updated_at ASC, support.id ASC
           LIMIT ?
         )`,
      )
      .bind(cutoffs.operationalRecords, batchLimit),
    database
      .prepare(
        `DELETE FROM admin_audit_log WHERE id IN (
           SELECT audit.id FROM admin_audit_log AS audit
           WHERE audit.created_at < ?
             AND NOT EXISTS (
               SELECT 1 FROM retention_legal_holds AS holds
               WHERE holds.status = 'active'
                 AND holds.data_class = 'admin_audit_log'
                 AND (
                   holds.record_key IS NULL OR
                   holds.record_key = CAST(audit.id AS TEXT) OR
                   holds.record_key = audit.entity_id
                 )
             )
           ORDER BY audit.created_at ASC, audit.id ASC
           LIMIT ?
         )`,
      )
      .bind(cutoffs.operationalRecords, batchLimit),
    database
      .prepare(
        `DELETE FROM native_sessions WHERE token_hash IN (
           SELECT token_hash FROM native_sessions
           WHERE expires_at < ? OR revoked_at IS NOT NULL
           ORDER BY expires_at ASC
           LIMIT ?
         )`,
      )
      .bind(now, batchLimit),
    database
      .prepare(
        `DELETE FROM native_identity_token_uses WHERE token_hash IN (
           SELECT token_hash FROM native_identity_token_uses
           WHERE expires_at < ?
           ORDER BY expires_at ASC
           LIMIT ?
         )`,
      )
      .bind(now, batchLimit),
    database
      .prepare(
        `DELETE FROM admin_login_attempts WHERE ip_hash IN (
           SELECT ip_hash FROM admin_login_attempts
           WHERE updated_at < ?
           ORDER BY updated_at ASC, ip_hash ASC
           LIMIT ?
         )`,
      )
      .bind(cutoffs.adminLoginAttempts, batchLimit),
    database
      .prepare(
        `DELETE FROM learner_session WHERE id IN (
           SELECT id FROM learner_session
           WHERE expires_at < ?
           ORDER BY expires_at ASC, id ASC
           LIMIT ?
         )`,
      )
      .bind(now, batchLimit),
    database
      .prepare(
        `DELETE FROM learner_verification WHERE id IN (
           SELECT id FROM learner_verification
           WHERE expires_at < ?
           ORDER BY expires_at ASC, id ASC
           LIMIT ?
         )`,
      )
      .bind(now, batchLimit),
    database
      .prepare(
        `DELETE FROM learner_auth_rate_limits WHERE bucket_hash IN (
           SELECT bucket_hash FROM learner_auth_rate_limits
           WHERE updated_at < ?
           ORDER BY updated_at ASC, bucket_hash ASC
           LIMIT ?
         )`,
      )
      .bind(cutoffs.learnerAuthRateLimits, batchLimit),
    database
      .prepare(
        `DELETE FROM support_rate_limits WHERE bucket_hash IN (
           SELECT bucket_hash FROM support_rate_limits
           WHERE updated_at < ?
           ORDER BY updated_at ASC, bucket_hash ASC
           LIMIT ?
         )`,
      )
      .bind(cutoffs.supportRateLimits, batchLimit),
    database
      .prepare(
        `DELETE FROM learner_deletion_jobs WHERE user_id IN (
           SELECT user_id FROM learner_deletion_jobs
           WHERE status = 'completed'
             AND completed_at IS NOT NULL
             AND completed_at < ?
           ORDER BY completed_at ASC, user_id ASC
           LIMIT ?
         )`,
      )
      .bind(now - LEARNER_DELETION_TOMBSTONE_RETENTION_MS, batchLimit),
    database
      .prepare(
        `DELETE FROM support_notification_jobs WHERE id IN (
           SELECT jobs.id
           FROM support_notification_jobs AS jobs
           LEFT JOIN support_requests AS support
             ON support.id = jobs.support_request_id
           WHERE support.id IS NULL OR (
             jobs.status = 'completed'
             AND jobs.completed_at IS NOT NULL
             AND jobs.completed_at < ?
           )
           ORDER BY COALESCE(jobs.completed_at, jobs.updated_at) ASC,
                    jobs.id ASC
           LIMIT ?
         )`,
      )
      .bind(
        now - SUPPORT_NOTIFICATION_COMPLETED_RETENTION_MS,
        batchLimit,
      ),
  ]);
  const supportNotifications =
    operationalQueues.supportNotifications !== false
    ? await processSupportNotificationOutbox(database, now)
    : { examined: 0, claimed: 0, completed: 0, failed: 0 };

  return {
    productEvents: Number(events.meta.changes ?? 0),
    supportRequests: Number(support.meta.changes ?? 0),
    auditEvents: Number(audit.meta.changes ?? 0),
    nativeSessions: Number(sessions.meta.changes ?? 0),
    nativeIdentityTokens: Number(identityTokens.meta.changes ?? 0),
    adminLoginAttempts: Number(adminAttempts.meta.changes ?? 0),
    learnerSessions: Number(learnerSessions.meta.changes ?? 0),
    learnerVerifications: Number(learnerVerifications.meta.changes ?? 0),
    learnerAuthRateLimits: Number(
      learnerAuthRateLimits.meta.changes ?? 0,
    ),
    supportRateLimits: Number(supportRateLimits.meta.changes ?? 0),
    learnerDeletionJobsCompleted: learnerDeletions.completed,
    learnerDeletionJobsHeld: learnerDeletions.held,
    learnerDeletionJobsWaiting: learnerDeletions.waitingForUserDeletion,
    learnerDeletionStagesCancelled: learnerDeletions.cancelled,
    learnerDeletionTombstones: Number(
      learnerDeletionTombstones.meta.changes ?? 0,
    ),
    supportNotificationJobsExamined: supportNotifications.examined,
    supportNotificationJobsCompleted: supportNotifications.completed,
    supportNotificationJobsFailed: supportNotifications.failed,
    supportNotificationJobsDeleted: Number(
      supportNotificationJobsDeleted.meta.changes ?? 0,
    ),
  };
}

type RetentionScheduleRow = {
  status: string;
  monitoring_started_at: number;
  run_id: string | null;
  scheduled_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  last_succeeded_at: number | null;
  last_failed_at: number | null;
  last_error: string | null;
  last_result: string | null;
  updated_at: number;
};

export type RetentionScheduleStatus = {
  jobName: typeof SCHEDULED_RETENTION_JOB_NAME;
  health:
    | "pending"
    | "running"
    | "ready"
    | "failed"
    | "missed"
    | "stalled"
    | "missing";
  healthy: boolean;
  missed: boolean;
  persistedStatus: "pending" | "running" | "succeeded" | "failed" | null;
  runId: string | null;
  monitoringStartedAt: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  nextExpectedAt: string | null;
  lastError: string | null;
  lastResult: RetentionMaintenanceResult | null;
  updatedAt: string | null;
};

export type ScheduledRetentionRunResult = {
  runId: string;
  scheduledAt: number;
  startedAt: number;
  completedAt: number;
  pagesProcessed: number;
  deleted: RetentionMaintenanceResult;
};

type ScheduledRetentionRunOptions = {
  runId?: string;
  batchLimit?: number;
  maxPages?: number;
  now?: () => number;
};

type ScheduledRetentionBacklog = {
  expiredRetentionRows: boolean;
  learnerDeletionJobs: boolean;
  supportNotificationJobs: boolean;
};

type ScheduledRetentionBacklogRow = {
  expired_retention_rows: number;
  learner_deletion_jobs: number;
  support_notification_jobs: number;
};

/**
 * Owns the persistent lifecycle for a scheduled cleanup. The run id prevents an
 * older overlapping execution from overwriting a newer heartbeat.
 */
export async function runScheduledRetentionMaintenance(
  database: D1Database,
  scheduledAt: number,
  options: ScheduledRetentionRunOptions = {},
): Promise<ScheduledRetentionRunResult> {
  if (!Number.isFinite(scheduledAt) || scheduledAt < 0) {
    throw new Error("Scheduled retention time is invalid.");
  }
  const clock = options.now ?? Date.now;
  const runId = options.runId ?? crypto.randomUUID();
  const batchLimit = options.batchLimit ?? RETENTION_BATCH_LIMIT;
  const maxPages =
    options.maxPages ?? SCHEDULED_RETENTION_MAX_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new Error(
      "Scheduled retention page limit is outside the supported range.",
    );
  }
  const startedAt = clock();
  assertTimestamp(startedAt, "Scheduled retention start time");
  await recordScheduledRetentionStart(
    database,
    runId,
    scheduledAt,
    startedAt,
  );

  let deleted = emptyRetentionMaintenanceResult();
  let pagesProcessed = 0;
  let processLearnerDeletions = true;
  let processSupportNotifications = true;
  try {
    while (true) {
      const page = await runRetentionMaintenance(
        database,
        startedAt,
        batchLimit,
        {
          learnerDeletions: processLearnerDeletions,
          supportNotifications: processSupportNotifications,
        },
      );
      deleted = addRetentionResults(deleted, page);
      pagesProcessed += 1;

      const backlog = await readScheduledRetentionBacklog(
        database,
        startedAt,
      );
      if (!scheduledBacklogRemaining(backlog)) break;
      if (pagesProcessed >= maxPages) {
        throw new Error(
          `Scheduled retention reached its bounded ${maxPages}-page work cap; ` +
            "expired or due work remains for another scheduled or manual run.",
        );
      }
      processLearnerDeletions = backlog.learnerDeletionJobs;
      processSupportNotifications = backlog.supportNotificationJobs;
    }

    const completedAt = clock();
    assertTimestamp(completedAt, "Scheduled retention completion time");
    await recordScheduledRetentionSuccess(
      database,
      runId,
      completedAt,
      deleted,
    );
    return {
      runId,
      scheduledAt,
      startedAt,
      completedAt,
      pagesProcessed,
      deleted,
    };
  } catch (error) {
    const failedAt = clock();
    try {
      assertTimestamp(failedAt, "Scheduled retention failure time");
      await recordScheduledRetentionFailure(
        database,
        runId,
        failedAt,
        retentionErrorMessage(error),
        pagesProcessed > 0 ? deleted : null,
      );
    } catch (heartbeatError) {
      throw new AggregateError(
        [error, heartbeatError],
        "Scheduled retention and failure-heartbeat persistence both failed.",
      );
    }
    throw error;
  }
}

/**
 * Checks the same eligibility predicates as retention and the two durable
 * queues. A scheduled heartbeat cannot report success based only on a page
 * being smaller than its limit: exact page boundaries and mixed-class
 * backlogs are resolved from persisted state.
 */
export async function readScheduledRetentionBacklog(
  database: D1Database,
  now = Date.now(),
): Promise<ScheduledRetentionBacklog> {
  const cutoffs = retentionCutoffs(now);
  const row = await database
    .prepare(
      `SELECT
         CASE WHEN
           EXISTS (
             SELECT 1 FROM product_events AS events
             WHERE events.received_at < ?
               AND NOT EXISTS (
                 SELECT 1 FROM retention_legal_holds AS holds
                 WHERE holds.status = 'active'
                   AND holds.data_class = 'product_events'
                   AND (
                     holds.record_key IS NULL OR
                     holds.record_key = events.id OR
                     holds.record_key = events.user_key
                   )
               )
           ) OR EXISTS (
             SELECT 1 FROM support_requests AS support
             WHERE support.status IN ('resolved', 'closed')
               AND support.updated_at < ?
               AND NOT EXISTS (
                 SELECT 1 FROM retention_legal_holds AS holds
                 WHERE holds.status = 'active'
                   AND holds.data_class = 'support_requests'
                   AND (
                     holds.record_key IS NULL OR
                     holds.record_key = support.id OR
                     holds.record_key = support.user_key
                   )
               )
           ) OR EXISTS (
             SELECT 1 FROM admin_audit_log AS audit
             WHERE audit.created_at < ?
               AND NOT EXISTS (
                 SELECT 1 FROM retention_legal_holds AS holds
                 WHERE holds.status = 'active'
                   AND holds.data_class = 'admin_audit_log'
                   AND (
                     holds.record_key IS NULL OR
                     holds.record_key = CAST(audit.id AS TEXT) OR
                     holds.record_key = audit.entity_id
                   )
               )
           ) OR EXISTS (
             SELECT 1 FROM native_sessions
             WHERE expires_at < ? OR revoked_at IS NOT NULL
           ) OR EXISTS (
             SELECT 1 FROM native_identity_token_uses
             WHERE expires_at < ?
           ) OR EXISTS (
             SELECT 1 FROM admin_login_attempts WHERE updated_at < ?
           ) OR EXISTS (
             SELECT 1 FROM learner_session WHERE expires_at < ?
           ) OR EXISTS (
             SELECT 1 FROM learner_verification WHERE expires_at < ?
           ) OR EXISTS (
             SELECT 1 FROM learner_auth_rate_limits WHERE updated_at < ?
           ) OR EXISTS (
             SELECT 1 FROM support_rate_limits WHERE updated_at < ?
           ) OR EXISTS (
             SELECT 1 FROM learner_deletion_jobs
             WHERE status = 'completed'
               AND completed_at IS NOT NULL
               AND completed_at < ?
           ) OR EXISTS (
             SELECT 1
             FROM support_notification_jobs AS jobs
             LEFT JOIN support_requests AS support
               ON support.id = jobs.support_request_id
             WHERE support.id IS NULL OR (
               jobs.status = 'completed'
               AND jobs.completed_at IS NOT NULL
               AND jobs.completed_at < ?
             )
           )
         THEN 1 ELSE 0 END AS expired_retention_rows,
         CASE WHEN EXISTS (
           SELECT 1
           FROM learner_deletion_jobs AS jobs
           WHERE jobs.status = 'pending'
             AND (
               NOT EXISTS (
                 SELECT 1 FROM learner_user
                 WHERE learner_user.id = jobs.user_id
               )
               OR jobs.requested_at <= ?
             )
         ) THEN 1 ELSE 0 END AS learner_deletion_jobs,
         CASE WHEN EXISTS (
           SELECT 1
           FROM support_notification_jobs AS jobs
           INNER JOIN support_requests AS requests
             ON requests.id = jobs.support_request_id
           WHERE (
             (
               jobs.status IN ('pending', 'failed')
               AND jobs.available_at <= ?
             ) OR (
               jobs.status = 'processing'
               AND jobs.lease_expires_at IS NOT NULL
               AND jobs.lease_expires_at <= ?
             )
           )
             AND NOT EXISTS (
               SELECT 1 FROM learner_deletion_jobs AS deletion
               WHERE deletion.user_key = requests.user_key
             )
         ) THEN 1 ELSE 0 END AS support_notification_jobs`,
    )
    .bind(
      cutoffs.productEvents,
      cutoffs.operationalRecords,
      cutoffs.operationalRecords,
      now,
      now,
      cutoffs.adminLoginAttempts,
      now,
      now,
      cutoffs.learnerAuthRateLimits,
      cutoffs.supportRateLimits,
      now - LEARNER_DELETION_TOMBSTONE_RETENTION_MS,
      now - SUPPORT_NOTIFICATION_COMPLETED_RETENTION_MS,
      now - LEARNER_DELETION_STAGE_TIMEOUT_MS,
      now,
      now,
    )
    .first<ScheduledRetentionBacklogRow>();
  if (!row) {
    throw new Error("Scheduled retention backlog could not be read.");
  }
  return {
    expiredRetentionRows:
      Number(row.expired_retention_rows) === 1,
    learnerDeletionJobs:
      Number(row.learner_deletion_jobs) === 1,
    supportNotificationJobs:
      Number(row.support_notification_jobs) === 1,
  };
}

function scheduledBacklogRemaining(
  backlog: ScheduledRetentionBacklog,
): boolean {
  return (
    backlog.expiredRetentionRows ||
    backlog.learnerDeletionJobs ||
    backlog.supportNotificationJobs
  );
}

function emptyRetentionMaintenanceResult(): RetentionMaintenanceResult {
  return {
    productEvents: 0,
    supportRequests: 0,
    auditEvents: 0,
    nativeSessions: 0,
    nativeIdentityTokens: 0,
    adminLoginAttempts: 0,
    learnerSessions: 0,
    learnerVerifications: 0,
    learnerAuthRateLimits: 0,
    supportRateLimits: 0,
    learnerDeletionJobsCompleted: 0,
    learnerDeletionJobsHeld: 0,
    learnerDeletionJobsWaiting: 0,
    learnerDeletionStagesCancelled: 0,
    learnerDeletionTombstones: 0,
    supportNotificationJobsExamined: 0,
    supportNotificationJobsCompleted: 0,
    supportNotificationJobsFailed: 0,
    supportNotificationJobsDeleted: 0,
  };
}

function addRetentionResults(
  total: RetentionMaintenanceResult,
  page: RetentionMaintenanceResult,
): RetentionMaintenanceResult {
  const aggregate = { ...total };
  for (const key of Object.keys(
    aggregate,
  ) as Array<keyof RetentionMaintenanceResult>) {
    aggregate[key] += page[key];
  }
  return aggregate;
}

export async function readScheduledRetentionStatus(
  database: D1Database,
  now = Date.now(),
): Promise<RetentionScheduleStatus> {
  assertTimestamp(now, "Retention status check time");
  const row = await database
    .prepare(
      `SELECT status, monitoring_started_at, run_id, scheduled_at, started_at,
              completed_at, last_succeeded_at, last_failed_at, last_error,
              last_result, updated_at
       FROM retention_schedule_state
       WHERE job_name = ?`,
    )
    .bind(SCHEDULED_RETENTION_JOB_NAME)
    .first<RetentionScheduleRow>();

  if (!row) return missingScheduleStatus();

  const persistedStatus = scheduleState(row.status);
  const monitoringStartedAt = validTimestamp(row.monitoring_started_at);
  const scheduledAt = validTimestamp(row.scheduled_at);
  const startedAt = validTimestamp(row.started_at);
  const completedAt = validTimestamp(row.completed_at);
  const lastSucceededAt = validTimestamp(row.last_succeeded_at);
  const lastFailedAt = validTimestamp(row.last_failed_at);
  const updatedAt = validTimestamp(row.updated_at);
  if (!persistedStatus || monitoringStartedAt === null || updatedAt === null) {
    return missingScheduleStatus();
  }

  const expectedFrom = scheduledAt ?? monitoringStartedAt;
  const nextExpectedAt = expectedFrom + RETENTION_SCHEDULE_MISSED_AFTER_MS;
  const missed = now > nextExpectedAt;
  const stalled =
    persistedStatus === "running" &&
    (startedAt === null || now - startedAt > RETENTION_RUN_STALE_AFTER_MS);
  const health = stalled
    ? "stalled"
    : persistedStatus === "failed"
      ? "failed"
      : missed
        ? "missed"
        : persistedStatus === "pending"
          ? "pending"
          : persistedStatus === "running"
            ? "running"
            : "ready";

  return {
    jobName: SCHEDULED_RETENTION_JOB_NAME,
    health,
    healthy: health === "pending" || health === "running" || health === "ready",
    missed,
    persistedStatus,
    runId: typeof row.run_id === "string" ? row.run_id : null,
    monitoringStartedAt: isoTimestamp(monitoringStartedAt),
    scheduledAt: isoTimestamp(scheduledAt),
    startedAt: isoTimestamp(startedAt),
    completedAt: isoTimestamp(completedAt),
    lastSucceededAt: isoTimestamp(lastSucceededAt),
    lastFailedAt: isoTimestamp(lastFailedAt),
    nextExpectedAt: isoTimestamp(nextExpectedAt),
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    lastResult: retentionResultFromJson(row.last_result),
    updatedAt: isoTimestamp(updatedAt),
  };
}

async function recordScheduledRetentionStart(
  database: D1Database,
  runId: string,
  scheduledAt: number,
  startedAt: number,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO retention_schedule_state (
         job_name, status, monitoring_started_at, run_id, scheduled_at,
         started_at, completed_at, updated_at
       ) VALUES (?, 'running', ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(job_name) DO UPDATE SET
         status = 'running',
         run_id = excluded.run_id,
         scheduled_at = excluded.scheduled_at,
         started_at = excluded.started_at,
         completed_at = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(
      SCHEDULED_RETENTION_JOB_NAME,
      startedAt,
      runId,
      scheduledAt,
      startedAt,
      startedAt,
    )
    .run();
}

async function recordScheduledRetentionSuccess(
  database: D1Database,
  runId: string,
  completedAt: number,
  deleted: RetentionMaintenanceResult,
): Promise<void> {
  const result = await database
    .prepare(
      `UPDATE retention_schedule_state
       SET status = 'succeeded',
           completed_at = ?,
           last_succeeded_at = ?,
           last_error = NULL,
           last_result = ?,
           updated_at = ?
       WHERE job_name = ? AND run_id = ?`,
    )
    .bind(
      completedAt,
      completedAt,
      JSON.stringify(deleted),
      completedAt,
      SCHEDULED_RETENTION_JOB_NAME,
      runId,
    )
    .run();
  assertHeartbeatOwnership(result, "complete");
}

async function recordScheduledRetentionFailure(
  database: D1Database,
  runId: string,
  failedAt: number,
  message: string,
  deleted: RetentionMaintenanceResult | null,
): Promise<void> {
  const result = await database
    .prepare(
      `UPDATE retention_schedule_state
       SET status = 'failed',
           completed_at = ?,
           last_failed_at = ?,
           last_error = ?,
           last_result = ?,
           updated_at = ?
       WHERE job_name = ? AND run_id = ?`,
    )
    .bind(
      failedAt,
      failedAt,
      message,
      deleted ? JSON.stringify(deleted) : null,
      failedAt,
      SCHEDULED_RETENTION_JOB_NAME,
      runId,
    )
    .run();
  assertHeartbeatOwnership(result, "fail");
}

function assertHeartbeatOwnership(
  result: D1Result<unknown>,
  action: string,
): void {
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new Error(
      `Scheduled retention heartbeat could not ${action} the active run.`,
    );
  }
}

function missingScheduleStatus(): RetentionScheduleStatus {
  return {
    jobName: SCHEDULED_RETENTION_JOB_NAME,
    health: "missing",
    healthy: false,
    missed: true,
    persistedStatus: null,
    runId: null,
    monitoringStartedAt: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    nextExpectedAt: null,
    lastError: null,
    lastResult: null,
    updatedAt: null,
  };
}

function scheduleState(
  value: string,
): RetentionScheduleStatus["persistedStatus"] {
  return value === "pending" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed"
    ? value
    : null;
}

function retentionErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown scheduled retention failure.";
  return message.slice(0, MAX_RETENTION_ERROR_LENGTH);
}

function retentionResultFromJson(
  value: string | null,
): RetentionMaintenanceResult | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Partial<RetentionMaintenanceResult>;
    const keys: Array<keyof RetentionMaintenanceResult> = [
      "productEvents",
      "supportRequests",
      "auditEvents",
      "nativeSessions",
      "nativeIdentityTokens",
      "adminLoginAttempts",
      "learnerSessions",
      "learnerVerifications",
      "learnerAuthRateLimits",
      "supportRateLimits",
      "learnerDeletionJobsCompleted",
      "learnerDeletionJobsHeld",
      "learnerDeletionJobsWaiting",
      "learnerDeletionStagesCancelled",
      "learnerDeletionTombstones",
      "supportNotificationJobsExamined",
      "supportNotificationJobsCompleted",
      "supportNotificationJobsFailed",
      "supportNotificationJobsDeleted",
    ];
    if (
      keys.some(
        (key) =>
          !Number.isInteger(parsed[key]) ||
          Number(parsed[key]) < 0,
      )
    ) {
      return null;
    }
    return parsed as RetentionMaintenanceResult;
  } catch {
    return null;
  }
}

function validTimestamp(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} is invalid.`);
  }
}

function isoTimestamp(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
