# Pas à Pas release evidence template

Copy this file for each candidate release. Do not record secret values, raw
authentication headers, learner data, support messages, or administrator email
addresses in release evidence.

## Release identity

- Candidate version:
- Git commit SHA:
- Source branch or tag:
- UTC validation date:
- Release owner:
- Independent reviewer:
- CI run URL:
- Sites version/deployment URL:
- Native marketing/build version:
- macOS and full Xcode version/build:
- Signed staging archive or TestFlight URL:
- Previous known-good version:

## Automated release gate

- [ ] CI passed on supported Node 22 and Node 24.
- [ ] CI passed both Swift package suites and unsigned iOS Simulator XCTest with
      the pinned Xcode 26.3 toolchain on the required macOS runner.
- [ ] Install used `npm ci` and the committed lockfile.
- [ ] `npm run release:verify` passed without retries or local-only changes.
- [ ] TypeScript and lint passed.
- [ ] Unit, component, API, accessibility, and rendered-route tests passed.
- [ ] Production build and audio verification passed.
- [ ] Swift package tests, Xcode tests, and a signed Release-configuration archive
      passed for the native candidate using Xcode 26.2 or 26.3 on macOS 15.6+.
- [ ] Packaged Worker, Sites metadata, migrations, D1 binding, and Cron passed
      artifact verification.
- [ ] Fresh SQLite replay reached the advertised schema revision with integrity,
      foreign-key, table, and index checks passing.
- [ ] Production and complete dependency audits both reported zero findings.
- [ ] Every locked production package had reviewable license metadata.
- [ ] Package, lockfile, health, and native marketing/build versions matched; the
      release tag points to the exact validated commit.
- Lockfile SHA-256 from the license gate:
- Test count and notable coverage:
- Audio count/version:
- Latest migration verified:

## Data and recovery

- [ ] Every journaled migration was reviewed and applied to staging in order.
- [ ] Staging integrity/schema check passed.
- [ ] Production backup or point-in-time recovery is enabled and its real window
      matches the published notice.
- [ ] A non-production restore exercise has current evidence.
- Migration operator and completion time:
- Backup/PITR evidence link:
- Latest restore-test date and result:

## Production configuration

- [ ] Sites project and D1 binding are assigned.
- [ ] `USER_KEY_SECRET` is present, random, at least 32 characters, and stored
      only in the hosted secret manager. Record presence only, never the value.
- [ ] `ADMIN_EMAILS` contains the approved least-privilege allowlist. Record the
      approver, not the addresses.
- [ ] `APPLE_CLIENT_ID` exactly matches the production Apple identifier used by
      the signed native application.
- [ ] `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and the managed-secret `APPLE_PRIVATE_KEY`
      are the active Sign in with Apple server credentials. Record identifiers
      only; never copy the private key into release evidence.
- [ ] `APPLE_TOKEN_ENCRYPTION_SECRET` is present, random, independent, at least
      32 characters, and its restore/rotation procedure is documented.
- [ ] `NATIVE_SESSION_SECRET` is present, random, independent from other secrets,
      at least 32 characters, and stored only in the hosted secret manager.
- [ ] `/api/health` returns HTTP 200 and `productionReady: true`.
- [ ] Hosting strips client-supplied identity headers and injects authenticated
      identity as expected.
- Configuration approver:
- Health evidence URL/time:

## Deployment and production smoke

- [ ] Deployed version matches the validated Git SHA.
- [ ] Sign-in and sign-out passed.
- [ ] First lesson, pronunciation, progress sync, conflict recovery, export, and
      deletion passed.
- [ ] The signed native staging/TestFlight build passed Apple sign-in/sign-out,
      token refresh/expiry, offline relaunch, two-device conflict recovery,
      export, account deletion, and revoked-session recovery.
- [ ] Non-admin denial and administrator draft/publish workflow passed.
- [ ] Support intake and analytics opt-in/opt-out passed.
- [ ] Public legal, storage, accessibility, attribution, and support pages passed.
- [ ] Daily `17 3 * * *` trigger is visible and one successful scheduled run was
      observed.
- Smoke tester, time, and result:
- Scheduled-run evidence:
- Rollback exercised or exact rollback command/version reviewed:

## Monitoring and launch controls

- [ ] Health probes run every minute from at least two regions.
- [ ] Availability, latency, 5xx, progress-conflict, support/admin, deployment,
      migration, retention, Apple-auth, and native-session alerts route to a
      named responder.
- [ ] Alert delivery was tested.
- [ ] Supported-browser, physical-device, zoom, high-contrast, and assistive-
      technology QA evidence is complete.
- [ ] Operator facts, provider agreements, audio/dependency licensing, retention,
      and counsel review are approved for the actual launch jurisdictions.
- Monitoring owner and evidence:
- Device QA evidence:
- Legal approval owner/date:

## Exceptions and final decision

| Open item | Severity | Owner | Due date | Evidence or accepted rationale |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

- Decision: GO / NO-GO
- Decision maker:
- Decision time:
- Rollback owner:
- Notes:

A release is not “launched” while a required checkbox is incomplete unless the
named decision maker records a time-bounded exception that does not cover a
data-loss, authorization, legal-consent, accessibility-core-flow, payment, or
reproducible-crash blocker.
