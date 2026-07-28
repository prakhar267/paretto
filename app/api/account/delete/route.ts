import { getDatabase } from "@/db";
import { consumeAccountActionQuota } from "@/app/account-action-rate-limit";
import { validateAccountDeletion } from "@/app/account-request";
import {
  apiError,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import { getLearnerAuth } from "@/app/learner-auth";
import { resolveLearnerAccountSession } from "@/app/server-auth";
import { rejectUnsafeCrossOriginWebApiRequest } from "@/app/web-session";

export const dynamic = "force-dynamic";

type Credential = {
  password: string;
};

export async function POST(request: Request) {
  const rejected = rejectUnsafeCrossOriginWebApiRequest(request);
  if (rejected) return rejected;

  const body = await readJsonBody(request, 4 * 1024);
  if (!body.ok) return body.response;
  const input = validateAccountDeletion(body.value);
  if (!input.ok) return apiError(400, input.error);

  const session = await resolveLearnerAccountSession(request);
  if ("error" in session) {
    return apiError(503, "Account access is temporarily unavailable.");
  }
  if (!session.session) {
    return apiError(401, "Sign in before deleting this account.");
  }

  try {
    const user = session.session.user;
    const quota = await consumeAccountActionQuota(
      request,
      "delete",
      user.username ?? user.id,
    );
    if (!quota.allowed) return rateLimited(quota.retryAfter);

    const database = await getDatabase();
    const credential = await database
      .prepare(
        `SELECT password
         FROM learner_account
         WHERE user_id = ? AND account_id = ?
           AND provider_id = 'credential'
           AND password IS NOT NULL
         LIMIT 1`,
      )
      .bind(user.id, user.id)
      .first<Credential>();

    if (credential) {
      if (!input.value.password) {
        return apiError(
          400,
          "Enter your current password before deleting this account.",
          "PASSWORD_REQUIRED",
        );
      }
    } else if (input.value.password) {
      return apiError(
        400,
        "This linked-provider account does not use a Paretto password.",
        "CREDENTIAL_ACCOUNT_NOT_FOUND",
      );
    }

    const auth = await getLearnerAuth(request);
    const upstream = await auth.api.deleteUser({
      body: credential
        ? { password: input.value.password }
        : {},
      headers: internalAuthHeaders(request.headers),
      asResponse: true,
    });
    if (!upstream.ok) {
      if (upstream.status === 401 || upstream.status === 403) {
        return apiError(401, "Sign in again before deleting this account.");
      }
      if (upstream.status === 400) {
        return credential
          ? apiError(
              401,
              "The current password is incorrect.",
              "INVALID_PASSWORD",
            )
          : apiError(
              401,
              "For security, sign out and sign in again before deleting this account.",
              "SESSION_EXPIRED",
            );
      }
      throw new Error(`Account deletion returned ${upstream.status}.`);
    }

    const headers = new Headers(upstream.headers);
    headers.delete("content-length");
    headers.delete("location");
    headers.set("cache-control", "private, no-store, max-age=0");
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("x-content-type-options", "nosniff");
    return new Response(JSON.stringify({ deleted: true }), {
      status: 200,
      headers,
    });
  } catch (error) {
    logApiError("learner_account_deletion_failed", error);
    return apiError(
      503,
      "The account could not be deleted. Please retry.",
    );
  }
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
    "Too many deletion attempts. Please try again later.",
    "RATE_LIMITED",
  );
  response.headers.set(
    "retry-after",
    String(Math.max(1, Math.ceil(retryAfter ?? 3600))),
  );
  return response;
}
