#!/usr/bin/env node

import assert from "node:assert/strict";

const rawOrigin = process.argv[2];
if (!rawOrigin) {
  throw new Error(
    "Usage: monitor-production-health.mjs <https-origin> [--mode controlled-beta|public]",
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
  process.env.ALLOW_HTTP_MONITOR === "1" &&
  (candidate.hostname === "127.0.0.1" || candidate.hostname === "localhost");
assert.ok(
  candidate.protocol === "https:" || allowHttp,
  "Production monitoring requires HTTPS.",
);
assert.equal(
  candidate.origin,
  rawOrigin,
  "Use an exact origin without a path.",
);
assert.equal(
  candidate.username,
  "",
  "Credentials are not allowed in the monitor URL.",
);
assert.equal(
  candidate.password,
  "",
  "Credentials are not allowed in the monitor URL.",
);

const timeoutMs = Number.parseInt(
  process.env.MONITOR_TIMEOUT_MS ?? "15000",
  10,
);
assert.ok(
  Number.isSafeInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 60_000,
  "MONITOR_TIMEOUT_MS must be an integer from 1000 through 60000.",
);

const startedAt = Date.now();
const response = await fetch(new URL("/api/health", candidate.origin), {
  method: "GET",
  redirect: "error",
  signal: AbortSignal.timeout(timeoutMs),
  headers: {
    accept: "application/json",
    "user-agent": "Paretto independent production monitor/1",
  },
});

assert.equal(
  response.status,
  200,
  "The health endpoint did not return HTTP 200.",
);
assert.match(
  response.headers.get("cache-control") ?? "",
  /no-store/i,
  "The health response must not be cached.",
);

const health = await response.json();
assert.equal(health.service, "paretto-web");
assert.equal(health.status, "ok");
assert.equal(health.webReady, true);
assert.equal(health.launchMode, launchMode);
if (launchMode === "public") {
  assert.equal(
    health.workersPlan,
    "paid",
    "Public launch requires the Workers Paid plan.",
  );
  assert.equal(health.checks?.workersPlan, "paid");
  assert.equal(health.productionReady, true);
} else {
  assert.ok(
    health.workersPlan === "free" || health.workersPlan === "paid",
    "Controlled beta requires an explicit free or paid Workers plan.",
  );
  assert.equal(
    health.checks?.workersPlan,
    health.workersPlan === "paid" ? "paid" : "free-controlled-beta-only",
  );
  assert.equal(health.productionReady, false);
  assert.ok(
    Array.isArray(health.warnings) &&
      health.warnings.includes(
        "Controlled beta mode is operational but is not approved for a broad public launch.",
      ),
    "Controlled beta did not report its launch limitation.",
  );
}
assert.equal(health.database, "ready");
assert.equal(health.checks?.schema, "ready");
assert.equal(health.checks?.accountDeletionQueue, "ready");
assert.equal(health.checks?.supportNotificationQueue, "ready");
assert.ok(
  ["ready", "pending", "running"].includes(health.checks?.retentionSchedule),
  "Scheduled retention is failed, missed, stalled, or unavailable.",
);

console.log(
  JSON.stringify({
    checkedAt: new Date().toISOString(),
    origin: candidate.origin,
    latencyMs: Date.now() - startedAt,
    version: health.version,
    schemaRevision: health.schemaRevision,
    status: "ready",
    launchMode,
    workersPlan: health.workersPlan,
  }),
);
