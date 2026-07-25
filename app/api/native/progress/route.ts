import {
  apiError,
  apiJson,
  isRecord,
  logApiError,
  readJsonBody,
} from "@/app/api/_lib/api-utils";
import { requireNativeSession } from "@/app/api/native/_lib/native-auth";
import {
  linkedLearnerUserKey,
  mergeNativeStateIntoWeb,
  nativeStateAsWeb,
  webStateAsNative,
} from "@/app/api/native/_lib/native-account-bridge";
import {
  initialNativeLearningState,
  validateNativeLearningState,
} from "@/app/api/native/_lib/native-progress";
import {
  createInitialState,
  stateFromPersistedUnknown,
  stateFromUnknown,
} from "@/app/learning-engine";
import {
  hasCanonicalProgress,
  readCanonicalProgressSnapshot,
} from "@/app/progress-generation";
import { getDatabase } from "@/db";

export const dynamic = "force-dynamic";

type NativeProgressRow = {
  revision: number;
  reset_generation: number;
  payload: string;
  updated_at: number;
};

export async function GET(request: Request) {
  const session = await requireNativeSession(request);
  if (!session.ok) return session.response;
  try {
    const database = await getDatabase();
    if (session.learnerUserId) {
      const userKey = await linkedLearnerUserKey(session.learnerUserId);
      if (!userKey) {
        return apiError(503, "Shared account progress is not configured.");
      }
      const progress = await loadLinkedProgress(
        database,
        session.accountId,
        userKey,
      );
      return apiJson({
        state: webStateAsNative(progress.state, progress.nativeProjection),
        revision: progress.revision,
        generation: progress.generation,
        accountScope: session.accountScope,
        savedAt:
          progress.updatedAt === null
            ? null
            : new Date(progress.updatedAt).toISOString(),
      });
    }

    const row = await database
      .prepare(
        `SELECT revision, reset_generation, payload, updated_at
         FROM native_learning_state WHERE account_id = ?`,
      )
      .bind(session.accountId)
      .first<NativeProgressRow>();
    if (!row) {
      return apiJson({
        state: initialNativeLearningState(),
        revision: 0,
        generation: 0,
        accountScope: session.accountScope,
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
      generation: row.reset_generation,
      accountScope: session.accountScope,
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
    Object.keys(body.value).some(
      (key) =>
        key !== "state" && key !== "revision" && key !== "generation",
    ) ||
    !Number.isInteger(body.value.revision) ||
    Number(body.value.revision) < 0 ||
    (body.value.generation !== undefined &&
      (!Number.isSafeInteger(body.value.generation) ||
        Number(body.value.generation) < 0)) ||
    !validateNativeLearningState(body.value.state) ||
    !isRecord(body.value.state.rewardJournal)
  ) {
    return apiError(400, "A compatible native progress state and revision are required.");
  }
  const payload = JSON.stringify(body.value.state);
  if (payload.length > 250 * 1024) {
    return apiError(413, "Native progress is too large.");
  }
  const revision = Number(body.value.revision);
  // Pre-generation native builds implicitly belong to generation zero. They
  // remain compatible until a reset, after which the atomic guard rejects
  // them and forces a fresh GET before any write can succeed.
  const generation =
    body.value.generation === undefined ? 0 : Number(body.value.generation);
  const now = Date.now();
  try {
    const database = await getDatabase();
    if (session.learnerUserId) {
      const userKey = await linkedLearnerUserKey(session.learnerUserId);
      if (!userKey) {
        return apiError(503, "Shared account progress is not configured.");
      }
      const current = await loadLinkedProgress(
        database,
        session.accountId,
        userKey,
      );
      if (generation !== current.generation) {
        return generationConflict(current.generation);
      }
      if (revision !== current.revision) {
        return apiError(
          409,
          "Native progress changed on another device.",
          "REVISION_CONFLICT",
        );
      }
      const merged = mergeNativeStateIntoWeb(current.state, body.value.state);
      const canonicalPayload = JSON.stringify(merged);
      if (canonicalPayload.length > 250 * 1024) {
        return apiError(413, "Native progress is too large.");
      }
      const result =
        revision === 0
          ? await database
              .prepare(
                `INSERT OR IGNORE INTO learning_state (
                   user_key, revision, payload, updated_at
                 )
                 SELECT ?, 1, ?, ?
                 WHERE NOT EXISTS (
                   SELECT 1 FROM learner_deletion_jobs
                   WHERE user_key = ?
                 )
                   AND COALESCE((
                     SELECT generation FROM learner_progress_generations
                     WHERE user_key = ?
                   ), 0) = ?`,
              )
              .bind(
                userKey,
                canonicalPayload,
                now,
                userKey,
                userKey,
                generation,
              )
              .run()
          : await database
              .prepare(
                `UPDATE learning_state
                 SET revision = revision + 1, payload = ?, updated_at = ?
                 WHERE user_key = ? AND revision = ?
                   AND NOT EXISTS (
                     SELECT 1 FROM learner_deletion_jobs
                     WHERE user_key = ?
                   )
                   AND COALESCE((
                     SELECT generation FROM learner_progress_generations
                     WHERE user_key = ?
                   ), 0) = ?`,
              )
              .bind(
                canonicalPayload,
                now,
                userKey,
                revision,
                userKey,
                userKey,
                generation,
              )
              .run();
      if (Number(result.meta.changes ?? 0) !== 1) {
        const fresh = await readCanonicalProgressSnapshot(database, userKey);
        return fresh.generation === generation
          ? apiError(
              409,
              "Native progress changed on another device.",
              "REVISION_CONFLICT",
            )
          : generationConflict(fresh.generation);
      }
      return apiJson({
        state: webStateAsNative(merged, body.value.state),
        revision: revision + 1,
        generation,
        accountScope: session.accountScope,
        savedAt: new Date(now).toISOString(),
      });
    }

    if (generation !== 0) return generationConflict(0);
    const result =
      revision === 0
        ? await database
            .prepare(
              `INSERT OR IGNORE INTO native_learning_state (
                 account_id, revision, reset_generation, payload, updated_at
               )
               SELECT ?, 1, 0, ?, ?
               WHERE NOT EXISTS (
                 SELECT 1 FROM learner_deletion_jobs
                 WHERE native_account_id = ?
               )`,
              )
            .bind(
              session.accountId,
              payload,
              now,
              session.accountId,
            )
            .run()
        : await database
            .prepare(
              `UPDATE native_learning_state
               SET revision = revision + 1, payload = ?, updated_at = ?
               WHERE account_id = ? AND revision = ?
                 AND reset_generation = ?
                 AND NOT EXISTS (
                   SELECT 1 FROM learner_deletion_jobs
                   WHERE native_account_id = ?
                 )`,
            )
            .bind(
              payload,
              now,
              session.accountId,
              revision,
              generation,
              session.accountId,
            )
            .run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      return apiError(409, "Native progress changed on another device.", "REVISION_CONFLICT");
    }
    return apiJson({
      state: body.value.state,
      revision: revision + 1,
      generation,
      accountScope: session.accountScope,
      savedAt: new Date(now).toISOString(),
    });
  } catch (error) {
    logApiError("native_progress_write_failed", error);
    return apiError(503, "Native progress could not be saved.");
  }
}

type LinkedProgress = {
  state: ReturnType<typeof stateFromUnknown>;
  revision: number;
  generation: number;
  updatedAt: number | null;
  nativeProjection?: unknown;
};

/**
 * Move a pre-link native snapshot into the canonical learner row exactly
 * once. Both statements run in one D1 batch, and the legacy row is deleted
 * only when the just-written canonical revision and payload are observable.
 * A concurrent web save causes a bounded retry rather than data loss.
 */
async function loadLinkedProgress(
  database: D1Database,
  nativeAccountId: string,
  userKey: string,
): Promise<LinkedProgress> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [canonical, native] = await Promise.all([
      readCanonicalProgressSnapshot(database, userKey),
      database
        .prepare(
          `SELECT revision, reset_generation, payload, updated_at
           FROM native_learning_state WHERE account_id = ?`,
        )
        .bind(nativeAccountId)
        .first<NativeProgressRow>(),
    ]);

    if (!native) {
      if (!hasCanonicalProgress(canonical)) {
        return {
          state: createInitialState(),
          revision: 0,
          generation: canonical.generation,
          updatedAt: null,
        };
      }
      return {
        state: parseCanonical(canonical.payload),
        revision: canonical.revision,
        generation: canonical.generation,
        updatedAt: canonical.updated_at,
      };
    }

    const nativeState: unknown = JSON.parse(native.payload);
    if (!validateNativeLearningState(nativeState)) {
      throw new Error("Stored native progress failed validation");
    }
    if (native.reset_generation !== canonical.generation) {
      const discarded = await database
        .prepare(
          `DELETE FROM native_learning_state
           WHERE account_id = ? AND revision = ? AND payload = ?
             AND reset_generation = ?
             AND NOT EXISTS (
               SELECT 1 FROM learner_deletion_jobs
               WHERE native_account_id = ?
             )`,
        )
        .bind(
          nativeAccountId,
          native.revision,
          native.payload,
          native.reset_generation,
          nativeAccountId,
        )
        .run();
      if (Number(discarded.meta.changes ?? 0) !== 1) continue;
      return {
        state: hasCanonicalProgress(canonical)
          ? parseCanonical(canonical.payload)
          : createInitialState(),
        revision: canonical.revision ?? 0,
        generation: canonical.generation,
        updatedAt: canonical.updated_at,
      };
    }
    const canonicalState = hasCanonicalProgress(canonical)
      ? parseCanonical(canonical.payload)
      : null;
    const merged = canonicalState
      ? mergeNativeStateIntoWeb(canonicalState, nativeState)
      : nativeStateAsWeb(nativeState);
    const mergedPayload = JSON.stringify(merged);
    const nextRevision =
      Math.max(canonical.revision ?? 0, native.revision) + 1;
    const updatedAt = Date.now();
    const write = hasCanonicalProgress(canonical)
      ? database
          .prepare(
            `UPDATE learning_state
             SET revision = ?, payload = ?, updated_at = ?
             WHERE user_key = ? AND revision = ?
               AND NOT EXISTS (
                 SELECT 1 FROM learner_deletion_jobs
                 WHERE user_key = ?
               )
               AND COALESCE((
                 SELECT generation FROM learner_progress_generations
                 WHERE user_key = ?
               ), 0) = ?`,
          )
          .bind(
            nextRevision,
            mergedPayload,
            updatedAt,
            userKey,
            canonical.revision,
            userKey,
            userKey,
            canonical.generation,
          )
      : database
          .prepare(
            `INSERT OR IGNORE INTO learning_state (
               user_key, revision, payload, updated_at
             )
             SELECT ?, ?, ?, ?
             WHERE NOT EXISTS (
               SELECT 1 FROM learner_deletion_jobs
               WHERE user_key = ?
             )
               AND COALESCE((
                 SELECT generation FROM learner_progress_generations
                 WHERE user_key = ?
               ), 0) = ?`,
          )
          .bind(
            userKey,
            nextRevision,
            mergedPayload,
            updatedAt,
            userKey,
            userKey,
            canonical.generation,
          );
    const results = await database.batch([
      write,
      database
        .prepare(
          `DELETE FROM native_learning_state
           WHERE account_id = ?
             AND reset_generation = ?
             AND NOT EXISTS (
               SELECT 1 FROM learner_deletion_jobs
               WHERE native_account_id = ?
             )
             AND EXISTS (
               SELECT 1 FROM learning_state
               WHERE user_key = ? AND revision = ? AND payload = ?
                 AND COALESCE((
                   SELECT generation FROM learner_progress_generations
                   WHERE user_key = ?
                 ), 0) = ?
             )`,
        )
        .bind(
          nativeAccountId,
          native.reset_generation,
          nativeAccountId,
          userKey,
          nextRevision,
          mergedPayload,
          userKey,
          canonical.generation,
        ),
    ]);
    if (Number(results[1]?.meta.changes ?? 0) === 1) {
      return {
        state: merged,
        revision: nextRevision,
        generation: canonical.generation,
        updatedAt,
        nativeProjection: nativeState,
      };
    }
  }
  throw new Error("Concurrent account progress migration did not settle");
}

function parseCanonical(payload: string) {
  return stateFromPersistedUnknown(JSON.parse(payload));
}

function generationConflict(generation: number) {
  return apiJson(
    {
      error:
        "This learning data was reset on another device. Stale native progress was not saved.",
      code: "GENERATION_CONFLICT",
      generation,
    },
    409,
  );
}
