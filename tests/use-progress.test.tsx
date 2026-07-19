// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createInitialState,
  type LearningState,
  type WordProgress,
} from "../app/learning-engine";
import { useProgress } from "../app/use-progress";

const STORAGE_KEY = "pas-a-pas-progress-test";
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
  window.localStorage.setItem(
    STORAGE_KEY,
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
  dirty: boolean;
} {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as {
    state: LearningState;
    revision: number;
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

  it("deletes remote progress and removes the persisted browser cache", async () => {
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
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(result.current.status).toBe("saved");
    expect(result.current.ready).toBe(true);
    expect(result.current.savedAt).toBeNull();
    expect(result.current.state).toMatchObject({
      onboarded: false,
      xp: 0,
      wordProgress: {},
    });
  });
});
