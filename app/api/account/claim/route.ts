import { getDatabase } from "@/db";
import {
  createInitialState,
  isolateRewardReplicaCollisions,
  mergeLearningStates,
  stateFromPersistedUnknown,
  stateFromUnknown,
} from "@/app/learning-engine";
import { resolveLearnerClaimKeys } from "@/app/server-auth";
import {
  hasCanonicalProgress,
  readCanonicalProgressSnapshot,
  type CanonicalProgressSnapshot,
} from "@/app/progress-generation";

export const dynamic = "force-dynamic";

type IdentityLink = {
  account_id: string;
};

const MAX_CLAIM_WRITE_ATTEMPTS = 3;

export async function POST(request: Request) {
  const identity = await resolveLearnerClaimKeys(request);
  if (!identity.ok) {
    return json(
      {
        error:
          identity.status === 401
            ? "Sign in before connecting this browser."
            : "Account migration is temporarily unavailable.",
      },
      identity.status,
    );
  }

  try {
    const database = await getDatabase();
    if (
      await hasActiveDeletionJob(
        database,
        identity.accountId,
        identity.accountUserKey,
      )
    ) {
      return json(
        { error: "Account deletion is already in progress." },
        409,
      );
    }
    const anonymousKey =
      identity.anonymousUserKey === identity.accountUserKey
        ? null
        : identity.anonymousUserKey;
    // Reserve an unclaimed browser identity before reading its state. This
    // prevents two accounts signing in concurrently on a shared browser from
    // both receiving the same anonymous record. A failed canonical write leaves
    // a safe, retryable reservation for the same account.
    const mayClaimAnonymous = await reserveAnonymousIdentity(
      database,
      anonymousKey,
      identity.accountId,
      identity.accountUserKey,
    );
    let migratedAnonymousProgress = false;

    for (let attempt = 0; attempt < MAX_CLAIM_WRITE_ATTEMPTS; attempt += 1) {
      const [accountRow, anonymousRow] = await Promise.all([
        readState(database, identity.accountUserKey),
        mayClaimAnonymous && anonymousKey
          ? readState(database, anonymousKey)
          : Promise.resolve({
              payload: null,
              revision: null,
              updated_at: null,
              generation: 0,
            } satisfies CanonicalProgressSnapshot),
      ]);
      const accountState = parseState(accountRow);
      const anonymousState = parseState(anonymousRow);
      migratedAnonymousProgress ||= hasCanonicalProgress(anonymousRow);
      const merged =
        accountState && anonymousState
          ? mergeLearningStates(
              accountState,
              isolateRewardReplicaCollisions(
                anonymousState,
                accountState,
                anonymousKey ?? identity.accountUserKey,
              ),
            )
          : accountState ?? anonymousState ?? createInitialState();
      const revision =
        Math.max(accountRow.revision ?? 0, anonymousRow.revision ?? 0) + 1;
      const updatedAt = Date.now();
      const write = await writeCanonicalState(
        database,
        identity.accountUserKey,
        identity.accountId,
        accountRow,
        merged,
        revision,
        updatedAt,
      );
      if (!write) continue;

      // Related ownership moves and anonymous-state deletion happen only after
      // the merged canonical row has won its optimistic revision check.
      if (mayClaimAnonymous && anonymousKey) {
        const finalized = await finalizeAnonymousClaim(
          database,
          anonymousKey,
          identity.accountId,
          identity.accountUserKey,
          updatedAt,
          anonymousRow,
        );
        if (!finalized) continue;
      }
      const confirmed = await readState(database, identity.accountUserKey);
      if (
        !hasCanonicalProgress(confirmed) ||
        confirmed.revision !== revision ||
        confirmed.generation !== accountRow.generation ||
        confirmed.payload !== JSON.stringify(merged)
      ) {
        continue;
      }

      return json(
        {
          connected: true,
          migratedAnonymousProgress,
          revision,
          generation: confirmed.generation,
          state: merged,
          savedAt: new Date(updatedAt).toISOString(),
          cacheTransition: {
            accountStorageKey: identity.accountStorageKey,
            anonymousStorageKey:
              mayClaimAnonymous && anonymousKey
                ? identity.anonymousStorageKey
                : null,
            anonymousGeneration:
              mayClaimAnonymous && anonymousKey
                ? anonymousRow.generation
                : null,
          },
        },
        200,
      );
    }

    throw new Error("Concurrent account progress changes did not settle.");
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "learner_account_claim_failed",
        message: error instanceof Error ? error.message : "unknown error",
        timestamp: new Date().toISOString(),
      }),
    );
    return json({ error: "Account migration is temporarily unavailable." }, 503);
  }
}

async function reserveAnonymousIdentity(
  database: D1Database,
  anonymousKey: string | null,
  accountId: string,
  accountUserKey: string,
): Promise<boolean> {
  if (!anonymousKey) return false;
  let link = await readIdentityLink(database, anonymousKey);
  if (!link) {
    await database
      .prepare(
        `INSERT OR IGNORE INTO learner_identity_links (
           anonymous_user_key, account_id, linked_at
         )
         SELECT ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM learner_deletion_jobs
           WHERE user_id = ? OR user_key = ?
         )`,
      )
      .bind(
        anonymousKey,
        accountId,
        Date.now(),
        accountId,
        accountUserKey,
      )
      .run();
    link = await readIdentityLink(database, anonymousKey);
  }
  return (
    link?.account_id === accountId &&
    !(await hasActiveDeletionJob(database, accountId, accountUserKey))
  );
}

