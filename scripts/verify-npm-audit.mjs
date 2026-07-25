import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TEMPORARY_AUDIT_ACCEPTANCE = Object.freeze({
  ghsa: "GHSA-mh99-v99m-4gvg",
  cve: "CVE-2026-14257",
  source: 1124334,
  packageName: "brace-expansion",
  title:
    "brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash",
  url: "https://github.com/advisories/GHSA-mh99-v99m-4gvg",
  severity: "high",
  vulnerableRange: "<=5.0.7",
  expiresAt: "2026-08-08T00:00:00.000Z",
});

const APPROVED_VULNERABLE_NODES = Object.freeze({
  "node_modules/brace-expansion": "1.1.16",
  "node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion":
    "5.0.7",
});

const APPROVED_DEV_AUDIT_NODES = Object.freeze({
  "node_modules/@eslint/config-array": "0.21.2",
  "node_modules/@eslint/eslintrc": "3.3.5",
  "node_modules/@typescript-eslint/typescript-estree": "8.59.3",
  "node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion":
    "5.0.7",
  "node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch":
    "10.2.5",
  "node_modules/brace-expansion": "1.1.16",
  "node_modules/eslint": "9.39.4",
  "node_modules/eslint-config-next": "16.2.6",
  "node_modules/eslint-plugin-import": "2.32.0",
  "node_modules/eslint-plugin-jsx-a11y": "6.10.2",
  "node_modules/eslint-plugin-react": "7.37.5",
  "node_modules/minimatch": "3.1.5",
  "node_modules/typescript-eslint": "8.59.3",
});

const REQUIRED_DEV_CHAINS = Object.freeze([
  {
    path: "node_modules/eslint",
    version: "9.39.4",
    dependency: ["minimatch", "^3.1.5"],
  },
  {
    path: "node_modules/minimatch",
    version: "3.1.5",
    dependency: ["brace-expansion", "^1.1.7"],
  },
  {
    path: "node_modules/brace-expansion",
    version: "1.1.16",
  },
  {
    path: "node_modules/eslint-config-next",
    version: "16.2.6",
    dependency: ["typescript-eslint", "^8.46.0"],
  },
  {
    path: "node_modules/typescript-eslint",
    version: "8.59.3",
    dependency: ["@typescript-eslint/typescript-estree", "8.59.3"],
  },
  {
    path: "node_modules/@typescript-eslint/typescript-estree",
    version: "8.59.3",
    dependency: ["minimatch", "^10.2.2"],
  },
  {
    path: "node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch",
    version: "10.2.5",
    dependency: ["brace-expansion", "^5.0.5"],
  },
  {
    path: "node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion",
    version: "5.0.7",
  },
]);

export class AuditPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuditPolicyError";
  }
}

