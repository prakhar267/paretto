import {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  hmacAdminLoginIp,
  loadAdminAuthConfiguration,
  verifyAdminCredentials,
} from "@/app/admin-auth";
import {
  apiError,
  apiJson,
  isRecord,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import { rejectUnsafeCrossOriginWebApiRequest } from "@/app/web-session";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_LIMIT = 100;

type LoginAttemptRow = {
  failed_attempts: number;
  window_started_at: number;
  blocked_until: number | null;
};

export async function POST(request: Request) {
  const rejected = rejectUnsafeCrossOriginWebApiRequest(request);
  if (rejected) return rejected;

  const configuration = await loadAdminAuthConfiguration();
  if (!configuration) {
    return apiError(503, "Administration is not configured.");
  }

  const body = await readJsonBody(request, 4 * 1024);
  if (
    !body.ok ||
    !isRecord(body.value) ||
    Object.keys(body.value).some(
      (key) => key !== "email" && key !== "password",
    ) ||
    typeof body.value.email !== "string" ||
    body.value.email.length > 254 ||
    typeof body.value.password !== "string" ||
    body.value.password.length > 256
  ) {
    return body.ok
      ? apiError(400, "Email and password are required.")
      : body.response;
  }

  const now = Date.now();
  const ipAddress = normalizedClientIp(
    request.headers.get("cf-connecting-ip"),
  );
  const ipHash = await hmacAdminLoginIp(
    configuration.sessionSecret,
    ipAddress,
  );

  try {
    const database = await getDatabase();
    const existing = await database
      .prepare(
        `SELECT failed_attempts, window_started_at, blocked_until
         FROM admin_login_attempts WHERE ip_hash = ?`,
      )
      .bind(ipHash)
      .first<LoginAttemptRow>();
    if (existing?.blocked_until && existing.blocked_until > now) {
      return rateLimited(existing.blocked_until - now);
    }

    const authentication = await verifyAdminCredentials(
      body.value.email,
      body.value.password,
      configuration,
    );
    if (authentication.ok) {
      await database.batch([
        database
          .prepare("DELETE FROM admin_login_attempts WHERE ip_hash = ?")
          .bind(ipHash),
        cleanupStatement(database, now),
      ]);
      return apiJson(
        { authenticated: true, email: authentication.email },
        200,
        {
          "set-cookie": await createAdminSessionCookie(
            configuration,
            authentication.email,
            now,
          ),
        },
      );
    }

    const cutoff = now - LOGIN_WINDOW_MS;
    await database.batch([
      database
        .prepare(
          `INSERT INTO admin_login_attempts (
             ip_hash, window_started_at, failed_attempts, blocked_until, updated_at
           ) VALUES (?, ?, 1, NULL, ?)
           ON CONFLICT(ip_hash) DO UPDATE SET
             window_started_at = CASE
               WHEN admin_login_attempts.window_started_at < ?
                 THEN excluded.window_started_at
               ELSE admin_login_attempts.window_started_at
             END,
             failed_attempts = CASE
               WHEN admin_login_attempts.window_started_at < ? THEN 1
               ELSE admin_login_attempts.failed_attempts + 1
             END,
             blocked_until = CASE
               WHEN admin_login_attempts.window_started_at < ? THEN NULL
               WHEN admin_login_attempts.failed_attempts + 1 >= ? THEN ?
               ELSE admin_login_attempts.blocked_until
             END,
             updated_at = excluded.updated_at`,
        )
        .bind(
          ipHash,
          now,
          now,
          cutoff,
          cutoff,
          cutoff,
          MAX_FAILED_ATTEMPTS,
          now + LOGIN_BLOCK_MS,
        ),
      cleanupStatement(database, now),
    ]);
    const updated = await database
      .prepare(
        `SELECT failed_attempts, window_started_at, blocked_until
         FROM admin_login_attempts WHERE ip_hash = ?`,
      )
      .bind(ipHash)
      .first<LoginAttemptRow>();
    return updated?.blocked_until && updated.blocked_until > now
      ? rateLimited(updated.blocked_until - now)
      : apiError(401, "The email or password is incorrect.");
  } catch (error) {
    logApiError("admin_login_failed", error);
    return apiError(503, "Administration is temporarily unavailable.");
  }
}

export function DELETE(request: Request) {
  const rejected = rejectUnsafeCrossOriginWebApiRequest(request);
  if (rejected) return rejected;
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "set-cookie": clearAdminSessionCookie(),
      "x-content-type-options": "nosniff",
    },
  });
}

function cleanupStatement(database: D1Database, now: number) {
  return database
    .prepare(
      `DELETE FROM admin_login_attempts WHERE ip_hash IN (
         SELECT ip_hash FROM admin_login_attempts
         WHERE updated_at < ?
         ORDER BY updated_at ASC
         LIMIT ?
       )`,
    )
    .bind(now - ATTEMPT_RETENTION_MS, CLEANUP_BATCH_LIMIT);
}

function normalizedClientIp(value: string | null): string {
  const candidate = value?.trim() ?? "";
  return candidate.length >= 3 && candidate.length <= 128
    ? candidate
    : "unavailable";
}

function rateLimited(remainingMs: number): Response {
  return apiJson(
    { error: "Too many sign-in attempts. Try again later." },
    429,
    {
      "retry-after": String(
        Math.max(1, Math.ceil(remainingMs / 1000)),
      ),
    },
  );
}
