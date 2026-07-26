import { isRecord } from "@/app/api/_lib/api-utils";
import {
  DEFAULT_COURSE_ID,
  isCourseId,
} from "@/app/course-catalog";
import {
  MAX_ACTIVE_REWARD_CLAIMS,
  MAX_ACTIVE_REWARD_REPLICAS,
} from "@/app/learning-engine";

const MAX_WORDS = 1_000;
const MAX_SESSIONS = 100;
const STATE_KEYS = [
  "schemaVersion",
  "onboarded",
  "displayName",
  "dailyGoal",
  "currentRegionID",
  "unlockedRegionIDs",
  "xp",
  "coins",
  "streak",
  "longestStreak",
  "wordProgress",
  "sessions",
  "collectibles",
  "challenge",
  "dice",
  "settings",
  "updatedAt",
] as const;
const OPTIONAL_STATE_KEYS = [
  "lastActiveDate",
  "activeCourseId",
  "courseProgress",
  "rewardJournal",
] as const;
const COURSE_PROGRESS_KEYS = [
  "currentContextId",
  "curriculumRevision",
  "updatedAt",
] as const;
const SETTINGS_KEYS = ["sound", "phonetics", "reducedMotion", "analytics"] as const;
const WORD_PROGRESS_KEYS = [
  "stage",
  "seen",
  "correct",
  "incorrect",
  "nextReviewAt",
  "lastReviewedAt",
] as const;
const SESSION_KEYS = [
  "id",
  "mode",
  "regionID",
  "wordIDs",
  "correct",
  "xpEarned",
  "completedAt",
] as const;
const CHALLENGE_KEYS = ["bestScore"] as const;
const DICE_RESULT_KEYS = ["date", "stake", "multiplier", "xp"] as const;
const REWARD_JOURNAL_KEYS = [
  "baselineXp",
  "baselineCoins",
  "replicas",
] as const;
const REWARD_COUNTER_KEYS = [
  "xpEarned",
  "coinsEarned",
  "coinsSpent",
] as const;
const REWARD_CLAIM_KEYS = [
  "replicaId",
  "xpEarned",
  "coinsEarned",
  "coinsSpent",
] as const;
const SAFE_CURRICULUM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateNativeLearningState(value: unknown): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, STATE_KEYS, OPTIONAL_STATE_KEYS) ||
    value.schemaVersion !== 1
  ) {
    return false;
  }
  const settings = value.settings;
  const challenge = value.challenge;
  const dice = value.dice;
  const activeCourseId = value.activeCourseId ?? DEFAULT_COURSE_ID;
  if (
    !isCourseId(activeCourseId) ||
    !validCourseProgress(value.courseProgress, activeCourseId) ||
    typeof value.onboarded !== "boolean" ||
    typeof value.displayName !== "string" ||
    value.displayName.length > 80 ||
    !Number.isInteger(value.dailyGoal) ||
    ![5, 10, 15].includes(Number(value.dailyGoal)) ||
    !safeCurriculumId(value.currentRegionID, 80) ||
    !curriculumIdArray(value.unlockedRegionIDs, 100, 80) ||
    !value.unlockedRegionIDs.includes(value.currentRegionID) ||
    !boundedInteger(value.xp, 0, 100_000_000) ||
    !boundedInteger(value.coins, 0, 100_000_000) ||
    !validRewardJournal(value.rewardJournal) ||
    !rewardJournalMatchesTotals(
      value.rewardJournal,
      Number(value.xp),
      Number(value.coins),
    ) ||
    !boundedInteger(value.streak, 0, 100_000) ||
    !boundedInteger(value.longestStreak, 0, 100_000) ||
    Number(value.longestStreak) < Number(value.streak) ||
    (value.lastActiveDate !== null &&
      value.lastActiveDate !== undefined &&
      !validDayKey(value.lastActiveDate)) ||
    !isRecord(value.wordProgress) ||
    Object.keys(value.wordProgress).length > MAX_WORDS ||
    !Array.isArray(value.sessions) ||
    value.sessions.length > MAX_SESSIONS ||
    !curriculumIdArray(value.collectibles, 50, 80) ||
    !isRecord(challenge) ||
    !hasExactKeys(challenge, CHALLENGE_KEYS, ["lastPlayedDate"]) ||
    !boundedInteger(challenge.bestScore, 0, 100) ||
    (challenge.lastPlayedDate !== null &&
      challenge.lastPlayedDate !== undefined &&
      !validDayKey(challenge.lastPlayedDate)) ||
    !isRecord(dice) ||
    !hasExactKeys(dice, [], ["lastPlayedDate", "lastPlayedResult"]) ||
    (dice.lastPlayedDate !== null &&
      dice.lastPlayedDate !== undefined &&
      !validDayKey(dice.lastPlayedDate)) ||
    !validDiceResult(dice.lastPlayedResult, dice.lastPlayedDate) ||
    !isRecord(settings) ||
    !hasExactKeys(settings, SETTINGS_KEYS) ||
    !validDate(value.updatedAt)
  ) {
    return false;
  }

  if (
    !["sound", "phonetics", "reducedMotion", "analytics"].every(
      (key) => typeof settings[key] === "boolean",
    )
  ) {
    return false;
  }
  for (const [wordId, progress] of Object.entries(value.wordProgress)) {
    if (
      !safeCurriculumId(wordId, 120) ||
      !isRecord(progress) ||
      !hasExactKeys(progress, WORD_PROGRESS_KEYS) ||
      !boundedInteger(progress.stage, 0, 6) ||
      !boundedInteger(progress.seen, 0, 1_000_000) ||
      !boundedInteger(progress.correct, 0, 1_000_000) ||
      !boundedInteger(progress.incorrect, 0, 1_000_000) ||
      Number(progress.correct) + Number(progress.incorrect) > Number(progress.seen) ||
      !validDate(progress.nextReviewAt) ||
      !validDate(progress.lastReviewedAt) ||
      Date.parse(progress.nextReviewAt) < Date.parse(progress.lastReviewedAt)
    ) {
      return false;
    }
  }
  const sessionIds = new Set<string>();
  for (const session of value.sessions) {
    if (
      !isRecord(session) ||
      !hasExactKeys(session, SESSION_KEYS) ||
      typeof session.id !== "string" ||
      !UUID.test(session.id) ||
      sessionIds.has(session.id) ||
      (session.mode !== "learn" &&
        session.mode !== "review" &&
        session.mode !== "challenge") ||
      !safeCurriculumId(session.regionID, 80) ||
      !curriculumIdArray(session.wordIDs, 100, 120) ||
      !boundedInteger(session.correct, 0, session.wordIDs.length) ||
      !boundedInteger(session.xpEarned, 0, 100_000) ||
      !validDate(session.completedAt)
    ) {
      return false;
    }
    sessionIds.add(session.id);
  }
  return true;
}

