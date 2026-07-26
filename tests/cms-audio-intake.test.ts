import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  promote,
  stage,
  validateCmsAudioRequest,
  validateProductionWav,
} from "../scripts/cms-audio-intake.mjs";

const VALID_REQUEST = {
  schemaVersion: 1,
  wordId: "cms-bonjour-equipe",
  text: "Bonjour l’équipe",
  contentRevision: 4,
  contentAuthor: "author@example.com",
  pronunciationReviewedBy: "reviewer@example.com",
  pronunciationReviewedAt: "2026-07-25T01:00:00.000Z",
  distributionClearedBy: "rights@example.com",
  distributionClearedAt: "2026-07-25T02:00:00.000Z",
  sourceType: "synthetic",
  generator: "Approved local synthesizer",
  voice: "French voice v1",
  licenseName: "Approved commercial voice licence",
  licenseUrl: "https://example.com/audio-license",
  distributionRightsReference: "license-record://audio/french/v1",
  reviewNotes: "Pronunciation and pacing approved against the transcript.",
};

describe("CMS audio intake", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires immutable CMS identity, independent review and rights evidence", () => {
    expect(validateCmsAudioRequest(VALID_REQUEST)).toMatchObject({
      wordId: "cms-bonjour-equipe",
      contentRevision: 4,
      pronunciationReviewedBy: "reviewer@example.com",
    });

    expect(() =>
      validateCmsAudioRequest({
        ...VALID_REQUEST,
        wordId: "bonjour-equipe",
      }),
    ).toThrow(/cms-\*/);
    expect(() =>
      validateCmsAudioRequest({
        ...VALID_REQUEST,
        pronunciationReviewedBy: VALID_REQUEST.contentAuthor,
      }),
    ).toThrow(/cannot approve their own/i);
    expect(() =>
      validateCmsAudioRequest({
        ...VALID_REQUEST,
        distributionRightsReference: "",
      }),
    ).toThrow(/distributionRightsReference/);
  });

  it("accepts a packaged release WAV only after signal inspection", async () => {
    const manifest = JSON.parse(
      await readFile(
        path.resolve("public/audio/fr/manifest.json"),
        "utf8",
      ),
    );
    const wordId = manifest.availableWordIds[0];
    const bytes = await readFile(
      path.resolve(
        "public/audio/fr",
        manifest.assetVersion,
        `${wordId}.wav`,
      ),
    );
    expect(validateProductionWav(bytes, wordId)).toMatchObject({
      clippedSamples: 0,
    });
  });

  it("stages and promotes an audited asset without publishing CMS content", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "paretto-cms-audio-"),
    );
    try {
      const manifestSource = await readFile(
        path.resolve("public/audio/fr/manifest.json"),
        "utf8",
      );
      const manifest = JSON.parse(manifestSource);
      const sourceWordId = manifest.availableWordIds[0];
      const request = {
        ...VALID_REQUEST,
        wordId: "cms-audio-pipeline-test",
        text: manifest.assets[sourceWordId].text,
      };
      const requestPath = path.join(temporaryRoot, "request.json");
      const sourceWav = path.resolve(
        "public/audio/fr",
        manifest.assetVersion,
        `${sourceWordId}.wav`,
      );
      const intakeRoot = path.join(temporaryRoot, "intake");
      await writeFile(requestPath, JSON.stringify(request));

      await stage({
        requestPath,
        wavPath: sourceWav,
        outputRoot: intakeRoot,
      });

      const receiptPath = path.join(
        intakeRoot,
        request.wordId,
        "receipt.json",
      );
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      expect(receipt).toMatchObject({
        wordId: request.wordId,
        contentRevision: request.contentRevision,
        wav: { clippedSamples: 0 },
      });

      const temporaryManifestPath = path.join(
        temporaryRoot,
        "public",
        "audio",
        "fr",
        "manifest.json",
      );
      await mkdir(
        path.join(path.dirname(temporaryManifestPath), manifest.assetVersion),
        { recursive: true },
      );
      await writeFile(temporaryManifestPath, manifestSource);
      await promote({
        receiptPath,
        manifestPath: temporaryManifestPath,
      });

      const promotedManifest = JSON.parse(
        await readFile(temporaryManifestPath, "utf8"),
      );
      expect(promotedManifest.availableWordIds).toContain(request.wordId);
      expect(promotedManifest.assets[request.wordId]).toMatchObject({
        text: request.text,
        provenance: {
          contentRevision: request.contentRevision,
          pronunciationReviewedAt: request.pronunciationReviewedAt,
          license: {
            name: request.licenseName,
            url: request.licenseUrl,
          },
        },
      });
      expect(
        promotedManifest.assets[request.wordId].provenance,
      ).not.toHaveProperty("contentAuthor");
      expect(
        promotedManifest.assets[request.wordId].provenance,
      ).not.toHaveProperty("pronunciationReviewedBy");
      expect(
        await readFile(
          path.join(
            path.dirname(temporaryManifestPath),
            manifest.assetVersion,
            `${request.wordId}.wav`,
          ),
        ),
      ).toHaveLength(receipt.wav.bytes);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
