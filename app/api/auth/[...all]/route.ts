import {
  getLearnerAuth,
} from "@/app/learner-auth";
import {
  isRecord,
  readJsonBody,
} from "@/app/api/_lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  try {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
    if (blockedLegacyAccountPath(pathname)) {
      return disabledAccountRoute();
    }
    let forwardedRequest = request;
    if (
      request.method === "POST" &&
      pathname === "/api/auth/sign-in/social"
    ) {
      const inspected = await inspectSocialSignInRequest(request);
      if (!inspected.ok) return disabledAccountRoute();
      forwardedRequest = inspected.request;
    }
    return (await getLearnerAuth(forwardedRequest)).handler(
      forwardedRequest,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "learner_auth_unavailable",
        message: error instanceof Error ? error.message : "unknown error",
        timestamp: new Date().toISOString(),
      }),
    );
    return Response.json(
      { error: "Learner authentication is temporarily unavailable." },
      {
        status: 503,
        headers: {
          "cache-control": "private, no-store, max-age=0",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
}

function blockedLegacyAccountPath(pathname: string): boolean {
  return [
    "/api/auth/sign-up/email",
    "/api/auth/sign-in/email",
    "/api/auth/sign-in/username",
    "/api/auth/is-username-available",
    "/api/auth/request-password-reset",
    "/api/auth/send-verification-email",
    "/api/auth/verify-email",
    "/api/auth/verify-password",
    "/api/auth/change-password",
    "/api/auth/change-email",
    "/api/auth/update-user",
    "/api/auth/update-session",
    "/api/auth/list-sessions",
    "/api/auth/revoke-session",
    "/api/auth/revoke-sessions",
    "/api/auth/revoke-other-sessions",
    "/api/auth/list-accounts",
    "/api/auth/link-social",
    "/api/auth/unlink-account",
    "/api/auth/get-access-token",
    "/api/auth/refresh-token",
    "/api/auth/account-info",
    "/api/auth/delete-user",
    "/api/auth/delete-user/callback",
  ].includes(pathname) ||
    pathname === "/api/auth/reset-password" ||
    pathname.startsWith("/api/auth/reset-password/");
}

async function inspectSocialSignInRequest(
  request: Request,
): Promise<{ ok: true; request: Request } | { ok: false }> {
  const body = await readJsonBody(
    request as unknown as Request,
    16 * 1024,
  );
  if (
    !body.ok ||
    !isRecord(body.value) ||
    "idToken" in body.value
  ) {
    return { ok: false };
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return {
    ok: true,
    request: new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body.value),
    }),
  };
}

function disabledAccountRoute(): Response {
  return Response.json(
    {
      code: "ACCOUNT_ROUTE_DISABLED",
      error: "Use Paretto's protected account flow.",
    },
    {
      status: 403,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
