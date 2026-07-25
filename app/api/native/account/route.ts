import { apiError, logApiError } from "@/app/api/_lib/api-utils";
import {
  nativeAccountDeletionConfiguration,
  requireNativeSession,
} from "@/app/api/native/_lib/native-auth";
import {
  decryptAppleRefreshToken,
  revokeAppleRefreshToken,
} from "@/app/api/native/_lib/apple-oauth";
import { linkedLearnerUserKey } from "@/app/api/native/_lib/native-account-bridge";
import {
  cancelStagedNativeDataDeletion,
  processLearnerDataDeletionJob,
  stageLearnerDataDeletion,
} from "@/app/learner-data-deletion";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const session = await requireNativeSession(request, {
    allowDisabledForDeletion: true,
  });
  if (!session.ok) return session.response;
  let database: D1Database | null = null;
  let stagedDeletionUserId: string | null = null;
  try {
    database = await getDatabase();
    const sharedUserKey = session.learnerUserId
      ? await linkedLearnerUserKey(session.learnerUserId)
      : null;
    if (session.learnerUserId && !sharedUserKey) {
      return apiError(503, "Shared account deletion is not configured.");
    }
    const deletionUserId =
      session.learnerUserId ?? `native:${session.accountId}`;
    await stageLearnerDataDeletion(database, {
      userId: deletionUserId,
      userKey: sharedUserKey ?? `native-only:${session.accountId}`,
      nativeAccountId: session.accountId,
    });
    stagedDeletionUserId = deletionUserId;

    const credential = await database
      .prepare(
        `SELECT refresh_token_ciphertext
         FROM native_apple_credentials WHERE account_id = ?`,
      )
      .bind(session.accountId)
      .first<{ refresh_token_ciphertext: string }>();
    const configuration = await nativeAccountDeletionConfiguration();
    try {
      if (credential && configuration) {
        const refreshToken = await decryptAppleRefreshToken(
          credential.refresh_token_ciphertext,
          configuration.tokenEncryptionSecret,
          session.accountId,
        );
        if (refreshToken) {
          const revocation = await revokeAppleRefreshToken(
            refreshToken,
            configuration,
          );
          if (!revocation.ok && revocation.reason === "unavailable") {
            throw new Error("Apple token revocation did not complete");
          }
          if (!revocation.ok) {
            logApiError(
              "native_apple_revocation_invalid_grant_local_delete",
              new Error("Apple no longer accepts the stored refresh token"),
            );
          }
        } else {
          logApiError(
            "native_apple_credential_corrupt_local_delete",
            new Error("Stored Apple refresh token could not be decrypted"),
          );
        }
      } else {
        logApiError(
          "native_apple_credential_unavailable_local_delete",
          new Error(
            "Apple revocation credentials were unavailable; local deletion continues",
          ),
        );
      }
    } catch (error) {
      await cancelStagedNativeDataDeletion(
        database,
        deletionUserId,
        session.accountId,
      );
      logApiError(
        "native_apple_revocation_unavailable",
        error,
      );
      return apiError(
        503,
        "Apple authorization could not be revoked. Please retry.",
      );
    }

    const identityRemoval = [
      database
        .prepare("DELETE FROM native_sessions WHERE account_id = ?")
        .bind(session.accountId),
    ];
    if (session.learnerUserId) {
      identityRemoval.push(
        database
          .prepare("DELETE FROM learner_user WHERE id = ?")
          .bind(session.learnerUserId),
      );
    }
    await database.batch(identityRemoval);
    // Authentication ownership is now gone, so the durable job must remain
    // even if immediate product cleanup fails.
    stagedDeletionUserId = null;
    try {
      await processLearnerDataDeletionJob(database, deletionUserId);
    } catch (error) {
      // The session and linked authentication user are already gone. The
      // durable job is retried by scheduled retention.
      logApiError("native_account_cleanup_queued_for_retry", error);
    }
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (database && stagedDeletionUserId) {
      try {
        await cancelStagedNativeDataDeletion(
          database,
          stagedDeletionUserId,
          session.accountId,
        );
      } catch (cancelError) {
        logApiError(
          "native_account_delete_stage_rollback_failed",
          cancelError,
        );
      }
    }
    logApiError("native_account_delete_failed", error);
    return apiError(503, "The native account could not be deleted.");
  }
}
