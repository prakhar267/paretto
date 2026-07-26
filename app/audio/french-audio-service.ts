import {
  courseAudioAssetUrl,
  hasCourseAudioAsset,
} from "./french-audio-manifest";
import {
  COURSE_CATALOG,
  DEFAULT_COURSE_ID,
  type CourseId,
} from "../course-catalog";

export type FrenchAudioStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "error"
  | "disabled";

export type FrenchAudioSource = "asset" | "speech" | null;

export type FrenchAudioSnapshot = {
  status: FrenchAudioStatus;
  source: FrenchAudioSource;
  wordId: string | null;
  message: string;
  errorCode: "invalid-request" | "speech-unavailable" | null;
  courseId?: CourseId | null;
};

export type FrenchAudioRequest = {
  courseId?: CourseId;
  wordId: string;
  text: string;
  enabled: boolean;
};

export type FrenchAudioPreloadRequest = Pick<
  FrenchAudioRequest,
  "courseId" | "wordId" | "text"
>;

export type AudioElementLike = {
  src: string;
  preload: string;
  currentTime: number;
  play: () => Promise<void>;
  pause: () => void;
  load: () => void;
  removeAttribute?: (name: string) => void;
  onplay: (() => void) | null;
  onpause: (() => void) | null;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  onwaiting: (() => void) | null;
};

export type SpeechVoiceLike = {
  lang: string;
  localService?: boolean;
};

export type SpeechUtteranceLike = {
  lang: string;
  rate: number;
  pitch: number;
  voice: SpeechVoiceLike | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onpause: (() => void) | null;
  onresume: (() => void) | null;
};

export type SpeechSynthesisLike = {
  cancel: () => void;
  speak: (utterance: SpeechUtteranceLike) => void;
  pause: () => void;
  resume: () => void;
  getVoices: () => SpeechVoiceLike[];
};

export type FrenchAudioEnvironment = {
  createAudio: (url: string) => AudioElementLike | null;
  getSpeechSynthesis: () => SpeechSynthesisLike | null;
  createUtterance: (text: string) => SpeechUtteranceLike | null;
  hasAsset: (wordId: string, text: string, courseId: CourseId) => boolean;
  assetUrl: (wordId: string, courseId: CourseId) => string;
};

const IDLE_SNAPSHOT: FrenchAudioSnapshot = {
  status: "idle",
  source: null,
  wordId: null,
  message: "French pronunciation is ready.",
  errorCode: null,
};

const MAX_CACHED_AUDIO = 12;
const MAX_PRELOAD_BATCH = 8;

export class FrenchAudioService {
  private readonly environment: FrenchAudioEnvironment;
  private readonly listeners = new Set<() => void>();
  private readonly audioCache = new Map<string, AudioElementLike>();
  private readonly failedAssets = new Set<string>();
  private snapshot: FrenchAudioSnapshot = IDLE_SNAPSHOT;
  private activeAudio: AudioElementLike | null = null;
  private activeUtterance: SpeechUtteranceLike | null = null;
  private activeRequest: FrenchAudioRequest | null = null;
  private operation = 0;
  private enabled = true;

