import {
  loadTransactionalEmailBindings,
  sendTransactionalEmail,
  supportOperatorEmail,
  validTransactionalRecipient,
  type EmailBindings,
  type TransactionalEmail,
} from "@/app/transactional-email";
import { waitUntil } from "cloudflare:workers";

export const SUPPORT_NOTIFICATION_BATCH_LIMIT = 25;
export const MAX_SUPPORT_NOTIFICATION_BATCH_LIMIT = 100;
export const SUPPORT_NOTIFICATION_COMPLETED_RETENTION_MS =
  7 * 24 * 60 * 60 * 1000;

const DELIVERY_LEASE_MS = 60_000;
const MAX_ERROR_LENGTH = 500;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

type SupportStatus = "open" | "in_progress" | "resolved" | "closed";
type SupportNotificationEvent =
  | "operator_created"
  | "requester_created"
  | "requester_status";

type SupportNotificationRow = {
  id: string;
  support_request_id: string;
  event_type: SupportNotificationEvent;
  support_revision: number;
  support_status: SupportStatus;
  recipient_email: string | null;
  attempts: number;
  reply_email: string | null;
  category: string;
  subject: string;
};

export type SupportNotificationDeliveryResult = {
  examined: number;
  claimed: number;
  completed: number;
  failed: number;
};

