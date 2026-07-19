import { describe, expect, it } from "vitest";

import {
  MASTERY_INTERVALS_MS,
  STATE_VERSION,
  completeSession,
  createInitialState,
  dueCount,
  isDue,
  levelFromXp,
  markWordKnown,
  mergeLearningStates,
  rateWord,
  stateFromUnknown,
  updateStreak,
  xpForLevel,
  type LearningState,
  type MasteryStage,
  type WordProgress,
} from "../app/learning-engine";

const BASE_TIME = new Date("2026-07-19T10:00:00.000Z");

function progressAt(
  stage: MasteryStage,
  overrides: Partial<WordProgress> = {},
): WordProgress {
  return {
    stage,
    seen: 1,
    correct: 1,
    incorrect: 0,
    nextReviewAt: "2026-07-19T09:00:00.000Z",
    lastReviewedAt: "2026-07-18T09:00:00.000Z",
    ...overrides,
  };
}

function stateWithWord(
  wordId: string,
  progress: WordProgress,
): LearningState {
  return {
    ...createInitialState(BASE_TIME),
    wordProgress: { [wordId]: progress },
  };
}

describe("createInitialState", () => {
  it("creates a deterministic, ready-to-onboard state", () => {
    expect(createInitialState(BASE_TIME)).toEqual({
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
      updatedAt: BASE_TIME.toISOString(),
    });
  });
});

describe("rateWord", () => {
  it("advances and rewards a new word rated good", () => {
    const initial = createInitialState(BASE_TIME);
    const result = rateWord(initial, "bonjour", "good", BASE_TIME);

    expect(result.xp).toBe(10);
    expect(result.coins).toBe(13);
    expect(result.wordProgress.bonjour).toEqual({
      stage: 1,
      seen: 1,
      correct: 1,
      incorrect: 0,
      lastReviewedAt: BASE_TIME.toISOString(),
      nextReviewAt: new Date(
        BASE_TIME.getTime() + MASTERY_INTERVALS_MS[1],
      ).toISOString(),
    });
    expect(result.updatedAt).toBe(BASE_TIME.toISOString());
  });

  it("keeps the stage and uses half its interval for hard", () => {
    const initial = stateWithWord(
      "merci",
      progressAt(2, { seen: 4, correct: 3, incorrect: 1 }),
    );
    const result = rateWord(initial, "merci", "hard", BASE_TIME);

    expect(result.xp).toBe(6);
    expect(result.coins).toBe(initial.coins);
    expect(result.wordProgress.merci).toMatchObject({
      stage: 2,
      seen: 5,
      correct: 4,
      incorrect: 1,
      nextReviewAt: new Date(
        BASE_TIME.getTime() + Math.round(MASTERY_INTERVALS_MS[2] * 0.5),
      ).toISOString(),
    });
  });

  it("moves back one stage and schedules ten minutes for again", () => {
    const initial = stateWithWord(
      "fromage",
      progressAt(3, { seen: 5, correct: 4, incorrect: 1 }),
    );
    const result = rateWord(initial, "fromage", "again", BASE_TIME);

    expect(result.xp).toBe(2);
    expect(result.coins).toBe(initial.coins);
    expect(result.wordProgress.fromage).toMatchObject({
      stage: 2,
      seen: 6,
      correct: 4,
      incorrect: 2,
      nextReviewAt: new Date(
        BASE_TIME.getTime() + MASTERY_INTERVALS_MS[0],
      ).toISOString(),
    });
  });

  it("caps good at the highest stage and again at the lowest stage", () => {
    const mastered = rateWord(
      stateWithWord("voyage", progressAt(6)),
      "voyage",
      "good",
      BASE_TIME,
    );
    const fresh = rateWord(
      stateWithWord("chat", progressAt(0)),
      "chat",
      "again",
      BASE_TIME,
    );

    expect(mastered.wordProgress.voyage.stage).toBe(6);
    expect(mastered.wordProgress.voyage.nextReviewAt).toBe(
      new Date(
        BASE_TIME.getTime() + MASTERY_INTERVALS_MS[6],
      ).toISOString(),
    );
    expect(fresh.wordProgress.chat.stage).toBe(0);
    expect(fresh.wordProgress.chat.nextReviewAt).toBe(
      new Date(
        BASE_TIME.getTime() + MASTERY_INTERVALS_MS[0],
      ).toISOString(),
    );
  });
});

