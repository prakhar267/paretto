# Paretto App Store launch

## Local build status

The native source is separate from the React web interface and lives in
`ios/Paretto`. XcodeGen has produced `Paretto.xcodeproj`; the application reuses
the verified 18-region curriculum, 270 packaged audio clips, learning rules, and
native API contracts. `ParettoCore` can be built and tested with the Swift command
line before the full Xcode application toolchain is available.

The release workstation has full Xcode 26.6 (build 17F113) on macOS 26.5.2,
including the iOS 26.5 Simulator runtime. iPhone 17 Pro and iPad Pro 13-inch
(M5) simulator destinations are available for local build and test evidence.
The system-wide developer selector may still point to Command Line Tools, so
release commands set
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` explicitly.

Signing, Sign in with Apple, archiving, TestFlight upload, and App Store
submission require the account owner's Apple Developer configuration and
interactive approval. App Store publication is intentionally deferred for this
release. Never send an Apple password, recovery key, or verification code to a
developer or automation tool.

`com.paretto.app` is a clean pre-release bundle-identifier cutover. If any build
under the retired identifier is ever distributed to real users, stop and design
a signed shared-container/Keychain migration before release; the in-repository
legacy probes alone cannot cross normal iOS sandbox boundaries.

## Inputs required from the account owner

- Active Apple Developer Program membership and acceptance of current agreements.
- Confirmation that the final bundle identifier is `com.paretto.app`, or the
  replacement identifier before any provisioning profile or App Store record is made.
- Apple Developer Team ID selected inside Xcode.
- App Store Connect app record, primary language, name, subtitle, category,
  territories, pricing, copyright owner, and age-rating answers.
- Legal operator name, address, public support contact, privacy-policy URL, and
  support URL. These must be real operator facts; this repository does not invent them.
- App Review contact details and a reachable staging account or review path.
- Final decision on optional analytics and any future monetization. Adding billing
  changes the privacy, terms, tax, review, and StoreKit scope.
- Human French-editor signoff for text, IPA, cultural statements, and every audio clip.

## Apple configuration

1. Register the App ID matching the bundle identifier.
2. Enable Sign in with Apple for that App ID and the Xcode target.
3. Create a Sign in with Apple `.p8` key and record its Key ID and the account
   Team ID. Set server `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, and `APPLE_KEY_ID` to
   those exact registered values; store the full `.p8` as `APPLE_PRIVATE_KEY` in
   the hosting secret manager. Never put it in Git or a local xcconfig.
4. Create separate random `NATIVE_SESSION_SECRET` and
   `APPLE_TOKEN_ENCRYPTION_SECRET` values of at least 32 characters in the hosted
   secret manager. The latter protects Apple refresh tokens used for account
   deletion; rotation requires a credential re-encryption plan.
5. Configure Debug, Staging, and Release API base URLs in an uncommitted xcconfig.
6. Select the development team, allow Xcode to create development provisioning,
   and repeat the unsigned test suites on the available iPhone and iPad
   simulators before creating a signed build.
7. Create a signed staging archive, validate it in Xcode Organizer, upload to
   TestFlight, and complete internal testing before App Review.

The server flow follows Apple's official
[authorization-code validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens)
and [account-deletion revocation guidance](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple).

## Current privacy-label starting point

This is a submission worksheet, not legal advice. Confirm it against the exact
binary and provider behavior in App Store Connect.

- Data linked to the user for app functionality: opaque user identifier, optional
  Apple relay email/display name, learning progress, preferences, and session history.
- The native iOS client emits no product-analytics events and exposes no analytics
  toggle. The web app's opt-in analytics is a separate surface; do not include it
  in the iOS privacy label unless the submitted binary's behavior changes.
- Data not used for tracking, targeted advertising, or sale.
- No microphone capture, precise location, contacts, photos, health, or payment data.
- Account deletion is available in Profile, revokes the stored Sign in with Apple
  refresh token, and removes the native account, synchronized progress, sessions,
  encrypted Apple credential, and on-device progress.
- The target declares no use of non-exempt encryption. Reconfirm this if networking or
  cryptographic features change.

## Store assets and review evidence

- The asset catalog contains an opaque 1024×1024 App Store icon.
- Capture real screenshots from the current iPhone and iPad simulators after final
  copy review; do not submit design mockups as evidence of runtime behavior.
- Test onboarding, one full lesson, review, wordbook, reminder permission, offline
  relaunch, sync conflict, export, deletion, Dynamic Type, reduced motion, and VoiceOver.
- Attach the exact release commit, CI URL, Xcode version, simulator/device matrix,
  archive version/build, privacy answers, editor approval, and known limitations to
  the release evidence.

## App Review notes template

> Paretto is a French-learning app with 54 short lessons and 270 packaged
> pronunciation clips. Release builds require an initial Sign in with Apple. After
> that sign-in, lessons and progress work offline on device and synchronize when
> connectivity returns. The iOS app emits no product analytics or tracking events.
> Account and synchronized-data deletion are available at Profile → Delete account
> and learning data. No purchase or subscription is present in this version.

Replace the review contact, staging URL, and any required review steps in App Store
Connect; do not put credentials in source control or this document.
