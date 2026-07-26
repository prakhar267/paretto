import { describe, expect, it } from "vitest";

import {
  linkedLearnerUserKey,
  mergeNativeStateIntoWeb,
  nativeStateAsWeb,
  webStateAsNative,
} from "../app/api/native/_lib/native-account-bridge";
import {
  initialNativeLearningState,
  validateNativeLearningState,
} from "../app/api/native/_lib/native-progress";
import {
  accountUserKey,
} from "../app/server-auth";
import {
  createInitialState,
  type LearningState,
} from "../app/learning-engine";
import { setCloudflareEnv } from "./cloudflare-workers-mock";

const NOW = "2026-07-25T09:30:00.000Z";
const LATER = "2026-07-25T10:30:00.000Z";

describe("native learner-account bridge", () => {
  it("merges native learning into canonical progress without changing web-only consent", () => {
    const web: LearningState = {
      ...createInitialState(new Date(NOW)),
      onboarded: true,
      displayName: "Camille Web",
      level: "returning",
      xp: 80,
      settings: {
        sound: false,
        phonetics: true,
        reducedMotion: false,
        sessionReminders: true,
        analytics: true,
      },
      dice: {
        lastPlayedDate: "2026-07-25",
        lastPlayedResult: {
          date: "2026-07-25",
          stake: 3,
          multiplier: 2,
          xp: 6,
        },
      },
    };
    const native = {
      ...initialNativeLearningState(),
      onboarded: true,
      displayName: "Camille Native",
      xp: 120,
      coins: 30,
      updatedAt: LATER,
      wordProgress: {
        "idf-metro": {
          stage: 2,
          seen: 2,
          correct: 2,
          incorrect: 0,
          nextReviewAt: "2026-07-26T10:30:00.000Z",
          lastReviewedAt: LATER,
        },
      },
      sessions: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          mode: "learn",
          regionID: "ile-de-france",
          wordIDs: ["idf-metro"],
          correct: 1,
          xpEarned: 18,
          completedAt: LATER,
        },
      ],
      dice: { lastPlayedDate: "2026-07-25" },
      settings: {
        sound: true,
        phonetics: false,
        reducedMotion: true,
        analytics: false,
      },
    };

    const merged = mergeNativeStateIntoWeb(web, native);

    expect(merged).toMatchObject({
      displayName: "Camille Native",
      level: "returning",
      xp: 120,
      coins: 30,
      settings: {
        sound: true,
        phonetics: false,
        reducedMotion: true,
        sessionReminders: true,
        analytics: true,
      },
      dice: {
        lastPlayedDate: "2026-07-25",
        lastPlayedResult: {
          date: "2026-07-25",
          stake: 3,
          multiplier: 2,
          xp: 6,
        },
      },
    });
    expect(merged.wordProgress["idf-metro"]?.stage).toBe(2);
    expect(merged.sessions).toEqual([
      expect.objectContaining({
        id: "10000000-0000-4000-8000-000000000001",
        words: 1,
      }),
    ]);
  });

  it("projects canonical state without fabricating unavailable native session details", () => {
    const nativeSession = {
      id: "10000000-0000-4000-8000-000000000002",
      mode: "review",
      regionID: "ile-de-france",
      wordIDs: ["idf-metro"],
      correct: 1,
      xpEarned: 18,
      completedAt: NOW,
    };
    const native = {
      ...initialNativeLearningState(),
      sessions: [nativeSession],
      updatedAt: NOW,
    };
    const web = nativeStateAsWeb(native);
    web.sessions.unshift({
      id: "20000000-0000-4000-8000-000000000002",
      mode: "learn",
      words: 5,
      correct: 4,
      xpEarned: 18,
      completedAt: LATER,
    });

    const projected = webStateAsNative(web, native);

    expect(validateNativeLearningState(projected)).toBe(true);
    expect(projected.sessions).toEqual([nativeSession]);
  });

  it("uses the exact canonical account key and fails closed without its secret", async () => {
    const secret = "native-bridge-test-secret-with-at-least-32-characters";
    setCloudflareEnv({ USER_KEY_SECRET: secret });
    await expect(linkedLearnerUserKey("learner-123")).resolves.toBe(
      await accountUserKey(secret, "learner-123"),
    );

    setCloudflareEnv({});
    await expect(linkedLearnerUserKey("learner-123")).resolves.toBeNull();
  });
});
