import { validAppleOAuthConfiguration } from "@/app/api/native/_lib/apple-oauth";
import {
  adminAuthConfiguration,
  verifyAdminSession,
} from "@/app/admin-auth";
import {
  getLearnerAuth,
  learnerAuthReadiness,
} from "@/app/learner-auth";
import { validBetterAuthRateLimitSecret } from "@/app/learner-auth-rate-limit";
import {
  scopedProgressStorageKey,
  selectProgressCacheBootIdentity,
  type ProgressCacheBootIdentity,
} from "@/app/progress-cache-identity";
import { validSupportRateLimitSecret } from "@/app/support-rate-limit";
import {
  supportOperatorEmail,
  transactionalEmailConfigured,
} from "@/app/transactional-email";
import { turnstileConfiguration } from "@/app/turnstile";
import { readLearnerSessionToken } from "@/app/web-session";
import { getDatabase } from "@/db";

type AuthFailureReason =
  | "missing_identity"
  | "invalid_identity"
  | "not_allowed"
  | "misconfigured";

export type RequestIdentityResult =
  | {
      ok: true;
      userKey: string;
      kind: "account" | "anonymous";
      accountId: string | null;
      progressStorageKey: string;
    }
  | { ok: false; status: 401 | 503; reason: AuthFailureReason };

export type AdminAuthorizationResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 503; reason: AuthFailureReason };

export type BrowserProgressCacheIdentityResult =
  | { ok: true; identity: ProgressCacheBootIdentity }
  | {
      ok: false;
      reason: "missing_identity" | "identity_unavailable";
    };

export type RuntimeConfigurationReadiness = {
  launchMode: "controlled-beta" | "public" | null;
  workersPlan: "free" | "paid" | null;
  userKeySecret: boolean;
  supportRateLimitSecret: boolean;
  learnerAuthRateLimitSecret: boolean;
  learnerAuthentication: boolean;
  learnerAuthOrigin: boolean;
  learnerParettoIdAccountCreation: boolean;
  learnerParettoIdSignIn: boolean;
  learnerRecoveryCodes: boolean;
  learnerEmailAccountCreation: boolean;
  learnerEmailVerification: boolean;
  learnerPasswordReset: boolean;
  learnerGoogleAuth: boolean;
  learnerAppleAuth: boolean;
  supportNotifications: boolean;
  adminAllowlist: boolean;
  adminAuthentication: boolean;
  turnstileSiteKey: boolean;
  turnstileSecret: boolean;
  nativeApiEnabled: boolean;
  appleClientId: boolean;
  appleServerCredentials: boolean;
  appleTokenEncryptionSecret: boolean;
  nativeSessionSecret: boolean;
};

export async function getRuntimeConfigurationReadiness(): Promise<RuntimeConfigurationReadiness> {
  const bindings = await serverBindings();
  const turnstile = turnstileConfiguration(bindings);
  const learnerAuth = await learnerAuthReadiness();
  const learnerAccountAbuseProtection = Boolean(
    turnstile?.siteKey && turnstile.secret,
  );
  return {
    launchMode:
      bindings.LAUNCH_MODE === "controlled-beta" ||
      bindings.LAUNCH_MODE === "public"
        ? bindings.LAUNCH_MODE
        : null,
    workersPlan:
      bindings.WORKERS_PLAN === "free" ||
      bindings.WORKERS_PLAN === "paid"
        ? bindings.WORKERS_PLAN
        : null,
    userKeySecret:
      typeof bindings.USER_KEY_SECRET === "string" &&
      bindings.USER_KEY_SECRET.length >= 32,
    supportRateLimitSecret:
      validSupportRateLimitSecret(bindings.SUPPORT_RATE_LIMIT_SECRET) &&
      bindings.SUPPORT_RATE_LIMIT_SECRET !== bindings.USER_KEY_SECRET,
    learnerAuthRateLimitSecret:
      validBetterAuthRateLimitSecret(bindings),
    learnerAuthentication: learnerAuth.configured,
    learnerAuthOrigin: learnerAuth.canonicalOrigin,
    learnerParettoIdAccountCreation:
      learnerAuth.parettoIdAccountCreation &&
      learnerAccountAbuseProtection,
    learnerParettoIdSignIn:
      learnerAuth.configured && learnerAccountAbuseProtection,
    learnerRecoveryCodes:
      learnerAuth.recoveryCodes && learnerAccountAbuseProtection,
    learnerEmailAccountCreation: learnerAuth.emailAccountCreation,
    learnerEmailVerification: learnerAuth.emailVerification,
    learnerPasswordReset: learnerAuth.passwordReset,
    learnerGoogleAuth: learnerAuth.google,
    learnerAppleAuth: learnerAuth.apple,
    supportNotifications:
      transactionalEmailConfigured(bindings) &&
      supportOperatorEmail(bindings) !== null,
    adminAllowlist: parseAdminAllowlist(bindings.ADMIN_EMAILS).size > 0,
    adminAuthentication: Boolean(adminAuthConfiguration(bindings)),
    turnstileSiteKey: Boolean(turnstile?.siteKey),
    turnstileSecret: Boolean(turnstile?.secret),
    nativeApiEnabled: bindings.NATIVE_API_ENABLED === "true",
    appleClientId:
      typeof bindings.APPLE_CLIENT_ID === "string" &&
      bindings.APPLE_CLIENT_ID.length >= 3,
    appleServerCredentials: validAppleOAuthConfiguration({
      clientId: bindings.APPLE_CLIENT_ID,
      teamId: bindings.APPLE_TEAM_ID,
      keyId: bindings.APPLE_KEY_ID,
      privateKey: bindings.APPLE_PRIVATE_KEY,
    }),
    appleTokenEncryptionSecret:
      typeof bindings.APPLE_TOKEN_ENCRYPTION_SECRET === "string" &&
      bindings.APPLE_TOKEN_ENCRYPTION_SECRET.length >= 32,
    nativeSessionSecret:
      typeof bindings.NATIVE_SESSION_SECRET === "string" &&
      bindings.NATIVE_SESSION_SECRET.length >= 32,
  };
}

