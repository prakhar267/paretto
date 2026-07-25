#!/usr/bin/env node

import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  CMS_AUDIO_WORD_ID_PATTERN,
  inspectWav,
} from "./verify-french-audio-assets.mjs";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCmsAudioRequest(value) {
  invariant(isRecord(value), "The audio request must be a JSON object.");
  invariant(value.schemaVersion === 1, "Unsupported audio request schema.");
  invariant(
    typeof value.wordId === "string" &&
      CMS_AUDIO_WORD_ID_PATTERN.test(value.wordId),
    "wordId must be an immutable cms-* vocabulary ID.",
  );
  invariant(
    typeof value.text === "string" &&
      value.text.normalize("NFC").trim().length >= 1 &&
      value.text.length <= 120,
    "text must contain the exact published French transcript.",
  );
  invariant(
    Number.isInteger(value.contentRevision) && value.contentRevision >= 1,
    "contentRevision must be a positive integer.",
  );
  for (const field of [
    "contentAuthor",
    "pronunciationReviewedBy",
    "distributionClearedBy",
  ]) {
    invariant(
      typeof value[field] === "string" && EMAIL_PATTERN.test(value[field]),
      `${field} must be an accountable email address.`,
    );
  }
  invariant(
    value.contentAuthor.toLowerCase() !==
      value.pronunciationReviewedBy.toLowerCase(),
    "The content author cannot approve their own pronunciation audio.",
  );
  for (const field of ["pronunciationReviewedAt", "distributionClearedAt"]) {
    invariant(
      typeof value[field] === "string" &&
        Number.isFinite(Date.parse(value[field])),
      `${field} must be an ISO timestamp.`,
    );
  }
  invariant(
    value.sourceType === "synthetic" || value.sourceType === "human",
    "sourceType must be synthetic or human.",
  );
  invariant(
    boundedString(value.generator, 2, 120),
    "generator is required.",
  );
  invariant(boundedString(value.voice, 2, 120), "voice is required.");
  invariant(
    boundedString(value.licenseName, 2, 160),
    "licenseName is required.",
  );
  invariant(
    typeof value.licenseUrl === "string" &&
      isPublicHttpsUrl(value.licenseUrl),
    "licenseUrl must be a public HTTPS URL.",
  );
  invariant(
    boundedString(value.distributionRightsReference, 8, 500),
    "distributionRightsReference is required.",
  );
  invariant(
    boundedString(value.reviewNotes, 2, 1_000),
    "reviewNotes are required.",
  );

  return {
    schemaVersion: 1,
    wordId: value.wordId,
    text: value.text.normalize("NFC").trim().replace(/\s+/g, " "),
    contentRevision: value.contentRevision,
    contentAuthor: value.contentAuthor.toLowerCase(),
    pronunciationReviewedBy: value.pronunciationReviewedBy.toLowerCase(),
    pronunciationReviewedAt: new Date(value.pronunciationReviewedAt).toISOString(),
    distributionClearedBy: value.distributionClearedBy.toLowerCase(),
    distributionClearedAt: new Date(value.distributionClearedAt).toISOString(),
    sourceType: value.sourceType,
    generator: value.generator.trim(),
    voice: value.voice.trim(),
    licenseName: value.licenseName.trim(),
    licenseUrl: value.licenseUrl.trim(),
    distributionRightsReference: value.distributionRightsReference.trim(),
    reviewNotes: value.reviewNotes.trim(),
  };
}

export function validateProductionWav(bytes, label = "audio") {
  const signal = inspectWav(bytes, label);
  invariant(
    signal.durationSeconds >= 0.25 && signal.durationSeconds <= 6,
    `${label} must be between 0.25 and 6 seconds.`,
  );
  invariant(signal.clippedSamples === 0, `${label} contains clipped samples.`);
  invariant(
    signal.peakAmplitude >= 0.02 && signal.peakAmplitude <= 0.98,
    `${label} peak amplitude is outside the production range.`,
  );
  invariant(
    signal.rmsAmplitude >= 0.01 && signal.rmsAmplitude <= 0.4,
    `${label} RMS amplitude is outside the production range.`,
  );
  invariant(
    Math.abs(signal.dcOffset) <= 0.02,
    `${label} has excessive DC offset.`,
  );
  return signal;
}

