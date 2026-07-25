import type { BetterAuthRateLimitOptions } from "better-auth";

type BetterAuthRateLimitStorage = NonNullable<
  BetterAuthRateLimitOptions["customStorage"]
>;

const BETTER_AUTH_RATE_LIMIT_DOMAIN =
  "paretto-better-auth-rate-limit:v1";

export const BETTER_AUTH_RATE_LIMIT_RETENTION_MS =
  24 * 60 * 60 * 1_000;

type BetterAuthRateLimitBindings = {
  BETTER_AUTH_RATE_LIMIT_SECRET?: unknown;
  USER_KEY_SECRET?: unknown;
  SUPPORT_RATE_LIMIT_SECRET?: unknown;
  BETTER_AUTH_SECRET?: unknown;
  ADMIN_SESSION_SECRET?: unknown;
};

type BetterAuthRateLimitRow = {
  request_count: number;
  last_request_at: number;
};

export function validBetterAuthRateLimitSecret(
  bindings: BetterAuthRateLimitBindings,
): boolean {
  const secret = normalizedSecret(
    bindings.BETTER_AUTH_RATE_LIMIT_SECRET,
  );
  if (!secret || secret.length < 32) return false;
  return [
    bindings.USER_KEY_SECRET,
    bindings.SUPPORT_RATE_LIMIT_SECRET,
    bindings.BETTER_AUTH_SECRET,
    bindings.ADMIN_SESSION_SECRET,
  ].every((other) => {
    const normalized = normalizedSecret(other);
    return !normalized || normalized !== secret;
  });
}

export function requiredBetterAuthRateLimitSecret(
  bindings: BetterAuthRateLimitBindings,
): string {
  if (validBetterAuthRateLimitSecret(bindings)) {
    return normalizedSecret(
      bindings.BETTER_AUTH_RATE_LIMIT_SECRET,
    )!;
  }
  if (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test"
  ) {
    return "local-only-paretto-better-auth-rate-limit-never-deploy";
  }
  throw new Error(
    "BETTER_AUTH_RATE_LIMIT_SECRET is not configured independently.",
  );
}

/**
 * Better Auth derives an ephemeral key from the client IP and auth path. This
 * adapter HMACs that key before every database operation, so raw IPs, paths,
 * and submitted identifiers never enter the limiter table. `consume` performs
 * enforcement as one conditional D1 write; concurrent requests cannot all
 * pass a stale read.
 */
export function createBetterAuthRateLimitStorage(
  database: D1Database,
  secret: string,
  now: () => number = Date.now,
): BetterAuthRateLimitStorage {
  if (secret.length < 32) {
    throw new Error(
      "Better Auth rate-limit storage requires a 32-character secret.",
    );
  }

  const consume: NonNullable<
    BetterAuthRateLimitStorage["consume"]
  > = async (key, rule) => {
    validateRule(rule);
    const bucketHash = await betterAuthRateLimitBucket(secret, key);
    const timestamp = now();
    const resetBoundary = timestamp - rule.window * 1_000;
    const consumed = await database
      .prepare(
        `INSERT INTO learner_auth_rate_limits (
           bucket_hash, request_count, last_request_at, updated_at
         ) VALUES (?, 1, ?, ?)
         ON CONFLICT(bucket_hash) DO UPDATE SET
           request_count = CASE
             WHEN learner_auth_rate_limits.last_request_at < ? THEN 1
             ELSE learner_auth_rate_limits.request_count + 1
           END,
           last_request_at = excluded.last_request_at,
           updated_at = excluded.updated_at
         WHERE learner_auth_rate_limits.last_request_at < ?
            OR learner_auth_rate_limits.request_count < ?
         RETURNING request_count, last_request_at`,
      )
      .bind(
        bucketHash,
        timestamp,
        timestamp,
        resetBoundary,
        resetBoundary,
        rule.max,
      )
      .first<BetterAuthRateLimitRow>();

    if (consumed) {
      return { allowed: true, retryAfter: null };
    }

    const current = await database
      .prepare(
        `SELECT request_count, last_request_at
         FROM learner_auth_rate_limits
         WHERE bucket_hash = ?`,
      )
      .bind(bucketHash)
      .first<BetterAuthRateLimitRow>();
    if (!current) {
      // The row can disappear only through maintenance racing this denied
      // read. Retry the atomic reservation against the now-empty bucket.
      return consume(key, rule);
    }
    return {
      allowed: false,
      retryAfter: Math.max(
        1,
        Math.ceil(
          (Number(current.last_request_at) +
            rule.window * 1_000 -
            timestamp) /
            1_000,
        ),
      ),
    };
  };

  return {
    async get(key) {
      const bucketHash = await betterAuthRateLimitBucket(secret, key);
      const row = await database
        .prepare(
          `SELECT request_count, last_request_at
           FROM learner_auth_rate_limits
           WHERE bucket_hash = ?`,
        )
        .bind(bucketHash)
        .first<BetterAuthRateLimitRow>();
      if (!row) return null;
      return {
        key,
        count: Number(row.request_count),
        lastRequest: Number(row.last_request_at),
      };
    },
    async set(key, value) {
      const bucketHash = await betterAuthRateLimitBucket(secret, key);
      const timestamp = now();
      await database
        .prepare(
          `INSERT INTO learner_auth_rate_limits (
             bucket_hash, request_count, last_request_at, updated_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(bucket_hash) DO UPDATE SET
             request_count = excluded.request_count,
             last_request_at = excluded.last_request_at,
             updated_at = excluded.updated_at`,
        )
        .bind(
          bucketHash,
          Math.max(1, Math.trunc(value.count)),
          Math.trunc(value.lastRequest),
          timestamp,
        )
        .run();
    },
    consume,
  };
}

async function betterAuthRateLimitBucket(
  secret: string,
  opaqueBetterAuthKey: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(
      `${BETTER_AUTH_RATE_LIMIT_DOMAIN}:${opaqueBetterAuthKey}`,
    ),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validateRule(rule: { window: number; max: number }) {
  if (
    !Number.isInteger(rule.window) ||
    rule.window < 1 ||
    !Number.isInteger(rule.max) ||
    rule.max < 1
  ) {
    throw new Error("Better Auth supplied an invalid rate-limit rule.");
  }
}

function normalizedSecret(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 256 ||
    /\s/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}
