import { WORDS } from "./learning-data";

const COMPILED_WORD_IDS = new Set(WORDS.map((word) => word.id));
const SAFE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * CMS vocabulary keeps the slug used at creation as an immutable stable key.
 * Compiled overrides retain their existing learner progress ID; new CMS words
 * receive a namespaced ID that remains unchanged when their editorial slug moves.
 */
export function vocabularyPublicId(stableKey: string): string {
  if (!SAFE_KEY.test(stableKey)) {
    throw new Error("Invalid CMS vocabulary stable key.");
  }
  return COMPILED_WORD_IDS.has(stableKey) ? stableKey : `cms-${stableKey}`;
}

export function vocabularyReferenceKey(reference: string): string | null {
  const key = reference.startsWith("cms-") ? reference.slice(4) : reference;
  return SAFE_KEY.test(key) ? key : null;
}

export function isCompiledWordId(value: string): boolean {
  return COMPILED_WORD_IDS.has(value);
}
