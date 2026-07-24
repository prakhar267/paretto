# Pas à Pas v1.0.1 release evidence — 25 July 2026 IST

This record covers the direct Cloudflare web deployment and the local native
simulator candidate. It does not treat App Store distribution, legal approval,
human French editorial approval, physical-device testing, or unexecuted remote
CI as complete.

## Release identity

- Web version: `1.0.1`.
- Native marketing version/build: `1.0.1` (`2`).
- Deployed source commit:
  `04c22b116aa9c5d2027f9381ee8c18a0607da64d`.
- Deployed source tree:
  `2b673e0e5173b9d57f776d78c921171cb0ade7f8`.
- Release tag target: `v1.0.1` must resolve to the deployed source commit above.
- Validation window: 24 July 2026 UTC / 25 July 2026 IST.
- Release operator: repository owner.
- GitHub CI: not run. This checkout has no Git remote and GitHub CLI is not
  installed. Local results below are not represented as remote CI evidence.

## Cloudflare deployments

| Environment | Worker URL | Current version | Deployed UTC |
| --- | --- | --- | --- |
| Staging | `https://pas-a-pas-french-staging.prakhargupta267.workers.dev` | `033d1492-6f5c-4984-aee7-6d5ad26a1158` | 2026-07-24 18:50 |
| Production | `https://pas-a-pas-french.prakhargupta267.workers.dev` | `496416cb-c93e-4494-aa87-ab45c8ccac03` | 2026-07-24 19:01 |

Both deployments use direct Wrangler configuration because the Sites connector
was unavailable. Static audio, fonts, icons, the service worker, and hashed
assets remain asset-first. SSR, legal/support, administration, and `/api/*`
routes run through the Worker. Both deployments expose the reviewed
`17 3 * * *` retention trigger and Worker observability.

## Final source and package gates

The complete `npm run release:verify` gate passed independently on the deployed
commit under:

| Runtime | npm | Result |
| --- | --- | --- |
| Node `22.23.1` | `10.9.2` | Passed |
| Node `24.18.0` | `10.9.2` | Passed |

Each run passed:

- TypeScript and ESLint with no errors.
- Production-only and complete dependency audits with zero findings.
- Secret scanning across 480 release files.
- License metadata for 30 production packages. The committed lockfile SHA-256
  is `cdb92f36e7ec23f574395a9a3d0e5b2110babf20b344e4d87aac23b0d9d774b9`.
- Release identity agreement across the web package, lockfile, health route,
  XcodeGen source, and generated Xcode project.
- Eight migration replay steps through `0007_crazy_living_tribunal`, with 15
  application tables, 21 named indexes, SQLite integrity, and foreign keys.
- 114 Vitest checks across 22 files and three production-render checks.
- All 270 licensed synthetic French WAV clips, with no missing or clipped asset.
- All five Vinext build environments and the release-artifact contract.
- Both direct Cloudflare templates, including the exact selective
  `run_worker_first` route list and Free-plan asset limits.

## Native evidence

- Xcode `26.6` build `17F113` and iOS Simulator runtime `26.5` were installed.
- `PasAPasCore`: 12 of 12 Swift tests passed.
- `PasAPas` integration package: 13 of 13 Swift tests passed.
- The complete Xcode test plan passed on an iPhone 17 Pro simulator: 13 native
  tests and three UI tests.
- The complete adaptive test plan passed on an iPad Pro 13-inch (M5) simulator
  after correcting the UI test to recognize the iPad sidebar.
- A targeted compact-iPhone rerun passed after that test-only correction.
- The native API is deliberately disabled in both hosted environments. Sign in
  with Apple, production native sync, TestFlight, signing, and App Store
  distribution are outside this web release.

## Database and recovery evidence

- All eight migrations were applied to staging and production in journal order.
  Both environments subsequently reported no pending migration.
- Live health checks reported database and schema `ready`, service version
  `1.0.1`, schema revision `0007`, `productionReady: true`, and
  `webReady: true`.
- `wrangler d1 time-travel info` returned a current bookmark for both databases.
  No production restore was performed.
- A provider-level restore rehearsal exported staging, imported it into a new
  temporary APAC D1 database, and compared the restored counts with the source:
  17 visible D1 tables including provider/migration tables, 21 indexes, eight
  migrations, one QA learner state, one QA support request, two audit events,
  zero CMS rows, and zero analytics rows.
- The temporary restore database and temporary SQL export were deleted after
  verification. Staging and production were retained.
