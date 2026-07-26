#!/usr/bin/env node

import { lstat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const environment = parseEnvironment(process.argv.slice(2));
const target = resolve(root, `.env.${environment}`);
const metadata = await lstat(target);

invariant(metadata.isFile(), `${target} must be a regular file.`);
invariant(!metadata.isSymbolicLink(), `${target} must not be a symbolic link.`);
if (process.platform !== "win32") {
  invariant(
    (metadata.mode & 0o077) === 0,
    `${target} must have private file permissions.`,
  );
}
invariant(
  target === resolve(root, `.env.${environment}`),
  "Refusing to remove an unexpected path.",
);

await unlink(target);
console.log(`Removed .env.${environment}.`);

function parseEnvironment(argumentsList) {
  invariant(
    argumentsList.length === 2 && argumentsList[0] === "--environment",
    "Use --environment staging or --environment production.",
  );
  invariant(
    argumentsList[1] === "staging" || argumentsList[1] === "production",
    "Use --environment staging or --environment production.",
  );
  return argumentsList[1];
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
