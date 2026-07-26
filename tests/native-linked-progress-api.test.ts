import { describe, expect, it } from "vitest";

import {
  GET,
  PUT,
} from "../app/api/native/progress/route";
import { initialNativeLearningState } from "../app/api/native/_lib/native-progress";
import {
  accountUserKey,
} from "../app/server-auth";
import { createInitialState, STATE_VERSION } from "../app/learning-engine";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

type Row = { revision: number; payload: string; updated_at: number };
type NativeRow = Row & { reset_generation: number };

class LinkedProgressMemoryD1 {
  readonly canonical = new Map<string, Row>();
  readonly native = new Map<string, NativeRow>();
  readonly generations = new Map<string, number>();
  readonly deletionUserKeys = new Set<string>();
  readonly deletionNativeAccountIds = new Set<string>();

  constructor(
    readonly sessionHash: string,
    readonly nativeAccountId: string,
    readonly learnerUserId: string,
  ) {}

  prepare(sql: string) {
    return new LinkedProgressStatement(this, sql);
  }

  async batch(statements: LinkedProgressStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class LinkedProgressStatement {
  private values: unknown[] = [];
  private readonly sql: string;

  constructor(
    private readonly database: LinkedProgressMemoryD1,
    sql: string,
  ) {
    this.sql = sql.replace(/\s+/g, " ").trim().toUpperCase();
    if (
      this.sql.includes("LEARNER_DELETION_JOBS") &&
      this.sql.includes("STATUS IN")
    ) {
      throw new Error(
        "Completed deletion tombstones must also block native progress.",
      );
    }
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("FROM NATIVE_SESSIONS AS SESSIONS")) {
      if (String(this.values[0]) !== this.database.sessionHash) return null;
      return {
        account_id: this.database.nativeAccountId,
        learner_user_id: this.database.learnerUserId,
        email: "relay@example.test",
        display_name: "Camille",
        expires_at: Date.now() + 60_000,
        created_at: Date.UTC(2026, 6, 25),
      } as T;
    }
    if (this.sql.startsWith("SELECT STATE.PAYLOAD, STATE.REVISION")) {
      const key = String(this.values[0]);
      const row = this.database.canonical.get(key);
      return {
        payload: row?.payload ?? null,
        revision: row?.revision ?? null,
        updated_at: row?.updated_at ?? null,
        generation: this.database.generations.get(key) ?? 0,
      } as T;
    }
    if (this.sql.includes("FROM NATIVE_LEARNING_STATE WHERE ACCOUNT_ID")) {
      return (
        this.database.native.get(String(this.values[0])) ?? null
      ) as T | null;
    }
    throw new Error(`Unexpected linked progress first SQL: ${this.sql}`);
  }

  async run() {
    if (
      this.sql.startsWith("INSERT OR IGNORE INTO LEARNING_STATE") &&
      this.sql.includes("SELECT ?, ?, ?, ?")
    ) {
      const [key, revision, payload, updatedAt, deletionUserKey] = this.values;
      const generation = Number(this.values.at(-1));
      if (
        this.database.canonical.has(String(key)) ||
        this.database.deletionUserKeys.has(String(deletionUserKey)) ||
        (this.database.generations.get(String(key)) ?? 0) !== generation
      ) {
        return { meta: { changes: 0 } };
      }
      this.database.canonical.set(String(key), {
        revision: Number(revision),
        payload: String(payload),
        updated_at: Number(updatedAt),
      });
      return { meta: { changes: 1 } };
    }
    if (
      this.sql.startsWith("INSERT OR IGNORE INTO LEARNING_STATE") &&
      this.sql.includes("SELECT ?, 1, ?, ?")
    ) {
      const [key, payload, updatedAt, deletionUserKey] = this.values;
      const generation = Number(this.values.at(-1));
      if (
        this.database.canonical.has(String(key)) ||
        this.database.deletionUserKeys.has(String(deletionUserKey)) ||
        (this.database.generations.get(String(key)) ?? 0) !== generation
      ) {
        return { meta: { changes: 0 } };
      }
      this.database.canonical.set(String(key), {
        revision: 1,
        payload: String(payload),
        updated_at: Number(updatedAt),
      });
      return { meta: { changes: 1 } };
    }
    if (
      this.sql.startsWith("UPDATE LEARNING_STATE") &&
      this.sql.includes("SET REVISION = ?,")
    ) {
      const [
        nextRevision,
        payload,
        updatedAt,
        key,
        expectedRevision,
        deletionUserKey,
      ] =
        this.values;
      const generation = Number(this.values.at(-1));
      const current = this.database.canonical.get(String(key));
      if (
        !current ||
        current.revision !== Number(expectedRevision) ||
        this.database.deletionUserKeys.has(String(deletionUserKey)) ||
        (this.database.generations.get(String(key)) ?? 0) !== generation
      ) {
        return { meta: { changes: 0 } };
      }
      this.database.canonical.set(String(key), {
        revision: Number(nextRevision),
        payload: String(payload),
        updated_at: Number(updatedAt),
      });
      return { meta: { changes: 1 } };
    }
    if (
      this.sql.startsWith("UPDATE LEARNING_STATE") &&
      this.sql.includes("REVISION = REVISION + 1")
    ) {
      const [payload, updatedAt, key, expectedRevision, deletionUserKey] =
        this.values;
      const generation = Number(this.values.at(-1));
      const current = this.database.canonical.get(String(key));
      if (
        !current ||
        current.revision !== Number(expectedRevision) ||
        this.database.deletionUserKeys.has(String(deletionUserKey)) ||
        (this.database.generations.get(String(key)) ?? 0) !== generation
      ) {
        return { meta: { changes: 0 } };
      }
      this.database.canonical.set(String(key), {
        revision: current.revision + 1,
        payload: String(payload),
        updated_at: Number(updatedAt),
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM NATIVE_LEARNING_STATE")) {
      if (!this.sql.includes("AND EXISTS")) {
        const [
          accountId,
          revision,
          payload,
          resetGeneration,
          deletionAccountId,
        ] = this.values;
        const native = this.database.native.get(String(accountId));
        if (
          !native ||
          native.revision !== Number(revision) ||
          native.payload !== String(payload) ||
          native.reset_generation !== Number(resetGeneration) ||
          this.database.deletionNativeAccountIds.has(
            String(deletionAccountId),
          )
        ) {
          return { meta: { changes: 0 } };
        }
        this.database.native.delete(String(accountId));
        return { meta: { changes: 1 } };
      }
      const [
        accountId,
        resetGeneration,
        deletionAccountId,
        userKey,
        revision,
        payload,
        generationUserKey,
        generation,
      ] = this.values;
      if (
        this.database.deletionNativeAccountIds.has(String(deletionAccountId)) ||
        this.database.native.get(String(accountId))?.reset_generation !==
          Number(resetGeneration) ||
        (this.database.generations.get(String(generationUserKey)) ?? 0) !==
          Number(generation)
      ) {
        return { meta: { changes: 0 } };
      }
      const canonical = this.database.canonical.get(String(userKey));
      if (
        !canonical ||
        canonical.revision !== Number(revision) ||
        canonical.payload !== String(payload)
      ) {
        return { meta: { changes: 0 } };
      }
      return {
        meta: {
          changes: this.database.native.delete(String(accountId)) ? 1 : 0,
        },
      };
    }
    throw new Error(`Unexpected linked progress run SQL: ${this.sql}`);
  }
}

const SESSION_SECRET = "native-session-test-secret-with-at-least-32-chars";
const USER_KEY_SECRET = "shared-account-test-secret-with-at-least-32-chars";
const ACCESS_TOKEN = "A".repeat(43);
const NATIVE_ACCOUNT_ID = "native-account-id";
const LEARNER_USER_ID = "learner-user-id";

describe("linked native progress API", () => {
  it("rejects writes from pre-counter native clients before they can lose rewards", async () => {
    const sessionHash = await nativeSessionHash(ACCESS_TOKEN);
    const database = new LinkedProgressMemoryD1(
      sessionHash,
      NATIVE_ACCOUNT_ID,
      LEARNER_USER_ID,
    );
    const legacyState = {
      ...initialNativeLearningState(),
    } as Record<string, unknown>;
    delete legacyState.rewardJournal;
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "true",
      NATIVE_SESSION_SECRET: SESSION_SECRET,
      USER_KEY_SECRET,
    });

    const response = await PUT(
      nativeRequest({
        method: "PUT",
        headers: {
          authorization: `Bearer ${ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 0,
          generation: 0,
          state: legacyState,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(database.canonical.size).toBe(0);
  });

  it("atomically migrates native progress and then writes the shared account row", async () => {
    const sessionHash = await nativeSessionHash(ACCESS_TOKEN);
    const database = new LinkedProgressMemoryD1(
      sessionHash,
      NATIVE_ACCOUNT_ID,
      LEARNER_USER_ID,
    );
    const userKey = await accountUserKey(USER_KEY_SECRET, LEARNER_USER_ID);
    const canonical = {
      ...createInitialState(new Date("2026-07-25T08:00:00.000Z")),
      onboarded: true,
      displayName: "Web",
      xp: 30,
    };
    const native = {
      ...initialNativeLearningState(),
      onboarded: true,
      displayName: "Native",
      xp: 90,
      updatedAt: "2026-07-25T09:00:00.000Z",
    };
    database.canonical.set(userKey, {
      revision: 4,
      payload: JSON.stringify(canonical),
      updated_at: Date.parse(canonical.updatedAt),
    });
    database.native.set(NATIVE_ACCOUNT_ID, {
      revision: 2,
      reset_generation: 0,
      payload: JSON.stringify(native),
      updated_at: Date.parse(String(native.updatedAt)),
    });
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "true",
      NATIVE_SESSION_SECRET: SESSION_SECRET,
      USER_KEY_SECRET,
    });

    const migrated = await GET(nativeRequest());
    const migratedBody = (await migrated.json()) as {
      revision: number;
      generation: number;
      state: Record<string, unknown>;
    };

    expect(migrated.status).toBe(200);
    expect(migratedBody.revision).toBe(5);
    expect(migratedBody.generation).toBe(0);
    expect(migratedBody.state).toMatchObject({
      schemaVersion: 1,
      displayName: "Native",
      xp: 90,
    });
    expect(database.native.has(NATIVE_ACCOUNT_ID)).toBe(false);
    expect(JSON.parse(database.canonical.get(userKey)!.payload)).toMatchObject({
      version: STATE_VERSION,
      displayName: "Native",
      xp: 90,
    });

    const updatedState = {
      ...migratedBody.state,
      xp: 110,
      updatedAt: "2026-07-25T10:00:00.000Z",
    };
    const saved = await PUT(
      nativeRequest({
        method: "PUT",
        headers: {
          authorization: `Bearer ${ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: migratedBody.revision,
          generation: migratedBody.generation,
          state: updatedState,
        }),
      }),
    );

    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      revision: 6,
      state: { xp: 110 },
    });
    expect(JSON.parse(database.canonical.get(userKey)!.payload)).toMatchObject({
      version: STATE_VERSION,
      xp: 110,
    });
  });

