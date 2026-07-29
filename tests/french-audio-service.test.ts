import { describe, expect, it, vi } from "vitest";

import {
  FrenchAudioService,
  selectFrenchSpeechVoice,
  type AudioElementLike,
  type FrenchAudioEnvironment,
  type SpeechSynthesisLike,
  type SpeechUtteranceLike,
  type SpeechVoiceLike,
} from "../app/audio/french-audio-service";
import {
  FRENCH_AUDIO_MANIFEST,
  frenchAudioAssetUrl,
  hasFrenchAudioAsset,
} from "../app/audio/french-audio-manifest";
import { WORDS } from "../app/learning-data";

class FakeAudio implements AudioElementLike {
  src: string;
  preload = "none";
  currentTime = 0;
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onwaiting: (() => void) | null = null;
  playCount = 0;
  pauseCount = 0;
  loadCount = 0;
  removedSource = false;
  rejectPlay = false;

  constructor(src: string) {
    this.src = src;
  }

  async play(): Promise<void> {
    this.playCount += 1;
    if (this.rejectPlay) throw new Error("asset unavailable");
    this.onplay?.();
  }

  pause(): void {
    this.pauseCount += 1;
    this.onpause?.();
  }

  load(): void {
    this.loadCount += 1;
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.src = "";
      this.removedSource = true;
    }
  }
}

