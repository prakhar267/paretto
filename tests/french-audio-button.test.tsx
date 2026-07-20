// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FrenchAudioButton } from "../app/audio/FrenchAudioButton";
import {
  FrenchAudioService,
  type SpeechUtteranceLike,
} from "../app/audio/french-audio-service";
import { frenchAudioAssetUrl } from "../app/audio/french-audio-manifest";

function makeUtterance(): SpeechUtteranceLike {
  return {
    lang: "",
    rate: 1,
    pitch: 1,
    voice: null,
    onstart: null,
    onend: null,
    onerror: null,
    onpause: null,
    onresume: null,
  };
}

describe("FrenchAudioButton", () => {
  it("exposes setting, playback, pause, and live status accessibly", async () => {
    let currentUtterance: SpeechUtteranceLike | null = null;
    const speech = {
      cancel: vi.fn(),
      speak: vi.fn((utterance: SpeechUtteranceLike) => {
        currentUtterance = utterance;
        utterance.onstart?.();
      }),
      pause: vi.fn(() => currentUtterance?.onpause?.()),
      resume: vi.fn(() => currentUtterance?.onresume?.()),
      getVoices: vi.fn(() => [{ lang: "fr-FR" }]),
    };
    const service = new FrenchAudioService({
      createAudio: () => null,
      getSpeechSynthesis: () => speech,
      createUtterance: makeUtterance,
      hasAsset: () => false,
      assetUrl: frenchAudioAssetUrl,
    });
    const user = userEvent.setup();
    const view = render(
      <FrenchAudioButton
        wordId="idf-metro"
        text="le métro"
        enabled={false}
        service={service}
      />,
    );

    const disabledButton = screen.getByRole("button", {
      name: "French audio is off for le métro",
    });
    expect(disabledButton).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "French audio is turned off in settings.",
    );

    view.rerender(
      <FrenchAudioButton
        wordId="idf-metro"
        text="le métro"
        enabled
        service={service}
      />,
    );
    const playButton = screen.getByRole("button", {
      name: "Hear pronunciation of le métro",
    });
    await user.click(playButton);

    const pauseButton = screen.getByRole("button", {
      name: "Pause pronunciation of le métro",
    });
    expect(pauseButton).toHaveAttribute("aria-pressed", "true");
    expect(pauseButton).toHaveAttribute("data-audio-source", "speech");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Using the French voice on this device.",
    );

    await user.click(pauseButton);
    expect(
      screen.getByRole("button", {
        name: "Resume pronunciation of le métro",
      }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("status")).toHaveTextContent(
      "French pronunciation paused.",
    );
  });
});
