#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const COMMON_REQUIRED_SECRETS = [
  "USER_KEY_SECRET",
  "SUPPORT_RATE_LIMIT_SECRET",
  "BETTER_AUTH_RATE_LIMIT_SECRET",
  "BETTER_AUTH_SECRET",
  "PARETTO_PASSWORD_PEPPERS",
  "ADMIN_SESSION_SECRET",
  "TURNSTILE_SECRET",
];
const NATIVE_REQUIRED_SECRETS = [
  "APPLE_CLIENT_ID",
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_PRIVATE_KEY_BASE64",
  "APPLE_TOKEN_ENCRYPTION_SECRET",
  "NATIVE_SESSION_SECRET",
];
const TURNSTILE_TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);
const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
const environment = options.environment;

invariant(
  environment === "staging" || environment === "production",
  "Use --environment staging or --environment production.",
);

const configurationPath = resolve(root, `wrangler.${environment}.jsonc`);
const configurationMetadata = await lstat(configurationPath);
invariant(
  configurationMetadata.isFile() && !configurationMetadata.isSymbolicLink(),
  `${configurationPath} must be a regular, non-symbolic-link file.`,
);
const configuration = JSON.parse(
  await readFile(configurationPath, "utf8"),
);
const launchMode = configuration.vars?.LAUNCH_MODE;
const workersPlan = configuration.vars?.WORKERS_PLAN;
invariant(
  launchMode === "controlled-beta" || launchMode === "public",
  `${configurationPath} must select LAUNCH_MODE controlled-beta or public.`,
);
invariant(
  (workersPlan === "free" || workersPlan === "paid") &&
    (launchMode !== "public" || workersPlan === "paid"),
  `${configurationPath} must select WORKERS_PLAN free or paid, and public launch requires paid.`,
);
const adminEmails = parseAdminEmails(configuration.vars?.ADMIN_EMAILS);
invariant(
  adminEmails !== null,
  `${configurationPath} must contain 1–25 normalized, unique ADMIN_EMAILS.`,
);
const adminPasswordSecretName =
  adminEmails.length === 1
    ? "ADMIN_PASSWORD_VERIFIER"
    : "ADMIN_PASSWORD_VERIFIERS";
const requiredSecrets = [
  ...COMMON_REQUIRED_SECRETS.slice(0, 5),
  adminPasswordSecretName,
  ...COMMON_REQUIRED_SECRETS.slice(5),
  ...NATIVE_REQUIRED_SECRETS,
];
invariant(
  Array.isArray(configuration.secrets?.required) &&
    configuration.secrets.required.length === requiredSecrets.length &&
    configuration.secrets.required.every(
      (name, index) => name === requiredSecrets[index],
    ),
  `${configurationPath} must require the matching ${adminPasswordSecretName} deployment secret.`,
);
const emailDeliveryConfigured =
  validSender(configuration.vars?.AUTH_EMAIL_FROM) &&
  validEmail(configuration.vars?.SUPPORT_NOTIFICATION_EMAIL);
const emailDeliveryDisabled =
  configuration.vars?.AUTH_EMAIL_FROM === "" &&
  configuration.vars?.SUPPORT_NOTIFICATION_EMAIL === "";
invariant(
  emailDeliveryConfigured || emailDeliveryDisabled,
  `${configurationPath} must either disable optional email delivery with exact empty AUTH_EMAIL_FROM and SUPPORT_NOTIFICATION_EMAIL values or configure both values validly.`,
);

const secretFilePath = resolve(root, `.env.${environment}`);
const metadata = await lstat(secretFilePath);
invariant(metadata.isFile(), `${secretFilePath} must be a regular file.`);
invariant(
  !metadata.isSymbolicLink(),
  `${secretFilePath} must not be a symbolic link.`,
);
if (process.platform !== "win32") {
  invariant(
    (metadata.mode & 0o077) === 0,
    `${secretFilePath} is readable by other users. Run chmod 600 ${secretFilePath}.`,
  );
}
invariant(
  metadata.size > 0 && metadata.size <= 8 * 1024,
  `${secretFilePath} must be a non-empty secret file smaller than 8 KiB.`,
);

const values = parseDotEnv(await readFile(secretFilePath, "utf8"));
const deliverySecrets =
  emailDeliveryConfigured ? ["RESEND_API_KEY"] : [];
invariant(
  [...requiredSecrets, ...deliverySecrets].every((name) =>
    values.has(name),
  ) &&
    [...values.keys()].every((name) =>
      [...requiredSecrets, ...deliverySecrets].includes(name),
    ),
  emailDeliveryConfigured
    ? `Email-enabled secret file must define exactly ${[...requiredSecrets, ...deliverySecrets].join(", ")}.`
    : `Email-disabled secret file must define exactly ${requiredSecrets.join(", ")} and must omit RESEND_API_KEY.`,
);

