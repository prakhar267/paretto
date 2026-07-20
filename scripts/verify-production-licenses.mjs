#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const lockfilePath = new URL("../package-lock.json", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

const [lockfileText, packageText] = await Promise.all([
  readFile(lockfilePath, "utf8"),
  readFile(packagePath, "utf8"),
]);
const lockfile = JSON.parse(lockfileText);
const packageManifest = JSON.parse(packageText);

invariant(lockfile.lockfileVersion === 3, "package-lock.json must use lockfileVersion 3.");
invariant(lockfile.packages && typeof lockfile.packages === "object", "Lockfile package metadata is missing.");

const root = lockfile.packages[""];
invariant(root?.name === packageManifest.name, "Lockfile package name does not match package.json.");
invariant(root?.version === packageManifest.version, "Lockfile package version does not match package.json.");

for (const [name, range] of Object.entries(packageManifest.dependencies ?? {})) {
  invariant(root.dependencies?.[name] === range, `Production dependency ${name} is out of sync in the lockfile.`);
  invariant(lockfile.packages[`node_modules/${name}`], `Production dependency ${name} is not locked.`);
}

const productionPackages = Object.entries(lockfile.packages)
  .filter(([path, metadata]) => path.startsWith("node_modules/") && metadata.dev !== true)
  .map(([path, metadata]) => ({
    name: path.slice("node_modules/".length),
    version: metadata.version,
    license: typeof metadata.license === "string" ? metadata.license.trim() : "",
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

invariant(productionPackages.length > 0, "No production packages were found in the lockfile.");

const invalidLicenses = productionPackages.filter(
  ({ license }) =>
    !license ||
    /^(?:unknown|unlicensed)$/i.test(license) ||
    /^see license in\b/i.test(license),
);
invariant(
  invalidLicenses.length === 0,
  `Production packages require license review: ${invalidLicenses.map(({ name }) => name).join(", ")}.`,
);

const licenses = [...new Set(productionPackages.map(({ license }) => license))].sort();
const lockfileSha256 = createHash("sha256").update(lockfileText).digest("hex");

console.log(
  `Production license metadata verified for ${productionPackages.length} locked packages ` +
    `(${licenses.join(", ")}); package-lock SHA-256 ${lockfileSha256}.`,
);
console.log(
  "This metadata gate does not replace preservation of required notices or jurisdiction-specific legal review.",
);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
