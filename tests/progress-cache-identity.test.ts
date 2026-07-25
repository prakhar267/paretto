// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY,
  scopedProgressStorageKey,
  selectProgressCacheBootIdentity,
} from "../app/progress-cache-identity";
import {
  prepareProgressCache,
  readProgressCache,
  transitionClaimedProgressCache,
  writeProgressCache,
} from "../app/progress-cache";
import {
  createInitialState,
  markWordKnown,
  type LearningState,
} from "../app/learning-engine";
import { getOrCreateRewardReplicaId } from "../app/reward-replica";

const ACCOUNT_A_SCOPE = "a".repeat(64);
const ACCOUNT_B_SCOPE = "b".repeat(64);
const ANONYMOUS_SCOPE = "c".repeat(64);

describe("identity-scoped progress cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses different opaque reward replicas for different identities", () => {
    const accountAReplica = getOrCreateRewardReplicaId(
      "reward-account-a-scope",
    );
    const accountBReplica = getOrCreateRewardReplicaId(
      "reward-account-b-scope",
    );
    const anonymousReplica = getOrCreateRewardReplicaId(
      "reward-anonymous-scope",
    );

    expect(new Set([
      accountAReplica,
      accountBReplica,
      anonymousReplica,
    ]).size).toBe(3);
    expect(accountAReplica).toMatch(/^web2:/);
    expect(accountBReplica).not.toContain("reward-account-b-scope");
  });

  it("uses separate account caches and resets a claimed anonymous identity after session expiry", () => {
    const accountA = selectProgressCacheBootIdentity({
      accountId: "account-a",
      accountScope: ACCOUNT_A_SCOPE,
      anonymousScope: ANONYMOUS_SCOPE,
      anonymousIdentityClaimed: true,
    });
    const accountB = selectProgressCacheBootIdentity({
      accountId: "account-b",
      accountScope: ACCOUNT_B_SCOPE,
      anonymousScope: ANONYMOUS_SCOPE,
      anonymousIdentityClaimed: true,
    });
    const expired = selectProgressCacheBootIdentity({
      accountId: null,
      accountScope: null,
      anonymousScope: ANONYMOUS_SCOPE,
      anonymousIdentityClaimed: true,
    });

    expect(accountA.kind).toBe("account");
    expect(accountB.kind).toBe("account");
    if (accountA.kind !== "account" || accountB.kind !== "account") {
      throw new Error("Expected account cache identities.");
    }
    expect(accountA.storageKey).not.toBe(accountB.storageKey);
    expect(expired).toEqual({
      kind: "reset-anonymous",
      accountId: null,
      reason: "claimed-browser-identity",
    });
    expect(expired).not.toHaveProperty("storageKey");
  });

  it("migrates the legacy cache only for a server-confirmed unclaimed anonymous identity", () => {
    const state = {
      ...createInitialState(),
      displayName: "Anonymous learner",
      xp: 45,
    };
    writeProgressCache(LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY, {
      cacheVersion: 1,
      state,
      revision: 4,
      savedAt: null,
      dirty: true,
    });
    const anonymousKey = scopedProgressStorageKey(
      "anonymous",
      ANONYMOUS_SCOPE,
    );

    const migrated = prepareProgressCache(
      anonymousKey,
      "migrate-anonymous",
    );

    expect(migrated.cache?.state).toMatchObject({
      displayName: "Anonymous learner",
      xp: 45,
    });
    expect(readProgressCache(anonymousKey).cache).toMatchObject({
      revision: 4,
      dirty: true,
    });
    expect(
      window.localStorage.getItem(LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY),
    ).toBeNull();
  });

  it("moves a successful claim into only its account cache and leaves another account untouched", async () => {
    const accountAKey = scopedProgressStorageKey(
      "account",
      ACCOUNT_A_SCOPE,
    );
    const accountBKey = scopedProgressStorageKey(
      "account",
      ACCOUNT_B_SCOPE,
    );
    const anonymousKey = scopedProgressStorageKey(
      "anonymous",
      ANONYMOUS_SCOPE,
    );
    const otherAccount = {
      ...createInitialState(),
      displayName: "Account B",
      xp: 80,
    };
    writeProgressCache(accountBKey, {
      cacheVersion: 1,
      state: otherAccount,
      revision: 8,
      savedAt: null,
      dirty: false,
    });
    writeProgressCache(anonymousKey, {
      cacheVersion: 1,
      state: {
        ...createInitialState(),
        displayName: "Anonymous learner",
        xp: 20,
      },
      revision: 2,
      savedAt: null,
      dirty: true,
    });
    writeProgressCache(LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY, {
      cacheVersion: 1,
      state: {
        ...createInitialState(),
        displayName: "Legacy learner",
      },
      revision: 1,
      savedAt: null,
      dirty: true,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          state: LearningState;
          revision: number;
        };
        return Response.json({
          state: request.state,
          revision: request.revision + 1,
          savedAt: "2026-07-25T01:01:00.000Z",
        });
      }),
    );

    await expect(
      transitionClaimedProgressCache({
        state: {
          ...createInitialState(),
          displayName: "Account A",
          xp: 30,
        },
        revision: 3,
        savedAt: "2026-07-25T01:00:00.000Z",
        cacheTransition: {
          accountStorageKey: accountAKey,
          anonymousStorageKey: anonymousKey,
        },
      }),
    ).resolves.toBe(true);

    expect(readProgressCache(accountAKey).cache).toMatchObject({
      revision: 4,
      dirty: false,
      state: { xp: 30 },
    });
    expect(readProgressCache(accountBKey).cache).toMatchObject({
      revision: 8,
      state: { displayName: "Account B", xp: 80 },
    });
    expect(window.localStorage.getItem(anonymousKey)).toBeNull();
    expect(
      window.localStorage.getItem(LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY),
    ).toBeNull();
  });

  it("never reads or retires a dirty anonymous cache when the server denied that ownership", async () => {
    const accountKey = scopedProgressStorageKey(
      "account",
      ACCOUNT_B_SCOPE,
    );
    const anonymousKey = scopedProgressStorageKey(
      "anonymous",
      ANONYMOUS_SCOPE,
    );
    writeProgressCache(anonymousKey, {
      cacheVersion: 1,
      state: {
        ...createInitialState(),
        displayName: "Account A private cache",
        xp: 999,
      },
      revision: 9,
      savedAt: null,
      dirty: true,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transitionClaimedProgressCache({
        state: {
          ...createInitialState(),
          displayName: "Account B",
          xp: 10,
        },
        revision: 1,
        savedAt: "2026-07-25T01:00:00.000Z",
        cacheTransition: {
          accountStorageKey: accountKey,
          anonymousStorageKey: null,
        },
      }),
    ).resolves.toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(readProgressCache(accountKey).cache).toMatchObject({
      state: { displayName: "Account B", xp: 10 },
      dirty: false,
    });
    expect(readProgressCache(anonymousKey).cache).toMatchObject({
      state: { displayName: "Account A private cache", xp: 999 },
      dirty: true,
    });
  });

  it("merges a dirty anonymous handoff through a 409 before retiring its only local copy", async () => {
    const accountKey = scopedProgressStorageKey(
      "account",
      ACCOUNT_A_SCOPE,
    );
    const anonymousKey = scopedProgressStorageKey(
      "anonymous",
      ANONYMOUS_SCOPE,
    );
    const anonymousState = markWordKnown(
      {
        ...createInitialState(),
        displayName: "Pending learner",
      },
      "idf-metro",
    );
    const claimedState = markWordKnown(
      createInitialState(),
      "idf-musee",
    );
    const concurrentAccountState = markWordKnown(
      claimedState,
      "idf-banlieue",
    );
    writeProgressCache(anonymousKey, {
      cacheVersion: 1,
      state: anonymousState,
      revision: 2,
      savedAt: null,
      dirty: true,
    });

    let putCount = 0;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return Response.json({
            state: concurrentAccountState,
            revision: 5,
            savedAt: "2026-07-25T02:01:00.000Z",
          });
        }
        putCount += 1;
        if (putCount === 1) {
          return Response.json(
            { error: "revision conflict" },
            { status: 409 },
          );
        }
        const request = JSON.parse(String(init?.body)) as {
          state: LearningState;
          revision: number;
        };
        expect(request.revision).toBe(5);
        expect(Object.keys(request.state.wordProgress).sort()).toEqual([
          "idf-banlieue",
          "idf-metro",
          "idf-musee",
        ]);
        return Response.json({
          state: request.state,
          revision: 6,
          savedAt: "2026-07-25T02:02:00.000Z",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transitionClaimedProgressCache({
        state: claimedState,
        revision: 4,
        savedAt: "2026-07-25T02:00:00.000Z",
        cacheTransition: {
          accountStorageKey: accountKey,
          anonymousStorageKey: anonymousKey,
        },
      }),
    ).resolves.toBe(true);

    expect(putCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      Object.keys(
        readProgressCache(accountKey).cache!.state.wordProgress,
      ).sort(),
    ).toEqual(["idf-banlieue", "idf-metro", "idf-musee"]);
    expect(readProgressCache(accountKey).cache).toMatchObject({
      revision: 6,
      dirty: false,
    });
    expect(window.localStorage.getItem(anonymousKey)).toBeNull();
  });

  it("keeps the dirty anonymous cache when neither account storage nor the server accepts the handoff", async () => {
    const accountKey = scopedProgressStorageKey(
      "account",
      ACCOUNT_A_SCOPE,
    );
    const anonymousKey = scopedProgressStorageKey(
      "anonymous",
      ANONYMOUS_SCOPE,
    );
    const anonymousState = markWordKnown(
      createInitialState(),
      "idf-metro",
    );
    writeProgressCache(anonymousKey, {
      cacheVersion: 1,
      state: anonymousState,
      revision: 2,
      savedAt: null,
      dirty: true,
    });
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === accountKey) {
        throw new DOMException("Storage blocked", "SecurityError");
      }
      return originalSetItem.call(this, key, value);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Network unavailable");
      }),
    );

    await expect(
      transitionClaimedProgressCache({
        state: createInitialState(),
        revision: 3,
        savedAt: null,
        cacheTransition: {
          accountStorageKey: accountKey,
          anonymousStorageKey: anonymousKey,
        },
      }),
    ).resolves.toBe(false);

    expect(readProgressCache(anonymousKey).cache).toMatchObject({
      revision: 2,
      dirty: true,
      state: {
        wordProgress: {
          "idf-metro": expect.any(Object),
        },
      },
    });
  });

  it("does not hand off dirty cache data from a reset generation", async () => {
    const accountKey = scopedProgressStorageKey(
      "account",
      ACCOUNT_A_SCOPE,
    );
    const anonymousKey = scopedProgressStorageKey(
      "anonymous",
      ANONYMOUS_SCOPE,
    );
    writeProgressCache(accountKey, {
      cacheVersion: 1,
      state: {
        ...createInitialState(),
        displayName: "Stale account",
        xp: 800,
      },
      revision: 9,
      generation: 0,
      savedAt: null,
      dirty: true,
    });
    writeProgressCache(anonymousKey, {
      cacheVersion: 1,
      state: {
        ...createInitialState(),
        displayName: "Stale anonymous",
        xp: 900,
      },
      revision: 8,
      generation: 0,
      savedAt: null,
      dirty: true,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transitionClaimedProgressCache({
        state: {
          ...createInitialState(),
          displayName: "Reset account",
          xp: 0,
        },
        revision: 0,
        generation: 1,
        savedAt: null,
        cacheTransition: {
          accountStorageKey: accountKey,
          anonymousStorageKey: anonymousKey,
          anonymousGeneration: 1,
        },
      }),
    ).resolves.toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(readProgressCache(accountKey).cache).toMatchObject({
      revision: 0,
      generation: 1,
      dirty: false,
      state: { displayName: "Reset account", xp: 0 },
    });
    expect(window.localStorage.getItem(anonymousKey)).toBeNull();
  });

  it("does not downgrade an account cache when a reset overtakes the claim response", async () => {
    const accountKey = scopedProgressStorageKey(
      "account",
      ACCOUNT_A_SCOPE,
    );
    writeProgressCache(accountKey, {
      cacheVersion: 1,
      state: {
        ...createInitialState(),
        displayName: "New generation",
      },
      revision: 0,
      generation: 2,
      savedAt: null,
      dirty: false,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transitionClaimedProgressCache({
        state: {
          ...createInitialState(),
          displayName: "Overtaken claim",
          xp: 700,
        },
        revision: 4,
        generation: 1,
        savedAt: null,
        cacheTransition: {
          accountStorageKey: accountKey,
          anonymousStorageKey: null,
          anonymousGeneration: null,
        },
      }),
    ).resolves.toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(readProgressCache(accountKey).cache).toMatchObject({
      generation: 2,
      revision: 0,
      state: { displayName: "New generation", xp: 0 },
    });
  });
});
