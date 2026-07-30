# Paretto v1.5 product acceptance matrix

This matrix records the 1.5 release delta and inherits the still-applicable
security, curriculum, CMS, privacy, operations, and deployment boundaries from
the v1.4 matrix. It describes verified source and local release evidence. It is
not a claim that Apple membership, signing, TestFlight, a custom domain, or a
new production deployment exists before those steps are actually completed.

## Release identity

| Requirement | Status | Evidence |
| --- | --- | --- |
| One consistent release identity | **Implemented + automated evidence** | Web, health endpoint, XcodeGen, generated Xcode project, and App Store metadata agree on version 1.5.0, native build 12, bundle identifier `com.paretto.app`, and planned tag `v1.5.0`. `npm run version:verify` fails on drift. |
| App Store metadata package | **Implemented + automated evidence** | `ios/Paretto/AppStore` contains localized name, subtitle, description, promotional text, keywords, release notes, production URLs, review notes, privacy answers, age-rating answers, and an accessibility worksheet. `npm run appstore:verify` enforces Apple field limits and rejects placeholders. |
| Store icon and screenshots | **Implemented + runtime evidence** | The opaque 1024×1024 icon is validated from the asset catalog. Four real runtime screenshots each for iPhone 6.9-inch and iPad 13-inch are generated at Apple-supported dimensions by `npm run appstore:screenshots`; mockups are not substituted. |

## Account and access journeys

| Requirement | Status | Evidence |
| --- | --- | --- |
| A learner can use the product without an account | **Implemented + automated evidence** | Web and every native configuration permit guest learning. The iOS first-run screen offers optional Sign in with Apple alongside local onboarding; account access adds synchronization rather than unlocking lessons. |
| Sign-in links open the intended action | **Implemented + automated evidence** | The web account screen opens in Sign in mode. Create account is a distinct explicit action. Server-rendered return routing accepts only the root or Profile destination and rejects external, protocol-relative, admin, or unknown redirects. |
| Account connection returns to context | **Implemented + automated evidence** | Profile account links carry a validated Profile return destination through Paretto ID and social callbacks, anonymous-progress claim, and the connected-account handoff. |
| Sign-out is deliberate and recoverable | **Implemented + automated evidence** | Web and iOS require confirmation, expose Cancel first, disable duplicate actions while pending, restore focus after cancellation, and preserve the open account if secure local session removal fails. Successful sign-out clears account-scoped local state and starts a fresh private profile. |
| Reauthentication does not strand the learner | **Implemented + automated evidence** | Expired/revoked native sessions route to a clear reauthentication screen. The learner may continue with Apple or deliberately begin a separate private profile. Revoked account progress is quarantined to prevent cross-account leakage. |
| Guest progress survives account connection | **Implemented + automated evidence** | Native guest state is rebound to the verified immutable account scope before Keychain persistence and first sync. Offline post-sign-in work survives relaunch and cannot leak into another or recreated account. |
| Account errors are accessible | **Implemented + automated evidence** | Web errors receive programmatic focus and live alert semantics. Mode changes focus the new form heading. Native controls use system semantics, accessible labels/hints, and an explicit in-progress state. |

## Native release readiness

| Requirement | Status | Evidence and boundary |
| --- | --- | --- |
| Current Apple upload toolchain | **Verified locally** | Xcode 26.6 (build 17F113) and iOS 26.5 simulator runtime are installed, satisfying Apple’s announced iOS 26 SDK submission baseline. |
| iPhone native suite | **Passed locally** | All 27 Swift integration tests passed. Seven iPhone UI cases completed with no failure: six passed, and the debug-only signed-out tagline case was intentionally skipped after the verified guest-onboarding entry screen appeared. Coverage includes onboarding, first lesson, female packaged audio, Dynamic Type launch, Challenge, Travel Dice, and reproducible store capture. |
| iPad layout and store capture | **Passed locally** | The adaptive split-view navigation completed the real onboarding, Today, Journey, and Lesson screenshot journey on iPad Pro 13-inch (M5). |
| Packaged French audio | **Implemented + automated evidence** | The native bundle maps all 270 curriculum entries to packaged `fr/v2` WAV files. UI automation verifies the first lesson starts the declared high-quality French female recording. |
| Signing and upload | **Owner/external gate** | Apple Developer enrollment, App ID registration, Team selection, provider secrets, signed archive, TestFlight, and App Store submission cannot occur before membership and account-owner approval. |

## Website release readiness

| Requirement | Status | Evidence and boundary |
| --- | --- | --- |
| Browser and account acceptance | **Passed locally** | The production Worker artifact, isolated migrated D1, and HTTPS boundary ran 48 project cases: 46 passed across Chromium, Firefox, and WebKit, with only the two declared Chromium-only offline-shell cases skipped in the other engines. |
| Windows-hosted compatibility | **Implemented in CI** | The complete Chromium journey runs on the hosted Windows job against the direct Miniflare backend and disposable HTTPS proxy. This remains compatibility automation, not physical Windows/Edge/Narrator certification. |
| Accessibility baseline | **Implemented + automated evidence** | Critical public/account pages pass serious automated accessibility scans; focus restoration, error focus, modal cancellation, phone fit, 200% text, and reduced motion are covered. App Store VoiceOver and Voice Control claims remain gated on the exact signed candidate’s common-task evaluation. |
| Production URLs before custom domain | **Prepared** | Store metadata uses the existing verified HTTPS Worker origin. After domain purchase and TLS verification, the three metadata URLs and Apple web return-domain configuration must be updated together. |
| Deployment | **Release workflow required** | Only an exact reviewed/tagged commit with green CI can deploy production. A local pass does not replace the GitHub exact-SHA gate or post-deploy smoke evidence. |

## App Store owner-only actions

The repository is ready up to the account boundary. The owner must later:

1. enroll and accept Apple agreements;
2. confirm store-name availability and create the App Store Connect record;
3. register `com.paretto.app`, enable Sign in with Apple, and select the Team;
4. add private App Review contact details in App Store Connect;
5. provision the Apple server key and production native secrets;
6. upload a signed archive, complete TestFlight on real hardware, confirm final
   accessibility answers, and submit;
7. attach the purchased domain and replace the prepared production URLs.

Passwords, verification codes, recovery keys, signing keys, and Apple `.p8`
private keys must never be stored in Git or shared in chat.
