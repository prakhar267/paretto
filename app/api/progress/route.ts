import { getDatabase } from "@/db";
import {
  createInitialState,
  stateFromUnknown,
  STATE_VERSION,
} from "@/app/learning-engine";

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

    return json(
      {
        state: stateFromUnknown(parsed),
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

  const state = stateFromUnknown(body.state);
  const payload = JSON.stringify(state);
  if (payload.length > 250_000) {
    return json({ error: "Progress payload is too large." }, 413);
  }

  const revision = Number(body.revision);
  const updatedAt = Date.now();

  try {
    const database = await getDatabase();

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
    const key = await resolveUserKey(request);
    return key ? { key } : { response: unauthorized() };
  } catch (error) {
    logError("identity_configuration_failed", error);
    return {
      response: json({ error: "Account storage is temporarily unavailable." }, 503),
    };
  }
}

async function resolveUserKey(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const localRequest =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const email = request.headers.get("oai-authenticated-user-email");
  if (email) {
    const normalizedEmail = email.trim().toLowerCase();
    const { env } = await import("cloudflare:workers");
    const secret = (env as unknown as { USER_KEY_SECRET?: unknown })
      .USER_KEY_SECRET;
    if (typeof secret === "string" && secret.length >= 32) {
      return hmacSha256(secret, normalizedEmail);
    }
    if (localRequest) return sha256(`pas-a-pas-local:${normalizedEmail}`);
    throw new Error("USER_KEY_SECRET must be configured in production.");
  }

  if (localRequest) {
    return "local-preview-user";
  }

  return null;
}

async function hmacSha256(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToHex(signature);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(digest);
}

function bytesToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
