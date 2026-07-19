import { REGIONS, SEED_COLLECTIBLES, WORDS } from "./learning-data";

export const STATE_VERSION = 1;

export const MASTERY_INTERVALS_MS = [
  10 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
  90 * 24 * 60 * 60 * 1000,
] as const;

export type MasteryStage = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type Rating = "again" | "hard" | "good";
export type SessionMode = "learn" | "review" | "challenge";

export type WordProgress = {
  stage: MasteryStage;
  seen: number;
  correct: number;
  incorrect: number;
  nextReviewAt: string;
  lastReviewedAt: string;
};

export type SessionSummary = {
  id: string;
  mode: SessionMode;
  completedAt: string;
  words: number;
  correct: number;
  xpEarned: number;
};

export type LearningState = {
  version: number;
  onboarded: boolean;
  displayName: string;
  level: "new" | "some" | "returning";
  dailyGoal: 5 | 10 | 15;
  xp: number;
  coins: number;
  streak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  currentRegionId: string;
  unlockedRegionIds: string[];
  wordProgress: Record<string, WordProgress>;
  sessions: SessionSummary[];
  collectibles: string[];
  settings: {
    sound: boolean;
    phonetics: boolean;
    reducedMotion: boolean;
    sessionReminders: boolean;
  };
  challenge: {
    lastPlayedDate: string | null;
    bestScore: number;
  };
  dice: {
    lastPlayedDate: string | null;
  };
  updatedAt: string;
};

export function createInitialState(now = new Date()): LearningState {
  return {
    version: STATE_VERSION,
    onboarded: false,
    displayName: "Traveler",
    level: "new",
    dailyGoal: 5,
    xp: 0,
    coins: 12,
    streak: 0,
    longestStreak: 0,
    lastActiveDate: null,
    currentRegionId: "ile-de-france",
    unlockedRegionIds: ["ile-de-france"],
    wordProgress: {},
    sessions: [],
    collectibles: [],
    settings: {
      sound: true,
      phonetics: true,
      reducedMotion: false,
      sessionReminders: false,
    },
    challenge: {
      lastPlayedDate: null,
      bestScore: 0,
    },
    dice: {
      lastPlayedDate: null,
    },
    updatedAt: now.toISOString(),
  };
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function previousDateKey(todayKey: string): string {
  const [year, month, day] = todayKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function updateStreak(
  state: LearningState,
  todayKey: string,
): LearningState {
  if (state.lastActiveDate === todayKey) return state;

  const streak =
    state.lastActiveDate === previousDateKey(todayKey) ? state.streak + 1 : 1;

  return {
    ...state,
    streak,
    longestStreak: Math.max(state.longestStreak, streak),
    lastActiveDate: todayKey,
  };
}

export function rateWord(
  state: LearningState,
  wordId: string,
  rating: Rating,
  now = new Date(),
): LearningState {
  const current = state.wordProgress[wordId];
  const currentStage = current?.stage ?? 0;
  const nextStage = (
    rating === "again"
      ? Math.max(0, currentStage - 1)
      : rating === "hard"
        ? currentStage
        : Math.min(6, currentStage + 1)
  ) as MasteryStage;

  const interval =
    rating === "again"
      ? MASTERY_INTERVALS_MS[0]
      : rating === "hard"
        ? Math.max(
            4 * 60 * 60 * 1000,
            Math.round(MASTERY_INTERVALS_MS[nextStage] * 0.5),
          )
        : MASTERY_INTERVALS_MS[nextStage];

  const xpGain = rating === "good" ? 10 : rating === "hard" ? 6 : 2;
  const timestamp = now.toISOString();
  const nextReviewAt = new Date(now.getTime() + interval).toISOString();

  return {
    ...state,
    xp: state.xp + xpGain,
    coins: state.coins + (rating === "good" ? 1 : 0),
    wordProgress: {
      ...state.wordProgress,
      [wordId]: {
        stage: nextStage,
        seen: (current?.seen ?? 0) + 1,
        correct: (current?.correct ?? 0) + (rating === "again" ? 0 : 1),
        incorrect:
          (current?.incorrect ?? 0) + (rating === "again" ? 1 : 0),
        nextReviewAt,
        lastReviewedAt: timestamp,
      },
    },
    updatedAt: timestamp,
  };
}

export function markWordKnown(
  state: LearningState,
  wordId: string,
  now = new Date(),
): LearningState {
  const timestamp = now.toISOString();
  return {
    ...state,
    xp: state.xp + 5,
    wordProgress: {
      ...state.wordProgress,
      [wordId]: {
        stage: 6,
        seen: Math.max(1, state.wordProgress[wordId]?.seen ?? 0),
        correct: Math.max(1, state.wordProgress[wordId]?.correct ?? 0),
        incorrect: state.wordProgress[wordId]?.incorrect ?? 0,
        nextReviewAt: new Date(
          now.getTime() + MASTERY_INTERVALS_MS[6],
        ).toISOString(),
        lastReviewedAt: timestamp,
      },
    },
    updatedAt: timestamp,
  };
}

export function completeSession(
  state: LearningState,
  session: Omit<SessionSummary, "completedAt">,
  now = new Date(),
  todayKey = localDateKey(now),
): LearningState {
  if (state.sessions.some((entry) => entry.id === session.id)) return state;

  const withStreak = updateStreak(state, todayKey);
  const completedAt = now.toISOString();
  return {
    ...withStreak,
    xp: withStreak.xp + session.xpEarned,
    coins: withStreak.coins + Math.max(1, Math.floor(session.correct / 2)),
    sessions: [
      { ...session, completedAt },
      ...withStreak.sessions,
    ].slice(0, 50),
    updatedAt: completedAt,
  };
}

export function isDue(progress: WordProgress, now = new Date()): boolean {
  return new Date(progress.nextReviewAt).getTime() <= now.getTime();
}

export function dueCount(state: LearningState, now = new Date()): number {
  return Object.values(state.wordProgress).filter((progress) =>
    isDue(progress, now),
  ).length;
}

export function learnedCount(state: LearningState): number {
  return Object.keys(state.wordProgress).length;
}

export function masteredCount(state: LearningState): number {
  return Object.values(state.wordProgress).filter(
    (progress) => progress.stage >= 4,
  ).length;
}

export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1);
}

