# Production infrastructure choices

The primary public web release uses Sites-managed Cloudflare Worker, D1, and
static assets. The checked-in direct Wrangler path remains a guarded fallback
and a useful independently controlled staging option. Provider free allowances
and eligibility change, so verify the current plan before launch and configure
spend alerts even when starting at zero cost.

## Recommended starting topology

- Sites-managed Cloudflare Worker for the web application and API.
- One production D1 database plus a separate staging database.
- Static app icons, the offline shell, and the 270 audio clips served as immutable
  application assets; add object storage only if the packaged asset limit requires it.
- Provider-managed TLS and DNS.
- A scheduled trigger for daily bounded retention.
- The checked-in independent GitHub probe for `/api/health`, plus a second
  provider or region before the availability objective becomes enforceable.
- GitHub Actions for lockfile installs, tests, audits, build, and release evidence.

This topology avoids a separate always-on server and lets the web and native apps
share the same API. Do not call it production-ready until D1 is provisioned, every
migration is applied, secrets are configured, backups/restores are exercised, and
the live health check reports `productionReady: true`.

A smaller controlled beta has a separate, explicit contract. It may report HTTP
200 with `webReady: true` while `productionReady: false` only when core
identity, D1/schema, retention, and durable queues are healthy. Its health
warnings must identify any unavailable optional support-email delivery, while
Paretto ID creation, sign-in, and recovery remain available without email.
Optional support-email delivery does not determine whether either launch mode
can serve learners. This is operational beta evidence, not broad public-launch
approval.

## Free-start alternatives

| Option | Good fit | Trade-off |
| --- | --- | --- |
| Sites-hosted Worker + D1 | Primary checked-in hosting contract and managed source/version deployment | Requires a connected Sites project, environment values, and a separately validated deployment |
| Cloudflare Worker + D1 directly | Guarded fallback and one provider for compute, assets, bot protection, and data | Provisioning, plan limits, recovery, and domain setup require verification |
| Vercel + managed Postgres/Supabase | Familiar Next.js deployment and mature SQL tooling | The D1 SQL/runtime layer and Worker assumptions must be adapted |
| Firebase Hosting/Functions/Firestore | Strong mobile SDK ecosystem | Requires a persistence and authentication redesign; not a drop-in deployment |

For this codebase, changing providers before the first validated release adds risk
without adding learner value. Start with the intended runtime, measure usage, and
revisit only when a real limit, compliance requirement, or cost curve justifies it.

## Guarded direct Cloudflare fallback

Sites and direct Wrangler deployments are deliberately separate. For a direct
fallback deployment, use the checked-in `wrangler.staging.jsonc.example` and
`wrangler.production.jsonc.example` templates. Never deploy
`dist/server/wrangler.json`: that build artifact intentionally contains the local
Sites placeholder database ID.

The direct templates run only SSR pages, admin routes, legal/support pages, and
`/api/*` through the Worker. Packaged audio, fonts, icons, service-worker files,
and hashed application assets stay asset-first. The templates bind `ASSETS` for
Vinext, bind one D1 database as `DB`, read migrations from `drizzle/`, schedule
retention at 03:17 UTC, and enable Worker observability. They omit Images, R2,
paid-plan CPU limits, and every unused product binding. They declare seven core
runtime secrets. Support-email delivery is optional in both launch modes: its
two runtime values must either be exact empty strings with no `RESEND_API_KEY`,
or a valid sender and support mailbox must be paired with that provider secret.
The deployment verifier enforces both the
selective Worker route list and the Workers Free static-asset limits before
Wrangler can run. The same conservative free-compatible asset envelope remains
an artifact portability gate when `WORKERS_PLAN=paid`; it is not proof of the
account's billing plan.

Authenticate using Cloudflare's browser OAuth; never send an account password,
API token, or verification code:

```sh
npx wrangler login
npx wrangler whoami
```

Create separate databases in the Asia-Pacific location. Record the UUIDs returned
by Cloudflare; do not use `--update-config`, because the source templates must
remain provider-ID-free:

```sh
npx wrangler d1 create paretto-staging --location apac --binding DB
npx wrangler d1 create paretto-production --location apac --binding DB
```

After `npm run build`, materialize ignored environment-specific configurations:

