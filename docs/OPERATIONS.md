# Pas à Pas operations runbook

This runbook defines the production checks, alert thresholds, recovery actions,
and ownership expectations for the Pas à Pas web application.

## Service objectives

- Availability target: 99.9% successful non-admin requests per rolling 30 days.
- API latency target: 95% of progress reads and writes below 500 ms at the edge.
- Data durability target: no acknowledged progress update may be silently replaced
  by an older revision.
- Recovery target: restore service within 60 minutes for a database or deployment
  incident; restore the last verified curriculum version within 15 minutes.
- Data-loss target: no more than the hosting provider's documented backup window.
  Confirm the real D1 backup and point-in-time recovery policy before public launch.

These are targets, not claims about measured production performance before a live
deployment and monitoring history exist.

## Required production configuration

| Setting | Purpose | Rule |
| --- | --- | --- |
| `USER_KEY_SECRET` | HMACs signed-in emails before database access | Secret, random, at least 32 characters; never store in Git |
| `ADMIN_EMAILS` | Server-side CMS allowlist | Comma-separated normalized administrator emails; least privilege |
| `APPLE_CLIENT_ID` | Verifies native Sign in with Apple identity-token audience | Exact registered iOS bundle identifier or Services ID |
| `APPLE_TEAM_ID` | Issues the server client-secret JWT | Exact 10-character Apple Developer Team ID |
| `APPLE_KEY_ID` | Selects the Sign in with Apple private key | Exact 10-character key ID for the active `.p8` key |
| `APPLE_PRIVATE_KEY` | Signs Apple token-exchange and revocation requests | Full PKCS#8 `.p8` value in managed secret storage; never commit or log it |
| `APPLE_TOKEN_ENCRYPTION_SECRET` | Encrypts Apple refresh tokens stored in D1 | Independent random secret, at least 32 characters; never store in Git |
| `NATIVE_SESSION_SECRET` | HMACs native access tokens and Apple subject identifiers | Independent random secret, at least 32 characters; never store in Git |
| `DB` | D1 database binding | Provision through hosting and apply every checked-in migration |
| Daily Cron Trigger | Automatic privacy retention | Deploy `17 3 * * *` from the checked-in Worker configuration and verify the scheduled-run log |

Rotate `USER_KEY_SECRET` only with a migration plan. Changing it without migrating
account keys makes existing progress unreachable. Review `ADMIN_EMAILS` quarterly
and immediately after access or employment changes. Rotating
`NATIVE_SESSION_SECRET` revokes every native session and also changes the derived
native account key, so perform it only with an account migration or a documented
emergency sign-out plan.
Rotate the Apple private key by adding the replacement in Apple Developer,
deploying its key ID and private key together, verifying exchange and revocation,
and only then revoking the old key. Rotating `APPLE_TOKEN_ENCRYPTION_SECRET`
without re-encrypting every stored refresh token prevents server-side Apple
revocation during account deletion and is not an ordinary secret rotation.

## Release procedure

1. Review the exact Git diff and confirm no secrets, generated caches, or local data.
2. Install from the committed lockfile with `npm ci`, then run
   `npm run release:verify`. The same gate must pass in GitHub Actions on supported
   Node 22 and Node 24; the native Swift package and unsigned iOS Simulator jobs
   must pass on macOS as well. Attach the CI run to the release evidence; do not
   substitute a result from an uncommitted working tree.
3. Inspect the generated SQL migration. Apply it to a staging database before
   production whenever the hosting surface supports staging.
   A new environment requires every entry in `drizzle/meta/_journal.json`, in
   ascending `idx` order. Treat that journal as authoritative rather than copying
   a migration list into release instructions; `npm run release:artifact` rejects
   missing, unjournaled, non-contiguous, or differently packaged migrations.
4. Smoke-test health, web and Apple sign-in, first lesson, review, web and native progress conflict handling,
   admin authorization, draft/publish, audio fallback, analytics consent, support,
   export, and deletion.
5. Save the exact pushed commit as a release version and deploy only that version.
6. Verify `/api/health` reports `productionReady: true`, the home page, legal
   pages, and one authenticated progress cycle from the production URL. Confirm
   the daily retention trigger appears in the deployed Worker configuration and
   observe one successful scheduled run.
7. Copy `docs/RELEASE-EVIDENCE-TEMPLATE.md` and record the commit, CI run,
   migrations, deployment URL, operator, production checks, and go/no-go result.

## Supply-chain controls

- `package-lock.json` is authoritative. CI and release validation use `npm ci`;
  do not deploy a dependency graph produced by an uncommitted lockfile.
- CI actions are pinned to full commit SHAs with read-only repository permission
  and no persisted checkout credential. Dependabot checks npm and Actions weekly;
  dependency pull requests must pass the complete release gate.
- Both `npm audit --omit=dev --audit-level=low` and
  `npm audit --audit-level=low` are release gates. The first protects the runtime
  graph; the second also protects build, lint, migration, and test tooling.
- `@babel/core`, `js-yaml`, and the legacy esbuild used by Drizzle's loader are
  constrained to patched forward versions through package overrides. Review these
  overrides with every Drizzle/ESLint upgrade and remove them once upstream ranges
  resolve to patched versions naturally. Do not use `npm audit --force` or resolve
  a finding by downgrading a release tool without an explicit compatibility review.