export function xpForLevel(level: number): number {
  return Math.max(0, (level - 1) ** 2 * 50);
}

export function stateFromUnknown(
  value: unknown,
  now = new Date(),
): LearningState {
  const fallback = createInitialState(now);
  if (!isRecord(value)) return fallback;

  const candidate = value;
  if (candidate.version !== STATE_VERSION) return fallback;

  const dailyGoal: LearningState["dailyGoal"] =
    candidate.dailyGoal === 10 || candidate.dailyGoal === 15
      ? candidate.dailyGoal
      : 5;
  const level: LearningState["level"] =
    candidate.level === "some" || candidate.level === "returning"
      ? candidate.level
      : "new";
  const currentRegionId =
    typeof candidate.currentRegionId === "string" &&
    REGION_IDS.has(candidate.currentRegionId)
      ? candidate.currentRegionId
      : fallback.currentRegionId;
  const requestedUnlocked = stringArrayFromUnknown(
    candidate.unlockedRegionIds,
    REGION_IDS,
  );
  const requestedCollectibles = new Set(
    stringArrayFromUnknown(candidate.collectibles, COLLECTIBLE_IDS),
  );
  const unlockedSet = new Set([
    fallback.currentRegionId,
    currentRegionId,
    ...requestedUnlocked,
  ]);
  const settings = isRecord(candidate.settings) ? candidate.settings : {};
  const challenge = isRecord(candidate.challenge) ? candidate.challenge : {};
  const dice = isRecord(candidate.dice) ? candidate.dice : {};
  const streak = clampNumber(candidate.streak, 0, 100_000);

  return {
    version: STATE_VERSION,
    onboarded:
      typeof candidate.onboarded === "boolean"
        ? candidate.onboarded
        : fallback.onboarded,
    displayName:
      typeof candidate.displayName === "string"
        ? candidate.displayName.slice(0, 100).trim().slice(0, 40) ||
          fallback.displayName
        : fallback.displayName,
    level,
    dailyGoal,
    xp: clampNumber(candidate.xp, 0, 10_000_000),
    coins: clampNumber(candidate.coins, 0, 1_000_000),
    streak,
    longestStreak: Math.max(
      streak,
      clampNumber(candidate.longestStreak, 0, 100_000),
    ),
    lastActiveDate: dateKeyFromUnknown(candidate.lastActiveDate),
    currentRegionId,
    unlockedRegionIds: REGIONS.map((region) => region.id).filter((id) =>
      unlockedSet.has(id),
    ),
    wordProgress: wordProgressFromUnknown(candidate.wordProgress),
    sessions: sessionsFromUnknown(candidate.sessions),
    collectibles: SEED_COLLECTIBLES.map((collectible) => collectible.id).filter(
      (id) => requestedCollectibles.has(id),
    ),
    settings: {
      sound:
        typeof settings.sound === "boolean"
          ? settings.sound
          : fallback.settings.sound,
      phonetics:
        typeof settings.phonetics === "boolean"
          ? settings.phonetics
          : fallback.settings.phonetics,
      reducedMotion:
        typeof settings.reducedMotion === "boolean"
          ? settings.reducedMotion
          : fallback.settings.reducedMotion,
      sessionReminders:
        typeof settings.sessionReminders === "boolean"
          ? settings.sessionReminders
          : fallback.settings.sessionReminders,
    },
    challenge: {
      lastPlayedDate: dateKeyFromUnknown(challenge.lastPlayedDate),
      bestScore: clampNumber(challenge.bestScore, 0, 1_000_000),
    },
    dice: {
      lastPlayedDate: dateKeyFromUnknown(dice.lastPlayedDate),
    },
    updatedAt: timestampFromUnknown(candidate.updatedAt) ?? fallback.updatedAt,
  };
}

