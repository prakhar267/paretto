# Production infrastructure choices

The first public web release uses a direct Cloudflare Worker, D1, and static
assets. Sites remains a compatible future hosting surface, but is not required
for this deployment. Provider free allowances and eligibility change, so verify
the current plan before launch and configure spend alerts even when starting at
zero cost.

## Recommended starting topology

- Direct Cloudflare Worker for the web application and API.
- One production D1 database plus a separate staging database.
- Static app icons, the offline shell, and the 270 audio clips served as immutable
  application assets; add object storage only if the packaged asset limit requires it.
- Provider-managed TLS and DNS.
- A scheduled trigger for daily bounded retention.
- Two external uptime probes for `/api/health` and structured-log alerts.
- GitHub Actions for lockfile installs, tests, audits, build, and release evidence.

This topology avoids a separate always-on server and lets the web and native apps
share the same API. Do not call it production-ready until D1 is provisioned, every
migration is applied, secrets are configured, backups/restores are exercised, and
the live health check reports `productionReady: true`.

## Free-start alternatives

| Option | Good fit | Trade-off |
| --- | --- | --- |
| Cloudflare Worker + D1 directly | Current checked-in launch path and one provider for compute, assets, bot protection, and data | Provisioning, plan limits, recovery, and domain setup require verification |
| Sites-hosted Worker + D1 | Compatible managed hosting path if Sites becomes available | Requires a connected Sites project and a separately validated deployment |
| Vercel + managed Postgres/Supabase | Familiar Next.js deployment and mature SQL tooling | The D1 SQL/runtime layer and Worker assumptions must be adapted |
| Firebase Hosting/Functions/Firestore | Strong mobile SDK ecosystem | Requires a persistence and authentication redesign; not a drop-in deployment |

For this codebase, changing providers before the first validated release adds risk
without adding learner value. Start with the intended runtime, measure usage, and
revisit only when a real limit, compliance requirement, or cost curve justifies it.

## Direct Cloudflare deployment

Sites and direct Wrangler deployments are deliberately separate. For the current
launch, use the checked-in `wrangler.staging.jsonc.example` and
`wrangler.production.jsonc.example` templates. Never deploy
`dist/server/wrangler.json`: that build artifact intentionally contains the local
Sites placeholder database ID.

The direct templates run only SSR pages, admin routes, legal/support pages, and
`/api/*` through the Worker. Packaged audio, fonts, icons, service-worker files,
and hashed application assets stay asset-first. The templates bind `ASSETS` for
Vinext, bind one D1 database as `DB`, read migrations from `drizzle/`, schedule
retention at 03:17 UTC, and enable Worker observability. They omit Images, R2,
paid-plan CPU limits, and every unused product binding. They also declare the
exact four required launch secrets. The deployment verifier enforces both the
selective Worker route list and the Workers Free static-asset limits before
Wrangler can run.

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
npx wrangler d1 create loquivo-staging --location apac --binding DB
npx wrangler d1 create loquivo-production --location apac --binding DB
```

After `npm run build`, materialize ignored environment-specific configurations:

```sh
npm run cloudflare:prepare -- \
  --environment staging \
  --account-id <32-character-account-id> \
  --database-name loquivo-staging \
  --database-id <staging-d1-uuid> \
  --admin-email <administrator-email> \
  --turnstile-site-key <staging-turnstile-site-key>

npm run cloudflare:prepare -- \
  --environment production \
  --account-id <32-character-account-id> \
  --database-name loquivo-production \
  --database-id <production-d1-uuid> \
  --admin-email <administrator-email> \
  --turnstile-site-key <production-turnstile-site-key>
```

The preparer rejects sentinel IDs. The verifier then checks the exact built
Worker, static-file count and sizes, D1 migration journal, service-worker
headers, Cron, observability, and absence of paid-only bindings:

```sh
npm run cloudflare:verify:staging
npm run cloudflare:verify:production
npm run cloudflare:dry-run:staging
npm run cloudflare:dry-run:production
```

Create independent 256-bit values for `USER_KEY_SECRET`,
`ADMIN_SESSION_SECRET`, and the administrator access key. Save the access key in
a password manager. Store only its SHA-256 verifier in the secret file:

```sh
node --input-type=module <<'NODE'
import { createHash, randomBytes } from "node:crypto";
const value = () => randomBytes(32).toString("base64url");
const adminAccessKey = value();
console.log("ADMIN_ACCESS_KEY=" + adminAccessKey);
console.log("USER_KEY_SECRET=" + value());
console.log(
  "ADMIN_PASSWORD_VERIFIER=sha256$" +
    createHash("sha256").update(adminAccessKey, "utf8").digest("base64url"),
);
console.log("ADMIN_SESSION_SECRET=" + value());
NODE
```

Run this separately for staging and production. Do not reuse any printed value
between fields or environments. Create ignored `.env.staging` and
`.env.production` files with exactly these names and no quotes:

```dotenv
USER_KEY_SECRET=<generated-random-value>
ADMIN_PASSWORD_VERIFIER=sha256$<generated-base64url-digest>
ADMIN_SESSION_SECRET=<different-generated-random-value>
TURNSTILE_SECRET=<secret-from-the-matching-Turnstile-widget>
```

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

npm run cloudflare:migrate:production
npm run cloudflare:deploy:production
```

Both `.env.*` and materialized Wrangler files are ignored. The guarded deploy
scripts always validate and pass the matching file through Wrangler's official
`--secrets-file` option, so the first public Worker version cannot be created
without its required secrets. Cloudflare then stores those values as managed
Worker secrets. `--keep-vars` protects values managed through the dashboard
from deletion during later code deployments.

### Web identity contract

- A new learner receives a random 256-bit, origin-bound, `HttpOnly`,
  `SameSite=Lax` cookie. The database key is an HMAC of that session value under
  `USER_KEY_SECRET`; neither a raw email nor the raw cookie is stored in D1.
- Web progress is anonymous and browser-specific for this release. Clearing the
  cookie or changing browsers creates a new learner identity. Cross-device
  account sync is deferred until the native/public account system is enabled.
- `/admin/login` accepts only the one normalized `ADMIN_EMAILS` address and its
  generated high-entropy access key. The Worker stores only a SHA-256 verifier,
  compares it in constant time, throttles repeated failures in D1, and issues an
  eight-hour `HttpOnly`, `Secure`, `SameSite=Strict` admin cookie.
- Support submissions require the matching Cloudflare Turnstile widget and
  server secret. The server validates the action and exact request hostname.
- Browser mutations require the exact deployed `Origin`; legacy
  `oai-authenticated-*` headers are removed before application dispatch.
- `NATIVE_API_ENABLED` is `false` for this web release. Health reports native
  checks as disabled and does not require Apple credentials for
  `productionReady: true`.

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
- Store `USER_KEY_SECRET`, `ADMIN_PASSWORD_VERIFIER`,
  `ADMIN_SESSION_SECRET`, and `TURNSTILE_SECRET` only through the ignored
  secret files and Cloudflare managed secrets. Configure one normalized
  `ADMIN_EMAILS` value, the matching `TURNSTILE_SITE_KEY`, and
  `NATIVE_API_ENABLED=false` as runtime values.
- Keep the administrator access key only in a password manager. Never use or
  store an Apple account password or verification code.
- Enable provider backup/recovery, test a restore, and document the observed recovery point.
- Set spend/budget notifications and review database, request, egress, and asset usage weekly.
- Alert on health failure, 5xx rate, latency, migration mismatch, admin-login abuse,
  missed retention runs, and unexpected analytics growth.
- Assign a named incident responder and privacy-request owner before admitting public users.
