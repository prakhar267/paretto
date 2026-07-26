import { apiError, isRecord, logApiError } from "@/app/api/_lib/api-utils";
import {
  encryptAppleRefreshToken,
  exchangeAppleAuthorizationCode,
  revokeAppleRefreshToken,
  type AppleOAuthConfiguration,
  validAppleOAuthConfiguration,
} from "@/app/api/native/_lib/apple-oauth";
import { getDatabase } from "@/db";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;
const APPLE_KEY_CACHE_MS = 60 * 60 * 1000;
const APPLE_UNKNOWN_KEY_REFRESH_MS = 5 * 60 * 1000;

export type NativeAccountDeletionConfiguration = AppleOAuthConfiguration & {
  tokenEncryptionSecret: string;
};

type NativeSignInConfiguration = NativeAccountDeletionConfiguration & {
  sessionSecret: string;
};

type AppleClaims = {
  subject: string;
  email: string | null;
};

type NativeSessionRow = {
  account_id: string;
  learner_user_id: string | null;
  email: string | null;
  display_name: string | null;
  expires_at: number;
  created_at: number;
};

type NativeAccountScopeRow = {
  learner_user_id: string | null;
  created_at: number;
};

type AppleJwk = JsonWebKey & { kid: string; kty: "RSA" };

let appleKeyCache:
  | { fetchedAt: number; expiresAt: number; keys: Map<string, AppleJwk> }
  | undefined;

export async function exchangeAppleIdentity(
  identityToken: string,
  authorizationCode: string,
  rawNonce: string,
  displayName: string | null,
): Promise<
  | {
      ok: true;
      accessToken: string;
      expiresAt: Date;
      displayName: string | null;
      syncScope: "nativeOnly" | "unified";
      accountScope: string;
    }
  | { ok: false; response: Response }