/**
 * Reconciles independently changed server and local copies without replaying
 * rewards. The most recently updated copy owns preferences and profile choices;
 * append-only learning records and unlocks are unioned, while earned totals are
 * never allowed to move backwards.
 */
export function mergeLearningStates(
  server: unknown,
  local: unknown,
  now = new Date(),
): LearningState {
  const serverState = stateFromUnknown(server, now);
  const localState = stateFromUnknown(local, now);
  const serverUpdatedAt = Date.parse(serverState.updatedAt);
  const localUpdatedAt = Date.parse(localState.updatedAt);
  const newerState =
    localUpdatedAt >= serverUpdatedAt ? localState : serverState;

  const wordProgress: Record<string, WordProgress> = {};
  for (const { id } of WORDS) {
    const serverWord = serverState.wordProgress[id];
    const localWord = localState.wordProgress[id];
    if (!serverWord && !localWord) continue;

    if (!serverWord || !localWord) {
      wordProgress[id] = { ...(serverWord ?? localWord)! };
      continue;
    }

    const newerWord =
      Date.parse(localWord.lastReviewedAt) >=
      Date.parse(serverWord.lastReviewedAt)
        ? localWord
        : serverWord;
    const correct = Math.max(serverWord.correct, localWord.correct);
    const incorrect = Math.max(serverWord.incorrect, localWord.incorrect);
    wordProgress[id] = {
      stage: newerWord.stage,
      seen: Math.max(serverWord.seen, localWord.seen, correct + incorrect),
      correct,
      incorrect,
      nextReviewAt: newerWord.nextReviewAt,
      lastReviewedAt: newerWord.lastReviewedAt,
    };
  }

  const sessionsById = new Map<string, SessionSummary>();
  for (const session of [...serverState.sessions, ...localState.sessions]) {
    const existing = sessionsById.get(session.id);
    if (
      !existing ||
      Date.parse(session.completedAt) >= Date.parse(existing.completedAt)
    ) {
      sessionsById.set(session.id, { ...session });
    }
  }
  const sessions = [...sessionsById.values()]
    .sort(
      (left, right) =>
        Date.parse(right.completedAt) - Date.parse(left.completedAt),
    )
    .slice(0, 50);

  const unlockedRegionSet = new Set([
    ...serverState.unlockedRegionIds,
    ...localState.unlockedRegionIds,
    newerState.currentRegionId,
  ]);
  const collectibleSet = new Set([
    ...serverState.collectibles,
    ...localState.collectibles,
  ]);
  const mergedAt = new Date(
    Math.max(now.getTime(), serverUpdatedAt, localUpdatedAt),
  ).toISOString();

  return {
    version: STATE_VERSION,
    onboarded: serverState.onboarded || localState.onboarded,
    displayName: newerState.displayName,
    level: newerState.level,
    dailyGoal: newerState.dailyGoal,
    xp: Math.max(serverState.xp, localState.xp),
    coins: Math.max(serverState.coins, localState.coins),
    streak: Math.max(serverState.streak, localState.streak),
    longestStreak: Math.max(
      serverState.longestStreak,
      localState.longestStreak,
      serverState.streak,
      localState.streak,
    ),
    lastActiveDate: laterDateKey(
      serverState.lastActiveDate,
      localState.lastActiveDate,
    ),
    currentRegionId: newerState.currentRegionId,
    unlockedRegionIds: REGIONS.map((region) => region.id).filter((id) =>
      unlockedRegionSet.has(id),
    ),
    wordProgress,
    sessions,
    collectibles: SEED_COLLECTIBLES.map((collectible) => collectible.id).filter(
      (id) => collectibleSet.has(id),
    ),
    settings: { ...newerState.settings },
    challenge: {
      lastPlayedDate: laterDateKey(
        serverState.challenge.lastPlayedDate,
        localState.challenge.lastPlayedDate,
      ),
      bestScore: Math.max(
        serverState.challenge.bestScore,
        localState.challenge.bestScore,
      ),
    },
    dice: {
      lastPlayedDate: laterDateKey(
        serverState.dice.lastPlayedDate,
        localState.dice.lastPlayedDate,
      ),
    },
    updatedAt: mergedAt,
  };
}

