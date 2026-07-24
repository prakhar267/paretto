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

export type SyncStatus = "loading" | "saved" | "saving" | "offline" | "error";

type ProgressApiResponse = {
  state: unknown;
  revision: number;
  savedAt: string | null;
};

type ProgressCache = {
  cacheVersion: 1;
  state: unknown;
  revision: number;
  savedAt: string | null;
  dirty: boolean;
};

// Stable legacy storage identity: changing this during the Paretto rebrand
// would strand existing anonymous-browser progress.
const DEFAULT_STORAGE_KEY = "pas-a-pas-progress-v1:anonymous-browser";

export function useProgress(storageKey = DEFAULT_STORAGE_KEY): {
  state: LearningState;
  setState: Dispatch<SetStateAction<LearningState>>;
  status: SyncStatus;
  ready: boolean;
  savedAt: string | null;
  retry: () => void;
  deleteProgress: () => Promise<boolean>;
} {
  const [state, setStateInternal] = useState<LearningState>(() => createInitialState());
  const [status, setStatus] = useState<SyncStatus>("loading");
  const [ready, setReady] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const revisionRef = useRef(0);
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
      writeCache(storageKey, {
        cacheVersion: 1,
        state: nextState,
        revision: revisionRef.current,
        savedAt: savedAtRef.current,
        dirty: dirtyRef.current,
      });
    },
    [storageKey],
  );

  const setState = useCallback<Dispatch<SetStateAction<LearningState>>>(
    (action) => {
      setStateInternal((current) => {
        const next =
          typeof action === "function"
            ? (action as (value: LearningState) => LearningState)(current)
            : action;
        latestStateRef.current = next;
        dirtyRef.current = true;
        writeCache(storageKey, {
          cacheVersion: 1,
          state: next,
          revision: revisionRef.current,
          savedAt: savedAtRef.current,
          dirty: true,
        });
        return next;
      });
    },
    [storageKey],
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
        let response = await putProgress(snapshot, revisionRef.current);

        if (response.status === 401) {
          throw new Error("browser session unavailable");
        }

        if (response.status === 409) {
          const fresh = await fetch("/api/progress", { cache: "no-store" });
          if (fresh.status === 401) {
            throw new Error("browser session unavailable");
          }
          if (!fresh.ok) throw new Error("progress conflict refresh failed");

          const server = (await fresh.json()) as ProgressApiResponse;
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
          response = await putProgress(merged, server.revision);
        }

        if (!response.ok) throw new Error(`progress save failed: ${response.status}`);

        const result = (await response.json()) as ProgressApiResponse;
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
  }, [persistCache, setInternalState]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const cached = readCache(storageKey);

    hydratedRef.current = Boolean(cached);
    serverLoadedRef.current = false;
    dirtyRef.current = cached?.dirty ?? false;
    revisionRef.current = cached?.revision ?? 0;
    savedAtRef.current = cached?.savedAt ?? null;

    async function load() {
      setSavedAt(cached?.savedAt ?? null);
      setReady(Boolean(cached));
      setStatus(cached ? (isOnline() ? "saving" : "offline") : "loading");
      if (cached) setInternalState(cached.state);

      try {
        const response = await fetch("/api/progress", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401) {
          throw new Error("browser session unavailable");
        }
        if (!response.ok) throw new Error(`progress load failed: ${response.status}`);

        const result = (await response.json()) as ProgressApiResponse;
        if (cancelled) return;

        const serverState = stateFromUnknown(result.state);
        const hasPendingChanges = dirtyRef.current;
        const nextState = hasPendingChanges
          ? mergeLearningStates(serverState, latestStateRef.current)
          : serverState;
        revisionRef.current = result.revision;
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
  }, [persistCache, retryToken, saveLatest, setInternalState, storageKey]);

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
        void putProgress(latestStateRef.current, revisionRef.current);
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
  }, [persistCache, saveLatest]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || event.newValue !== null) return;
      const initial = createInitialState();
      revisionRef.current = 0;
      savedAtRef.current = null;
      dirtyRef.current = false;
      serverLoadedRef.current = true;
      hydratedRef.current = true;
      setInternalState(initial);
      setSavedAt(null);
      setReady(true);
      setStatus("saved");
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
        keepalive: true,
      });
      if (response.status === 401) {
        return false;
      }
      if (!response.ok) throw new Error(`progress delete failed: ${response.status}`);
      const result = (await response.json()) as ProgressApiResponse;
      const initial = stateFromUnknown(result.state);
      revisionRef.current = 0;
      savedAtRef.current = null;
      dirtyRef.current = false;
      serverLoadedRef.current = true;
      hydratedRef.current = true;
      window.localStorage.removeItem(storageKey);
      setInternalState(initial);
      setSavedAt(null);
      setReady(true);
      setStatus("saved");
      return true;
    } catch (error) {
      console.error(error);
      persistCache();
      setStatus(isOnline() ? "error" : "offline");
      return false;
    }
  }, [persistCache, setInternalState, storageKey]);

  return { state, setState, status, ready, savedAt, retry, deleteProgress };
}

function readCache(storageKey: string): {
  state: LearningState;
  revision: number;
  savedAt: string | null;
  dirty: boolean;
} | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as ProgressCache | null;
    if (!parsed || parsed.cacheVersion !== 1) return null;
    if (!Number.isInteger(parsed.revision) || parsed.revision < 0) return null;
    if (!parsed.state || typeof parsed.state !== "object" || (parsed.state as { version?: unknown }).version !== 1) return null;
    return {
      state: stateFromUnknown(parsed.state),
      revision: parsed.revision,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
      dirty: parsed.dirty === true,
    };
  } catch {
    return null;
  }
}

function writeCache(storageKey: string, cache: ProgressCache) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(cache));
  } catch {
    // Network persistence still works when browser storage is unavailable.
  }
}

function putProgress(state: LearningState, revision: number) {
  return fetch("/api/progress", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, revision }),
    keepalive: true,
  });
}

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine;
}
