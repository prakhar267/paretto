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

Production identity is provided by the hosting platform through the `oai-authenticated-user-email` request header. Anonymous localhost requests use an isolated preview identity.
Production must also define a secret `USER_KEY_SECRET` value of at least 32 characters; the API uses it to derive a keyed account identifier without storing raw email addresses.
Native sync additionally requires `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`,
`APPLE_KEY_ID`, the corresponding managed-secret `APPLE_PRIVATE_KEY`, and
independent `NATIVE_SESSION_SECRET` and `APPLE_TOKEN_ENCRYPTION_SECRET` values
of at least 32 characters. The server exchanges Apple's one-time authorization
code, encrypts the returned refresh token, and revokes it before account deletion.
Native sign-out calls `DELETE /api/native/session` to revoke the current hashed
server session before clearing the device Keychain; local clearing still proceeds
if the device is offline.

The production service worker caches only public application assets, requested
pronunciation audio, and `offline.html`. It always fetches signed-in navigations
from the network and uses the static offline page only when that navigation
cannot connect, so a cold offline launch never exposes cached account HTML.
