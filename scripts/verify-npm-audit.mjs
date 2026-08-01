import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class AuditPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuditPolicyError";
  }
}

export function verifyAuditReport(report, lockfile) {
  assertRecord(report, "npm audit output");
  if ("error" in report) {
    throw new AuditPolicyError(
      "npm audit returned an error instead of a vulnerability report.",
    );
  }
  if (report.auditReportVersion !== 2) {
    throw new AuditPolicyError(
      `Unsupported npm audit report version: ${String(report.auditReportVersion)}.`,
    );
  }
  assertRecord(report.vulnerabilities, "npm audit vulnerabilities");
  assertRecord(lockfile, "package-lock.json");
  if (lockfile.lockfileVersion !== 3) {
    throw new AuditPolicyError(
      `Unsupported package-lock version: ${String(lockfile.lockfileVersion)}.`,
    );
  }

  const vulnerabilityEntries = Object.entries(report.vulnerabilities);
  verifyMetadata(report.metadata, vulnerabilityEntries);
  if (vulnerabilityEntries.length > 0) {
    const packages = vulnerabilityEntries.map(([name]) => name).sort();
    throw new AuditPolicyError(
      `npm audit reported ${vulnerabilityEntries.length} vulnerability record(s): ${packages.join(", ")}. No advisory exceptions are allowed.`,
    );
  }

  return {
    acceptedAdvisory: null,
    acceptedRecords: 0,
    expiresAt: null,
  };
}

function verifyMetadata(metadata, vulnerabilityEntries) {
  assertRecord(metadata, "npm audit metadata");
  assertRecord(metadata.vulnerabilities, "npm audit vulnerability metadata");
  const counts = metadata.vulnerabilities;
  const total = Number(counts.total);
  if (!Number.isSafeInteger(total) || total !== vulnerabilityEntries.length) {
    throw new AuditPolicyError(
      "npm audit metadata does not match the vulnerability records.",
    );
  }
  for (const severity of [
    "info",
    "low",
    "moderate",
    "high",
    "critical",
  ]) {
    const expected = vulnerabilityEntries.filter(
      ([, value]) => isRecord(value) && value.severity === severity,
    ).length;
    if (Number(counts[severity]) !== expected) {
      throw new AuditPolicyError(
        "npm audit severity totals do not match the vulnerability records.",
      );
    }
  }
}

function assertRecord(value, label) {
  if (!isRecord(value)) {
    throw new AuditPolicyError(`${label} is missing or malformed.`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  try {
    process.stdin.setEncoding("utf8");
    let source = "";
    for await (const chunk of process.stdin) source += chunk;
    let report;
    try {
      report = JSON.parse(source);
    } catch {
      throw new AuditPolicyError("npm audit did not emit valid JSON.");
    }
    const lockfilePath = fileURLToPath(
      new URL("../package-lock.json", import.meta.url),
    );
    const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
    verifyAuditReport(report, lockfile);
    console.log("npm audit verified: no vulnerabilities reported.");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown verification failure.";
    console.error(`npm audit verification failed: ${message}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
