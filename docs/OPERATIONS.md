# Paretto operations runbook

This runbook defines the production checks, alert thresholds, recovery actions,
and ownership expectations for the Paretto web application.

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
| `USER_KEY_SECRET` | HMACs anonymous learner-session tokens before database access | Independent 256-bit random secret; never store in Git |
| `SUPPORT_RATE_LIMIT_SECRET` | HMACs Cloudflare-provided client IPs into opaque support-abuse buckets | Independent 256-bit random secret; never reuse `USER_KEY_SECRET` or store it in Git |
| `BETTER_AUTH_RATE_LIMIT_SECRET` | HMACs Better Auth&apos;s ephemeral IP-and-route key into opaque authentication-abuse buckets | Independent 256-bit random secret; never reuse any learner, support, auth-signing, or administrator secret |
| `BETTER_AUTH_SECRET` | Signs and encrypts learner-account authentication state | Independent random secret of at least 32 characters; never reuse `USER_KEY_SECRET` |
| `BETTER_AUTH_URL` | Pins authentication callbacks and trusted origin | Exact HTTPS origin for the matching staging or production Worker |
| `LAUNCH_MODE` | Selects the enforced readiness contract | Exactly `controlled-beta` or `public`; never infer readiness from missing delivery settings |
| `RESEND_API_KEY` | Delivers learner verification, recovery, and queued support email | Required in `public`; deliberately absent in `controlled-beta` |
| `AUTH_EMAIL_FROM` | Verified transactional sender identity | Required in `public` as `Paretto <accounts@verified-domain>`; empty in `controlled-beta` |
| `SUPPORT_NOTIFICATION_EMAIL` | Receives new-ticket notifications | Required in `public`; empty in `controlled-beta`, where tickets remain in the authenticated admin queue |
| `ADMIN_EMAILS` | Server-side CMS allowlist | One normalized email for a controlled compiled-curriculum beta, or 2–25 unique comma-separated emails when CMS publishing is enabled |
| `ADMIN_PASSWORD_VERIFIER` | Verifies the one administrator access key without storing it | Single-admin only: `sha256$` plus the 43-character base64url SHA-256 digest; managed secret |
| `ADMIN_PASSWORD_VERIFIERS` | Maps each allowlisted administrator to a distinct access-key verifier | Multi-admin only: compact canonical JSON whose keys exactly match `ADMIN_EMAILS`, in order; each value uses the `sha256$…` format |
| `ADMIN_SESSION_SECRET` | Signs eight-hour administrator session cookies and hashes login IPs | Independent 256-bit random managed secret |
| `TURNSTILE_SITE_KEY` | Renders the support-form abuse challenge | Public site key for the environment's exact hostnames |
| `TURNSTILE_SECRET` | Verifies support challenges server-side | Matching managed secret; never store in Git or browser code |
| `NATIVE_API_ENABLED` | Controls native Apple-account API readiness | Set to the string `false` for this web release |
| `DB` | D1 database binding | Provision through hosting and apply every checked-in migration |
| Daily Cron Trigger | Automatic privacy retention | Deploy `17 3 * * *` from the checked-in Worker configuration and verify the scheduled-run log |

Rotate `USER_KEY_SECRET` only with a migration plan. Changing it without migrating
anonymous account keys makes existing progress unreachable. Review `ADMIN_EMAILS`
quarterly and immediately after an access change. A one-admin controlled beta
must use `ADMIN_PASSWORD_VERIFIER`; a publishing environment with two or more
administrators must use `ADMIN_PASSWORD_VERIFIERS`, and the deployment gate
rejects a missing, duplicate, reordered, or extra mapping. Rotate an
administrator access key by generating a new 256-bit value, replacing only that
email&apos;s verifier, testing login, and then deleting the old key from the
password manager. Rotating
`ADMIN_SESSION_SECRET` immediately signs out every administrator. Rotate a
Turnstile widget key pair together and verify a real support submission afterward.
Rotate `SUPPORT_RATE_LIMIT_SECRET` separately during a controlled release; rotation
starts fresh opaque IP quota buckets and must never change learner identity keys.
Rotate `BETTER_AUTH_RATE_LIMIT_SECRET` separately; rotation starts fresh
authentication quota buckets. A missing, short, or reused value makes
production health non-ready and account endpoints fail closed.

