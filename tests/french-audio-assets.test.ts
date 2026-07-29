import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import manifest from "../public/audio/fr/manifest.json";
import { WORDS } from "../app/learning-data";
import { isAllowedFrenchAudioWordId } from "../scripts/verify-french-audio-assets.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));

describe("packaged French audio release", () => {
  it("allows safe CMS IDs without weakening compiled-corpus coverage", () => {
    const compiledIds = new Set(WORDS.map((word) => word.id));

    expect(isAllowedFrenchAudioWordId(WORDS[0].id, compiledIds)).toBe(true);
    expect(
      isAllowedFrenchAudioWordId("cms-bonjour-equipe", compiledIds),
    ).toBe(true);
    expect(isAllowedFrenchAudioWordId("bonjour-equipe", compiledIds)).toBe(
      false,
    );
    expect(isAllowedFrenchAudioWordId("cms-Bonjour", compiledIds)).toBe(false);
    expect(isAllowedFrenchAudioWordId("cms-../bonjour", compiledIds)).toBe(
      false,
    );
  });

  it("contains the checked, attributed WAV declared for every word", () => {
    expect(manifest.generation).toMatchObject({
      status: "ready",
      synthetic: true,
      distributionCleared: true,
      generator: "Kokoro ONNX",
      voice: "ff_siwis",
      voiceGender: "female",
      quality: "high",
      speakers: 1,
      license: {
        name: expect.stringContaining("Apache License 2.0"),
        url: "https://www.apache.org/licenses/LICENSE-2.0",
      },
    });
    expect(manifest.assetVersion).toBe("v2");
    expect(manifest.sampleRateHz).toBe(24_000);
    const compiledWords = new Map(WORDS.map((word) => [word.id, word] as const));
    const availableIds = new Set(manifest.availableWordIds);
    expect(availableIds.size).toBe(manifest.availableWordIds.length);
    for (const word of WORDS) expect(availableIds.has(word.id)).toBe(true);

    for (const wordId of manifest.availableWordIds) {
      const asset = manifest.assets[wordId as keyof typeof manifest.assets];
      expect(asset, `manifest entry for ${wordId}`).toBeDefined();
      const compiledWord = compiledWords.get(wordId);
      if (compiledWord) {
        expect(asset.text).toBe(compiledWord.french);
      } else {
        expect(wordId).toMatch(/^cms-[a-z0-9]+(?:-[a-z0-9]+)*$/);
        expect(asset.text.normalize("NFC").trim()).not.toBe("");
      }
      expect(asset.durationSeconds).toBeGreaterThanOrEqual(0.25);
      expect(asset.durationSeconds).toBeLessThanOrEqual(6);
      const path = `${PROJECT_ROOT}public${asset.path}`;
      const contents = readFileSync(path);
      expect(contents.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(contents.subarray(8, 12).toString("ascii")).toBe("WAVE");
      expect(statSync(path).size).toBe(asset.bytes);
      expect(createHash("sha256").update(contents).digest("hex")).toBe(
        asset.sha256,
      );
    }
  });
});
