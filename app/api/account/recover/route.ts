import { getDatabase } from "@/db";
import { consumeAccountActionQuota } from "@/app/account-action-rate-limit";
import {
  generateRecoveryCodeSet,
  hashSubmittedRecoveryCode,
} from "@/app/account-recovery";
import { validateAccountRecovery } from "@/app/account-request";
import {
  apiError,
  apiJson,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import { verifyTurnstile } from "@/app/turnstile";
import { rejectUnsafeCrossOriginWebApiRequest } from "@/app/web-session";
import { hashParettoPassword } from "@/app/password-kdf";

export const dynamic = "force-dynamic";

type RecoveryIdentity = {
  id: string;
  generation_id: string;
};

export async function POST(request: Request) {
  const rejected = rejectUnsafeCrossOriginWebApiRequest(request);
  if (rejected) return rejected;

  const body = await readJsonBody(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = validateAccountRecovery(body.value);
  if (!input.ok) return apiError(400, input.error);

  const challenge = await verifyTurnstile(
    input.value.turnstileToken,
    request,
    "account_recover",
  );
  if (!challenge.ok) return apiError(challenge.status, challenge.error);

  try {
    const quota = await consumeAccountActionQuota(
      request,
      "recover",
      input.value.username,
    );
    if (!quota.allowed) return rateLimited(quota.retryAfter);

    const database = await getDatabase();
    const identity = await database
      .prepare(
        `SELECT learner_user.id, learner_recovery_state.generation_id
         FROM learner_user
         JOIN learner_recovery_state
           ON learner_recovery_state.user_id = learner_user.id
         WHERE learner_user.username = ?
         LIMIT 1`,
      )
      .bind(input.value.username)
      .first<RecoveryIdentity>();
    const hashUserId = identity?.id ?? crypto.randomUUID();
    const nextGenerationId = crypto.randomUUID();
    const now = Date.now();
    const [passwordVerifier, submittedCodeHash, recovery] =
      await Promise.all([
        hashParettoPassword(input.value.password),
        hashSubmittedRecoveryCode(
          hashUserId,
          input.value.recoveryCode,
        ),
        generateRecoveryCodeSet(hashUserId),
      ]);
    if (!identity || !submittedCodeHash) return invalidRecovery();

    const statements: D1PreparedStatement[] = [
      database
        .prepare(
          `UPDATE learner_recovery_state AS state
           SET generation_id = ?, updated_at = ?
           WHERE state.user_id = ?
             AND state.generation_id = ?
             AND EXISTS (
               SELECT 1
               FROM learner_recovery_codes AS codes
               JOIN learner_account AS account
                 ON account.user_id = state.user_id
                AND account.account_id = state.user_id
                AND account.provider_id = 'credential'
                AND account.password IS NOT NULL
               WHERE codes.user_id = state.user_id
                 AND codes.generation_id = state.generation_id
                 AND codes.code_hash = ?
             )`,
        )
        .bind(
          nextGenerationId,
          now,
          identity.id,
          identity.generation_id,
          submittedCodeHash,
        ),
      database
        .prepare(
          `UPDATE learner_account
           SET password = ?, updated_at = ?
           WHERE user_id = ? AND account_id = ?
             AND provider_id = 'credential'
             AND EXISTS (
               SELECT 1 FROM learner_recovery_state
               WHERE user_id = ? AND generation_id = ?
             )`,
        )
        .bind(
          passwordVerifier,
          now,
          identity.id,
          identity.id,
          identity.id,
          nextGenerationId,
        ),
      database
        .prepare(
          `DELETE FROM learner_session
           WHERE user_id = ?
             AND EXISTS (
               SELECT 1 FROM learner_recovery_state
               WHERE user_id = ? AND generation_id = ?
             )`,
        )
        .bind(identity.id, identity.id, nextGenerationId),
      ...recovery.hashes.map((hash) =>
        database
          .prepare(
            `INSERT INTO learner_recovery_codes (
               code_hash, user_id, generation_id, created_at
             )
             SELECT ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM learner_recovery_state
               WHERE user_id = ? AND generation_id = ?
             )`,
          )
          .bind(
            hash,
            identity.id,
            nextGenerationId,
            now,
            identity.id,
            nextGenerationId,
          ),
      ),
      database
        .prepare(
          `DELETE FROM learner_recovery_codes
           WHERE user_id = ? AND generation_id <> ?
             AND EXISTS (
               SELECT 1 FROM learner_recovery_state
               WHERE user_id = ? AND generation_id = ?
             )`,
        )
        .bind(
          identity.id,
          nextGenerationId,
          identity.id,
          nextGenerationId,
        ),
    ];
    const results = await database.batch(statements);
    const insertStart = 3;
    const insertEnd = insertStart + recovery.hashes.length;
    if (Number(results[0]?.meta.changes ?? 0) !== 1) {
      return invalidRecovery();
    }
    if (
      Number(results[1]?.meta.changes ?? 0) !== 1 ||
      results
        .slice(insertStart, insertEnd)
        .some((result) => Number(result.meta.changes ?? 0) !== 1) ||
      Number(results[insertEnd]?.meta.changes ?? 0) < 1
    ) {
      throw new Error("The recovery rotation did not complete every write.");
    }

    return apiJson({
      recovered: true,
      username: input.value.username,
      recoveryCodes: recovery.plainText,
      sessionsRevoked: true,
    });
  } catch (error) {
    logApiError("learner_account_recovery_failed", error);
    return apiError(
      503,
      "Account recovery is temporarily unavailable. Please retry.",
    );
  }
}

function invalidRecovery(): Response {
  return apiError(
    400,
    "The Paretto ID or recovery code is invalid or has already been used.",
    "INVALID_RECOVERY",
  );
}

function rateLimited(retryAfter: number | null): Response {
  const response = apiError(
    429,
    "Too many recovery attempts. Please try again later.",
    "RATE_LIMITED",
  );
  response.headers.set(
    "retry-after",
    String(Math.max(1, Math.ceil(retryAfter ?? 3600))),
  );
  return response;
}