describe("markWordKnown", () => {
  it("marks a word mastered without erasing its history", () => {
    const initial = stateWithWord(
      "croissant",
      progressAt(2, { seen: 7, correct: 5, incorrect: 2 }),
    );
    const result = markWordKnown(initial, "croissant", BASE_TIME);

    expect(result.xp).toBe(initial.xp + 5);
    expect(result.coins).toBe(initial.coins);
    expect(result.wordProgress.croissant).toEqual({
      stage: 6,
      seen: 7,
      correct: 5,
      incorrect: 2,
      lastReviewedAt: BASE_TIME.toISOString(),
      nextReviewAt: new Date(
        BASE_TIME.getTime() + MASTERY_INTERVALS_MS[6],
      ).toISOString(),
    });
  });

  it("gives an unseen known word a valid learning history", () => {
    const result = markWordKnown(
      createInitialState(BASE_TIME),
      "baguette",
      BASE_TIME,
    );

    expect(result.wordProgress.baguette).toMatchObject({
      stage: 6,
      seen: 1,
      correct: 1,
      incorrect: 0,
    });
  });
});

describe("review due dates", () => {
  it("treats the exact review timestamp as due", () => {
    const progress = progressAt(1, {
      nextReviewAt: BASE_TIME.toISOString(),
    });

    expect(isDue(progress, new Date(BASE_TIME.getTime() - 1))).toBe(false);
    expect(isDue(progress, BASE_TIME)).toBe(true);
    expect(isDue(progress, new Date(BASE_TIME.getTime() + 1))).toBe(true);
  });

  it("counts past and boundary reviews but excludes future reviews", () => {
    const state = {
      ...createInitialState(BASE_TIME),
      wordProgress: {
        past: progressAt(0, {
          nextReviewAt: new Date(BASE_TIME.getTime() - 1).toISOString(),
        }),
        boundary: progressAt(1, {
          nextReviewAt: BASE_TIME.toISOString(),
        }),
        future: progressAt(2, {
          nextReviewAt: new Date(BASE_TIME.getTime() + 1).toISOString(),
        }),
      },
    };

    expect(dueCount(state, BASE_TIME)).toBe(2);
  });
});

describe("updateStreak", () => {
  it("does not increment twice on the same day", () => {
    const state = {
      ...createInitialState(BASE_TIME),
      streak: 4,
      longestStreak: 6,
      lastActiveDate: "2026-07-19",
    };

    expect(updateStreak(state, "2026-07-19")).toBe(state);
  });

  it("increments on the next calendar day", () => {
    const state = {
      ...createInitialState(BASE_TIME),
      streak: 4,
      longestStreak: 4,
      lastActiveDate: "2026-07-18",
    };

    expect(updateStreak(state, "2026-07-19")).toMatchObject({
      streak: 5,
      longestStreak: 5,
      lastActiveDate: "2026-07-19",
    });
  });

  it("resets after a gap while preserving the longest streak", () => {
    const state = {
      ...createInitialState(BASE_TIME),
      streak: 4,
      longestStreak: 9,
      lastActiveDate: "2026-07-16",
    };

    expect(updateStreak(state, "2026-07-19")).toMatchObject({
      streak: 1,
      longestStreak: 9,
      lastActiveDate: "2026-07-19",
    });
  });
});

describe("completeSession", () => {
  it("is idempotent by session id", () => {
    const session = {
      id: "session-1",
      mode: "review" as const,
      words: 5,
      correct: 4,
      xpEarned: 40,
    };
    const initial = createInitialState(BASE_TIME);
    const completed = completeSession(
      initial,
      session,
      BASE_TIME,
      "2026-07-19",
    );
    const replayed = completeSession(
      completed,
      session,
      new Date(BASE_TIME.getTime() + 60_000),
      "2026-07-19",
    );

    expect(completed.xp).toBe(40);
    expect(completed.coins).toBe(14);
    expect(completed.streak).toBe(1);
    expect(completed.sessions).toEqual([
      { ...session, completedAt: BASE_TIME.toISOString() },
    ]);
    expect(replayed).toBe(completed);
  });
});