Apple and native-session values are intentionally absent while
`NATIVE_API_ENABLED=false`. When native cloud sync is scheduled, use the separate
App Store runbook and add those credentials only after a reviewed native
authentication launch.

## Release procedure

1. Review the exact Git diff and confirm no secrets, generated caches, or local data.
2. Install from the committed lockfile with `npm ci`, then run
   `npm run release:verify`. The same gate must pass in GitHub Actions on supported
   Node 22 and Node 24; Playwright must pass its critical journeys independently
   in Chromium, Firefox, and WebKit against the built Worker, migrated local D1,
   and local HTTPS; and the native Swift package and unsigned iOS Simulator jobs
   must pass on macOS as well. Attach the CI run to the release evidence; do not
   substitute a result from an uncommitted working tree. The hosted Linux
   browser gate may repeat the complete isolated Playwright invocation once only
   when its output contains the exact unexpected-Wrangler-exit marker. It must
   not retry an assertion or product failure, and a second failure remains
   blocking. Retain the sanitized per-browser Wrangler diagnostics with the
   Playwright evidence so a runtime retry is visible and reviewable.
3. Inspect the generated SQL migration. Apply it to a staging database before
   production whenever the hosting surface supports staging.
   A new environment requires every entry in `drizzle/meta/_journal.json`, in
   ascending `idx` order. Treat that journal as authoritative rather than copying
   a migration list into release instructions; `npm run release:artifact` rejects
   missing, unjournaled, non-contiguous, or differently packaged migrations.
   For direct Cloudflare, create ignored configurations with
   `npm run cloudflare:prepare`, run the matching
   `cloudflare:verify:<environment>` gate, and only then run
   `cloudflare:migrate:<environment>`. Never run a bare `wrangler deploy` or
   deploy `dist/server/wrangler.json`; it carries the local Sites placeholder ID.
4. In staging, test health, a fresh anonymous learner session, first lesson, review,
   web progress conflict handling, admin login/logout and throttling,
   administrator draft/validation, same-actor review and publish denial, the
   verified compiled-curriculum fallback, audio fallback, analytics consent,
   Turnstile-protected support, export, and deletion. Native/Apple checks are
   out of scope while `NATIVE_API_ENABLED=false`.
5. Save the exact pushed commit as a release version and deploy only that version.
   Prefer the manual `Deploy Cloudflare release` workflow with the protected
   `staging` or `production` GitHub Environment. Staging accepts `main` or a
   `v*` tag. Production requires the exact release tag, a successful complete
   seven-job `CI` workflow for that tag's commit SHA, proof that the SHA is
   reachable from `main`, and protected-tag policy. A team-operated or public
   launch should also require independent environment approval with
   administrator bypass disabled. An explicitly owner-operated controlled beta
   may omit that human approval only when the release evidence names the owner,
   records the single-account governance decision, and does not weaken the
   exact-SHA CI, tag, ancestry, backup, or smoke gates. This exception does not
   permit a CMS author to approve their own content. Before the protected
   deployment job can access any environment secrets, the exact-SHA CI/ancestry
   precondition and a secret-free matrix must pass the built,
   isolated Worker journeys in Chromium, Firefox, and WebKit. The deployment job
   then validates all scoped variables/secrets and reruns the release gate.
   A production run must capture a current D1 Time Travel bookmark and full
   export, encrypt the export with the production-only backup passphrase, and
   successfully upload the seven-day recovery artifact before it can apply any
   migration. It then deploys and cannot complete without the final read-only
   smoke gate. Select `controlled-beta` or `public` explicitly in the workflow;
   the default is the narrower controlled beta.
