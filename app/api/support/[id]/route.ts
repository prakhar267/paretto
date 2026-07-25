import {
  apiError,
  apiJson,
  isOpaqueId,
  logApiError,
} from "@/app/api/_lib/api-utils";
import { getCmsDatabase } from "@/app/api/_lib/cms-database";
import { resolveRequestIdentity } from "@/app/server-auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type SupportStatusRow = {
  id: string;
  subject: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  created_at: number;
  updated_at: number;
};

export async function GET(request: Request, context: RouteContext) {
  let identity: Awaited<ReturnType<typeof resolveRequestIdentity>>;
  try {
    identity = await resolveRequestIdentity(request);
  } catch (error) {
    logApiError("support_status_identity_failed", error);
    return apiError(503, "Support status is temporarily unavailable.");
  }
  if (!identity.ok) {
    return identity.status === 401
      ? apiError(
          401,
          "Use the same browser or learner account that created this request.",
        )
      : apiError(503, "Support status is temporarily unavailable.");
  }

  const { id } = await context.params;
  if (!isOpaqueId(id)) return apiError(400, "Enter a valid support reference.");

  try {
    const row = await (await getCmsDatabase())
      .prepare(
        `SELECT id, subject, status, created_at, updated_at
         FROM support_requests
         WHERE id = ? AND user_key = ?`,
      )
      .bind(id, identity.userKey)
      .first<SupportStatusRow>();
    if (!row) {
      return apiError(
        404,
        "No request with that reference belongs to this learner session.",
      );
    }
    return apiJson({
      request: {
        id: row.id,
        subject: row.subject,
        status: row.status,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      },
    });
  } catch (error) {
    logApiError("support_status_read_failed", error);
    return apiError(503, "Support status is temporarily unavailable.");
  }
}