const userKeySecret = values.get("USER_KEY_SECRET");
const supportRateLimitSecret = values.get("SUPPORT_RATE_LIMIT_SECRET");
const betterAuthRateLimitSecret = values.get(
  "BETTER_AUTH_RATE_LIMIT_SECRET",
);
const betterAuthSecret = values.get("BETTER_AUTH_SECRET");
const passwordPeppers = values.get("PARETTO_PASSWORD_PEPPERS");
const adminPasswordVerifier = values.get(adminPasswordSecretName);
const adminSessionSecret = values.get("ADMIN_SESSION_SECRET");
const turnstileSecret = values.get("TURNSTILE_SECRET");
const appleClientId = values.get("APPLE_CLIENT_ID");
const appleTeamId = values.get("APPLE_TEAM_ID");
const appleKeyId = values.get("APPLE_KEY_ID");
const applePrivateKeyBase64 = values.get("APPLE_PRIVATE_KEY_BASE64");
const appleTokenEncryptionSecret = values.get(
  "APPLE_TOKEN_ENCRYPTION_SECRET",
);
const nativeSessionSecret = values.get("NATIVE_SESSION_SECRET");
const resendApiKey = values.get("RESEND_API_KEY");

invariant(
  isBoundedSecret(userKeySecret, 32),
  "USER_KEY_SECRET must be an unquoted random value of at least 32 characters.",
);
invariant(
  isBoundedSecret(supportRateLimitSecret, 32),
  "SUPPORT_RATE_LIMIT_SECRET must be an unquoted random value of at least 32 characters.",
);
invariant(
  isBoundedSecret(betterAuthRateLimitSecret, 32),
  "BETTER_AUTH_RATE_LIMIT_SECRET must be an unquoted random value of at least 32 characters.",
);
invariant(
  isBoundedSecret(betterAuthSecret, 32),
  "BETTER_AUTH_SECRET must be an unquoted random value of at least 32 characters.",
);
const parsedPasswordPeppers = parsePasswordPepperKeyring(passwordPeppers);
invariant(
  parsedPasswordPeppers !== null,
  "PARETTO_PASSWORD_PEPPERS must be compact JSON with current and 1–3 independent 32–128 character keys.",
);
if (adminPasswordSecretName === "ADMIN_PASSWORD_VERIFIER") {
  invariant(
    /^sha256\$[A-Za-z0-9_-]{43}$/.test(adminPasswordVerifier ?? ""),
    "ADMIN_PASSWORD_VERIFIER must use sha256$ followed by a 43-character base64url digest.",
  );
} else {
  verifyAdminPasswordVerifierMap(adminPasswordVerifier, adminEmails);
}
invariant(
  isBoundedSecret(adminSessionSecret, 32),
  "ADMIN_SESSION_SECRET must be an unquoted random value of at least 32 characters.",
);
invariant(
  isBoundedSecret(turnstileSecret, 20) &&
    !TURNSTILE_TEST_SECRETS.has(turnstileSecret),
  "TURNSTILE_SECRET must be the Cloudflare Turnstile secret key.",
);
invariant(
  appleClientId === "com.paretto.app",
  "APPLE_CLIENT_ID must match the registered native bundle identifier.",
);
invariant(
  /^[A-Z0-9]{10}$/.test(appleTeamId ?? "") &&
    /^[A-Z0-9]{10}$/.test(appleKeyId ?? ""),
  "APPLE_TEAM_ID and APPLE_KEY_ID must be ten-character Apple identifiers.",
);
invariant(
  validApplePrivateKeyBase64(applePrivateKeyBase64),
  "APPLE_PRIVATE_KEY_BASE64 must encode one PKCS#8 Apple private key.",
);
invariant(
  isBoundedSecret(appleTokenEncryptionSecret, 32) &&
    isBoundedSecret(nativeSessionSecret, 32) &&
    appleTokenEncryptionSecret !== nativeSessionSecret,
  "Apple token encryption and native session secrets must be independent random values.",
);
if (emailDeliveryConfigured) {
  invariant(
    /^re_[A-Za-z0-9_-]{16,252}$/.test(resendApiKey),
    "Configured email delivery requires RESEND_API_KEY as an unquoted Resend API key.",
  );
}
invariant(
  new Set([
    userKeySecret,
    supportRateLimitSecret,
    betterAuthRateLimitSecret,
    betterAuthSecret,
    ...Object.values(parsedPasswordPeppers.keys),
    adminSessionSecret,
    appleTokenEncryptionSecret,
    nativeSessionSecret,
  ]).size === 7 + Object.keys(parsedPasswordPeppers.keys).length,
  "User, support, authentication, Apple token-encryption, native-session, password-pepper, and admin-session secrets must all be independent.",
);
for (const [name, value] of values) {
  invariant(
    !/(?:replace|placeholder|example|changeme|todo|secret[-_ ]?here)/i.test(
      value,
    ),
    `${name} still contains a placeholder.`,
  );
  invariant(
    !/^(.)(?:\1){19,}$/.test(value),
    `${name} is not a valid high-entropy value.`,
  );
}

