import {
  createInitialState,
  mergeLearningStates,
  stateFromUnknown,
  STATE_VERSION,
  type LearningState,
} from "@/app/learning-engine";
import { accountUserKey } from "@/app/server-auth";
import {
  initialNativeLearningState,
  validateNativeLearningState,
} from "@/app/api/native/_lib/native-progress";

type NativeState = Record<string, unknown>;
type NativeSession = {
  id: string;
  mode: "learn" | "review" | "challenge";
  regionID: string;
  wordIDs: string[];
  correct: number;
  xpEarned: number;
  completedAt: string;
};

/**
 * Native Apple accounts only become shared learner accounts through an exact
 * verified Apple-provider subject. When that link exists, both clients
 * address the same `learning_state` row with this canonical key.
 */
export async function linkedLearnerUserKey(
  learnerUserId: string,
): Promise<string | null> {
  const { env } = await import("cloudflare:workers");
  const secret = (env as unknown as { USER_KEY_SECRET?: unknown })
    .USER_KEY_SECRET;
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    learnerUserId.length < 1
  ) {
    return null;
  }
  return accountUserKey(secret, learnerUserId);
}

/**
 * Convert a strictly validated native snapshot into the canonical web shape.
 * Web-only preferences and dice receipts are retained from `existingWeb`.
 */
export function nativeStateAsWeb(
  nativeValue: unknown,
  existingWeb?: unknown,
): LearningState {
  if (!validateNativeLearningState(nativeValue)) {
    throw new Error("Native progress failed validation");
  }
  const native = nativeValue as NativeState;
  const base = existingWeb
    ? stateFromUnknown(existingWeb)
    : createInitialState(new Date(String(native.updatedAt)));
  const nativeSettings = native.settings as Record<string, unknown>;
  const nativeChallenge = native.challenge as Record<string, unknown>;
  const nativeDice = native.dice as Record<string, unknown>;
  const nativeSessions = native.sessions as NativeSession[];
  const nativeDisplayName = String(native.displayName).trim();
  const nativeDiceDate =
    typeof nativeDice.lastPlayedDate === "string"
      ? nativeDice.lastPlayedDate
      : null;
  const nativeDiceResult =
    nativeDice.lastPlayedResult &&
    typeof nativeDice.lastPlayedResult === "object"
      ? nativeDice.lastPlayedResult
      : null;

  return stateFromUnknown({
    version: STATE_VERSION,
    activeCourseId: native.activeCourseId ?? base.activeCourseId,
    courseProgress: native.courseProgress ?? base.courseProgress,
    onboarded: native.onboarded,
    displayName: nativeDisplayName || base.displayName,
    level: base.level,
    dailyGoal: native.dailyGoal,
    xp: native.xp,
    coins: native.coins,
    rewardJournal: native.rewardJournal ?? base.rewardJournal,
    streak: native.streak,
    longestStreak: native.longestStreak,
    lastActiveDate: native.lastActiveDate ?? null,
    currentRegionId: native.currentRegionID,
    unlockedRegionIds: native.unlockedRegionIDs,
    wordProgress: native.wordProgress,
    sessions: nativeSessions.map((session) => ({
      id: session.id,
      mode: session.mode,
      words: session.wordIDs.length,
      correct: session.correct,
      xpEarned: session.xpEarned,
      completedAt: normalizedTimestamp(session.completedAt),
    })),
    collectibles: native.collectibles,
    settings: {
      sound: nativeSettings.sound,
      phonetics: nativeSettings.phonetics,
      reducedMotion: nativeSettings.reducedMotion,
      // The native app emits no analytics. It must not silently change a
      // consent choice the learner made on the web.
      analytics: base.settings.analytics,
      sessionReminders: base.settings.sessionReminders,
    },
    challenge: {
      lastPlayedDate: nativeChallenge.lastPlayedDate ?? null,
      bestScore: nativeChallenge.bestScore,
    },
    dice: {
      lastPlayedDate: nativeDiceDate,
      lastPlayedResult:
        nativeDiceResult ??
        (base.dice.lastPlayedResult?.date === nativeDiceDate
          ? base.dice.lastPlayedResult
          : null),
    },
    updatedAt: normalizedTimestamp(String(native.updatedAt)),
  });
}

/**
 * Merge a native snapshot into canonical account progress without replaying
 * rewards. The canonical merge unions learning records and never lets earned
 * totals move backwards.
 */
export function mergeNativeStateIntoWeb(
  webValue: unknown,
  nativeValue: unknown,
): LearningState {
  const web = stateFromUnknown(webValue);
  return mergeLearningStates(web, nativeStateAsWeb(nativeValue, web));
}

/**
 * Project canonical account progress into the native schema. Native session
 * details include word IDs and a region, while web summaries do not. We only
 * return session details already known to the native client; canonical web
 * summaries remain preserved in D1 and are never fabricated or discarded.
 */
export function webStateAsNative(
  webValue: unknown,
  existingNative?: unknown,
): NativeState {
  const web = stateFromUnknown(webValue);
  const base =
    existingNative && validateNativeLearningState(existingNative)
      ? (existingNative as NativeState)
      : initialNativeLearningState();
  const baseSessions = new Map(
    ((base.sessions as NativeSession[]) ?? []).map((session) => [
      session.id,
      session,
    ]),
  );
  const canonicalSessionIds = new Set(web.sessions.map((session) => session.id));
  const sessions = [...baseSessions.values()]
    .filter((session) => canonicalSessionIds.has(session.id))
    .sort(
      (left, right) =>
        Date.parse(right.completedAt) - Date.parse(left.completedAt),
    )
    .slice(0, 100);
  const result: NativeState = {
    schemaVersion: 1,
    activeCourseId: web.activeCourseId,
    courseProgress: web.courseProgress,
    onboarded: web.onboarded,
    displayName: web.displayName,
    dailyGoal: web.dailyGoal,
    currentRegionID: web.currentRegionId,
    unlockedRegionIDs: web.unlockedRegionIds,
    xp: web.xp,
    coins: web.coins,
    rewardJournal: web.rewardJournal,
    streak: web.streak,
    longestStreak: web.longestStreak,
    lastActiveDate: web.lastActiveDate,
    wordProgress: web.wordProgress,
    sessions,
    collectibles: web.collectibles,
    challenge: web.challenge,
    dice: {
      lastPlayedDate: web.dice.lastPlayedDate,
      lastPlayedResult: web.dice.lastPlayedResult,
    },
    settings: {
      sound: web.settings.sound,
      phonetics: web.settings.phonetics,
      reducedMotion: web.settings.reducedMotion,
      analytics: web.settings.analytics,
    },
    updatedAt: normalizedTimestamp(web.updatedAt),
  };
  if (!validateNativeLearningState(result)) {
    throw new Error("Canonical progress cannot be represented by this native build");
  }
  return result;
}

function normalizedTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Progress timestamp is invalid");
  }
  return new Date(timestamp).toISOString();
}