export async function resolveRequestIdentity(
  request: Request,
): Promise<RequestIdentityResult> {
  const bindings = await serverBindings();
  const accountSession = await resolveLearnerAccountSession(request);
  if ("error" in accountSession) {
    return { ok: false, status: 503, reason: "misconfigured" };
  }
  if (accountSession.session) {
    if (
      typeof bindings.USER_KEY_SECRET !== "string" ||
      bindings.USER_KEY_SECRET.length < 32
    ) {
      return { ok: false, status: 503, reason: "misconfigured" };
    }
    const deletion = await (await getDatabase())
      .prepare(
        `SELECT user_id FROM learner_deletion_jobs
         WHERE user_id = ?`,
      )
      .bind(accountSession.session.user.id)
      .first<{ user_id: string }>();
    if (deletion) {
      return { ok: false, status: 401, reason: "invalid_identity" };
    }
    return {
      ok: true,
      userKey: await accountUserKey(
        bindings.USER_KEY_SECRET,
        accountSession.session.user.id,
      ),
      kind: "account",
      accountId: accountSession.session.user.id,
      progressStorageKey: scopedProgressStorageKey(
        "account",
        await progressCacheScope(
          bindings.USER_KEY_SECRET,
          "account",
          accountSession.session.user.id,
        ),
      ),
    };
  }

  const sessionToken = readLearnerSessionToken(request);
  if (!sessionToken) {
    return { ok: false, status: 401, reason: "missing_identity" };
  }

  if (typeof bindings.USER_KEY_SECRET === "string" && bindings.USER_KEY_SECRET.length >= 32) {
    return {
      ok: true,
      userKey: await anonymousUserKey(bindings.USER_KEY_SECRET, sessionToken),
      kind: "anonymous",
      accountId: null,
      progressStorageKey: scopedProgressStorageKey(
        "anonymous",
        await progressCacheScope(
          bindings.USER_KEY_SECRET,
          "anonymous",
          sessionToken,
        ),
      ),
    };
  }
  return { ok: false, status: 503, reason: "misconfigured" };
}

