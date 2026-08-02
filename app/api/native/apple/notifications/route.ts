import {
  apiError,
  isRecord,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import {
  nativeAppleSubjectHash,
  nativeApiEnabled,
  verifyAppleServerNotification,
} from "@/app/api/native/_lib/native-auth";
import { linkedLearnerUserKey } from "@/app/api/native/_lib/native-account-bridge";
import {
  processLearnerDataDeletionJob,
  stageLearnerDataDeletion,
} from "@/app/learner-data-deletion";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

type NativeAccountRow = {
  id: string;
  learner_user_id: string | null;
};

export async function POST(request: Request) {
  if (!(await nativeApiEnabled())) {
    return apiError(503, "Native account notifications are not enabled.");
  }
  const body = await readJsonBody(request, 20 * 1024);
  if (!body.ok) return body.response;
  if (
    !isRecord(body.value) ||
    typeof body.value.payload !== "string" ||
    Object.keys(body.value).length !== 1
  ) {
    return apiError(400, "A signed Apple notification payload is required.");
  }

  const { env } = await import("cloudflare:workers");
  const clientId = (env as unknown as { APPLE_CLIENT_ID?: unknown })
    .APPLE_CLIENT_ID;
  if (typeof clientId !== "string" || clientId.length < 3) {
    return apiError(503, "Apple notification verification is not configured.");
  }

  let notificationId: string | null = null;
  let database: D1Database | null = null;
  try {
    const notification = await verifyAppleServerNotification(
      body.value.payload,
      { clientId },
    );
    if (!notification) {
      return apiError(401, "Apple notification verification failed.");
    }
    notificationId = notification.id;
    const subjectHash = await nativeAppleSubjectHash(
      notification.event.subject,
    );
    if (!subjectHash) {
      return apiError(503, "Apple notification processing is not configured.");
    }

    database = await getDatabase();
    const now = Date.now();
    await database
      .prepare(
        `INSERT OR IGNORE INTO apple_account_notifications (
           id, event_type, apple_subject_hash, event_time, status,
           received_at, processed_at
         ) VALUES (?, ?, ?, ?, 'pending', ?, NULL)`,
      )
      .bind(
        notification.id,
        notification.event.type,
        subjectHash,
        notification.event.eventTime * 1000,
        now,
      )
      .run();
    const stored = await database
      .prepare(
        `SELECT status FROM apple_account_notifications WHERE id = ?`,
      )
      .bind(notification.id)
      .first<{ status: string }>();
    if (!stored) throw new Error("Apple notification journal write failed.");
    if (stored.status === "processed") return accepted();

    const account = await database
      .prepare(
        `SELECT accounts.id, links.learner_user_id
         FROM native_accounts AS accounts
         LEFT JOIN native_learner_links AS links
           ON links.native_account_id = accounts.id
         WHERE accounts.apple_subject_hash = ?`,
      )
      .bind(subjectHash)
      .first<NativeAccountRow>();

    if (account) {
      switch (notification.event.type) {
        case "email-enabled":
        case "email-disabled":
          await database
            .prepare(
              `UPDATE native_accounts
               SET email = COALESCE(?, email),
                   email_forwarding_enabled = ?, updated_at = ?
               WHERE id = ?`,
            )
            .bind(
              notification.event.email,
              notification.event.type === "email-enabled" ? 1 : 0,
              now,
              account.id,
            )
            .run();
          break;
        case "consent-revoked":
          await database.batch([
            database
              .prepare(
                `UPDATE native_sessions SET revoked_at = ?
                 WHERE account_id = ? AND revoked_at IS NULL`,
              )
              .bind(now, account.id),
            database
              .prepare(
                "DELETE FROM native_apple_credentials WHERE account_id = ?",
              )
              .bind(account.id),
            database
              .prepare(
                `UPDATE native_accounts
                 SET email_forwarding_enabled = 0, updated_at = ?
                 WHERE id = ?`,
              )
              .bind(now, account.id),
          ]);
          break;
        case "account-deleted": {
          const userKey = account.learner_user_id
            ? await linkedLearnerUserKey(account.learner_user_id)
            : `native-only:${account.id}`;
          if (!userKey) {
            throw new Error("Linked learner deletion is not configured.");
          }
          const deletionUserId =
            account.learner_user_id ?? `native:${account.id}`;
          await stageLearnerDataDeletion(database, {
            userId: deletionUserId,
            userKey,
            nativeAccountId: account.id,
            requestedAt: now,
          });
          const removals = [
            database
              .prepare("DELETE FROM native_sessions WHERE account_id = ?")
              .bind(account.id),
            database
              .prepare(
                "DELETE FROM native_apple_credentials WHERE account_id = ?",
              )
              .bind(account.id),
          ];
          if (account.learner_user_id) {
            removals.push(
              database
                .prepare("DELETE FROM learner_user WHERE id = ?")
                .bind(account.learner_user_id),
            );
          }
          await database.batch(removals);
          try {
            await processLearnerDataDeletionJob(database, deletionUserId, now);
          } catch (error) {
            logApiError("apple_account_notification_cleanup_queued", error);
          }
          break;
        }
      }
    }

    await database
      .prepare(
        `UPDATE apple_account_notifications
         SET status = 'processed', processed_at = ? WHERE id = ?`,
      )
      .bind(now, notification.id)
      .run();
    return accepted();
  } catch (error) {
    if (database && notificationId) {
      await database
        .prepare(
          `UPDATE apple_account_notifications
           SET status = 'failed', processed_at = NULL WHERE id = ?`,
        )
        .bind(notificationId)
        .run()
        .catch(() => undefined);
    }
    logApiError("apple_account_notification_failed", error);
    return apiError(503, "Apple notification processing is temporarily unavailable.");
  }
}

function accepted(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
