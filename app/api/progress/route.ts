import { getDatabase } from "@/db";
import {
  createInitialState,
  stateFromPersistedUnknown,
  stateFromUnknown,
  STATE_VERSION,
} from "@/app/learning-engine";
import { resolveRequestIdentity } from "@/app/server-auth";
import { reconcileProgressAliases } from "@/app/api/_lib/progress-reconciliation";
import {
  hasCanonicalProgress,
  readCanonicalProgressSnapshot,
} from "@/app/progress-generation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await authenticatedUserKey(request);
  if ("response" in identity) return identity.response;
  if (
    request.headers.get("x-paretto-progress-cache") !==
    identity.progressStorageKey
  ) {
    return identityChanged();
  }
  const userKey = identity.key;

  try {
    const database = await getDatabase();
    const stored = await readCanonicalProgressSnapshot(database, userKey);

    if (!hasCanonicalProgress(stored)) {
      return json(
        {
          state: createInitialState(),
          revision: 0,
          generation: stored.generation,
          savedAt: null,
        },
        200,
      );
    }

    const state = await reconcileProgressAliases(
      database,
      stateFromPersistedUnknown(JSON.parse(stored.payload)),
    );
    return json(
      {
        state,
        revision: stored.revision,
        generation: stored.generation,
        savedAt: new Date(stored.updated_at).toISOString(),
      },
      200,
    );
  } catch (error) {
    logError("progress_read_failed", error);
    return json({ error: "Progress is temporarily unavailable." }, 503);
  }
}

