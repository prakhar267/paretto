# Paretto

Paretto is a game-inspired language-learning platform launching with a
structured 270-word A1–A2 French foundation built around short, recall-first
lessons and a journey through all 18 administrative regions of France.

## Product surface

- Five-card guided lessons with French pronunciation, IPA, gender, and examples
- Seven-stage spaced repetition with adaptive review queues
- An 18-region, 54-lesson A1–A2 journey containing 270 structured words
- Course-scoped curriculum, CMS, progress, export, and audio identities so
  additional language pairs can be added without reusing French learner IDs;
  French-from-English is the only published course in this release
- Packaged French audio for every curriculum card, with automated signal and
  licence checks, an accessible playback control, and browser speech fallback;
  native-speaker pronunciation approval remains a human launch gate
- Château recall challenges, transparent travel-dice rewards, postcards, XP, coins, and streaks
- Searchable wordbook with accent-insensitive lookup and mastery filters
- Responsive desktop and mobile navigation, reduced-motion support, keyboard focus states, and semantic dialogs
- Per-user Cloudflare D1 progress with conflict-safe merges, a durable offline queue, and explicit sync status
- Optional email/password learner accounts with email verification, password
  recovery, anonymous-progress claiming, cross-browser synchronization,
  sign-out, and account deletion
- An identity-free cold-offline reconnect page; authenticated HTML and API responses are never cached
- Keyboard-contained dialogs, high-contrast regional art, progress export and
  restore, and permanent progress/account deletion
- A revision-safe administration CMS, learner-support queue, privacy-preserving
  server-verified opt-in analytics, operational readiness checks, bounded retention,
  and audited legal-hold controls
- A separate SwiftUI iPhone/iPad project with native offline progress, lessons,
  review, wordbook, reminders, Sign in with Apple, cloud sync, export, and
  deletion; App Store distribution and production Apple credentials remain
  separate release gates

## Local development

Requires Node.js 22.13 on the Node 22 LTS line, or Node.js 24 and newer.

```bash
npm install
npm run dev
```

The local app runs at `http://localhost:3000`. D1 is simulated by Wrangler
through the `DB` binding declared in `.openai/hosting.json`; development mode
also supplies explicitly local-only learner-identity, support-rate-limit, and
authentication-rate-limit keys so a fresh checkout can complete onboarding,
exercise support, and test account flows without production secrets. These
values exist only in the local Vite/Miniflare
configuration and must never be copied into staging or production.

For the guarded direct-Cloudflare fallback, start with
`docs/PRODUCTION-INFRA.md`. Environment-specific Wrangler files are generated
locally from checked-in templates only after Cloudflare returns real staging and
production D1 IDs. Bare `wrangler deploy` is intentionally unsupported because
the normal build artifact contains a Sites-only placeholder binding.

The native project is generated at `ios/Paretto/Paretto.xcodeproj`. See
`ios/Paretto/README.md` for Xcode, simulator, and environment instructions. Its
shared learning engine can be verified without Xcode using
`swift test --package-path ios/ParettoCore`.

## Quality checks

```bash
npm ci
npm run release:verify
```

`release:verify` is the web gate used by CI. It runs TypeScript, lint, complete
production and build-tool dependency audits, production-license metadata checks,
engine and API tests, CMS publication-integrity checks, offline/conflict/delete
regressions, automated WCAG A/AA scans, the onboarding/first-lesson journey,
audio verification, a production build, rendered-route checks, and validation of
every migration against a fresh SQLite database plus the packaged Sites Worker,
bindings, and scheduled trigger. CI also runs both Swift package suites and the
native XCTest suite on an unsigned iOS Simulator build with Xcode 26.3.

## Data and deployment

- `db/schema.ts` and `drizzle/` define the D1 persistence schema.
- `app/api/progress/route.ts` owns revision-safe progress reads and writes.
- `app/api/health/route.ts` provides a database-backed health check.
- `app/api/native/` provides Apple authentication, native sessions, sync, and account deletion.
- `.openai/hosting.json` is the Sites deployment manifest.
- `docs/OPERATIONS.md`, `docs/RELEASE-QA.md`, and
  `docs/LEGAL-LAUNCH-CHECKLIST.md` define the production runbook and launch gates.
- `docs/APP-STORE-LAUNCH.md` and `docs/PRODUCTION-INFRA.md` cover native submission
  inputs and a free-start operations topology.

Every browser begins with an origin-bound, 256-bit anonymous learner cookie.
The API HMACs that token with `USER_KEY_SECRET`, so raw cookie values are not
stored in learning tables. A learner can create an account and atomically claim
that browser journal; account-derived keys then synchronize progress across
supported browsers. Administration uses an allowlist, generated high-entropy
access keys, either a single one-way `ADMIN_PASSWORD_VERIFIER` or an exact
per-email `ADMIN_PASSWORD_VERIFIERS` map, login throttling, and an eight-hour
signed cookie. Public CMS publishing requires separate author and approver
administrators with distinct access keys.
Support submissions are protected by server-verified Cloudflare Turnstile plus
an hourly opaque IP quota HMACed under an independent
`SUPPORT_RATE_LIMIT_SECRET`; raw IP addresses never enter the limiter table.
Account endpoints use Better Auth&apos;s route-specific limits through a separate,
atomic D1 counter HMACed under `BETTER_AUTH_RATE_LIMIT_SECRET`; its table never
stores the raw client IP, auth path, or submitted email.

Native sync and Sign in with Apple remain implemented behind
`NATIVE_API_ENABLED=false`; their Apple and native-session credentials are not
required for this web launch. The production deployment contract and exact
staging/production commands are in `docs/PRODUCTION-INFRA.md`.

The production service worker caches only public application assets, requested
pronunciation audio, and `offline.html`. It always fetches learner navigations
from the network and uses the static offline page only when that navigation
cannot connect, so a cold offline launch never exposes cached learning HTML.