6. Run `npm run smoke:deployment -- https://<exact-origin> --mode <controlled-beta|public>`
   and retain its JSON result. Omitted mode means strict `public`, so a controlled
   beta cannot accidentally be accepted as a public launch. It uses GET only and
   verifies the selected readiness contract, the public app,
   account entry/recovery pages, legal/support routes, install assets, and one audio
   asset. Separately perform one authenticated progress cycle because the
   automated production smoke deliberately creates no learner, support, admin,
   or analytics records. Confirm the daily retention trigger appears in the
   deployed Worker configuration and observe one successful scheduled run.
7. Copy `docs/RELEASE-EVIDENCE-TEMPLATE.md` and record the commit, CI run,
   migrations, deployment URL, operator, production checks, and go/no-go result.

Before a production D1 migration, capture both the current Time Travel bookmark
and a portable export in an access-controlled ignored directory:

```sh
npx wrangler d1 time-travel info DB \
  --config wrangler.production.jsonc
npx wrangler d1 export DB \
  --remote --config wrangler.production.jsonc \
  --output work/d1-production-before-release.sql
```

An export blocks database requests while it runs, so schedule it before admitting
public users or during a maintenance window. Time Travel is automatic; restoring
it overwrites the live database and remains a separately approved destructive
incident action.

The protected production workflow enforces the same sequence. Configure
`D1_BACKUP_ENCRYPTION_PASSPHRASE` as an independent production GitHub
Environment secret of at least 32 characters. The workflow encrypts the SQL
export with AES-256-CBC and PBKDF2-SHA256, compares the decrypted bytes exactly,
restores that result into isolated SQLite, checks integrity, foreign keys,
contiguous migration history and migrated schema, and records both plaintext
and ciphertext checksums in the manifest. It uploads only the encrypted export
plus recovery metadata. A failed capture, exact round-trip, restore validation,
or artifact upload prevents migration. The artifact expires after seven days;
copy it promptly to the approved backup store when longer retention is required,
and keep the passphrase in a separate secret manager. Never attach an
unencrypted D1 export to release evidence. This automated logical restore is a
pre-migration guard; the quarterly provider-level non-production D1 restore
exercise remains required.

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

The checked-in `Monitor production health` GitHub Actions workflow is an
independent six-hourly controlled-beta probe sized to avoid exhausting a
private GitHub Free Actions allowance (about 120 rounded Linux minutes per
30-day month, before manual runs). Set the repository variable
`PRODUCTION_APP_ORIGIN` to the exact public HTTPS origin and
`PRODUCTION_LAUNCH_MODE` to the deployed `controlled-beta` or `public` contract.
An absent monitor mode defaults to strict `public`. A failed probe opens
or updates one deduplicated GitHub issue, and a later successful probe records
recovery and closes it. Before launch, run the workflow once with
`simulate_failure=true`, confirm the issue reaches the named incident owner,
then run it normally and confirm automatic recovery. This tests the GitHub
incident path; configure the repository owner&apos;s GitHub notification settings
or a separate paging integration if email, SMS, or push delivery is required.

Six-hourly detection is not sufficient for a marketed public service. Add a
second probe from another provider or region and increase the effective cadence
before adopting the 99.9% availability objective as an enforceable SLO. Alert
when any condition holds:

- three consecutive health failures;
- 5xx responses exceed 2% for five minutes;
- progress write conflicts exceed 10% for fifteen minutes;
- p95 progress latency exceeds 1.5 seconds for ten minutes;
- support intake or admin publishing returns any sustained 5xx response;
- a deployment fails or a database migration is incomplete;
- admin login is attacked or fails broadly;
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
- Support creation and status changes enqueue body-free notification jobs in the
  same D1 transaction as the mutation. A bounded page of 25 due jobs is claimed
  during every scheduled or manual maintenance run; failures retain an attempt
  count, sanitized error, exponential retry time, and provider idempotency key.
  Delivery is also scheduled as non-blocking post-response work so provider
  latency or failure cannot change a committed mutation into an HTTP error.
  Scheduled maintenance remains the durable retry path. Admin → Operations
  reports pending and failed counts. Alert when a failed job remains after the
  next maintenance cycle. Completed notification jobs and their duplicated
  recipient address are deleted after 7 days in bounded batches; orphan jobs
  are removed on the next maintenance run even when database foreign-key
  enforcement is unavailable.
