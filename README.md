# Pas à Pas

Pas à Pas is a full-stack French vocabulary app built around short, recall-first lessons and a journey through all 18 administrative regions of France.

## Product surface

- Five-card guided lessons with French pronunciation, IPA, gender, and examples
- Seven-stage spaced repetition with adaptive review queues
- An 18-region journey containing 90 curated words
- Château recall challenges, transparent travel-dice rewards, postcards, XP, coins, streaks, and a private league
- Searchable wordbook with accent-insensitive lookup and mastery filters
- Responsive desktop and mobile navigation, reduced-motion support, keyboard focus states, and semantic dialogs
- Per-user Cloudflare D1 progress with conflict-safe merges, a durable offline queue, and explicit sync status
- Keyboard-contained dialogs, high-contrast regional art, data export, and permanent progress deletion

## Local development

Requires Node.js 22.13 on the Node 22 LTS line, or Node.js 24 and newer.

```bash
npm install
npm run dev
```

The local app runs at `http://localhost:3000`. D1 is simulated by Wrangler through the `DB` binding declared in `.openai/hosting.json`.

## Quality checks

```bash
npm run lint
npx tsc --noEmit
npm test
```

`npm test` runs engine and API tests, offline/conflict/delete regressions, a complete onboarding/first-lesson interaction test, a production build, and server-rendered metadata checks.

## Data and deployment

- `db/schema.ts` and `drizzle/` define the D1 persistence schema.
- `app/api/progress/route.ts` owns revision-safe progress reads and writes.
- `app/api/health/route.ts` provides a database-backed health check.
- `.openai/hosting.json` is the Sites deployment manifest.

Production identity is provided by the hosting platform through the `oai-authenticated-user-email` request header. Anonymous localhost requests use an isolated preview identity.
Production must also define a secret `USER_KEY_SECRET` value of at least 32 characters; the API uses it to derive a keyed account identifier without storing raw email addresses.
