import { isRecord } from "@/app/api/_lib/api-utils";

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
const SAFE_CURRICULUM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateNativeLearningState(value: unknown): value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, STATE_KEYS, ["lastActiveDate"]) ||
    value.schemaVersion !== 1
  ) {
    return false;
  }
  const settings = value.settings;
  const challenge = value.challenge;
  const dice = value.dice;
  if (
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
    !hasExactKeys(dice, [], ["lastPlayedDate"]) ||
    (dice.lastPlayedDate !== null &&
      dice.lastPlayedDate !== undefined &&
      !validDayKey(dice.lastPlayedDate)) ||
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
    onboarded: false,
    displayName: "",
    dailyGoal: 5,
    currentRegionID: "ile-de-france",
    unlockedRegionIDs: ["ile-de-france"],
    xp: 0,
    coins: 12,
    streak: 0,
    longestStreak: 0,
    lastActiveDate: null,
    wordProgress: {},
    sessions: [],
    collectibles: [],
    challenge: { bestScore: 0 },
    dice: {},
    settings: {
      sound: true,
      phonetics: true,
      reducedMotion: false,
      analytics: false,
    },
    updatedAt: new Date(0).toISOString(),
  };
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
