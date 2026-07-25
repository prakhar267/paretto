#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const runtime = resolve(root, "test-results", "playwright-runtime");
const relativeRuntime = relative(root, runtime);

if (
  relativeRuntime !== `test-results${sep}playwright-runtime` ||
  relativeRuntime.startsWith("..")
) {
  throw new Error("Refusing to clean an unexpected Playwright runtime path.");
}

// This directory contains only disposable local D1 state produced by the
// Playwright webServer. Starting clean makes account deletion repeatable when
// all three release browsers run against one server.
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
console.log("Prepared a fresh local-only Playwright runtime.");
