#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
const environment = options.environment;
const launchMode = options["launch-mode"];
const workersPlan = options["workers-plan"];
const COMMON_REQUIRED_SECRETS = [
  "USER_KEY_SECRET",
  "SUPPORT_RATE_LIMIT_SECRET",
  "BETTER_AUTH_RATE_LIMIT_SECRET",
  "BETTER_AUTH_SECRET",
  "PARETTO_PASSWORD_PEPPERS",
  "ADMIN_SESSION_SECRET",
  "TURNSTILE_SECRET",
];
const TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
]);

invariant(
  environment === "staging" || environment === "production",
  "Use --environment staging or --environment production.",
);
invariant(
  launchMode === "controlled-beta" || launchMode === "public",
  "Use --launch-mode controlled-beta or --launch-mode public.",
);
invariant(
  workersPlan === "free" || workersPlan === "paid",
  "Use --workers-plan free or --workers-plan paid.",
);
invariant(
  launchMode !== "public" || workersPlan === "paid",
  "Public Paretto ID launch requires --workers-plan paid; Workers Free is supported only for controlled-beta evaluation.",
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
const adminEmails = normalizeAdminEmails(
  options["admin-emails"] ?? options["admin-email"],
);
invariant(
  adminEmails !== null,
  "Use --admin-emails with 1–25 unique administrator emails separated by commas (legacy --admin-email remains supported for one administrator).",
);
invariant(
  !options["admin-emails"] || !options["admin-email"],
  "Use either --admin-emails or --admin-email, not both.",
);
const adminPasswordSecretName =
  adminEmails.length === 1
    ? "ADMIN_PASSWORD_VERIFIER"
    : "ADMIN_PASSWORD_VERIFIERS";
const requiredSecrets = [
  ...COMMON_REQUIRED_SECRETS.slice(0, 5),
  adminPasswordSecretName,
  ...COMMON_REQUIRED_SECRETS.slice(5),
];
invariant(
  typeof options["turnstile-site-key"] === "string" &&
    options["turnstile-site-key"].length >= 20 &&
    options["turnstile-site-key"].length <= 256 &&
    !/\s/.test(options["turnstile-site-key"]) &&
    !TURNSTILE_TEST_SITE_KEYS.has(options["turnstile-site-key"]),
  "Use --turnstile-site-key with the provisioned Cloudflare Turnstile site key.",
);
invariant(
  validHttpsOrigin(options["auth-url"]),
  "Use --auth-url with the exact HTTPS origin for this Worker.",
);
const emailDeliveryDisabled =
  options["auth-email-from"] === undefined &&
  options["support-notification-email"] === undefined;
const emailDeliveryConfigured =
  validSender(options["auth-email-from"]) &&
  normalizeEmail(options["support-notification-email"]) !== null;
invariant(
  emailDeliveryDisabled || emailDeliveryConfigured,
  "Optional email delivery must either omit both --auth-email-from and --support-notification-email, or provide a valid verified sender and working support mailbox together.",
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
  "__ADMIN_EMAILS__",
  adminEmails.join(","),
);
source = replaceExactlyOnce(
  source,
  "__ADMIN_PASSWORD_SECRET_NAME__",
  adminPasswordSecretName,
);
source = replaceExactlyOnce(
  source,
  "__TURNSTILE_SITE_KEY__",
  options["turnstile-site-key"],
);
source = replaceExactlyOnce(
  source,
  "__BETTER_AUTH_URL__",
  new URL(options["auth-url"]).origin,
);
source = replaceExactlyOnce(source, "__LAUNCH_MODE__", launchMode);
source = replaceExactlyOnce(source, "__WORKERS_PLAN__", workersPlan);
source = replaceExactlyOnce(
  source,
  "__AUTH_EMAIL_FROM__",
  emailDeliveryConfigured ? options["auth-email-from"].trim() : "",
);
source = replaceExactlyOnce(
  source,
  "__SUPPORT_NOTIFICATION_EMAIL__",
  emailDeliveryConfigured
    ? normalizeEmail(options["support-notification-email"])
    : "",
);

const configuration = JSON.parse(source);
invariant(
  Array.isArray(configuration.secrets?.required) &&
    configuration.secrets.required.length === requiredSecrets.length &&
    configuration.secrets.required.every(
      (name, index) => name === requiredSecrets[index],
    ),
  `Template secrets must be exactly ${requiredSecrets.join(", ")}.`,
);
await writeFile(outputPath, source, { encoding: "utf8", mode: 0o600 });

console.log(
  `Prepared ignored ${environment} Wrangler configuration for ` +
    `${options["database-name"]} with ${adminEmails.length} administrator` +
    `${adminEmails.length === 1 ? "" : "s"} and optional email delivery ` +
    `${emailDeliveryConfigured ? "enabled" : "disabled"}. Run the matching cloudflare:verify:${environment} ` +
    `gate before any ${launchMode} migration or deployment.`,
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
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : null;
}

function normalizeAdminEmails(value) {
  if (typeof value !== "string") return null;
  const rawEntries = value.split(",");
  if (rawEntries.length < 1 || rawEntries.length > 25) return null;
  const emails = rawEntries.map((entry) => normalizeEmail(entry));
  if (emails.some((email) => email === null)) return null;
  const normalized = emails;
  return new Set(normalized).size === normalized.length
    ? normalized
    : null;
}

function validHttpsOrigin(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      url.pathname === "/" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function validSender(value) {
  return (
    typeof value === "string" &&
    value.length <= 320 &&
    /<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(value.trim())
  );
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
