#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const root = process.cwd();
const releaseFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);

const forbiddenExtensions = new Set([
  ".key",
  ".mobileprovision",
  ".p8",
  ".p12",
  ".pem",
]);
const forbiddenBasenames = new Set([
  ".dev.vars",
  ".env",
  ".env.production",
  ".env.staging",
]);
const credentialPatterns = [
  [
    "private key",
    /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{128,}-----END (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/,
  ],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["Stripe live key", /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  [
    "Cloudflare API token",
    /\bCLOUDFLARE_API_TOKEN\s*=\s*[A-Za-z0-9_-]{20,}\b/,
  ],
  [
    "Turnstile secret",
    /\bTURNSTILE_SECRET\s*=\s*0x[A-Za-z0-9_-]{20,}\b/,
  ],
  [
    "admin password verifier",
    /\bADMIN_PASSWORD_VERIFIER\s*=\s*sha256\$[A-Za-z0-9_-]{43}\b/,
  ],
];

const findings = [];
for (const relativePath of releaseFiles) {
  const fileName = basename(relativePath);
  if (
    forbiddenExtensions.has(extname(fileName).toLowerCase()) ||
    forbiddenBasenames.has(fileName) ||
    /^\.env\./.test(fileName)
  ) {
    findings.push(`${relativePath}: forbidden credential/signing file`);
    continue;
  }
  // This verifier contains the detection signatures themselves.
  if (relativePath === "scripts/verify-no-secrets.mjs") continue;

  let contents;
  try {
    contents = await readFile(resolve(root, relativePath));
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  if (contents.includes(0) || contents.length > 2 * 1024 * 1024) continue;
  const source = contents.toString("utf8");
  for (const [label, pattern] of credentialPatterns) {
    if (pattern.test(source)) findings.push(`${relativePath}: possible ${label}`);
  }
}

if (findings.length > 0) {
  throw new Error(
    `Potential tracked secrets detected:\n${findings
      .map((finding) => `- ${finding}`)
      .join("\n")}`,
  );
}

console.log(
  `Secret scan passed for ${releaseFiles.length} release files: no signing files, ` +
    "private keys, or supported provider-token patterns detected.",
);
