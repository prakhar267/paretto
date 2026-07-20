# Pas à Pas v1.0.0 release evidence — 20 July 2026 UTC

This record describes the final local release candidate. It separates verified
source and package evidence from deployment, signing, device, legal, and
operator evidence that cannot be completed inside this workspace.

## Release identity and decision

- Candidate: web `1.0.0`; native marketing version `1.0.0`, build `1`.
- Planned tag: `v1.0.0`. No commit or tag was created during validation.
- Final clean validation window: 20 July 2026, approximately 22:10 UTC.
- Source stability: all application, configuration, lockfile, native, migration,
  test, and release-script inputs matched the immutable validation snapshot after
  both supported-Node runs. This evidence document alone was then updated from
  those outputs, avoiding any claim that a document can attest its own hash.
- Exact commit/tree record: pending the reviewed commit. After committing, record
  `git rev-parse HEAD` and `git rev-parse HEAD^{tree}` in the external release
  record before creating `v1.0.0`; do not substitute a pre-commit hash here.
- Local candidate decision: automated source and package gates passed.
- Public production decision: **NO-GO** until every external blocker below has
  current evidence and an accountable owner.

## Final clean release gates

The same frozen source snapshot was copied to two empty directories. Each run
used `npm ci --no-audit --no-fund` followed by `npm run release:verify`; the audit
commands remained explicit parts of the release gate.

| Runtime | npm | Clean install | Complete release gate |
| --- | --- | --- | --- |
| Node 22.23.1 | 10.9.2 | 609 locked packages installed | Passed |
| Node 24.18.0 | 10.9.2 | 609 locked packages installed | Passed |

Both runs independently produced the following evidence:

- TypeScript passed and the complete ESLint invocation passed.
- Production-only and complete dependency audits each reported zero
  vulnerabilities at the `low` threshold.
- License metadata was present for all 30 locked production packages. The
  reviewed license identifiers were `0BSD`, `Apache-2.0`, `BSD-3-Clause`,
  `CC-BY-4.0`, `ISC`, `MIT`, and `MIT OR Apache-2.0`.
- The validated `package-lock.json` SHA-256 was
  `a6bbbdab96125e39a714d90b5983ecbce0a7c9d4384d2ca932b59d40751073f3`.
  Metadata verification does not replace required notice preservation or legal
  review.
- Release identity matched across `package.json`, the lockfile, `/api/health`,
  XcodeGen, and the generated Xcode project: version `1.0.0`, native build `1`.
- Fresh SQLite replay applied seven journaled migrations through
  `0006_glorious_firedrake`; all 14 tables and 20 named indexes matched the schema,
  `integrity_check` and `foreign_key_check` passed, and foreign keys remained on.
- Vitest passed 101 tests across 20 files. Three additional production-render
  checks passed after the build.
- The audio release verifier passed all 270 licensed synthetic French WAV files:
  270 compiled words, zero additional CMS words in this candidate, zero clipped
  samples, deterministic paths and hashes, 22,050 Hz mono 16-bit PCM, and signal,
  duration, peak, RMS, and DC-offset thresholds.
- The production build completed all five vinext environments and included the
  learner app, administration UI, all public legal/support pages, and all API
  routes. The former Vite warning caused by importing an asset from `public/`
  was absent.
- The artifact gate verified the Worker and SSR entries, PWA assets, audio
  manifest, exact migration contents, observability, and the daily
  `17 3 * * *` retention trigger.
- The packaged D1 binding is still the deliberate local placeholder and the
  Sites manifest has no assigned `project_id`; these are reported as deployment
  blockers, not mistaken for live infrastructure.
- At 22:11:59 UTC, the local learner route returned HTTP 200 and `/api/health`
  returned HTTP 200 with service version `1.0.0`, schema revision `0006`, and
  database/schema `ready`. It correctly reported `productionReady: false`
  because local preview fallbacks were active and native production credentials
  were not configured.

The clean installs emitted deprecation notices for three transitive development
tooling packages (`@esbuild-kit/esm-loader`, `@esbuild-kit/core-utils`, and
`whatwg-encoding`). They produced no audit finding, are not direct production
dependencies, and remain covered by weekly npm Dependabot updates.

## Native application evidence

- `PasAPasCore`: 12 of 12 Swift tests passed.
- `PasAPas` application integration package: 12 of 12 Swift tests passed.
- A macOS Swift release build passed using the locally available Swift toolchain.
- XcodeGen 2.46 regenerated the checked-in Xcode project successfully.
- Info.plist, `PrivacyInfo.xcprivacy`, and entitlements lint passed.
- Exactly three `Shared.xcconfig` base-configuration references were verified;
  the ignored `Local.xcconfig` was absent, as required for a clean source tree.
- CI is configured to run both Swift suites and unsigned iOS Simulator XCTest on
  GitHub's `macos-15` runner with Xcode 26.3 selected explicitly.

The local machine contains Command Line Tools only, not full Xcode or an iOS SDK.
Accordingly, `xcodebuild` Simulator tests, signed archive/export, App Store
validation, TestFlight installation, and physical iPhone/iPad QA are unexecuted
and are not marked passed. The CI workflow is also unexecuted until the reviewed
source is committed and pushed.

