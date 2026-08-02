#!/usr/bin/env node

import { createHash } from "node:crypto";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const root = process.cwd();
const environment = parseEnvironment(process.argv.slice(2));
const account = "prakhargupta267@gmail.com";
const keychain = {
  staging: {
    adminAccess: ["Paretto Staging Admin Access Key", account],
    adminVerifiers: [
      "Paretto Staging Admin Password Verifiers",
      account,
    ],
    userKey: ["Paretto Staging User Key Secret", account],
    supportRateLimit: [
      "Paretto Staging Support Rate Limit Secret",
      account,
    ],
    authRateLimit: [
      "Paretto Staging Better Auth Rate Limit Secret",
      account,
    ],
    auth: ["Paretto Staging Better Auth Secret", account],
    passwordPeppers: [
      "Paretto Staging Password Pepper Keyring",
      account,
    ],
    adminSession: ["Paretto Staging Admin Session Secret", account],
    turnstile: ["Paretto Staging Turnstile Secret", "prakhar"],
    appleClientId: ["Paretto Staging Apple Client ID", account],
    appleTeamId: ["Paretto Staging Apple Team ID", account],
    appleKeyId: ["Paretto Staging Apple Key ID", account],
    applePrivateKeyBase64: [
      "Paretto Staging Apple Private Key Base64",
      account,
    ],
    appleTokenEncryption: [
      "Paretto Staging Apple Token Encryption Secret",
      account,
    ],
    nativeSession: ["Paretto Staging Native Session Secret", account],
  },
  production: {
    adminAccess: ["Paretto Production Admin Access Key", account],
    adminVerifiers: [
      "Paretto Production Admin Password Verifiers",
      account,
    ],
    userKey: ["Paretto Production User Key Secret", account],
    supportRateLimit: [
      "Paretto Production Support Rate Limit Secret",
      account,
    ],
    authRateLimit: [
      "Paretto Production Better Auth Rate Limit Secret",
      account,
    ],
    auth: ["Paretto Production Better Auth Secret", account],
    passwordPeppers: [
      "Paretto Production Password Pepper Keyring",
      account,
    ],
    adminSession: ["Paretto Production Admin Session Secret", account],
    turnstile: ["Paretto Production Turnstile Secret", account],
    appleClientId: ["Paretto Production Apple Client ID", account],
    appleTeamId: ["Paretto Production Apple Team ID", account],
    appleKeyId: ["Paretto Production Apple Key ID", account],
    applePrivateKeyBase64: [
      "Paretto Production Apple Private Key Base64",
      account,
    ],
    appleTokenEncryption: [
      "Paretto Production Apple Token Encryption Secret",
      account,
    ],
    nativeSession: ["Paretto Production Native Session Secret", account],
  },
};

invariant(
  process.platform === "darwin",
  "Secret materialization requires the macOS Keychain.",
);
const packageText = await readFile(resolve(root, "package.json"), "utf8");
invariant(
  JSON.parse(packageText).name === "paretto",
  "Run this command from the Paretto repository root.",
);

const labels = keychain[environment];
const configuration = JSON.parse(
  await readFile(resolve(root, `wrangler.${environment}.jsonc`), "utf8"),
);
const adminEmails = parseAdminEmails(configuration.vars?.ADMIN_EMAILS);
invariant(
  adminEmails !== null,
  `Prepare wrangler.${environment}.jsonc with 1–25 unique administrator emails first.`,
);
const [
  userKey,
  supportRateLimit,
  authRateLimit,
  authSecret,
  passwordPeppers,
  adminSession,
  turnstile,
  appleClientId,
  appleTeamId,
  appleKeyId,
  applePrivateKeyBase64,
  appleTokenEncryption,
  nativeSession,
] =
  await Promise.all([
    readKeychainSecret(...labels.userKey, 32),
    readKeychainSecret(...labels.supportRateLimit, 32),
    readKeychainSecret(...labels.authRateLimit, 32),
    readKeychainSecret(...labels.auth, 32),
    readKeychainSecret(...labels.passwordPeppers, 32, 256),
    readKeychainSecret(...labels.adminSession, 32),
    readKeychainSecret(...labels.turnstile),
    readKeychainSecret(...labels.appleClientId, 3, 255),
    readKeychainSecret(...labels.appleTeamId, 10, 10),
    readKeychainSecret(...labels.appleKeyId, 10, 10),
    readKeychainSecret(...labels.applePrivateKeyBase64, 100, 16_000),
    readKeychainSecret(...labels.appleTokenEncryption, 32),
    readKeychainSecret(...labels.nativeSession, 32),
  ]);
