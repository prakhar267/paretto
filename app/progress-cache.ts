import {
  isolateRewardReplicaCollisions,
  mergeLearningStates,
  stateFromUnknown,
  STATE_VERSION,
  type LearningState,
} from "@/app/learning-engine";
import { LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY } from "@/app/progress-cache-identity";

export type OfflineCacheStatus = "checking" | "available" | "unavailable";
export type LegacyCachePolicy =
  | "ignore"
  | "migrate-anonymous"
  | "discard";

export type ProgressCache = {
  cacheVersion: 1;
  state: unknown;
  revision: number;
  /**
   * Missing only on legacy pre-reset caches. Readers normalize it to zero so
   * the first server response can safely decide whether that cache is current.
   */
  generation?: number;
  savedAt: string | null;
  dirty: boolean;
};

export type ReadProgressCacheResult = {
  status: Exclude<OfflineCacheStatus, "checking">;
  cache: {
    state: LearningState;
    revision: number;
    generation: number;
    savedAt: string | null;
    dirty: boolean;
  } | null;
};

export function prepareProgressCache(
  storageKey: string,
  legacyCachePolicy: LegacyCachePolicy,
): ReadProgressCacheResult {
  const scoped = readProgressCache(storageKey);
  if (legacyCachePolicy === "ignore") return scoped;

  if (legacyCachePolicy === "discard") {
    const retired = retireProgressCache(
      LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY,
    );
    return {
      ...scoped,
      status:
        scoped.status === "available" && retired
          ? "available"
          : "unavailable",
    };
  }

  if (scoped.cache) {
    const retired = retireProgressCache(
      LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY,
    );
    return {
      ...scoped,
      status:
        scoped.status === "available" && retired
          ? "available"
          : "unavailable",
    };
  }

  const legacy = readProgressCache(
    LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY,
  );
  if (!legacy.cache) {
    const retired = retireProgressCache(
      LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY,
    );
    return {
      status:
        scoped.status === "available" &&
        legacy.status === "available" &&
        retired
          ? "available"
          : "unavailable",
      cache: null,
    };
  }

  const migrated = writeProgressCache(storageKey, {
    cacheVersion: 1,
    state: legacy.cache.state,
    revision: legacy.cache.revision,
    generation: legacy.cache.generation,
    savedAt: legacy.cache.savedAt,
    dirty: legacy.cache.dirty,
  });
  const retired = migrated
    ? retireProgressCache(LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY)
    : false;
  return {
    status:
      migrated && retired && legacy.status === "available"
        ? "available"
        : "unavailable",
    cache: legacy.cache,
  };
}

type ProgressApiResponse = {
  state: unknown;
  revision: number;
  generation: number;
  savedAt: string | null;
};

const MAX_CLAIM_CACHE_SYNC_ATTEMPTS = 3;

export async function transitionClaimedProgressCache(
  payload: unknown,
): Promise<boolean> {
  if (!isRecord(payload) || !isRecord(payload.cacheTransition)) return false;
  const transition = payload.cacheTransition;
  if (
    typeof transition.accountStorageKey !== "string" ||
    (transition.anonymousStorageKey !== null &&
      typeof transition.anonymousStorageKey !== "string") ||
    !Number.isInteger(payload.revision) ||
    Number(payload.revision) < 0 ||
    (payload.generation !== undefined &&
      (!Number.isSafeInteger(payload.generation) ||
        Number(payload.generation) < 0)) ||
    (transition.anonymousStorageKey !== null &&
      transition.anonymousGeneration !== undefined &&
      (!Number.isSafeInteger(transition.anonymousGeneration) ||
        Number(transition.anonymousGeneration) < 0)) ||
    !isRecord(payload.state)
  ) {
    return false;
  }

  const accountStorageKey = transition.accountStorageKey;
  const anonymousStorageKey = transition.anonymousStorageKey;
  const generation =
    payload.generation === undefined ? 0 : Number(payload.generation);
  const anonymousGeneration =
    anonymousStorageKey === null
      ? null
      : transition.anonymousGeneration === undefined
        ? 0
        : Number(transition.anonymousGeneration);
  const claimState = stateFromUnknown(payload.state);
  const existingAccount = readProgressCache(accountStorageKey).cache;
  const existingAnonymous = anonymousStorageKey
    ? readProgressCache(anonymousStorageKey).cache
    : null;
  if (
    existingAccount &&
    existingAccount.generation > generation
  ) {
    // A reset in another account tab overtook the claim response. Never replace
    // its newer marker/state with this older server snapshot.
    const anonymousRetired =
      anonymousStorageKey === null ||
      retireProgressCache(anonymousStorageKey);
    const legacyRetired = retireProgressCache(
      LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY,
    );
    return anonymousRetired && legacyRetired;
  }
  const pendingAnonymousState =
    existingAnonymous?.dirty &&
    existingAnonymous.generation === anonymousGeneration &&
    anonymousStorageKey
      ? isolateRewardReplicaCollisions(
          existingAnonymous.state,
          claimState,
          anonymousStorageKey,
        )
      : null;
  const pendingStates = [
    existingAccount?.dirty && existingAccount.generation === generation
      ? existingAccount.state
      : null,
    pendingAnonymousState,
  ].filter((state): state is LearningState => state !== null);
  const pendingState = pendingStates.reduce(
    (merged, state) => mergeLearningStates(merged, state),
    claimState,
  );
  const hasPendingLocalState = pendingStates.length > 0;
  let accountDurable = writeProgressCache(accountStorageKey, {
    cacheVersion: 1,
    state: pendingState,
    revision: Number(payload.revision),
    generation,
    savedAt:
      typeof payload.savedAt === "string" ? payload.savedAt : null,
    dirty: hasPendingLocalState,
  });
  let serverSaved = !hasPendingLocalState;

  if (hasPendingLocalState) {
    const saved = await saveClaimedProgress(
      pendingState,
      Number(payload.revision),
      generation,
      accountStorageKey,
      (state, revision, nextGeneration, savedAt) => {
        accountDurable =
          writeProgressCache(accountStorageKey, {
            cacheVersion: 1,
            state,
            revision,
            generation: nextGeneration,
            savedAt,
            dirty: true,
          }) || accountDurable;
      },
    );
    if (saved) {
      serverSaved = true;
      accountDurable =
        writeProgressCache(accountStorageKey, {
          cacheVersion: 1,
          state: stateFromUnknown(saved.state),
          revision: saved.revision,
          generation: saved.generation,
          savedAt: saved.savedAt,
          dirty: false,
        }) || accountDurable;
    }
  } else if (!accountDurable) {
    // The claim response is already canonical server state. No local-only
    // learning is at risk when browser storage is unavailable.
    serverSaved = true;
  }

  if (!serverSaved && !accountDurable) return false;

  const anonymousRetired =
    anonymousStorageKey === null ||
    retireProgressCache(anonymousStorageKey);
  const legacyRetired = retireProgressCache(
    LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY,
  );
  return anonymousRetired && legacyRetired;
}

