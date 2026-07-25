const STORAGE_KEY_PREFIX = "paretto:reward-replica:v2";
const VALID_REPLICA_ID =
  /^(?:web:[0-9a-f-]{36}|web2:[0-9a-z]+:[0-9a-f-]{36})$/i;

const inMemoryReplicaIds = new Map<string, string>();

/**
 * A browser installation owns one reward-counter replica. The identifier is
 * random, contains no account or device data, and stays outside the synced
 * learning payload's active identity so another device never inherits it.
 */
export function getOrCreateRewardReplicaId(
  identityScope = "guest",
): string {
  const storageKey = `${STORAGE_KEY_PREFIX}:${identityScope}`;
  const cached = inMemoryReplicaIds.get(storageKey);
  if (cached) return cached;

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (
      stored &&
      VALID_REPLICA_ID.test(stored)
    ) {
      inMemoryReplicaIds.set(storageKey, stored);
      return stored;
    }
  } catch {
    // A private/restricted browser can still use an in-memory replica safely.
  }

  const created = `web2:${Date.now().toString(36)}:${crypto.randomUUID()}`;
  inMemoryReplicaIds.set(storageKey, created);
  try {
    window.localStorage.setItem(storageKey, created);
  } catch {
    // A new replica after reload remains merge-safe; only continuity is lost.
  }
  return created;
}
