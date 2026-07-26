export const LEGACY_ANONYMOUS_PROGRESS_STORAGE_KEY =
  "pas-a-pas-progress-v1:anonymous-browser";

const SCOPED_PROGRESS_STORAGE_PREFIX = "paretto-progress-v2";

export type ProgressCacheBootIdentity =
  | {
      kind: "account";
      accountId: string;
      storageKey: string;
      anonymousStorageKey: string | null;
      legacyCachePolicy: "discard";
    }
  | {
      kind: "anonymous";
      accountId: null;
      storageKey: string;
      anonymousStorageKey: string;
      legacyCachePolicy: "migrate-anonymous";
    }
  | {
      kind: "reset-anonymous";
      accountId: null;
      reason: "claimed-browser-identity";
    };

export function scopedProgressStorageKey(
  kind: "account" | "anonymous",
  opaqueScope: string,
): string {
  if (!/^[0-9a-f]{64}$/.test(opaqueScope)) {
    throw new Error("Progress cache scope must be an opaque SHA-256 value.");
  }
  return `${SCOPED_PROGRESS_STORAGE_PREFIX}:${kind}:${opaqueScope}`;
}

/**
 * Selects a cache only after the server has authenticated the current browser
 * identity. A claimed anonymous identity is never reused after its account
 * session expires: the browser must rotate to a fresh anonymous identity first.
 */
export function selectProgressCacheBootIdentity(input: {
  accountId: string | null;
  accountScope: string | null;
  anonymousScope: string;
  anonymousIdentityClaimed: boolean;
}): ProgressCacheBootIdentity {
  const anonymousStorageKey = scopedProgressStorageKey(
    "anonymous",
    input.anonymousScope,
  );

  if (input.accountId && input.accountScope) {
    return {
      kind: "account",
      accountId: input.accountId,
      storageKey: scopedProgressStorageKey("account", input.accountScope),
      anonymousStorageKey,
      legacyCachePolicy: "discard",
    };
  }

  if (input.anonymousIdentityClaimed) {
    return {
      kind: "reset-anonymous",
      accountId: null,
      reason: "claimed-browser-identity",
    };
  }

  return {
    kind: "anonymous",
    accountId: null,
    storageKey: anonymousStorageKey,
    anonymousStorageKey,
    legacyCachePolicy: "migrate-anonymous",
  };
}
