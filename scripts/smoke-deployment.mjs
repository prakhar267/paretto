#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const rawOrigin = process.argv[2];
if (!rawOrigin) {
  throw new Error(
    "Usage: smoke-deployment.mjs <https-origin> [--mode controlled-beta|public]",
  );
}
const modeFlag = process.argv[3];
const launchMode =
  modeFlag === undefined
    ? "public"
    : modeFlag === "--mode"
      ? process.argv[4]
      : null;
assert.ok(
  (launchMode === "controlled-beta" || launchMode === "public") &&
    process.argv.length === (modeFlag === undefined ? 3 : 5),
  "Use --mode controlled-beta or --mode public. Omitted mode defaults to strict public readiness.",
);

const candidate = new URL(rawOrigin);
const allowHttp =
  process.env.ALLOW_HTTP_SMOKE === "1" &&
  (candidate.hostname === "127.0.0.1" || candidate.hostname === "localhost");
assert.ok(
  candidate.protocol === "https:" || allowHttp,
  "Smoke tests require HTTPS. ALLOW_HTTP_SMOKE=1 is accepted only for localhost.",
);
assert.equal(candidate.origin, rawOrigin, "Use an exact origin without a path.");
assert.equal(candidate.username, "", "Credentials are not allowed in the smoke URL.");
assert.equal(candidate.password, "", "Credentials are not allowed in the smoke URL.");

