# Paretto release QA matrix

Every public release must complete the automated gate and the supported-device matrix.
Do not mark an unexecuted manual check as passed.

## Automated gate

- Unit tests for scheduling, sanitization, merging, streaks, and curriculum integrity.
- Component journey from onboarding through a five-card lesson and completion.
- Committed Playwright journeys in Chromium, Firefox, and WebKit for anonymous
  onboarding, complete learn and practice rounds, abandoned and completed
  Château Challenge attempts, persisted Travel Dice receipts, wordbook search,
  progress export/import, keyboard/dialog focus, offline-state messaging,
  account/support/recovery surfaces, 390×844 overflow, a 360×800 Android-sized
  journey at 200% text with reduced motion, and automated serious/critical
  accessibility violations. The browser gate builds the release artifact,
  applies every migration to an isolated local D1 store, and serves the built
  Worker over local HTTPS rather than relying on development HMR.
  On every local platform, browser TLS terminates at a disposable Node boundary
  that forwards to a direct Miniflare HTTP backend with a pinned HTTPS public
  URL and origin headers. The browser and Worker therefore observe the same
  secure URL, cookie, and CSRF contract without Wrangler's development proxy.
  The gate rejects HTTP metadata, validates secure auth cookies, proves the
  HTTPS runtime survives a deliberate plaintext probe, and retains per-run
  Miniflare lifecycle evidence.
- All current Worker-backed Chromium journeys run on a Windows Server 2022
  hosted runner, including secure-origin, fresh Paretto ID creation,
  recovery-code rotation/recovery, sign-in/claim, and deletion coverage. This
  catches Windows path, command-shell,
  process-lifecycle, and Chromium compatibility regressions. The Windows job
  retains HTTPS and uploads its Miniflare lifecycle evidence. Playwright
  force-terminates the disposable Windows process tree, so a successful Windows
  log may end at `runtime-ready` rather than the POSIX shutdown events. This is
  automation infrastructure evidence only; it does not certify Windows 11,
  Microsoft Edge, high contrast, Narrator, or a physical Windows device.
- A disposable local-D1 account journey creates a fresh public Paretto ID
  through the production account route, claims anonymous progress, saves and
  rotates one-time recovery codes, signs out, signs in from a second isolated
  browser context, recovers the account, verifies session revocation, and
  permanently deletes it. The local Worker uses an exact-action Turnstile test
  harness and an isolated database; it cannot send support email or access a
  remote database. Paretto ID creation and recovery do not require a learner
  email address.
- Chromium additionally installs the checked-in production service worker with
  `serviceWorkers: "allow"`, closes its disposable origin, and proves a cold
  navigation returns only the cached identity-free offline shell. Normal
  browser tests retain `serviceWorkers: "block"` for deterministic routing.
- Persistence tests for offline edits, failed saves, revision conflicts, retry, and deletion.
- API tests for identity, native Apple-token validation, native sessions/progress,
  validation, authorization, CMS publishing, server-enforced analytics consent,
  support intake, health, and database failure behavior.
- Clean lockfile install, TypeScript, lint, production build, rendered metadata,
  production and build-tool dependency audits, and production-license inventory.
- Packaged-artifact checks for Sites metadata, the Worker entry, D1 binding,
  migrations, install assets, audio manifest, observability, and the retention Cron.
- Fresh SQLite replay of every journaled migration, with intermediate quick checks,
  final integrity and foreign-key checks, schema table/index drift detection,
  and populated pre-0011 CMS fixtures proving that revisions, aliases, and slug
  tombstones retain their IDs under the default course during table rebuilds.
- Swift 6 tests for the shared core and complete app package; unsigned XCTest
  for the explicit Staging configuration and Debug iPhone/iPad journeys; and an
  unsigned Release build whose app bundle is checked for the privacy manifest,
  production API origin, and all 270 WAV files in the resource directory used
  by the native audio player.
- Static checks for duplicate IDs, invalid regions, malformed IPA, missing examples,
  missing audio manifest entries, legal-route availability, service-worker
  registration timing, and the identity-free offline navigation fallback.

## Core journeys

Test with keyboard only, touch-sized viewport, reduced motion, analytics both off and on,
and a simulated offline transition:

1. New learner onboarding and optional analytics choice.
2. First five-card lesson, pronunciation, reveal, three ratings, mark-known, and completion.
3. Anonymous-to-account progress claim, sign-out, second-browser sign-in and
   signed-in progress restoration, followed by permanent account deletion.
