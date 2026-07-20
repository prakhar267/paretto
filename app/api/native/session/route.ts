import { apiError, logApiError } from "@/app/api/_lib/api-utils";
import { requireNativeSession } from "@/app/api/native/_lib/native-auth";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const session = await requireNativeSession(request);
  if (!session.ok) return session.response;

  try {
    await (await getDatabase())
      .prepare(
        `UPDATE native_sessions
         SET revoked_at = ?
         WHERE token_hash = ? AND account_id = ? AND revoked_at IS NULL`,
      )
      .bind(Date.now(), session.sessionTokenHash, session.accountId)
      .run();
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logApiError("native_session_revoke_failed", error);
    return apiError(503, "The native session could not be revoked.");
  }
}