describe("level math", () => {
  it("uses exact quadratic XP thresholds", () => {
    expect(levelFromXp(-1)).toBe(1);
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(49)).toBe(1);
    expect(levelFromXp(50)).toBe(2);
    expect(levelFromXp(199)).toBe(2);
    expect(levelFromXp(200)).toBe(3);
    expect(levelFromXp(449)).toBe(3);
    expect(levelFromXp(450)).toBe(4);

    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(50);
    expect(xpForLevel(3)).toBe(200);
    expect(xpForLevel(4)).toBe(450);
  });

  it("round-trips every valid level threshold", () => {
    for (let level = 1; level <= 25; level += 1) {
      expect(levelFromXp(xpForLevel(level))).toBe(level);
    }
  });
});

describe("stateFromUnknown", () => {
  it("falls back for non-objects and incompatible versions", () => {
    const fallback = createInitialState(BASE_TIME);

    expect(stateFromUnknown(null, BASE_TIME)).toEqual(fallback);
    expect(
      stateFromUnknown({ version: STATE_VERSION + 1, xp: 500 }, BASE_TIME),
    ).toEqual(fallback);
  });

  it("clamps numbers, trims identity, filters lists, and limits history", () => {
    const sessions = Array.from({ length: 55 }, (_, index) => ({
      id: `session-${index}`,
      mode: "learn" as const,
      completedAt: BASE_TIME.toISOString(),
      words: 5,
      correct: 5,
      xpEarned: 50,
    }));
    const result = stateFromUnknown(
      {
        version: STATE_VERSION,
        dailyGoal: 99,
        xp: 10_000_001,
        coins: 3.6,
        streak: -4,
        longestStreak: 100_001,
        displayName: `  ${"A".repeat(45)}  `,
        unlockedRegionIds: ["ile-de-france", 42, "bretagne", null],
        sessions,
        collectibles: ["metro-ticket", false, "postcard", "castle-key", 7],
        settings: { sound: false },
        challenge: { bestScore: 12 },
        dice: { lastPlayedDate: "2026-07-18" },
      },
      BASE_TIME,
    );

    expect(result.dailyGoal).toBe(5);
    expect(result.xp).toBe(10_000_000);
    expect(result.coins).toBe(4);
    expect(result.streak).toBe(0);
    expect(result.longestStreak).toBe(100_000);
    expect(result.displayName).toBe("A".repeat(40));
    expect(result.unlockedRegionIds).toEqual([
      "ile-de-france",
      "bretagne",
    ]);
    expect(result.sessions).toHaveLength(50);
    expect(result.sessions.at(-1)?.id).toBe("session-49");
    expect(result.collectibles).toEqual(["metro-ticket", "castle-key"]);
    expect(result.settings).toEqual({
      sound: false,
      phonetics: true,
      reducedMotion: false,
      sessionReminders: false,
    });
    expect(result.challenge).toEqual({
      lastPlayedDate: null,
      bestScore: 12,
    });
    expect(result.dice).toEqual({ lastPlayedDate: "2026-07-18" });
  });

  it("preserves valid goals and replaces an empty display name", () => {
    const result = stateFromUnknown(
      {
        version: STATE_VERSION,
        dailyGoal: 15,
        displayName: "   ",
        xp: Number.NaN,
        coins: Number.POSITIVE_INFINITY,
      },
      BASE_TIME,
    );

    expect(result.dailyGoal).toBe(15);
    expect(result.displayName).toBe("Traveler");
    expect(result.xp).toBe(0);
    expect(result.coins).toBe(0);
  });

  it("deeply rejects malformed records, enums, dates, IDs, and booleans", () => {
    const result = stateFromUnknown(
      {
        version: STATE_VERSION,
        onboarded: "yes",
        level: "expert",
        streak: 8,
        longestStreak: 2,
        lastActiveDate: "2026-02-30",
        currentRegionId: "atlantis",
        unlockedRegionIds: ["bretagne", "bretagne", "atlantis"],
        wordProgress: {
          "idf-metro": {
            stage: 2,
            seen: 1,
            correct: 4,
            incorrect: 2,
            nextReviewAt: "2026-07-22T10:00:00.000Z",
            lastReviewedAt: "2026-07-19T10:00:00.000Z",
          },
          "idf-musee": {
            stage: 9,
            seen: 2,
            correct: 2,
            incorrect: 0,
            nextReviewAt: "2026-07-22T10:00:00.000Z",
            lastReviewedAt: "2026-07-19T10:00:00.000Z",
          },
          "unknown-word": {
            stage: 1,
            seen: 1,
            correct: 1,
            incorrect: 0,
            nextReviewAt: "2026-07-22T10:00:00.000Z",
            lastReviewedAt: "2026-07-19T10:00:00.000Z",
          },
          "idf-anime": {
            stage: 1,
            seen: 1,
            correct: 1,
            incorrect: 0,
            nextReviewAt: "not-a-date",
            lastReviewedAt: "2026-07-19T10:00:00.000Z",
          },
        },
        sessions: [
          {
            id: " valid-session ",
            mode: "review",
            completedAt: "2026-07-19T10:00:00.000Z",
            words: 3,
            correct: 99,
            xpEarned: 12.6,
          },
          {
            id: "bad-mode",
            mode: "boss",
            completedAt: "2026-07-19T10:00:00.000Z",
            words: 5,
            correct: 5,
            xpEarned: 50,
          },
          {
            id: "bad-date",
            mode: "learn",
            completedAt: "yesterday",
            words: 5,
            correct: 5,
            xpEarned: 50,
          },
          {
            id: "valid-session",
            mode: "learn",
            completedAt: "2026-07-20T10:00:00.000Z",
            words: 5,
            correct: 5,
            xpEarned: 50,
          },
        ],
        collectibles: ["unknown", "metro-ticket", "metro-ticket"],
        settings: {
          sound: "false",
          phonetics: false,
          reducedMotion: true,
          sessionReminders: 1,
        },
        challenge: {
          lastPlayedDate: "tomorrow",
          bestScore: -8,
        },
        dice: { lastPlayedDate: "2026-07-18" },
        updatedAt: "yesterday",
      },
      BASE_TIME,
    );

    expect(result).toMatchObject({
      onboarded: false,
      level: "new",
      streak: 8,
      longestStreak: 8,
      lastActiveDate: null,
      currentRegionId: "ile-de-france",
      unlockedRegionIds: ["ile-de-france", "bretagne"],
      collectibles: ["metro-ticket"],
      settings: {
        sound: true,
        phonetics: false,
        reducedMotion: true,
        sessionReminders: false,
      },
      challenge: { lastPlayedDate: null, bestScore: 0 },
      dice: { lastPlayedDate: "2026-07-18" },
      updatedAt: BASE_TIME.toISOString(),
    });
    expect(result.wordProgress).toEqual({
      "idf-metro": {
        stage: 2,
        seen: 6,
        correct: 4,
        incorrect: 2,
        nextReviewAt: "2026-07-22T10:00:00.000Z",
        lastReviewedAt: "2026-07-19T10:00:00.000Z",
      },
    });
    expect(result.sessions).toEqual([
      {
        id: "valid-session",
        mode: "review",
        completedAt: "2026-07-19T10:00:00.000Z",
        words: 3,
        correct: 3,
        xpEarned: 13,
      },
    ]);
  });

  it("automatically unlocks a valid current region", () => {
    const result = stateFromUnknown(
      {
        version: STATE_VERSION,
        currentRegionId: "corse",
        unlockedRegionIds: ["unknown"],
      },
      BASE_TIME,
    );

    expect(result.currentRegionId).toBe("corse");
    expect(result.unlockedRegionIds).toEqual(["ile-de-france", "corse"]);
  });
});