console.log(
  `Cloudflare ${environment} secret file verified: required launch secret names, ` +
    `${emailDeliveryConfigured ? "configured" : "disabled"} optional email-delivery policy, ` +
    `bounded formats, ${adminEmails.length} distinct administrator credential` +
    `${adminEmails.length === 1 ? "" : "s"}, independent signing keys, private file permissions, and no placeholders.`,
);

function parseDotEnv(source) {
  const values = new Map();
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    invariant(match, `Invalid secret-file line ${index + 1}.`);
    const [, name, value] = match;
    invariant(!values.has(name), `Duplicate ${name} in secret file.`);
    invariant(
      value.length > 0 &&
        value === value.trim() &&
        !/^(['"]).*\1$/.test(value),
      `${name} must be a non-empty, unquoted value without surrounding whitespace.`,
    );
    values.set(name, value);
  }
  return values;
}

function isBoundedSecret(value, minimumLength, maximumLength = 256) {
  return (
    typeof value === "string" &&
    value.length >= minimumLength &&
    value.length <= maximumLength &&
    !/\s/.test(value)
  );
}

function validApplePrivateKeyBase64(value) {
  if (
    typeof value !== "string" ||
    value.length < 100 ||
    value.length > 16_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    return false;
  }
  try {
    const bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) return false;
    const pem = bytes.toString("utf8");
    const match = pem.trim().match(
      /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END PRIVATE KEY-----$/,
    );
    return Boolean(
      match &&
        pem.length >= 100 &&
        pem.length <= 10_000 &&
        match[1].replace(/\s+/g, "").length >= 80,
    );
  } catch {
    return false;
  }
}

function parsePasswordPepperKeyring(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    /\s/.test(value)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(",") !== "current,keys" ||
      typeof parsed.current !== "string" ||
      !/^[A-Za-z0-9_-]{1,16}$/.test(parsed.current) ||
      !parsed.keys ||
      typeof parsed.keys !== "object" ||
      Array.isArray(parsed.keys)
    ) {
      return null;
    }
    const entries = Object.entries(parsed.keys);
    if (
      entries.length < 1 ||
      entries.length > 3 ||
      !Object.hasOwn(parsed.keys, parsed.current) ||
      entries.some(
        ([keyId, secret]) =>
          !/^[A-Za-z0-9_-]{1,16}$/.test(keyId) ||
          !isBoundedSecret(secret, 32, 128),
      )
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function validEmail(value) {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 254 &&
    /^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(value)
  );
}

function validSender(value) {
  return (
    typeof value === "string" &&
    value.length <= 320 &&
    /<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(value)
  );
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

function verifyAdminPasswordVerifierMap(value, adminEmails) {
  invariant(
    typeof value === "string" && value.length <= 7_000,
    "ADMIN_PASSWORD_VERIFIERS must be a compact JSON object smaller than 7,000 characters.",
  );
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      "ADMIN_PASSWORD_VERIFIERS must be a valid compact JSON object.",
    );
  }
  invariant(
    parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.getPrototypeOf(parsed) === Object.prototype,
    "ADMIN_PASSWORD_VERIFIERS must be a JSON object.",
  );
  const entries = Object.entries(parsed);
  invariant(
    entries.length === adminEmails.length &&
      entries.every(
        ([email, verifier], index) =>
          email === adminEmails[index] &&
          /^sha256\$[A-Za-z0-9_-]{43}$/.test(verifier),
      ),
    "ADMIN_PASSWORD_VERIFIERS must map every ADMIN_EMAILS entry, in the same normalized order, to one SHA-256 verifier and contain no other key.",
  );
  invariant(
    new Set(entries.map(([, verifier]) => verifier)).size === entries.length,
    "Every administrator must have a distinct access-key verifier.",
  );
  invariant(
    JSON.stringify(parsed) === value,
    "ADMIN_PASSWORD_VERIFIERS must use compact canonical JSON in ADMIN_EMAILS order.",
  );
}

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
    const next = argumentsList[index + 1];
    invariant(next && !next.startsWith("--"), `Missing value for --${key}.`);
    values[key] = next;
    index += 1;
  }
  return values;
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
