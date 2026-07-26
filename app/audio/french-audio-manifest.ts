import publicManifest from "virtual:pas-a-pas-french-audio-manifest";
import {
  COURSE_CATALOG,
  DEFAULT_COURSE_ID,
  type CourseId,
} from "../course-catalog";

type FrenchAudioManifest = {
  schemaVersion: number;
  assetVersion: string;
  locale: "fr-FR";
  mediaType: "audio/wav" | "audio/mpeg";
  fileExtension: "wav" | "mp3";
  sampleRateHz?: number;
  generation: {
    status: "blocked-missing-credential" | "ready";
    synthetic: true;
    blocker?: string;
    distributionCleared?: boolean;
    generator?: string;
    voice?: string;
  };
  availableWordIds: readonly string[];
  assets: Readonly<
    Record<
      string,
      | {
          path: string;
          bytes: number;
          sha256: string;
          durationSeconds: number;
          text: string;
        }
      | undefined
    >
  >;
};

/**
 * The public manifest is the release source of truth. When a packaged asset is
 * missing or fails, the runtime automatically uses the device's fr-FR speech
 * synthesizer.
 */
export const FRENCH_AUDIO_MANIFEST =
  publicManifest as unknown as FrenchAudioManifest;

export const FRENCH_AUDIO_ASSET_VERSION =
  FRENCH_AUDIO_MANIFEST.assetVersion;

const SAFE_WORD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function frenchAudioAssetUrl(wordId: string): string {
  if (!SAFE_WORD_ID.test(wordId)) {
    throw new Error(`Invalid French audio word id: ${wordId}`);
  }
  return courseAudioAssetUrl(DEFAULT_COURSE_ID, wordId);
}

export function courseAudioAssetUrl(
  courseId: CourseId,
  wordId: string,
): string {
  if (!SAFE_WORD_ID.test(wordId)) {
    throw new Error(`Invalid course audio word id: ${wordId}`);
  }
  if (
    courseId !== DEFAULT_COURSE_ID ||
    FRENCH_AUDIO_MANIFEST.locale !== COURSE_CATALOG[courseId].audio.locale
  ) {
    throw new Error(`Packaged audio is unavailable for course: ${courseId}`);
  }

  return `${COURSE_CATALOG[courseId].audio.assetPrefix}/${FRENCH_AUDIO_ASSET_VERSION}/${wordId}.${FRENCH_AUDIO_MANIFEST.fileExtension}`;
}

export function hasFrenchAudioAsset(wordId: string, text: string): boolean {
  return hasCourseAudioAsset(DEFAULT_COURSE_ID, wordId, text);
}

export function hasCourseAudioAsset(
  courseId: CourseId,
  wordId: string,
  text: string,
): boolean {
  if (
    courseId !== DEFAULT_COURSE_ID ||
    FRENCH_AUDIO_MANIFEST.locale !== COURSE_CATALOG[courseId].audio.locale
  ) {
    return false;
  }
  const asset = FRENCH_AUDIO_MANIFEST.assets[wordId];
  return (
    FRENCH_AUDIO_MANIFEST.availableWordIds.includes(wordId) &&
    Boolean(asset) &&
    normalizeAudioText(asset?.text ?? "") === normalizeAudioText(text)
  );
}

export function isFrenchAudioDistributionReady(): boolean {
  return isCourseAudioDistributionReady(DEFAULT_COURSE_ID);
}

export function isCourseAudioDistributionReady(courseId: CourseId): boolean {
  return (
    courseId === DEFAULT_COURSE_ID &&
    FRENCH_AUDIO_MANIFEST.locale === COURSE_CATALOG[courseId].audio.locale &&
    FRENCH_AUDIO_MANIFEST.generation.status === "ready" &&
    FRENCH_AUDIO_MANIFEST.generation.distributionCleared === true
  );
}

function normalizeAudioText(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}
