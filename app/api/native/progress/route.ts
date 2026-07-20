import {
  apiError,
  apiJson,
  isRecord,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import { requireNativeSession } from "@/app/api/native/_lib/native-auth";
import {
  initialNativeLearningState,
  validateNativeLearningState,
} from "@/app/api/native/_lib/native-progress";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

type NativeProgressRow = {
  revision: number;
  payload: string;
  updated_at: number;
};

export async function GET(request: Request) {
  const session = await requireNativeSession(request);
  if (!session.ok) return session.response;
  try {
    const row = await (await getDatabase())
      .prepare(
        "SELECT revision, payload, updated_at FROM native_learning_state WHERE account_id = ?",
      )
      .bind(session.accountId)
      .first<NativeProgressRow>();
    if (!row) {
      return apiJson({
        state: initialNativeLearningState(),
        revision: 0,
        savedAt: null,
      });
    }
    const state: unknown = JSON.parse(row.payload);
    if (!validateNativeLearningState(state)) {
      throw new Error("Stored native progress failed validation");
    }
    return apiJson({
      state,
      revision: row.revision,
      savedAt: new Date(row.updated_at).toISOString(),
    });
  } catch (error) {
    logApiError("native_progress_read_failed", error);
    return apiError(503, "Native progress is temporarily unavailable.");
  }
}
export async function PUT(request: Request) {
  const session = await requireNativeSession(request);
  if (!session.ok) return session.response;
  const body = await readJsonBody(request, 300 * 1024);
  if (!body.ok) return body.response;
  if (
    !isRecord(body.value) ||
    Object.keys(body.value).some((key) => key !== "state" && key !== "revision") ||
    !Number.isInteger(body.value.revision) ||
    Number(body.value.revision) < 0 ||
    !validateNativeLearningState(body.value.state)
  ) {
    return apiError(400, "A compatible native progress state and revision are required.");
  }
  const payload = JSON.stringify(body.value.state);
  if (payload.length > 250 * 1024) {
    return apiError(413, "Native progress is too large.");
  }
  const revision = Number(body.value.revision);
  const now = Date.now();
  try {
    const database = await getDatabase();
    const result =
      revision === 0
        ? await database
            .prepare(
              `INSERT OR IGNORE INTO native_learning_state (
                 account_id, revision, payload, updated_at
               ) VALUES (?, 1, ?, ?)`,
            )
            .bind(session.accountId, payload, now)
            .run()
        : await database
            .prepare(
              `UPDATE native_learning_state
               SET revision = revision + 1, payload = ?, updated_at = ?
               WHERE account_id = ? AND revision = ?`,
            )
            .bind(payload, now, session.accountId, revision)
            .run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      return apiError(409, "Native progress changed on another device.", "REVISION_CONFLICT");
    }
    return apiJson({
      state: body.value.state,
      revision: revision + 1,
      savedAt: new Date(now).toISOString(),
    });
  } catch (error) {
    logApiError("native_progress_write_failed", error);
    return apiError(503, "Native progress could not be saved.");
  }
}