export function verifyAuditReport(
  report,
  lockfile,
  { now = new Date() } = {},
) {
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

  const vulnerabilities = report.vulnerabilities;
  const vulnerabilityEntries = Object.entries(vulnerabilities);
  verifyMetadata(report.metadata, vulnerabilityEntries);
  if (vulnerabilityEntries.length === 0) {
    return {
      acceptedAdvisory: null,
      acceptedRecords: 0,
      expiresAt: null,
    };
  }

  const checkedAt = validDate(now, "verification time");
  const expiresAt = validDate(
    TEMPORARY_AUDIT_ACCEPTANCE.expiresAt,
    "temporary acceptance expiry",
  );
  if (checkedAt.getTime() >= expiresAt.getTime()) {
    throw new AuditPolicyError(
      `The temporary ${TEMPORARY_AUDIT_ACCEPTANCE.ghsa} acceptance expired at ${TEMPORARY_AUDIT_ACCEPTANCE.expiresAt}.`,
    );
  }

  assertRecord(lockfile, "package-lock.json");
  if (lockfile.lockfileVersion !== 3) {
    throw new AuditPolicyError(
      `Unsupported package-lock version: ${String(lockfile.lockfileVersion)}.`,
    );
  }
  assertRecord(lockfile.packages, "package-lock.json packages");
  verifyRequiredDevChains(lockfile.packages);

  for (const [name, vulnerability] of vulnerabilityEntries) {
    assertRecord(vulnerability, `vulnerability record ${name}`);
    if (vulnerability.name !== name) {
      throw new AuditPolicyError(
        `Audit key ${name} does not match its package name.`,
      );
    }
    if (vulnerability.severity !== TEMPORARY_AUDIT_ACCEPTANCE.severity) {
      throw new AuditPolicyError(
        `${name} has unapproved severity ${String(vulnerability.severity)}.`,
      );
    }
    if (!Array.isArray(vulnerability.nodes) || vulnerability.nodes.length === 0) {
      throw new AuditPolicyError(`${name} has no auditable dependency nodes.`);
    }
    for (const node of vulnerability.nodes) {
      verifyApprovedDevNode(node, lockfile.packages);
    }
    if (!Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
      throw new AuditPolicyError(`${name} has no advisory path.`);
    }
  }

  const rootFinding = vulnerabilities[TEMPORARY_AUDIT_ACCEPTANCE.packageName];
  assertRecord(
    rootFinding,
    `${TEMPORARY_AUDIT_ACCEPTANCE.packageName} root vulnerability`,
  );
  if (
    !sameStringSet(
      rootFinding.nodes,
      Object.keys(APPROVED_VULNERABLE_NODES),
    )
  ) {
    throw new AuditPolicyError(
      `${TEMPORARY_AUDIT_ACCEPTANCE.ghsa} appears outside the two approved physical dependency paths.`,
    );
  }
  if (
    rootFinding.via.length !== 1 ||
    !isRecord(rootFinding.via[0])
  ) {
    throw new AuditPolicyError(
      `${TEMPORARY_AUDIT_ACCEPTANCE.packageName} must contain exactly the approved direct advisory.`,
    );
  }
  verifyApprovedAdvisory(rootFinding.via[0]);

  for (const [name] of vulnerabilityEntries) {
    verifyAdvisoryLineage(name, vulnerabilities, new Set());
  }

  return {
    acceptedAdvisory: TEMPORARY_AUDIT_ACCEPTANCE.ghsa,
    acceptedRecords: vulnerabilityEntries.length,
    expiresAt: TEMPORARY_AUDIT_ACCEPTANCE.expiresAt,
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

function verifyRequiredDevChains(packages) {
  for (const entry of REQUIRED_DEV_CHAINS) {
    const lockEntry = packages[entry.path];
    assertRecord(lockEntry, `locked dependency ${entry.path}`);
    if (lockEntry.version !== entry.version) {
      throw new AuditPolicyError(
        `${entry.path} changed from approved version ${entry.version} to ${String(lockEntry.version)}.`,
      );
    }
    if (lockEntry.dev !== true) {
      throw new AuditPolicyError(
        `${entry.path} is not exclusively a development dependency.`,
      );
    }
    if (entry.dependency) {
      assertRecord(
        lockEntry.dependencies,
        `dependencies for ${entry.path}`,
      );
      const [dependencyName, expectedRange] = entry.dependency;
      if (lockEntry.dependencies[dependencyName] !== expectedRange) {
        throw new AuditPolicyError(
          `${entry.path} no longer has the approved ${dependencyName}@${expectedRange} edge.`,
        );
      }
    }
  }
}

function verifyApprovedDevNode(node, packages) {
  if (
    typeof node !== "string" ||
    !(node in APPROVED_DEV_AUDIT_NODES)
  ) {
    throw new AuditPolicyError(
      `${String(node)} is not an approved dev-only audit node.`,
    );
  }
  const lockEntry = packages[node];
  assertRecord(lockEntry, `locked audit node ${node}`);
  if (lockEntry.version !== APPROVED_DEV_AUDIT_NODES[node]) {
    throw new AuditPolicyError(
      `${node} is not at its approved version ${APPROVED_DEV_AUDIT_NODES[node]}.`,
    );
  }
  if (lockEntry.dev !== true) {
    throw new AuditPolicyError(
      `${node} is not exclusively a development dependency.`,
    );
  }
}

function verifyAdvisoryLineage(name, vulnerabilities, visiting) {
  if (visiting.has(name)) {
    throw new AuditPolicyError(`npm audit contains a via cycle at ${name}.`);
  }
  const vulnerability = vulnerabilities[name];
  assertRecord(vulnerability, `referenced vulnerability ${name}`);
  const nextVisiting = new Set(visiting);
  nextVisiting.add(name);

  for (const via of vulnerability.via) {
    if (typeof via === "string") {
      if (!(via in vulnerabilities)) {
        throw new AuditPolicyError(
          `${name} references missing vulnerability ${via}.`,
        );
      }
      verifyAdvisoryLineage(via, vulnerabilities, nextVisiting);
      continue;
    }
    assertRecord(via, `direct advisory for ${name}`);
    verifyApprovedAdvisory(via);
  }
}

function verifyApprovedAdvisory(advisory) {
  const acceptance = TEMPORARY_AUDIT_ACCEPTANCE;
  const expected = {
    source: acceptance.source,
    name: acceptance.packageName,
    dependency: acceptance.packageName,
    title: acceptance.title,
    url: acceptance.url,
    severity: acceptance.severity,
    range: acceptance.vulnerableRange,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (advisory[key] !== expectedValue) {
      throw new AuditPolicyError(
        `Only ${acceptance.ghsa}/${acceptance.cve} is temporarily approved; advisory ${key} did not match.`,
      );
    }
  }
  if (
    "cves" in advisory &&
    !sameStringSet(advisory.cves, [acceptance.cve])
  ) {
    throw new AuditPolicyError(
      `Only ${acceptance.cve} is temporarily approved.`,
    );
  }
}

function sameStringSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.every((value) => typeof value === "string") &&
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

function validDate(value, label) {
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new AuditPolicyError(`Invalid ${label}.`);
  }
  return result;
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
    const result = verifyAuditReport(report, lockfile);
    if (result.acceptedAdvisory) {
      console.log(
        `npm audit verified: ${result.acceptedRecords} dev-only records trace exclusively to ${result.acceptedAdvisory}; temporary acceptance expires ${result.expiresAt}.`,
      );
    } else {
      console.log("npm audit verified: no vulnerabilities reported.");
    }
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