- Support intake allows at most 20 challenge-verified attempts per opaque IP
  bucket per hour in addition to the existing learner-session quota. The bucket
  is an HMAC under `SUPPORT_RATE_LIMIT_SECRET`; raw IP addresses, reply addresses,
  and support bodies never enter the limiter table or logs. Missing Cloudflare
  client-IP metadata shares one opaque fallback bucket. Inactive limiter rows
  become eligible for bounded deletion after 24 hours.
- Authentication endpoints retain Better Auth&apos;s route-specific windows and
  limits, but consume them through an atomic D1 counter. The runtime
  IP-and-route key is domain-separated and HMACed under
  `BETTER_AUTH_RATE_LIMIT_SECRET` before database access. The table stores only
  that 64-character bucket hash, a count, and timestamps—never a raw IP,
  authentication path, or submitted email. Inactive buckets become eligible
  for bounded deletion after 24 hours.
- New-ticket operator mail can use the stored reply address only as `Reply-To`.
  Automatic requester receipts and status messages are enqueued only when that
  exact reply address belongs to the verified signed-in learner. Anonymous or
  unverified reply addresses never receive automatic mail.
- The Worker runs up to ten transactional pages of at most 500 rows per
  retention class daily at 03:17 UTC. After every page it checks persisted
  retention eligibility plus due deletion and notification queues, so an exact
  page boundary cannot create either a false green or false red heartbeat.
  Reaching the bounded work cap with work still present records a failed
  heartbeat; the next scheduled run or an operator's manual run continues
  draining the remaining backlog. Learner requests never run maintenance
  inline. The Admin → Operations panel reports due eligible counts and can run
  the same bounded batch manually. Every manual run
  records an immutable start event before deletion and a completion event with
  its operator, run ID, limit, and deletion counts. Failed or incompletely
  audited attempts receive a separate failure event for investigation.
- Admin → Operations can create record/user/entity-specific or class-wide legal
  holds. Active holds are excluded from automatic and manual deletion. Creating
  or releasing a hold requires a reason and creates an immutable audit event.
- Expired learner sessions and email-verification tokens, opaque authentication
  rate-limit buckets inactive for 24 hours, opaque support IP-quota buckets
  inactive for 24 hours, expired/revoked native sessions, and consumed Apple
  identity-token replay guards are removed in the same bounded maintenance
  cycle; they are not product analytics. The support limiter stores only a
  keyed HMAC bucket, window timestamps, a count, and an opaque reservation ID;
  it never stores a raw IP address.
- Alert on `scheduled_retention_failed`, verify the Cron Trigger after every
  deployment, and clear any expired backlog after an outage before closing the
  incident. Record the run result in the release or incident log.
- Anonymous learning-data deletion removes the primary progress record and
  local offline copy. Learner-account deletion also removes synchronized
  progress, product events, linked support records, active web sessions, and
  verified native linkage when present; audit/legal-hold records follow their
  separately documented rules. The authentication identity is removed only
  after a durable `learner_deletion_jobs` row has been staged. Cleanup is
  attempted immediately and retried by every scheduled or manual retention run.
  Admin → Operations reports pending, held, and errored deletion jobs. An active
  record-, user-, or class-level legal hold keeps only the matching operational
  rows and the job in `held`; releasing the hold lets the next run finish the
  deletion. Alert if a pending job remains open or reports an error after a
  maintenance cycle. Completed deletion rows remain as write-blocking
  tombstones for 24 hours to stop an already in-flight request from recreating
  data, then one bounded page of expired tombstones is removed per run.
- Fulfill verified privacy requests through the support workflow and record completion
  without copying sensitive request content into logs.

## Post-incident review

Within five working days for SEV-1/2 incidents, document impact, timeline, root cause,
contributing conditions, recovery, detection gaps, and assigned preventive actions.
Focus on system improvement rather than individual blame.
