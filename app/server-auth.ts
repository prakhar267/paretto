import { validAppleOAuthConfiguration } from "@/app/api/native/_lib/apple-oauth";
import {
  adminAuthConfiguration,
  verifyAdminSession,
} from "@/app/admin-auth";
import { turnstileConfiguration } from "@/app/turnstile";
import { readLearnerSessionToken } from "@/app/web-session";

type AuthFailureReason =
  | "missing_identity"
  | "invalid_identity"
  | "not_allowed"
  | "misconfigured";

export type RequestIdentityResult =
  | { ok: true; userKey: string }
  | { ok: false; status: 401 | 503; reason: AuthFailureReason };

export type AdminAuthorizationResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 403 | 503; reason: AuthFailureReason };

export type RuntimeConfigurationReadiness = {
  userKeySecret: boolean;
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
  return {
    userKeySecret:
      typeof bindings.USER_KEY_SECRET === "string" &&
      bindings.USER_KEY_SECRET.length >= 32,
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
  const sessionToken = readLearnerSessionToken(request);
  if (!sessionToken) {
    return { ok: false, status: 401, reason: "missing_identity" };
  }

  const bindings = await serverBindings();
  if (typeof bindings.USER_KEY_SECRET === "string" && bindings.USER_KEY_SECRET.length >= 32) {
    return {
      ok: true,
      userKey: await hmacSha256(
        bindings.USER_KEY_SECRET,
        `web-anon:v1:${sessionToken}`,
      ),
    };
  }
  return { ok: false, status: 503, reason: "misconfigured" };
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
  ADMIN_EMAILS?: unknown;
  ADMIN_PASSWORD_VERIFIER?: unknown;
  ADMIN_PASSWORD_VERIFIERS?: unknown;
  ADMIN_SESSION_SECRET?: unknown;
  TURNSTILE_SITE_KEY?: unknown;
  TURNSTILE_SECRET?: unknown;
  NATIVE_API_ENABLED?: unknown;
  APPLE_CLIENT_ID?: unknown;
  APPLE_TEAM_ID?: unknown;
  APPLE_KEY_ID?: unknown;
  APPLE_PRIVATE_KEY?: unknown;
  APPLE_TOKEN_ENCRYPTION_SECRET?: unknown;
  NATIVE_SESSION_SECRET?: unknown;
}> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as {
    USER_KEY_SECRET?: unknown;
    ADMIN_EMAILS?: unknown;
    ADMIN_PASSWORD_VERIFIER?: unknown;
    ADMIN_PASSWORD_VERIFIERS?: unknown;
    ADMIN_SESSION_SECRET?: unknown;
    TURNSTILE_SITE_KEY?: unknown;
    TURNSTILE_SECRET?: unknown;
    NATIVE_API_ENABLED?: unknown;
    APPLE_CLIENT_ID?: unknown;
    APPLE_TEAM_ID?: unknown;
    APPLE_KEY_ID?: unknown;
    APPLE_PRIVATE_KEY?: unknown;
    APPLE_TOKEN_ENCRYPTION_SECRET?: unknown;
    NATIVE_SESSION_SECRET?: unknown;
  };
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

function bytesToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
