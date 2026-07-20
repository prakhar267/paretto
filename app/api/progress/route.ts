import { getDatabase } from "@/db";
import {
  createInitialState,
  stateFromUnknown,
  STATE_VERSION,
} from "@/app/learning-engine";
import { resolveRequestIdentity } from "@/app/server-auth";
import { reconcileProgressAliases } from "@/app/api/_lib/progress-reconciliation";

export const dynamic = "force-dynamic";

type StoredState = {
  payload: string;
  revision: number;
  updated_at: number;
};

export async function GET(request: Request) {
  const identity = await authenticatedUserKey(request);
  if ("response" in identity) return identity.response;
  const userKey = identity.key;

  try {
    const database = await getDatabase();
    const stored = await database
      .prepare(
        "SELECT payload, revision, updated_at FROM learning_state WHERE user_key = ?",
      )
      .bind(userKey)
      .first<StoredState>();

    if (!stored) {
      return json(
        { state: createInitialState(), revision: 0, savedAt: null },
        200,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored.payload);
    } catch {
      parsed = null;
    }

    const state = await reconcileProgressAliases(
      database,
      stateFromUnknown(parsed),
    );
    return json(
      {
        state,
        revision: stored.revision,
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

  let body: { state?: unknown; revision?: unknown };
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
  if (
    !body.state ||
    typeof body.state !== "object" ||
    Array.isArray(body.state) ||
    (body.state as { version?: unknown }).version !== STATE_VERSION
  ) {
    return json({ error: "A compatible progress state is required." }, 400);
  }

  const validatedState = stateFromUnknown(body.state);

  const revision = Number(body.revision);
  const updatedAt = Date.now();

  try {
    const database = await getDatabase();
    const state = await reconcileProgressAliases(database, validatedState);
    const payload = JSON.stringify(state);
    if (payload.length > 250_000) {
      return json({ error: "Progress payload is too large." }, 413);
    }

    if (revision === 0) {
      const result = await database
        .prepare(
          "INSERT OR IGNORE INTO learning_state (user_key, revision, payload, updated_at) VALUES (?, 1, ?, ?)",
        )
        .bind(userKey, payload, updatedAt)
        .run();

      if ((result.meta.changes ?? 0) !== 1) return conflict();
      return json(
        { state, revision: 1, savedAt: new Date(updatedAt).toISOString() },
        200,
      );
    }

    const result = await database
      .prepare(
        "UPDATE learning_state SET payload = ?, revision = revision + 1, updated_at = ? WHERE user_key = ? AND revision = ?",
      )
      .bind(payload, updatedAt, userKey, revision)
      .run();

    if ((result.meta.changes ?? 0) !== 1) return conflict();

    return json(
      {
        state,
        revision: revision + 1,
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

  try {
    const database = await getDatabase();
    await database
      .prepare("DELETE FROM learning_state WHERE user_key = ?")
      .bind(identity.key)
      .run();
    return json(
      { state: createInitialState(), revision: 0, savedAt: null },
      200,
    );
  } catch (error) {
    logError("progress_delete_failed", error);
    return json({ error: "Progress could not be deleted. Please retry." }, 503);
  }
}

async function authenticatedUserKey(
  request: Request,
): Promise<{ key: string } | { response: Response }> {
  try {
    const identity = await resolveRequestIdentity(request);
    if (identity.ok) return { key: identity.userKey };
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

function conflict() {
  return json(
    {
      error: "This progress changed in another tab.",
      code: "REVISION_CONFLICT",
    },
    409,
  );
}

function unauthorized() {
  return json({ error: "Sign in to access your progress." }, 401);
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