function readIdentityLink(
  database: D1Database,
  anonymousKey: string,
): Promise<IdentityLink | null> {
  return database
    .prepare(
      "SELECT account_id FROM learner_identity_links WHERE anonymous_user_key = ?",
    )
    .bind(anonymousKey)
    .first<IdentityLink>();
}

async function writeCanonicalState(
  database: D1Database,
  accountUserKey: string,
  accountId: string,
  accountRow: CanonicalProgressSnapshot,
  state: ReturnType<typeof stateFromUnknown>,
  revision: number,
  updatedAt: number,
): Promise<boolean> {
  const payload = JSON.stringify(state);
  const result = hasCanonicalProgress(accountRow)
    ? await database
        .prepare(
          `UPDATE learning_state
           SET revision = ?, payload = ?, updated_at = ?
           WHERE user_key = ? AND revision = ?
             AND NOT EXISTS (
               SELECT 1 FROM learner_deletion_jobs
               WHERE user_id = ? OR user_key = ?
             )
             AND COALESCE((
               SELECT generation FROM learner_progress_generations
               WHERE user_key = ?
             ), 0) = ?`,
        )
        .bind(
          revision,
          payload,
          updatedAt,
          accountUserKey,
          accountRow.revision,
          accountId,
          accountUserKey,
          accountUserKey,
          accountRow.generation,
        )
        .run()
    : await database
        .prepare(
          `INSERT OR IGNORE INTO learning_state (
             user_key, revision, payload, updated_at
           )
           SELECT ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM learner_deletion_jobs
             WHERE user_id = ? OR user_key = ?
           )
             AND COALESCE((
               SELECT generation FROM learner_progress_generations
               WHERE user_key = ?
             ), 0) = ?`,
        )
        .bind(
          accountUserKey,
          revision,
          payload,
          updatedAt,
          accountId,
          accountUserKey,
          accountUserKey,
          accountRow.generation,
        )
        .run();
  return Number(result.meta.changes ?? 0) === 1;
}

async function finalizeAnonymousClaim(
  database: D1Database,
  anonymousKey: string,
  accountId: string,
  accountUserKey: string,
  linkedAt: number,
  expectedAnonymousRow: CanonicalProgressSnapshot,
): Promise<boolean> {
  const results = await database.batch([
    database
      .prepare(
        `UPDATE learner_identity_links
         SET linked_at = ?
         WHERE anonymous_user_key = ? AND account_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM learner_deletion_jobs
             WHERE user_id = ? OR user_key = ?
           )`,
      )
      .bind(
        linkedAt,
        anonymousKey,
        accountId,
        accountId,
        accountUserKey,
      ),
    database
      .prepare(
        `UPDATE support_requests
         SET user_key = ?
         WHERE user_key = ?
           AND EXISTS (
             SELECT 1 FROM learner_identity_links
             WHERE anonymous_user_key = ? AND account_id = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM learner_deletion_jobs
             WHERE user_id = ? OR user_key = ?
           )`,
      )
      .bind(
        accountUserKey,
        anonymousKey,
        anonymousKey,
        accountId,
        accountId,
        accountUserKey,
      ),
    database
      .prepare(
        `UPDATE product_events
         SET user_key = ?
         WHERE user_key = ?
           AND EXISTS (
             SELECT 1 FROM learner_identity_links
             WHERE anonymous_user_key = ? AND account_id = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM learner_deletion_jobs
             WHERE user_id = ? OR user_key = ?
           )`,
      )
      .bind(
        accountUserKey,
        anonymousKey,
        anonymousKey,
        accountId,
        accountId,
        accountUserKey,
      ),
    database
      .prepare(
        `DELETE FROM learning_state
         WHERE user_key = ?
           AND revision = ?
           AND payload = ?
           AND COALESCE((
             SELECT generation FROM learner_progress_generations
             WHERE user_key = ?
           ), 0) = ?
           AND EXISTS (
             SELECT 1 FROM learner_identity_links
             WHERE anonymous_user_key = ? AND account_id = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM learner_deletion_jobs
             WHERE user_id = ? OR user_key = ?
           )`,
      )
      .bind(
        anonymousKey,
        expectedAnonymousRow?.revision ?? -1,
        expectedAnonymousRow?.payload ?? "",
        anonymousKey,
        expectedAnonymousRow.generation,
        anonymousKey,
        accountId,
        accountId,
        accountUserKey,
      ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) return false;
  if (!hasCanonicalProgress(expectedAnonymousRow)) {
    const unexpectedRow = await readState(database, anonymousKey);
    return !hasCanonicalProgress(unexpectedRow);
  }
  return Number(results.at(-1)?.meta.changes ?? 0) === 1;
}

function hasActiveDeletionJob(
  database: D1Database,
  accountId: string,
  accountUserKey: string,
): Promise<{ user_id: string } | null> {
  return database
    .prepare(
      `SELECT user_id FROM learner_deletion_jobs
       WHERE user_id = ? OR user_key = ?
       LIMIT 1`,
    )
    .bind(accountId, accountUserKey)
    .first<{ user_id: string }>();
}

function readState(
  database: D1Database,
  userKey: string,
): Promise<CanonicalProgressSnapshot> {
  return readCanonicalProgressSnapshot(database, userKey);
}

function parseState(
  row: CanonicalProgressSnapshot,
): ReturnType<typeof stateFromUnknown> | null {
  if (!hasCanonicalProgress(row)) return null;
  return stateFromPersistedUnknown(JSON.parse(row.payload));
}

function json(value: unknown, status: number) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "private, no-store, max-age=0",
    },
  });
}