- `npm run licenses:verify` requires license metadata for every locked production
  package and prints the lockfile SHA-256 for evidence. This is an inventory gate,
  not legal approval or a replacement for preserving required license notices.
- `npm run release:artifact` compares packaged migrations and manifests byte for
  byte with source and verifies the Worker entry, install assets, D1 binding,
  observability, and daily retention trigger before a Sites version is saved.
  This packaging check reports the local D1 placeholder explicitly; it is not
  evidence that Sites provisioned the database or that the live binding works.
- `npm run db:verify` replays the authoritative journal into a fresh temporary
  SQLite database, checks every intermediate migration, runs final integrity and
  foreign-key checks, rejects schema table/index drift, and confirms that the
  health endpoint advertises the newest journal revision.
- `npm run version:verify` keeps the package, lockfile, health response, XcodeGen
  source, and generated Xcode project on one release version/build. Create the
  matching `v<version>` tag only from the committed SHA that passed every gate.

## Monitoring and alerts

Probe `/api/health` every minute from at least two regions once external monitoring
is connected. Alert when any condition holds:

- three consecutive health failures;
- 5xx responses exceed 2% for five minutes;
- progress write conflicts exceed 10% for fifteen minutes;
- p95 progress latency exceeds 1.5 seconds for ten minutes;
- support intake or admin publishing returns any sustained 5xx response;
- a deployment fails or a database migration is incomplete;
- Apple identity verification or native-session lookup fails broadly;
- product-event ingestion grows unexpectedly, a scheduled retention run is
  missed, or retention cleanup logs a failure.

Logs are structured JSON. API completion logs carry route, status, latency, and
the same request identifier returned in the response; error events carry an
event name and timestamp. Never log raw email addresses, progress payloads,
support bodies, secrets, or authentication headers.

## Incident response

### Severity definitions

- **SEV-1:** data loss, cross-account access, secret exposure, or service unavailable
  to most learners.
- **SEV-2:** progress cannot save, sign-in fails broadly, published curriculum is
  materially wrong, or a core lesson flow is unusable.
- **SEV-3:** degraded audio, analytics, support, admin, or limited-device behavior.

### First actions

1. Name an incident lead and record the start time and observed impact.
2. Stop risky writes or publishing. Do not destroy evidence.
3. Roll back to the last verified application version when the regression is in code.
4. For data issues, take or verify a backup before repair and preserve affected rows.
5. For suspected account or secret exposure, restrict access and rotate only the
   affected credential. Remember that rotating `USER_KEY_SECRET` requires an
   account-key migration.
6. Communicate what is affected, safe workarounds, and the next update time.

### Progress-sync incident

- Confirm D1 readiness from `/api/health`.
- Compare 409 conflict rate with 5xx rate. Conflicts are normally recovered client-side;
  5xx responses indicate unavailable persistence.
- Preserve offline clients: never instruct learners to clear site data until queued
  progress has synchronized or been exported.
- Restore write service first, then validate merge behavior with two revisions.

### Bad curriculum publication

- Unpublish or supersede the affected CMS record; do not edit the audit trail.
- In Admin → Curriculum, restore the last approved immutable snapshot as a new
  draft, review it, and then republish it.
- Identify affected word IDs and whether learner scheduling is impacted.
- Correct content without reusing a deleted ID for a different word.

## Backup and recovery

- Enable the hosting provider's supported D1 backup or point-in-time recovery before
  admitting public learners.
- Exercise a restore into a non-production database at least quarterly.
- Verify row counts, a sample progress record, published CMS content, support status,
  analytics retention, and audit history after restoration.
- Keep database recovery credentials separate from application runtime credentials.

## Privacy and retention operations

- Product analytics are opt-in and become deletion-eligible 400 days after receipt.
- Event ingestion checks the saved server-side preference before accepting an
  event; a client-side flag alone never authorizes analytics storage.
- Resolved or closed support requests and admin audit records become
  deletion-eligible after 730 days unless security or legal preservation applies.
- The Worker runs one transactional, per-class batch of at most 500 rows daily
  at 03:17 UTC. A
  throttled request-time attempt is a fallback and never changes an accepted
  analytics response into a failure. The Admin → Operations panel reports due
  eligible counts and can run the same bounded batch manually. Every manual run
  records an immutable start event before deletion and a completion event with
  its operator, run ID, limit, and deletion counts. Failed or incompletely
  audited attempts receive a separate failure event for investigation.
- Admin → Operations can create record/user/entity-specific or class-wide legal
  holds. Active holds are excluded from automatic and manual deletion. Creating
  or releasing a hold requires a reason and creates an immutable audit event.
- Expired/revoked native sessions and consumed Apple identity-token replay guards
  are removed in the same bounded maintenance cycle; they are not product analytics.
- Alert on `scheduled_retention_failed`, verify the Cron Trigger after every
  deployment, and clear any expired backlog after an outage before closing the
  incident. Record the run result in the release or incident log.
- A learning-data deletion removes the primary progress record and local offline copy;
  support and audit records are separate and must follow their own retention rules.
- Fulfill verified privacy requests through the support workflow and record completion
  without copying sensitive request content into logs.

## Post-incident review

Within five working days for SEV-1/2 incidents, document impact, timeline, root cause,
contributing conditions, recovery, detection gaps, and assigned preventive actions.
Focus on system improvement rather than individual blame.