export async function resolveBrowserProgressCacheIdentity(
  request: Request,
): Promise<BrowserProgressCacheIdentityResult> {
  let bindings: Awaited<ReturnType<typeof serverBindings>>;
  try {
    bindings = await serverBindings();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "learner_cache_identity_configuration_failed",
        message: error instanceof Error ? error.message : "unknown error",
        timestamp: new Date().toISOString(),
      }),
    );
    return { ok: false, reason: "identity_unavailable" };
  }
  if (
    typeof bindings.USER_KEY_SECRET !== "string" ||
    bindings.USER_KEY_SECRET.length < 32
  ) {
    return { ok: false, reason: "identity_unavailable" };
  }

  const accountSession = await resolveLearnerAccountSession(request);
  if ("error" in accountSession) {
    return { ok: false, reason: "identity_unavailable" };
  }

  const anonymousToken = readLearnerSessionToken(request);
  if (!anonymousToken) {
    return { ok: false, reason: "missing_identity" };
  }

  const anonymousUserKeyValue = await anonymousUserKey(
    bindings.USER_KEY_SECRET,
    anonymousToken,
  );
  const anonymousScope = await progressCacheScope(
    bindings.USER_KEY_SECRET,
    "anonymous",
    anonymousToken,
  );
  const accountId = accountSession.session?.user.id ?? null;
  const accountScope = accountId
    ? await progressCacheScope(
        bindings.USER_KEY_SECRET,
        "account",
        accountId,
      )
    : null;

  let anonymousIdentityClaimed = false;
  if (accountId) {
    try {
      const deletion = await (await getDatabase())
        .prepare(
          `SELECT user_id FROM learner_deletion_jobs
           WHERE user_id = ?`,
        )
        .bind(accountId)
        .first<{ user_id: string }>();
      if (deletion) {
        return { ok: false, reason: "identity_unavailable" };
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "learner_cache_deletion_guard_failed",
          message: error instanceof Error ? error.message : "unknown error",
          timestamp: new Date().toISOString(),
        }),
      );
      return { ok: false, reason: "identity_unavailable" };
    }
  } else {
    try {
      const link = await (await getDatabase())
        .prepare(
          "SELECT account_id FROM learner_identity_links WHERE anonymous_user_key = ?",
        )
        .bind(anonymousUserKeyValue)
        .first<{ account_id: string }>();
      anonymousIdentityClaimed = Boolean(link);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "learner_cache_identity_link_check_failed",
          message: error instanceof Error ? error.message : "unknown error",
          timestamp: new Date().toISOString(),
        }),
      );
      return { ok: false, reason: "identity_unavailable" };
    }
  }

  return {
    ok: true,
    identity: selectProgressCacheBootIdentity({
      accountId,
      accountScope,
      anonymousScope,
      anonymousIdentityClaimed,
    }),
  };
}

export async function resolveLearnerAccountSession(
  request: Request,
): Promise<
  | {
      session: {
        session: { id: string; expiresAt: Date };
        user: {
          id: string;
          name: string;
          image?: string | null;
          username: string | null;
        };
      } | null;
    }
  | { error: true }
> {
  if (!hasLearnerAccountCookie(request.headers.get("cookie"))) {
    return { session: null };
  }
  try {
    const session = await (await getLearnerAuth(request)).api.getSession({
      headers: request.headers,
    });
    return { session };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "learner_session_validation_failed",
        message: error instanceof Error ? error.message : "unknown error",
        timestamp: new Date().toISOString(),
      }),
    );
    return { error: true };
  }
}

export async function anonymousUserKey(
  secret: string,
  sessionToken: string,
): Promise<string> {
  return hmacSha256(secret, `web-anon:v1:${sessionToken}`);
}

export async function accountUserKey(
  secret: string,
  accountId: string,
): Promise<string> {
  return hmacSha256(secret, `web-account:v1:${accountId}`);
}

export async function resolveLearnerClaimKeys(
  request: Request,
): Promise<
  | {
      ok: true;
      accountId: string;
      accountUserKey: string;
      anonymousUserKey: string | null;
      accountStorageKey: string;
      anonymousStorageKey: string | null;
    }
  | { ok: false; status: 401 | 503 }
> {
  const accountSession = await resolveLearnerAccountSession(request);
  if ("error" in accountSession) return { ok: false, status: 503 };
  if (!accountSession.session) return { ok: false, status: 401 };

  const bindings = await serverBindings();
  if (
    typeof bindings.USER_KEY_SECRET !== "string" ||
    bindings.USER_KEY_SECRET.length < 32
  ) {
    return { ok: false, status: 503 };
  }

  const anonymousToken = readLearnerSessionToken(request);
  const accountScope = await progressCacheScope(
    bindings.USER_KEY_SECRET,
    "account",
    accountSession.session.user.id,
  );
  return {
    ok: true,
    accountId: accountSession.session.user.id,
    accountUserKey: await accountUserKey(
      bindings.USER_KEY_SECRET,
      accountSession.session.user.id,
    ),
    anonymousUserKey: anonymousToken
      ? await anonymousUserKey(bindings.USER_KEY_SECRET, anonymousToken)
      : null,
    accountStorageKey: scopedProgressStorageKey("account", accountScope),
    anonymousStorageKey: anonymousToken
      ? scopedProgressStorageKey(
          "anonymous",
          await progressCacheScope(
            bindings.USER_KEY_SECRET,
            "anonymous",
            anonymousToken,
          ),
        )
      : null,
  };
}

export async function authorizeAdmin(
  requestHeaders: Pick<Headers, "get">,
): Promise<AdminAuthorizationResult> {
  const bindings = await serverBindings();
  const configuration = adminAuthConfiguration(bindings);
  if (!configuration) {
    return { ok: false, status: 503, reason: "misconfigured" };
  }
  const verification = await verifyAdminSession(requestHeaders, configuration);
  return verification.ok
    ? verification
    : { ok: false, status: 401, reason: "invalid_identity" };
}

