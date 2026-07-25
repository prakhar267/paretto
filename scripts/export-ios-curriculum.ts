import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CURRICULUM_PLAN, REGIONS, WORDS } from "../app/learning-data";
import { DEFAULT_COURSE } from "../app/course-catalog";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const audioManifest = JSON.parse(
  await readFile(resolve(root, "public/audio/fr/manifest.json"), "utf8"),
) as {
  assetVersion: string;
  assets: Record<string, { path: string }>;
  attribution: { path: string };
};

const output = resolve(
  root,
  "ios/ParettoCore/Sources/ParettoCore/Resources/curriculum.json",
);

const curriculum = {
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
    CURRICULUM_PLAN[region.id].map((lesson) => ({
      regionId: region.id,
      ...lesson,
    })),
  ),
  words: WORDS.map((word) => ({
    ...word,
    audioPath: audioManifest.assets[word.id]?.path ?? null,
  })),
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(curriculum, null, 2)}\n`);
console.log(
  `Exported ${curriculum.regions.length} regions, ${curriculum.lessons.length} lessons, and ${curriculum.words.length} words to ${output}`,
);
