# Pas à Pas

Pas à Pas is a full-stack French vocabulary app built around short, recall-first lessons and a journey through all 18 administrative regions of France.

## Product surface

- Five-card guided lessons with French pronunciation, IPA, gender, and examples
- Seven-stage spaced repetition with adaptive review queues
- An 18-region, 54-lesson A1–A2 journey containing 270 curated words
- Packaged French production audio for every curriculum card, with an accessible
  playback control and browser speech fallback
- Château recall challenges, transparent travel-dice rewards, postcards, XP, coins, and streaks
- Searchable wordbook with accent-insensitive lookup and mastery filters
- Responsive desktop and mobile navigation, reduced-motion support, keyboard focus states, and semantic dialogs
- Per-user Cloudflare D1 progress with conflict-safe merges, a durable offline queue, and explicit sync status
- An identity-free cold-offline reconnect page; authenticated HTML and API responses are never cached
- Keyboard-contained dialogs, high-contrast regional art, data export, and permanent progress deletion
- A revision-safe administration CMS, learner-support queue, privacy-preserving
  server-verified opt-in analytics, operational readiness checks, bounded retention,
  and audited legal-hold controls
- A separate SwiftUI iPhone/iPad project with native offline progress, lessons,
  review, wordbook, reminders, Sign in with Apple, cloud sync, export, and deletion

## Local development

Requires Node.js 22.13 on the Node 22 LTS line, or Node.js 24 and newer.

```bash
npm install
npm run dev
```

The local app runs at `http://localhost:3000`. D1 is simulated by Wrangler through the `DB` binding declared in `.openai/hosting.json`.

For the guarded direct-Cloudflare fallback, start with
`docs/PRODUCTION-INFRA.md`. Environment-specific Wrangler files are generated
locally from checked-in templates only after Cloudflare returns real staging and
production D1 IDs. Bare `wrangler deploy` is intentionally unsupported because
the normal build artifact contains a Sites-only placeholder binding.

The native project is generated at `ios/PasAPas/PasAPas.xcodeproj`. See
`ios/PasAPas/README.md` for Xcode, simulator, and environment instructions. Its
shared learning engine can be verified without Xcode using
`swift test --package-path ios/PasAPasCore`.

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

The first public web release uses an origin-bound, 256-bit anonymous learner
cookie. The API HMACs that token with `USER_KEY_SECRET`, so raw cookie values and
email addresses are not stored in D1. Progress is browser-specific until a public
account and cross-device sync system is enabled. Administration uses one
allowlisted email, a generated high-entropy access key, a one-way
`ADMIN_PASSWORD_VERIFIER`, login throttling, and an eight-hour signed cookie.
Support submissions are protected by server-verified Cloudflare Turnstile.

Native sync and Sign in with Apple remain implemented behind
`NATIVE_API_ENABLED=false`; their Apple and native-session credentials are not
required for this web launch. The production deployment contract and exact
staging/production commands are in `docs/PRODUCTION-INFRA.md`.

The production service worker caches only public application assets, requested
pronunciation audio, and `offline.html`. It always fetches learner navigations
from the network and uses the static offline page only when that navigation
cannot connect, so a cold offline launch never exposes cached learning HTML.