async function saveClaimedProgress(
  initialState: LearningState,
  initialRevision: number,
  initialGeneration: number,
  progressStorageKey: string,
  onConflictMerge: (
    state: LearningState,
    revision: number,
    generation: number,
    savedAt: string | null,
  ) => void,
): Promise<ProgressApiResponse | null> {
  let state = initialState;
  let revision = initialRevision;
  let generation = initialGeneration;

  for (
    let attempt = 0;
    attempt < MAX_CLAIM_CACHE_SYNC_ATTEMPTS;
    attempt += 1
  ) {
    let response: Response;
    try {
      response = await fetch("/api/progress", {
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
    } catch {
      return null;
    }

    if (response.ok) {
      const result = await readProgressResponse(response);
      return result;
    }
    if (response.status !== 409) return null;
    const conflict = await readJsonRecord(response);
    if (conflict?.code === "IDENTITY_CHANGED") return null;

    let freshResponse: Response;
    try {
      freshResponse = await fetch("/api/progress", {
        cache: "no-store",
        headers: {
          "x-paretto-progress-cache": progressStorageKey,
        },
      });
    } catch {
      return null;
    }
    if (!freshResponse.ok) return null;
    const fresh = await readProgressResponse(freshResponse);
    if (!fresh) return null;
    if (fresh.generation > generation) {
      // A reset epoch is a hard boundary. Returning the canonical response
      // intentionally drops every pending state from the older generation.
      return fresh;
    }
    if (fresh.generation < generation) return null;
    state = mergeLearningStates(stateFromUnknown(fresh.state), state);
    revision = fresh.revision;
    generation = fresh.generation;
    onConflictMerge(state, revision, generation, fresh.savedAt);
  }

  return null;
}

async function readProgressResponse(
  response: Response,
): Promise<ProgressApiResponse | null> {
  try {
    const value = (await response.json()) as unknown;
    if (
      !isRecord(value) ||
      !Number.isInteger(value.revision) ||
      Number(value.revision) < 0 ||
      (value.generation !== undefined &&
        (!Number.isSafeInteger(value.generation) ||
          Number(value.generation) < 0)) ||
      !isRecord(value.state)
    ) {
      return null;
    }
    return {
      state: value.state,
      revision: Number(value.revision),
      generation:
        value.generation === undefined ? 0 : Number(value.generation),
      savedAt: typeof value.savedAt === "string" ? value.savedAt : null,
    };
  } catch {
    return null;
  }
}

async function readJsonRecord(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const value = (await response.json()) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function readProgressCache(
  storageKey: string,
): ReadProgressCacheResult {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "null",
    ) as ProgressCache | null;
    if (!parsed || parsed.cacheVersion !== 1) {
      return { status: "available", cache: null };
    }
    if (!Number.isInteger(parsed.revision) || parsed.revision < 0) {
      return { status: "available", cache: null };
    }
    const generation =
      parsed.generation === undefined ? 0 : Number(parsed.generation);
    if (!Number.isSafeInteger(generation) || generation < 0) {
      return { status: "available", cache: null };
    }
    if (
      !parsed.state ||
      typeof parsed.state !== "object" ||
      ((parsed.state as { version?: unknown }).version !== 1 &&
        (parsed.state as { version?: unknown }).version !== STATE_VERSION)
    ) {
      return { status: "available", cache: null };
    }
    return {
      status: "available",
      cache: {
        state: stateFromUnknown(parsed.state),
        revision: parsed.revision,
        generation,
        savedAt:
          typeof parsed.savedAt === "string" ? parsed.savedAt : null,
        dirty: parsed.dirty === true,
      },
    };
  } catch {
    return { status: "unavailable", cache: null };
  }
}

export function writeProgressCache(
  storageKey: string,
  cache: ProgressCache,
): boolean {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

export function removeProgressCache(storageKey: string): boolean {
  try {
    window.localStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removal can be denied independently from writes in hardened browsers. A
 * tombstone still prevents retired identity data from being read later.
 */
export function retireProgressCache(storageKey: string): boolean {
  if (removeProgressCache(storageKey)) return true;
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ cacheVersion: 0, retired: true }),
    );
    return true;
  } catch {
    return false;
  }
}

export function retireLegacyProgressCache(): boolean {
  return retireProgressCache(LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
