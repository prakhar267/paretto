// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createInitialState,
  type LearningState,
  type WordProgress,
} from "../app/learning-engine";
import { useProgress } from "../app/use-progress";

const STORAGE_KEY = "paretto-progress-test";
const BASE_TIME = new Date("2026-07-20T08:00:00.000Z");

type ProgressRequest = {
  state: LearningState;
  revision: number;
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function progressAt(timestamp: string, stage: 1 | 2 = 1): WordProgress {
  return {
    stage,
    seen: stage,
    correct: stage,
    incorrect: 0,
    nextReviewAt: new Date(
      new Date(timestamp).getTime() + 24 * 60 * 60 * 1000,
    ).toISOString(),
    lastReviewedAt: timestamp,
  };
}

function stateWithWord(
  wordId: "idf-metro" | "idf-musee",
  timestamp: string,
  xp: number,
): LearningState {
  return {
    ...createInitialState(new Date(timestamp)),
    onboarded: true,
    displayName: wordId === "idf-metro" ? "Local learner" : "Server learner",
    xp,
    wordProgress: { [wordId]: progressAt(timestamp, wordId === "idf-metro" ? 1 : 2) },
    updatedAt: timestamp,
  };
}

function writeCache(
  state: LearningState,
  { revision = 0, dirty = true }: { revision?: number; dirty?: boolean } = {},
) {
  writeCacheAt(STORAGE_KEY, state, { revision, dirty });
}

function writeCacheAt(
  storageKey: string,
  state: LearningState,
  { revision = 0, dirty = true }: { revision?: number; dirty?: boolean } = {},
) {
  window.localStorage.setItem(
    storageKey,
    JSON.stringify({
      cacheVersion: 1,
      state,
      revision,
      savedAt: null,
      dirty,
    }),
  );
}

function readCache(): {
  state: LearningState;
  revision: number;
  generation?: number;
  dirty: boolean;
} {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as {
    state: LearningState;
    revision: number;
    generation?: number;
    dirty: boolean;
  };
}

describe("useProgress persistence hardening", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps a dirty cached state available when the initial load fails offline", async () => {
    const pending = stateWithWord(
      "idf-metro",
      "2026-07-20T09:00:00.000Z",
      35,
    );
    writeCache(pending, { revision: 7, dirty: true });
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false,
    });

    const fetchMock = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProgress(STORAGE_KEY));

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
      expect(result.current.status).toBe("offline");
    });

    expect(result.current.state.xp).toBe(35);
    expect(result.current.state.wordProgress["idf-metro"]).toEqual(
      pending.wordProgress["idf-metro"],
    );
    expect(readCache()).toMatchObject({
      revision: 7,
      dirty: true,
      state: {
        xp: 35,
        wordProgress: { "idf-metro": pending.wordProgress["idf-metro"] },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("unions server and local learning progress after a 409 conflict", async () => {
    const local = stateWithWord(
      "idf-metro",
      "2026-07-20T09:00:00.000Z",
      40,
    );
    const initialServer = createInitialState(BASE_TIME);
    const conflictingServer = stateWithWord(
      "idf-musee",
      "2026-07-20T10:00:00.000Z",
      70,
    );
    writeCache(local, { revision: 4, dirty: true });

    let getCount = 0;
    let putCount = 0;
    const putRequests: ProgressRequest[] = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          getCount += 1;
          return getCount === 1
            ? jsonResponse({ state: initialServer, revision: 4, savedAt: null })
            : jsonResponse({
                state: conflictingServer,
                revision: 5,
                savedAt: "2026-07-20T10:01:00.000Z",
              });
        }

        const request = JSON.parse(String(init?.body)) as ProgressRequest;
        putRequests.push(request);
        putCount += 1;
        if (putCount === 1) {
          return jsonResponse({ error: "revision_conflict" }, 409);
        }
        return jsonResponse({
          state: request.state,
          revision: 6,
          savedAt: "2026-07-20T10:02:00.000Z",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProgress(STORAGE_KEY));

    await waitFor(() => expect(result.current.status).toBe("saved"));

    expect(getCount).toBe(2);
    expect(putCount).toBe(2);
    expect(putRequests[0]).toMatchObject({ revision: 4 });
    expect(putRequests[1]).toMatchObject({ revision: 5 });
    expect(Object.keys(putRequests[1].state.wordProgress)).toEqual(
      expect.arrayContaining(["idf-metro", "idf-musee"]),
    );
    expect(result.current.state.wordProgress).toHaveProperty("idf-metro");
    expect(result.current.state.wordProgress).toHaveProperty("idf-musee");
    expect(result.current.state.xp).toBe(70);
    expect(readCache()).toMatchObject({
      revision: 6,
      dirty: false,
      state: {
        xp: 70,
        wordProgress: {
          "idf-metro": expect.any(Object),
          "idf-musee": expect.any(Object),
        },
      },
    });
  });

  it("retries a failed save directly without reloading over local edits", async () => {
    const server = createInitialState(BASE_TIME);
    let getCount = 0;
    let putCount = 0;
    const putRequests: ProgressRequest[] = [];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          getCount += 1;
          return jsonResponse({ state: server, revision: 8, savedAt: null });
        }

        const request = JSON.parse(String(init?.body)) as ProgressRequest;
        putRequests.push(request);
        putCount += 1;
        if (putCount === 1) return jsonResponse({ error: "temporary" }, 503);
        return jsonResponse({
          state: request.state,
          revision: 9,
          savedAt: "2026-07-20T11:00:00.000Z",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProgress(STORAGE_KEY));
    await waitFor(() => expect(result.current.status).toBe("saved"));

    act(() => {
      result.current.setState((current) => ({
        ...current,
        xp: 25,
        wordProgress: {
          ...current.wordProgress,
          "idf-metro": progressAt("2026-07-20T10:30:00.000Z"),
        },
        updatedAt: "2026-07-20T10:30:00.000Z",
      }));
    });

    await waitFor(() => expect(result.current.status).toBe("error"), {
      timeout: 2_000,
    });
    expect(getCount).toBe(1);
    expect(putCount).toBe(1);
    expect(result.current.state.wordProgress).toHaveProperty("idf-metro");
    expect(readCache()).toMatchObject({ dirty: true, state: { xp: 25 } });

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("saved"));

    expect(getCount).toBe(1);
    expect(putCount).toBe(2);
    expect(putRequests[1]).toMatchObject({
      revision: 8,
      state: { xp: 25 },
    });
    expect(putRequests[1].state.wordProgress).toHaveProperty("idf-metro");
    expect(result.current.state.wordProgress).toHaveProperty("idf-metro");
    expect(readCache()).toMatchObject({
      revision: 9,
      dirty: false,
      state: { xp: 25 },
    });
  });

  it("surfaces cache write failures while continuing to save to the server", async () => {
    const server = createInitialState(BASE_TIME);
    let putCount = 0;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          return jsonResponse({ state: server, revision: 2, savedAt: null });
        }

        const request = JSON.parse(String(init?.body)) as ProgressRequest;
        putCount += 1;
        return jsonResponse({
          state: request.state,
          revision: 3,
          savedAt: "2026-07-20T11:30:00.000Z",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProgress(STORAGE_KEY));
    await waitFor(() => {
      expect(result.current.status).toBe("saved");
      expect(result.current.offlineCacheStatus).toBe("available");
    });

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });

    act(() => {
      result.current.setState((current) => ({
        ...current,
        xp: 45,
        updatedAt: "2026-07-20T11:29:00.000Z",
      }));
    });

    await waitFor(
      () => {
        expect(putCount).toBe(1);
        expect(result.current.status).toBe("saved");
        expect(result.current.offlineCacheStatus).toBe("unavailable");
      },
      { timeout: 2_000 },
    );
    expect(result.current.state.xp).toBe(45);
  });

  it("deletes remote progress and replaces the persisted cache with a reset marker", async () => {
    const server = stateWithWord(
      "idf-metro",
      "2026-07-20T09:00:00.000Z",
      55,
    );
    const reset = createInitialState(new Date("2026-07-20T12:00:00.000Z"));
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "DELETE") {
          return jsonResponse({
            state: reset,
            revision: 0,
            generation: 1,
            savedAt: null,
          });
        }
        return jsonResponse({
          state: server,
          revision: 3,
          savedAt: "2026-07-20T09:01:00.000Z",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProgress(STORAGE_KEY));
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    let deleted = false;
    await act(async () => {
      deleted = await result.current.deleteProgress();
    });

    expect(deleted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/progress",
      expect.objectContaining({ method: "DELETE", keepalive: true }),
    );
    expect(readCache()).toMatchObject({
      revision: 0,
      generation: 1,
      dirty: false,
      state: { xp: 0, wordProgress: {} },
    });
    expect(result.current.status).toBe("saved");
    expect(result.current.ready).toBe(true);
    expect(result.current.savedAt).toBeNull();
    expect(result.current.state).toMatchObject({
      onboarded: false,
      xp: 0,
      wordProgress: {},
    });
  });

  it("surfaces reset-marker write failures after deleting remote progress", async () => {
    const server = stateWithWord(
      "idf-metro",
      "2026-07-20T09:00:00.000Z",
      55,
    );
    const reset = createInitialState(new Date("2026-07-20T12:00:00.000Z"));
    let deleteCount = 0;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "DELETE") {
          deleteCount += 1;
          return jsonResponse({ state: reset, revision: 0, savedAt: null });
        }
        return jsonResponse({
          state: server,
          revision: 3,
          savedAt: "2026-07-20T09:01:00.000Z",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProgress(STORAGE_KEY));
    await waitFor(() => expect(result.current.status).toBe("saved"));

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });

    let deleted = true;
    await act(async () => {
      deleted = await result.current.deleteProgress();
    });

    expect(deleteCount).toBe(1);
    expect(deleted).toBe(false);
    expect(result.current.status).toBe("saved");
    expect(result.current.offlineCacheStatus).toBe("unavailable");
    expect(result.current.state).toMatchObject({
      onboarded: false,
      xp: 0,
      wordProgress: {},
    });
    // Storage denied the reset-marker write, so the old local bytes may remain.
    // Their older generation can no longer pass the server's write guard.
    expect(readCache()).toMatchObject({
      revision: 3,
      state: { xp: 55 },
    });
  });

  it("keeps account errors renderable when local cache retirement is blocked", async () => {
    const server = stateWithWord(
      "idf-metro",
      "2026-07-20T09:00:00.000Z",
      55,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          state: server,
          revision: 3,
          generation: 0,
          savedAt: "2026-07-20T09:01:00.000Z",
        }),
      ),
    );

    const { result } = renderHook(() => useProgress(STORAGE_KEY));
    await waitFor(() => expect(result.current.status).toBe("saved"));

    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is unavailable", "SecurityError");
    });

    let cleared = true;
    act(() => {
      cleared = result.current.clearLocalProgress();
    });

    expect(cleared).toBe(false);
    expect(result.current.ready).toBe(true);
    expect(result.current.status).toBe("error");
    expect(result.current.offlineCacheStatus).toBe("unavailable");
    expect(result.current.state).toMatchObject({
      onboarded: false,
      xp: 0,
      wordProgress: {},
    });
  });

  it("never renders or saves dirty account A state after the cache scope changes to account B", async () => {
    const accountAKey = "paretto-progress-v2:account:" + "a".repeat(64);
    const accountBKey = "paretto-progress-v2:account:" + "b".repeat(64);
    writeCacheAt(
      accountAKey,
      {
        ...createInitialState(BASE_TIME),
        onboarded: true,
        displayName: "Account A",
        xp: 55,
      },
      { revision: 5, dirty: true },
    );
    writeCacheAt(
      accountBKey,
      {
        ...createInitialState(BASE_TIME),
        onboarded: true,
        displayName: "Account B",
        xp: 10,
      },
      { revision: 2, dirty: false },
    );

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const renderTrace: Array<{
      storageKey: string;
      ready: boolean;
      displayName: string;
    }> = [];

    const { result, rerender } = renderHook(
      ({ storageKey }: { storageKey: string }) => {
        const progress = useProgress(storageKey);
        renderTrace.push({
          storageKey,
          ready: progress.ready,
          displayName: progress.state.displayName,
        });
        return progress;
      },
      { initialProps: { storageKey: accountAKey } },
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
      expect(result.current.state.displayName).toBe("Account A");
    });

    rerender({ storageKey: accountBKey });
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
      expect(result.current.state.displayName).toBe("Account B");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    });

    expect(
      renderTrace.some(
        (entry) =>
          entry.storageKey === accountBKey &&
          entry.ready &&
          entry.displayName === "Account A",
      ),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
  });

  it("discards a dirty cached snapshot when another device advanced the reset generation", async () => {
    const stale = stateWithWord(
      "idf-metro",
      "2026-07-20T09:00:00.000Z",
      90,
    );
    const reset = createInitialState(
      new Date("2026-07-20T12:00:00.000Z"),
    );
    writeCache(stale, { revision: 8, dirty: true });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return jsonResponse({
          state: reset,
          revision: 0,
          generation: 1,
          savedAt: null,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProgress(STORAGE_KEY));
    await waitFor(() => expect(result.current.status).toBe("saved"));

    expect(result.current.state).toMatchObject({
      onboarded: false,
      xp: 0,
      wordProgress: {},
    });
    expect(readCache()).toMatchObject({
      revision: 0,
      generation: 1,
      dirty: false,
      state: { xp: 0, wordProgress: {} },
    });
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
  });

  it("drops in-memory edits after a generation conflict instead of merging them into the reset state", async () => {
    const beforeReset = createInitialState(BASE_TIME);
    const reset = createInitialState(
      new Date("2026-07-20T13:00:00.000Z"),
    );
    let getCount = 0;
    let putCount = 0;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          getCount += 1;
          return getCount === 1
            ? jsonResponse({
                state: beforeReset,
                revision: 2,
                generation: 0,
                savedAt: null,
              })
            : jsonResponse({
                state: reset,
                revision: 0,
                generation: 1,
                savedAt: null,
              });
        }
        putCount += 1;
        const request = JSON.parse(String(init?.body)) as {
          generation: number;
        };
        expect(request.generation).toBe(0);
        return jsonResponse(
          {
            error: "reset on another device",
            code: "GENERATION_CONFLICT",
            generation: 1,
          },
          409,
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useProgress(STORAGE_KEY));
    await waitFor(() => expect(result.current.status).toBe("saved"));

    act(() => {
      result.current.setState((current) => ({
        ...current,
        xp: 120,
        wordProgress: {
          ...current.wordProgress,
          "idf-metro": progressAt("2026-07-20T12:30:00.000Z"),
        },
      }));
    });
    await waitFor(() => {
      expect(putCount).toBe(1);
      expect(result.current.status).toBe("saved");
      expect(result.current.state.xp).toBe(0);
    });

    expect(getCount).toBe(2);
    expect(result.current.state.wordProgress).toEqual({});
    expect(readCache()).toMatchObject({
      generation: 1,
      revision: 0,
      dirty: false,
      state: { xp: 0, wordProgress: {} },
    });
  });

  it("never lets an older in-flight GET overtake a newer tab reset marker", async () => {
    const staleServer = stateWithWord(
      "idf-metro",
      "2026-07-20T09:00:00.000Z",
      300,
    );
    const reset = createInitialState(
      new Date("2026-07-20T14:00:00.000Z"),
    );
    let resolveGet!: (response: Response) => void;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Promise<Response>((resolve) => {
          resolveGet = resolve;
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useProgress(STORAGE_KEY));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const marker = JSON.stringify({
      cacheVersion: 1,
      state: reset,
      revision: 0,
      generation: 1,
      savedAt: null,
      dirty: false,
    });
    window.localStorage.setItem(STORAGE_KEY, marker);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: marker,
          storageArea: window.localStorage,
        }),
      );
    });
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
      expect(result.current.state.xp).toBe(0);
    });

    await act(async () => {
      resolveGet(
        jsonResponse({
          state: staleServer,
          revision: 6,
          generation: 0,
          savedAt: "2026-07-20T09:01:00.000Z",
        }),
      );
      await Promise.resolve();
    });

    expect(result.current.state.xp).toBe(0);
    expect(result.current.state.wordProgress).toEqual({});
    expect(readCache()).toMatchObject({
      generation: 1,
      revision: 0,
      state: { xp: 0, wordProgress: {} },
    });
  });
});
