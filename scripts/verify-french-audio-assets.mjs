#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = process.cwd();
const manifestPath = path.join(
  projectRoot,
  "public/audio/fr/manifest.json",
);
const learningDataPath = path.join(projectRoot, "app/learning-data.ts");
export const CMS_AUDIO_WORD_ID_PATTERN =
  /^cms-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isAllowedFrenchAudioWordId(wordId, corpusIds) {
  return corpusIds.has(wordId) || CMS_AUDIO_WORD_ID_PATTERN.test(wordId);
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function extractWordIds(source) {
  const foundationStart = source.indexOf("const FOUNDATION_WORDS = [");
  const foundationEnd = source.indexOf(
    "] as const satisfies readonly FoundationWord[];",
    foundationStart,
  );
  const expansionStart = source.indexOf("const CURRICULUM_EXPANSION = [");
  const expansionEnd = source.indexOf(
    "] as const satisfies readonly CurriculumEntry[];",
    expansionStart,
  );
  invariant(
    foundationStart >= 0 && foundationEnd > foundationStart,
    "Foundation word corpus not found",
  );
  invariant(
    expansionStart >= 0 && expansionEnd > expansionStart,
    "Expansion word corpus not found",
  );
  const foundationSource = source.slice(foundationStart, foundationEnd);
  const expansionSource = source.slice(expansionStart, expansionEnd);
  const foundationIds = [
    ...foundationSource.matchAll(/\n\s+id: "([a-z0-9-]+)",/g),
  ].map((match) => match[1]);
  const expansionIds = [
    ...expansionSource.matchAll(/\n\s*\["([a-z0-9-]+)",/g),
  ].map((match) => match[1]);
  return [...foundationIds, ...expansionIds];
}

async function sha256(filePath) {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

export function inspectWav(bytes, assetPath, expectedSampleRateHz = 24_000) {
  invariant(bytes.length >= 44, `${assetPath} is too small to be a WAVE file`);
  invariant(
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WAVE",
    `${assetPath} is not a RIFF/WAVE file`,
  );
  invariant(
    bytes.readUInt32LE(4) + 8 === bytes.length,
    `${assetPath} has an invalid RIFF byte count`,
  );
  let offset = 12;
  let format = null;
  let dataBytes = null;
  let dataOffset = null;
  while (offset + 8 <= bytes.length) {
    const chunkName = bytes.subarray(offset, offset + 4).toString("ascii");
    const chunkBytes = bytes.readUInt32LE(offset + 4);
    const contentOffset = offset + 8;
    invariant(
      contentOffset + chunkBytes <= bytes.length,
      `${assetPath} contains a truncated WAVE chunk`,
    );
    if (chunkName === "fmt ") {
      invariant(chunkBytes >= 16, `${assetPath} has an invalid fmt chunk`);
      format = {
        encoding: bytes.readUInt16LE(contentOffset),
        channels: bytes.readUInt16LE(contentOffset + 2),
        sampleRateHz: bytes.readUInt32LE(contentOffset + 4),
        bitsPerSample: bytes.readUInt16LE(contentOffset + 14),
      };
    } else if (chunkName === "data") {
      dataBytes = chunkBytes;
      dataOffset = contentOffset;
    }
    offset = contentOffset + chunkBytes + (chunkBytes % 2);
  }
  invariant(format, `${assetPath} has no WAVE format chunk`);
  invariant(dataBytes !== null, `${assetPath} has no WAVE data chunk`);
  invariant(dataOffset !== null, `${assetPath} has no WAVE sample data`);
  invariant(format.encoding === 1, `${assetPath} must use PCM encoding`);
  invariant(format.channels === 1, `${assetPath} must be mono`);
  invariant(
    format.sampleRateHz === expectedSampleRateHz,
    `${assetPath} must use a ${expectedSampleRateHz.toLocaleString("en-US")} Hz sample rate`,
  );
  invariant(
    format.bitsPerSample === 16,
    `${assetPath} must use signed 16-bit samples`,
  );
  invariant(dataBytes > 0 && dataBytes % 2 === 0, `${assetPath} has invalid PCM data`);

  const sampleCount = dataBytes / 2;
  let peakSample = 0;
  let squaredSampleTotal = 0;
  let signedSampleTotal = 0;
  let clippedSamples = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const sample = bytes.readInt16LE(dataOffset + sampleIndex * 2);
    const absoluteSample = Math.abs(sample);
    peakSample = Math.max(peakSample, absoluteSample);
    squaredSampleTotal += sample * sample;
    signedSampleTotal += sample;
    if (sample === 32_767 || sample === -32_768) clippedSamples += 1;
  }

  return {
    durationSeconds:
      dataBytes / (format.sampleRateHz * format.channels * 2),
    peakAmplitude: peakSample / 32_768,
    rmsAmplitude: Math.sqrt(squaredSampleTotal / sampleCount) / 32_768,
    dcOffset: signedSampleTotal / sampleCount / 32_768,
    clippedSamples,
  };
}

async function verifyAsset(assetPath, expected, expectedSampleRateHz) {
  const details = await stat(assetPath);
  invariant(details.isFile(), `${assetPath} is not a regular file`);
  invariant(details.size >= 1_024, `${assetPath} is unexpectedly small`);
  const contents = await readFile(assetPath);
  const signal = inspectWav(contents, assetPath, expectedSampleRateHz);
  invariant(
    signal.durationSeconds >= 0.25 && signal.durationSeconds <= 6,
    `${assetPath} has an implausible duration`,
  );
  invariant(
    Math.abs(signal.durationSeconds - expected.durationSeconds) <= 0.002,
    `${assetPath} duration does not match the manifest`,
  );
  invariant(
    signal.clippedSamples === 0,
    `${assetPath} contains ${signal.clippedSamples} clipped PCM samples`,
  );
  invariant(
    signal.peakAmplitude >= 0.02 && signal.peakAmplitude <= 0.98,
    `${assetPath} peak amplitude is outside the production range`,
  );
  invariant(
    signal.rmsAmplitude >= 0.01 && signal.rmsAmplitude <= 0.4,
    `${assetPath} RMS amplitude is outside the production range`,
  );
  invariant(
    Math.abs(signal.dcOffset) <= 0.02,
    `${assetPath} has excessive DC offset`,
  );
  invariant(
    expected.bytes === details.size,
    `${assetPath} byte count does not match the manifest`,
  );
  invariant(
    expected.sha256 === (await sha256(assetPath)),
    `${assetPath} checksum does not match the manifest`,
  );
  return signal;
}

async function main() {
  const [manifestSource, learningDataSource] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(learningDataPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const wordIds = extractWordIds(learningDataSource);
  const corpusIds = new Set(wordIds);

  invariant(wordIds.length > 0, "The French word corpus is empty");
  invariant(
    corpusIds.size === wordIds.length,
    "The French word corpus contains duplicate IDs",
  );
  invariant(manifest.schemaVersion === 1, "Unsupported audio manifest schema");
  invariant(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.assetVersion),
    "Audio assetVersion must be a safe version identifier",
  );
  invariant(manifest.locale === "fr-FR", "Audio locale must be fr-FR");
  invariant(
    manifest.mediaType === "audio/wav" && manifest.fileExtension === "wav",
    "Only validated WAV release assets are accepted",
  );
  invariant(manifest.sampleRateHz === 24_000, "Sample rate must be 24,000 Hz");
  invariant(manifest.channels === 1, "Release assets must be mono");
  invariant(
    Array.isArray(manifest.availableWordIds),
    "availableWordIds must be an array",
  );
  invariant(
    new Set(manifest.availableWordIds).size === manifest.availableWordIds.length,
    "availableWordIds contains duplicates",
  );
  const verifiedSignals = [];
  const cmsWordIds = [];
  for (const wordId of manifest.availableWordIds) {
    invariant(
      isAllowedFrenchAudioWordId(wordId, corpusIds),
      `Unknown audio word ID: ${wordId}`,
    );
    if (!corpusIds.has(wordId)) cmsWordIds.push(wordId);
  }

  const releaseDirectory = path.join(
    projectRoot,
    "public/audio/fr",
    manifest.assetVersion,
  );
  const existingFiles = await readdir(releaseDirectory).catch(() => []);
  const existingWavFiles = existingFiles.filter((name) => name.endsWith(".wav"));

  if (manifest.generation?.status === "blocked-missing-credential") {
    invariant(
      manifest.availableWordIds.length === 0,
      "A blocked release cannot advertise available assets",
    );
    invariant(
      existingWavFiles.length === 0,
      "Unlicensed WAV files exist while audio generation is blocked",
    );
    invariant(
      Object.keys(manifest.assets ?? {}).length === 0,
      "A blocked release cannot contain asset metadata",
    );
    console.log(
      `French audio manifest valid: ${wordIds.length} words use device fr-FR SpeechSynthesis.`,
    );
    console.log(`Static generation blocked: ${manifest.generation.blocker}`);
    return;
  }

  invariant(
    manifest.generation?.status === "ready",
    "Generation status must be ready or blocked-missing-credential",
  );
  invariant(manifest.generation.synthetic === true, "Audio must be disclosed as synthetic");
  invariant(
    manifest.generation.distributionCleared === true,
    "Voice redistribution must be explicitly cleared",
  );
  invariant(
    typeof manifest.generation.generator === "string" &&
      manifest.generation.generator.length > 0,
    "Synthetic generator attribution is required",
  );
  invariant(
    typeof manifest.generation.voice === "string" &&
      manifest.generation.voice.length > 0,
    "Voice/model attribution is required",
  );
  invariant(
    manifest.generation.generator === "Kokoro ONNX" &&
      manifest.generation.voice === "ff_siwis" &&
      manifest.generation.voiceGender === "female" &&
      manifest.generation.quality === "high" &&
      manifest.generation.speakers === 1,
    "The release must use the approved single-speaker French female neural voice",
  );
  invariant(
    /^[a-f0-9]{64}$/.test(manifest.generation.modelSha256) &&
      /^[a-f0-9]{64}$/.test(manifest.generation.configSha256),
    "Model and config SHA-256 hashes are required",
  );
  invariant(
    typeof manifest.generation.license?.name === "string" &&
      typeof manifest.generation.license?.url === "string",
    "A voice/model license name and URL are required",
  );

  const assetEntries = Object.entries(manifest.assets ?? {});
  invariant(
    wordIds.every((wordId) => manifest.availableWordIds.includes(wordId)),
    "A ready release must cover the complete French corpus",
  );
  invariant(
    assetEntries.length === manifest.availableWordIds.length,
    "Asset metadata must exist for every available word ID",
  );
  for (const wordId of manifest.availableWordIds) {
    const expected = manifest.assets[wordId];
    invariant(expected, `Missing asset metadata for ${wordId}`);
    invariant(
      expected.path === `/audio/fr/${manifest.assetVersion}/${wordId}.wav`,
      `Non-deterministic asset path for ${wordId}`,
    );
    invariant(
      Number.isInteger(expected.bytes) && expected.bytes > 0,
      `Invalid asset size for ${wordId}`,
    );
    invariant(
      /^[a-f0-9]{64}$/.test(expected.sha256),
      `Invalid asset checksum for ${wordId}`,
    );
    invariant(
      typeof expected.text === "string" &&
        expected.text.normalize("NFC").trim().length > 0,
      `Missing audio transcript for ${wordId}`,
    );
    if (CMS_AUDIO_WORD_ID_PATTERN.test(wordId)) {
      const provenance = expected.provenance;
      invariant(
        provenance &&
          Number.isInteger(provenance.contentRevision) &&
          provenance.contentRevision >= 1,
        `Missing CMS content revision provenance for ${wordId}`,
      );
      invariant(
        validTimestamp(provenance.pronunciationReviewedAt),
        `Missing human pronunciation review provenance for ${wordId}`,
      );
      invariant(
        (provenance.sourceType === "synthetic" ||
          provenance.sourceType === "human") &&
          typeof provenance.generator === "string" &&
          provenance.generator.trim().length >= 2 &&
          typeof provenance.voice === "string" &&
          provenance.voice.trim().length >= 2 &&
          typeof provenance.license?.name === "string" &&
          provenance.license.name.trim().length >= 2 &&
          validPublicHttpsUrl(provenance.license?.url) &&
          validTimestamp(provenance.distributionClearedAt) &&
          typeof provenance.intakeSha256 === "string" &&
          /^[a-f0-9]{64}$/.test(provenance.intakeSha256),
        `Missing distribution-rights provenance for ${wordId}`,
      );
    }
    verifiedSignals.push(
      await verifyAsset(
        path.join(releaseDirectory, `${wordId}.wav`),
        expected,
        manifest.sampleRateHz,
      ),
    );
  }
  invariant(
    existingWavFiles.length === manifest.availableWordIds.length,
    "Release directory contains untracked WAV files",
  );

  console.log(
    `French audio release valid: ${manifest.availableWordIds.length} licensed synthetic clips cover ${wordIds.length} compiled words plus ${cmsWordIds.length} CMS words; ${verifiedSignals.reduce((sum, signal) => sum + signal.clippedSamples, 0)} clipped samples.`,
  );
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validPublicHttpsUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`French audio verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
