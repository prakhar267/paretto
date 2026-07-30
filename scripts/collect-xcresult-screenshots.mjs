#!/usr/bin/env node

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const [sourceDirectory, destinationDirectory, family] = process.argv.slice(2);
if (!sourceDirectory || !destinationDirectory || !family) {
  throw new Error(
    "Usage: collect-xcresult-screenshots.mjs <exported-attachments> <destination> <iphone-6.9|ipad-13>",
  );
}

const acceptedDimensions = {
  "iphone-6.9": new Set(["1320x2868", "1290x2796", "1260x2736"]),
  "ipad-13": new Set(["2064x2752", "2048x2732"]),
};
const accepted = acceptedDimensions[family];
if (!accepted) throw new Error(`Unsupported screenshot family: ${family}`);

const manifest = JSON.parse(
  await readFile(resolve(sourceDirectory, "manifest.json"), "utf8"),
);
const attachments = manifest.flatMap((entry) => entry.attachments ?? []);
const screenshots = new Map();

for (const attachment of attachments) {
  const suggested = basename(attachment.suggestedHumanReadableName ?? "");
  const match = suggested.match(/^(0[1-4]-[a-z-]+)_/);
  if (!match) continue;
  if (screenshots.has(match[1])) {
    throw new Error(`Duplicate App Store screenshot attachment: ${match[1]}`);
  }
  screenshots.set(match[1], attachment.exportedFileName);
}

const required = [
  "01-onboarding",
  "02-today",
  "03-journey",
  "04-lesson",
];
await mkdir(destinationDirectory, { recursive: true });
for (const name of required) {
  const exported = screenshots.get(name);
  if (!exported) throw new Error(`Missing App Store screenshot: ${name}`);
  const source = await readFile(resolve(sourceDirectory, exported));
  verifyPNG(source, accepted, `${family}/${name}.png`);
  await copyFile(
    resolve(sourceDirectory, exported),
    resolve(destinationDirectory, `${name}.png`),
  );
}

console.log(
  `Collected ${required.length} validated ${family} App Store screenshots.`,
);

function verifyPNG(source, dimensions, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (source.length < 33 || !source.subarray(0, 8).equals(signature)) {
    throw new Error(`${label} is not a valid PNG.`);
  }
  const size = `${source.readUInt32BE(16)}x${source.readUInt32BE(20)}`;
  if (!dimensions.has(size)) {
    throw new Error(
      `${label} has unsupported App Store dimensions ${size}; expected ${[...dimensions].join(" or ")}.`,
    );
  }
}