> {
  if (!(await nativeApiEnabled())) {
    return {
      ok: false,
      response: apiError(503, "Native sign-in is not enabled."),
    };
  }
  try {
    const configuration = await nativeSignInConfiguration();
    if (!configuration) {
      return {
        ok: false,
        response: apiError(503, "Native sign-in is not configured."),
      };
    }
    const claims = await verifyAppleIdentityToken(identityToken, rawNonce, {
      clientId: configuration.clientId,
    });
    if (!claims) {
      return {
        ok: false,
        response: apiError(401, "Apple identity verification failed."),
      };
    }

    const appleExchange = await exchangeAppleAuthorizationCode(
      authorizationCode,
      configuration,
    );
    if (!appleExchange.ok) {
      return {
        ok: false,
        response:
          appleExchange.reason === "invalid_grant"
            ? apiError(401, "Apple authorization verification failed.")
            : apiError(503, "Apple sign-in is temporarily unavailable."),
      };
    }
    const exchangedClaims = await verifyAppleIdentityToken(
      appleExchange.value.identityToken,
      rawNonce,
      { clientId: configuration.clientId },
    );
    if (
      !exchangedClaims ||
      exchangedClaims.subject !== claims.subject ||
      (claims.email !== null &&
        exchangedClaims.email !== null &&
        exchangedClaims.email !== claims.email)
    ) {
      return {
        ok: false,
        response: apiError(401, "Apple authorization verification failed."),
      };
    }

    const now = Date.now();
    const accountId = await hmacHex(
      configuration.sessionSecret,
      `apple-account:${claims.subject}`,
    );
    const subjectHash = await hmacHex(
      configuration.sessionSecret,
      `apple-subject:${claims.subject}`,
    );
    const accessToken = randomToken();
    const sessionHash = await hmacHex(
      configuration.sessionSecret,
      `native-session:${accessToken}`,
    );
    const identityTokenHash = await sha256Hex(identityToken);
    const exchangeId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const learnerUserId = crypto.randomUUID();
    const learnerProviderAccountId = crypto.randomUUID();
    const expiresAt = now + SESSION_LIFETIME_MS;
    const normalizedName = normalizeDisplayName(displayName);
    const encryptedRefreshToken = await encryptAppleRefreshToken(
      appleExchange.value.refreshToken,
      configuration.tokenEncryptionSecret,
      accountId,
    );
    const database = await getDatabase();

    const results = await database.batch([
      database
        .prepare(
          `INSERT OR IGNORE INTO native_identity_token_uses (
             token_hash, exchange_id, expires_at, used_at
           ) VALUES (?, ?, ?, ?)`,
        )
        .bind(identityTokenHash, exchangeId, now + 10 * 60 * 1000, now),
      database
        .prepare(
          `INSERT INTO native_accounts (
             id, apple_subject_hash, email, display_name, created_at, updated_at
           )
           SELECT ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM native_identity_token_uses
             WHERE token_hash = ? AND exchange_id = ?
           )
             AND NOT EXISTS (
               SELECT 1 FROM learner_deletion_jobs
               WHERE native_account_id = ?
             )
           ON CONFLICT(apple_subject_hash) DO UPDATE SET
             email = COALESCE(excluded.email, native_accounts.email),
             display_name = COALESCE(excluded.display_name, native_accounts.display_name),
             updated_at = excluded.updated_at`,
        )
        .bind(
          accountId,
          subjectHash,
          claims.email,
          normalizedName,
          now,
          now,
          identityTokenHash,
          exchangeId,
          accountId,
        ),
      database
        .prepare(
          `INSERT INTO native_apple_credentials (
             account_id, refresh_token_ciphertext, updated_at
           )
           SELECT ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM native_identity_token_uses
             WHERE token_hash = ? AND exchange_id = ?
           )
             AND NOT EXISTS (
               SELECT 1 FROM learner_deletion_jobs
               WHERE native_account_id = ?
             )
           ON CONFLICT(account_id) DO UPDATE SET
             refresh_token_ciphertext = excluded.refresh_token_ciphertext,
             updated_at = excluded.updated_at`,
        )
        .bind(
          accountId,
          encryptedRefreshToken,
          now,
          identityTokenHash,
          exchangeId,
          accountId,
        ),
      database
        .prepare(
          `INSERT INTO native_sessions (
             token_hash, id, account_id, expires_at, created_at, revoked_at
           )
           SELECT ?, ?, ?, ?, ?, NULL
           WHERE EXISTS (
             SELECT 1 FROM native_identity_token_uses
             WHERE token_hash = ? AND exchange_id = ?
           )
             AND NOT EXISTS (
               SELECT 1 FROM learner_deletion_jobs
               WHERE native_account_id = ?
             )`,
        )
        .bind(
          sessionHash,
          sessionId,
          accountId,
          expiresAt,
          now,
          identityTokenHash,
          exchangeId,
          accountId,
        ),
      database
        .prepare(
          `INSERT OR IGNORE INTO learner_user (
             id, name, email, email_verified, image, created_at, updated_at
           )
           SELECT ?, ?, ?, 1, NULL, ?, ?
           WHERE ? IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM learner_account
               WHERE provider_id = 'apple' AND account_id = ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM learner_user WHERE email = ?
             )
             AND EXISTS (
               SELECT 1 FROM native_identity_token_uses
               WHERE token_hash = ? AND exchange_id = ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM learner_deletion_jobs
               WHERE native_account_id = ?
             )`,
        )
        .bind(
          learnerUserId,
          normalizedName ?? "Traveler",
          claims.email,
          now,
          now,
          claims.email,
          claims.subject,
          claims.email,
          identityTokenHash,
          exchangeId,
          accountId,
        ),
      database
        .prepare(
          `INSERT OR IGNORE INTO learner_account (
             id, account_id, provider_id, user_id,
             access_token, refresh_token, id_token,
             access_token_expires_at, refresh_token_expires_at,
             scope, password, created_at, updated_at
           )
           SELECT ?, ?, 'apple', learner_user.id,
                  NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?
           FROM learner_user
           WHERE learner_user.id = ?
             AND NOT EXISTS (
               SELECT 1 FROM learner_account
               WHERE provider_id = 'apple' AND account_id = ?
             )
             AND EXISTS (
               SELECT 1 FROM native_identity_token_uses
               WHERE token_hash = ? AND exchange_id = ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM learner_deletion_jobs
               WHERE native_account_id = ?
             )`,
        )
        .bind(
          learnerProviderAccountId,
          claims.subject,
          now,
          now,
          learnerUserId,
          claims.subject,
          identityTokenHash,
          exchangeId,
          accountId,
        ),
      database
        .prepare(
          `INSERT OR IGNORE INTO native_learner_links (
             native_account_id, learner_user_id, linked_at
           )
           SELECT ?, learner_account.user_id, ?
           FROM learner_account
           WHERE learner_account.provider_id = 'apple'
             AND learner_account.account_id = ?
             AND EXISTS (
               SELECT 1 FROM native_identity_token_uses
               WHERE token_hash = ? AND exchange_id = ?
             )
             AND NOT EXISTS (
               SELECT 1 FROM learner_deletion_jobs
               WHERE native_account_id = ?
             )`,
        )
        .bind(
          accountId,
          now,
          claims.subject,
          identityTokenHash,
          exchangeId,
          accountId,
        ),
    ]);

    if (Number(results[3]?.meta.changes ?? 0) !== 1) {
      const deletion = await database
        .prepare(
          `SELECT user_id FROM learner_deletion_jobs
           WHERE native_account_id = ?`,
        )
        .bind(accountId)
        .first<{ user_id: string }>();
      if (deletion) {
        const revocation = await revokeAppleRefreshToken(
          appleExchange.value.refreshToken,
          configuration,
        );
        if (!revocation.ok) {
          logApiError(
            "native_sign_in_during_deletion_revocation_failed",
            new Error(
              `Apple returned ${revocation.reason} while account deletion was active`,
            ),
          );
        }
        return {
          ok: false,
          response: apiError(
            409,
            "Account deletion is already in progress.",
            "ACCOUNT_DELETION_IN_PROGRESS",
          ),
        };
      }
      return {
        ok: false,
        response: apiError(401, "This Apple sign-in response was already used."),
      };
    }
    const accountScopeRow = await database
      .prepare(
        `SELECT accounts.created_at, links.learner_user_id
         FROM native_accounts AS accounts
         LEFT JOIN native_learner_links AS links
           ON links.native_account_id = accounts.id
         WHERE accounts.id = ?`,
      )
      .bind(accountId)
      .first<NativeAccountScopeRow>();
    if (!accountScopeRow) {
      throw new Error("Native account scope could not be established.");
    }

    return {
      ok: true,
      accessToken,
      expiresAt: new Date(expiresAt),
      displayName: normalizedName,
      syncScope: accountScopeRow.learner_user_id ? "unified" : "nativeOnly",
      accountScope: await nativeProgressAccountScope(
        configuration.sessionSecret,
        accountId,
        accountScopeRow.created_at,
      ),
    };
  } catch (error) {
    logApiError("native_apple_exchange_failed", error);
    return {
      ok: false,
      response: apiError(503, "Native sign-in is temporarily unavailable."),
    };
  }
}