  constructor(environment: Partial<FrenchAudioEnvironment> = {}) {
    this.environment = { ...browserAudioEnvironment, ...environment };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FrenchAudioSnapshot => this.snapshot;

  getServerSnapshot = (): FrenchAudioSnapshot => IDLE_SNAPSHOT;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.cancelActive();
      this.activeRequest = null;
      this.update({
        status: "disabled",
        source: null,
        wordId: null,
        message: "French audio is turned off in settings.",
        errorCode: null,
      });
    } else if (this.snapshot.status === "disabled") {
      this.update(IDLE_SNAPSHOT);
    }
  }

  preload(requests: readonly FrenchAudioPreloadRequest[]): void {
    if (!this.enabled) return;
    const uniqueRequests = [
      ...new Map(
        requests.map((request) => [
          `${request.courseId ?? DEFAULT_COURSE_ID}\u0000${request.wordId}\u0000${request.text}`,
          request,
        ]),
      ).values(),
    ].slice(0, MAX_PRELOAD_BATCH);

    for (const request of uniqueRequests) {
      const courseId: CourseId = request.courseId ?? DEFAULT_COURSE_ID;
      const assetKey = `${courseId}:${request.wordId}`;
      if (
        this.failedAssets.has(assetKey) ||
        !this.environment.hasAsset(request.wordId, request.text, courseId)
      ) {
        continue;
      }

      let url: string;
      try {
        url = this.environment.assetUrl(request.wordId, courseId);
      } catch {
        continue;
      }
      const audio = this.getOrCreateAudio(url);
      if (!audio || audio === this.activeAudio) continue;
      audio.preload = "auto";
      audio.onerror = () => this.failedAssets.add(assetKey);
      try {
        audio.load();
      } catch {
        this.failedAssets.add(assetKey);
      }
    }
  }

  async play(request: FrenchAudioRequest): Promise<void> {
    this.setEnabled(request.enabled);
    if (!request.enabled || !this.enabled) return;

    const text = request.text.trim().slice(0, 200);
    const courseId: CourseId = request.courseId ?? DEFAULT_COURSE_ID;
    const course = COURSE_CATALOG[courseId];
    const assetKey = `${courseId}:${request.wordId}`;
    if (!text) {
      this.cancelActive();
      this.activeRequest = null;
      this.update({
        status: "error",
        source: null,
        wordId: request.wordId,
        message: "This pronunciation has no speakable text.",
        errorCode: "invalid-request",
      });
      return;
    }

    if (
      this.snapshot.wordId === request.wordId &&
      (this.snapshot.courseId ?? DEFAULT_COURSE_ID) === courseId &&
      this.snapshot.status === "paused" &&
      this.activeRequest?.text === text
    ) {
      await this.resume();
      return;
    }

    this.cancelActive();
    const normalizedRequest: FrenchAudioRequest = {
      ...request,
      courseId,
      text,
    };
    this.activeRequest = normalizedRequest;

    if (
      this.environment.hasAsset(
        normalizedRequest.wordId,
        normalizedRequest.text,
        courseId,
      ) &&
      !this.failedAssets.has(assetKey)
    ) {
      let assetUrl: string;
      try {
        assetUrl = this.environment.assetUrl(
          normalizedRequest.wordId,
          courseId,
        );
      } catch {
        this.update({
          status: "error",
          source: null,
          wordId: normalizedRequest.wordId,
          message: "This pronunciation identifier is invalid.",
          errorCode: "invalid-request",
        });
        return;
      }
      const audio = this.getOrCreateAudio(assetUrl);
      if (audio) {
        await this.playAsset(audio, normalizedRequest, assetUrl);
        return;
      }
    }

    this.playSpeech(
      normalizedRequest,
      `Using the ${course.targetLanguageName} voice on this device.`,
    );
  }

  pause(): void {
    if (
      this.snapshot.status !== "playing" &&
      this.snapshot.status !== "loading"
    ) {
      return;
    }

    if (this.snapshot.source === "asset" && this.activeAudio) {
      this.activeAudio.pause();
    } else if (this.snapshot.source === "speech") {
      this.environment.getSpeechSynthesis()?.pause();
    }
    if (this.getSnapshot().status !== "paused") {
      this.update({
        ...this.snapshot,
        status: "paused",
        message: "French pronunciation paused.",
      });
    }
  }

  async resume(): Promise<void> {
    if (this.snapshot.status !== "paused") return;

    if (this.snapshot.source === "asset" && this.activeAudio) {
      this.update({
        ...this.snapshot,
        status: "loading",
        message: "Resuming French pronunciation.",
      });
      try {
        await this.activeAudio.play();
        if (this.getSnapshot().status === "loading") {
          this.update({
            ...this.snapshot,
            status: "playing",
            message: "Playing French pronunciation.",
          });
        }
      } catch {
        const wordId = this.snapshot.wordId;
        if (wordId && this.activeRequest) {
          this.failedAssets.add(
            `${this.activeRequest.courseId ?? DEFAULT_COURSE_ID}:${wordId}`,
          );
        }
        if (this.activeRequest) {
          this.playSpeech(
            this.activeRequest,
            "The saved recording could not resume. Using the French voice on this device.",
          );
        } else {
          this.cancelActive();
          this.update({
            status: "error",
            source: null,
            wordId,
            message: "French pronunciation could not be resumed.",
            errorCode: "speech-unavailable",
          });
        }
      }
      return;
    }

    if (this.snapshot.source === "speech") {
      const speech = this.environment.getSpeechSynthesis();
      if (!speech) {
        this.update({
          ...this.snapshot,
          status: "error",
          message: "French speech is unavailable in this browser.",
          errorCode: "speech-unavailable",
        });
        return;
      }
      speech.resume();
      this.update({
        ...this.snapshot,
        status: "playing",
        message: "Playing with the French voice on this device.",
      });
    }
  }

  stop(): void {
    this.cancelActive();
    this.activeRequest = null;
    this.update(IDLE_SNAPSHOT);
  }

  dispose(): void {
    this.cancelActive();
    for (const audio of this.audioCache.values()) this.releaseAudio(audio);
    this.audioCache.clear();
    this.failedAssets.clear();
    this.activeRequest = null;
    this.snapshot = IDLE_SNAPSHOT;
    this.listeners.clear();
  }

  private async playAsset(
    audio: AudioElementLike,
    request: FrenchAudioRequest,
    assetUrl: string,
  ): Promise<void> {
    const operation = ++this.operation;
    this.activeAudio = audio;
    audio.src = assetUrl;
    audio.preload = "auto";
    audio.onplay = () => {
      if (operation !== this.operation) return;
      this.update({
        status: "playing",
        source: "asset",
        wordId: request.wordId,
        message: "Playing French pronunciation.",
        errorCode: null,
      });
    };
    audio.onpause = () => {
      if (
        operation !== this.operation ||
        this.snapshot.status === "ended"
      ) {
        return;
      }
      this.update({
        status: "paused",
        source: "asset",
        wordId: request.wordId,
        message: "French pronunciation paused.",
        errorCode: null,
      });
    };
    audio.onwaiting = () => {
      if (operation !== this.operation) return;
      this.update({
        status: "loading",
        source: "asset",
        wordId: request.wordId,
        message: "Loading French pronunciation.",
        errorCode: null,
      });
    };
    audio.onended = () => {
      if (operation !== this.operation) return;
      this.detachAudioEvents(audio);
      this.activeAudio = null;
      this.update({
        status: "ended",
        source: "asset",
        wordId: request.wordId,
        message: "French pronunciation finished.",
        errorCode: null,
      });
    };
    audio.onerror = () => {
      if (operation !== this.operation) return;
      this.failedAssets.add(
        `${request.courseId ?? DEFAULT_COURSE_ID}:${request.wordId}`,
      );
      this.playSpeech(
        request,
        "The saved recording was unavailable. Using the French voice on this device.",
      );
    };

    this.update({
      status: "loading",
      source: "asset",
      wordId: request.wordId,
      message: "Loading French pronunciation.",
      errorCode: null,
    });

    try {
      await audio.play();
      if (operation === this.operation && this.snapshot.status === "loading") {
        this.update({
          status: "playing",
          source: "asset",
          wordId: request.wordId,
          message: "Playing French pronunciation.",
          errorCode: null,
        });
      }
    } catch {
      if (operation !== this.operation) return;
      this.failedAssets.add(
        `${request.courseId ?? DEFAULT_COURSE_ID}:${request.wordId}`,
      );
      this.playSpeech(
        request,
        "The saved recording was unavailable. Using the French voice on this device.",
      );
    }
  }

  private playSpeech(request: FrenchAudioRequest, message: string): void {
    this.cancelActive();
    this.activeRequest = request;
    const speech = this.environment.getSpeechSynthesis();
    const utterance = this.environment.createUtterance(
      request.text.trim().slice(0, 200),
    );
    if (!speech || !utterance) {
      this.update({
        status: "error",
        source: null,
        wordId: request.wordId,
        message: "French speech is unavailable in this browser.",
        errorCode: "speech-unavailable",
      });
      return;
    }

    const operation = ++this.operation;
    this.activeUtterance = utterance;
    const courseId: CourseId = request.courseId ?? DEFAULT_COURSE_ID;
    const course = COURSE_CATALOG[courseId];
    const speechLocale = course.audio.locale.toLowerCase();
    const speechLanguage = speechLocale.split("-")[0];
    utterance.lang = course.audio.locale;
    utterance.rate = 0.86;
    utterance.pitch = 1;
    try {
      const voices = speech.getVoices();
      utterance.voice =
        voices.find(
          (voice) =>
            voice.localService === true &&
            voice.lang.toLowerCase() === speechLocale,
        ) ??
        voices.find(
          (voice) =>
            voice.localService === true &&
            voice.lang.toLowerCase().startsWith(speechLanguage),
        ) ??
        voices.find((voice) => voice.lang.toLowerCase() === speechLocale) ??
        voices.find((voice) =>
          voice.lang.toLowerCase().startsWith(speechLanguage),
        ) ??
        null;
    } catch {
      utterance.voice = null;
    }
    utterance.onstart = () => {
      if (operation !== this.operation) return;
      this.update({
        status: "playing",
        source: "speech",
        wordId: request.wordId,
        message,
        errorCode: null,
      });
    };
    utterance.onpause = () => {
      if (operation !== this.operation) return;
      this.update({
        status: "paused",
        source: "speech",
        wordId: request.wordId,
        message: "French pronunciation paused.",
        errorCode: null,
      });
    };
    utterance.onresume = () => {
      if (operation !== this.operation) return;
      this.update({
        status: "playing",
        source: "speech",
        wordId: request.wordId,
        message,
        errorCode: null,
      });
    };
    utterance.onend = () => {
      if (operation !== this.operation) return;
      this.detachUtteranceEvents(utterance);
      this.activeUtterance = null;
      this.update({
        status: "ended",
        source: "speech",
        wordId: request.wordId,
        message: "French pronunciation finished.",
        errorCode: null,
      });
    };
    utterance.onerror = () => {
      if (operation !== this.operation) return;
      this.detachUtteranceEvents(utterance);
      this.activeUtterance = null;
      this.update({
        status: "error",
        source: "speech",
        wordId: request.wordId,
        message: "The French voice on this device could not speak this word.",
        errorCode: "speech-unavailable",
      });
    };

    this.update({
      status: "loading",
      source: "speech",
      wordId: request.wordId,
      message: "Starting the French voice on this device.",
      errorCode: null,
    });
    try {
      speech.cancel();
      speech.speak(utterance);
    } catch {
      if (operation !== this.operation) return;
      this.detachUtteranceEvents(utterance);
      this.activeUtterance = null;
      this.update({
        status: "error",
        source: "speech",
        wordId: request.wordId,
        message: "French speech is unavailable in this browser.",
        errorCode: "speech-unavailable",
      });
    }
  }

  private getOrCreateAudio(url: string): AudioElementLike | null {
    const existing = this.audioCache.get(url);
    if (existing) {
      this.audioCache.delete(url);
      this.audioCache.set(url, existing);
      return existing;
    }

    const audio = this.environment.createAudio(url);
    if (!audio) return null;
    audio.src = url;
    audio.preload = "metadata";
    this.audioCache.set(url, audio);
    this.evictAudioCache();
    return audio;
  }

  private evictAudioCache(): void {
    while (this.audioCache.size > MAX_CACHED_AUDIO) {
      const oldest = this.audioCache.entries().next().value as
        | [string, AudioElementLike]
        | undefined;
      if (!oldest) return;
      const [url, audio] = oldest;
      if (audio === this.activeAudio) {
        this.audioCache.delete(url);
        this.audioCache.set(url, audio);
        continue;
      }
      this.audioCache.delete(url);
      this.releaseAudio(audio);
    }
  }

  private cancelActive(): void {
    this.operation += 1;
    if (this.activeAudio) {
      const audio = this.activeAudio;
      this.detachAudioEvents(audio);
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // Some streaming implementations do not expose a seekable timeline.
      }
      this.activeAudio = null;
    }

    if (this.activeUtterance) {
      this.detachUtteranceEvents(this.activeUtterance);
      this.activeUtterance = null;
    }
    try {
      this.environment.getSpeechSynthesis()?.cancel();
    } catch {
      // Cancellation is best-effort during browser teardown.
    }
  }

  private releaseAudio(audio: AudioElementLike): void {
    this.detachAudioEvents(audio);
    audio.pause();
    try {
      audio.removeAttribute?.("src");
      audio.load();
    } catch {
      // Ignore teardown errors from detached media elements.
    }
  }

  private detachAudioEvents(audio: AudioElementLike): void {
    audio.onplay = null;
    audio.onpause = null;
    audio.onended = null;
    audio.onerror = null;
    audio.onwaiting = null;
  }

  private detachUtteranceEvents(utterance: SpeechUtteranceLike): void {
    utterance.onstart = null;
    utterance.onend = null;
    utterance.onerror = null;
    utterance.onpause = null;
    utterance.onresume = null;
  }

  private update(snapshot: FrenchAudioSnapshot): void {
    const courseId =
      snapshot.courseId ??
      this.activeRequest?.courseId ??
      DEFAULT_COURSE_ID;
    this.snapshot =
      snapshot.wordId !== null && courseId !== DEFAULT_COURSE_ID
        ? { ...snapshot, courseId }
        : snapshot;
    for (const listener of this.listeners) listener();
  }
}

const browserAudioEnvironment: FrenchAudioEnvironment = {
  createAudio: (url) => {
    if (typeof Audio === "undefined") return null;
    return new Audio(url) as unknown as AudioElementLike;
  },
  getSpeechSynthesis: () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return null;
    }
    return window.speechSynthesis as unknown as SpeechSynthesisLike;
  },
  createUtterance: (text) => {
    if (typeof SpeechSynthesisUtterance === "undefined") return null;
    return new SpeechSynthesisUtterance(
      text,
    ) as unknown as SpeechUtteranceLike;
  },
  hasAsset: (wordId, text, courseId) =>
    hasCourseAudioAsset(courseId, wordId, text),
  assetUrl: (wordId, courseId) => courseAudioAssetUrl(courseId, wordId),
};

let sharedFrenchAudioService: FrenchAudioService | null = null;

export function getFrenchAudioService(): FrenchAudioService {
  sharedFrenchAudioService ??= new FrenchAudioService();
  return sharedFrenchAudioService;
}