export function initialNativeLearningState() {
  return {
    schemaVersion: 1,
    activeCourseId: DEFAULT_COURSE_ID,
    courseProgress: {
      [DEFAULT_COURSE_ID]: {
        currentContextId: "ile-de-france",
        curriculumRevision: "compiled-v1",
        updatedAt: new Date(0).toISOString(),
      },
    },
    onboarded: false,
    displayName: "",
    dailyGoal: 5,
    currentRegionID: "ile-de-france",
    unlockedRegionIDs: ["ile-de-france"],
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
    wordProgress: {},
    sessions: [],
    collectibles: [],
    challenge: { bestScore: 0 },
    dice: { lastPlayedResult: null },
    settings: {
      sound: true,
      phonetics: true,
      reducedMotion: false,
      analytics: false,
    },
    updatedAt: new Date(0).toISOString(),
  };
}

function validCourseProgress(
  value: unknown,
  activeCourseId: string,
): boolean {
  // Older native schema-v1 payloads did not include course metadata.
  if (value === undefined) return true;
  if (!isRecord(value) || !(activeCourseId in value)) return false;
  for (const [courseId, rawMetadata] of Object.entries(value)) {
    if (
      !isCourseId(courseId) ||
      !isRecord(rawMetadata) ||
      !hasExactKeys(rawMetadata, COURSE_PROGRESS_KEYS) ||
      !safeCurriculumId(rawMetadata.currentContextId, 80) ||
      !validDate(rawMetadata.updatedAt) ||
      (rawMetadata.curriculumRevision !== null &&
        (typeof rawMetadata.curriculumRevision !== "string" ||
          rawMetadata.curriculumRevision.length < 1 ||
          rawMetadata.curriculumRevision.length > 160 ||
          !/^[A-Za-z0-9._:-]+$/.test(rawMetadata.curriculumRevision)))
    ) {
      return false;
    }
  }
  return true;
}

