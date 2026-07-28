import { getDatabase } from "@/db";
import { consumeAccountActionQuota } from "@/app/account-action-rate-limit";
import { generateRecoveryCodeSet } from "@/app/account-recovery";
import { validateRecoveryCodeRotation } from "@/app/account-request";
import {
  apiError,
  apiJson,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import { resolveLearnerAccountSession } from "@/app/server-auth";
import { verifyTurnstile } from "@/app/turnstile";
import { rejectUnsafeCrossOriginWebApiRequest } from "@/app/web-session";
import { verifyParettoPassword } from "@/app/password-kdf";

export const dynamic = "force-dynamic";

type CredentialState = {
  password: string;
  generation_id: string;
};

export async function POST(request: Request) {
  const rejected = rejectUnsafeCrossOriginWebApiRequest(request);
  if (rejected) return rejected;

  const session = await resolveLearnerAccountSession(request);
  if ("error" in session) {
    return apiError(503, "Account access is temporarily unavailable.");
  }
  if (!session.session) {
    return apiError(401, "Sign in before replacing recovery codes.");
  }
  const username = session.session.user.username;
  if (!username) {
    return apiError(
      400,
      "This linked-provider account does not use recovery codes.",
    );
  }

  const body = await readJsonBody(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = validateRecoveryCodeRotation(body.value);
  if (!input.ok) return apiError(400, input.error);

  const challenge = await verifyTurnstile(
    input.value.turnstileToken,
    request,
    "recovery_codes_rotate",
  );
  if (!challenge.ok) return apiError(challenge.status, challenge.error);

  try {
    const quota = await consumeAccountActionQuota(
      request,
      "rotate-codes",
      username,
    );
    if (!quota.allowed) return rateLimited(quota.retryAfter);

    const database = await getDatabase();
    const userId = session.session.user.id;
    const credential = await database
      .prepare(
        `SELECT account.password, state.generation_id
         FROM learner_account AS account
         JOIN learner_recovery_state AS state
           ON state.user_id = account.user_id
         WHERE account.user_id = ?
           AND account.account_id = ?
           AND account.provider_id = 'credential'
           AND account.password IS NOT NULL
         LIMIT 1`,
      )
      .bind(userId, userId)
      .first<CredentialState>();
    if (
      !credential ||
      !(await verifyParettoPassword(
        input.value.password,
        credential.password,
      ))
    ) {
      return apiError(
        401,
        "The current password is incorrect.",
        "INVALID_PASSWORD",
      );
    }

    const nextGenerationId = crypto.randomUUID();
    const now = Date.now();
    const recovery = await generateRecoveryCodeSet(userId);
    const statements: D1PreparedStatement[] = [
      database
        .prepare(
          `UPDATE learner_recovery_state AS state
           SET generation_id = ?, updated_at = ?
           WHERE state.user_id = ? AND state.generation_id = ?
             AND EXISTS (
               SELECT 1 FROM learner_account
               WHERE user_id = state.user_id
                 AND account_id = state.user_id
                 AND provider_id = 'credential'
                 AND password = ?
             )`,
        )
        .bind(
          nextGenerationId,
          now,
          userId,
          credential.generation_id,
          credential.password,
        ),
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
            userId,
            nextGenerationId,
            now,
            userId,
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
        .bind(userId, nextGenerationId, userId, nextGenerationId),
    ];
    const results = await database.batch(statements);
    const deleteIndex = 1 + recovery.hashes.length;
    if (Number(results[0]?.meta.changes ?? 0) !== 1) {
      return apiError(
        409,
        "Recovery codes changed in another session. Please retry.",
        "RECOVERY_CODES_CHANGED",
      );
    }
    if (
      results
        .slice(1, deleteIndex)
        .some((result) => Number(result.meta.changes ?? 0) !== 1) ||
      Number(results[deleteIndex]?.meta.changes ?? 0) < 1
    ) {
      throw new Error("The recovery-code replacement was incomplete.");
    }

    return apiJson({
      replaced: true,
      username,
      recoveryCodes: recovery.plainText,
    });
  } catch (error) {
    logApiError("learner_recovery_code_rotation_failed", error);
    return apiError(
      503,
      "Recovery codes could not be replaced. Please retry.",
    );
  }
}

function rateLimited(retryAfter: number | null): Response {
  const response = apiError(
    429,
    "Too many recovery-code requests. Please try again later.",
    "RATE_LIMITED",
  );
  response.headers.set(
    "retry-after",
    String(Math.max(1, Math.ceil(retryAfter ?? 3600))),
  );
  return response;
}