## Product, curriculum, CMS, privacy, and operations evidence

- The checked-in A1–A2 curriculum contains all 18 French administrative regions,
  three five-card lessons per region, 54 lessons, and 270 curated words. Tests
  enforce stable IDs, complete learner fields, CEFR/topic alignment, and unique
  curriculum identity.
- CMS tests cover draft creation, validation, review, publish/unpublish,
  revision history, restore-as-draft, immutable published content, permanent slug
  tombstones, dependency protection, atomic audit chains, and complete keyset
  pagination. Earlier local D1 smoke observed a published draft in both the
  public curriculum feed and learner payload before cleanup.
- Native Apple authentication tests cover authorization-code exchange, JWT/JWKS
  verification, replay protection, encrypted refresh-token storage, hashed
  bearer sessions, session revocation, and strict learning-state validation.
- Account-deletion tests cover fail-closed Apple token revocation. Only Apple's
  confirmed HTTP 400 `invalid_grant` result permits local deletion to finish;
  transport, 5xx, malformed, and client-configuration failures return 503 and
  preserve learner data.
- Web analytics is server-enforced and opt-in. The native iOS application emits
  no analytics or tracking; its privacy declaration and copy reflect that
  separate behavior.
- Operations tests cover consent, analytics aggregation, support intake,
  administrator authorization, audited retention, bounded 400/730-day deletion,
  targeted and class-wide legal holds, atomic hold release, and failure audit
  trails.
- Legal and launch materials include privacy, terms, cookies/storage,
  accessibility, attributions, support, data map/retention, operations,
  production infrastructure, release QA, App Store launch, and a legal launch
  checklist. These are product-ready templates, not jurisdiction-specific legal
  approval.

## Browser and accessibility evidence

- Automated WCAG A/AA semantic scans passed onboarding, the signed-in learner
  home, a lesson dialog, all five administration tabs, and the public support
  form. Deterministic WCAG AA contrast checks passed the reviewed small-text
  tokens.
- Earlier interactive macOS Chrome QA covered onboarding, default-off optional
  consent, packaged pronunciation, a complete five-card lesson, all rating paths,
  progression, wordbook search/details, review, challenge early-close behavior,
  profile preferences, legal/support routes, validation, and all five admin tabs.
- The actual 1470×758 Chrome window, a 1440×900 viewport, and responsive
  emulation at 320×568, 360×800, 390×844, 480×900, 768×1024, and 844×390 had no
  horizontal overflow. Keyboard skip-link, dialog Escape/return-focus, and
  reduced-motion checks passed.
- Live QA defects fixed during that pass included singular copy, the spelling of
  “belfries,” and decorative artwork obscuring the lesson CTA at 320–390 pixels;
  regression tests cover the repaired behaviors.
- A production-mode service worker was installed in Chrome, the local server was
  then stopped, and a fresh root navigation rendered the identity-free “You’re
  offline” reconnect shell from Cache Storage. Restarting the development server
  restored the complete learner UI and saved local progress.

## Explicitly unexecuted or externally blocked

- **Hosting:** Sites is disabled for this workspace, no Sites `project_id` exists,
  and the packaged D1 database ID is a local placeholder. No public deployment,
  live URL, DNS/TLS check, live binding check, production migration, backup/PITR,
  restore exercise, live Cron observation, monitoring probe, alert-delivery test,
  or rollback exercise has been performed.
- **Production secrets and identity:** an approved `ADMIN_EMAILS` allowlist and
  independently generated managed secrets for `USER_KEY_SECRET`,
  `NATIVE_SESSION_SECRET`, `APPLE_TOKEN_ENCRYPTION_SECRET`, and the Apple server
  credentials still require production provisioning. A live health response must
  report `productionReady: true` before launch.
- **Apple release:** the real bundle/team/Sign in with Apple configuration,
  provisioning profile, signed archive, App Store Connect record, screenshots,
  review metadata, TestFlight run, account-deletion run, and Apple upload remain
  external work.
- **Device/browser matrix:** Safari 26 WebDriver is installed, but its persistent
  “Allow remote automation” setting is disabled, so Safari interactive QA remains
  unexecuted. Firefox, Edge, physical iPhone/iPad/Android, VoiceOver, Windows high
  contrast, and actual browser 200%/400% zoom are also unexecuted. Chrome viewport
  emulation is not a substitute for those checks.
- **Offline/install:** service-worker manifest, icon, cache, and Range/206 behavior
  have automated coverage, and the identity-free offline navigation fallback was
  exercised locally as described above. Install-from-browser UX and a standalone
  PWA relaunch remain unexecuted against deployed hosting.
- **Legal:** the real operator name, business address, working support contact,
  governing jurisdictions, provider agreements, license/notice review, retention
  commitments, and qualified counsel approval must be supplied by the operator.

Do not label this candidate publicly launched until these items have owners,
completion dates, retained evidence, and a recorded GO decision. The repository
contains the runbook and release-evidence template needed to close them without
inventing results.
