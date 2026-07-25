#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { hashPassword } from "better-auth/crypto";

const root = resolve(import.meta.dirname, "..");
const wrangler = resolve(
  root,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);
const password = "Paretto-e2e-only-passphrase-2026";
const accounts = [
  {
    project: "chromium",
    email: "chromium@e2e.paretto.invalid",
    name: "Chromium Learner",
  },
  {
    project: "firefox",
    email: "firefox@e2e.paretto.invalid",
    name: "Firefox Learner",
  },
  {
    project: "webkit",
    email: "webkit@e2e.paretto.invalid",
    name: "WebKit Learner",
  },
];
const createdAt = Date.UTC(2026, 6, 25);
const statements = [];

for (const account of accounts) {
  const userId = `e2e-user-${account.project}`;
  const passwordHash = await hashPassword(password);
  statements.push(
    `INSERT INTO learner_user (
      id, name, email, email_verified, image, created_at, updated_at
    ) VALUES (
      ${sql(userId)}, ${sql(account.name)}, ${sql(account.email)}, 1, NULL,
      ${createdAt}, ${createdAt}
    )`,
    `INSERT INTO learner_account (
      id, account_id, provider_id, user_id, access_token, refresh_token,
      id_token, access_token_expires_at, refresh_token_expires_at, scope,
      password, created_at, updated_at
    ) VALUES (
      ${sql(`e2e-credential-${account.project}`)}, ${sql(userId)},
      'credential', ${sql(userId)}, NULL, NULL, NULL, NULL, NULL, NULL,
      ${sql(passwordHash)}, ${createdAt}, ${createdAt}
    )`,
  );
}

execFileSync(
  process.execPath,
  [
    wrangler,
    "d1",
    "execute",
    "DB",
    "--local",
    "--cwd",
    "dist/server",
    "--config",
    "wrangler.json",
    "--persist-to",
    "../../test-results/playwright-runtime",
    "--command",
    `${statements.join(";\n")};`,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: "false",
    },
  },
);

console.log(
  `Seeded ${accounts.length} verified, disposable email accounts in local D1.`,
);

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
