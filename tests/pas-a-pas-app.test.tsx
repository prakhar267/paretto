// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PasAPasApp from "../app/PasAPasApp";
import {
  createInitialState,
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

describe("Pas à Pas learner journey", () => {
  let serverState: LearningState;
  let revision: number;
  let fetchMock: ReturnType<typeof vi.fn>;
  let speakMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("onboards a learner and completes the first five-card Paris lesson", async () => {
    const user = userEvent.setup();
    render(<PasAPasApp />);

    expect(
      await screen.findByRole("heading", {
        name: /learn french, one region at a time/i,
      }),
    ).toBeInTheDocument();

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

    await user.click(
      screen.getByRole("button", { name: /learn your first 5 words/i }),
    );

    const lesson = await screen.findByRole("dialog");
    expect(within(lesson).getByText("1 / 5")).toBeInTheDocument();

    await user.click(
      within(lesson).getByRole("button", { name: /hear it in french/i }),
    );
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0][0]).toMatchObject({
      lang: "fr-FR",
      rate: 0.86,
    });

    for (let card = 1; card <= 5; card += 1) {
      expect(within(lesson).getByText(`${card} / 5`)).toBeInTheDocument();
      await user.click(
        within(lesson).getByRole("button", { name: /reveal the card/i }),
      );
      expect(within(lesson).getByText(/how did that feel/i)).toBeInTheDocument();
      await user.click(within(lesson).getByRole("button", { name: /got it/i }));
    }

    const completion = await within(lesson).findByRole("status");
    expect(
      within(completion).getByRole("heading", { name: /très bien, camille/i }),
    ).toBeInTheDocument();
    expect(
      within(completion).getByText(/recalled 5 of 5/i),
    ).toBeInTheDocument();

    await user.click(
      within(completion).getByRole("button", { name: /back to today/i }),
    );
    expect(screen.getByText("5 of 5 words collected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue today’s lesson/i }),
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
});
