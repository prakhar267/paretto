import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditPolicyError,
  TEMPORARY_AUDIT_ACCEPTANCE,
  verifyAuditReport,
} from "../scripts/verify-npm-audit.mjs";

const BEFORE_EXPIRY = new Date("2026-08-07T23:59:59.999Z");

test("accepts a clean npm audit report without consulting an exception", () => {
  const result = verifyAuditReport(cleanReport(), {}, { now: BEFORE_EXPIRY });
  assert.deepEqual(result, {
    acceptedAdvisory: null,
    acceptedRecords: 0,
    expiresAt: null,
  });
});

test("accepts only the exact advisory on the locked dev-only paths", () => {
  const result = verifyAuditReport(acceptedReport(), acceptedLockfile(), {
    now: BEFORE_EXPIRY,
  });
  assert.deepEqual(result, {
    acceptedAdvisory: "GHSA-mh99-v99m-4gvg",
    acceptedRecords: 2,
    expiresAt: "2026-08-08T00:00:00.000Z",
  });
});

test("fails closed when the temporary acceptance expires", () => {
  assert.throws(
    () =>
      verifyAuditReport(acceptedReport(), acceptedLockfile(), {
        now: new Date(TEMPORARY_AUDIT_ACCEPTANCE.expiresAt),
      }),
    (error) =>
      error instanceof AuditPolicyError &&
      /acceptance expired/.test(error.message),
  );
});

test("rejects the accepted package if it enters the runtime graph", () => {
  const lockfile = acceptedLockfile();
  lockfile.packages["node_modules/brace-expansion"].dev = false;
  assert.throws(
    () =>
      verifyAuditReport(acceptedReport(), lockfile, {
        now: BEFORE_EXPIRY,
      }),
    (error) =>
      error instanceof AuditPolicyError &&
      /not exclusively a development dependency/.test(error.message),
  );
});

test("rejects every unapproved development advisory", () => {
  const report = acceptedReport();
  report.vulnerabilities["brace-expansion"].via[0] = {
    ...approvedAdvisory(),
    source: 9999999,
    url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
  };
  assert.throws(
    () =>
      verifyAuditReport(report, acceptedLockfile(), {
        now: BEFORE_EXPIRY,
      }),
    (error) =>
      error instanceof AuditPolicyError &&
      /Only GHSA-mh99-v99m-4gvg/.test(error.message),
  );
});

test("rejects the approved advisory on any additional dependency path", () => {
  const report = acceptedReport();
  report.vulnerabilities["brace-expansion"].nodes.push(
    "node_modules/other/node_modules/brace-expansion",
  );
  assert.throws(
    () =>
      verifyAuditReport(report, acceptedLockfile(), {
        now: BEFORE_EXPIRY,
      }),
    (error) =>
      error instanceof AuditPolicyError &&
      /not an approved dev-only audit node/.test(error.message),
  );
});

test("rejects dependency version or edge drift", () => {
  const lockfile = acceptedLockfile();
  lockfile.packages[
    "node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch"
  ].version = "10.2.6";
  assert.throws(
    () =>
      verifyAuditReport(acceptedReport(), lockfile, {
        now: BEFORE_EXPIRY,
      }),
    (error) =>
      error instanceof AuditPolicyError &&
      /changed from approved version 10.2.5/.test(error.message),
  );
});

test("rejects malformed or incomplete audit output", () => {
  assert.throws(
    () =>
      verifyAuditReport(
        { error: { summary: "registry unavailable" } },
        acceptedLockfile(),
        { now: BEFORE_EXPIRY },
      ),
    (error) =>
      error instanceof AuditPolicyError &&
      /returned an error/.test(error.message),
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

function acceptedReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      "brace-expansion": {
        name: "brace-expansion",
        severity: "high",
        isDirect: false,
        via: [approvedAdvisory()],
        effects: ["minimatch"],
        range: "<=5.0.7",
        nodes: [
          "node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion",
          "node_modules/brace-expansion",
        ],
      },
      minimatch: {
        name: "minimatch",
        severity: "high",
        isDirect: false,
        via: ["brace-expansion"],
        effects: ["eslint"],
        range: "2.0.0 - 10.0.2",
        nodes: ["node_modules/minimatch"],
      },
    },
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 2,
        critical: 0,
        total: 2,
      },
    },
  };
}

function approvedAdvisory() {
  return {
    source: 1124334,
    name: "brace-expansion",
    dependency: "brace-expansion",
    title:
      "brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash",
    url: "https://github.com/advisories/GHSA-mh99-v99m-4gvg",
    severity: "high",
    cwe: ["CWE-400", "CWE-770"],
    cvss: {
      score: 7.5,
      vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H",
    },
    range: "<=5.0.7",
  };
}

function acceptedLockfile() {
  return {
    lockfileVersion: 3,
    packages: {
      "node_modules/eslint": locked("9.39.4", {
        minimatch: "^3.1.5",
      }),
      "node_modules/minimatch": locked("3.1.5", {
        "brace-expansion": "^1.1.7",
      }),
      "node_modules/brace-expansion": locked("1.1.16"),
      "node_modules/eslint-config-next": locked("16.2.6", {
        "typescript-eslint": "^8.46.0",
      }),
      "node_modules/typescript-eslint": locked("8.59.3", {
        "@typescript-eslint/typescript-estree": "8.59.3",
      }),
      "node_modules/@typescript-eslint/typescript-estree": locked("8.59.3", {
        minimatch: "^10.2.2",
      }),
      "node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch":
        locked("10.2.5", {
          "brace-expansion": "^5.0.5",
        }),
      "node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion":
        locked("5.0.7"),
    },
  };
}

function locked(version, dependencies = {}) {
  return {
    version,
    dev: true,
    dependencies,
  };
}
