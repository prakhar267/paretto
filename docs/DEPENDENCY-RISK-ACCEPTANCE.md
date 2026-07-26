# Temporary development dependency risk acceptance

## Decision

Paretto temporarily accepts
[GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
(`CVE-2026-14257`) only in the locked development toolchain described below.
The advisory covers an out-of-memory denial of service caused by unbounded
brace expansion.

- Accepted: July 25, 2026
- Owner: Paretto release engineering
- Automatic expiry: **August 8, 2026 at 00:00 UTC**
- Production/runtime acceptance: **none**

The release gate fails at or after the expiry. It also fails immediately if
the advisory, severity, package versions, dependency edges, physical install
paths, or development-only lockfile classification changes.

## Exact accepted paths

Only these two physical copies are accepted:

```text
eslint@9.39.4
└─ minimatch@3.1.5
   └─ brace-expansion@1.1.16

eslint-config-next@16.2.6
└─ typescript-eslint@8.59.3
   └─ @typescript-eslint/typescript-estree@8.59.3
      └─ minimatch@10.2.5
         └─ brace-expansion@5.0.7
```

The hoisted `minimatch@3.1.5` copy is also consumed by ESLint configuration
and plugin packages. npm therefore reports propagated findings for those
packages even though they trace to the same advisory and physical
`brace-expansion@1.1.16` copy. The verifier permits propagated records only
when every `via` chain ends at this one approved advisory and every reported
node matches the locked dev-only allowlist.

## Rationale and controls

Both vulnerable copies are marked exclusively `dev: true` in
`package-lock.json`. They are used by linting and build tooling and are not
part of the deployed Cloudflare Worker dependency graph. A separate
`npm audit --omit=dev` gate remains unconditional and must report zero
findings.

The vulnerable operation would require an attacker-controlled brace pattern.
Paretto invokes the affected tooling with repository-controlled lint and
source patterns; the application does not pass learner input to this
development dependency. This reduces, but does not eliminate, CI/local
availability risk.

Compensating controls:

- the lockfile and every accepted version and dependency edge are verified;
- production findings and all other development advisories fail the release;
- GitHub Actions has read-only repository permissions and uses a locked
  install;
- the exception expires automatically after fourteen days;
- force upgrades, major-version downgrades, and broad advisory ignores are
  prohibited.

## Resolution and revocation

Remove this acceptance as soon as compatible upstream packages resolve both
locked paths. Do not use `npm audit fix --force`; npm currently suggests
incompatible historical major versions that would weaken or break the
toolchain.

Revoke the acceptance immediately if the package enters the runtime graph, a
new advisory is reported, severity increases, dependency paths drift,
untrusted brace patterns reach the tooling, or exploitation evidence appears.

Run the same release check locally with:

```sh
npm run audit:production
npm run audit:all
```
