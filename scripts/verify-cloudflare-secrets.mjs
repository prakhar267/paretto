#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REQUIRED_SECRETS = [
  "USER_KEY_SECRET",
  "ADMIN_PASSWORD_VERIFIER",
  "ADMIN_SESSION_SECRET",
  "TURNSTILE_SECRET",
];
const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
const environment = options.environment;

invariant(
  environment === "staging" || environment === "production",
  "Use --environment staging or --environment production.",
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
invariant(
  values.size === REQUIRED_SECRETS.length &&
    REQUIRED_SECRETS.every((name) => values.has(name)),
  `Secret file must define exactly ${REQUIRED_SECRETS.join(", ")}.`,
);

const userKeySecret = values.get("USER_KEY_SECRET");
const adminPasswordVerifier = values.get("ADMIN_PASSWORD_VERIFIER");
const adminSessionSecret = values.get("ADMIN_SESSION_SECRET");
const turnstileSecret = values.get("TURNSTILE_SECRET");

invariant(
  isBoundedSecret(userKeySecret, 32),
  "USER_KEY_SECRET must be an unquoted random value of at least 32 characters.",
);
invariant(
  /^sha256\$[A-Za-z0-9_-]{43}$/.test(adminPasswordVerifier ?? ""),
  "ADMIN_PASSWORD_VERIFIER must use sha256$ followed by a 43-character base64url digest.",
);
invariant(
  isBoundedSecret(adminSessionSecret, 32),
  "ADMIN_SESSION_SECRET must be an unquoted random value of at least 32 characters.",
);
invariant(
  isBoundedSecret(turnstileSecret, 20),
  "TURNSTILE_SECRET must be the Cloudflare Turnstile secret key.",
);
invariant(
  userKeySecret !== adminSessionSecret,
  "USER_KEY_SECRET and ADMIN_SESSION_SECRET must be independent values.",
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
  `Cloudflare ${environment} secret file verified: exact launch secret names, ` +
    "bounded formats, independent signing keys, private file permissions, and no placeholders.",
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

function isBoundedSecret(value, minimumLength) {
  return (
    typeof value === "string" &&
    value.length >= minimumLength &&
    value.length <= 256 &&
    !/\s/.test(value)
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
