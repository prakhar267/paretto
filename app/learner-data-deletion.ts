const DELETION_ERROR_LIMIT = 500;
export const LEARNER_DELETION_BATCH_LIMIT = 25;
export const LEARNER_DELETION_STAGE_TIMEOUT_MS = 15 * 60 * 1000;

export type LearnerDeletionJobStatus = "pending" | "held" | "completed";

type LearnerDeletionJobRow = {
  user_id: string;
  user_key: string;
  native_account_id: string | null;
  status: LearnerDeletionJobStatus;
  requested_at: number;
};

export type LearnerDeletionResult = {
  found: boolean;
  completed: boolean;
  held: boolean;
  userStillExists: boolean;
  cancelled: boolean;
  deleted: {
    learningState: number;
    productEvents: number;
    supportRequests: number;
    nativeRecords: number;
  };
};

/**
 * Persists the opaque targets needed after Better Auth deletes its user row.
 * Repeated requests are idempotent and return a completed job to pending so a
 * newly discovered native link or product row cannot escape cleanup.
 */
export async function stageLearnerDataDeletion(
  database: D1Database,
  input: {
    userId: string;
    userKey: string;
    nativeAccountId?: string | null;
    requestedAt?: number;
  },
): Promise<void> {
  const requestedAt = input.requestedAt ?? Date.now();
  const staged = await database
    .prepare(
      `INSERT INTO learner_deletion_jobs (
         user_id, user_key, native_account_id, status, requested_at,
         completed_at, attempts, last_error, updated_at
       ) VALUES (?, ?, ?, 'pending', ?, NULL, 0, NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         user_key = excluded.user_key,
         native_account_id = COALESCE(
           excluded.native_account_id,
           learner_deletion_jobs.native_account_id
         ),
         status = 'pending',
         requested_at = excluded.requested_at,
         completed_at = NULL,
         last_error = NULL,
         updated_at = excluded.updated_at
       WHERE learner_deletion_jobs.user_key = excluded.user_key
         AND (
           learner_deletion_jobs.native_account_id IS NULL OR
           excluded.native_account_id IS NULL OR
           learner_deletion_jobs.native_account_id =
             excluded.native_account_id
         )`,
    )
    .bind(
      input.userId,
      input.userKey,
      input.nativeAccountId ?? null,
      requestedAt,
      requestedAt,
    )
    .run();
  if (Number(staged.meta.changes ?? 0) !== 1) {
    throw new Error(
      "Learner deletion target changed after it was staged.",
    );
  }
}

export async function cancelStagedLearnerDataDeletion(
  database: D1Database,
  userId: string,
): Promise<void> {
  await database
    .prepare(
      `DELETE FROM learner_deletion_jobs
       WHERE user_id = ?
         AND status IN ('pending', 'held')
         AND EXISTS (
           SELECT 1 FROM learner_user WHERE id = ?
         )`,
    )
    .bind(userId, userId)
    .run();
}

export async function cancelStagedNativeDataDeletion(
  database: D1Database,
  userId: string,
  nativeAccountId: string,
): Promise<void> {
  await database
    .prepare(
      `DELETE FROM learner_deletion_jobs
       WHERE user_id = ?
         AND native_account_id = ?
         AND status IN ('pending', 'held')
         AND EXISTS (
           SELECT 1 FROM native_accounts WHERE id = ?
         )`,
    )
    .bind(userId, nativeAccountId, nativeAccountId)
    .run();
}

/**
 * Completes product cleanup only after the authentication user is gone.
 * Active class-, user-, or record-level legal holds keep matching operational
 * rows and the job in `held` so release of the hold triggers the next retry.
 */
