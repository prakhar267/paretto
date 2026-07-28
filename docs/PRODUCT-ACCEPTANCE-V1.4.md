# Paretto v1.4 product acceptance matrix

This matrix closes the requirements audit that previously described the product
as a functional anonymous beta. It describes the current source tree, not a
claim that an uncommitted build is live, that external services are provisioned,
or that human review has occurred.

Status meanings:

- **Implemented + automated evidence** — the requirement has a production code
  path and committed regression coverage.
- **Provisioning/live evidence required** — the safe implementation exists, but
  a real provider, credential, deployment, or recovery exercise must still be
  evidenced.
- **Human/external gate** — no automated result can substitute for the named
  person, legal decision, physical device, or account owner.
- **Deliberately outside v1.4** — useful scope that is not required for the
  controlled French web beta and must not be presented as shipped.

## Critical findings

| Audit requirement | Current acceptance status | Evidence and boundary |
| --- | --- | --- |
| Learner sign-in, signup, recovery, logout, account management, anonymous-progress claim, and cross-browser synchronization | **Implemented + automated evidence** | Better Auth and app-owned D1 account routes live in `app/learner-auth.ts`, `app/api/account`, and `app/api/progress`. A Paretto ID requires no email; eight one-time recovery codes are issued once, recovery rotates the set and revokes sessions, and raw Better Auth email/username paths are blocked. Account-scoped browser caches, anonymous claim, account APIs, and cross-browser behavior have automated coverage. |
| Local storage failure must never be silently described as saved | **Implemented + automated evidence** | `app/use-progress.ts` exposes cache availability and failures; `app/ParettoApp.tsx` makes completion and retry language depend on actual cloud/device state. `tests/use-progress.test.tsx` and `tests/paretto-app.test.tsx` cover blocked storage, failed saves, reset markers, and truthful completion copy. |
| Removed/unpublished CMS words must not inflate counts or crash Challenge | **Implemented + automated evidence** | Runtime curriculum reconciliation filters inactive identities and challenge selection excludes orphan progress. `tests/paretto-app.test.tsx`, `tests/runtime-curriculum.test.ts`, and `tests/cms-curriculum-hardening.test.ts` cover orphan-safe challenge selection and stable learner identity. |
| iOS staging/release origins, native API/auth/sync/deletion implementation | **Implemented + automated evidence; live Apple evidence required** | Tracked staging/production origins are in `ios/Paretto/Configuration/Shared.xcconfig`; SwiftUI auth, protected Apple user ID, launch-time credential-state validation, local revocation handling, Keychain session, account-scoped offline sync, export, and deletion live under `ios/Paretto/ParettoApp`; native routes live under `app/api/native`. Swift package, XCTest, iPhone/iPad simulator, and unsigned Release-bundle gates are in `.github/workflows/ci.yml`. `NATIVE_API_ENABLED=false` remains intentional until genuine Apple server credentials, validated server-to-server Apple account-change notifications, and signed-app evidence exist. |
| Physical iPhone/iPad, VoiceOver, signed archive, TestFlight, and production Apple auth | **Human/external gate** | Requires the account owner, Apple identifiers/keys, paid Developer membership at distribution time, real devices, accessibility testing, and TestFlight. Simulator and unsigned CI evidence cannot be relabeled as this evidence. |

## CMS and curriculum

