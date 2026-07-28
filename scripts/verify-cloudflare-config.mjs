#!/usr/bin/env node

import { access, readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const FREE_MAX_ASSET_FILES = 20_000;
const FREE_MAX_ASSET_BYTES = 25 * 1024 * 1024;
// Cloudflare enforces the Free Worker limit after gzip compression. Summing
// independently compressed modules is slightly stricter than Wrangler's
// combined upload report while avoiding false failures from repetitive source.
const FREE_MAX_COMPRESSED_WORKER_MODULE_BYTES = 3_000_000;
const EXPECTED_CRON = "17 3 * * *";
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
const WORKER_FIRST_ROUTES = [
  "/",
  "/accessibility",
  "/admin",
  "/admin/*",
  "/api/*",
  "/auth/*",
  "/attributions",
  "/cookies",
  "/privacy",
  "/reset-password",
  "/sign-in",
  "/support",
  "/terms",
];
const root = process.cwd();
const options = parseArguments(process.argv.slice(2));

if (options.templates === "true") {
  for (const environment of ["staging", "production"]) {
    const source = await readFile(
      resolve(root, `wrangler.${environment}.jsonc.example`),
      "utf8",
    );
    invariant(
        source.includes("__CLOUDFLARE_ACCOUNT_ID__") &&
        source.includes("__D1_DATABASE_NAME__") &&
        source.includes("__D1_DATABASE_ID__") &&
        source.includes("__ADMIN_EMAILS__") &&
        source.includes("__ADMIN_PASSWORD_SECRET_NAME__") &&
        source.includes("__AUTH_EMAIL_FROM__") &&
        source.includes("__BETTER_AUTH_URL__") &&
        source.includes("__LAUNCH_MODE__") &&
        source.includes("__SUPPORT_NOTIFICATION_EMAIL__") &&
        source.includes("__TURNSTILE_SITE_KEY__") &&
        source.includes("__WORKERS_PLAN__"),
      `${environment} template must keep every provisioning placeholder.`,
    );
    const baseMaterialized = source
      .replace(
        "__CLOUDFLARE_ACCOUNT_ID__",
        "1234567890abcdef1234567890abcdef",
      )
      .replace(
        "__D1_DATABASE_NAME__",
        environment === "staging"
          ? "paretto-staging"
          : "paretto-production",
      )
      .replace(
        "__D1_DATABASE_ID__",
        environment === "staging"
          ? "12345678-1234-4234-8234-1234567890ab"
          : "abcdefab-cdef-4abc-8def-abcdefabcdef",
      )
      .replace("__ADMIN_EMAILS__", "admin@example.com")
      .replace(
        "__ADMIN_PASSWORD_SECRET_NAME__",
        "ADMIN_PASSWORD_VERIFIER",
      )
      .replace(
        "__BETTER_AUTH_URL__",
        `https://paretto-${environment}.example.com`,
      )
      .replace("__LAUNCH_MODE__", "public")
      .replace("__WORKERS_PLAN__", "paid")
      .replace(
        "__TURNSTILE_SITE_KEY__",
        "0x4AAAAAAATemplateShapeOnlyKey",
      );
    for (const delivery of [
      {
        authEmailFrom: "",
        supportNotificationEmail: "",
      },
      {
        authEmailFrom: "Paretto <accounts@example.com>",
        supportNotificationEmail: "support@example.com",
      },
    ]) {
      const materialized = baseMaterialized
        .replace("__AUTH_EMAIL_FROM__", delivery.authEmailFrom)
        .replace(
          "__SUPPORT_NOTIFICATION_EMAIL__",
          delivery.supportNotificationEmail,
        );
      validateConfiguration(
        JSON.parse(materialized),
        environment,
        false,
      );
    }
    for (const delivery of [
      {
        authEmailFrom: "Paretto <accounts@example.com>",
        supportNotificationEmail: "",
      },
      {
        authEmailFrom: "",
        supportNotificationEmail: "support@example.com",
      },
    ]) {
      const materialized = baseMaterialized
        .replace("__AUTH_EMAIL_FROM__", delivery.authEmailFrom)
        .replace(
          "__SUPPORT_NOTIFICATION_EMAIL__",
          delivery.supportNotificationEmail,
        );
      let rejected = false;
      try {
        validateConfiguration(
          JSON.parse(materialized),
          environment,
          false,
        );
      } catch {
        rejected = true;
      }
      invariant(
        rejected,
        `${environment} template verification must reject partial optional email delivery.`,
      );
    }
  }
  console.log(
    "Cloudflare staging/production templates verified: direct Worker entry, " +
      "ASSETS, D1 drizzle migrations, retention Cron, observability, and no paid-only bindings.",
  );
  process.exit(0);
}

const environment = options.environment;
invariant(
  environment === "staging" || environment === "production",
  "Use --environment staging or --environment production.",
);
const configPath = resolve(root, `wrangler.${environment}.jsonc`);
const configuration = JSON.parse(await readFile(configPath, "utf8"));
validateConfiguration(configuration, environment, true);
await verifyDeploymentArtifact(configuration);

  console.log(
  `Cloudflare ${environment} deployment gate passed for ${configuration.name}: ` +
    `provisioned D1 ${configuration.d1_databases[0].database_name}, ` +
    `${configuration.vars.LAUNCH_MODE} mode, checked-in migrations, ` +
    "free-plan asset limits, Cron, and observability.",
);

function validateConfiguration(configuration, environment, requireProvisioned) {
  const expectedWorkerName =
    environment === "staging"
      ? "paretto-staging"
      : "paretto";
  invariant(
    configuration.name === expectedWorkerName,
    `Worker name must be ${expectedWorkerName}.`,
  );
  invariant(
    configuration.main === "dist/server/index.js",
    "Worker main must be dist/server/index.js.",
  );
  invariant(
    configuration.compatibility_date === "2026-07-17",
    "Keep the validated Worker compatibility date until a reviewed upgrade.",
  );
  invariant(
    Array.isArray(configuration.compatibility_flags) &&
      configuration.compatibility_flags.length === 1 &&
      configuration.compatibility_flags[0] === "nodejs_compat",
    "Worker compatibility flags must contain nodejs_compat only.",
  );
  invariant(
    configuration.assets?.directory === "dist/client" &&
      configuration.assets?.binding === "ASSETS" &&
      configuration.assets?.html_handling === "none",
    "Static assets must use dist/client through the ASSETS binding and preserve exact HTML paths.",
  );
  const adminEmails = parseAdminEmails(configuration.vars?.ADMIN_EMAILS);
  const launchMode = configuration.vars?.LAUNCH_MODE;
  const workersPlan = configuration.vars?.WORKERS_PLAN;
  const emailDeliveryConfigured =
    typeof configuration.vars?.AUTH_EMAIL_FROM === "string" &&
    /<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(
      configuration.vars.AUTH_EMAIL_FROM,
    ) &&
    typeof configuration.vars?.SUPPORT_NOTIFICATION_EMAIL === "string" &&
    /^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(
      configuration.vars.SUPPORT_NOTIFICATION_EMAIL,
    );
  const emailDeliveryDisabled =
    configuration.vars?.AUTH_EMAIL_FROM === "" &&
    configuration.vars?.SUPPORT_NOTIFICATION_EMAIL === "";
  invariant(
    configuration.vars?.NATIVE_API_ENABLED === "false" &&
      adminEmails !== null &&
      (launchMode === "public" || launchMode === "controlled-beta") &&
      (workersPlan === "free" || workersPlan === "paid") &&
      (launchMode !== "public" || workersPlan === "paid") &&
      (emailDeliveryConfigured || emailDeliveryDisabled) &&
      validHttpsOrigin(configuration.vars?.BETTER_AUTH_URL) &&
      typeof configuration.vars?.TURNSTILE_SITE_KEY === "string" &&
      configuration.vars.TURNSTILE_SITE_KEY.length >= 20 &&
      configuration.vars.TURNSTILE_SITE_KEY.length <= 256 &&
      !/\s/.test(configuration.vars.TURNSTILE_SITE_KEY) &&
      !TURNSTILE_TEST_SITE_KEYS.has(
        configuration.vars.TURNSTILE_SITE_KEY,
      ) &&
      Object.keys(configuration.vars).length === 8,
    "The web launch must explicitly select controlled-beta or public mode, configure core learner/admin identity and Turnstile, disable the native API, and either disable optional email delivery with two exact empty values or configure both its valid sender and support mailbox.",
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
    Array.isArray(configuration.secrets?.required) &&
      configuration.secrets.required.length === requiredSecrets.length &&
      configuration.secrets.required.every(
        (secret, index) => secret === requiredSecrets[index],
      ),
    `Required secrets must be exactly ${requiredSecrets.join(", ")}.`,
  );
  invariant(
    !configuration.secrets.required.some((secret) =>
      /APPLE|NATIVE/i.test(secret),
    ),
    "Apple/native secrets must stay optional while NATIVE_API_ENABLED is false.",
  );
  invariant(
    Array.isArray(configuration.assets?.run_worker_first) &&
      configuration.assets.run_worker_first.length ===
        WORKER_FIRST_ROUTES.length &&
      configuration.assets.run_worker_first.every(
        (route, index) => route === WORKER_FIRST_ROUTES[index],
      ),
    "Run only dynamic SSR, admin, legal, support, and API routes through the Worker.",
  );
  invariant(
    Array.isArray(configuration.d1_databases) &&
      configuration.d1_databases.length === 1,
    "Exactly one D1 database is allowed per environment.",
  );
  const database = configuration.d1_databases[0];
  invariant(database.binding === "DB", "D1 must use the DB binding.");
  invariant(
    database.migrations_dir === "drizzle",
    "D1 migrations_dir must be the checked-in drizzle directory.",
  );
  invariant(
    typeof database.database_name === "string" &&
      /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/i.test(database.database_name),
    "D1 database_name is invalid.",
  );
  invariant(
    typeof database.database_id === "string" &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
        database.database_id,
      ),
    "D1 database_id must be a UUID.",
  );
  invariant(
    typeof configuration.account_id === "string" &&
      /^[0-9a-f]{32}$/i.test(configuration.account_id),
    "Cloudflare account_id must be 32 hexadecimal characters.",
  );
  if (requireProvisioned) {
    invariant(
      !hasRepeatedSingleCharacter(configuration.account_id),
      "Cloudflare account_id is still a placeholder.",
    );
    invariant(
      !hasRepeatedSingleCharacter(database.database_id.replaceAll("-", "")),
      "D1 database_id is still a placeholder.",
    );
  }
  invariant(
    Array.isArray(configuration.triggers?.crons) &&
      configuration.triggers.crons.length === 1 &&
      configuration.triggers.crons[0] === EXPECTED_CRON,
    `Worker must keep the ${EXPECTED_CRON} UTC retention trigger.`,
  );
  invariant(
    configuration.observability?.enabled === true,
    "Worker observability must remain enabled.",
  );
  invariant(
    configuration.limits === undefined,
    "Do not configure paid Standard-plan CPU limits in the Free-plan configuration.",
  );
  for (const paidOrUnusedBinding of [
    "images",
    "r2_buckets",
    "durable_objects",
    "services",
    "queues",
    "vectorize",
    "hyperdrive",
    "ai",
  ]) {
    const value = configuration[paidOrUnusedBinding];
    invariant(
      value === undefined ||
        (Array.isArray(value) && value.length === 0),
      `Unexpected ${paidOrUnusedBinding} binding in the free-start configuration.`,
    );
  }
  invariant(
    !JSON.stringify(configuration).includes("__"),
    "Wrangler configuration still contains a provisioning token.",
  );
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

async function verifyDeploymentArtifact(configuration) {
  const mainPath = resolve(root, configuration.main);
  const assetsPath = resolve(root, configuration.assets.directory);
  const migrationsPath = resolve(
    root,
    configuration.d1_databases[0].migrations_dir,
  );
  await Promise.all([access(mainPath), access(assetsPath), access(migrationsPath)]);

  const assetFiles = await filesBelow(assetsPath);
  invariant(
    assetFiles.length <= FREE_MAX_ASSET_FILES,
    `Static asset count ${assetFiles.length} exceeds the Free-plan limit ${FREE_MAX_ASSET_FILES}.`,
  );
  for (const path of assetFiles) {
    const metadata = await stat(path);
    invariant(
      metadata.size <= FREE_MAX_ASSET_BYTES,
      `${relative(root, path)} exceeds the Free-plan 25 MiB per-file limit.`,
    );
  }

  const workerModules = (await filesBelow(resolve(root, "dist/server"))).filter(
    (path) => /\.(?:m?js)$/.test(path),
  );
  let compressedWorkerModuleBytes = 0;
  for (const path of workerModules) {
    compressedWorkerModuleBytes += gzipSync(await readFile(path), {
      level: 9,
    }).length;
  }
  invariant(
    compressedWorkerModuleBytes <= FREE_MAX_COMPRESSED_WORKER_MODULE_BYTES,
    `Individually gzip-compressed Worker modules ${compressedWorkerModuleBytes} bytes ` +
      `exceed the ${FREE_MAX_COMPRESSED_WORKER_MODULE_BYTES}-byte Free-plan gate.`,
  );

  const [journalSource, headersSource, workerSource] = await Promise.all([
    readFile(resolve(migrationsPath, "meta/_journal.json"), "utf8"),
    readFile(resolve(assetsPath, "_headers"), "utf8"),
    readFile(resolve(root, "worker/index.ts"), "utf8"),
  ]);
  const journal = JSON.parse(journalSource);
  invariant(
    journal.dialect === "sqlite" &&
      Array.isArray(journal.entries) &&
      journal.entries.length > 0,
    "The D1 migration journal is missing or invalid.",
  );
  for (const entry of journal.entries) {
    await access(resolve(migrationsPath, `${entry.tag}.sql`));
  }
  invariant(
    /\/service-worker\.js[\s\S]*Cache-Control: no-cache, no-store, must-revalidate/.test(
      headersSource,
    ) && /Service-Worker-Allowed: \//.test(headersSource),
    "The built service worker must ship no-cache and root-scope headers.",
  );
  invariant(
    !/handleImageOptimization|env\.IMAGES|\/_vinext\/image/.test(workerSource),
    "The unused paid image-transformation path must remain absent.",
  );
}

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
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
    if (!next || next.startsWith("--")) {
      values[key] = "true";
      continue;
    }
    values[key] = next;
    index += 1;
  }
  return values;
}

function hasRepeatedSingleCharacter(value) {
  return /^([0-9a-f])\1+$/i.test(value);
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
