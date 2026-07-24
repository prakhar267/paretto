#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
const environment = options.environment;

invariant(
  environment === "staging" || environment === "production",
  "Use --environment staging or --environment production.",
);
invariant(
  typeof options["account-id"] === "string" &&
    /^[0-9a-f]{32}$/i.test(options["account-id"]) &&
    !/^([0-9a-f])\1{31}$/i.test(options["account-id"]),
  "Use --account-id with the 32-character Cloudflare account ID.",
);
invariant(
  typeof options["database-id"] === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      options["database-id"],
    ) &&
    !isPlaceholderDatabaseId(options["database-id"]),
  "Use --database-id with the provisioned D1 database UUID, not a placeholder.",
);
invariant(
  typeof options["database-name"] === "string" &&
    /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/i.test(
      options["database-name"],
    ),
  "Use --database-name with a 1-64 character D1 name containing letters, numbers, hyphens, or underscores.",
);
invariant(
  typeof options["admin-email"] === "string" &&
    normalizeEmail(options["admin-email"]) !== null,
  "Use --admin-email with the single production administrator email.",
);
invariant(
  typeof options["turnstile-site-key"] === "string" &&
    options["turnstile-site-key"].length >= 20 &&
    options["turnstile-site-key"].length <= 256 &&
    !/\s/.test(options["turnstile-site-key"]),
  "Use --turnstile-site-key with the provisioned Cloudflare Turnstile site key.",
);

const templatePath = resolve(
  root,
  `wrangler.${environment}.jsonc.example`,
);
const outputPath = resolve(root, `wrangler.${environment}.jsonc`);
let source = await readFile(templatePath, "utf8");

source = replaceExactlyOnce(
  source,
  "__CLOUDFLARE_ACCOUNT_ID__",
  options["account-id"],
);
source = replaceExactlyOnce(
  source,
  "__D1_DATABASE_NAME__",
  options["database-name"],
);
source = replaceExactlyOnce(
  source,
  "__D1_DATABASE_ID__",
  options["database-id"],
);
source = replaceExactlyOnce(
  source,
  "__ADMIN_EMAIL__",
  normalizeEmail(options["admin-email"]),
);
source = replaceExactlyOnce(
  source,
  "__TURNSTILE_SITE_KEY__",
  options["turnstile-site-key"],
);

JSON.parse(source);
await writeFile(outputPath, source, { encoding: "utf8", mode: 0o600 });

console.log(
  `Prepared ignored ${environment} Wrangler configuration for ` +
    `${options["database-name"]}. Run the matching cloudflare:verify:${environment} ` +
    "gate before any migration or deployment.",
);

function parseArguments(argumentsList) {
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    invariant(argument.startsWith("--"), `Unexpected argument: ${argument}.`);
    const equals = argument.indexOf("=");
    if (equals > 2) {
      values[argument.slice(2, equals)] = argument.slice(equals + 1);
      continue;
    }
    const key = argument.slice(2);
    const value = argumentsList[index + 1];
    invariant(value && !value.startsWith("--"), `Missing value for --${key}.`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function replaceExactlyOnce(sourceText, token, value) {
  const occurrences = sourceText.split(token).length - 1;
  invariant(occurrences === 1, `Expected one ${token} token; found ${occurrences}.`);
  return sourceText.replace(token, value);
}

function isPlaceholderDatabaseId(value) {
  const compact = value.replaceAll("-", "").toLowerCase();
  return /^([0-9a-f])\1{31}$/.test(compact);
}

function normalizeEmail(value) {
  const email = value.trim().toLowerCase();
  return email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
