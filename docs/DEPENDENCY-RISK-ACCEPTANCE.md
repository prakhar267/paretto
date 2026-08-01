# Resolved development dependency risk

## Decision

Paretto previously accepted
[GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)
(`CVE-2026-14257`) only in the locked development toolchain described below.
The advisory covers an out-of-memory denial of service caused by unbounded
brace expansion.

- Accepted: July 25, 2026
- Owner: Paretto release engineering
- Resolved: **August 1, 2026**
- Production/runtime acceptance: **none**

The exception is revoked. `brace-expansion` is locked to patched releases
`1.1.18` and `5.0.9`, `npm audit` reports zero findings, and the release gate
now rejects every advisory without an allowlist.

## Exact accepted paths

Only these two physical copies are accepted:

```text
eslint@9.39.4
└─ minimatch@3.1.5
   └─ brace-expansion@1.1.18

eslint-config-next@16.2.6
└─ typescript-eslint@8.59.3
   └─ @typescript-eslint/typescript-estree@8.59.3
      └─ minimatch@10.2.5
         └─ brace-expansion@5.0.9
```

The hoisted `minimatch@3.1.5` copy is also consumed by ESLint configuration
and plugin packages, but both physical `brace-expansion` copies are now on
patched releases.

## Rationale and controls

Both formerly vulnerable copies remain exclusively `dev: true` in
`package-lock.json`. They are used by linting and build tooling and are not
part of the deployed Cloudflare Worker dependency graph. A separate
`npm audit --omit=dev` gate remains unconditional and must report zero
findings.

The vulnerable operation would require an attacker-controlled brace pattern.
Paretto invokes the affected tooling with repository-controlled lint and
source patterns; the application does not pass learner input to this
development dependency. This reduces, but does not eliminate, CI/local
availability risk.

Permanent controls:

- the lockfile pins the patched transitive versions;
- production and development advisories fail the release;
- GitHub Actions has read-only repository permissions and uses a locked
  install;
- broad advisory ignores are prohibited.

## Resolution and revocation

The acceptance was removed after npm exposed compatible patched transitive
releases. Any future advisory now fails closed and requires a new reviewed
dependency update; no automatic or broad exception remains.

Run the same release check locally with:

```sh
npm run audit:production
npm run audit:all
```
