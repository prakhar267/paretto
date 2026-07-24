// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ParettoApp, {
  applyUnlocksAndCollectibles,
  selectLearningLesson,
} from "../app/ParettoApp";
import { WORDS } from "../app/learning-data";
import {
  createInitialState,
  localDateKey,
  markWordKnown,
  type LearningState,
} from "../app/learning-engine";

const BASE_TIME = new Date("2026-07-20T08:00:00.000Z");

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

  afterEach(() => {
    cleanup();
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
    await expectNoAutomatedA11yViolations(document.body);

    await user.click(
      screen.getByRole("button", { name: /begin the journey/i }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /what should we call you/i }),
      "Camille",
    );
    await user.click(screen.getByRole("button", { name: /some french/i }));
    await user.click(screen.getByRole("button", { name: /10 words/i }));
    await user.click(screen.getByRole("button", { name: /start in paris/i }));

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
        expect(serverState.level).toBe("some");
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

  it("uses learned-only challenge prompts and prevents rewards after an early close", async () => {
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
        name: /the metro \/ subway/i,
      }),
    );

    await waitFor(
      () => {
        expect(serverState.challenge.lastPlayedDate).toBe(localDateKey());
        expect(serverState.xp).toBe(initialXp + 10);
      },
      { timeout: 3_000 },
    );
    const rewardedXp = serverState.xp;
    await user.click(
      within(challenge).getByRole("button", { name: /close challenge/i }),
    );

    expect(
      await screen.findByText(/completed today · practice is reward-free/i),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /play again for practice/i }),
    );
    challenge = await screen.findByRole("dialog");
    expect(within(challenge).getByText("Question 1 of 3")).toBeInTheDocument();
    await user.click(
      within(challenge).getByRole("button", {
        name: /the metro \/ subway/i,
      }),
    );
    expect(
      within(challenge).getByText(
        /practice mode leaves xp and review schedules unchanged/i,
      ),
    ).toBeInTheDocument();
    expect(serverState.xp).toBe(rewardedXp);
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

    for (const [index, word] of WORDS.slice(0, 3).entries()) {
      const challenge = await screen.findByRole("dialog");
      await user.click(within(challenge).getByRole("button", { name: word.english }));
      await user.click(
        within(challenge).getByRole("button", {
          name: index === 2 ? /see result/i : /next question/i,
        }),
      );
    }

    const resultHeading = await screen.findByRole("heading", {
      name: /mission complete/i,
    });
    await waitFor(() => expect(resultHeading).toHaveFocus());
  });

  it("uses truthful profile content and manages delete-confirmation focus", async () => {
    const user = userEvent.setup();
    serverState = {
      ...createInitialState(BASE_TIME),
      onboarded: true,
      displayName: "Camille",
    };

    render(<ParettoApp storageKey="profile-focus-test" />);
    await screen.findByRole("heading", { name: /your french is going places/i });
    await user.click(screen.getByRole("button", { name: /open profile/i }));

    expect(screen.getByText("Complete curriculum included")).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sample cohort/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Maya")).not.toBeInTheDocument();

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
