# Loquivo v1.1.0 technical release evidence — 25 July 2026 IST

This record covers the Loquivo web and unsigned native release candidate. It
contains no credential values, learner data, support messages, or raw session
identifiers.

## Release identity

- Validated source commit:
  `2bcbd012b515c23fb595f3841a9769afb774c117`.
- Source branch: `agent/rebrand-loquivo`.
- Draft review: <https://github.com/prakhar267/loquivo/pull/4>.
- GitHub Actions run:
  <https://github.com/prakhar267/loquivo/actions/runs/30124929479>.
- Web/native version: `1.1.0`; native build: `3`.
- Production Worker version:
  `3f07421b-0b85-4683-b20d-9e1d9b23f4a7`.
- Staging Worker version:
  `3b3ae3fe-4fff-4aca-971e-456133bbaa71`.
- Production: <https://loquivo.prakhargupta267.workers.dev>.
- Staging: <https://loquivo-staging.prakhargupta267.workers.dev>.
- Previous tagged release: `v1.0.1`.

## Automated gates

- `npm run release:verify` passed twice from the clean candidate tree.
- 114 web unit, component, API, persistence, security, CMS, operations, and
  automated accessibility tests passed.
- Three built-server HTML/route tests passed.
- All 270 packaged French audio clips matched the 270-word curriculum and had
  no clipped samples.
- Eight D1 migrations through `0007_crazy_living_tribunal` replayed against a
  fresh SQLite database; integrity, foreign keys, 15 tables, and 21 indexes
  passed.
- Production and complete dependency audits reported zero advisories.
- Production license metadata passed for 30 locked packages. Lockfile SHA-256:
  `746f3cba7129e6908a86a7c420643a1a26573807df777636e99e558fff16fb0a`.
- Secret scanning passed for 483 release files.
- The packaged-Worker gate passed and explicitly proved that the local-only
  development identity key is absent from release output.
- GitHub Node 22 and Node 24 release gates passed on the exact source commit.
- Local SwiftPM passed 13 `LoquivoCore` tests and 14 application integration
  tests.
- Local unsigned XCTest passed 14 integration and three UI tests on iPhone 17
  Pro, and 14 integration and three UI tests on iPad Pro 13-inch (M5).
- Local Staging and Release simulator builds passed.
- Local Apple toolchain: macOS 26.5.2, Xcode 26.6 build 17F113, iOS 26.5
  Simulator runtime. Commands used an explicit
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
- GitHub native CI uses Xcode 26.3 on the macOS 15 runner; the complete iPhone
  and iPad job passed.

## Deployment and smoke evidence

- Both existing D1 databases reported no pending migrations before deployment.
- Separate staging and production Workers use separate managed secrets and
  separate administrator access keys.
- Administrator access keys are stored in the Mac login Keychain as
  `Loquivo Staging Admin Access Key` and
  `Loquivo Production Admin Access Key`; temporary deployment secret files were
  deleted after upload.
- Turnstile widgets accept the new Loquivo hostnames and retain the previous
  hostnames for rollback.
- Staging and production returned HTTP 200 for the app shell, health endpoint,
  and authenticated anonymous-progress read.
- Both health responses reported version `1.1.0`, schema `0007`, and
  `productionReady: true`.
- Production delivered the Loquivo install manifest and packaged audio, issued
  the secure anonymous learner cookie, and returned CSP, HSTS,
  `X-Content-Type-Options`, and frame-denial headers.
- Production administrator login, authorized operations access, and logout
  passed with a secure session cookie.
- Production Turnstile reached “Security check complete” on the support form.
  No synthetic support message was submitted to the production queue.
- The `17 3 * * *` retention schedule is attached to both Workers. A naturally
  scheduled production invocation has not yet been observed.

## Interactive and visual QA

- Local and live Chrome passed desktop onboarding and the 390×844 responsive
  layout with no horizontal overflow.
- Local onboarding, dashboard, corrected new-learner review guard, first lesson,
  packaged pronunciation playback, dialog close/focus return, and saved status
  passed.
- Live staging and production rendered Loquivo metadata, install assets, legal
  navigation, and support protection.
- The current Loquivo `1.1.0` build `3` is installed and open on the local
  iPhone 17 Pro Simulator. The iPad test build also passed on the booted iPad Pro
  13-inch (M5) simulator.

## Hosting decision and exceptions

- Sites project creation was attempted once, but the workspace returned
  `Sites access disabled`. No project ID was invented. The repository's guarded
  direct Cloudflare Worker + D1 path was therefore used.
- Native API and Sign in with Apple remain intentionally disabled for this web
  release. App Store publication, signed archives, and TestFlight were
  explicitly deferred by the owner.
- No physical-device, Safari, Windows, Android, VoiceOver, or high-contrast
  session was available. Simulator, responsive-browser, automated WCAG, and
  keyboard evidence do not replace those human checks.
- A qualified French editor still needs to approve all French, IPA,
  translations, cultural claims, and pronunciation audio.
- Operator legal/counsel approval, external monitoring ownership, alert
  delivery testing, a real restore exercise, and observation of a scheduled
  retention run remain human operational launch gates.
- A custom Loquivo domain has not been purchased or connected; the production
  `workers.dev` URL is the current public origin.

## Decision

The exact candidate is **GO for technical web deployment and controlled
testing**. Broad public marketing and App Store distribution remain **NO-GO**
until the human linguistic, legal, physical-device, accessibility, monitoring,
and recovery gates above are signed off. This sole Loquivo Worker version is
retained as Paretto's rollback target; there is no older version inside the
Loquivo service to select.