| Audit requirement | Current acceptance status | Evidence and boundary |
| --- | --- | --- |
| Empty CMS must not say “Live curriculum synced” | **Implemented + automated evidence** | `app/published-curriculum.server.ts`, `app/api/curriculum/route.ts`, and the learner/admin UI report compiled fallback, CMS draft, or live CMS source exactly. `tests/admin-api.test.ts` and `tests/cms-curriculum-hardening.test.ts` cover an empty healthy CMS and D1 fallback. |
| Immutable learning identity across slug rename | **Implemented + automated evidence** | `app/curriculum-identity.ts`, CMS revisions/aliases/tombstones, and runtime reconciliation preserve stable IDs. Migration replay includes legacy fixtures. Covered by `tests/cms-curriculum-hardening.test.ts`, `tests/runtime-curriculum.test.ts`, `tests/local-schema-upgrade.test.ts`, and database verification. |
| Human approval, separate author/approver, required CEFR/topic/lesson metadata, five-card integrity, and audio readiness | **Implemented + automated evidence** | Publication checks live in `app/api/_lib/publication-readiness.ts` and admin publication/review routes. Same-person review/publication is denied; edits reset approval; incomplete lessons and missing audio are blocked. `tests/admin-api.test.ts` exercises both admin identities end to end. |
| Supported two-person production administrator configuration | **Implemented + automated evidence; people still required** | The guarded templates, preparer, secret verifier, Keychain materializer, and deployment workflow accept one singular verifier or an exact 2–25-person canonical verifier map. Missing, reordered, extra, or shared verifiers fail closed in `tests/admin-deployment-contract.test.ts`. A one-admin environment cannot complete distinct-person publishing; two actual people and independently held access keys remain required. |
| CMS audio intake | **Implemented + automated evidence; editor approval required** | `scripts/cms-audio-intake.mjs` validates the intake contract, asset identity, and reviewer metadata; `tests/cms-audio-intake.test.ts` covers it. A qualified French editor must still listen and approve every production recording. |
| Admin audit history beyond 100 records | **Implemented + automated evidence** | Cursor pagination and load-more behavior are implemented in the audit API/admin console. `tests/admin-api.test.ts` covers complete paginated admin queues without silent caps. |
| Larger curriculum and Mainichi-scale depth | **Not complete; content program required** | The verified release contains 270 French A1/A2 vocabulary items, 54 five-card lessons, and 18 regions. CMS validation accepts A1–C2 and open-ended lessons, but B1–C2 content has not been invented or represented as reviewed. Grammar, typing, and speaking assessment are outside the current lesson engine. |
| Placement logic | **Implemented + automated evidence** | Proficiency selection produces transparent, distinct starting placement in `app/ParettoApp.tsx`; covered by `tests/paretto-app.test.tsx`. This is not a claim of a psychometrically validated adaptive placement exam. |
| Qualified review of French, IPA, translations, culture, pedagogy, and all audio | **Human/external gate** | Structural, manifest, IPA-shape, and audio-file checks are automated, but a native/qualified French editor must approve language and pronunciation. Use `docs/CURRICULUM-EDITORIAL.md`; record the reviewer and result in release evidence. |

## Product and UX findings

| Audit finding | Current acceptance status | Evidence |
| --- | --- | --- |
| Review and Challenge always choose the first five cards | **Implemented + automated evidence** | Due-first scheduling and deterministic fair rotation are covered by `tests/paretto-app.test.tsx`. |
| “Almost — later today” can be wrong by days/weeks | **Implemented + automated evidence** | Review copy formats the actual interval; singular/hour/day behavior is regression-tested. |
| Closing Challenge after one answer consumes the attempt | **Implemented + automated evidence** | A completed attempt consumes the daily reward; early close does not. Replay is reward-free. Component and Playwright journeys cover both paths. |
| Dice results cannot be recovered | **Implemented + automated evidence** | A dated receipt is persisted and reopened; the browser journey verifies exact stake, multiplier, and XP. |
| Proficiency has no effect | **Implemented + automated evidence** | Distinct placement behavior is covered by the placement component test. |
| Daily goal cannot be changed | **Implemented + automated evidence** | Profile goal editing, persistence, focus, and announcement are covered by the profile/component journey. |
| Export exists but import/restore does not | **Implemented + automated evidence** | Validated JSON import restores sanitized learning state and reports storage/sync truthfully. The Playwright backup/restore journey verifies it. |
| SPA navigation does not move focus or announce views | **Implemented + automated evidence** | Main-view focus/announcement, modal trapping/return, lesson answer/card transitions, Challenge completion, and delete confirmation are covered by component and browser tests. |
| Legal/support unavailable before onboarding | **Implemented + automated evidence** | Onboarding links expose privacy, terms, accessibility, attribution, and support before consent/lesson entry; rendered-route and browser tests cover them. |
| No user-facing ticket status or operator workflow | **Implemented + automated evidence; delivery provisioning varies by mode** | Learner-owned status lookup, paginated admin queue, audited status changes, and body-free delivery outbox exist. `tests/support-status-api.test.ts`, `tests/admin-api.test.ts`, and `tests/support-notification-outbox.test.ts` cover privacy and retry behavior. When optional email delivery is absent, a named administrator must review the authenticated queue in either mode. |
| Misleading beta, billing, league, fixed-count, and “coming soon” copy | **Implemented + automated evidence for release UI** | Unsupported billing/league/reminder promises were removed; counts use real pluralized state; CMS and persistence messaging is conditional. Trust-copy regressions live in `tests/paretto-app.test.tsx` and admin/CMS tests. |
| True offline PWA cold start | **Implemented for an identity-free shell** | Service-worker registration handles already-loaded pages and Chromium proves a cold offline navigation returns only the static, script-free shell. Progress APIs stay network-only and local edits queue separately. Covered by `tests/pwa-runtime.test.ts` and `e2e/learner-journeys.spec.ts`. |

