import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState, markWordKnown } from "../app/learning-engine";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

const resolveLearnerClaimKeys = vi.fn();

vi.mock("../app/server-auth", () => ({
  resolveLearnerClaimKeys,
}));

const { POST } = await import("../app/api/account/claim/route");

type StateRow = { payload: string; revision: number; updated_at: number };

class ClaimDatabase {
  states = new Map<string, StateRow>();
  generations = new Map<string, number>();
  links = new Map<string, string>();
  supportUsers: string[] = [];
  eventUsers: string[] = [];
  activeDeletionAccountIds = new Set<string>();
  activeDeletionUserKeys = new Set<string>();
  beforeCanonicalWrite: ((userKey: string) => void) | null = null;
  beforeAnonymousFinalize: ((userKey: string) => void) | null = null;
  beforeOwnershipFinalize: (() => void) | null = null;
  canonicalWriteAttempts = 0;

  prepare(sql: string) {
    return new ClaimStatement(this, sql);
  }

  async batch(statements: ClaimStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class ClaimStatement {
  private values: unknown[] = [];
  private readonly normalized: string;

  constructor(
    private readonly database: ClaimDatabase,
    sql: string,
  ) {
    this.normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
    if (
      this.normalized.includes("LEARNER_DELETION_JOBS") &&
      this.normalized.includes("STATUS IN")
    ) {
      throw new Error("Completed deletion tombstones must also block claims.");
    }
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (
      this.normalized.startsWith(
        "SELECT USER_ID FROM LEARNER_DELETION_JOBS",
      )
    ) {
      const [accountId, userKey] = this.values.map(String);
      const blocked =
        this.database.activeDeletionAccountIds.has(accountId) ||
        this.database.activeDeletionUserKeys.has(userKey);
      return (blocked ? { user_id: accountId } : null) as T | null;
    }
    if (this.normalized.startsWith("SELECT ACCOUNT_ID FROM LEARNER_IDENTITY_LINKS")) {
      const accountId = this.database.links.get(String(this.values[0]));
      return (accountId ? { account_id: accountId } : null) as T | null;
    }
    if (this.normalized.startsWith("SELECT STATE.PAYLOAD, STATE.REVISION")) {
      const userKey = String(this.values[0]);
      const state = this.database.states.get(userKey);
      return {
        payload: state?.payload ?? null,
        revision: state?.revision ?? null,
        updated_at: state?.updated_at ?? null,
        generation: this.database.generations.get(userKey) ?? 0,
      } as T;
    }
    throw new Error(`Unexpected first SQL: ${this.normalized}`);
  }

  async run() {
    if (this.normalized.startsWith("INSERT OR IGNORE INTO LEARNING_STATE")) {
      const userKey = String(this.values[0]);
      this.runBeforeCanonicalWrite(userKey);
      if (this.deletionBlocked(4, 5)) {
        return { meta: { changes: 0 } };
      }
      if (
        (this.database.generations.get(userKey) ?? 0) !==
        Number(this.values[7])
      ) {
        return { meta: { changes: 0 } };
      }
      if (this.database.states.has(userKey)) {
        return { meta: { changes: 0 } };
      }
      this.database.states.set(userKey, {
        revision: Number(this.values[1]),
        payload: String(this.values[2]),
        updated_at: Number(this.values[3]),
      });
      return { meta: { changes: 1 } };
    }
    if (this.normalized.startsWith("UPDATE LEARNING_STATE")) {
      const [revision, payload, updatedAt, userKeyValue, expectedRevision] =
        this.values;
      const userKey = String(userKeyValue);
      this.runBeforeCanonicalWrite(userKey);
      if (this.deletionBlocked(5, 6)) {
        return { meta: { changes: 0 } };
      }
      if (
        (this.database.generations.get(userKey) ?? 0) !==
        Number(this.values[8])
      ) {
        return { meta: { changes: 0 } };
      }
      const current = this.database.states.get(userKey);
      if (!current || current.revision !== Number(expectedRevision)) {
        return { meta: { changes: 0 } };
      }
      this.database.states.set(userKey, {
        revision: Number(revision),
        payload: String(payload),
        updated_at: Number(updatedAt),
      });
      return { meta: { changes: 1 } };
    }
    if (this.normalized.startsWith("INSERT OR IGNORE INTO LEARNER_IDENTITY_LINKS")) {
      const anonymousKey = String(this.values[0]);
      const accountId = String(this.values[1]);
      if (this.deletionBlocked(3, 4)) {
        return { meta: { changes: 0 } };
      }
      const existing = this.database.links.get(anonymousKey);
      if (!existing) {
        this.database.links.set(anonymousKey, accountId);
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (this.normalized.startsWith("UPDATE LEARNER_IDENTITY_LINKS")) {
      const [linkedAt, anonymousKey, accountId] = this.values;
      void linkedAt;
      const finalize = this.database.beforeOwnershipFinalize;
      if (finalize) {
        this.database.beforeOwnershipFinalize = null;
        finalize();
      }
      if (this.deletionBlocked(3, 4)) {
        return { meta: { changes: 0 } };
      }
      return {
        meta: {
          changes:
            this.database.links.get(String(anonymousKey)) === String(accountId)
              ? 1
              : 0,
        },
      };
    }
    if (this.normalized.startsWith("UPDATE SUPPORT_REQUESTS")) {
      const [accountKey, anonymousKey, guardedAnonymousKey, accountId] =
        this.values;
      const ownsIdentity =
        String(anonymousKey) === String(guardedAnonymousKey) &&
        this.database.links.get(String(anonymousKey)) === String(accountId) &&
        !this.deletionBlocked(4, 5);
      if (ownsIdentity) {
        this.database.supportUsers = this.database.supportUsers.map((value) =>
          value === String(anonymousKey) ? String(accountKey) : value,
        );
      }
      return { meta: { changes: ownsIdentity ? 1 : 0 } };
    }
    if (this.normalized.startsWith("UPDATE PRODUCT_EVENTS")) {
      const [accountKey, anonymousKey, guardedAnonymousKey, accountId] =
        this.values;
      const ownsIdentity =
        String(anonymousKey) === String(guardedAnonymousKey) &&
        this.database.links.get(String(anonymousKey)) === String(accountId) &&
        !this.deletionBlocked(4, 5);
      if (ownsIdentity) {
        this.database.eventUsers = this.database.eventUsers.map((value) =>
          value === String(anonymousKey) ? String(accountKey) : value,
        );
      }
      return { meta: { changes: ownsIdentity ? 1 : 0 } };
    }
    if (this.normalized.startsWith("DELETE FROM LEARNING_STATE")) {
      const [
        anonymousKey,
        expectedRevision,
        expectedPayload,
        generationUserKey,
        expectedGeneration,
        guardedAnonymousKey,
        accountId,
      ] = this.values;
      const finalize = this.database.beforeAnonymousFinalize;
      if (finalize) {
        this.database.beforeAnonymousFinalize = null;
        finalize(String(anonymousKey));
      }
      const ownsIdentity =
        String(anonymousKey) === String(guardedAnonymousKey) &&
        this.database.links.get(String(anonymousKey)) === String(accountId) &&
        !this.deletionBlocked(7, 8);
      const current = this.database.states.get(String(anonymousKey));
      const matchesSnapshot =
        current?.revision === Number(expectedRevision) &&
        current.payload === String(expectedPayload) &&
        String(anonymousKey) === String(generationUserKey) &&
        (this.database.generations.get(String(anonymousKey)) ?? 0) ===
          Number(expectedGeneration);
      return {
        meta: {
          changes:
            ownsIdentity &&
            matchesSnapshot &&
            this.database.states.delete(String(anonymousKey))
              ? 1
              : 0,
        },
      };
    }
    throw new Error(`Unexpected run SQL: ${this.normalized}`);
  }

  private runBeforeCanonicalWrite(userKey: string) {
    this.database.canonicalWriteAttempts += 1;
    const callback = this.database.beforeCanonicalWrite;
    if (!callback) return;
    this.database.beforeCanonicalWrite = null;
    callback(userKey);
  }

  private deletionBlocked(
    accountIdIndex: number,
    userKeyIndex: number,
  ): boolean {
    if (!this.normalized.includes("LEARNER_DELETION_JOBS")) return false;
    return (
      this.database.activeDeletionAccountIds.has(
        String(this.values[accountIdIndex]),
      ) ||
      this.database.activeDeletionUserKeys.has(
        String(this.values[userKeyIndex]),
      )
    );
  }
}

describe("learner account progress claim", () => {
  let database: ClaimDatabase;

  beforeEach(() => {
    database = new ClaimDatabase();
    setCloudflareEnv({ DB: database });
    resolveLearnerClaimKeys.mockReset();
  });

  it("atomically merges anonymous progress and reassigns related records", async () => {
    const base = new Date("2026-07-25T00:00:00.000Z");
    const anonymous = markWordKnown(createInitialState(base), "idf-metro", base);
    const account = markWordKnown(
      createInitialState(new Date("2026-07-25T00:01:00.000Z")),
      "idf-musee",
      new Date("2026-07-25T00:01:00.000Z"),
    );
    database.states.set("anonymous-key", {
      payload: JSON.stringify(anonymous),
      revision: 3,
      updated_at: base.getTime(),
    });
    database.states.set("account-key", {
      payload: JSON.stringify(account),
      revision: 2,
      updated_at: base.getTime() + 60_000,
    });
    database.supportUsers = ["anonymous-key"];
    database.eventUsers = ["anonymous-key"];
    resolveLearnerClaimKeys.mockResolvedValue({
      ok: true,
      accountId: "account-id",
      accountUserKey: "account-key",
      anonymousUserKey: "anonymous-key",
      accountStorageKey: "account-storage",
      anonymousStorageKey: "anonymous-storage",
    });

    const response = await POST(
      new Request("https://paretto.test/api/account/claim", { method: "POST" }),
    );
    const body = (await response.json()) as {
      connected: boolean;
      migratedAnonymousProgress: boolean;
      revision: number;
      state: { wordProgress: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      connected: true,
      migratedAnonymousProgress: true,
      revision: 4,
    });
    expect(Object.keys(body.state.wordProgress).sort()).toEqual([
      "idf-metro",
      "idf-musee",
    ]);
    expect(database.states.has("anonymous-key")).toBe(false);
    expect(database.states.has("account-key")).toBe(true);
    expect(database.links.get("anonymous-key")).toBe("account-id");
    expect(database.supportUsers).toEqual(["account-key"]);
    expect(database.eventUsers).toEqual(["account-key"]);
  });

  it("rereads and merges a concurrent account save instead of overwriting it", async () => {
    const base = new Date("2026-07-25T00:00:00.000Z");
    const anonymous = markWordKnown(
      createInitialState(base),
      "idf-metro",
      base,
    );
    const account = markWordKnown(
      createInitialState(new Date("2026-07-25T00:01:00.000Z")),
      "idf-musee",
      new Date("2026-07-25T00:01:00.000Z"),
    );
    database.states.set("anonymous-key", {
      payload: JSON.stringify(anonymous),
      revision: 3,
      updated_at: base.getTime(),
    });
    database.states.set("account-key", {
      payload: JSON.stringify(account),
      revision: 2,
      updated_at: base.getTime() + 60_000,
    });
    database.beforeCanonicalWrite = (userKey) => {
      const current = database.states.get(userKey);
      if (!current) throw new Error("Expected the account row.");
      const concurrent = markWordKnown(
        JSON.parse(current.payload),
        "idf-banlieue",
        new Date("2026-07-25T00:02:00.000Z"),
      );
      database.states.set(userKey, {
        payload: JSON.stringify(concurrent),
        revision: current.revision + 1,
        updated_at: base.getTime() + 120_000,
      });
    };
    resolveLearnerClaimKeys.mockResolvedValue({
      ok: true,
      accountId: "account-id",
      accountUserKey: "account-key",
      anonymousUserKey: "anonymous-key",
      accountStorageKey: "account-storage",
      anonymousStorageKey: "anonymous-storage",
    });

    const response = await POST(
      new Request("https://paretto.test/api/account/claim", { method: "POST" }),
    );
    const body = (await response.json()) as {
      revision: number;
      state: { wordProgress: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(database.canonicalWriteAttempts).toBe(2);
    expect(body.revision).toBe(4);
    expect(Object.keys(body.state.wordProgress).sort()).toEqual([
      "idf-banlieue",
      "idf-metro",
      "idf-musee",
    ]);
    expect(
      Object.keys(
        JSON.parse(database.states.get("account-key")!.payload).wordProgress,
      ).sort(),
    ).toEqual(["idf-banlieue", "idf-metro", "idf-musee"]);
    expect(database.states.has("anonymous-key")).toBe(false);
  });

  it("rereads an anonymous save that lands during finalization instead of deleting it", async () => {
    const base = new Date("2026-07-25T00:00:00.000Z");
    const anonymous = markWordKnown(
      createInitialState(base),
      "idf-metro",
      base,
    );
    database.states.set("anonymous-key", {
      payload: JSON.stringify(anonymous),
      revision: 3,
      updated_at: base.getTime(),
    });
    database.beforeAnonymousFinalize = (userKey) => {
      const current = database.states.get(userKey);
      if (!current) throw new Error("Expected the anonymous row.");
      const concurrent = markWordKnown(
        JSON.parse(current.payload),
        "idf-banlieue",
        new Date("2026-07-25T00:02:00.000Z"),
      );
      database.states.set(userKey, {
        payload: JSON.stringify(concurrent),
        revision: current.revision + 1,
        updated_at: base.getTime() + 120_000,
      });
    };
    resolveLearnerClaimKeys.mockResolvedValue({
      ok: true,
      accountId: "account-id",
      accountUserKey: "account-key",
      anonymousUserKey: "anonymous-key",
      accountStorageKey: "account-storage",
      anonymousStorageKey: "anonymous-storage",
    });

    const response = await POST(
      new Request("https://paretto.test/api/account/claim", { method: "POST" }),
    );
    const body = (await response.json()) as {
      revision: number;
      state: { wordProgress: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(database.canonicalWriteAttempts).toBe(2);
    expect(Object.keys(body.state.wordProgress).sort()).toEqual([
      "idf-banlieue",
      "idf-metro",
    ]);
    expect(
      Object.keys(
        JSON.parse(database.states.get("account-key")!.payload).wordProgress,
      ).sort(),
    ).toEqual(["idf-banlieue", "idf-metro"]);
    expect(database.states.has("anonymous-key")).toBe(false);
  });

  it("never transfers a browser already linked to a different account", async () => {
    database.links.set("anonymous-key", "other-account");
    database.states.set("anonymous-key", {
      payload: JSON.stringify(
        markWordKnown(createInitialState(), "idf-metro"),
      ),
      revision: 7,
      updated_at: Date.now(),
    });
    resolveLearnerClaimKeys.mockResolvedValue({
      ok: true,
      accountId: "new-account",
      accountUserKey: "new-account-key",
      anonymousUserKey: "anonymous-key",
      accountStorageKey: "new-account-storage",
      anonymousStorageKey: "anonymous-storage",
    });

    const response = await POST(
      new Request("https://paretto.test/api/account/claim", { method: "POST" }),
    );
    const body = (await response.json()) as {
      migratedAnonymousProgress: boolean;
      state: { wordProgress: Record<string, unknown> };
      cacheTransition: { anonymousStorageKey: string | null };
    };

    expect(response.status).toBe(200);
    expect(body.migratedAnonymousProgress).toBe(false);
    expect(body.state.wordProgress).toEqual({});
    expect(body.cacheTransition.anonymousStorageKey).toBeNull();
    expect(database.states.has("anonymous-key")).toBe(true);
    expect(database.links.get("anonymous-key")).toBe("other-account");
  });

  it("preserves both snapshots when canonical account progress is malformed", async () => {
    const anonymous = markWordKnown(
      createInitialState(),
      "idf-metro",
    );
    const malformedAccount = {
      payload: "{",
      revision: 9,
      updated_at: Date.now(),
    };
    database.states.set("anonymous-key", {
      payload: JSON.stringify(anonymous),
      revision: 2,
      updated_at: Date.now(),
    });
    database.states.set("account-key", malformedAccount);
    resolveLearnerClaimKeys.mockResolvedValue({
      ok: true,
      accountId: "account-id",
      accountUserKey: "account-key",
      anonymousUserKey: "anonymous-key",
      accountStorageKey: "account-storage",
      anonymousStorageKey: "anonymous-storage",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(
      new Request("https://paretto.test/api/account/claim", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(database.states.get("account-key")).toEqual(malformedAccount);
    expect(database.states.has("anonymous-key")).toBe(true);
    expect(database.canonicalWriteAttempts).toBe(0);
    consoleError.mockRestore();
  });

  it("does not reserve or write anything for an account with any deletion tombstone", async () => {
    database.activeDeletionAccountIds.add("account-id");
    resolveLearnerClaimKeys.mockResolvedValue({
      ok: true,
      accountId: "account-id",
      accountUserKey: "account-key",
      anonymousUserKey: "anonymous-key",
      accountStorageKey: "account-storage",
      anonymousStorageKey: "anonymous-storage",
    });

    const response = await POST(
      new Request("https://paretto.test/api/account/claim", { method: "POST" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Account deletion is already in progress.",
    });
    expect(database.links.size).toBe(0);
    expect(database.states.size).toBe(0);
    expect(database.canonicalWriteAttempts).toBe(0);
  });

  it("fails closed when deletion starts during the canonical account write", async () => {
    database.states.set("anonymous-key", {
      payload: JSON.stringify(
        markWordKnown(createInitialState(), "idf-metro"),
      ),
      revision: 2,
      updated_at: Date.now(),
    });
    database.beforeCanonicalWrite = () => {
      database.activeDeletionUserKeys.add("account-key");
    };
    resolveLearnerClaimKeys.mockResolvedValue({
      ok: true,
      accountId: "account-id",
      accountUserKey: "account-key",
      anonymousUserKey: "anonymous-key",
      accountStorageKey: "account-storage",
      anonymousStorageKey: "anonymous-storage",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(
      new Request("https://paretto.test/api/account/claim", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(database.states.has("account-key")).toBe(false);
    expect(database.states.has("anonymous-key")).toBe(true);
    expect(database.canonicalWriteAttempts).toBe(3);
    consoleError.mockRestore();
  });

  it("does not move anonymous ownership when deletion starts before finalization", async () => {
    database.states.set("anonymous-key", {
      payload: JSON.stringify(
        markWordKnown(createInitialState(), "idf-metro"),
      ),
      revision: 2,
      updated_at: Date.now(),
    });
    database.supportUsers = ["anonymous-key"];
    database.eventUsers = ["anonymous-key"];
    database.beforeOwnershipFinalize = () => {
      database.activeDeletionAccountIds.add("account-id");
    };
    resolveLearnerClaimKeys.mockResolvedValue({
      ok: true,
      accountId: "account-id",
      accountUserKey: "account-key",
      anonymousUserKey: "anonymous-key",
      accountStorageKey: "account-storage",
      anonymousStorageKey: "anonymous-storage",
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await POST(
      new Request("https://paretto.test/api/account/claim", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(database.states.has("anonymous-key")).toBe(true);
    expect(database.supportUsers).toEqual(["anonymous-key"]);
    expect(database.eventUsers).toEqual(["anonymous-key"]);
    consoleError.mockRestore();
  });

  it("requires an authenticated learner account", async () => {
    resolveLearnerClaimKeys.mockResolvedValue({ ok: false, status: 401 });
    const response = await POST(
      new Request("https://paretto.test/api/account/claim", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });
});