export async function requireNativeSession(
  request: Request,
  options: { allowDisabledForDeletion?: boolean } = {},
): Promise<
  | {
      ok: true;
      accountId: string;
      email: string | null;
      displayName: string | null;
      learnerUserId: string | null;
      sessionTokenHash: string;
      accountScope: string;
    }
  | { ok: false; response: Response }
> {
  if (
    !options.allowDisabledForDeletion &&
    !(await nativeApiEnabled())
  ) {
    return {
      ok: false,
      response: apiError(503, "Native API access is not enabled."),
    };
  }
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (!match) {
    return { ok: false, response: apiError(401, "A native session is required.") };
  }
  try {
    const configuration = await nativeSessionConfiguration(
      options.allowDisabledForDeletion,
    );
    if (!configuration) {
      return {
        ok: false,
        response: apiError(503, "Native sign-in is not configured."),
      };
    }
    const tokenHash = await hmacHex(
      configuration.sessionSecret,
      `native-session:${match[1]}`,
    );
    const row = await (await getDatabase())
      .prepare(
        `SELECT sessions.account_id, sessions.expires_at,
                accounts.email, accounts.display_name,
                accounts.created_at, links.learner_user_id
         FROM native_sessions AS sessions
         INNER JOIN native_accounts AS accounts ON accounts.id = sessions.account_id
         LEFT JOIN native_learner_links AS links
           ON links.native_account_id = sessions.account_id
         WHERE sessions.token_hash = ?
           AND sessions.revoked_at IS NULL
           AND sessions.expires_at > ?
           AND NOT EXISTS (
             SELECT 1 FROM learner_deletion_jobs AS deletion
             WHERE (
                 deletion.native_account_id = sessions.account_id OR
                 deletion.user_id = links.learner_user_id
               )
           )`,
      )
      .bind(tokenHash, Date.now())
      .first<NativeSessionRow>();
    if (!row) {
      return { ok: false, response: apiError(401, "The native session has expired.") };
    }
    return {
      ok: true,
      accountId: row.account_id,
      email: row.email,
      displayName: row.display_name,
      learnerUserId: row.learner_user_id ?? null,
      sessionTokenHash: tokenHash,
      accountScope: await nativeProgressAccountScope(
        configuration.sessionSecret,
        row.account_id,
        row.created_at,
      ),
    };
  } catch (error) {
    logApiError("native_session_lookup_failed", error);
    return {
      ok: false,
      response: apiError(503, "Native authentication is temporarily unavailable."),
    };
  }
}