## Privacy, security, and operations

| Audit requirement | Current acceptance status | Evidence and boundary |
| --- | --- | --- |
| Server-enforced analytics consent | **Implemented + automated evidence** | `app/api/events/route.ts` validates saved opt-in at write time and rejects identity fields; race/aggregate behavior is covered by `tests/analytics-api.test.ts`. |
| Bounded retention, legal holds, manual runs, and durable heartbeat | **Implemented + automated evidence** | `app/retention-policy.ts`, operations/legal-hold APIs, and the scheduled Worker path enforce bounded pages and expose failed/missed/stalled runs. Covered by retention, backlog, legal-hold, operations, and health tests. |
| Independent monitoring and incident delivery | **Implemented for controlled beta; live notification and public-cadence evidence required** | `.github/workflows/monitor-production.yml` probes every six hours and opens/deduplicates/closes GitHub incidents through the public repository's hosted Actions. The monitor is mode-aware but defaults to strict public readiness. Repository variables, owner notification settings, simulated failure, and observed delivery must be evidenced live; a second provider/region and materially faster detection remain required before a public SLO. |
| Controlled beta without transactional email/support delivery | **Implemented + automated contract; provider-plan evidence is external** | `LAUNCH_MODE=controlled-beta` may return HTTP 200 only when Paretto ID creation, sign-in, recovery codes, Turnstile, database/schema, retention, and queues are healthy. A declared `WORKERS_PLAN=free` is allowed only for this evaluation contract because Cloudflare Free permits 10 ms CPU/request while the intentionally strong password KDF is heavier. It always reports `productionReady:false` with explicit launch-mode and optional-delivery limitations. The declaration does not prove the provider subscription. |
| Strict public launch | **Implemented + automated evidence; paid-runtime and live evidence required** | `LAUNCH_MODE=public` requires `WORKERS_PLAN=paid`, the Paretto ID/recovery security contract, healthy operations, and strict smoke. Passwords use a versioned Web Crypto HMAC-peppered PBKDF2-SHA256 verifier at Cloudflare’s 100,000-iteration ceiling; the pepper remains separate from D1. Support email is optional because requests remain in the authenticated administrator queue; if configured, all delivery settings must form one valid set. |
| Production deployment and post-deploy smoke | **Implemented; live run and external repository controls required** | `.github/workflows/deploy.yml` permits production only from a `v*` tag, verifies the tag SHA is reachable from `main` and has a successful complete seven-job `CI` run before protected secrets, rejects a public/Free declaration before browser work, reruns browser/release gates, propagates and validates the declared plan/config/secrets, proves migration 0013 and the v3 password-verifier contract cannot strand a credential account, captures backup evidence before migration, deploys through the guard, and finishes with GET-only mode-aware smoke. Protected-tag policy, separate provider proof for Workers Paid, and a passing live deployment tied to the exact commit remain external evidence gates. |
| Restore rehearsal and off-device backup | **Workflow capture implemented; human/external gate** | Production deploy captures Time Travel plus an encrypted export and manifest before migration. An operator must download approved long-lived evidence before expiry and complete a current non-production restore rehearsal. |
| Custom domain, independent support mailbox, and transactional sender | **Human/external/provisioning gate** | Requires domain ownership, DNS, provider verification, mailbox owner, and delivery tests. Controlled beta deliberately does not pretend these are present. |
| MFA/SSO and administrator staffing | **Partially implemented; broad-launch gate** | Distinct per-admin high-entropy credentials and two-person publishing are supported. MFA/SSO is not implemented. Broad CMS/public operations require two named people and whatever stronger access policy the operator/legal/security review approves. |
| Dependency advisories | **Time-bounded non-runtime acceptance** | Production runtime audit remains a hard zero-findings gate. The nine development-tool records for GHSA-mh99-v99m-4gvg are governed by `docs/DEPENDENCY-RISK-ACCEPTANCE.md` through 8 August 2026 and must be rechecked or resolved before expiry; no forced audit fix is authorized. |
| Indian legal and operator approval | **Human/external gate** | The product includes privacy, terms, cookies, accessibility, attribution, deletion/export, retention, and launch checklists. Indian counsel/operator approval is not automatable and must be recorded using `docs/LEGAL-LAUNCH-CHECKLIST.md`. |

