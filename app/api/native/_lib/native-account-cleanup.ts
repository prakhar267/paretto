import {
  decryptAppleRefreshToken,
  revokeAppleRefreshToken,
} from "@/app/api/native/_lib/apple-oauth";
import { nativeAccountDeletionConfiguration } from "@/app/api/native/_lib/native-auth";

type NativeLinkRow = {
  native_account_id: string;
  refresh_token_ciphertext: string | null;
};

/**
 * Better Auth calls this before deleting a learner. Revoke Apple while the
 * credential is still available, but leave local rows for the durable
 * post-delete job. Missing or corrupt historical credentials are logged and
 * do not permanently block a data-rights deletion; only a retryable provider
 * outage stops the delete.
 */
export async function prepareNativeIdentityBeforeLearnerDeletion(
  database: D1Database,
  learnerUserId: string,
): Promise<string | null> {
  const link = await database
    .prepare(
      `SELECT links.native_account_id,
              credentials.refresh_token_ciphertext
       FROM native_learner_links AS links
       LEFT JOIN native_apple_credentials AS credentials
         ON credentials.account_id = links.native_account_id
       WHERE links.learner_user_id = ?`,
    )
    .bind(learnerUserId)
    .first<NativeLinkRow>();
  if (!link) return null;

  const configuration = await nativeAccountDeletionConfiguration();
  if (!configuration || !link.refresh_token_ciphertext) {
    logLocalOnlyCleanup("learner_delete_apple_credential_unavailable");
    return link.native_account_id;
  }
  const refreshToken = await decryptAppleRefreshToken(
    link.refresh_token_ciphertext,
    configuration.tokenEncryptionSecret,
    link.native_account_id,
  );
  if (!refreshToken) {
    logLocalOnlyCleanup("learner_delete_apple_credential_corrupt");
    return link.native_account_id;
  }
  const revocation = await revokeAppleRefreshToken(refreshToken, configuration);
  if (!revocation.ok && revocation.reason === "unavailable") {
    throw new Error("Apple authorization could not be revoked. Please retry.");
  }
  if (!revocation.ok) {
    logLocalOnlyCleanup("learner_delete_apple_invalid_grant_local_cleanup");
  }
  return link.native_account_id;
}

function logLocalOnlyCleanup(event: string) {
  console.error(
    JSON.stringify({
      event,
      message:
        "Apple authorization could not be revoked; local deletion remains queued.",
      timestamp: new Date().toISOString(),
    }),
  );
}
