const SUPPORT_RATE_LIMIT_DOMAIN = "paretto-support-ip-rate-limit:v1";

export const SUPPORT_IP_RATE_LIMIT_MAX_REQUESTS = 20;
export const SUPPORT_IP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;

type SupportRateLimitBindings = {
  USER_KEY_SECRET?: unknown;
  SUPPORT_RATE_LIMIT_SECRET?: unknown;
};

export async function opaqueSupportIpBucket(
  request: Request,
): Promise<string> {
  const { env } = await import("cloudflare:workers");
  const bindings = env as SupportRateLimitBindings;
  const secret = bindings.SUPPORT_RATE_LIMIT_SECRET;
  if (
    !validSupportRateLimitSecret(secret) ||
    secret === bindings.USER_KEY_SECRET
  ) {
    throw new Error("Support rate-limit protection is not configured.");
  }

  const clientIp = normalizedCloudflareClientIp(
    request.headers.get("cf-connecting-ip"),
  );
  return hmacSha256(
    secret,
    `${SUPPORT_RATE_LIMIT_DOMAIN}:${clientIp ?? "unknown"}`,
  );
}

export function validSupportRateLimitSecret(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 256 &&
    !/\s/.test(value)
  );
}

export function reserveSupportIpQuota(
  database: D1Database,
  input: {
    bucketHash: string;
    reservationId: string;
    now: number;
    userKey: string;
    userWindowStartedAt: number;
    userMaxRequests: number;
  },
): D1PreparedStatement {
  const resetBoundary = input.now - SUPPORT_IP_RATE_LIMIT_WINDOW_MS;
  return database
    .prepare(
      `INSERT INTO support_rate_limits (
         bucket_hash, window_started_at, request_count, last_reservation_id,
         updated_at
       )
       SELECT ?, ?, 1, ?, ?
       WHERE (
         SELECT COUNT(*) FROM support_requests
         WHERE user_key = ? AND created_at >= ?
       ) < ?
         AND NOT EXISTS (
           SELECT 1 FROM learner_deletion_jobs
           WHERE user_key = ?
         )
       ON CONFLICT(bucket_hash) DO UPDATE SET
         window_started_at = CASE
           WHEN support_rate_limits.window_started_at <= ?
             THEN excluded.window_started_at
           ELSE support_rate_limits.window_started_at
         END,
         request_count = CASE
           WHEN support_rate_limits.window_started_at <= ? THEN 1
           ELSE support_rate_limits.request_count + 1
         END,
         last_reservation_id = excluded.last_reservation_id,
         updated_at = excluded.updated_at
       WHERE support_rate_limits.window_started_at <= ?
          OR support_rate_limits.request_count < ?`,
    )
    .bind(
      input.bucketHash,
      input.now,
      input.reservationId,
      input.now,
      input.userKey,
      input.userWindowStartedAt,
      input.userMaxRequests,
      input.userKey,
      resetBoundary,
      resetBoundary,
      resetBoundary,
      SUPPORT_IP_RATE_LIMIT_MAX_REQUESTS,
    );
}

function normalizedCloudflareClientIp(value: string | null): string | null {
  const candidate = value?.trim().toLowerCase() ?? "";
  if (
    candidate.length < 3 ||
    candidate.length > 128 ||
    /[\u0000-\u0020\u007f]/.test(candidate)
  ) {
    return null;
  }
  return candidate;
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
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
