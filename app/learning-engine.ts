import { REGIONS, SEED_COLLECTIBLES, WORDS } from "./learning-data";
import {
  COURSE_CATALOG,
  DEFAULT_COURSE_ID,
  isCourseId,
  type CourseId,
} from "./course-catalog";

export const STATE_VERSION = 2;
const LEGACY_STATE_VERSION = 1;

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

export type RewardReplicaCounter = {
  xpEarned: number;
  coinsEarned: number;
  coinsSpent: number;
};

export type RewardClaim = {
  replicaId: string;
  xpEarned: number;
  coinsEarned: number;
  coinsSpent: number;
};

/**
 * Rewards use a state-based grow-only counter per installation. Two devices
 * can therefore earn or spend concurrently and merge with a component-wise
 * maximum instead of dropping one device's delta or replaying it.
 */
export type RewardJournal = {
  baselineXp: number;
  baselineCoins: number;
  replicas: Record<string, RewardReplicaCounter>;
  /**
   * Server-coordinated protocol epoch. Clients never advance it locally; a
   * mismatched epoch fails closed rather than discarding an offline replica.
   */
  replicaEpoch: number;
  /**
   * Deterministic entitlement keys (for example one daily dice reward) make
   * account-wide rewards idempotent across independently offline devices.
   */
  claims: Record<string, RewardClaim>;
  /**
   * Server-coordinated compaction floor. Clients never advance it locally;
   * changing it requires the same protocol epoch on every merge participant.
   */
  claimDayFloor: string | null;
  /**
   * True only while adopting a pre-journal numeric snapshot. It prevents the
   * same historical total from being added to already journaled counters.
   */
  legacyBaseline: boolean;
};

/**
 * Course-scoped routing metadata lives alongside the legacy v1 learning
 * fields. French remains the only published course, so the existing progress
 * payload stays intact while future courses have a stable place to record
 * their own context and curriculum revision.
 */
export type CourseProgressMetadata = {
  currentContextId: string;
  curriculumRevision: string | null;
  updatedAt: string;
};

export type LearningState = {
  version: number;
  activeCourseId: CourseId;
  courseProgress: Partial<Record<CourseId, CourseProgressMetadata>>;
  onboarded: boolean;
  displayName: string;
  level: "new" | "some" | "returning";
  dailyGoal: 5 | 10 | 15;
  xp: number;
  coins: number;
  rewardJournal: RewardJournal;
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
    analytics: boolean;
  };
  challenge: {
    lastPlayedDate: string | null;
    bestScore: number;
  };
  dice: {
    lastPlayedDate: string | null;
    lastPlayedResult: {
      date: string;
      stake: 1 | 3 | 5;
      multiplier: 0.5 | 1 | 1.25 | 1.5 | 2 | 3;
      xp: number;
    } | null;
  };
  updatedAt: string;
};