  it("discards pre-reset native state and rejects its stale generation", async () => {
    const sessionHash = await nativeSessionHash(ACCESS_TOKEN);
    const database = new LinkedProgressMemoryD1(
      sessionHash,
      NATIVE_ACCOUNT_ID,
      LEARNER_USER_ID,
    );
    const userKey = await accountUserKey(USER_KEY_SECRET, LEARNER_USER_ID);
    const staleNative = {
      ...initialNativeLearningState(),
      onboarded: true,
      displayName: "Must not return",
      xp: 900,
      updatedAt: "2026-07-25T09:00:00.000Z",
    };
    database.generations.set(userKey, 1);
    database.native.set(NATIVE_ACCOUNT_ID, {
      revision: 7,
      reset_generation: 0,
      payload: JSON.stringify(staleNative),
      updated_at: Date.parse(String(staleNative.updatedAt)),
    });
    setCloudflareEnv({
      DB: database,
      NATIVE_API_ENABLED: "true",
      NATIVE_SESSION_SECRET: SESSION_SECRET,
      USER_KEY_SECRET,
    });

    const fresh = await GET(nativeRequest());
    expect(fresh.status).toBe(200);
    const freshBody = await fresh.json();
    expect(freshBody).toMatchObject({
      revision: 0,
      generation: 1,
      state: { onboarded: false, xp: 0 },
    });
    expect(database.native.has(NATIVE_ACCOUNT_ID)).toBe(false);
    expect(database.canonical.has(userKey)).toBe(false);

    const rejected = await PUT(
      nativeRequest({
        method: "PUT",
        headers: {
          authorization: `Bearer ${ACCESS_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revision: 0,
          generation: 0,
          state: staleNative,
        }),
      }),
    );
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({
      code: "GENERATION_CONFLICT",
      generation: 1,
    });
    expect(database.canonical.has(userKey)).toBe(false);
  });
});

function nativeRequest(init: RequestInit = {}) {
  return new Request("https://paretto.test/api/native/progress", {
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
    ...init,
  });
}

async function nativeSessionHash(token: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`native-session:${token}`),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