describe("mergeLearningStates", () => {
  it("unions learning history while keeping newer choices and maximum rewards", () => {
    const server: LearningState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
      displayName: "Server name",
      level: "some",
      dailyGoal: 10,
      xp: 500,
      coins: 40,
      streak: 4,
      longestStreak: 6,
      lastActiveDate: "2026-07-18",
      currentRegionId: "bretagne",
      unlockedRegionIds: ["ile-de-france", "bretagne"],
      wordProgress: {
        "idf-metro": progressAt(4, {
          seen: 10,
          correct: 8,
          incorrect: 2,
          nextReviewAt: "2026-08-01T10:00:00.000Z",
          lastReviewedAt: "2026-07-19T10:00:00.000Z",
        }),
        "idf-musee": progressAt(1),
      },
      sessions: [
        {
          id: "shared",
          mode: "learn",
          completedAt: "2026-07-19T09:00:00.000Z",
          words: 5,
          correct: 3,
          xpEarned: 30,
        },
        {
          id: "server-only",
          mode: "review",
          completedAt: "2026-07-18T09:00:00.000Z",
          words: 4,
          correct: 4,
          xpEarned: 40,
        },
      ],
      collectibles: ["metro-ticket"],
      settings: {
        sound: true,
        phonetics: true,
        reducedMotion: false,
        sessionReminders: false,
      },
      challenge: { lastPlayedDate: "2026-07-18", bestScore: 4 },
      dice: { lastPlayedDate: "2026-07-19" },
      updatedAt: "2026-07-19T10:00:00.000Z",
    };
    const local: LearningState = {
      ...createInitialState(BASE_TIME),
      displayName: "Camille",
      level: "returning",
      dailyGoal: 15,
      xp: 450,
      coins: 52,
      streak: 5,
      longestStreak: 5,
      lastActiveDate: "2026-07-19",
      currentRegionId: "corse",
      unlockedRegionIds: ["ile-de-france", "corse"],
      wordProgress: {
        "idf-metro": progressAt(2, {
          seen: 9,
          correct: 9,
          incorrect: 1,
          nextReviewAt: "2026-07-22T11:00:00.000Z",
          lastReviewedAt: "2026-07-19T11:00:00.000Z",
        }),
        "idf-anime": progressAt(2),
      },
      sessions: [
        {
          id: "shared",
          mode: "challenge",
          completedAt: "2026-07-19T11:00:00.000Z",
          words: 5,
          correct: 5,
          xpEarned: 50,
        },
        {
          id: "local-only",
          mode: "learn",
          completedAt: "2026-07-19T10:30:00.000Z",
          words: 5,
          correct: 5,
          xpEarned: 50,
        },
      ],
      collectibles: ["castle-key"],
      settings: {
        sound: false,
        phonetics: false,
        reducedMotion: true,
        sessionReminders: true,
      },
      challenge: { lastPlayedDate: "2026-07-19", bestScore: 3 },
      dice: { lastPlayedDate: "2026-07-18" },
      updatedAt: "2026-07-19T11:00:00.000Z",
    };

    const result = mergeLearningStates(
      server,
      local,
      new Date("2026-07-19T12:00:00.000Z"),
    );

    expect(result).toMatchObject({
      onboarded: true,
      displayName: "Camille",
      level: "returning",
      dailyGoal: 15,
      xp: 500,
      coins: 52,
      streak: 5,
      longestStreak: 6,
      lastActiveDate: "2026-07-19",
      currentRegionId: "corse",
      unlockedRegionIds: ["ile-de-france", "bretagne", "corse"],
      collectibles: ["metro-ticket", "castle-key"],
      settings: local.settings,
      challenge: { lastPlayedDate: "2026-07-19", bestScore: 4 },
      dice: { lastPlayedDate: "2026-07-19" },
      updatedAt: "2026-07-19T12:00:00.000Z",
    });
    expect(result.wordProgress["idf-metro"]).toEqual({
      stage: 2,
      seen: 11,
      correct: 9,
      incorrect: 2,
      nextReviewAt: "2026-07-22T11:00:00.000Z",
      lastReviewedAt: "2026-07-19T11:00:00.000Z",
    });
    expect(Object.keys(result.wordProgress)).toEqual([
      "idf-metro",
      "idf-musee",
      "idf-anime",
    ]);
    expect(result.sessions.map((session) => session.id)).toEqual([
      "shared",
      "local-only",
      "server-only",
    ]);
    expect(result.sessions[0]).toMatchObject({
      mode: "challenge",
      correct: 5,
    });
  });

  it("uses local preferences when timestamps tie and sanitizes both inputs", () => {
    const server = {
      ...createInitialState(BASE_TIME),
      displayName: "Server",
      currentRegionId: "unknown",
      unlockedRegionIds: ["unknown"],
    };
    const local = {
      ...createInitialState(BASE_TIME),
      displayName: "Local",
      settings: {
        sound: false,
        phonetics: true,
        reducedMotion: false,
        sessionReminders: true,
      },
    };

    const result = mergeLearningStates(server, local, BASE_TIME);

    expect(result.displayName).toBe("Local");
    expect(result.settings).toEqual(local.settings);
    expect(result.currentRegionId).toBe("ile-de-france");
    expect(result.unlockedRegionIds).toEqual(["ile-de-france"]);
  });
});
