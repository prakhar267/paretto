"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  createInitialState,
  mergeLearningStates,
  stateFromUnknown,
  type LearningState,
} from "./learning-engine";
import {
  prepareProgressCache,
  retireProgressCache,
  writeProgressCache,
  type LegacyCachePolicy,
  type OfflineCacheStatus,
} from "./progress-cache";
import { LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY } from "./progress-cache-identity";

export type SyncStatus = "loading" | "saved" | "saving" | "offline" | "error";
export type { OfflineCacheStatus } from "./progress-cache";

type ProgressApiResponse = {
  state: unknown;
  revision: number;
  generation?: number;
  savedAt: string | null;
};

// Stable legacy storage identity: changing this during the Paretto rebrand
// would strand existing anonymous-browser progress.
const DEFAULT_STORAGE_KEY = LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY;

export function useProgress(
  storageKey = DEFAULT_STORAGE_KEY,
  {
    legacyCachePolicy = "ignore",
  }: { legacyCachePolicy?: LegacyCachePolicy } = {},
): {
  state: LearningState;
  setState: Dispatch<SetStateAction<LearningState>>;
  status: SyncStatus;
  offlineCacheStatus: OfflineCacheStatus;
  ready: boolean;
  savedAt: string | null;
  retry: () => void;
  deleteProgress: () => Promise<boolean>;
  clearLocalProgress: () => boolean;
} {
  const [state, setStateInternal] = useState<LearningState>(() => createInitialState());
  const [status, setStatus] = useState<SyncStatus>("loading");
  const [offlineCacheStatus, setOfflineCacheStatus] =
    useState<OfflineCacheStatus>("checking");
  const [ready, setReady] = useState(false);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(
    null,
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const revisionRef = useRef(0);
  const generationRef = useRef(0);
  const hydratedRef = useRef(false);
  const serverLoadedRef = useRef(false);
  const latestStateRef = useRef(state);
  const savedAtRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);

  const setInternalState = useCallback((next: LearningState) => {
    latestStateRef.current = next;
    setStateInternal(next);
  }, []);

  const persistCache = useCallback(
    (nextState = latestStateRef.current) => {
      const available = writeProgressCache(storageKey, {
        cacheVersion: 1,
        state: nextState,
        revision: revisionRef.current,
        generation: generationRef.current,
        savedAt: savedAtRef.current,
        dirty: dirtyRef.current,
      });
      setOfflineCacheStatus(available ? "available" : "unavailable");
      return available;
    },
    [storageKey],
  );

  const setState = useCallback<Dispatch<SetStateAction<LearningState>>>(
    (action) => {
      const current = latestStateRef.current;
      const next =
        typeof action === "function"
          ? (action as (value: LearningState) => LearningState)(current)
          : action;
      dirtyRef.current = true;
      setStatus(isOnline() ? "saving" : "offline");
      setInternalState(next);
      persistCache(next);
    },
    [persistCache, setInternalState],
  );

  const saveLatest = useCallback(async () => {
    if (!hydratedRef.current || !dirtyRef.current) return;
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }

    savingRef.current = true;
    setStatus("saving");

    try {
      do {
        queuedRef.current = false;
        let snapshot = latestStateRef.current;
        let response = await putProgress(
          snapshot,
          revisionRef.current,
          generationRef.current,
          storageKey,
        );

        if (response.status === 401) {
          throw new Error("browser session unavailable");
        }

        if (response.status === 409) {
          const conflict = (await response.json().catch(() => null)) as {
            code?: unknown;
          } | null;
          if (conflict?.code === "IDENTITY_CHANGED") {
            throw new Error("browser learning identity changed");
          }
          const fresh = await fetch("/api/progress", {
            cache: "no-store",
            headers: {
              "x-paretto-progress-cache": storageKey,
            },
          });
          if (fresh.status === 401) {
            throw new Error("browser session unavailable");
          }
          if (!fresh.ok) throw new Error("progress conflict refresh failed");

          const server = (await fresh.json()) as ProgressApiResponse;
          const freshGeneration = progressGeneration(server);
          if (freshGeneration < generationRef.current) {
            // A response that began before a same-browser reset broadcast must
            // never roll this tab back across the monotonic reset boundary.
            queuedRef.current = dirtyRef.current;
            continue;
          }
          if (freshGeneration !== generationRef.current) {
            const canonical = stateFromUnknown(server.state);
            revisionRef.current = server.revision;
            generationRef.current = freshGeneration;
            savedAtRef.current = server.savedAt;
            setSavedAt(server.savedAt);
            dirtyRef.current = false;
            queuedRef.current = false;
            serverLoadedRef.current = true;
            setInternalState(canonical);
            persistCache(canonical);
            setStatus("saved");
            return;
          }
          const merged = mergeLearningStates(
            stateFromUnknown(server.state),
            latestStateRef.current,
          );
          revisionRef.current = server.revision;
          savedAtRef.current = server.savedAt;
          setSavedAt(server.savedAt);
          dirtyRef.current = true;
          snapshot = merged;
          setInternalState(merged);
          persistCache(merged);
          response = await putProgress(
            merged,
            server.revision,
            freshGeneration,
            storageKey,
          );
        }

        if (!response.ok) throw new Error(`progress save failed: ${response.status}`);

        const result = (await response.json()) as ProgressApiResponse;
        const resultGeneration = progressGeneration(result);
        if (resultGeneration < generationRef.current) {
          // This acknowledged write completed before a newer reset in another
          // tab. The reset marker already in memory is authoritative.
          queuedRef.current = dirtyRef.current;
          continue;
        }
        if (resultGeneration !== generationRef.current) {
          const canonical = stateFromUnknown(result.state);
          revisionRef.current = result.revision;
          generationRef.current = resultGeneration;
          savedAtRef.current = result.savedAt;
          setSavedAt(result.savedAt);
          dirtyRef.current = false;
          queuedRef.current = false;
          serverLoadedRef.current = true;
          setInternalState(canonical);
          persistCache(canonical);
          setStatus("saved");
          return;
        }
        revisionRef.current = result.revision;
        savedAtRef.current = result.savedAt;
        setSavedAt(result.savedAt);
        serverLoadedRef.current = true;

        if (latestStateRef.current === snapshot) {
          const canonical = stateFromUnknown(result.state);
          dirtyRef.current = false;
          setInternalState(canonical);
          persistCache(canonical);
        } else {
          queuedRef.current = true;
          persistCache();
        }
      } while (queuedRef.current);

      setStatus("saved");
    } catch (error) {
      console.error(error);
      dirtyRef.current = true;
      persistCache();
      setStatus(isOnline() ? "error" : "offline");
    } finally {
      savingRef.current = false;
    }
  }, [persistCache, setInternalState, storageKey]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const cacheRead = prepareProgressCache(storageKey, legacyCachePolicy);
    const cached = cacheRead.cache;
    queueMicrotask(() => {
      if (!cancelled) setOfflineCacheStatus(cacheRead.status);
    });

    hydratedRef.current = Boolean(cached);
    serverLoadedRef.current = false;
    dirtyRef.current = cached?.dirty ?? false;
    revisionRef.current = cached?.revision ?? 0;
    generationRef.current = cached?.generation ?? 0;
    savedAtRef.current = cached?.savedAt ?? null;

    async function load() {
      setSavedAt(cached?.savedAt ?? null);
      setHydratedStorageKey(storageKey);
      setReady(Boolean(cached));
      setStatus(cached ? (isOnline() ? "saving" : "offline") : "loading");
      if (cached) setInternalState(cached.state);

      try {
        const response = await fetch("/api/progress", {
          cache: "no-store",
          headers: {
            "x-paretto-progress-cache": storageKey,
          },
          signal: controller.signal,
        });
        if (response.status === 401) {
          throw new Error("browser session unavailable");
        }
        if (!response.ok) throw new Error(`progress load failed: ${response.status}`);

        const result = (await response.json()) as ProgressApiResponse;
        if (cancelled) return;

        const serverState = stateFromUnknown(result.state);
        const resultGeneration = progressGeneration(result);
        if (resultGeneration < generationRef.current) {
          // A reset storage event can overtake the initial network read.
          // Preserve the newer generation and its already-loaded clean state.
          setReady(true);
          setStatus(dirtyRef.current ? "saving" : "saved");
          return;
        }
        const hasPendingChanges =
          dirtyRef.current &&
          (cached?.generation ?? 0) === resultGeneration;
        const nextState = hasPendingChanges
          ? mergeLearningStates(serverState, latestStateRef.current)
          : serverState;
        revisionRef.current = result.revision;
        generationRef.current = resultGeneration;
        savedAtRef.current = result.savedAt;
        setSavedAt(result.savedAt);
        hydratedRef.current = true;
        serverLoadedRef.current = true;
        dirtyRef.current = hasPendingChanges;
        setInternalState(nextState);
        setReady(true);
        persistCache(nextState);

        if (hasPendingChanges) void saveLatest();
        else setStatus("saved");
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.error(error);
        if (cached) {
          hydratedRef.current = true;
          setReady(true);
        } else {
          hydratedRef.current = false;
          setReady(false);
        }
        setStatus(isOnline() ? "error" : "offline");
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    legacyCachePolicy,
    persistCache,
    retryToken,
    saveLatest,
    setInternalState,
    storageKey,
  ]);

  useEffect(() => {
    if (!hydratedRef.current || !dirtyRef.current) return;
    const timeout = window.setTimeout(() => void saveLatest(), 450);
    return () => window.clearTimeout(timeout);
  }, [state, saveLatest]);

  useEffect(() => {
    const updateNetworkState = () => {
      if (!navigator.onLine) {
        setStatus("offline");
      } else if (!serverLoadedRef.current) {
        setRetryToken((value) => value + 1);
      } else {
        void saveLatest();
      }
    };
    const flushPending = () => {
      persistCache();
      if (dirtyRef.current && serverLoadedRef.current) {
        void putProgress(
          latestStateRef.current,
          revisionRef.current,
          generationRef.current,
          storageKey,
        );
      }
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushPending();
    };

    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    window.addEventListener("pagehide", flushPending);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
      window.removeEventListener("pagehide", flushPending);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [persistCache, saveLatest, storageKey]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      const cached = readStorageEventCache(event.newValue);
      if (!cached) {
        serverLoadedRef.current = false;
        setRetryToken((value) => value + 1);
        return;
      }
      if (cached.generation <= generationRef.current) return;
      revisionRef.current = cached.revision;
      generationRef.current = cached.generation;
      savedAtRef.current = cached.savedAt;
      dirtyRef.current = cached.dirty;
      serverLoadedRef.current = !cached.dirty;
      hydratedRef.current = true;
      setInternalState(cached.state);
      setSavedAt(cached.savedAt);
      setHydratedStorageKey(storageKey);
      setReady(true);
      setStatus(cached.dirty ? "saving" : "saved");
      setOfflineCacheStatus("available");
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [setInternalState, storageKey]);

  const retry = useCallback(() => {
    if (!serverLoadedRef.current) {
      setRetryToken((value) => value + 1);
    } else if (dirtyRef.current) {
      void saveLatest();
    } else {
      setRetryToken((value) => value + 1);
    }
  }, [saveLatest]);

  const deleteProgress = useCallback(async () => {
    setStatus("saving");
    try {
      const response = await fetch("/api/progress", {
        method: "DELETE",
        headers: {
          "x-paretto-progress-cache": storageKey,
        },
        keepalive: true,
      });
      if (response.status === 401) {
        return false;
      }
      if (!response.ok) throw new Error(`progress delete failed: ${response.status}`);
      const result = (await response.json()) as ProgressApiResponse;
      const initial = stateFromUnknown(result.state);
      revisionRef.current = 0;
      generationRef.current = progressGeneration(result);
      savedAtRef.current = null;
      dirtyRef.current = false;
      serverLoadedRef.current = true;
      hydratedRef.current = true;
      // Keep only a body-free reset marker. Its generation broadcasts the hard
      // reset boundary to same-origin tabs and prevents their stale snapshots
      // from being merged before the next server read.
      const cacheRemoved = writeProgressCache(storageKey, {
        cacheVersion: 1,
        state: initial,
        revision: 0,
        generation: generationRef.current,
        savedAt: null,
        dirty: false,
      });
      setOfflineCacheStatus(
        cacheRemoved ? "available" : "unavailable",
      );
      setInternalState(initial);
      setSavedAt(null);
      setHydratedStorageKey(storageKey);
      setReady(true);
      setStatus("saved");
      return cacheRemoved;
    } catch (error) {
      console.error(error);
      persistCache();
      setStatus(isOnline() ? "error" : "offline");
      return false;
    }
  }, [persistCache, setInternalState, storageKey]);

  const clearLocalProgress = useCallback(() => {
    const initial = createInitialState();
    revisionRef.current = 0;
    generationRef.current = 0;
    savedAtRef.current = null;
    dirtyRef.current = false;
    serverLoadedRef.current = false;
    hydratedRef.current = true;
    const cacheRetired = retireProgressCache(storageKey);
    setOfflineCacheStatus(cacheRetired ? "available" : "unavailable");
    setInternalState(initial);
    setSavedAt(null);
    setHydratedStorageKey(storageKey);
    setReady(true);
    setStatus(cacheRetired ? "saved" : "error");
    return cacheRetired;
  }, [setInternalState, storageKey]);

  const readyForStorageKey = ready && hydratedStorageKey === storageKey;

  return {
    state,
    setState,
    status: hydratedStorageKey === storageKey ? status : "loading",
    offlineCacheStatus:
      hydratedStorageKey === storageKey ? offlineCacheStatus : "checking",
    ready: readyForStorageKey,
    savedAt,
    retry,
    deleteProgress,
    clearLocalProgress,
  };
}

function putProgress(
  state: LearningState,
  revision: number,
  generation: number,
  progressStorageKey: string,
) {
  return fetch("/api/progress", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      state,
      revision,
      generation,
      progressStorageKey,
    }),
    keepalive: true,
  });
}

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine;
}

function progressGeneration(response: ProgressApiResponse): number {
  return Number.isSafeInteger(response.generation) &&
    Number(response.generation) >= 0
    ? Number(response.generation)
    : 0;
}

function readStorageEventCache(value: string | null): {
  state: LearningState;
  revision: number;
  generation: number;
  savedAt: string | null;
  dirty: boolean;
} | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      parsed.cacheVersion !== 1 ||
      !Number.isSafeInteger(parsed.revision) ||
      Number(parsed.revision) < 0 ||
      !Number.isSafeInteger(parsed.generation) ||
      Number(parsed.generation) < 0 ||
      !parsed.state ||
      typeof parsed.state !== "object"
    ) {
      return null;
    }
    return {
      state: stateFromUnknown(parsed.state),
      revision: Number(parsed.revision),
      generation: Number(parsed.generation),
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
      dirty: parsed.dirty === true,
    };
  } catch {
    return null;
  }
}