export async function requireAdmin(
  request: Request,
): Promise<{ ok: true; email: string } | { ok: false; response: Response }> {
  const result = await authorizeAdmin(request.headers);
  if (result.ok) return result;

  const messages: Record<AuthFailureReason, string> = {
    missing_identity: "Sign in to access administration.",
    invalid_identity: "The signed-in identity is invalid.",
    not_allowed: "This account is not authorized for administration.",
    misconfigured: "Administration is temporarily unavailable.",
  };
  return {
    ok: false,
    response: Response.json(
      { error: messages[result.reason] },
      {
        status: result.status,
        headers: {
          "cache-control": "private, no-store, max-age=0",
          "x-content-type-options": "nosniff",
        },
      },
    ),
  };
}

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function parseAdminAllowlist(value: unknown): Set<string> {
  if (typeof value !== "string") return new Set();
  return new Set(
    value
      .split(",")
      .map((entry) => normalizeEmail(entry))
      .filter((entry): entry is string => Boolean(entry)),
  );
}

async function serverBindings(): Promise<{
  USER_KEY_SECRET?: unknown;
  SUPPORT_RATE_LIMIT_SECRET?: unknown;
  BETTER_AUTH_RATE_LIMIT_SECRET?: unknown;
  ADMIN_EMAILS?: unknown;
  ADMIN_PASSWORD_VERIFIER?: unknown;
  ADMIN_PASSWORD_VERIFIERS?: unknown;
  ADMIN_SESSION_SECRET?: unknown;
  TURNSTILE_SITE_KEY?: unknown;
  TURNSTILE_SECRET?: unknown;
  LAUNCH_MODE?: unknown;
  WORKERS_PLAN?: unknown;
  NATIVE_API_ENABLED?: unknown;
  APPLE_CLIENT_ID?: unknown;
  APPLE_TEAM_ID?: unknown;
  APPLE_KEY_ID?: unknown;
  APPLE_PRIVATE_KEY?: unknown;
  APPLE_TOKEN_ENCRYPTION_SECRET?: unknown;
  NATIVE_SESSION_SECRET?: unknown;
  BETTER_AUTH_SECRET?: unknown;
  BETTER_AUTH_URL?: unknown;
  GOOGLE_CLIENT_ID?: unknown;
  GOOGLE_CLIENT_SECRET?: unknown;
  APPLE_WEB_CLIENT_ID?: unknown;
  APPLE_WEB_CLIENT_SECRET?: unknown;
  RESEND_API_KEY?: unknown;
  AUTH_EMAIL_FROM?: unknown;
  SUPPORT_NOTIFICATION_EMAIL?: unknown;
}> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as {
    USER_KEY_SECRET?: unknown;
    SUPPORT_RATE_LIMIT_SECRET?: unknown;
    BETTER_AUTH_RATE_LIMIT_SECRET?: unknown;
    ADMIN_EMAILS?: unknown;
    ADMIN_PASSWORD_VERIFIER?: unknown;
    ADMIN_PASSWORD_VERIFIERS?: unknown;
    ADMIN_SESSION_SECRET?: unknown;
    TURNSTILE_SITE_KEY?: unknown;
    TURNSTILE_SECRET?: unknown;
    LAUNCH_MODE?: unknown;
    WORKERS_PLAN?: unknown;
    NATIVE_API_ENABLED?: unknown;
    APPLE_CLIENT_ID?: unknown;
    APPLE_TEAM_ID?: unknown;
    APPLE_KEY_ID?: unknown;
    APPLE_PRIVATE_KEY?: unknown;
    APPLE_TOKEN_ENCRYPTION_SECRET?: unknown;
    NATIVE_SESSION_SECRET?: unknown;
    BETTER_AUTH_SECRET?: unknown;
    BETTER_AUTH_URL?: unknown;
    GOOGLE_CLIENT_ID?: unknown;
    GOOGLE_CLIENT_SECRET?: unknown;
    APPLE_WEB_CLIENT_ID?: unknown;
    APPLE_WEB_CLIENT_SECRET?: unknown;
    RESEND_API_KEY?: unknown;
    AUTH_EMAIL_FROM?: unknown;
    SUPPORT_NOTIFICATION_EMAIL?: unknown;
  };
}

function hasLearnerAccountCookie(header: string | null): boolean {
  if (!header) return false;
  return header
    .split(";")
    .map((part) => part.trim().split("=", 1)[0])
    .some(
      (name) =>
        name === "paretto.session_token" ||
        name === "__Secure-paretto.session_token",
    );
}

async function hmacSha256(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(signature);
}

async function progressCacheScope(
  secret: string,
  kind: "account" | "anonymous",
  identity: string,
): Promise<string> {
  return hmacSha256(secret, `web-progress-cache:v2:${kind}:${identity}`);
}

function bytesToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