export async function PUT(request: Request) {
  const identity = await authenticatedUserKey(request);
  if ("response" in identity) return identity.response;
  const userKey = identity.key;

  let body: {
    state?: unknown;
    revision?: unknown;
    generation?: unknown;
    progressStorageKey?: unknown;
  };
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 300_000) {
    return json({ error: "Progress payload is too large." }, 413);
  }
  try {
    const rawBody = await request.text();
    if (rawBody.length > 300_000) {
      return json({ error: "Progress payload is too large." }, 413);
    }
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (!Number.isInteger(body.revision) || Number(body.revision) < 0) {
    return json({ error: "A valid revision is required." }, 400);
  }
  const submittedGeneration =
    body.generation === undefined ? 0 : Number(body.generation);
  if (
    !Number.isSafeInteger(submittedGeneration) ||
    submittedGeneration < 0
  ) {
    return json({ error: "A valid progress generation is required." }, 400);
  }
  if (
    typeof body.progressStorageKey !== "string" ||
    body.progressStorageKey !== identity.progressStorageKey
  ) {
    return identityChanged();
  }
  if (
    !body.state ||
    typeof body.state !== "object" ||
    Array.isArray(body.state) ||
    (body.state as { version?: unknown }).version !== STATE_VERSION
  ) {
    return json({ error: "A compatible progress state is required." }, 400);
  }

  let validatedState: ReturnType<typeof stateFromUnknown>;
  try {
    validatedState = stateFromUnknown(body.state);
  } catch {
    return json({ error: "A compatible progress state is required." }, 400);
  }

  const revision = Number(body.revision);
  const generation = submittedGeneration;
  const updatedAt = Date.now();

  try {
    const database = await getDatabase();
    const state = await reconcileProgressAliases(database, validatedState);
    const payload = JSON.stringify(state);
    if (payload.length > 250_000) {
      return json({ error: "Progress payload is too large." }, 413);
    }

    if (revision === 0) {
      const result =
        identity.kind === "anonymous"
          ? await database
              .prepare(
                `INSERT OR IGNORE INTO learning_state (
                   user_key, revision, payload, updated_at
                 )
                 SELECT ?, 1, ?, ?
                 WHERE NOT EXISTS (
                   SELECT 1 FROM learner_identity_links
                   WHERE anonymous_user_key = ?
                 )
                   AND COALESCE((
                     SELECT generation FROM learner_progress_generations
                     WHERE user_key = ?
                   ), 0) = ?`,
              )
              .bind(
                userKey,
                payload,
                updatedAt,
                userKey,
                userKey,
                generation,
              )
              .run()
          : await database
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
                payload,
                updatedAt,
                userKey,
                userKey,
                generation,
              )
              .run();

      if ((result.meta.changes ?? 0) !== 1) {
        return writeConflict(database, userKey, generation);
      }
      return json(
        {
          state,
          revision: 1,
          generation,
          savedAt: new Date(updatedAt).toISOString(),
        },
        200,
      );
    }

    const result =
      identity.kind === "anonymous"
        ? await database
            .prepare(
              `UPDATE learning_state
               SET payload = ?, revision = revision + 1, updated_at = ?
               WHERE user_key = ? AND revision = ?
                 AND NOT EXISTS (
                   SELECT 1 FROM learner_identity_links
                   WHERE anonymous_user_key = ?
                 )
                 AND COALESCE((
                   SELECT generation FROM learner_progress_generations
                   WHERE user_key = ?
                 ), 0) = ?`,
            )
            .bind(
              payload,
              updatedAt,
              userKey,
              revision,
              userKey,
              userKey,
              generation,
            )
            .run()
        : await database
            .prepare(
              `UPDATE learning_state
               SET payload = ?, revision = revision + 1, updated_at = ?
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
              payload,
              updatedAt,
              userKey,
              revision,
              userKey,
              userKey,
              generation,
            )
            .run();

    if ((result.meta.changes ?? 0) !== 1) {
      return writeConflict(database, userKey, generation);
    }

    return json(
      {
        state,
        revision: revision + 1,
        generation,
        savedAt: new Date(updatedAt).toISOString(),
      },
      200,
    );
  } catch (error) {
    logError("progress_write_failed", error);
    return json({ error: "Progress could not be saved. Please retry." }, 503);
  }
}

export async function DELETE(request: Request) {
  const identity = await authenticatedUserKey(request);
  if ("response" in identity) return identity.response;
  if (
    request.headers.get("x-paretto-progress-cache") !==
    identity.progressStorageKey
  ) {
    return identityChanged();
  }

  try {
    const database = await getDatabase();
    const updatedAt = Date.now();
    const guard =
      identity.kind === "anonymous"
        ? `NOT EXISTS (
             SELECT 1 FROM learner_identity_links
             WHERE anonymous_user_key = ?
           )`
        : `NOT EXISTS (
             SELECT 1 FROM learner_deletion_jobs
             WHERE user_key = ?
           )`;
    const results = await database.batch([
      database
        .prepare(
          `INSERT INTO learner_progress_generations (
             user_key, generation, updated_at
           )
           SELECT ?, 1, ?
           WHERE ${guard}
           ON CONFLICT(user_key) DO UPDATE SET
             generation = learner_progress_generations.generation + 1,
             updated_at = excluded.updated_at
           WHERE ${guard}`,
        )
        .bind(
          identity.key,
          updatedAt,
          identity.key,
          identity.key,
        ),
      database
        .prepare(
          `DELETE FROM learning_state
           WHERE user_key = ?
             AND ${guard}`,
        )
        .bind(identity.key, identity.key),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) {
      return conflict();
    }
    const reset = await readCanonicalProgressSnapshot(database, identity.key);
    return json(
      {
        state: createInitialState(),
        revision: 0,
        generation: reset.generation,
        savedAt: null,
      },
      200,
    );
  } catch (error) {
    logError("progress_delete_failed", error);
    return json({ error: "Progress could not be deleted. Please retry." }, 503);
  }
}

async function authenticatedUserKey(
  request: Request,
): Promise<
  {
    key: string;
    kind: "account" | "anonymous";
    progressStorageKey: string;
  } | { response: Response }
> {
  try {
    const identity = await resolveRequestIdentity(request);
    if (identity.ok) {
      return {
        key: identity.userKey,
        kind: identity.kind,
        progressStorageKey: identity.progressStorageKey,
      };
    }
    return {
      response:
        identity.status === 401
          ? unauthorized()
          : json({ error: "Account storage is temporarily unavailable." }, 503),
    };
  } catch (error) {
    logError("identity_configuration_failed", error);
    return {
      response: json({ error: "Account storage is temporarily unavailable." }, 503),
    };
  }
}

async function writeConflict(
  database: D1Database,
  userKey: string,
  submittedGeneration: number,
) {
  const current = await readCanonicalProgressSnapshot(database, userKey);
  if (current.generation !== submittedGeneration) {
    return json(
      {
        error:
          "This learning data was reset on another tab or device. Local stale progress was not saved.",
        code: "GENERATION_CONFLICT",
        generation: current.generation,
      },
      409,
    );
  }
  return conflict(current.generation);
}

function conflict(generation?: number) {
  return json(
    {
      error: "This progress changed in another tab.",
      code: "REVISION_CONFLICT",
      ...(generation === undefined ? {} : { generation }),
    },
    409,
  );
}

function identityChanged() {
  return json(
    {
      error:
        "This browser changed learning identity. Reload before saving progress.",
      code: "IDENTITY_CHANGED",
    },
    409,
  );
}

function unauthorized() {
  return json(
    { error: "A valid browser learning session is required." },
    401,
  );
}

function json(value: unknown, status: number) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "private, no-store, max-age=0",
    },
  });
}

function logError(event: string, error: unknown) {
  console.error(
    JSON.stringify({
      event,
      message: error instanceof Error ? error.message : "unknown error",
      timestamp: new Date().toISOString(),
    }),
  );
}
