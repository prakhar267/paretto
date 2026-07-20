import { apiError, logApiError } from "@/app/api/_lib/api-utils";
import {
  nativeAccountDeletionConfiguration,
  requireNativeSession,
} from "@/app/api/native/_lib/native-auth";
import {
  decryptAppleRefreshToken,
  revokeAppleRefreshToken,
} from "@/app/api/native/_lib/apple-oauth";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const session = await requireNativeSession(request);
  if (!session.ok) return session.response;
  try {
    const configuration = await nativeAccountDeletionConfiguration();
    if (!configuration) {
      return apiError(503, "Native account deletion is not configured.");
    }
    const database = await getDatabase();
    const credential = await database
      .prepare(
        `SELECT refresh_token_ciphertext
         FROM native_apple_credentials WHERE account_id = ?`,
      )
      .bind(session.accountId)
      .first<{ refresh_token_ciphertext: string }>();
    if (!credential) {
      return apiError(
        503,
        "Apple authorization could not be revoked. Please contact support.",
      );
    }
    const refreshToken = await decryptAppleRefreshToken(
      credential.refresh_token_ciphertext,
      configuration.tokenEncryptionSecret,
      session.accountId,
    );
    if (!refreshToken) {
      throw new Error("Stored Apple refresh token could not be decrypted");
    }
    const revocation = await revokeAppleRefreshToken(
      refreshToken,
      configuration,
    );
    if (!revocation.ok && revocation.reason === "unavailable") {
      logApiError(
        "native_apple_revocation_unavailable",
        new Error("Apple token revocation did not complete"),
      );
      return apiError(
        503,
        "Apple authorization could not be revoked. Please retry.",
      );
    }
    if (!revocation.ok) {
      // An invalid/expired credential cannot be retried indefinitely. Apple
      // directs services without a usable token to complete local deletion and
      // fall back to the user's Apple authorization controls.
      logApiError(
        "native_apple_revocation_invalid_grant_local_delete",
        new Error("Apple no longer accepts the stored refresh token"),
      );
    }
    await database.batch([
      database
        .prepare("DELETE FROM native_learning_state WHERE account_id = ?")
        .bind(session.accountId),
      database
        .prepare("DELETE FROM native_sessions WHERE account_id = ?")
        .bind(session.accountId),
      database
        .prepare("DELETE FROM native_apple_credentials WHERE account_id = ?")
        .bind(session.accountId),
      database
        .prepare("DELETE FROM native_accounts WHERE id = ?")
        .bind(session.accountId),
    ]);
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logApiError("native_account_delete_failed", error);
    return apiError(503, "The native account could not be deleted.");
  }
}