- Bounded manual retention ran successfully in both staging and production with
  a batch limit of one. Start/completion audit events and cursor pagination were
  verified.
- A natural 03:17 UTC scheduled execution has not yet been observed. The trigger,
  handler, manual equivalent, and failure tests are present, but this remains a
  post-deployment observation item.

## Live web, security, and operations evidence

The following passed independently against staging and production:

- Home, privacy, terms, cookies/storage, accessibility, attributions, support,
  admin login, manifest, service worker, offline page, and health returned 200.
- Dynamic pages carried CSP, HSTS, frame denial, MIME protection,
  cross-origin-opener, permissions-policy, and request-ID headers.
- Anonymous learner cookies used a 43-character token with `__Host-`, `Secure`,
  `HttpOnly`, `SameSite=Lax`, root path, and no Domain attribute.
- Missing and foreign mutation origins returned 403. The exact origin reached
  route validation.
- Forged `oai-authenticated-*` headers did not create administrator privilege.
- Server-side analytics consent rejected a valid event while the learner's
  saved preference was off.
- Administrator login, strict eight-hour session cookie, all administration
  list/status APIs, logout, and post-logout denial passed. No invalid-password
  burst was used against the rate limiter.
- Audit and legal-hold pagination, operations status, support queue, analytics
  status, and curriculum status returned valid authenticated responses.
- Every native endpoint failed closed with 503 while
  `NATIVE_API_ENABLED=false`.
- Cross-origin support submission returned 403 and an invalid Turnstile token
  returned 400 without creating a support row.

All 270 live audio files were downloaded from each environment and matched the
release manifest's byte length and SHA-256. Every file had a valid RIFF header,
`audio/wav` content type, and asset-first delivery without a Worker request ID.

The PWA manifest, 192/512 icons, root-scoped service worker, no-cache service
worker headers, network-only API/navigation policy, versioned audio cache, and
identity-free reconnect page passed the live HTTP contract. Cloudflare static
assets returned full 200 responses to the tested WAV Range request rather than
206; playback uses small complete clips and all content-integrity checks passed.

## Interactive Chrome evidence

Against the exact staging deployment, connected Chrome completed:

- new-learner onboarding with optional analytics left off;
- one full five-card lesson and server save;
- completion focus on the result heading;
- learned-only “Practice anyway” review, confirming no unseen review card;
- review close with focus restored to its invoking button;
- profile and data controls;
- delete-confirmation focus on Cancel and focus restoration after cancellation;
- a real Turnstile support submission and receipt;
- zero captured console warnings or errors.

Against production, connected Chrome verified the rendered onboarding page,
public legal/support surface, a completed production Turnstile widget, and a
real end-to-end support receipt. The clearly marked production canary row was
then deleted by exact UUID and confirmed absent. The production support queue
was left clean.

The Chrome extension advertised a viewport override but did not change the
connected window's 1470-pixel CSS viewport. Responsive confidence therefore
comes from the automated layout contracts and the passing iPhone/iPad simulator
runs, not from a claimed mobile Chrome session.

## Remaining launch controls

These items require an external account, qualified reviewer, person, or physical
device and are not marked complete:

- Install and authenticate GitHub CLI, attach a private canonical remote, push
  the exact release commit/tag, and obtain successful Node 22, Node 24, iPhone,
  and iPad GitHub Actions runs.
- Configure an independent uptime/alert destination and verify alert delivery
  from outside Cloudflare. Worker observability is enabled, but it is not an
  independent probe.
- Observe and retain evidence for the first natural retention Cron run.
- Have a native-French editor review every French string, IPA, translation,
  cultural statement, and all 270 audio clips.
- Have qualified Indian counsel confirm the operator/trading identity, address,
  privacy notice, terms, retention promises, notices, and launch jurisdictions.
- Run physical iPhone/iPad and Android web checks, Safari, Firefox, Edge,
  VoiceOver, Windows high contrast, and manual 200%/400% zoom checks.
- Choose and clear a future multi-language brand before native store work.
- Complete Apple developer identifiers, signing, production Sign in with Apple,
  TestFlight, and App Store material when the deferred native release resumes.

## Decision

- Technical web deployment: **GO for controlled production evaluation**.
- Public marketed/commercial launch: **NO-GO** until French editorial approval,
  legal approval, independent monitoring/alerting, natural Cron evidence, and
  the required human/device matrix are recorded.
- Native/App Store release: deferred by product decision.

Never move a published `v1.0.1` tag. If a later release input changes, create a
new version and tag.