```sh
npm run cloudflare:prepare -- \
  --environment staging \
  --account-id <32-character-account-id> \
  --database-name paretto-staging \
  --database-id <staging-d1-uuid> \
  --admin-emails <administrator-email> \
  --turnstile-site-key <staging-turnstile-site-key> \
  --auth-url https://<staging-worker-origin> \
  --launch-mode controlled-beta \
  --workers-plan free

npm run cloudflare:prepare -- \
  --environment production \
  --account-id <32-character-account-id> \
  --database-name paretto-production \
  --database-id <production-d1-uuid> \
  --admin-emails <author-email>,<different-approver-email> \
  --turnstile-site-key <production-turnstile-site-key> \
  --auth-url https://<production-worker-origin> \
  --launch-mode public \
  --workers-plan paid
```

`--admin-email` remains a backwards-compatible alias for a single-admin
controlled beta. Use `--admin-emails` for new environments. One address selects
the single `ADMIN_PASSWORD_VERIFIER` contract; two or more addresses select the
per-email `ADMIN_PASSWORD_VERIFIERS` contract. Addresses must already be
normalized, unique, and in the intended stable order. The preparer rejects
sentinel IDs. `--launch-mode` and `--workers-plan` are mandatory. Password
verifiers use a versioned Web Crypto HMAC-peppered PBKDF2-SHA256 scheme at
Cloudflare's 100,000-iteration ceiling. Each verifier records a non-secret key
ID; its matching HMAC pepper comes from the independently managed
`PARETTO_PASSWORD_PEPPERS` keyring outside D1. This prevents a database-only
breach from testing password guesses offline and supports bounded rotation with
retained keys and lazy re-hashing after successful sign-in. Cloudflare Workers
Free is limited to 10 ms CPU per request, so `free` is accepted only with
`controlled-beta`; broad `public` launch requires Workers Paid. Email delivery
is optional in either mode. Rotate `BETTER_AUTH_SECRET` separately because it
still invalidates sessions and can require linked providers to relink. Follow
the rotation procedures in `docs/OPERATIONS.md`. Omit both email flags to
materialize exact empty values. To enable
delivery, provide both `--auth-email-from 'Paretto
<accounts@verified-domain>'` and `--support-notification-email
<working-operator-mailbox>`, then include `RESEND_API_KEY` in that environment's
secret file. Partial configuration is rejected. The verifier then checks the
exact built Worker, static-file count
and sizes, D1 migration journal, service-worker headers, Cron, observability,
and absence of paid-only bindings:

`PARETTO_PASSWORD_PEPPERS` must be minified JSON no longer than 256
characters, with exactly `current` and `keys`. Use 1–3 unique key IDs matching
`[A-Za-z0-9_-]{1,16}`; each secret must be a unique random 32–128 character
value, and `current` must name one included key. Add a new ID for rotation;
never replace the secret behind an existing ID.

```sh
npm run cloudflare:verify:staging
npm run cloudflare:verify:production
npm run cloudflare:dry-run:staging
npm run cloudflare:dry-run:production
```

Create independent 256-bit values for `USER_KEY_SECRET`,
`SUPPORT_RATE_LIMIT_SECRET`, `BETTER_AUTH_RATE_LIMIT_SECRET`,
`BETTER_AUTH_SECRET`, the current `PARETTO_PASSWORD_PEPPERS` entry,
`ADMIN_SESSION_SECRET`, and each administrator access key.
Save every access key in that administrator&apos;s password manager. Store only
SHA-256 verifiers in the deployment secret file:

```sh
node --input-type=module <<'NODE'
import { createHash, randomBytes } from "node:crypto";
const value = () => randomBytes(32).toString("base64url");
const adminAccessKey = value();
console.log("ADMIN_ACCESS_KEY=" + adminAccessKey);
console.log("USER_KEY_SECRET=" + value());
console.log("SUPPORT_RATE_LIMIT_SECRET=" + value());
console.log("BETTER_AUTH_RATE_LIMIT_SECRET=" + value());
console.log("BETTER_AUTH_SECRET=" + value());
console.log(
  "PARETTO_PASSWORD_PEPPERS=" +
    JSON.stringify({ current: "v1", keys: { v1: value() } }),
);
console.log(
  "ADMIN_PASSWORD_VERIFIER=sha256$" +
    createHash("sha256").update(adminAccessKey, "utf8").digest("base64url"),
);
console.log("ADMIN_SESSION_SECRET=" + value());
NODE
```

Run this separately for staging and production. Do not reuse any printed value
between fields, administrators, or environments. A single-admin controlled beta
uses the singular line shown below. A publishing environment must have at least
two allowlisted people and instead use compact canonical JSON whose keys exactly
match `ADMIN_EMAILS`, in the same order; each administrator should compute and
provide only their `sha256$…` verifier. Never put both admin verifier variables
in one file.