function createUtterance(): SpeechUtteranceLike {
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

function createHarness(options: {
  assets?: readonly string[];
  rejectAsset?: boolean;
  speechAvailable?: boolean;
} = {}) {
  const audios: FakeAudio[] = [];
  const utterances: SpeechUtteranceLike[] = [];
  const voices: SpeechVoiceLike[] = [
    { lang: "en-US" },
    { lang: "fr-CA" },
    { lang: "fr-FR" },
  ];
  let currentUtterance: SpeechUtteranceLike | null = null;
  const speech: SpeechSynthesisLike = {
    cancel: vi.fn(),
    speak: vi.fn((utterance) => {
      currentUtterance = utterance;
      utterances.push(utterance);
      utterance.onstart?.();
    }),
    pause: vi.fn(() => currentUtterance?.onpause?.()),
    resume: vi.fn(() => currentUtterance?.onresume?.()),
    getVoices: vi.fn(() => voices),
  };
  const assetIds = new Set(options.assets ?? []);
  const environment: FrenchAudioEnvironment = {
    createAudio: (url) => {
      const audio = new FakeAudio(url);
      audio.rejectPlay = options.rejectAsset ?? false;
      audios.push(audio);
      return audio;
    },
    getSpeechSynthesis: () =>
      options.speechAvailable === false ? null : speech,
    createUtterance: () =>
      options.speechAvailable === false ? null : createUtterance(),
    hasAsset: (wordId, text) =>
      assetIds.has(wordId) &&
      WORDS.find((word) => word.id === wordId)?.french.normalize("NFC") ===
        text.normalize("NFC"),
    assetUrl: frenchAudioAssetUrl,
  };

  return {
    service: new FrenchAudioService(environment),
    audios,
    utterances,
    speech,
  };
}

describe("frenchAudioAssetUrl", () => {
  it("creates versioned deterministic same-origin WAV URLs", () => {
    expect(frenchAudioAssetUrl("idf-se-depecher")).toBe(
      "/audio/fr/v2/idf-se-depecher.wav",
    );
    expect(() => frenchAudioAssetUrl("../secret")).toThrow(
      "Invalid French audio word id",
    );
  });

  it("publishes a licensed packaged asset for every compiled curriculum word", () => {
    expect(FRENCH_AUDIO_MANIFEST.generation).toMatchObject({
      status: "ready",
      synthetic: true,
      distributionCleared: true,
      voice: "ff_siwis",
      voiceGender: "female",
      quality: "high",
    });
    const availableIds = new Set(FRENCH_AUDIO_MANIFEST.availableWordIds);
    for (const word of WORDS) expect(availableIds.has(word.id)).toBe(true);
    expect(FRENCH_AUDIO_MANIFEST.availableWordIds.length).toBeGreaterThanOrEqual(
      270,
    );
  });

  it("only accepts a packaged clip when its manifest text still matches", () => {
    expect(hasFrenchAudioAsset("idf-metro", "le métro")).toBe(true);
    expect(hasFrenchAudioAsset("idf-metro", "  le me\u0301tro  ")).toBe(true);
    expect(hasFrenchAudioAsset("idf-metro", "le métro parisien")).toBe(false);
  });
});

describe("FrenchAudioService", () => {
  it("prefers a French female fallback voice over a male device default", () => {
    expect(
      selectFrenchSpeechVoice(
        [
          { lang: "fr-FR", localService: true, name: "Thomas" },
          { lang: "fr-FR", localService: false, name: "Amélie" },
          { lang: "fr-CA", localService: true, name: "Marie" },
        ],
        "fr-FR",
      ),
    ).toMatchObject({ name: "Amélie", lang: "fr-FR" });
    expect(
      selectFrenchSpeechVoice(
        [
          { lang: "fr-FR", localService: true, name: "Thomas" },
          { lang: "fr-CA", localService: true, name: "Marie" },
        ],
        "fr-FR",
      ),
    ).toMatchObject({ name: "Marie", lang: "fr-CA" });
  });

  it("uses an exact fr-FR device voice when no static asset is available", async () => {
    const { service, speech, utterances } = createHarness();

    await service.play({
      wordId: "idf-metro",
      text: "le métro",
      enabled: true,
    });

    expect(speech.speak).toHaveBeenCalledOnce();
    expect(utterances).toHaveLength(1);
    expect(utterances[0]).toMatchObject({
      lang: "fr-FR",
      rate: 0.86,
      pitch: 1,
      voice: { lang: "fr-FR" },
    });
    expect(service.getSnapshot()).toMatchObject({
      status: "playing",
      source: "speech",
      wordId: "idf-metro",
    });

    service.pause();
    expect(speech.pause).toHaveBeenCalledOnce();
    expect(service.getSnapshot().status).toBe("paused");
    await service.resume();
    expect(speech.resume).toHaveBeenCalledOnce();
    expect(service.getSnapshot().status).toBe("playing");

    utterances[0].onend?.();
    expect(service.getSnapshot().status).toBe("ended");
  });

  it("respects the sound setting before constructing any playback", async () => {
    const { service, audios, speech } = createHarness({
      assets: ["idf-metro"],
    });

    await service.play({
      wordId: "idf-metro",
      text: "le métro",
      enabled: false,
    });

    expect(audios).toHaveLength(0);
    expect(speech.speak).not.toHaveBeenCalled();
    expect(service.getSnapshot()).toMatchObject({
      status: "disabled",
      wordId: null,
    });
  });

  it("preloads once, reuses the cached asset, and exposes media states", async () => {
    const { service, audios } = createHarness({ assets: ["idf-metro"] });

    service.preload([
      { wordId: "idf-metro", text: "le métro" },
      { wordId: "idf-metro", text: "le métro" },
    ]);
    expect(audios).toHaveLength(1);
    expect(audios[0].loadCount).toBe(1);
    expect(audios[0].preload).toBe("auto");

    await service.play({
      wordId: "idf-metro",
      text: "le métro",
      enabled: true,
    });
    expect(audios).toHaveLength(1);
    expect(audios[0].playCount).toBe(1);
    expect(service.getSnapshot()).toMatchObject({
      status: "playing",
      source: "asset",
    });

    service.pause();
    expect(audios[0].pauseCount).toBe(1);
    expect(service.getSnapshot().status).toBe("paused");
    await service.resume();
    expect(audios[0].playCount).toBe(2);
    audios[0].onended?.();
    expect(service.getSnapshot().status).toBe("ended");
  });

  it("falls back to local speech after an asset playback failure", async () => {
    const { service, audios, speech } = createHarness({
      assets: ["idf-metro"],
      rejectAsset: true,
    });

    await service.play({
      wordId: "idf-metro",
      text: "le métro",
      enabled: true,
    });

    expect(audios).toHaveLength(1);
    expect(speech.speak).toHaveBeenCalledOnce();
    expect(service.getSnapshot()).toMatchObject({
      status: "playing",
      source: "speech",
      message:
        "The saved recording was unavailable. Using the French voice on this device.",
    });

    await service.play({
      wordId: "idf-metro",
      text: "le métro",
      enabled: true,
    });
    expect(audios[0].playCount).toBe(1);
    expect(speech.speak).toHaveBeenCalledTimes(2);
  });

  it("uses current speech instead of a stale packaged clip after CMS text changes", async () => {
    const { service, audios, speech, utterances } = createHarness({
      assets: ["idf-metro"],
    });

    service.preload([
      { wordId: "idf-metro", text: "le métro parisien" },
    ]);
    expect(audios).toHaveLength(0);

    await service.play({
      wordId: "idf-metro",
      text: "le métro parisien",
      enabled: true,
    });

    expect(audios).toHaveLength(0);
    expect(speech.speak).toHaveBeenCalledOnce();
    expect(utterances).toHaveLength(1);
    expect(service.getSnapshot()).toMatchObject({
      status: "playing",
      source: "speech",
      wordId: "idf-metro",
    });
  });

  it("falls back to speech when a paused asset cannot resume", async () => {
    const { service, audios, speech } = createHarness({
      assets: ["idf-metro"],
    });
    await service.play({
      wordId: "idf-metro",
      text: "le métro",
      enabled: true,
    });
    service.pause();
    audios[0].rejectPlay = true;

    await service.resume();

    expect(speech.speak).toHaveBeenCalledOnce();
    expect(service.getSnapshot()).toMatchObject({
      status: "playing",
      source: "speech",
      wordId: "idf-metro",
      message:
        "The saved recording could not resume. Using the French voice on this device.",
    });
  });

  it("cancels stale utterances and ignores their late events", async () => {
    const { service, utterances, speech } = createHarness();

    await service.play({
      wordId: "idf-metro",
      text: "le métro",
      enabled: true,
    });
    const first = utterances[0];
    await service.play({
      wordId: "idf-musee",
      text: "un musée",
      enabled: true,
    });

    expect(first.onend).toBeNull();
    expect(speech.cancel).toHaveBeenCalled();
    expect(service.getSnapshot().wordId).toBe("idf-musee");
  });

  it("reports an accessible error when neither assets nor speech exist", async () => {
    const { service } = createHarness({ speechAvailable: false });

    await service.play({
      wordId: "idf-metro",
      text: "le métro",
      enabled: true,
    });

    expect(service.getSnapshot()).toEqual({
      status: "error",
      source: null,
      wordId: "idf-metro",
      message: "French speech is unavailable in this browser.",
      errorCode: "speech-unavailable",
    });
  });

  it("releases cached media and event handlers on disposal", () => {
    const { service, audios } = createHarness({
      assets: ["idf-metro", "idf-musee"],
    });
    service.preload([
      { wordId: "idf-metro", text: "le métro" },
      { wordId: "idf-musee", text: "un musée" },
    ]);

    service.dispose();

    expect(audios).toHaveLength(2);
    for (const audio of audios) {
      expect(audio.removedSource).toBe(true);
      expect(audio.onerror).toBeNull();
      expect(audio.pauseCount).toBeGreaterThan(0);
    }
    expect(service.getSnapshot().status).toBe("idle");
  });
});