## Test and device acceptance

| Requirement | Current acceptance status | Boundary |
| --- | --- | --- |
| Committed full-browser suite | **Implemented + automated evidence** | Worker-backed Playwright journeys build the production artifact, migrate isolated D1, and run in Chromium, Firefox, and WebKit. |
| Windows platform automation | **Implemented + automated evidence** | All current HTTPS Chromium journeys run on a Windows Server hosted runner against the direct Miniflare backend and disposable Node TLS boundary, including fresh public account creation, recovery, sign-in/claim, synchronization, and deletion coverage. Per-run lifecycle logs are retained. This does not certify Windows 11, Edge, high contrast, Narrator, or physical hardware. |
| Native CI beyond Debug guest mode | **Implemented + automated evidence** | Swift core/app tests, Staging XCTest, iPhone/iPad simulator tests, and an unsigned Release bundle inspection run in CI. This does not replace signed archive/TestFlight/Apple-server testing. |
| Physical browser/device/accessibility matrix | **Human/external gate** | Current Safari, Edge, Firefox, iPhone/iPad, Android, VoiceOver, high contrast, Narrator, orientation, split view, and real audio behavior remain unpassed until executed on the stated environments. Playwright emulation must not be substituted. See `docs/RELEASE-QA.md`. |

## Deliberately outside the v1.4 controlled-beta claim

- Subscriptions and entitlements: there is no paid plan or billing promise.
- A real social leaderboard: sample/fake league UI is not shipped.
- Richer boss mechanics, a larger treasure catalogue, and a fully interactive
  world map: optional roadmap work, not release blockers for core learning.
- Web push/session reminders: no “coming soon” promise; native reminder support
  exists, but web permission/delivery work is not claimed.
- Android native application: responsive web coverage exists; a native Android
  app does not.
- Additional languages: `app/course-catalog.ts` and CMS identity/taxonomy form a
  multi-course foundation, but only French is published. No second-language
  curriculum or language-specific pedagogy is claimed.

## Release decision rule

A controlled-beta deployment may proceed only from an exact owner-accepted or
independently reviewed commit whose release, browser, config, secret,
migration, backup, and `--mode controlled-beta` smoke gates pass. An
owner-operated decision must be recorded and must not be represented as
independent review. It remains a no-go for broad public launch while
`productionReady` is false.

A public launch additionally requires a declared `WORKERS_PLAN=paid`, separate
Cloudflare account evidence that Workers Paid is actually active, strict
`--mode public` smoke, an owned support-response process, distinct operational owners, current
backup/restore evidence, human French editorial approval, legal/operator
approval, and the physical device/accessibility matrix. App Store distribution
also requires the Apple/TestFlight gates above.
