export type CanonicalProgressSnapshot = {
  payload: string | null;
  revision: number | null;
  updated_at: number | null;
  generation: number;
};

/**
 * Read canonical state and its durable reset generation from one D1 snapshot.
 * The derived target row means this always returns a value, including for a
 * learner who has never saved progress (generation 0) or has just reset it.
 */
export async function readCanonicalProgressSnapshot(
  database: D1Database,
  userKey: string,
): Promise<CanonicalProgressSnapshot> {
  const row = await database
    .prepare(
      `SELECT state.payload, state.revision, state.updated_at,
              COALESCE(generations.generation, 0) AS generation
       FROM (SELECT ? AS user_key) AS target
       LEFT JOIN learning_state AS state
         ON state.user_key = target.user_key
       LEFT JOIN learner_progress_generations AS generations
         ON generations.user_key = target.user_key`,
    )
    .bind(userKey)
    .first<CanonicalProgressSnapshot>();
  if (!row) {
    throw new Error("Canonical progress generation could not be read.");
  }
  const generation = Number(row.generation);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("Canonical progress generation is invalid.");
  }
  return {
    payload: typeof row.payload === "string" ? row.payload : null,
    revision:
      Number.isSafeInteger(row.revision) && Number(row.revision) >= 1
        ? Number(row.revision)
        : null,
    updated_at:
      Number.isFinite(row.updated_at) && Number(row.updated_at) >= 0
        ? Number(row.updated_at)
        : null,
    generation,
  };
}

export function hasCanonicalProgress(
  snapshot: CanonicalProgressSnapshot,
): snapshot is CanonicalProgressSnapshot & {
  payload: string;
  revision: number;
  updated_at: number;
} {
  return (
    snapshot.payload !== null &&
    snapshot.revision !== null &&
    snapshot.updated_at !== null
  );
}