function validRewardJournal(value: unknown): boolean {
  // Older schema-v1 native builds did not include merge-safe reward counters.
  if (value === undefined) return true;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, REWARD_JOURNAL_KEYS, [
      "claims",
      "legacyBaseline",
      "replicaEpoch",
      "claimDayFloor",
    ]) ||
    !boundedInteger(value.baselineXp, 0, 100_000_000) ||
    !Number.isSafeInteger(value.baselineCoins) ||
    Number(value.baselineCoins) < -100_000_000 ||
    Number(value.baselineCoins) > 100_000_000 ||
    !isRecord(value.replicas) ||
    Object.keys(value.replicas).length > MAX_ACTIVE_REWARD_REPLICAS ||
    (value.claims !== undefined &&
      (!isRecord(value.claims) ||
        Object.keys(value.claims).length > MAX_ACTIVE_REWARD_CLAIMS)) ||
    (value.legacyBaseline !== undefined &&
      typeof value.legacyBaseline !== "boolean") ||
    (value.replicaEpoch !== undefined &&
      (!Number.isSafeInteger(value.replicaEpoch) ||
        Number(value.replicaEpoch) < 0 ||
        Number(value.replicaEpoch) > 1_000_000)) ||
    (value.claimDayFloor !== undefined &&
      value.claimDayFloor !== null &&
      !validDayKey(value.claimDayFloor))
  ) {
    return false;
  }
  const validReplicas = Object.entries(value.replicas).every(
    ([replicaId, rawCounter]) =>
      replicaId.length >= 8 &&
      replicaId.length <= 120 &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(replicaId) &&
      isRecord(rawCounter) &&
      hasExactKeys(rawCounter, REWARD_COUNTER_KEYS) &&
      boundedInteger(rawCounter.xpEarned, 0, 100_000_000) &&
      boundedInteger(rawCounter.coinsEarned, 0, 100_000_000) &&
      boundedInteger(rawCounter.coinsSpent, 0, 100_000_000),
  );
  if (!validReplicas) return false;
  return Object.entries(
    isRecord(value.claims) ? value.claims : {},
  ).every(
    ([claimId, rawClaim]) =>
      claimId.length >= 8 &&
      claimId.length <= 120 &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(claimId) &&
      isRecord(rawClaim) &&
      hasExactKeys(rawClaim, REWARD_CLAIM_KEYS) &&
      typeof rawClaim.replicaId === "string" &&
      rawClaim.replicaId.length >= 8 &&
      rawClaim.replicaId.length <= 120 &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(rawClaim.replicaId) &&
      boundedInteger(rawClaim.xpEarned, 0, 100_000_000) &&
      boundedInteger(rawClaim.coinsEarned, 0, 100_000_000) &&
      boundedInteger(rawClaim.coinsSpent, 0, 100_000_000) &&
      !isRetiredRewardClaim(
        claimId,
        typeof value.claimDayFloor === "string"
          ? value.claimDayFloor
          : null,
      ),
  );
}

function rewardJournalMatchesTotals(
  value: unknown,
  expectedXp: number,
  expectedCoins: number,
): boolean {
  // A pre-counter snapshot has only its top-level numeric totals.
  if (value === undefined) return true;
  if (!isRecord(value) || !isRecord(value.replicas)) return false;
  let xp = Number(value.baselineXp);
  let coins = Number(value.baselineCoins);
  let legacySpend = 0;
  for (const rawCounter of Object.values(value.replicas)) {
    if (!isRecord(rawCounter)) return false;
    xp += Number(rawCounter.xpEarned);
    coins += Number(rawCounter.coinsEarned);
    legacySpend += Number(rawCounter.coinsSpent);
  }
  coins = Math.max(0, coins - legacySpend);
  const claims = isRecord(value.claims) ? value.claims : {};
  if (
    Object.keys(value.replicas).length === 0 &&
    Object.keys(claims).length === 0
  ) {
    return true;
  }
  const claimDayFloor =
    typeof value.claimDayFloor === "string" ? value.claimDayFloor : null;
  for (const claimId of Object.keys(claims).sort()) {
    const claim = claims[claimId];
    if (isRetiredRewardClaim(claimId, claimDayFloor)) continue;
    if (!isRecord(claim) || Number(claim.coinsSpent) > coins) continue;
    xp += Number(claim.xpEarned);
    coins += Number(claim.coinsEarned) - Number(claim.coinsSpent);
  }
  return (
    Math.min(100_000_000, Math.max(0, xp)) === expectedXp &&
    Math.min(100_000_000, Math.max(0, coins)) === expectedCoins
  );
}

function isRetiredRewardClaim(
  claimId: string,
  claimDayFloor: string | null,
): boolean {
  const match = claimId.match(
    /^daily:(?:challenge|dice):(\d{4}-\d{2}-\d{2})$/,
  );
  return Boolean(
    match &&
      validDayKey(match[1]) &&
      claimDayFloor &&
      match[1] <= claimDayFloor,
  );
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function curriculumIdArray(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((entry) => safeCurriculumId(entry, maximumLength)) &&
    new Set(value).size === value.length
  );
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/,
  );
  if (!match) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const parsed = new Date(timestamp);
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute &&
    parsed.getUTCSeconds() === second
  );
}

function validDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function validDiceResult(value: unknown, lastPlayedDate: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, DICE_RESULT_KEYS) ||
    !validDayKey(value.date) ||
    value.date !== lastPlayedDate ||
    (value.stake !== 1 && value.stake !== 3 && value.stake !== 5) ||
    ![0.5, 1, 1.25, 1.5, 2, 3].includes(Number(value.multiplier)) ||
    !boundedInteger(value.xp, 0, 1_000_000)
  ) {
    return false;
  }
  return true;
}

function safeCurriculumId(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximumLength &&
    SAFE_CURRICULUM_ID.test(value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const allowed = new Set([...required, ...optional]);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