export function scheduleSupportNotificationDelivery(
  database: D1Database,
): void {
  try {
    waitUntil(
      processSupportNotificationOutbox(database).catch(() => {
        console.error(
          JSON.stringify({
            event: "support_notification_background_delivery_failed",
            timestamp: new Date().toISOString(),
          }),
        );
      }),
    );
  } catch {
    console.error(
      JSON.stringify({
        event: "support_notification_background_schedule_failed",
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

export function enqueueSupportCreatedNotifications(
  database: D1Database,
  input: {
    supportRequestId: string;
    userKey: string;
    accountId: string | null;
    createdAt: number;
  },
): D1PreparedStatement[] {
  const operatorJobId = crypto.randomUUID();
  const requesterJobId = crypto.randomUUID();
  return [
    database
      .prepare(
        `INSERT INTO support_notification_jobs (
           id, support_request_id, event_type, support_revision,
           support_status, recipient_email, status, attempts, available_at,
           lease_expires_at, last_error, completed_at, created_at, updated_at
         )
         SELECT ?, requests.id, 'operator_created', 1, 'open', NULL,
                'pending', 0, ?, NULL, NULL, NULL, ?, ?
         FROM support_requests AS requests
         WHERE requests.id = ?
           AND requests.user_key = ?
           AND requests.revision = 1
           AND requests.status = 'open'
           AND requests.created_at = ?
           AND requests.updated_at = ?`,
      )
      .bind(
        operatorJobId,
        input.createdAt,
        input.createdAt,
        input.createdAt,
        input.supportRequestId,
        input.userKey,
        input.createdAt,
        input.createdAt,
      ),
    database
      .prepare(
        `INSERT INTO support_notification_jobs (
           id, support_request_id, event_type, support_revision,
           support_status, recipient_email, status, attempts, available_at,
           lease_expires_at, last_error, completed_at, created_at, updated_at
         )
         SELECT ?, requests.id, 'requester_created', 1, 'open', users.email,
                'pending', 0, ?, NULL, NULL, NULL, ?, ?
         FROM support_requests AS requests
         INNER JOIN learner_user AS users ON users.id = ?
         WHERE requests.id = ?
           AND requests.user_key = ?
           AND requests.revision = 1
           AND requests.status = 'open'
           AND requests.created_at = ?
           AND requests.updated_at = ?
           AND users.email_verified = 1
           AND lower(users.email) NOT LIKE '%.invalid'
           AND requests.reply_email IS NOT NULL
           AND lower(users.email) = lower(requests.reply_email)`,
      )
      .bind(
        requesterJobId,
        input.createdAt,
        input.createdAt,
        input.createdAt,
        input.accountId,
        input.supportRequestId,
        input.userKey,
        input.createdAt,
        input.createdAt,
      ),
  ];
}

export function enqueueSupportStatusNotification(
  database: D1Database,
  input: {
    supportRequestId: string;
    revision: number;
    status: SupportStatus;
    updatedAt: number;
  },
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO support_notification_jobs (
         id, support_request_id, event_type, support_revision,
         support_status, recipient_email, status, attempts, available_at,
         lease_expires_at, last_error, completed_at, created_at, updated_at
       )
       SELECT ?, requests.id, 'requester_status', ?, ?,
              creation.recipient_email, 'pending', 0, ?, NULL, NULL, NULL, ?, ?
       FROM support_requests AS requests
       INNER JOIN support_notification_jobs AS creation
         ON creation.support_request_id = requests.id
        AND creation.event_type = 'requester_created'
        AND creation.support_revision = 1
       WHERE requests.id = ?
         AND requests.revision = ?
         AND requests.status = ?
         AND requests.updated_at = ?
         AND changes() = 1`,
    )
    .bind(
      crypto.randomUUID(),
      input.revision,
      input.status,
      input.updatedAt,
      input.updatedAt,
      input.updatedAt,
      input.supportRequestId,
      input.revision,
      input.status,
      input.updatedAt,
    );
}

/**
 * Claims and delivers one bounded page. Provider delivery uses the durable job
 * ID as an idempotency key, so a completion-write retry does not normally
 * create a duplicate email.
 */
export async function processSupportNotificationOutbox(
  database: D1Database,
  now = Date.now(),
  batchLimit = SUPPORT_NOTIFICATION_BATCH_LIMIT,
): Promise<SupportNotificationDeliveryResult> {
  assertBatchLimit(batchLimit);
  const due = await database
    .prepare(
      `SELECT jobs.id, jobs.support_request_id, jobs.event_type, jobs.support_revision,
              jobs.support_status, jobs.recipient_email, jobs.attempts,
              requests.reply_email, requests.category, requests.subject
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
       ORDER BY jobs.available_at ASC, jobs.created_at ASC, jobs.id ASC
       LIMIT ?`,
    )
    .bind(now, now, batchLimit)
    .all<SupportNotificationRow>();

  let bindings: EmailBindings | null = null;
  let bindingError: unknown = null;
  try {
    bindings = await loadTransactionalEmailBindings();
  } catch (error) {
    bindingError = error;
  }

  const result: SupportNotificationDeliveryResult = {
    examined: due.results.length,
    claimed: 0,
    completed: 0,
    failed: 0,
  };
  for (const job of due.results) {
    const leaseExpiresAt = now + DELIVERY_LEASE_MS;
    const claimed = await database
      .prepare(
        `UPDATE support_notification_jobs
         SET status = 'processing',
             attempts = attempts + 1,
             lease_expires_at = ?,
             last_error = NULL,
             updated_at = ?
         WHERE id = ?
           AND (
             (status IN ('pending', 'failed') AND available_at <= ?) OR
             (status = 'processing' AND lease_expires_at IS NOT NULL
               AND lease_expires_at <= ?)
           )`,
      )
      .bind(leaseExpiresAt, now, job.id, now, now)
      .run();
    if (Number(claimed.meta.changes ?? 0) !== 1) continue;
    result.claimed += 1;

    try {
      if (bindingError) throw bindingError;
      if (!bindings) throw new Error("Transactional email bindings are unavailable.");
      await sendTransactionalEmail(
        bindings,
        notificationMessage(job, bindings),
      );
      const completed = await database
        .prepare(
          `UPDATE support_notification_jobs
           SET status = 'completed',
               lease_expires_at = NULL,
               last_error = NULL,
               completed_at = ?,
               updated_at = ?
           WHERE id = ? AND status = 'processing' AND lease_expires_at = ?`,
        )
        .bind(now, now, job.id, leaseExpiresAt)
        .run();
      if (Number(completed.meta.changes ?? 0) === 1) result.completed += 1;
    } catch (error) {
      const failed = await database
        .prepare(
          `UPDATE support_notification_jobs
           SET status = 'failed',
               available_at = ?,
               lease_expires_at = NULL,
               last_error = ?,
               updated_at = ?
           WHERE id = ? AND status = 'processing' AND lease_expires_at = ?`,
        )
        .bind(
          now + retryBackoffMs(job.attempts + 1),
          safeErrorMessage(error),
          now,
          job.id,
          leaseExpiresAt,
        )
        .run();
      if (Number(failed.meta.changes ?? 0) === 1) {
        result.failed += 1;
        console.error(
          JSON.stringify({
            event: "support_notification_delivery_failed",
            jobId: job.id,
            notificationType: job.event_type,
            attempt: job.attempts + 1,
            timestamp: new Date(now).toISOString(),
          }),
        );
      }
    }
  }
  return result;
}

function notificationMessage(
  job: SupportNotificationRow,
  bindings: EmailBindings,
): TransactionalEmail {
  const idempotencyKey = `support-notification:${job.id}`;
  if (job.event_type === "operator_created") {
    const operatorEmail = supportOperatorEmail(bindings);
    if (!operatorEmail) {
      throw new Error("Support operator email is not configured.");
    }
    return {
      to: operatorEmail,
      replyTo: validTransactionalRecipient(job.reply_email)
        ? job.reply_email
        : null,
      idempotencyKey,
      subject: `[Paretto support] ${job.subject}`,
      text: [
        "A learner support request is ready for review.",
        "",
        `Reference: ${job.support_request_id}`,
        `Category: ${job.category}`,
        `Subject: ${job.subject}`,
        "",
        "Open the authenticated administration console to read and manage it.",
      ].join("\n"),
    };
  }

  if (!validTransactionalRecipient(job.recipient_email)) {
    throw new Error("Verified support recipient is invalid.");
  }
  if (job.event_type === "requester_created") {
    return {
      to: job.recipient_email,
      idempotencyKey,
      subject: `Paretto support request ${job.support_request_id}`,
      text: [
        "We received your Paretto support request.",
        "",
        `Reference: ${job.support_request_id}`,
        `Subject: ${job.subject}`,
        "Status: Open",
        "",
        "You can check its current status from the Paretto support page while signed in or using the same browser.",
      ].join("\n"),
    };
  }
  return {
    to: job.recipient_email,
    idempotencyKey,
    subject: `Paretto support request ${job.support_request_id} updated`,
    text: [
      "Your Paretto support request has been updated.",
      "",
      `Reference: ${job.support_request_id}`,
      `Subject: ${job.subject}`,
      `Status: ${humanStatus(job.support_status)}`,
      "",
      "You can check its current status from the Paretto support page while signed in or using the same browser.",
    ].join("\n"),
  };
}

function retryBackoffMs(attempt: number): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 10);
  return Math.min(15 * 60 * 1000 * 2 ** exponent, MAX_BACKOFF_MS);
}

function safeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown support notification delivery failure.";
  return message.slice(0, MAX_ERROR_LENGTH);
}

function humanStatus(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function assertBatchLimit(batchLimit: number): void {
  if (
    !Number.isInteger(batchLimit) ||
    batchLimit < 1 ||
    batchLimit > MAX_SUPPORT_NOTIFICATION_BATCH_LIMIT
  ) {
    throw new Error("Support notification batch limit is outside the supported range.");
  }
}