export async function verifyAppleIdentityToken(
  identityToken: string,
  rawNonce: string,
  options: {
    clientId: string;
    now?: number;
    fetcher?: typeof fetch;
  },
): Promise<AppleClaims | null> {
  if (
    identityToken.length < 64 ||
    identityToken.length > 16_384 ||
    !/^[A-Za-z0-9_-]{20,128}$/.test(rawNonce)
  ) {
    return null;
  }
  const parts = identityToken.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;

  const header = decodeJwtObject(parts[0]);
  const payload = decodeJwtObject(parts[1]);
  if (
    !header ||
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    header.kid.length > 128 ||
    !payload
  ) {
    return null;
  }

  const key = await appleVerificationKey(
    header.kid,
    options.fetcher ?? fetch,
    options.now ?? Date.now(),
  );
  if (!key) return null;
  const verified = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    arrayBufferCopy(decodeBase64Url(parts[2])),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) return null;

  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  const audience = payload.aud;
  const audienceMatches =
    audience === options.clientId ||
    (Array.isArray(audience) && audience.includes(options.clientId));
  if (
    payload.iss !== APPLE_ISSUER ||
    !audienceMatches ||
    typeof payload.sub !== "string" ||
    payload.sub.length < 1 ||
    payload.sub.length > 255 ||
    typeof payload.exp !== "number" ||
    !Number.isInteger(payload.exp) ||
    payload.exp < nowSeconds - CLOCK_SKEW_SECONDS ||
    typeof payload.iat !== "number" ||
    !Number.isInteger(payload.iat) ||
    payload.iat > nowSeconds + CLOCK_SKEW_SECONDS
  ) {
    return null;
  }

  const expectedNonce = await sha256Base64Url(rawNonce);
  if (payload.nonce !== expectedNonce) return null;

  const email = normalizeEmail(payload.email);
  if (
    payload.email !== undefined &&
    (!email || (payload.email_verified !== true && payload.email_verified !== "true"))
  ) {
    return null;
  }
  return { subject: payload.sub, email };
}

