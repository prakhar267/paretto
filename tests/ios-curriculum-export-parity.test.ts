import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import audioManifest from "../public/audio/fr/manifest.json";
import { DEFAULT_COURSE } from "../app/course-catalog";
import {
  CURRICULUM_PLAN,
  REGIONS,
  WORDS,
  type RegionId,
} from "../app/learning-data";

type NativeCurriculumExport = {
  schemaVersion: number;
  revision: string;
  course: {
    id: string;
    sourceLanguageName: string;
    targetLanguageName: string;
    sourceLocale: string;
    targetLocale: string;
    initialContextId: string;
    audioLocale: string;
    audioAssetPrefix: string;
    taxonomy: typeof DEFAULT_COURSE.taxonomy;
  };
  audioAssetVersion: string;
  audioAttributionPath: string;
  regions: unknown[];
  lessons: unknown[];
  words: unknown[];
};

const nativeCurriculumPath = fileURLToPath(
  new URL(
    "../ios/ParettoCore/Sources/ParettoCore/Resources/curriculum.json",
    import.meta.url,
  ),
);

describe("iOS curriculum export parity", () => {
  it("matches the complete web curriculum, metadata, and audio mapping exactly", () => {
    const nativeCurriculum = JSON.parse(
      readFileSync(nativeCurriculumPath, "utf8"),
    ) as NativeCurriculumExport;
    const expected = {
      schemaVersion: 1,
      revision: "compiled-v1",
      course: {
        id: DEFAULT_COURSE.id,
        sourceLanguageName: DEFAULT_COURSE.sourceLanguageName,
        targetLanguageName: DEFAULT_COURSE.targetLanguageName,
        sourceLocale: DEFAULT_COURSE.sourceLocale,
        targetLocale: DEFAULT_COURSE.targetLocale,
        initialContextId: DEFAULT_COURSE.initialContextId,
        audioLocale: DEFAULT_COURSE.audio.locale,
        audioAssetPrefix: DEFAULT_COURSE.audio.assetPrefix,
        taxonomy: DEFAULT_COURSE.taxonomy,
      },
      audioAssetVersion: audioManifest.assetVersion,
      audioAttributionPath: audioManifest.attribution.path,
      regions: REGIONS.map((region) => ({ ...region })),
      lessons: REGIONS.flatMap((region) =>
        CURRICULUM_PLAN[region.id as RegionId].map((lesson) => ({
          regionId: region.id,
          ...lesson,
        })),
      ),
      words: WORDS.map((word) => ({
        ...word,
        audioPath:
          audioManifest.assets[
            word.id as keyof typeof audioManifest.assets
          ]?.path ?? null,
      })),
    };

    expect(nativeCurriculum).toEqual(expected);
  });
});
