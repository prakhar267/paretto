# Production infrastructure choices

The repository is designed for the checked-in Sites/Cloudflare Worker, D1, and
static-asset path. That is the lowest-change production option and should be tried
first. Provider free allowances and eligibility change, so verify the current plan
before launch and configure spend alerts even when starting at zero cost.

## Recommended starting topology

- Sites-hosted Worker for the web application and API.
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
| Sites/Cloudflare Worker + D1 | Lowest code and operations change | Provisioning, plan limits, backups, and the Sites connection still require verification |
| Cloudflare Pages/Workers + D1 directly | Similar runtime if Sites is unavailable | Requires a separate deployment workflow and domain setup |
| Vercel + managed Postgres/Supabase | Familiar Next.js deployment and mature SQL tooling | The D1 SQL/runtime layer and Worker assumptions must be adapted |
| Firebase Hosting/Functions/Firestore | Strong mobile SDK ecosystem | Requires a persistence and authentication redesign; not a drop-in deployment |

For this codebase, changing providers before the first validated release adds risk
without adding learner value. Start with the intended runtime, measure usage, and
revisit only when a real limit, compliance requirement, or cost curve justifies it.

## Day-one operational checklist

- Separate staging and production data, secrets, domains, Apple identifiers, and API URLs.
- Store `USER_KEY_SECRET`, `NATIVE_SESSION_SECRET`,
  `APPLE_TOKEN_ENCRYPTION_SECRET`, and the Apple `.p8` private key only in managed
  secret storage. Configure `ADMIN_EMAILS`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, and
  `APPLE_KEY_ID` as runtime values; never paste an Apple password or verification code.
- Enable provider backup/recovery, test a restore, and document the observed recovery point.
- Set spend/budget notifications and review database, request, egress, and asset usage weekly.
- Alert on health failure, 5xx rate, latency, migration mismatch, Apple sign-in failure,
  missed retention runs, and unexpected analytics growth.
- Assign a named incident responder and privacy-request owner before admitting public users.
