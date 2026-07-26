// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ParettoApp, {
  activeCurriculumLesson,
  applyInitialPlacement,
  applyUnlocksAndCollectibles,
  completionPersistenceMessage,
  curriculumContentSummary,
  hardRatingTiming,
  selectChallengeWords,
  selectLearningLesson,
  selectReviewWords,
} from "../app/ParettoApp";
import { WORDS } from "../app/learning-data";
import {
  createInitialState,
  localDateKey,
  markWordKnown,
  rateWord,
  type LearningState,
} from "../app/learning-engine";
import { getFrenchAudioService } from "../app/audio/french-audio-service";

const BASE_TIME = new Date("2026-07-20T08:00:00.000Z");
const DAY_IN_TEST_MS = 24 * 60 * 60 * 1000;

type ProgressRequest = {
  state: LearningState;
  revision: number;
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Paretto learner journey", () => {
  let serverState: LearningState;
  let revision: number;
  let fetchMock: ReturnType<typeof vi.fn>;
  let speakMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getFrenchAudioService().dispose();
    window.localStorage.clear();
    serverState = createInitialState(BASE_TIME);
    revision = 0;

    fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";

      if (method === "PUT") {
        const request = JSON.parse(String(init?.body)) as ProgressRequest;
        if (request.revision !== revision) {
          return jsonResponse({ error: "revision_conflict" }, 409);
        }

        serverState = request.state;
        revision += 1;
      }

      return jsonResponse({
        state: serverState,
        revision,
        savedAt: revision ? new Date().toISOString() : null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    });

    speakMock = vi.fn();
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: vi.fn(),
        getVoices: vi.fn(() => [{ lang: "fr-FR" }]),
        speak: speakMock,
      },
    });

    class MockSpeechSynthesisUtterance {
      lang = "";
      rate = 1;
      voice: { lang: string } | null = null;

      constructor(public text: string) {}
    }

    vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);
    vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  });

  it("never overclaims persistence when device storage or cloud sync is unavailable", () => {
    expect(completionPersistenceMessage("saved", "available")).toBe(
      "Saved on this device and in the cloud.",
    );
    expect(completionPersistenceMessage("offline", "available")).toContain(
      "will retry",
    );
    expect(completionPersistenceMessage("error", "available")).toContain(
      "cloud sync failed",
    );
    expect(completionPersistenceMessage("error", "unavailable")).toContain(
      "Saving is not confirmed",
    );
  });

  it("keeps the final lesson result pending until its cloud write succeeds", async () => {
    const user = userEvent.setup();
    serverState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
      displayName: "Camille",
    };

    let releasePut: () => void = () => undefined;
    const putGate = new Promise<void>((resolve) => {
      releasePut = resolve;
    });
    let announcePutStarted: () => void = () => undefined;
    const putStarted = new Promise<void>((resolve) => {
      announcePutStarted = resolve;
    });
    let announced = false;
    fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "PUT") {
          if (!announced) {
            announced = true;
            announcePutStarted();
          }
          await putGate;
          const request = JSON.parse(String(init?.body)) as ProgressRequest;
          serverState = request.state;
          revision += 1;
        }
        return jsonResponse({
          state: serverState,
          revision,
          savedAt: revision ? new Date().toISOString() : null,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ParettoApp storageKey="pending-final-card-test" />);
    await screen.findByRole("heading", {
      name: /your french is going places/i,
    });
    await user.click(
      screen.getByRole("button", { name: /start lesson 1/i }),
    );
    const lesson = await screen.findByRole("dialog");
    for (let card = 0; card < 5; card += 1) {
      await user.click(
        within(lesson).getByRole("button", { name: /reveal the card/i }),
      );
      await user.click(
        within(lesson).getByRole("button", { name: /got it/i }),
      );
    }

    await putStarted;
    expect(
      within(lesson).getByText(
        "Queued in this browser. Keep Paretto open while cloud sync finishes.",
      ),
    ).toBeVisible();
    expect(
      within(lesson).queryByText("Saved on this device and in the cloud."),
    ).not.toBeInTheDocument();

    releasePut();
    await waitFor(() =>
      expect(
        within(lesson).getByText("Saved on this device and in the cloud."),
      ).toBeVisible(),
    );
  });

  afterEach(() => {
    cleanup();
    getFrenchAudioService().dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("onboards a learner and completes the first five-card Paris lesson", async () => {
    const user = userEvent.setup();
    render(<ParettoApp />);

    expect(
      await screen.findByRole("heading", {
        name: /learn french, one region at a time/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Build a 270-word French foundation/),
    ).toBeInTheDocument();
    const productInformation = screen.getByRole("navigation", {
      name: "Product information",
    });
    for (const label of [
      "Privacy",
      "Terms",
      "Cookies & storage",
      "Accessibility",
      "Attributions",
      "Support",
    ]) {
      expect(
        within(productInformation).getByRole("link", { name: label }),
      ).toBeInTheDocument();
    }
    await expectNoAutomatedA11yViolations(document.body);

    await user.click(screen.getByRole("button", { name: /begin the journey/i }));
    const setupHeading = screen.getByRole("heading", {
      name: "Your first stop",
    });
    await waitFor(() => expect(setupHeading).toHaveFocus());
    expect(
      within(
        screen.getByRole("navigation", { name: "Product information" }),
      ).getByRole("link", { name: "Support" }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: /what should we call you/i }),
      "Camille",
    );
    await user.click(screen.getByRole("button", { name: /fresh start/i }));
    await user.click(screen.getByRole("button", { name: /10 words/i }));
    await user.click(screen.getByRole("button", { name: /start with paris basics/i }));

    expect(
      await screen.findByRole("heading", {
        name: /your french is going places/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Camille", { selector: "strong" })).toBeInTheDocument();
    await expectNoAutomatedA11yViolations(document.body);

    await user.click(
      screen.getByRole("button", { name: /start lesson 1/i }),
    );

    const lesson = await screen.findByRole("dialog");
    expect(within(lesson).getByText("1 / 5")).toBeInTheDocument();
    await expectNoAutomatedA11yViolations(lesson);

    await user.click(
      within(lesson).getByRole("button", { name: /hear pronunciation/i }),
    );
    await waitFor(() =>
      expect(
        within(lesson).getByRole("button", { name: /pause pronunciation/i }),
      ).toHaveAttribute("data-audio-source", "asset"),
    );
    expect(speakMock).not.toHaveBeenCalled();

    for (let card = 1; card <= 5; card += 1) {
      expect(within(lesson).getByText(`${card} / 5`)).toBeInTheDocument();
      await user.click(
        within(lesson).getByRole("button", { name: /reveal the card/i }),
      );
      expect(within(lesson).getByText(/how did that feel/i)).toBeInTheDocument();
      await user.click(within(lesson).getByRole("button", { name: /got it/i }));
    }

    const completion = await within(lesson).findByRole("status");
    const completionHeading = within(completion).getByRole("heading", {
      name: /très bien, camille/i,
    });
    expect(completionHeading).toBeInTheDocument();
    await waitFor(() => expect(completionHeading).toHaveFocus());
    expect(
      within(completion).getByText(/recalled 5 of 5/i),
    ).toBeInTheDocument();

    await user.click(
      within(completion).getByRole("button", { name: /back to today/i }),
    );
    expect(screen.getByText("5 of 15 words collected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue lesson 2/i }),
    ).toBeInTheDocument();

    await waitFor(
      () => {
        expect(serverState.onboarded).toBe(true);
        expect(serverState.displayName).toBe("Camille");
        expect(serverState.level).toBe("new");
        expect(serverState.dailyGoal).toBe(10);
        expect(Object.keys(serverState.wordProgress)).toHaveLength(5);
        expect(serverState.sessions[0]).toMatchObject({
          mode: "learn",
          words: 5,
          correct: 5,
          xpEarned: 18,
        });
      },
      { timeout: 3_000 },
    );

    expect(serverState.xp).toBe(68);
    expect(serverState.coins).toBe(19);
    expect(serverState.streak).toBe(1);
    expect(serverState.unlockedRegionIds).toContain("hauts-de-france");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/progress",
      expect.objectContaining({ method: "PUT" }),
    );
  }, 10_000);

  it("moves focus to the revealed answer and then the next card heading", async () => {
    const user = userEvent.setup();
    serverState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
      displayName: "Camille",
    };
    const firstLesson = WORDS.filter(
      (word) => word.regionId === "ile-de-france" && word.lesson === 1,
    );

    render(<ParettoApp storageKey="lesson-card-focus-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(screen.getByRole("button", { name: /start lesson 1/i }));

    const lesson = await screen.findByRole("dialog");
    const firstHeading = within(lesson).getByRole("heading", {
      name: firstLesson[0].french,
    });
    await waitFor(() => expect(firstHeading).toHaveFocus());

    await user.click(
      within(lesson).getByRole("button", { name: /reveal the card/i }),
    );
    const revealedAnswer = within(lesson).getByText(firstLesson[0].english, {
      selector: ".answer-panel > strong",
    });
    await waitFor(() => expect(revealedAnswer).toHaveFocus());

    await user.click(within(lesson).getByRole("button", { name: /got it/i }));
    const nextHeading = within(lesson).getByRole("heading", {
      name: firstLesson[1].french,
    });
    await waitFor(() => expect(nextHeading).toHaveFocus());
  });

  it("resumes an interrupted lesson without leaking cards from the next lesson", () => {
    const parisLessonOne = WORDS.filter(
      (word) => word.regionId === "ile-de-france" && word.lesson === 1,
    );
    let interruptedState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
    };
    for (const word of parisLessonOne.slice(0, 3)) {
      interruptedState = markWordKnown(interruptedState, word.id, BASE_TIME);
    }

    const resumed = selectLearningLesson(
      interruptedState,
      "ile-de-france",
      WORDS,
    );

    expect(resumed.words).toHaveLength(5);
    expect(resumed.words.slice(0, 2).map((word) => word.id)).toEqual(
      parisLessonOne.slice(3).map((word) => word.id),
    );
    expect(resumed.words.every((word) => word.lesson === 1)).toBe(true);

    let laterLessonOnly = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
    };
    for (const word of WORDS.filter(
      (item) => item.regionId === "ile-de-france" && item.lesson === 2,
    )) {
      laterLessonOnly = markWordKnown(laterLessonOnly, word.id, BASE_TIME);
    }
    expect(
      applyUnlocksAndCollectibles(
        laterLessonOnly,
        "ile-de-france",
        WORDS,
      ).unlockedRegionIds,
    ).not.toContain("hauts-de-france");

    const completedFirstLesson = applyUnlocksAndCollectibles(
      interruptedState,
      "ile-de-france",
      WORDS,
    );
    expect(completedFirstLesson.unlockedRegionIds).not.toContain(
      "hauts-de-france",
    );
    for (const word of parisLessonOne.slice(3)) {
      interruptedState = markWordKnown(interruptedState, word.id, BASE_TIME);
    }
    expect(
      applyUnlocksAndCollectibles(
        interruptedState,
        "ile-de-france",
        WORDS,
      ).unlockedRegionIds,
    ).toContain("hauts-de-france");
  });

  it("uses proficiency to create transparent, distinct starting placements", () => {
    const base = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
    };

    const fresh = applyInitialPlacement(base, "new", WORDS, BASE_TIME);
    const someFrench = applyInitialPlacement(base, "some", WORDS, BASE_TIME);
    const returning = applyInitialPlacement(
      base,
      "returning",
      WORDS,
      BASE_TIME,
    );

    expect(Object.keys(fresh.wordProgress)).toHaveLength(0);
    expect(Object.keys(someFrench.wordProgress)).toHaveLength(5);
    expect(
      Object.values(someFrench.wordProgress).every(
        (progress) => progress.stage === 1,
      ),
    ).toBe(true);
    expect(
      activeCurriculumLesson(someFrench, "ile-de-france", WORDS),
    ).toBe(2);
    expect(Object.keys(returning.wordProgress)).toHaveLength(10);
    expect(
      Object.values(returning.wordProgress).every(
        (progress) =>
          progress.stage === 0 &&
          progress.nextReviewAt === BASE_TIME.toISOString(),
      ),
    ).toBe(true);
    expect(
      activeCurriculumLesson(returning, "ile-de-france", WORDS),
    ).toBe(3);
    expect(someFrench.unlockedRegionIds).toContain("hauts-de-france");
  });

  it("derives learner-facing curriculum scale from active content", () => {
    expect(curriculumContentSummary(WORDS)).toEqual({
      contextCount: 18,
      lessonCount: 54,
      wordCount: 270,
      cefrLevels: ["A1", "A2"],
    });

    expect(
      curriculumContentSummary([
        ...WORDS,
        {
          ...WORDS[0],
          id: "cms-future-fluency",
          lesson: 24,
          cefr: "C2",
          topic: "advanced fluency",
        },
      ]),
    ).toEqual({
      contextCount: 18,
      lessonCount: 55,
      wordCount: 271,
      cefrLevels: ["A1", "A2", "C2"],
    });
  });

  it("orders due reviews first and rotates non-due practice fairly", () => {
    const learnedWords = WORDS.slice(0, 8);
    let practiceState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
    };
    for (const [index, word] of learnedWords.entries()) {
      practiceState = markWordKnown(
        practiceState,
        word.id,
        new Date(BASE_TIME.getTime() + index * 60_000),
      );
    }

    const firstRound = selectReviewWords(
      practiceState,
      WORDS,
      BASE_TIME,
    );
    expect(firstRound).toHaveLength(5);

    let afterFirstRound = practiceState;
    for (const word of firstRound) {
      afterFirstRound = rateWord(
        afterFirstRound,
        word.id,
        "good",
        new Date(BASE_TIME.getTime() + DAY_IN_TEST_MS),
      );
    }
    const secondRound = selectReviewWords(
      afterFirstRound,
      WORDS,
      new Date(BASE_TIME.getTime() + 2 * 60 * 60 * 1000),
    );
    expect(secondRound.slice(0, 3).every(
      (word) => !firstRound.some((first) => first.id === word.id),
    )).toBe(true);

    const [laterDue, earlierDue] = learnedWords;
    const dueNow = new Date(BASE_TIME.getTime() + 2 * DAY_IN_TEST_MS);
    const dueState = {
      ...practiceState,
      wordProgress: {
        ...practiceState.wordProgress,
        [laterDue.id]: {
          ...practiceState.wordProgress[laterDue.id],
          nextReviewAt: new Date(dueNow.getTime() - 60_000).toISOString(),
        },
        [earlierDue.id]: {
          ...practiceState.wordProgress[earlierDue.id],
          nextReviewAt: new Date(dueNow.getTime() - 120_000).toISOString(),
        },
      },
    };
    expect(
      selectReviewWords(dueState, WORDS, dueNow).slice(0, 2).map(
        (word) => word.id,
      ),
    ).toEqual([earlierDue.id, laterDue.id]);
  });

  it("rotates challenge cards predictably by day and excludes orphan progress", () => {
    let challengeState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
    };
    for (const word of WORDS.slice(0, 8)) {
      challengeState = markWordKnown(challengeState, word.id, BASE_TIME);
    }
    challengeState = {
      ...challengeState,
      wordProgress: {
        ...challengeState.wordProgress,
        "cms-retired-card": {
          ...challengeState.wordProgress[WORDS[0].id],
        },
      },
    };

    const dayOne = selectChallengeWords(
      challengeState,
      WORDS,
      "2026-07-20",
    );
    const dayOneAgain = selectChallengeWords(
      challengeState,
      WORDS,
      "2026-07-20",
    );
    const dayTwo = selectChallengeWords(
      challengeState,
      WORDS,
      "2026-07-21",
    );

    expect(dayOneAgain.map((word) => word.id)).toEqual(
      dayOne.map((word) => word.id),
    );
    expect(dayTwo.map((word) => word.id)).not.toEqual(
      dayOne.map((word) => word.id),
    );
    expect(dayOne).toHaveLength(5);
    expect(dayOne.some((word) => word.id === "cms-retired-card")).toBe(false);
  });

  it("rotates completed-chapter practice across the whole region", () => {
    const parisWords = WORDS.filter(
      (word) => word.regionId === "ile-de-france",
    );
    let completedState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
    };
    for (const word of parisWords) {
      completedState = markWordKnown(completedState, word.id, BASE_TIME);
    }

    const firstRound = selectLearningLesson(
      completedState,
      "ile-de-france",
      WORDS,
    ).words;
    expect(firstRound).toHaveLength(5);
    expect(new Set(firstRound.map((word) => word.lesson)).size).toBeGreaterThan(1);

    for (const word of firstRound) {
      completedState = rateWord(
        completedState,
        word.id,
        "good",
        new Date(BASE_TIME.getTime() + DAY_IN_TEST_MS),
      );
    }
    const secondRound = selectLearningLesson(
      completedState,
      "ile-de-france",
      WORDS,
    ).words;
    expect(
      secondRound.every(
        (word) => !firstRound.some((first) => first.id === word.id),
      ),
    ).toBe(true);
  });

  it("describes the actual hard-rating interval", () => {
    const progress = markWordKnown(
      createInitialState(BASE_TIME),
      WORDS[0].id,
      BASE_TIME,
    ).wordProgress[WORDS[0].id];

    expect(hardRatingTiming()).toBe("In 4 hours");
    expect(hardRatingTiming({ ...progress, stage: 2 })).toBe(
      "In about 2 days",
    );
    expect(hardRatingTiming({ ...progress, stage: 6 })).toBe("In 45 days");
  });

  it("routes a new learner into discovery instead of reviewing unseen cards", async () => {
    const user = userEvent.setup();
    serverState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
      displayName: "Camille",
    };

    render(<ParettoApp storageKey="new-learner-review-guard-test" />);

    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(screen.getAllByRole("button", { name: /^review$/i })[0]);
    const firstLessonButton = await screen.findByRole("button", {
      name: /start first lesson/i,
    });
    expect(screen.queryByRole("button", { name: /practice anyway/i })).not.toBeInTheDocument();
    await user.click(firstLessonButton);

    const lesson = await screen.findByRole("dialog");
    expect(
      within(lesson).getByText(/notice the sound and article/i),
    ).toBeInTheDocument();
    expect(
      within(lesson).queryByText(/say the meaning—and the article/i),
    ).not.toBeInTheDocument();
  });

  it("shows singular review and coin copy with the actual one-word round size", async () => {
    const user = userEvent.setup();
    const now = new Date();
    serverState = {
      ...markWordKnown(
        { ...createInitialState(now), onboarded: true, displayName: "Camille" },
        WORDS[0].id,
        now,
      ),
      coins: 1,
    };
    serverState.rewardJournal = {
      ...serverState.rewardJournal,
      baselineCoins: 1,
    };
    serverState = {
      ...serverState,
      wordProgress: {
        ...serverState.wordProgress,
        [WORDS[0].id]: {
          ...serverState.wordProgress[WORDS[0].id],
          nextReviewAt: new Date(now.getTime() - 60_000).toISOString(),
        },
      },
    };

    render(<ParettoApp storageKey="actual-review-size-test" />);

    expect(await screen.findByText("1 review is ready")).toBeInTheDocument();
    expect(screen.getByText("travel coin")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /^review$/i })[0]);
    expect(
      screen.getByRole("button", { name: "Review 1 word" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 coin available")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open profile/i }));
    const progressStats = screen.getByRole("region", {
      name: /progress statistics/i,
    });
    expect(within(progressStats).getByText("word")).toBeInTheDocument();
  });

  it("uses singular copy for one remaining card, one-hour review, and one mastered word", async () => {
    const user = userEvent.setup();
    const now = new Date();
    const firstLesson = WORDS.filter(
      (word) => word.regionId === "ile-de-france" && word.lesson === 1,
    );
    serverState = {
      ...createInitialState(now),
      onboarded: true,
      displayName: "Camille",
    };

    for (const word of firstLesson.slice(0, 4)) {
      serverState = markWordKnown(serverState, word.id, now);
    }

    const [masteredWord, ...learningWords] = firstLesson;
    serverState = {
      ...serverState,
      wordProgress: {
        ...serverState.wordProgress,
        [masteredWord.id]: {
          ...serverState.wordProgress[masteredWord.id],
          stage: 4,
          nextReviewAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        },
        ...Object.fromEntries(
          learningWords.slice(0, 3).map((word) => [
            word.id,
            { ...serverState.wordProgress[word.id], stage: 0 as const },
          ]),
        ),
      },
    };

    render(<ParettoApp storageKey="singular-copy-test" />);

    expect(
      await screen.findByRole("button", {
        name: /continue lesson 1 · 1 card left/i,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /^wordbook$/i })[0]);
    await user.click(
      await screen.findByRole("button", { name: /le métro.*the metro/i }),
    );
    const wordDialog = await screen.findByRole("dialog");
    expect(within(wordDialog).getByText("in 1 hour")).toBeInTheDocument();
    await user.click(within(wordDialog).getByRole("button", { name: "Close" }));

    await user.click(screen.getAllByRole("button", { name: /^review$/i })[0]);
    expect(
      screen.getByRole("button", { name: "Practice 4 words" }),
    ).toBeInTheDocument();
    const masterySection = screen
      .getByRole("heading", { name: /a schedule you can understand/i })
      .closest("section");
    expect(masterySection).not.toBeNull();
    expect(within(masterySection!).getByText("1 word solid")).toBeInTheDocument();
    expect(within(masterySection!).getByText("1 word")).toBeInTheDocument();
  });

  it("uses learned-only challenge prompts and keeps the daily reward after an early close", async () => {
    const user = userEvent.setup();
    serverState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
      displayName: "Camille",
    };
    for (const word of WORDS.slice(0, 3)) {
      serverState = markWordKnown(serverState, word.id, BASE_TIME);
    }
    const initialXp = serverState.xp;

    render(<ParettoApp storageKey="challenge-integrity-test" />);
    expect(
      await screen.findByRole("heading", {
        name: /your french is going places/i,
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getAllByRole("button", { name: /^review$/i })[0],
    );
    await user.click(
      await screen.findByRole("button", { name: /begin challenge/i }),
    );

    let challenge = await screen.findByRole("dialog");
    expect(within(challenge).getByText("Question 1 of 3")).toBeInTheDocument();
    await user.click(
      within(challenge).getByRole("button", {
        name: selectChallengeWords(
          serverState,
          WORDS,
          localDateKey(),
        )[0].english,
      }),
    );

    expect(serverState.challenge.lastPlayedDate).toBeNull();
    expect(serverState.xp).toBe(initialXp);
    await user.click(
      within(challenge).getByRole("button", { name: /close challenge/i }),
    );

    expect(
      await screen.findByText(/ready · 3 learned words/i),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /begin challenge/i }),
    );
    challenge = await screen.findByRole("dialog");
    expect(within(challenge).getByText("Question 1 of 3")).toBeInTheDocument();
    await user.click(
      within(challenge).getByRole("button", {
        name: selectChallengeWords(
          serverState,
          WORDS,
          localDateKey(),
        )[0].english,
      }),
    );
    expect(
      within(challenge).getByText(
        /the gate opens a little farther/i,
      ),
    ).toBeInTheDocument();
    expect(serverState.xp).toBe(initialXp);
  });

  it("moves focus to the result heading when a challenge is completed", async () => {
    const user = userEvent.setup();
    serverState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
      displayName: "Camille",
    };
    for (const word of WORDS.slice(0, 3)) {
      serverState = markWordKnown(serverState, word.id, BASE_TIME);
    }

    render(<ParettoApp storageKey="challenge-completion-focus-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(screen.getAllByRole("button", { name: /^review$/i })[0]);
    await user.click(await screen.findByRole("button", { name: /begin challenge/i }));

    const challengeWords = selectChallengeWords(
      serverState,
      WORDS,
      localDateKey(),
    );
    for (const [index, word] of challengeWords.entries()) {
      const challenge = await screen.findByRole("dialog");
      await user.click(within(challenge).getByRole("button", { name: word.english }));
      await user.click(
        within(challenge).getByRole("button", {
          name: index === 2 ? /see result/i : /next question/i,
        }),
      );
      if (index < challengeWords.length - 1) {
        const nextQuestionHeading = within(challenge).getByRole("heading", {
          name: `What does “${challengeWords[index + 1].french}” mean?`,
        });
        await waitFor(() => expect(nextQuestionHeading).toHaveFocus());
      }
    }

    const resultHeading = await screen.findByRole("heading", {
      name: /mission complete/i,
    });
    await waitFor(() => expect(resultHeading).toHaveFocus());
    await waitFor(() =>
      expect(serverState.challenge.lastPlayedDate).toBe(localDateKey()),
    );
  });

  it("returns a completed review to its actual origin", async () => {
    const user = userEvent.setup();
    const now = new Date();
    serverState = markWordKnown(
      {
        ...createInitialState(now),
        onboarded: true,
        displayName: "Camille",
      },
      WORDS[0].id,
      now,
    );
    serverState = {
      ...serverState,
      wordProgress: {
        ...serverState.wordProgress,
        [WORDS[0].id]: {
          ...serverState.wordProgress[WORDS[0].id],
          nextReviewAt: new Date(now.getTime() - 60_000).toISOString(),
        },
      },
    };

    render(<ParettoApp storageKey="review-return-origin-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(screen.getAllByRole("button", { name: /^review$/i })[0]);
    await user.click(
      screen.getByRole("button", { name: /review 1 word/i }),
    );

    const lesson = await screen.findByRole("dialog");
    await user.click(
      within(lesson).getByRole("button", { name: /reveal the card/i }),
    );
    await user.click(
      within(lesson).getByRole("button", { name: /got it/i }),
    );

    expect(
      within(lesson).getByText(/strengthened your memory schedule/i),
    ).toBeInTheDocument();
    await user.click(
      within(lesson).getByRole("button", { name: /back to review/i }),
    );
    expect(
      await screen.findByRole("heading", { name: /make the words yours/i }),
    ).toBeInTheDocument();
  });

  it("focuses and announces main views, edits the daily goal, and explains fallback curriculum", async () => {
    const user = userEvent.setup();
    serverState = markWordKnown(
      {
        ...createInitialState(BASE_TIME),
        onboarded: true,
        displayName: "Camille",
      },
      WORDS[0].id,
      BASE_TIME,
    );

    render(<ParettoApp storageKey="navigation-settings-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    const main = screen.getByRole("main");

    await user.click(
      screen.getAllByRole("button", { name: /^journey$/i })[0],
    );
    expect(
      await screen.findByRole("heading", { name: /france, word by word/i }),
    ).toBeInTheDocument();
    await waitFor(() => expect(main).toHaveFocus());
    expect(screen.getByText("Journey view")).toBeInTheDocument();
    expect(
      screen.getByText("Built-in curriculum · no published CMS updates"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Live curriculum synced")).not.toBeInTheDocument();

    await user.click(
      screen.getAllByRole("button", { name: /^wordbook$/i })[0],
    );
    await user.click(
      await screen.findByRole("button", { name: /^verb$/i }),
    );
    expect(
      screen.getByRole("heading", { name: /no verb cards in this view/i }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /show all word types/i }),
    );
    expect(
      screen.getByRole("button", {
        name: new RegExp(`${WORDS[0].french}.*${WORDS[0].english}`, "i"),
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /open profile/i }));
    await waitFor(() => expect(main).toHaveFocus());
    expect(screen.getByText("Profile view")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /^15 words/i }),
    );
    await waitFor(() => expect(serverState.dailyGoal).toBe(15));
  });

  it("shows a visible error when both recorded and device audio fail", async () => {
    const user = userEvent.setup();
    serverState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
      displayName: "Camille",
    };
    vi.mocked(window.HTMLMediaElement.prototype.play).mockRejectedValue(
      new Error("audio unavailable"),
    );
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: undefined,
    });
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);
    getFrenchAudioService().dispose();

    render(<ParettoApp storageKey="visible-audio-error-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(
      screen.getByRole("button", { name: /start lesson 1/i }),
    );
    const lesson = await screen.findByRole("dialog");
    await user.click(
      within(lesson).getByRole("button", { name: /hear pronunciation/i }),
    );
    expect(
      await within(lesson).findByText(/audio unavailable — try again/i),
    ).toBeVisible();
  });

  it("uses truthful profile content and manages delete-confirmation focus", async () => {
    const user = userEvent.setup();
    serverState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
      displayName: "Camille",
      xp: 1_600,
      collectibles: ["alpine-badge"],
    };

    render(<ParettoApp storageKey="profile-focus-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(screen.getByRole("button", { name: /open profile/i }));

    expect(
      screen.getByText("Current French curriculum included"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sample cohort/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Maya")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /unlocked by reaching 1,600 xp across your learning activities/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/difficult review set/i),
    ).not.toBeInTheDocument();

    const deleteButton = screen.getByRole("button", {
      name: /delete my learning data/i,
    });
    await user.click(deleteButton);
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancelButton).toHaveFocus());
    await user.click(cancelButton);
    const restoredDeleteButton = screen.getByRole("button", {
      name: /delete my learning data/i,
    });
    await waitFor(() => expect(restoredDeleteButton).toHaveFocus());
  });
});

async function expectNoAutomatedA11yViolations(root: Element) {
  const results = await axe.run(root, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: {
      "color-contrast": { enabled: false },
    },
  });
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.flatMap((node) => node.target),
    })),
  ).toEqual([]);
}