Create ignored `.env.staging` and `.env.production` files with exactly these
names and no quotes:

```dotenv
USER_KEY_SECRET=<generated-random-value>
SUPPORT_RATE_LIMIT_SECRET=<different-generated-random-value>
BETTER_AUTH_RATE_LIMIT_SECRET=<another-generated-random-value>
BETTER_AUTH_SECRET=<different-generated-random-value>
PARETTO_PASSWORD_PEPPERS={"current":"v1","keys":{"v1":"<independent-generated-random-value>"}}
ADMIN_PASSWORD_VERIFIER=sha256$<generated-base64url-digest>
# For 2–25 administrators, replace the line above with:
# ADMIN_PASSWORD_VERIFIERS=<compact-json-map-in-ADMIN_EMAILS-order>
ADMIN_SESSION_SECRET=<another-generated-random-value>
TURNSTILE_SECRET=<secret-from-the-matching-Turnstile-widget>
# Only when both optional support-email runtime values are configured:
# RESEND_API_KEY=<secret-from-the-transactional-email-provider>
```

The local Keychain materializer intentionally creates only the eight core
secret fields. For one administrator it hashes the existing
`Paretto Staging Admin Access Key` or `Paretto Production Admin Access Key`
Keychain item. For multiple administrators, store the compact verifier map—not
the administrators&apos; access keys—in `Paretto Staging Admin Password
Verifiers` or `Paretto Production Admin Password Verifiers` under the same
Keychain account. It reads the independent limiter values from
`Paretto Staging Support Rate Limit Secret` and
`Paretto Production Support Rate Limit Secret`, plus
`Paretto Staging Better Auth Rate Limit Secret` and
`Paretto Production Better Auth Rate Limit Secret`, and the compact keyrings
from `Paretto Staging Password Pepper Keyring` and
`Paretto Production Password Pepper Keyring`; create those Keychain items under
the same account used by the other Paretto environment secrets. Add
`RESEND_API_KEY` to the ignored file only when the matching sender and support
mailbox are configured and verified, or configure the same complete trio
through Sites. Support mutations persist body-free email jobs
transactionally; scheduled and manual retention runs retry a bounded page, and
Admin → Operations exposes pending and failed deliveries. The internal
non-routable Paretto ID alias never receives mail, and passwords or recovery
codes must never enter a support request. Delivery is scheduled after the HTTP
response and provider failure remains queued; completed jobs are deleted after
7 days and orphan jobs on the next bounded maintenance run. Without the
optional trio, tickets remain in the authenticated
administrator queue for manual review; Paretto ID registration, sign-in,
recovery codes, progress synchronization, export, and deletion remain
available.

Restrict and validate each file before deployment:

```sh
chmod 600 .env.staging .env.production
npm run cloudflare:secrets:verify:staging
npm run cloudflare:secrets:verify:production
```

Do not run a bare `wrangler deploy`. Use the guarded scripts only. Apply and
smoke-test every migration in staging before applying it in production:

```sh
npm run cloudflare:migrate:staging
npm run cloudflare:deploy:staging
npm run smoke:deployment -- https://<staging-worker-origin> --mode controlled-beta

npm run cloudflare:migrate:production
npm run cloudflare:deploy:production
npm run smoke:deployment -- https://<production-worker-origin> --mode public
```

Both `.env.*` and materialized Wrangler files are ignored. The guarded deploy
scripts always validate and pass the matching file through Wrangler's official
`--secrets-file` option, so the first public Worker version cannot be created
without its required core secrets. Cloudflare then stores those values as
managed Worker secrets. `--keep-vars` protects values managed through the
dashboard from deletion during later code deployments.

