import { describe, expect, it } from "vitest";

import { createInitialState, stateFromUnknown } from "../app/learning-engine";
import {
  buildRuntimeCurriculum,
  lessonVocabulary,
  type PublishedRecordInput,
} from "../app/runtime-curriculum";

const RECORDS: PublishedRecordInput[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    kind: "vocabulary",
    slug: "idf-metro",
    stableKey: "idf-metro",
    title: "Métro editorial update",
    revision: 2,
    updatedAt: "2026-07-20T00:00:00.000Z",
    content: {
      french: "le métro parisien",
      english: "the Paris metro",
      ipa: "/lə metʁo paʁizjɛ̃/",
      partOfSpeech: "noun",
      gender: "masculine",
      regionId: "ile-de-france",
      exampleFr: "Je prends le métro parisien.",
      exampleEn: "I take the Paris metro.",
      cefr: "A1",
      lesson: 1,
      topic: "transport",
      emoji: "🚇",
      sensitive: false,
      tags: ["transport"],
    },
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    kind: "vocabulary",
    slug: "bonjour-equipe-revu",
    stableKey: "bonjour-equipe",
    aliases: ["bonjour-equipe", "bonjour-equipe-v1", "bonjour-equipe-revu"],
    title: "Bonjour l’équipe",
    revision: 1,
    updatedAt: "2026-07-20T00:00:00.000Z",
    content: {
      french: "bonjour l’équipe",
      english: "hello team",
      ipa: "/bɔ̃ʒuʁ lekip/",
      partOfSpeech: "phrase",
      gender: null,
      regionId: "ile-de-france",
      exampleFr: "Bonjour l’équipe, on commence ?",
      exampleEn: "Hello team, shall we begin?",
      cefr: "A2",
      lesson: 3,
      topic: "work",
      emoji: "👋",
      sensitive: false,
      tags: ["work"],
    },
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    kind: "lesson",
    slug: "paris-team-greetings",
    stableKey: "paris-team-greetings",
    title: "Team greetings in Paris",
    revision: 3,
    updatedAt: "2026-07-20T00:00:00.000Z",
    content: {
      summary: "Greet colleagues and navigate the city together.",
      regionId: "ile-de-france",
      cefr: "A2",
      lesson: 3,
      topic: "work",
      sensitive: false,
      introduction: "Use a warm greeting before making a practical suggestion.",
      estimatedMinutes: 6,
      vocabularyIds: ["cms-idf-metro", "cms-bonjour-equipe-v1"],
      blocks: [{ type: "tip", content: "Bonjour works throughout the day." }],
    },
  },
];

describe("runtime CMS curriculum", () => {
  it("publishes compiled overrides, new words, and lesson ordering end to end", () => {
    const runtime = buildRuntimeCurriculum(RECORDS);
    expect(runtime.words).toHaveLength(271);
    expect(runtime.words.find((word) => word.id === "idf-metro")).toMatchObject({
      french: "le métro parisien",
      cefr: "A1",
      lesson: 1,
      topic: "transport",
    });
    expect(runtime.words.find((word) => word.id === "cms-bonjour-equipe")).toMatchObject({
      partOfSpeech: "phrase",
      cefr: "A2",
      lesson: 3,
      topic: "work",
    });
    expect(lessonVocabulary(runtime.lessons[0], runtime.words).map((word) => word.id)).toEqual([
      "idf-metro",
      "cms-bonjour-equipe",
    ]);
  });

  it("preserves safely named CMS word progress while rejecting arbitrary keys", () => {
    const initial = createInitialState(new Date("2026-07-20T00:00:00.000Z"));
    const progress = {
      stage: 1,
      seen: 1,
      correct: 1,
      incorrect: 0,
      nextReviewAt: "2026-07-21T00:00:00.000Z",
      lastReviewedAt: "2026-07-20T00:00:00.000Z",
    };
    const state = stateFromUnknown({
      ...initial,
      wordProgress: { "cms-bonjour-equipe": progress, unsafe: progress },
    });
    expect(state.wordProgress).toEqual({ "cms-bonjour-equipe": progress });
  });
});