export async function processLearnerDataDeletionJob(
  database: D1Database,
  userId: string,
  now = Date.now(),
): Promise<LearnerDeletionResult> {
  const job = await database
    .prepare(
      `SELECT user_id, user_key, native_account_id, status, requested_at
       FROM learner_deletion_jobs
       WHERE user_id = ?`,
    )
    .bind(userId)
    .first<LearnerDeletionJobRow>();
  if (!job) return emptyResult();
  if (job.status === "completed") {
    return { ...emptyResult(), found: true, completed: true };
  }

  const user = await database
    .prepare("SELECT id FROM learner_user WHERE id = ?")
    .bind(userId)
    .first<{ id: string }>();
  if (user) {
    if (now - job.requested_at >= LEARNER_DELETION_STAGE_TIMEOUT_MS) {
      const cancelled = await database
        .prepare(
          `DELETE FROM learner_deletion_jobs
           WHERE user_id = ?
             AND status = 'pending'
             AND requested_at = ?
             AND EXISTS (
               SELECT 1 FROM learner_user WHERE id = ?
             )`,
        )
        .bind(userId, job.requested_at, userId)
        .run();
      if (Number(cancelled.meta.changes ?? 0) === 1) {
        return {
          ...emptyResult(),
          found: true,
          cancelled: true,
        };
      }
    }
    return {
      ...emptyResult(),
      found: true,
      userStillExists: true,
    };
  }

  try {
    const results = await database.batch([
      database
        .prepare("DELETE FROM learning_state WHERE user_key = ?")
        .bind(job.user_key),
      // Reset epochs are durable for ordinary learning-data resets, but an
      // account deletion removes the identity itself and must erase this final
      // opaque account-scoped tombstone as part of the same cleanup batch.
      database
        .prepare(
          "DELETE FROM learner_progress_generations WHERE user_key = ?",
        )
        .bind(job.user_key),
      database
        .prepare(
          `DELETE FROM product_events
           WHERE user_key = ?
             AND NOT EXISTS (
               SELECT 1 FROM retention_legal_holds AS holds
               WHERE holds.status = 'active'
                 AND holds.data_class = 'product_events'
                 AND (
                   holds.record_key IS NULL OR
                   holds.record_key = product_events.id OR
                   holds.record_key = ?
                 )
             )`,
        )
        .bind(job.user_key, job.user_key),
      database
        .prepare(
          `DELETE FROM support_notification_jobs
           WHERE support_request_id IN (
             SELECT id FROM support_requests WHERE user_key = ?
           )`,
        )
        .bind(job.user_key),
      database
        .prepare(
          `DELETE FROM support_requests
           WHERE user_key = ?
             AND NOT EXISTS (
               SELECT 1 FROM retention_legal_holds AS holds
               WHERE holds.status = 'active'
                 AND holds.data_class = 'support_requests'
                 AND (
                   holds.record_key IS NULL OR
                   holds.record_key = support_requests.id OR
                   holds.record_key = ?
                 )
             )`,
        )
        .bind(job.user_key, job.user_key),
      database
        .prepare("DELETE FROM native_learning_state WHERE account_id = ?")
        .bind(job.native_account_id),
      database
        .prepare("DELETE FROM native_sessions WHERE account_id = ?")
        .bind(job.native_account_id),
      database
        .prepare("DELETE FROM native_apple_credentials WHERE account_id = ?")
        .bind(job.native_account_id),
      database
        .prepare(
          "DELETE FROM native_learner_links WHERE native_account_id = ?",
        )
        .bind(job.native_account_id),
      database
        .prepare("DELETE FROM native_accounts WHERE id = ?")
        .bind(job.native_account_id),
      database
        .prepare(
          `UPDATE learner_deletion_jobs
           SET status = CASE
                 WHEN EXISTS (
                   SELECT 1 FROM product_events WHERE user_key = ?
                 ) OR EXISTS (
                   SELECT 1 FROM support_requests WHERE user_key = ?
                 )
                 THEN 'held'
                 ELSE 'completed'
               END,
               completed_at = CASE
                 WHEN EXISTS (
                   SELECT 1 FROM product_events WHERE user_key = ?
                 ) OR EXISTS (
                   SELECT 1 FROM support_requests WHERE user_key = ?
                 )
                 THEN NULL
                 ELSE ?
               END,
               attempts = attempts + 1,
               last_error = NULL,
               updated_at = ?
           WHERE user_id = ? AND status IN ('pending', 'held')`,
        )
        .bind(
          job.user_key,
          job.user_key,
          job.user_key,
          job.user_key,
          now,
          now,
          userId,
        ),
    ]);

    const final = await database
      .prepare(
        "SELECT status FROM learner_deletion_jobs WHERE user_id = ?",
      )
      .bind(userId)
      .first<{ status: LearnerDeletionJobStatus }>();
    const status = final?.status ?? "pending";
    return {
      found: true,
      completed: status === "completed",
      held: status === "held",
      userStillExists: false,
      cancelled: false,
      deleted: {
        learningState: changes(results[0]) + changes(results[1]),
        productEvents: changes(results[2]),
        supportRequests: changes(results[4]),
        nativeRecords: results
          .slice(5, 10)
          .reduce((total, result) => total + changes(result), 0),
      },
    };
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : "unknown deletion failure"
    ).slice(0, DELETION_ERROR_LIMIT);
    try {
      await database
        .prepare(
          `UPDATE learner_deletion_jobs
           SET attempts = attempts + 1,
               last_error = ?,
               updated_at = ?
           WHERE user_id = ? AND status IN ('pending', 'held')`,
        )
        .bind(message, now, userId)
        .run();
    } catch {
      // Preserve the original cleanup failure for the caller and monitoring.
    }
    throw error;
  }
}

export async function processPendingLearnerDataDeletions(
  database: D1Database,
  now = Date.now(),
  limit = LEARNER_DELETION_BATCH_LIMIT,
): Promise<{
  completed: number;
  held: number;
  waitingForUserDeletion: number;
  cancelled: number;
}> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Learner deletion batch limit is outside the supported range.");
  }
  const pending = await database
    .prepare(
      `SELECT jobs.user_id
       FROM learner_deletion_jobs AS jobs
       LEFT JOIN learner_user AS users ON users.id = jobs.user_id
       WHERE jobs.status IN ('pending', 'held')
       ORDER BY CASE
           WHEN jobs.status = 'pending' AND users.id IS NULL THEN 0
           WHEN jobs.status = 'pending' AND jobs.requested_at <= ? THEN 1
           WHEN jobs.status = 'pending' THEN 2
           ELSE 3
         END,
         jobs.updated_at ASC,
         jobs.user_id ASC
       LIMIT ?`,
    )
    .bind(now - LEARNER_DELETION_STAGE_TIMEOUT_MS, limit)
    .all<{ user_id: string }>();

  let completed = 0;
  let held = 0;
  let waitingForUserDeletion = 0;
  let cancelled = 0;
  for (const row of pending.results ?? []) {
    const result = await processLearnerDataDeletionJob(
      database,
      row.user_id,
      now,
    );
    if (result.completed) completed += 1;
    else if (result.held) held += 1;
    else if (result.cancelled) cancelled += 1;
    else if (result.userStillExists) waitingForUserDeletion += 1;
  }
  return { completed, held, waitingForUserDeletion, cancelled };
}

function changes(result: D1Result<unknown>): number {
  return Number(result.meta.changes ?? 0);
}

function emptyResult(): LearnerDeletionResult {
  return {
    found: false,
    completed: false,
    held: false,
    userStillExists: false,
    cancelled: false,
    deleted: {
      learningState: 0,
      productEvents: 0,
      supportRequests: 0,
      nativeRecords: 0,
    },
  };
}