The checked-in `Deploy Cloudflare release` workflow provides the same guarded
sequence. Staging accepts `main` or a `v*` tag; production accepts only a `v*`
tag and, before any protected-environment secret is available, verifies through
the GitHub Actions API that the complete seven-job `CI` workflow succeeded for
that exact commit SHA and that the commit is reachable from `main`. Protect
release tags against update/deletion and create protected GitHub Environments
named `staging` and `production`. Each environment needs variables
`APP_ORIGIN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `D1_DATABASE_NAME`,
`ADMIN_EMAILS`, and `TURNSTILE_SITE_KEY`, plus secrets
`CLOUDFLARE_API_TOKEN`, `USER_KEY_SECRET`, `SUPPORT_RATE_LIMIT_SECRET`,
`BETTER_AUTH_RATE_LIMIT_SECRET`, `BETTER_AUTH_SECRET`,
`PARETTO_PASSWORD_PEPPERS`,
either `ADMIN_PASSWORD_VERIFIER` for one administrator or
`ADMIN_PASSWORD_VERIFIERS` for multiple administrators,
`ADMIN_SESSION_SECRET`, and `TURNSTILE_SECRET`. In either mode, omit
`AUTH_EMAIL_FROM`, `SUPPORT_NOTIFICATION_EMAIL`, and `RESEND_API_KEY` together
to materialize disabled delivery, or configure all three together to enable
support email. The workflow rejects any partial trio. It requires an explicit
`launch_mode` choice and explicit `workers_plan` declaration, defaulting to
`controlled-beta` and `free`. It rejects `public` with `free` before the browser
matrix and writes the declaration into the generated runtime configuration.
This value is not billing evidence: the least-privilege deployment token does
not read account subscriptions. Before a public launch, verify Workers Paid in
the Cloudflare account and record the provider evidence in the release record.
The production
environment additionally requires an
independent `D1_BACKUP_ENCRYPTION_PASSPHRASE` of at least 32 characters.
For a team-operated or public launch, require independent reviewer approval for
the production environment and disable administrator bypass. An explicitly
owner-operated controlled beta may leave that approval rule unset when its
release evidence records the decision and owner. It must still use the public
repository, protected release tag, exact seven-job CI result, `main` ancestry,
encrypted backup, and post-deploy smoke gates; a single-account run must not be
described as independently reviewed. This release-governance exception does
not relax the distinct-author/approver rule for CMS publication. The workflow
materializes the ignored files with private permissions. Before a production
migration it captures a Time Travel bookmark and full D1 export, encrypts and
byte-compares the round trip, restores it into isolated SQLite, validates
integrity, foreign keys, contiguous migration history and schema, and must
upload the encrypted seven-day recovery artifact successfully. It then applies
migrations, deploys, runs the
mandatory GET-only smoke script, and removes the ephemeral files even after
failure. Download longer-lived recovery evidence into the approved backup
store before the artifact expires, retain its manifest SHA-256, and keep the
encryption passphrase separately. GitHub configuration stores presence only;
never add credential values or an unencrypted D1 export to workflow YAML,
logs, or release evidence.

The workflow still reads the legacy `ADMIN_EMAIL` variable if `ADMIN_EMAILS`
is absent so an existing one-admin controlled beta can be upgraded without an
availability break. New environments must use `ADMIN_EMAILS`.

### Web identity contract

- A new learner receives a random 256-bit, origin-bound, `HttpOnly`,
  `SameSite=Lax` cookie. The database key is an HMAC of that session value under
  `USER_KEY_SECRET`; neither a raw email nor the raw cookie is stored in D1.
- Learners may remain anonymous or create a Paretto ID/password account. Account
  creation claims the current anonymous journal through an immutable link;
  subsequent requests use an account-derived learning key and synchronize
  across supported browsers. Sign-out clears the account&apos;s local cache and
  rotates the anonymous browser identity before another learner can use it.
- Paretto ID recovery uses one-time recovery codes, not email. The learner
  stores the only plaintext copy; D1 stores user-bound hashes and a recovery
  generation. Successful recovery rotates every code and revokes existing
  sessions. Optional support-email delivery has no role in account creation,
  sign-in, or recovery.
- Better Auth&apos;s route-specific request limits use an atomic D1 counter. Its
  ephemeral IP-and-path key is HMACed under the independent
  `BETTER_AUTH_RATE_LIMIT_SECRET` before persistence, so the limiter table
  contains no raw IP address, auth path, password, recovery code, or readable
  Paretto ID. App-owned account actions also enforce HMACed IP and
  normalized-ID quotas after exact-action Turnstile verification.
- `/admin/login` accepts only a normalized `ADMIN_EMAILS` identity and its own
  generated high-entropy access key. A one-admin beta uses
  `ADMIN_PASSWORD_VERIFIER`; a multi-admin publishing environment uses an exact
  per-email `ADMIN_PASSWORD_VERIFIERS` map with distinct values. The Worker
  stores only SHA-256 verifiers, compares them in constant time, throttles
  repeated failures in D1, and issues an eight-hour `HttpOnly`, `Secure`,
  `SameSite=Strict` admin cookie. Same-person approval and publication remain
  denied.
- Support submissions require the matching Cloudflare Turnstile widget and
  server secret. The server validates the action and exact request hostname,
  then enforces a separate 20-per-hour IP quota using only an opaque HMAC under
  `SUPPORT_RATE_LIMIT_SECRET`. It never stores the raw IP in limiter data.
- Browser mutations require the exact deployed `Origin`; legacy
  `oai-authenticated-*` headers are removed before application dispatch.
- `NATIVE_API_ENABLED` is `true` for the iOS release. Health requires the
  complete Apple credential set, independent token-encryption and native-session
  secrets, and migration 0014 before reporting native readiness.
- `LAUNCH_MODE=controlled-beta` can return HTTP 200 only for a healthy core,
  retention schedule, and queues. It always reports `productionReady: false`
  with explicit capability warnings. `WORKERS_PLAN=free` is restricted to this
  controlled-beta contract. `LAUNCH_MODE=public` additionally requires
  `WORKERS_PLAN=paid` and
  the strict public web contract, including working Paretto ID recovery, but
  optional support-email delivery may remain disabled when a named
  administrator owns manual ticket-queue review. The guarded smoke and monitor
  default to the public contract when no mode is supplied.
- `/api/health` performs the deep schema, retention, and queue readiness check
  needed by deployment smoke. Each Worker isolate and Cloudflare's
  per-data-center Cache API cache healthy results for 30 seconds (degraded
  results for five seconds) under one query-independent GET key. A simultaneous
  cold miss can perform more than one check because request-owned I/O is never
  shared across Worker invocations; this bounded cache is not a globally
  replicated lock. Internal cache entries contain only plain response data and
  carry the short public TTL, while every client response remains
  `private, no-store` and HEAD returns no body. Health responses contain no
  identity state and responses carrying `Set-Cookie` are never cached.

The current application contains no `next/image` usage, so the unused
Cloudflare Images transformation path has been removed. Reintroduce image
transformations only with a product need, pricing review, cache policy, and
deployment binding.

Cloudflare currently documents 100,000 dynamic Worker requests per day with
10 ms CPU per invocation on Free; static asset requests are free and unlimited.
D1 Free currently includes five million rows read and 100,000 rows written per
day, a 500 MB limit per database, 5 GB total storage, and seven days of automatic
Time Travel. Verify these limits again at launch:
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## Day-one operational checklist

- Separate staging and production D1 databases, Turnstile widgets, secrets,
  domains, and administrator access keys.
- Store `USER_KEY_SECRET`, `SUPPORT_RATE_LIMIT_SECRET`,
  `BETTER_AUTH_RATE_LIMIT_SECRET`, `BETTER_AUTH_SECRET`,
  `PARETTO_PASSWORD_PEPPERS`,
  the matching singular or plural administrator verifier secret,
  `ADMIN_SESSION_SECRET`, and `TURNSTILE_SECRET`
  only through the ignored secret files and Cloudflare managed secrets.
  Configure the exact `BETTER_AUTH_URL`, normalized `ADMIN_EMAILS`, the
  matching `TURNSTILE_SITE_KEY`, explicit `LAUNCH_MODE`, explicit
  `WORKERS_PLAN`, and `NATIVE_API_ENABLED=true` as runtime values. Store
  `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
  `APPLE_PRIVATE_KEY_BASE64`, `APPLE_TOKEN_ENCRYPTION_SECRET`, and
  `NATIVE_SESSION_SECRET` only as managed secrets. Treat
  `WORKERS_PLAN` as a fail-closed declaration, not subscription proof; public
  operation requires separately recorded Workers Paid evidence. Add `AUTH_EMAIL_FROM`,
  `SUPPORT_NOTIFICATION_EMAIL`, and `RESEND_API_KEY` only as one complete
  optional support-email trio; otherwise keep both runtime values exactly empty
  and omit the secret.
- Keep the administrator access key only in a password manager. Never use or
  store an Apple account password or verification code.
- Enable provider backup/recovery, test a restore, and document the observed recovery point.
- Keep the production `D1_BACKUP_ENCRYPTION_PASSPHRASE` separate from Worker
  runtime secrets, restrict access to encrypted recovery artifacts, and verify
  a non-production restore before relying on the recovery target.
- Set spend/budget notifications and review database, request, egress, and asset usage weekly.
- Alert on health failure, 5xx rate, latency, migration mismatch, admin-login abuse,
  missed retention runs, and unexpected analytics growth.
- Set the GitHub repository variables `PRODUCTION_APP_ORIGIN` and
  `PRODUCTION_LAUNCH_MODE`, exercise the
  monitor workflow&apos;s simulated-failure path, verify the incident issue reaches
  its owner, and then confirm a successful run closes it.
- Assign a named incident responder and privacy-request owner before admitting public users.
