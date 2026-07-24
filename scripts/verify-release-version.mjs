#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const [packageSource, lockSource, healthSource, xcodegenSource, projectSource] =
  await Promise.all([
    readFile(resolve(root, "package.json"), "utf8"),
    readFile(resolve(root, "package-lock.json"), "utf8"),
    readFile(resolve(root, "app/api/health/route.ts"), "utf8"),
    readFile(resolve(root, "ios/Paretto/project.yml"), "utf8"),
    readFile(
      resolve(root, "ios/Paretto/Paretto.xcodeproj/project.pbxproj"),
      "utf8",
    ),
  ]);

const packageManifest = JSON.parse(packageSource);
const lockfile = JSON.parse(lockSource);
const version = packageManifest.version;
invariant(
  typeof version === "string" &&
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version),
  "package.json must contain a release SemVer without a prerelease suffix.",
);
invariant(lockfile.version === version, "Top-level package-lock version is stale.");
invariant(
  lockfile.packages?.[""]?.version === version,
  "Root package-lock package version is stale.",
);

const healthVersion = healthSource.match(
  /const SERVICE_VERSION = "([^"]+)";/,
)?.[1];
invariant(
  healthVersion === version,
  `Health service version ${healthVersion ?? "missing"} does not match ${version}.`,
);

const xcodegenVersion = xcodegenSource.match(
  /^\s*MARKETING_VERSION:\s*([^\s#]+)\s*$/m,
)?.[1];
const xcodegenBuild = xcodegenSource.match(
  /^\s*CURRENT_PROJECT_VERSION:\s*([^\s#]+)\s*$/m,
)?.[1];
invariant(
  xcodegenVersion === version,
  `XcodeGen marketing version ${xcodegenVersion ?? "missing"} does not match ${version}.`,
);
invariant(
  typeof xcodegenBuild === "string" && /^[1-9]\d*$/.test(xcodegenBuild),
  "XcodeGen build number must be a positive integer.",
);

const projectVersions = uniqueMatches(
  projectSource,
  /\bMARKETING_VERSION = ([^;]+);/g,
);
const projectBuilds = uniqueMatches(
  projectSource,
  /\bCURRENT_PROJECT_VERSION = ([^;]+);/g,
);
invariant(
  projectVersions.length === 1 && projectVersions[0] === version,
  `Generated Xcode marketing versions do not match ${version}: ${projectVersions.join(", ")}.`,
);
invariant(
  projectBuilds.length === 1 && projectBuilds[0] === xcodegenBuild,
  `Generated Xcode build numbers do not match ${xcodegenBuild}: ${projectBuilds.join(", ")}.`,
);
if (process.env.GITHUB_REF_TYPE === "tag") {
  invariant(
    process.env.GITHUB_REF_NAME === `v${version}`,
    `Git tag ${process.env.GITHUB_REF_NAME ?? "missing"} must equal v${version}.`,
  );
}

console.log(
  `Release identity verified: version ${version}, planned tag v${version}, native build ${xcodegenBuild}.`,
);

function uniqueMatches(source, pattern) {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1].trim()))];
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
