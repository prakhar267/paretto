import { consumeAccountActionQuota } from "@/app/account-action-rate-limit";
import { getDatabase } from "@/db";
import { validateAccountSignIn } from "@/app/account-request";
import {
  apiError,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import { getLearnerAuth } from "@/app/learner-auth";
import {
  hashParettoPassword,
  parettoPasswordVerifierNeedsRehash,
} from "@/app/password-kdf";
import { verifyTurnstile } from "@/app/turnstile";
import { rejectUnsafeCrossOriginWebApiRequest } from "@/app/web-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectUnsafeCrossOriginWebApiRequest(request);
  if (rejected) return rejected;

  const body = await readJsonBody(request, 8 * 1024);
  if (!body.ok) return body.response;
  const input = validateAccountSignIn(body.value);
  if (!input.ok) return apiError(400, input.error);

  const challenge = await verifyTurnstile(
    input.value.turnstileToken,
    request,
    "account_sign_in",
  );
  if (!challenge.ok) return apiError(challenge.status, challenge.error);

  try {
    const quota = await consumeAccountActionQuota(
      request,
      "sign-in",
      input.value.username,
    );
    if (!quota.allowed) {
      return rateLimited(quota.retryAfter);
    }

    const auth = await getLearnerAuth(request);
    const upstream = await auth.api.signInUsername({
      body: {
        username: input.value.username,
        password: input.value.password,
        rememberMe: true,
      },
      headers: internalAuthHeaders(request.headers),
      asResponse: true,
    });
    if (!upstream.ok) {
      return upstream.status === 429
        ? rateLimited(Number(upstream.headers.get("retry-after")) || 60)
        : apiError(
            401,
            "The Paretto ID or password is incorrect.",
            "INVALID_CREDENTIALS",
          );
    }

    try {
      await rehashRetainedPasswordPepper(
        input.value.username,
        input.value.password,
      );
    } catch (error) {
      logApiError("learner_password_rehash_failed", error);
    }

    const headers = new Headers(upstream.headers);
    headers.delete("content-length");
    headers.delete("location");
    headers.set("cache-control", "private, no-store, max-age=0");
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("x-content-type-options", "nosniff");
    return new Response(
      JSON.stringify({
        signedIn: true,
        username: input.value.username,
      }),
      { status: 200, headers },
    );
  } catch (error) {
    logApiError("learner_account_sign_in_failed", error);
    return apiError(
      503,
      "Account sign-in is temporarily unavailable. Please retry.",
    );
  }
}

async function rehashRetainedPasswordPepper(
  username: string,
  password: string,
): Promise<void> {
  const database = await getDatabase();
  const credential = await database
    .prepare(
      `SELECT account.id, account.password
       FROM learner_account AS account
       JOIN learner_user AS learner
         ON learner.id = account.user_id
       WHERE learner.username = ?
         AND account.provider_id = 'credential'
         AND account.password IS NOT NULL
       LIMIT 1`,
    )
    .bind(username)
    .first<{ id: string; password: string }>();
  if (
    !credential ||
    !(await parettoPasswordVerifierNeedsRehash(credential.password))
  ) {
    return;
  }
  const replacement = await hashParettoPassword(password);
  await database
    .prepare(
      `UPDATE learner_account
       SET password = ?, updated_at = ?
       WHERE id = ? AND password = ?`,
    )
    .bind(replacement, Date.now(), credential.id, credential.password)
    .run();
}

function internalAuthHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  headers.delete("content-length");
  headers.set("accept", "application/json");
  headers.set("content-type", "application/json");
  return headers;
}

function rateLimited(retryAfter: number | null): Response {
  const response = apiError(
    429,
    "Too many sign-in attempts. Please try again later.",
    "RATE_LIMITED",
  );
  response.headers.set(
    "retry-after",
    String(Math.max(1, Math.ceil(retryAfter ?? 3600))),
  );
  return response;
}
