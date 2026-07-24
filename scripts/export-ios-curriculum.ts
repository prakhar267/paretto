import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CURRICULUM_PLAN, REGIONS, WORDS } from "../app/learning-data";

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