export async function stage({ requestPath, wavPath, outputRoot }) {
  invariant(requestPath && wavPath, "stage requires --request and --wav.");
  const request = validateCmsAudioRequest(
    JSON.parse(await readFile(path.resolve(requestPath), "utf8")),
  );
  const wavSource = path.resolve(wavPath);
  const wavBytes = await readFile(wavSource);
  const signal = validateProductionWav(wavBytes, wavSource);
  const details = await stat(wavSource);
  const digest = sha256(wavBytes);
  const intakeRoot = path.resolve(outputRoot ?? "work/cms-audio-intake");
  const finalDirectory = path.join(intakeRoot, request.wordId);
  const temporaryDirectory = `${finalDirectory}.staging-${process.pid}`;
  const receipt = {
    ...request,
    intakeId: randomUUID(),
    stagedAt: new Date().toISOString(),
    wav: {
      fileName: `${request.wordId}.wav`,
      bytes: details.size,
      sha256: digest,
      durationSeconds: rounded(signal.durationSeconds),
      peakAmplitude: rounded(signal.peakAmplitude),
      rmsAmplitude: rounded(signal.rmsAmplitude),
      dcOffset: rounded(signal.dcOffset),
      clippedSamples: signal.clippedSamples,
    },
  };

  await mkdir(intakeRoot, { recursive: true });
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    await copyFile(
      wavSource,
      path.join(temporaryDirectory, receipt.wav.fileName),
      constants.COPYFILE_EXCL,
    );
    await writeFile(
      path.join(temporaryDirectory, "receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: "wx" },
    );
    await rename(temporaryDirectory, finalDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  console.log(
    `Staged ${request.wordId}. No CMS record or production asset was published.`,
  );
  console.log(path.join(finalDirectory, "receipt.json"));
}

export async function promote({ receiptPath, manifestPath }) {
  invariant(receiptPath, "promote requires --receipt.");
  const absoluteReceipt = path.resolve(receiptPath);
  const receipt = validateStagedReceipt(
    JSON.parse(await readFile(absoluteReceipt, "utf8")),
  );
  const wavSource = path.join(path.dirname(absoluteReceipt), receipt.wav.fileName);
  const wavBytes = await readFile(wavSource);
  const signal = validateProductionWav(wavBytes, wavSource);
  invariant(
    sha256(wavBytes) === receipt.wav.sha256,
    "The staged WAV checksum no longer matches its receipt.",
  );
  invariant(
    wavBytes.length === receipt.wav.bytes,
    "The staged WAV byte count no longer matches its receipt.",
  );
  invariant(
    Math.abs(signal.durationSeconds - receipt.wav.durationSeconds) <= 0.002,
    "The staged WAV duration no longer matches its receipt.",
  );

  const absoluteManifest = path.resolve(
    manifestPath ?? "public/audio/fr/manifest.json",
  );
  const originalManifestSource = await readFile(absoluteManifest, "utf8");
  const manifest = JSON.parse(originalManifestSource);
  invariant(
    manifest.generation?.status === "ready" &&
      manifest.generation?.distributionCleared === true,
    "The destination audio release is not distribution-ready.",
  );
  invariant(
    !manifest.availableWordIds.includes(receipt.wordId) &&
      !manifest.assets?.[receipt.wordId],
    `${receipt.wordId} already exists in the production manifest.`,
  );

  const destination = path.resolve(
    path.dirname(absoluteManifest),
    manifest.assetVersion,
    `${receipt.wordId}.wav`,
  );
  const temporaryManifest = `${absoluteManifest}.staging-${process.pid}`;
  await copyFile(wavSource, destination, constants.COPYFILE_EXCL);
  try {
    manifest.availableWordIds.push(receipt.wordId);
    manifest.assets[receipt.wordId] = {
      path: `/audio/fr/${manifest.assetVersion}/${receipt.wordId}.wav`,
      bytes: receipt.wav.bytes,
      sha256: receipt.wav.sha256,
      durationSeconds: receipt.wav.durationSeconds,
      text: receipt.text,
      provenance: {
        contentRevision: receipt.contentRevision,
        pronunciationReviewedAt: receipt.pronunciationReviewedAt,
        sourceType: receipt.sourceType,
        generator: receipt.generator,
        voice: receipt.voice,
        license: {
          name: receipt.licenseName,
          url: receipt.licenseUrl,
        },
        distributionClearedAt: receipt.distributionClearedAt,
        intakeSha256: sha256(
          Buffer.from(JSON.stringify(receipt), "utf8"),
        ),
      },
    };
    await writeFile(
      temporaryManifest,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx" },
    );
    await rename(temporaryManifest, absoluteManifest);
  } catch (error) {
    await Promise.all([
      rm(destination, { force: true }),
      rm(temporaryManifest, { force: true }),
    ]);
    throw error;
  }

  console.log(
    `Promoted ${receipt.wordId} into the release assets. Run npm run audio:verify before review or publication.`,
  );
}

function validateStagedReceipt(value) {
  const request = validateCmsAudioRequest(value);
  invariant(
    typeof value.intakeId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.intakeId,
      ),
    "The staged receipt has no valid intake ID.",
  );
  invariant(
    typeof value.stagedAt === "string" &&
      Number.isFinite(Date.parse(value.stagedAt)),
    "The staged receipt has no valid timestamp.",
  );
  invariant(isRecord(value.wav), "The staged receipt has no WAV evidence.");
  invariant(
    value.wav.fileName === `${request.wordId}.wav`,
    "The staged WAV filename does not match the immutable word ID.",
  );
  invariant(
    Number.isInteger(value.wav.bytes) && value.wav.bytes >= 1_024,
    "The staged WAV byte count is invalid.",
  );
  invariant(
    typeof value.wav.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(value.wav.sha256),
    "The staged WAV checksum is invalid.",
  );
  return {
    ...request,
    intakeId: value.intakeId,
    stagedAt: new Date(value.stagedAt).toISOString(),
    wav: value.wav,
  };
}

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const values = { command };
  for (let index = 0; index < tokens.length; index += 2) {
    const flag = tokens[index];
    const value = tokens[index + 1];
    invariant(flag?.startsWith("--") && value, `Invalid argument: ${flag ?? ""}`);
    values[flag.slice(2)] = value;
  }
  return {
    command,
    requestPath: values.request,
    wavPath: values.wav,
    outputRoot: values.out,
    receiptPath: values.receipt,
    manifestPath: values.manifest,
  };
}

function boundedString(value, minimum, maximum) {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.trim().length <= maximum
  );
}

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.command === "stage") await stage(arguments_);
  else if (arguments_.command === "promote") await promote(arguments_);
  else {
    throw new Error(
      "Usage: cms-audio-intake.mjs stage --request request.json --wav clip.wav [--out directory] | promote --receipt receipt.json [--manifest manifest.json]",
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`CMS audio intake failed: ${error.message}`);
    process.exitCode = 1;
  });
}
