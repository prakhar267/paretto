# Paretto release evidence template

Copy this file for each candidate release. Do not record secret values, raw
authentication headers, learner data, support messages, or administrator email
addresses in release evidence.

## Release identity

- Candidate version:
- Git commit SHA:
- Source branch or tag:
- UTC validation date:
- Release owner:
- Release governance (`owner-operated` or `independent review`):
- Independent reviewer (if applicable):
- Owner-operated risk decision and scope (if applicable):
- CI run URL:
- Hosting version/deployment URL:
- Launch mode (`controlled-beta` or `public`):
- Declared Workers plan (`free` or `paid`) and provider evidence:
- Native marketing/build version:
- macOS and full Xcode version/build:
- Signed staging archive or TestFlight URL:
- Previous known-good version:

## Automated release gate

- [ ] CI passed on supported Node 22 and Node 24.
- [ ] CI passed both Swift package suites and unsigned iOS Simulator XCTest with
      the workflow's pinned, recorded Xcode toolchain.
- [ ] Install used `npm ci` and the committed lockfile.
- [ ] `npm run release:verify` passed without retries or local-only changes.
- [ ] TypeScript and lint passed.
- [ ] Unit, component, API, accessibility, and rendered-route tests passed.
- [ ] Playwright critical journeys passed independently in Chromium, Firefox,
      and WebKit; attach the CI browser-job evidence.
- [ ] Production build and audio verification passed.
- [ ] Swift package tests, Xcode tests, and a signed Release-configuration archive
      passed for the native candidate using an App Store-compatible full Xcode
      toolchain recorded above.
- [ ] Packaged Worker, Sites metadata, migrations, D1 binding, and Cron passed
      artifact verification.
- [ ] Fresh SQLite replay reached the advertised schema revision with integrity,
      foreign-key, table, and index checks passing.
- [ ] The production dependency audit reported zero findings; every development-
      tool advisory is either resolved or covered by a reviewed, unexpired,
      non-production risk acceptance with an explicit recheck date.
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
- [ ] The production workflow uploaded its pre-migration Time Travel bookmark,
      encrypted D1 export, and checksum manifest before applying migrations;
      record the artifact ID and expiry, never the encryption passphrase.
- [ ] The encrypted export passed its workflow decryption round-trip and a
      retained copy exists in the approved backup store when recovery evidence
      is required beyond the seven-day artifact window.
- [ ] A non-production restore exercise has current evidence.
- Migration operator and completion time:
- Backup/PITR evidence link:
- Encrypted recovery artifact ID, SHA-256, and expiry:
- Latest restore-test date and result:

## Production configuration

- [ ] The selected hosting project, Worker/static-assets deployment, and D1
      binding are assigned and verified. Record direct Cloudflare or Sites.
- [ ] `USER_KEY_SECRET` is present, random, at least 32 characters, and stored
      only in the hosted secret manager. Record presence only, never the value.
- [ ] `SUPPORT_RATE_LIMIT_SECRET` is present, random, at least 32 characters,
      independent from `USER_KEY_SECRET`, and stored only in the hosted secret
      manager. A missing or reused value keeps health non-ready.
- [ ] `BETTER_AUTH_RATE_LIMIT_SECRET` is present, random, at least 32
      characters, independent from learner, support, auth-signing, and
      administrator secrets, and stored only in the hosted secret manager.
      A concurrency burst admitted no more than the configured route limit,
      and limiter rows contained no raw IP, path, or email.
- [ ] `BETTER_AUTH_SECRET` is independent and managed securely, and
      `BETTER_AUTH_URL` is the exact deployed HTTPS origin.
- [ ] Fresh Paretto ID creation, password sign-in, one-time recovery,
      recovery-code rotation, session revocation, and cross-browser progress
      synchronization passed without a learner email address.
- [ ] `WORKERS_PLAN` matches the deployment-workflow choice and generated
      Worker configuration. For `public`, separate Cloudflare account evidence
      confirms Workers Paid; the self-declared runtime value is not accepted as
      billing proof.
- [ ] If support email is enabled, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, and
      `SUPPORT_NOTIFICATION_EMAIL` form one verified delivery configuration.
      If it is disabled, a named administrator owns manual queue review.
