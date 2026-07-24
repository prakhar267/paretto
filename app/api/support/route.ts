import { resolveRequestIdentity } from "@/app/server-auth";
import {
  apiError,
  apiJson,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import { getCmsDatabase } from "@/app/api/_lib/cms-database";
import { validateSupportCreate } from "@/app/api/_lib/content-validation";
import { verifySupportTurnstile } from "@/app/turnstile";

export const dynamic = "force-dynamic";

const MAX_REQUESTS_PER_HOUR = 5;

export async function POST(request: Request) {
  let identity: Awaited<ReturnType<typeof resolveRequestIdentity>>;
  try {
    identity = await resolveRequestIdentity(request);
  } catch (error) {
    logApiError("support_identity_failed", error);
    return apiError(503, "Support is temporarily unavailable.");
  }
  if (!identity.ok) {
    return identity.status === 401
      ? apiError(401, "A valid browser learning session is required.")
      : apiError(503, "Support is temporarily unavailable.");
  }

  const body = await readJsonBody(request, 8 * 1024);
  if (!body.ok) return body.response;
  const parsed = validateSupportCreate(body.value);
  if (!parsed.ok) return apiError(400, parsed.error);
  const challenge = await verifySupportTurnstile(
    parsed.value.turnstileToken,
    request,
  );
  if (!challenge.ok) return apiError(challenge.status, challenge.error);

  const id = crypto.randomUUID();
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  try {
    const database = await getCmsDatabase();
    const result = await database
      .prepare(
        `INSERT INTO support_requests (
          id, user_key, reply_email, category, subject, body, status,
          revision, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?
        WHERE (
          SELECT COUNT(*) FROM support_requests
          WHERE user_key = ? AND created_at >= ?
        ) < ?`,
      )
      .bind(
        id,
        identity.userKey,
        parsed.value.replyEmail,
        parsed.value.category,
        parsed.value.subject,
        parsed.value.body,
        now,
        now,
        identity.userKey,
        oneHourAgo,
        MAX_REQUESTS_PER_HOUR,
      )
      .run();

    if ((result.meta.changes ?? 0) !== 1) {
      return apiJson(
        { error: "Too many support requests. Please try again later." },
        429,
        { "retry-after": "3600" },
      );
    }
    return apiJson(
      {
        request: {
          id,
          category: parsed.value.category,
          subject: parsed.value.subject,
          status: "open",
          createdAt: new Date(now).toISOString(),
        },
      },
      201,
    );
  } catch (error) {
    logApiError("support_create_failed", error);
    return apiError(503, "Your request could not be submitted. Please retry.");
  }
}
