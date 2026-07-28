import { getDatabase } from "@/db";
import { consumeAccountActionQuota } from "@/app/account-action-rate-limit";
import {
  generateRecoveryCodeSet,
  insertRecoveryCodeStatements,
  internalAccountEmail,
} from "@/app/account-recovery";
import { validateAccountRegistration } from "@/app/account-request";
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

export async function POST(request: Request) {
  const rejected = rejectUnsafeCrossOriginWebApiRequest(request);
  if (rejected) return rejected;

  const body = await readJsonBody(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = validateAccountRegistration(body.value);
  if (!input.ok) return apiError(400, input.error);

  const challenge = await verifyTurnstile(
    input.value.turnstileToken,
    request,
    "account_create",
  );
  if (!challenge.ok) return apiError(challenge.status, challenge.error);

  try {
    const quota = await consumeAccountActionQuota(
      request,
      "register",
      input.value.username,
    );
    if (!quota.allowed) {
      return rateLimited(
        "Too many account-creation attempts. Please try again later.",
        quota.retryAfter,
      );
    }

    const database = await getDatabase();
    const existing = await database
      .prepare("SELECT id FROM learner_user WHERE username = ?")
      .bind(input.value.username)
      .first<{ id: string }>();
    if (existing) return parettoIdTaken();

    const userId = crypto.randomUUID();
    const credentialId = crypto.randomUUID();
    const generationId = crypto.randomUUID();
    const now = Date.now();
    const [passwordVerifier, recovery] = await Promise.all([
      hashParettoPassword(input.value.password),
      generateRecoveryCodeSet(userId),
    ]);

    let results: D1Result<unknown>[];
    try {
      results = await database.batch([
        database
          .prepare(
            `INSERT INTO learner_user (
               id, name, email, email_verified, image, username,
               display_username, created_at, updated_at
             ) VALUES (?, ?, ?, 1, NULL, ?, ?, ?, ?)`,
          )
          .bind(
            userId,
            input.value.username,
            internalAccountEmail(),
            input.value.username,
            input.value.username,
            now,
            now,
          ),
        database
          .prepare(
            `INSERT INTO learner_account (
               id, account_id, provider_id, user_id, access_token,
               refresh_token, id_token, access_token_expires_at,
               refresh_token_expires_at, scope, password, created_at,
               updated_at
             ) VALUES (
               ?, ?, 'credential', ?, NULL, NULL, NULL, NULL, NULL, NULL,
               ?, ?, ?
             )`,
          )
          .bind(
            credentialId,
            userId,
            userId,
            passwordVerifier,
            now,
            now,
          ),
        database
          .prepare(
            `INSERT INTO learner_recovery_state (
               user_id, generation_id, updated_at
             ) VALUES (?, ?, ?)`,
          )
          .bind(userId, generationId, now),
        ...insertRecoveryCodeStatements(
          database,
          userId,
          recovery.hashes,
          generationId,
          now,
        ),
      ]);
    } catch (error) {
      if (isUsernameConflict(error)) return parettoIdTaken();
      throw error;
    }

    if (
      results.some(
        (result) => Number(result.meta.changes ?? 0) !== 1,
      )
    ) {
      throw new Error("Atomic account creation did not write every record.");
    }

    return apiJson(
      {
        account: {
          username: input.value.username,
        },
        recoveryCodes: recovery.plainText,
      },
      201,
    );
  } catch (error) {
    logApiError("learner_account_registration_failed", error);
    return apiError(
      503,
      "Your account could not be created. Please retry.",
    );
  }
}

function parettoIdTaken(): Response {
  return apiError(
    409,
    "That Paretto ID is already in use. Choose another.",
    "PARETTO_ID_TAKEN",
  );
}

function isUsernameConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /learner_user(?:_username_unique|\.username)|username.+unique/i.test(
    message,
  );
}

function rateLimited(message: string, retryAfter: number | null): Response {
  const response = apiError(429, message, "RATE_LIMITED");
  response.headers.set(
    "retry-after",
    String(Math.max(1, Math.ceil(retryAfter ?? 3600))),
  );
  return response;
}