const REGION_IDS: ReadonlySet<string> = new Set(
  REGIONS.map((region) => region.id),
);
const WORD_IDS: ReadonlySet<string> = new Set(WORDS.map((word) => word.id));
const COLLECTIBLE_IDS: ReadonlySet<string> = new Set(
  SEED_COLLECTIBLES.map((collectible) => collectible.id),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function timestampFromUnknown(value: unknown): string | null {
  if (typeof value !== "string" || value.length !== 24) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const normalized = new Date(timestamp).toISOString();
  return normalized === value ? value : null;
}

function dateKeyFromUnknown(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? value : null;
}

function laterDateKey(
  first: string | null,
  second: string | null,
): string | null {
  if (!first) return second;
  if (!second) return first;
  return first >= second ? first : second;
}

function stringArrayFromUnknown(
  value: unknown,
  allowlist: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(value)) return [];
  const result = new Set<string>();
  const limit = Math.min(value.length, 1_000);
  for (let index = 0; index < limit; index += 1) {
    const entry = value[index];
    if (typeof entry === "string" && allowlist.has(entry)) result.add(entry);
  }
  return [...result];
}

function wordProgressFromUnknown(value: unknown): Record<string, WordProgress> {
  if (!isRecord(value)) return {};
  const result: Record<string, WordProgress> = {};

  for (const wordId of WORD_IDS) {
    const rawProgress = value[wordId];
    if (!isRecord(rawProgress)) continue;
    if (
      !Number.isInteger(rawProgress.stage) ||
      typeof rawProgress.stage !== "number" ||
      rawProgress.stage < 0 ||
      rawProgress.stage > 6
    ) {
      continue;
    }
    const nextReviewAt = timestampFromUnknown(rawProgress.nextReviewAt);
    const lastReviewedAt = timestampFromUnknown(rawProgress.lastReviewedAt);
    if (!nextReviewAt || !lastReviewedAt) continue;

    const correct = clampNumber(rawProgress.correct, 0, 1_000_000);
    const incorrect = clampNumber(rawProgress.incorrect, 0, 1_000_000);
    result[wordId] = {
      stage: rawProgress.stage as MasteryStage,
      seen: Math.max(
        clampNumber(rawProgress.seen, 0, 1_000_000),
        correct + incorrect,
      ),
      correct,
      incorrect,
      nextReviewAt,
      lastReviewedAt,
    };
  }

  return result;
}

function sessionsFromUnknown(value: unknown): SessionSummary[] {
  if (!Array.isArray(value)) return [];
  const result: SessionSummary[] = [];
  const sessionIds = new Set<string>();

  for (const rawSession of value.slice(0, 500)) {
    if (!isRecord(rawSession)) continue;
    const id =
      typeof rawSession.id === "string"
        ? rawSession.id.slice(0, 100).trim()
        : "";
    const mode = rawSession.mode;
    const completedAt = timestampFromUnknown(rawSession.completedAt);
    if (
      !id ||
      sessionIds.has(id) ||
      (mode !== "learn" && mode !== "review" && mode !== "challenge") ||
      !completedAt
    ) {
      continue;
    }
    const words = clampNumber(rawSession.words, 0, 10_000);
    result.push({
      id,
      mode,
      completedAt,
      words,
      correct: Math.min(words, clampNumber(rawSession.correct, 0, 10_000)),
      xpEarned: clampNumber(rawSession.xpEarned, 0, 1_000_000),
    });
    sessionIds.add(id);
    if (result.length === 50) break;
  }

  return result;
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
