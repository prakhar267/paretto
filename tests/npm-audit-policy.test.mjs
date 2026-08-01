import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditPolicyError,
  verifyAuditReport,
} from "../scripts/verify-npm-audit.mjs";

test("accepts a clean npm audit report", () => {
  const result = verifyAuditReport(cleanReport(), cleanLockfile());
  assert.deepEqual(result, {
    acceptedAdvisory: null,
    acceptedRecords: 0,
    expiresAt: null,
  });
});

test("rejects every advisory without an exception", () => {
  const report = cleanReport();
  report.vulnerabilities["brace-expansion"] = {
    name: "brace-expansion",
    severity: "high",
    isDirect: false,
    via: [],
    effects: [],
    range: "<1.1.17",
    nodes: ["node_modules/brace-expansion"],
  };
  report.metadata.vulnerabilities.high = 1;
  report.metadata.vulnerabilities.total = 1;

  assert.throws(
    () => verifyAuditReport(report, cleanLockfile()),
    (error) =>
      error instanceof AuditPolicyError &&
      /No advisory exceptions are allowed/.test(error.message),
  );
});

test("rejects metadata that hides a vulnerability record", () => {
  const report = cleanReport();
  report.vulnerabilities.example = {
    name: "example",
    severity: "moderate",
  };
  assert.throws(
    () => verifyAuditReport(report, cleanLockfile()),
    (error) =>
      error instanceof AuditPolicyError &&
      /metadata does not match/.test(error.message),
  );
});

test("rejects malformed, errored, or unsupported audit output", () => {
  assert.throws(
    () =>
      verifyAuditReport(
        { error: { summary: "registry unavailable" } },
        cleanLockfile(),
      ),
    (error) =>
      error instanceof AuditPolicyError &&
      /returned an error/.test(error.message),
  );
  assert.throws(
    () => verifyAuditReport({ auditReportVersion: 1 }, cleanLockfile()),
    (error) =>
      error instanceof AuditPolicyError &&
      /Unsupported npm audit report version/.test(error.message),
  );
  assert.throws(
    () => verifyAuditReport(cleanReport(), { lockfileVersion: 2 }),
    (error) =>
      error instanceof AuditPolicyError &&
      /Unsupported package-lock version/.test(error.message),
  );
});

function cleanReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0,
      },
    },
  };
}

function cleanLockfile() {
  return {
    lockfileVersion: 3,
    packages: {},
  };
}