const origin = candidate.origin;
const packageMetadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const expectedVersion = packageMetadata.version;
const releaseVersionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
function readBoundedInteger(name, fallback, minimum, maximum) {
  const rawValue = process.env[name] ?? fallback;
  assert.match(
    rawValue,
    /^\d+$/,
    `${name} must be an integer from ${minimum} through ${maximum}.`,
  );
  const value = Number(rawValue);
  assert.ok(
    Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${name} must be an integer from ${minimum} through ${maximum}.`,
  );
  return value;
}

const timeoutMs = readBoundedInteger(
  "SMOKE_TIMEOUT_MS",
  "15000",
  1_000,
  60_000,
);
const versionAttempts = readBoundedInteger(
  "SMOKE_VERSION_ATTEMPTS",
  "13",
  2,
  60,
);
const versionIntervalMs = readBoundedInteger(
  "SMOKE_VERSION_INTERVAL_MS",
  "5000",
  100,
  30_000,
);

async function request(path, acceptedStatuses = [200]) {
  const response = await fetch(new URL(path, origin), {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: path.startsWith("/api/") ? "application/json" : "text/html,*/*",
      "user-agent": `Paretto read-only deployment smoke/${expectedVersion}`,
    },
  });
  assert.ok(
    acceptedStatuses.includes(response.status),
    `${path} returned ${response.status}; expected ${acceptedStatuses.join(" or ")}.`,
  );
  const redirectedTo = response.headers.get("location");
  if (redirectedTo) {
    assert.equal(
      new URL(redirectedTo, origin).origin,
      origin,
      `${path} redirected outside the deployed origin.`,
    );
  }
  return response;
}

let health;
let readinessAttempts = 0;
let consecutiveExpectedVersions = 0;
for (let attempt = 1; attempt <= versionAttempts; attempt += 1) {
  const candidateHealth = await readHealth();
  readinessAttempts = attempt;
  if (candidateHealth.version === expectedVersion) {
    assertHealthReady(candidateHealth);
    consecutiveExpectedVersions += 1;
    if (consecutiveExpectedVersions === 2) {
      health = candidateHealth;
      break;
    }
    if (attempt === versionAttempts) {
      assert.fail(
        `Deployment version ${expectedVersion} was observed only once before the ${versionAttempts}-attempt convergence limit.`,
      );
    }
    console.error(
      `Deployment is serving ${expectedVersion}; waiting ${versionIntervalMs}ms ` +
        `for a second consecutive confirmation (attempt ${attempt}/${versionAttempts}).`,
    );
    await delay(versionIntervalMs);
    continue;
  }
  consecutiveExpectedVersions = 0;
  if (attempt === versionAttempts) {
    assert.equal(
      candidateHealth.version,
      expectedVersion,
      `Deployment version did not converge after ${versionAttempts} attempts.`,
    );
  }
  console.error(
    `Deployment is still serving version ${String(candidateHealth.version)}; ` +
      `waiting ${versionIntervalMs}ms for ${expectedVersion} (attempt ${attempt}/${versionAttempts}).`,
  );
  await delay(versionIntervalMs);
}
assert.ok(
  health,
  "Deployment health did not return two consecutive expected versions.",
);

async function readHealth() {
  const healthResponse = await request("/api/health");
  assert.match(healthResponse.headers.get("cache-control") ?? "", /no-store/i);
  const candidateHealth = await healthResponse.json();
  assert.equal(
    typeof candidateHealth.version,
    "string",
    "Deployment health version must be a stable semantic-version string.",
  );
  assert.match(
    candidateHealth.version,
    releaseVersionPattern,
    "Deployment health version must be a stable semantic-version string.",
  );
  return candidateHealth;
}

function assertHealthReady(candidateHealth) {
  assert.equal(candidateHealth.status, "ok");
  assert.equal(candidateHealth.service, "paretto-web");
  assert.equal(candidateHealth.version, expectedVersion);
  assert.equal(candidateHealth.launchMode, launchMode);
  assert.equal(candidateHealth.webReady, true);
  assert.equal(candidateHealth.database, "ready");
  assert.ok(
    candidateHealth.checks && typeof candidateHealth.checks === "object",
  );
  for (const check of [
    "database",
    "schema",
    "userKeySecret",
    "supportRateLimitSecret",
    "learnerAuthRateLimitSecret",
    "learnerAuthentication",
    "learnerAuthOrigin",
    "adminAllowlist",
    "adminAuthentication",
    "turnstileSiteKey",
    "turnstileSecret",
  ]) {
    assert.equal(
      candidateHealth.checks[check],
      "ready",
      `${check} is not ready.`,
    );
  }
  if (launchMode === "public") {
    assert.equal(candidateHealth.productionReady, true);
    assert.equal(
      candidateHealth.checks.learnerEmailAccountCreation,
      "ready",
    );
    assert.equal(candidateHealth.checks.learnerEmailVerification, "ready");
    assert.equal(candidateHealth.checks.learnerPasswordReset, "ready");
    assert.equal(candidateHealth.checks.supportNotifications, "ready");
  } else {
    assert.equal(
      candidateHealth.productionReady,
      false,
      "Controlled beta must never claim broad production readiness.",
    );
    assert.equal(
      candidateHealth.checks.learnerEmailAccountCreation,
      "disabled",
    );
    assert.equal(
      candidateHealth.checks.learnerEmailVerification,
      "not-configured",
    );
    assert.equal(
      candidateHealth.checks.learnerPasswordReset,
      "not-configured",
    );
    assert.equal(
      candidateHealth.checks.supportNotifications,
      "not-configured",
    );
    assert.ok(
      Array.isArray(candidateHealth.warnings) &&
        candidateHealth.warnings.includes(
          "Controlled beta mode is operational but is not approved for a broad public launch.",
        ) &&
        candidateHealth.warnings.includes(
          "Transactional email is not configured; email registration, verification, and password recovery remain unavailable.",
        ) &&
        candidateHealth.warnings.includes(
          "Operator support email delivery is not configured; tickets remain stored for authenticated administrator follow-up.",
        ),
      "Controlled-beta health must state every unavailable delivery capability.",
    );
  }
  assert.ok(
    ["ready", "pending", "running"].includes(
      candidateHealth.checks.retentionSchedule,
    ),
    "Scheduled retention is failed, missed, stalled, or unavailable.",
  );
  assert.ok(
    ["ready", "optional-not-configured"].includes(
      candidateHealth.checks.learnerGoogleAuth,
    ),
    "Google account readiness has an unknown state.",
  );
  assert.ok(
    ["ready", "optional-not-configured"].includes(
      candidateHealth.checks.learnerAppleAuth,
    ),
    "Apple account readiness has an unknown state.",
  );
  assert.equal(candidateHealth.checks.nativeApi, "disabled");
  for (const check of [
    "appleClientId",
    "appleServerCredentials",
    "appleTokenEncryptionSecret",
    "nativeSessionSecret",
  ]) {
    assert.equal(
      candidateHealth.checks[check],
      "native-disabled",
      `${check} is not safely disabled.`,
    );
  }
}

const homeResponse = await request("/");
const home = await homeResponse.text();
assert.match(home, /Paretto/);
assert.match(homeResponse.headers.get("x-content-type-options") ?? "", /nosniff/i);
assert.equal(homeResponse.headers.get("x-frame-options"), "DENY");
if (candidate.protocol === "https:") {
  assert.match(
    homeResponse.headers.get("strict-transport-security") ?? "",
    /max-age=31536000/i,
  );
}
assert.match(
  homeResponse.headers.get("content-security-policy") ?? "",
  /default-src 'self'/i,
);

const htmlRoutes = [
  "/sign-in",
  "/reset-password",
  "/privacy",
  "/terms",
  "/cookies",
  "/accessibility",
  "/attributions",
  "/support",
];
for (const path of htmlRoutes) {
  const response = await request(path);
  assert.match(
    response.headers.get("content-type") ?? "",
    /text\/html/i,
    `${path} did not return HTML.`,
  );
  assert.match(await response.text(), /Paretto/, `${path} is not Paretto-branded.`);
}

const manifestResponse = await request("/manifest.webmanifest");
const manifest = await manifestResponse.json();
assert.equal(manifest.name, "Paretto — Learn French");
assert.equal(manifest.short_name, "Paretto");
assert.equal(manifest.start_url, "/");

const serviceWorkerResponse = await request("/service-worker.js");
assert.match(
  serviceWorkerResponse.headers.get("service-worker-allowed") ?? "",
  /\//,
);
assert.match(await serviceWorkerResponse.text(), /paretto-static-v\d+/);

const offlineResponse = await request("/offline.html");
assert.match(
  offlineResponse.headers.get("content-type") ?? "",
  /text\/html/i,
);
const offlineSource = await offlineResponse.text();
assert.match(offlineSource, /<title>Reconnect to Paretto<\/title>/);
assert.match(
  offlineSource,
  /This offline page contains no learning or lesson data\./,
);

const iconResponse = await request("/icon-192.png");
assert.match(iconResponse.headers.get("content-type") ?? "", /image\/png/i);
assert.ok((await iconResponse.arrayBuffer()).byteLength > 1_000);

const audioResponse = await request("/audio/fr/v1/idf-metro.wav");
assert.match(
  audioResponse.headers.get("content-type") ?? "",
  /audio\/(?:wav|x-wav)/i,
);
assert.ok((await audioResponse.arrayBuffer()).byteLength > 1_000);

const finalHealth = await readHealth();
assertHealthReady(finalHealth);

console.log(
  JSON.stringify({
    origin,
    version: expectedVersion,
    schemaRevision: health.schemaRevision,
    health: "ready",
    authPages: "ready",
    htmlRoutes: htmlRoutes.length + 1,
    staticAssets: 5,
    mode: "read-only",
    launchMode,
    readinessAttempts,
  }),
);