export function createInitialState(now = new Date()): LearningState {
  const updatedAt = now.toISOString();
  return {
    version: STATE_VERSION,
    activeCourseId: DEFAULT_COURSE_ID,
    courseProgress: {
      [DEFAULT_COURSE_ID]: {
        currentContextId: COURSE_CATALOG[DEFAULT_COURSE_ID].initialContextId,
        curriculumRevision: "compiled-v1",
        updatedAt,
      },
    },
    onboarded: false,
    displayName: "Traveler",
    level: "new",
    dailyGoal: 5,
    xp: 0,
    coins: 12,
    rewardJournal: {
      baselineXp: 0,
      baselineCoins: 12,
      replicas: {},
      replicaEpoch: 0,
      claims: {},
      claimDayFloor: null,
      legacyBaseline: false,
    },
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
      analytics: false,
    },
    challenge: {
      lastPlayedDate: null,
      bestScore: 0,
    },
    dice: {
      lastPlayedDate: null,
      lastPlayedResult: null,
    },
    updatedAt,
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
  rewardReplicaId = createEphemeralRewardReplicaId(),
  awardReward = true,
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
  const rewarded = awardReward
    ? applyRewardDelta(
        state,
        {
          xpEarned: xpGain,
          coinsEarned: rating === "good" ? 1 : 0,
        },
        rewardReplicaId,
        now,
      )
    : state;

  return {
    ...rewarded,
    wordProgress: {
      ...rewarded.wordProgress,
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
  rewardReplicaId = createEphemeralRewardReplicaId(),
): LearningState {
  const timestamp = now.toISOString();
  const rewarded = applyRewardDelta(
    state,
    { xpEarned: 5 },
    rewardReplicaId,
    now,
  );
  return {
    ...rewarded,
    wordProgress: {
      ...rewarded.wordProgress,
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
  rewardReplicaId = createEphemeralRewardReplicaId(),
  awardReward = true,
): LearningState {
  if (state.sessions.some((entry) => entry.id === session.id)) return state;

  const withStreak = updateStreak(state, todayKey);
  const completedAt = now.toISOString();
  const rewarded = awardReward
    ? applyRewardDelta(
        withStreak,
        {
          xpEarned: session.xpEarned,
          coinsEarned: Math.max(1, Math.floor(session.correct / 2)),
        },
        rewardReplicaId,
        now,
      )
    : withStreak;
  return {
    ...rewarded,
    sessions: [
      { ...session, completedAt },
      ...rewarded.sessions,
    ].slice(0, 50),
    updatedAt: completedAt,
  };
}

export function applyRewardDelta(
  state: LearningState,
  delta: {
    xpEarned?: number;
    coinsEarned?: number;
    coinsSpent?: number;
  },
  rewardReplicaId: string,
  now = new Date(),
): LearningState {
  if (!validRewardReplicaId(rewardReplicaId)) {
    throw new Error("Reward replica ID is invalid.");
  }
  if (
    !state.rewardJournal.replicas[rewardReplicaId] &&
    Object.keys(state.rewardJournal.replicas).length >=
      MAX_ACTIVE_REWARD_REPLICAS
  ) {
    throw new RewardJournalCapacityError();
  }
  const xpEarned = boundedRewardDelta(delta.xpEarned);
  const coinsEarned = boundedRewardDelta(delta.coinsEarned);
  const coinsSpent = boundedRewardDelta(delta.coinsSpent);
  if (coinsSpent > 0) {
    throw new Error(
      "Spend rewards require an idempotent claim instead of a replica counter.",
    );
  }
  const current = state.rewardJournal.replicas[rewardReplicaId] ?? {
    xpEarned: 0,
    coinsEarned: 0,
    coinsSpent: 0,
  };
  const rewardJournal: RewardJournal = {
    ...state.rewardJournal,
    legacyBaseline: false,
    replicas: {
      ...state.rewardJournal.replicas,
      [rewardReplicaId]: {
        xpEarned: current.xpEarned + xpEarned,
        coinsEarned: current.coinsEarned + coinsEarned,
        coinsSpent: current.coinsSpent + coinsSpent,
      },
    },
  };
  const totals = rewardTotals(rewardJournal);
  if (totals.coins < 0) {
    throw new Error("A reward delta cannot spend more coins than are available.");
  }
  return {
    ...state,
    xp: totals.xp,
    coins: totals.coins,
    rewardJournal,
    updatedAt: now.toISOString(),
  };
}

/**
 * Applies one globally idempotent reward entitlement. Claims with the same
 * key merge to one deterministic winner, and paid claims are admitted in a
 * stable order only while sufficient coins remain.
 */
export function applyRewardClaim(
  state: LearningState,
  claimId: string,
  delta: {
    xpEarned?: number;
    coinsEarned?: number;
    coinsSpent?: number;
  },
  rewardReplicaId: string,
  now = new Date(),
): LearningState {
  if (!validRewardClaimId(claimId)) {
    throw new Error("Reward claim ID is invalid.");
  }
  if (!validRewardReplicaId(rewardReplicaId)) {
    throw new Error("Reward replica ID is invalid.");
  }
  if (isRetiredRewardClaim(claimId, state.rewardJournal.claimDayFloor)) {
    throw new Error("Reward claim has been retired.");
  }
  if (state.rewardJournal.claims[claimId]) return state;

  const claim: RewardClaim = {
    replicaId: rewardReplicaId,
    xpEarned: boundedRewardDelta(delta.xpEarned),
    coinsEarned: boundedRewardDelta(delta.coinsEarned),
    coinsSpent: boundedRewardDelta(delta.coinsSpent),
  };
  if (
    Object.keys(state.rewardJournal.claims).length >=
    MAX_ACTIVE_REWARD_CLAIMS
  ) {
    throw new RewardJournalCapacityError();
  }
  const rewardJournal: RewardJournal = {
    ...state.rewardJournal,
    legacyBaseline: false,
    claims: {
      ...state.rewardJournal.claims,
      [claimId]: claim,
    },
  };
  const totals = rewardTotals(rewardJournal);
  return {
    ...state,
    xp: totals.xp,
    coins: totals.coins,
    rewardJournal,
    updatedAt: now.toISOString(),
  };
}

export function isDue(progress: WordProgress, now = new Date()): boolean {
  return new Date(progress.nextReviewAt).getTime() <= now.getTime();
}

export function activeWordProgress(
  state: Pick<LearningState, "wordProgress">,
  activeWordIds: Iterable<string> = WORD_IDS,
): Record<string, WordProgress> {
  const activeIds =
    activeWordIds instanceof Set ? activeWordIds : new Set(activeWordIds);
  return Object.fromEntries(
    Object.entries(state.wordProgress).filter(([wordId]) =>
      activeIds.has(wordId),
    ),
  );
}

export function dueCount(
  state: Pick<LearningState, "wordProgress">,
  activeWordIdsOrNow: Iterable<string> | Date = WORD_IDS,
  now = new Date(),
): number {
  const activeWordIds =
    activeWordIdsOrNow instanceof Date ? WORD_IDS : activeWordIdsOrNow;
  const referenceTime =
    activeWordIdsOrNow instanceof Date ? activeWordIdsOrNow : now;
  return Object.values(activeWordProgress(state, activeWordIds)).filter(
    (progress) => isDue(progress, referenceTime),
  ).length;
}

export function learnedCount(
  state: Pick<LearningState, "wordProgress">,
  activeWordIds: Iterable<string> = WORD_IDS,
): number {
  return Object.keys(activeWordProgress(state, activeWordIds)).length;
}

export function masteredCount(
  state: Pick<LearningState, "wordProgress">,
  activeWordIds: Iterable<string> = WORD_IDS,
): number {
  return Object.values(activeWordProgress(state, activeWordIds)).filter(
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
  if (
    candidate.version !== STATE_VERSION &&
    candidate.version !== LEGACY_STATE_VERSION
  ) {
    return fallback;
  }

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
  const activeCourseId = isCourseId(candidate.activeCourseId)
    ? candidate.activeCourseId
    : DEFAULT_COURSE_ID;
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
  const candidateXp = clampNumber(candidate.xp, 0, 10_000_000);
  const candidateCoins = clampNumber(candidate.coins, 0, 1_000_000);
  const rewardJournal = rewardJournalFromUnknown(
    candidate.rewardJournal,
    candidateXp,
    candidateCoins,
  );
  const rewards = rewardTotals(rewardJournal);

  return {
    version: STATE_VERSION,
    activeCourseId,
    courseProgress: courseProgressFromUnknown(
      candidate.courseProgress,
      activeCourseId,
      currentRegionId,
      timestampFromUnknown(candidate.updatedAt) ?? fallback.updatedAt,
    ),
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
    xp: rewards.xp,
    coins: rewards.coins,
    rewardJournal,
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
      analytics:
        typeof settings.analytics === "boolean"
          ? settings.analytics
          : fallback.settings.analytics,
    },
    challenge: {
      lastPlayedDate: dateKeyFromUnknown(challenge.lastPlayedDate),
      bestScore: clampNumber(challenge.bestScore, 0, 1_000_000),
    },
    dice: normalizedDiceState(dice),
    updatedAt: timestampFromUnknown(candidate.updatedAt) ?? fallback.updatedAt,
  };
}

/**
 * Reads a durable canonical snapshot without converting storage corruption or
 * a future, unsupported schema into a fresh learner. Callers that own the
 * persisted row must fail closed so a later autosave cannot overwrite the only
 * recoverable copy with an initial state.
 */
export function stateFromPersistedUnknown(
  value: unknown,
  now = new Date(),
): LearningState {
  if (
    !isRecord(value) ||
    (value.version !== STATE_VERSION &&
      value.version !== LEGACY_STATE_VERSION)
  ) {
    throw new Error("Stored learning progress has an unsupported schema.");
  }
  return stateFromUnknown(value, now);
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
  const courseProgress = mergeCourseProgress(
    serverState.courseProgress,
    localState.courseProgress,
    newerState,
  );
  const rewardJournal = mergeRewardJournals(
    serverState.rewardJournal,
    localState.rewardJournal,
    serverUpdatedAt,
    localUpdatedAt,
  );
  const rewards = rewardTotals(rewardJournal);

  const wordProgress: Record<string, WordProgress> = {};
  const mergedWordIds = new Set([
    ...Object.keys(serverState.wordProgress),
    ...Object.keys(localState.wordProgress),
  ]);
  for (const id of mergedWordIds) {
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
    activeCourseId: newerState.activeCourseId,
    courseProgress,
    onboarded: serverState.onboarded || localState.onboarded,
    displayName: newerState.displayName,
    level: newerState.level,
    dailyGoal: newerState.dailyGoal,
    xp: rewards.xp,
    coins: rewards.coins,
    rewardJournal,
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
    dice: mergeDiceState(
      serverState.dice,
      localState.dice,
      newerState.dice,
      rewardJournal,
    ),
    updatedAt: mergedAt,
  };
}

/**
 * Anonymous and account histories are independent even when an older build
 * reused one installation-global replica ID. Rekey the source side before an
 * identity claim so component-wise maxima cannot collapse unrelated rewards
 * and the resulting account payload no longer carries a shared identifier.
 */
export function isolateRewardReplicaCollisions(
  source: unknown,
  target: unknown,
  namespace: string,
): LearningState {
  const sourceState = stateFromUnknown(source);
  const targetState = stateFromUnknown(target);
  const targetReplicaIds = new Set([
    ...Object.keys(targetState.rewardJournal.replicas),
    ...Object.values(targetState.rewardJournal.claims).map(
      (claim) => claim.replicaId,
    ),
  ]);
  const sourceReplicaIds = new Set([
    ...Object.keys(sourceState.rewardJournal.replicas),
    ...Object.values(sourceState.rewardJournal.claims).map(
      (claim) => claim.replicaId,
    ),
  ]);
  const replacements = new Map<string, string>();
  for (const replicaId of [...sourceReplicaIds].sort()) {
    if (!targetReplicaIds.has(replicaId)) continue;
    const replacement = [
      "claim",
      stableNamespaceHash(namespace),
      stableNamespaceHash(replicaId),
      stableNamespaceHash([...replicaId].reverse().join("")),
    ].join(":");
    replacements.set(replicaId, replacement);
    targetReplicaIds.add(replacement);
  }
  if (replacements.size === 0) return sourceState;

  const replicas: Record<string, RewardReplicaCounter> = {};
  for (const [replicaId, counter] of Object.entries(
    sourceState.rewardJournal.replicas,
  )) {
    replicas[replacements.get(replicaId) ?? replicaId] = { ...counter };
  }
  const claims = Object.fromEntries(
    Object.entries(sourceState.rewardJournal.claims).map(([claimId, claim]) => [
      claimId,
      {
        ...claim,
        replicaId: replacements.get(claim.replicaId) ?? claim.replicaId,
      },
    ]),
  );
  return {
    ...sourceState,
    rewardJournal: {
      ...sourceState.rewardJournal,
      replicas,
      claims,
    },
  };
}

const REGION_IDS: ReadonlySet<string> = new Set(
  REGIONS.map((region) => region.id),
);
const WORD_IDS: ReadonlySet<string> = new Set(WORDS.map((word) => word.id));
const COLLECTIBLE_IDS: ReadonlySet<string> = new Set(
  SEED_COLLECTIBLES.map((collectible) => collectible.id),
);

function courseProgressFromUnknown(
  value: unknown,
  activeCourseId: CourseId,
  currentRegionId: string,
  fallbackUpdatedAt: string,
): LearningState["courseProgress"] {
  const source = isRecord(value) ? value : {};
  const result: LearningState["courseProgress"] = {};

  for (const courseId of Object.keys(COURSE_CATALOG) as CourseId[]) {
    const entry = source[courseId];
    if (!isRecord(entry)) continue;
    const currentContextId = contextIdFromUnknown(
      courseId,
      entry.currentContextId,
    );
    const updatedAt = timestampFromUnknown(entry.updatedAt);
    if (!currentContextId || !updatedAt) continue;
    result[courseId] = {
      currentContextId,
      curriculumRevision: curriculumRevisionFromUnknown(
        entry.curriculumRevision,
      ),
      updatedAt,
    };
  }

  const existingActive: CourseProgressMetadata | undefined =
    result[activeCourseId];
  const activeContextId =
    activeCourseId === DEFAULT_COURSE_ID
      ? currentRegionId
      : existingActive?.currentContextId;
  result[activeCourseId] = {
    currentContextId:
      activeContextId ??
      existingActive?.currentContextId ??
      COURSE_CATALOG[activeCourseId].initialContextId,
    curriculumRevision:
      existingActive?.curriculumRevision ??
      (activeCourseId === DEFAULT_COURSE_ID ? "compiled-v1" : null),
    updatedAt: existingActive?.updatedAt ?? fallbackUpdatedAt,
  };
  return result;
}

function mergeCourseProgress(
  server: LearningState["courseProgress"],
  local: LearningState["courseProgress"],
  newerState: LearningState,
): LearningState["courseProgress"] {
  const result: LearningState["courseProgress"] = {};
  for (const courseId of Object.keys(COURSE_CATALOG) as CourseId[]) {
    const serverEntry = server[courseId];
    const localEntry = local[courseId];
    const entry =
      !serverEntry
        ? localEntry
        : !localEntry
          ? serverEntry
          : Date.parse(localEntry.updatedAt) >= Date.parse(serverEntry.updatedAt)
            ? localEntry
            : serverEntry;
    if (entry) result[courseId] = { ...entry };
  }

  if (newerState.activeCourseId === DEFAULT_COURSE_ID) {
    result[DEFAULT_COURSE_ID] = {
      currentContextId: newerState.currentRegionId,
      curriculumRevision:
        result[DEFAULT_COURSE_ID]?.curriculumRevision ?? "compiled-v1",
      updatedAt:
        result[DEFAULT_COURSE_ID]?.updatedAt ?? newerState.updatedAt,
    };
  }
  return result;
}

function contextIdFromUnknown(
  courseId: CourseId,
  value: unknown,
): string | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 80 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    return null;
  }
  return courseId !== DEFAULT_COURSE_ID || REGION_IDS.has(value) ? value : null;
}

function curriculumRevisionFromUnknown(value: unknown): string | null {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 160 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
    ? value
    : null;
}

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

function normalizedDiceState(
  value: Record<string, unknown>,
): LearningState["dice"] {
  const date = dateKeyFromUnknown(value.lastPlayedDate);
  const result = isRecord(value.lastPlayedResult)
    ? diceResultFromUnknown(value.lastPlayedResult)
    : null;
  const lastPlayedDate = laterDateKey(date, result?.date ?? null);
  return {
    lastPlayedDate,
    lastPlayedResult:
      result && result.date === lastPlayedDate ? result : null,
  };
}

function mergeDiceState(
  server: LearningState["dice"],
  local: LearningState["dice"],
  preferred: LearningState["dice"],
  rewardJournal: RewardJournal,
): LearningState["dice"] {
  const lastPlayedDate = laterDateKey(
    server.lastPlayedDate,
    local.lastPlayedDate,
  );
  const candidates = [
    preferred.lastPlayedResult,
    local.lastPlayedResult,
    server.lastPlayedResult,
  ];
  const dailyClaim = lastPlayedDate
    ? rewardJournal.claims[`daily:dice:${lastPlayedDate}`]
    : undefined;
  if (dailyClaim) {
    const admitted = admittedRewardClaimIds(rewardJournal).has(
      `daily:dice:${lastPlayedDate}`,
    );
    return {
      lastPlayedDate,
      lastPlayedResult: admitted
        ? candidates.find(
            (result) =>
              result?.date === lastPlayedDate &&
              result.xp === dailyClaim.xpEarned &&
              result.stake === dailyClaim.coinsSpent,
          ) ?? null
        : null,
    };
  }
  return {
    lastPlayedDate,
    lastPlayedResult:
      candidates.find((result) => result?.date === lastPlayedDate) ?? null,
  };
}

function diceResultFromUnknown(
  value: Record<string, unknown>,
): NonNullable<LearningState["dice"]["lastPlayedResult"]> | null {
  const date = dateKeyFromUnknown(value.date);
  const stake =
    value.stake === 1 || value.stake === 3 || value.stake === 5
      ? value.stake
      : null;
  const multiplier =
    value.multiplier === 0.5 ||
    value.multiplier === 1 ||
    value.multiplier === 1.25 ||
    value.multiplier === 1.5 ||
    value.multiplier === 2 ||
    value.multiplier === 3
      ? value.multiplier
      : null;
  if (!date || !stake || !multiplier) return null;
  return {
    date,
    stake,
    multiplier,
    xp: clampNumber(value.xp, 0, 1_000_000),
  };
}

function rewardJournalFromUnknown(
  value: unknown,
  candidateXp: number,
  candidateCoins: number,
): RewardJournal {
  if (!isRecord(value) || !isRecord(value.replicas)) {
    return {
      baselineXp: candidateXp,
      baselineCoins: candidateCoins,
      replicas: {},
      replicaEpoch: 0,
      claims: {},
      claimDayFloor: null,
      legacyBaseline: true,
    };
  }

  const rawReplicaEntries = Object.entries(value.replicas);
  if (rawReplicaEntries.length > MAX_ACTIVE_REWARD_REPLICAS) {
    throw new RewardJournalCapacityError();
  }
  const replicas: Record<string, RewardReplicaCounter> = {};
  const replicaEpoch = clampNumber(value.replicaEpoch, 0, 1_000_000);
  for (const [replicaId, rawCounter] of rawReplicaEntries) {
    if (
      !validRewardReplicaId(replicaId) ||
      !isRecord(rawCounter)
    ) {
      continue;
    }
    replicas[replicaId] = {
      xpEarned: clampNumber(rawCounter.xpEarned, 0, 100_000_000),
      coinsEarned: clampNumber(rawCounter.coinsEarned, 0, 100_000_000),
      coinsSpent: clampNumber(rawCounter.coinsSpent, 0, 100_000_000),
    };
  }

  const rawClaimEntries = isRecord(value.claims)
    ? Object.entries(value.claims)
    : [];
  if (rawClaimEntries.length > MAX_ACTIVE_REWARD_CLAIMS) {
    throw new RewardJournalCapacityError();
  }
  const claims: Record<string, RewardClaim> = {};
  const claimDayFloor = dateKeyFromUnknown(value.claimDayFloor);
  if (rawClaimEntries.length > 0) {
    for (const [claimId, rawClaim] of rawClaimEntries) {
      if (
        !validRewardClaimId(claimId) ||
        !isRecord(rawClaim) ||
        typeof rawClaim.replicaId !== "string" ||
        !validRewardReplicaId(rawClaim.replicaId) ||
        isRetiredRewardClaim(claimId, claimDayFloor)
      ) {
        continue;
      }
      claims[claimId] = {
        replicaId: rawClaim.replicaId,
        xpEarned: clampNumber(rawClaim.xpEarned, 0, 100_000_000),
        coinsEarned: clampNumber(rawClaim.coinsEarned, 0, 100_000_000),
        coinsSpent: clampNumber(rawClaim.coinsSpent, 0, 100_000_000),
      };
    }
  }

  const parsed: RewardJournal = {
    baselineXp: clampNumber(value.baselineXp, 0, 100_000_000),
    baselineCoins: clampSignedNumber(
      value.baselineCoins,
      -100_000_000,
      100_000_000,
    ),
    replicas,
    replicaEpoch,
    claims,
    claimDayFloor,
    legacyBaseline: value.legacyBaseline === true,
  };
  if (
    Object.keys(replicas).length === 0 &&
    Object.keys(claims).length === 0 &&
    (candidateXp !== parsed.baselineXp ||
      candidateCoins !== parsed.baselineCoins)
  ) {
    return {
      ...parsed,
      baselineXp: candidateXp,
      baselineCoins: candidateCoins,
      legacyBaseline: true,
    };
  }
  return parsed;
}

function mergeRewardJournals(
  server: RewardJournal,
  local: RewardJournal,
  serverUpdatedAt: number,
  localUpdatedAt: number,
): RewardJournal {
  if (server.replicaEpoch !== local.replicaEpoch) {
    throw new RewardJournalEpochError();
  }
  if (server.claimDayFloor !== local.claimDayFloor) {
    throw new RewardJournalEpochError();
  }
  if (server.legacyBaseline || local.legacyBaseline) {
    return mergeLegacyRewardJournal(
      server,
      local,
      serverUpdatedAt,
      localUpdatedAt,
    );
  }

  const replicas: Record<string, RewardReplicaCounter> = {};
  for (const replicaId of new Set([
    ...Object.keys(server.replicas),
    ...Object.keys(local.replicas),
  ])) {
    const serverCounter = server.replicas[replicaId];
    const localCounter = local.replicas[replicaId];
    replicas[replicaId] = {
      xpEarned: Math.max(
        serverCounter?.xpEarned ?? 0,
        localCounter?.xpEarned ?? 0,
      ),
      coinsEarned: Math.max(
        serverCounter?.coinsEarned ?? 0,
        localCounter?.coinsEarned ?? 0,
      ),
      coinsSpent: Math.max(
        serverCounter?.coinsSpent ?? 0,
        localCounter?.coinsSpent ?? 0,
      ),
    };
  }
  if (Object.keys(replicas).length > MAX_ACTIVE_REWARD_REPLICAS) {
    throw new RewardJournalCapacityError();
  }

  const claims: Record<string, RewardClaim> = {};
  const claimDayFloor = server.claimDayFloor;
  for (const claimId of new Set([
    ...Object.keys(server.claims),
    ...Object.keys(local.claims),
  ])) {
    if (isRetiredRewardClaim(claimId, claimDayFloor)) continue;
    const remote = server.claims[claimId];
    const device = local.claims[claimId];
    if (!remote || !device) {
      claims[claimId] = { ...(remote ?? device)! };
      continue;
    }
    claims[claimId] = stableRewardClaim(remote, device);
  }

  const merged: RewardJournal = {
    baselineXp: Math.max(server.baselineXp, local.baselineXp),
    baselineCoins: Math.max(server.baselineCoins, local.baselineCoins),
    replicas,
    replicaEpoch: server.replicaEpoch,
    claims,
    claimDayFloor,
    legacyBaseline: false,
  };
  if (Object.keys(merged.claims).length > MAX_ACTIVE_REWARD_CLAIMS) {
    throw new RewardJournalCapacityError();
  }
  return merged;
}

function rewardTotals(journal: RewardJournal): {
  xp: number;
  coins: number;
} {
  let xp = journal.baselineXp;
  let coins = journal.baselineCoins;
  let legacySpend = 0;
  for (const counter of Object.values(journal.replicas)) {
    xp += counter.xpEarned;
    coins += counter.coinsEarned;
    legacySpend += counter.coinsSpent;
  }
  coins = Math.max(0, coins - legacySpend);
  for (const claimId of Object.keys(journal.claims).sort()) {
    const claim = journal.claims[claimId];
    if (claim.coinsSpent > coins) continue;
    xp += claim.xpEarned;
    coins += claim.coinsEarned - claim.coinsSpent;
  }
  return {
    xp: Math.min(100_000_000, Math.max(0, xp)),
    coins: Math.min(100_000_000, Math.max(0, coins)),
  };
}

function admittedRewardClaimIds(journal: RewardJournal): Set<string> {
  let coins = journal.baselineCoins;
  let legacySpend = 0;
  for (const counter of Object.values(journal.replicas)) {
    coins += counter.coinsEarned;
    legacySpend += counter.coinsSpent;
  }
  coins = Math.max(0, coins - legacySpend);
  const admitted = new Set<string>();
  for (const claimId of Object.keys(journal.claims).sort()) {
    const claim = journal.claims[claimId];
    if (claim.coinsSpent > coins) continue;
    admitted.add(claimId);
    coins += claim.coinsEarned - claim.coinsSpent;
  }
  return admitted;
}

function mergeLegacyRewardJournal(
  server: RewardJournal,
  local: RewardJournal,
  serverUpdatedAt: number,
  localUpdatedAt: number,
): RewardJournal {
  if (server.legacyBaseline && local.legacyBaseline) {
    return {
      baselineXp: Math.max(server.baselineXp, local.baselineXp),
      baselineCoins:
        localUpdatedAt >= serverUpdatedAt
          ? rewardTotals(local).coins
          : rewardTotals(server).coins,
      replicas: {},
      replicaEpoch: server.replicaEpoch,
      claims: {},
      claimDayFloor: laterDateKey(
        server.claimDayFloor,
        local.claimDayFloor,
      ),
      legacyBaseline: false,
    };
  }

  const modern = server.legacyBaseline ? local : server;
  const legacy = server.legacyBaseline ? server : local;
  const modernTotals = rewardTotals(modern);
  const legacyTotals = rewardTotals(legacy);
  const legacyIsNewer = server.legacyBaseline
    ? serverUpdatedAt >= localUpdatedAt
    : localUpdatedAt >= serverUpdatedAt;
  return {
    ...modern,
    baselineXp:
      modern.baselineXp + Math.max(0, legacyTotals.xp - modernTotals.xp),
    baselineCoins:
      modern.baselineCoins +
      (legacyIsNewer ? legacyTotals.coins - modernTotals.coins : 0),
    legacyBaseline: false,
  };
}

function stableRewardClaim(
  left: RewardClaim,
  right: RewardClaim,
): RewardClaim {
  const leftKey = [
    left.replicaId,
    left.xpEarned,
    left.coinsEarned,
    left.coinsSpent,
  ].join(":");
  const rightKey = [
    right.replicaId,
    right.xpEarned,
    right.coinsEarned,
    right.coinsSpent,
  ].join(":");
  return { ...(leftKey <= rightKey ? left : right) };
}

function boundedRewardDelta(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000) {
    throw new Error("Reward deltas must be bounded non-negative integers.");
  }
  return Number(value);
}

function validRewardReplicaId(value: string): boolean {
  return (
    value.length >= 8 &&
    value.length <= 120 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

export const MAX_ACTIVE_REWARD_REPLICAS = 512;
export const MAX_ACTIVE_REWARD_CLAIMS = 512;

export class RewardJournalCapacityError extends Error {
  constructor() {
    super("Reward journal capacity was reached; no replica was discarded.");
    this.name = "RewardJournalCapacityError";
  }
}

export class RewardJournalEpochError extends Error {
  constructor() {
    super("Reward journal epochs differ; reconciliation must fail closed.");
    this.name = "RewardJournalEpochError";
  }
}

function validRewardClaimId(value: string): boolean {
  return (
    value.length >= 8 &&
    value.length <= 120 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isRetiredRewardClaim(
  claimId: string,
  claimDayFloor: string | null,
): boolean {
  const day = dailyRewardClaimDay(claimId);
  return day !== null && claimDayFloor !== null && day <= claimDayFloor;
}

function dailyRewardClaimDay(claimId: string): string | null {
  const match = claimId.match(
    /^daily:(?:challenge|dice):(\d{4}-\d{2}-\d{2})$/,
  );
  return match ? dateKeyFromUnknown(match[1]) : null;
}

function createEphemeralRewardReplicaId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `reward-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function stableNamespaceHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function clampSignedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
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

  for (const wordId of Object.keys(value).slice(0, 2_000)) {
    // Keep well-formed progress for temporarily removed or unpublished words so
    // a later republish can restore it. Runtime curriculum helpers decide which
    // records are currently visible and countable.
    if (!isSafeWordId(wordId)) continue;
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

function isSafeWordId(value: string): boolean {
  return (
    WORD_IDS.has(value) ||
    (value.length <= 84 &&
      /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(value))
  );
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