async function appleVerificationKey(
  kid: string,
  fetcher: typeof fetch,
  now: number,
): Promise<CryptoKey | null> {
  if (!appleKeyCache || appleKeyCache.expiresAt <= now) {
    appleKeyCache = await loadAppleVerificationKeys(fetcher, now);
  } else if (
    !appleKeyCache.keys.has(kid) &&
    now - appleKeyCache.fetchedAt >= APPLE_UNKNOWN_KEY_REFRESH_MS
  ) {
    // Apple can introduce a signing key before the normal cache expires. A
    // bounded early refresh avoids a sign-in outage without allowing arbitrary
    // `kid` values to turn this endpoint into an unbounded JWKS fetcher.
    appleKeyCache = await loadAppleVerificationKeys(fetcher, now);
  }
  const jwk = appleKeyCache.keys.get(kid);
  if (!jwk) return null;
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function loadAppleVerificationKeys(
  fetcher: typeof fetch,
  now: number,
): Promise<{ fetchedAt: number; expiresAt: number; keys: Map<string, AppleJwk> }> {
  const response = await fetcher(APPLE_JWKS_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Apple signing keys are unavailable");
  const value: unknown = await response.json();
  if (!isRecord(value) || !Array.isArray(value.keys) || value.keys.length > 20) {
    throw new Error("Apple signing keys are malformed");
  }
  const keys = new Map<string, AppleJwk>();
  for (const candidate of value.keys) {
    if (
      isRecord(candidate) &&
      candidate.kty === "RSA" &&
      candidate.use === "sig" &&
      typeof candidate.kid === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(candidate.kid) &&
      candidate.alg === "RS256" &&
      typeof candidate.n === "string" &&
      candidate.n.length >= 128 &&
      candidate.n.length <= 2_048 &&
      typeof candidate.e === "string" &&
      candidate.e.length >= 1 &&
      candidate.e.length <= 16
    ) {
      keys.set(candidate.kid, candidate as unknown as AppleJwk);
    }
  }
  if (keys.size === 0) throw new Error("Apple signing keys are empty");
  return { fetchedAt: now, expiresAt: now + APPLE_KEY_CACHE_MS, keys };
}

export async function nativeAccountDeletionConfiguration(): Promise<
  NativeAccountDeletionConfiguration | null
> {
  const { env } = await import("cloudflare:workers");
  const bindings = env as unknown as {
    APPLE_CLIENT_ID?: unknown;
    APPLE_TEAM_ID?: unknown;
    APPLE_KEY_ID?: unknown;
    APPLE_PRIVATE_KEY?: unknown;
    APPLE_TOKEN_ENCRYPTION_SECRET?: unknown;
  };
  const apple = {
    clientId: bindings.APPLE_CLIENT_ID,
    teamId: bindings.APPLE_TEAM_ID,
    keyId: bindings.APPLE_KEY_ID,
    privateKey: bindings.APPLE_PRIVATE_KEY,
  };
  return validAppleOAuthConfiguration(apple) &&
    typeof bindings.APPLE_TOKEN_ENCRYPTION_SECRET === "string" &&
    bindings.APPLE_TOKEN_ENCRYPTION_SECRET.length >= 32
    ? {
        ...apple,
        tokenEncryptionSecret: bindings.APPLE_TOKEN_ENCRYPTION_SECRET,
      }
    : null;
}

async function nativeSignInConfiguration(): Promise<NativeSignInConfiguration | null> {
  const deletion = await nativeAccountDeletionConfiguration();
  if (!deletion) return null;
  const { env } = await import("cloudflare:workers");
  const sessionSecret = (
    env as unknown as { NATIVE_SESSION_SECRET?: unknown }
  ).NATIVE_SESSION_SECRET;
  return typeof sessionSecret === "string" && sessionSecret.length >= 32
    ? { ...deletion, sessionSecret }
    : null;
}

async function nativeSessionConfiguration(
  allowDisabled = false,
): Promise<{
  sessionSecret: string;
} | null> {
  const { env } = await import("cloudflare:workers");
  const bindings = env as unknown as {
    NATIVE_API_ENABLED?: unknown;
    NATIVE_SESSION_SECRET?: unknown;
  };
  return (allowDisabled || bindings.NATIVE_API_ENABLED === "true") &&
    typeof bindings.NATIVE_SESSION_SECRET === "string" &&
    bindings.NATIVE_SESSION_SECRET.length >= 32
    ? { sessionSecret: bindings.NATIVE_SESSION_SECRET }
    : null;
}

export async function nativeApiEnabled(): Promise<boolean> {
  const { env } = await import("cloudflare:workers");
  return (env as unknown as { NATIVE_API_ENABLED?: unknown })
    .NATIVE_API_ENABLED === "true";
}

function decodeJwtObject(value: string): Record<string, unknown> | null {
  try {
    const bytes = decodeBase64Url(value);
    if (bytes.byteLength > 8 * 1024) return null;
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function arrayBufferCopy(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

async function nativeProgressAccountScope(
  sessionSecret: string,
  accountId: string,
  createdAt: number,
): Promise<string> {
  if (
    accountId.length < 1 ||
    accountId.length > 255 ||
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0
  ) {
    throw new Error("Native account scope source is invalid.");
  }
  // `accountId` identifies the Apple subject while `createdAt` identifies this
  // particular account incarnation. Deleting and recreating the same Apple
  // account therefore produces a different opaque local-storage scope.
  return hmacHex(
    sessionSecret,
    `native-progress-scope:v1:${accountId}:${createdAt}`,
  );
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return hex(new Uint8Array(signature));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function normalizeDisplayName(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= 1 && normalized.length <= 80 ? normalized : null;
}