- [ ] When optional support email is enabled in either launch mode,
      `SUPPORT_NOTIFICATION_EMAIL` reaches the named responder without exposing
      the learner's support body in logs or release evidence. When it is
      disabled, both runtime values are exact empty strings, `RESEND_API_KEY` is
      absent, and a named administrator owns manual ticket-queue review.
- [ ] A staged provider failure left the support mutation successful, recorded
      a failed body-free outbox job, and the next bounded maintenance run
      delivered it exactly once through the provider idempotency key.
- [ ] Support delivery did not disclose passwords, recovery codes, ticket
      bodies in logs, or the internal non-routable account alias.
- [ ] The Turnstile site key is restricted to the deployed hostname and the
      matching `TURNSTILE_SECRET` is present only in the hosted secret manager.
- [ ] `ADMIN_EMAILS` contains the approved least-privilege allowlist. A
      single-admin controlled beta uses `ADMIN_PASSWORD_VERIFIER`; an
      environment that can publish CMS content has at least two different
      people and uses `ADMIN_PASSWORD_VERIFIERS` with an exact, distinct
      per-email mapping. Record the approver and count, not addresses or
      verifiers.
- [ ] If the native API is enabled, `APPLE_CLIENT_ID` exactly matches the
      production Apple identifier used by the signed native application.
- [ ] If the native API is enabled, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and the
      managed-secret `APPLE_PRIVATE_KEY` are the active Sign in with Apple server
      credentials. Record identifiers only; never copy the private key into
      release evidence.
- [ ] If the native API is enabled, `APPLE_TOKEN_ENCRYPTION_SECRET` is present,
      random, independent, at least 32 characters, and its restore/rotation
      procedure is documented.
- [ ] If the native API is enabled, `NATIVE_SESSION_SECRET` is present, random,
      independent from other secrets, at least 32 characters, and stored only in
      the hosted secret manager.
- [ ] `/api/health` returns HTTP 200. For `public`, it reports
      `launchMode: "public"` and `productionReady: true`. For
      `controlled-beta`, it reports `launchMode: "controlled-beta"`,
      `webReady: true`, `productionReady: false`, and explicit launch-mode and
      optional support-email-delivery warnings while Paretto ID remains usable.
- [ ] Hosting strips retired client-supplied identity headers, and the selected
      anonymous-web or authenticated identity mechanism is verified.
- Configuration decision maker:
- Health evidence URL/time:

## Deployment and production smoke

- [ ] Deployed version matches the validated Git SHA.
- [ ] The protected deployment workflow completed its mandatory read-only smoke
      test against the exact deployed HTTPS origin and selected launch mode;
      attach its JSON output. A strict public smoke must fail against a
      controlled-beta deployment.
- [ ] Anonymous learner-session creation and administrator sign-in/sign-out
      passed. Record native sign-in separately when the native API is enabled.
- [ ] First lesson, pronunciation, progress sync, conflict recovery, export, and
      deletion passed.
- [ ] The signed native staging/TestFlight build passed Apple sign-in/sign-out,
      token refresh/expiry, offline relaunch, two-device conflict recovery,
      export, account deletion, and revoked-session recovery.
- [ ] Non-admin denial, administrator draft/validation, same-actor
      review/publish denial, and compiled-curriculum fallback passed. If CMS
      publishing is enabled, distinct author and approver accounts also
      completed a reviewed staging publish; a one-admin configuration leaves
      publishing intentionally unavailable.
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

- [ ] The release governance above matches the actual GitHub Environment
      controls. An owner-operated controlled beta records that one account can
      both initiate and administer the release; it does not claim independent
      review and does not waive CI, tag, ancestry, backup, smoke, CMS
      author/approver, legal, or physical-device requirements.
- Decision: GO / NO-GO
- Decision maker:
- Decision time:
- Rollback owner:
- Notes:

A release is not “launched” while a required checkbox is incomplete unless the
named decision maker records a time-bounded exception that does not cover a
data-loss, authorization, legal-consent, accessibility-core-flow, payment, or
reproducible-crash blocker.