4. Concurrent edit conflict and merge without duplicate rewards.
5. Learned-card practice, abandoned and completed Château Challenge attempts,
   reward-free replay, persisted Travel Dice receipts, and collection unlocks.
6. Journey progression and multiple lessons within one expanded regional chapter.
7. Wordbook search with and without accents, card opening, and every
   part-of-speech filter.
8. Audio asset success, network failure fallback, disabled audio, and rapid repeated play.
9. Progress export, import/restore, learning-data deletion, and account deletion.
10. Support submission and status visibility.
11. Non-admin denial for every admin page and API; administrator draft and
    validation; same-actor review/publish denial under the one-admin launch
    allowlist; compiled-curriculum fallback; revision conflict; and audit history.
12. Analytics opt-in ingestion, server-side opt-out enforcement, property rejection, and retention.
13. Legal-hold creation/release, held-record preservation, bounded manual retention,
    and operator audit events.
14. Native debug guest use, Sign in with Apple, offline relaunch, two-device sync
    conflict, export, account deletion, and expired-session recovery.

## Device and browser matrix

| Platform | Browser | Viewports / modes | Required result |
| --- | --- | --- | --- |
| macOS current | Safari current | 1440×900, keyboard, VoiceOver spot check | Core journeys pass |
| macOS current | Chrome current | 1440×900, 400% zoom | Core journeys pass |
| Windows 11 | Edge current | 1366×768, keyboard, high contrast | Core journeys pass |
| Windows 11 | Firefox current | 1366×768, 200% zoom | Core journeys pass |
| iPhone current iOS | Safari | 390×844, portrait/landscape, VoiceOver spot check | No clipping; lesson usable |
| iPhone supported-oldest iOS | Safari | small-screen portrait | Core lesson and legal pages pass |
| iPad current iPadOS | Safari | portrait/landscape, split view | Layout and dialogs pass |
| Android current | Chrome | 360×800 and large text | Core journeys pass |
| Android current | Firefox | 360×800 | Core lesson and audio fallback pass |

The native iOS target additionally requires a full Xcode version compatible
with the release macOS and App Store upload rules, then XCTest on the oldest
supported iOS 17 simulator plus current iPhone and iPad simulators,
portrait/landscape, Dynamic Type through accessibility sizes, VoiceOver,
reduced motion, offline relaunch, and a signed staging archive before
TestFlight. The local release workstation currently uses Xcode 26.6
(17F113), macOS 26.5.2, and the iOS 26.5 Simulator runtime.

Playwright WebKit is a release regression gate, not evidence of testing the
shipping Safari application, VoiceOver, a physical iPhone/iPad, or Apple GPU and
input behavior. Keep those manual rows unexecuted until they are actually run.
Likewise, hosted Windows Chromium automation is not evidence for the Windows 11
Edge or Firefox manual rows, high contrast, Narrator, or physical hardware.

### Interactive execution — 20 July 2026

| Environment | Evidence | Result |
| --- | --- | --- |
| macOS Chrome extension session | Actual 1470×758 window plus controlled 1440×900 viewport; onboarding, full lesson, packaged audio, progression, wordbook, review/challenge, profile, legal/support, and admin journeys | Passed; actual 400% browser zoom remains unexecuted |
| Chrome responsive emulation | 320×568, 360×800, 390×844, 480×900, 768×1024, and 844×390; learner and admin layouts, mobile navigation/profile, full-screen lesson dialog, and CTA clickability | Passed with no horizontal overflow; this is not physical-device evidence |
| Keyboard and preference spot checks | Skip-link focus/activation, Escape close with focus return, reduced-motion toggle/restore | Passed in Chrome |
| Safari, Edge, Firefox, physical mobile/tablet, VoiceOver, high contrast | No connected session for these environments | Unexecuted; do not mark passed |

## Accessibility acceptance

- WCAG 2.2 AA contrast for text, focus, controls, status, and region-themed panels.
- One logical page heading; landmarks and labels announced meaningfully.
- Focus never enters inert dialog background and returns to the invoking control.
- No keyboard trap except the intentional modal cycle; Escape closes dialogs.
- At 200% zoom and 320 CSS pixels, no two-dimensional scrolling for core content.
- Status changes do not steal focus and are conveyed without color alone.
- Reduced-motion preference removes nonessential animation.
- Audio is never required to answer and visible text always remains available.

## Release evidence

Record date, commit SHA, tester, environment, results, defects, screenshots where useful,
and the production smoke-test URL. A release is blocked by any open data-loss,
authorization, payment, legal-consent, inaccessible-core-flow, or reproducible crash bug.