invariant(
  new Set([
    userKey,
    supportRateLimit,
    authRateLimit,
    authSecret,
    adminSession,
    appleTokenEncryption,
    nativeSession,
  ]).size === 7,
  "User, rate-limit, learner-auth, admin-session, Apple-token, and native-session secrets must be independent.",
);
invariant(
  /^[A-Za-z0-9.-]{3,255}$/.test(appleClientId) &&
    /^[A-Z0-9]{10}$/.test(appleTeamId) &&
    /^[A-Z0-9]{10}$/.test(appleKeyId),
  "Apple client, team, or key identifiers have an invalid format.",
);
let applePrivateKey;
try {
  applePrivateKey = Buffer.from(applePrivateKeyBase64, "base64").toString(
    "utf8",
  );
} catch {
  applePrivateKey = "";
}
invariant(
  /^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PRIVATE KEY-----\n?$/.test(
    applePrivateKey,
  ),
  "The Apple private-key Keychain item is not a base64-encoded PKCS#8 key.",
);
const [adminPasswordSecretName, adminPasswordSecret] =
  adminEmails.length === 1
    ? [
        "ADMIN_PASSWORD_VERIFIER",
        `sha256$${createHash("sha256")
          .update(await readKeychainSecret(...labels.adminAccess))
          .digest("base64url")}`,
      ]
    : [
        "ADMIN_PASSWORD_VERIFIERS",
        await readAdminVerifierMap(labels.adminVerifiers, adminEmails),
      ];
const contents = [
  `USER_KEY_SECRET=${userKey}`,
  `SUPPORT_RATE_LIMIT_SECRET=${supportRateLimit}`,
  `BETTER_AUTH_RATE_LIMIT_SECRET=${authRateLimit}`,
  `BETTER_AUTH_SECRET=${authSecret}`,
  `PARETTO_PASSWORD_PEPPERS=${passwordPeppers}`,
  `${adminPasswordSecretName}=${adminPasswordSecret}`,
  `ADMIN_SESSION_SECRET=${adminSession}`,
  `TURNSTILE_SECRET=${turnstile}`,
  `APPLE_CLIENT_ID=${appleClientId}`,
  `APPLE_TEAM_ID=${appleTeamId}`,
  `APPLE_KEY_ID=${appleKeyId}`,
  `APPLE_PRIVATE_KEY_BASE64=${applePrivateKeyBase64}`,
  `APPLE_TOKEN_ENCRYPTION_SECRET=${appleTokenEncryption}`,
  `NATIVE_SESSION_SECRET=${nativeSession}`,
  "",
].join("\n");
const target = resolve(root, `.env.${environment}`);

let handle;
let created = false;
try {
  handle = await open(target, "wx", 0o600);
  created = true;
  await handle.writeFile(contents, { encoding: "utf8" });
  await handle.sync();
  await handle.close();
  handle = undefined;
  const metadata = await stat(target);
  invariant(metadata.isFile(), `${target} is not a regular file.`);
  if (process.platform !== "win32") {
    invariant((metadata.mode & 0o077) === 0, `${target} must have mode 0600.`);
  }
} catch (error) {
  if (handle) await handle.close().catch(() => undefined);
  if (created) await unlink(target).catch(() => undefined);
  throw error;
}

console.log(
  `Created private .env.${environment} from the approved Keychain items. ` +
    `${adminEmails.length} administrator credential${adminEmails.length === 1 ? "" : "s"} included. ` +
    "Verify, deploy, then remove it with the matching cleanup command.",
);

async function readKeychainSecret(
  service,
  keychainAccount,
  minimumLength = 20,
  maximumLength = 256,
) {
  const { stdout } = await runFile(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-a",
      keychainAccount,
      "-s",
      service,
      "-w",
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 },
  );
  const value = stdout.replace(/\r?\n$/, "");
  invariant(
    value.length >= minimumLength &&
      value.length <= maximumLength &&
      !/[\r\n\0]/.test(value),
    `Keychain item ${service} has an invalid secret format.`,
  );
  return value;
}

async function readAdminVerifierMap(label, adminEmails) {
  const value = await readKeychainSecret(...label, 2, 7_000);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label[0]} must contain a valid compact JSON object.`);
  }
  invariant(
    parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.getPrototypeOf(parsed) === Object.prototype,
    `${label[0]} must contain a JSON object.`,
  );
  const entries = Object.entries(parsed);
  invariant(
    entries.length === adminEmails.length &&
      entries.every(
        ([email, verifier], index) =>
          email === adminEmails[index] &&
          /^sha256\$[A-Za-z0-9_-]{43}$/.test(verifier),
      ),
    `${label[0]} must map every configured administrator, in ADMIN_EMAILS order, to one SHA-256 verifier.`,
  );
  invariant(
    new Set(entries.map(([, verifier]) => verifier)).size === entries.length,
    "Every administrator needs a distinct access-key verifier.",
  );
  const canonical = JSON.stringify(parsed);
  invariant(
    canonical === value,
    `${label[0]} must use compact canonical JSON.`,
  );
  return canonical;
}

function parseAdminEmails(value) {
  if (typeof value !== "string") return null;
  const entries = value.split(",");
  if (entries.length < 1 || entries.length > 25) return null;
  const normalized = entries.map((entry) => entry.trim().toLowerCase());
  if (
    normalized.some(
      (email) =>
        email.length < 3 ||
        email.length > 254 ||
        !/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(email),
    ) ||
    new Set(normalized).size !== normalized.length ||
    normalized.join(",") !== value
  ) {
    return null;
  }
  return normalized;
}

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
