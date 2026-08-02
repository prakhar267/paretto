# Paretto for iPhone and iPad

This is the native SwiftUI client. It shares the verified curriculum, audio,
learning rules, and Cloudflare API contract with the web application while
using native navigation, accessibility, audio, notifications, offline storage,
Keychain sessions, and Sign in with Apple.

The native product includes onboarding, the 18-region journey, 54 five-card
lessons, learned-only review, the wordbook, Château Challenge, once-daily
Travel Dice, the collectible carnet, reminders, data export, and in-app account
deletion. Layouts adapt between compact iPhone tabs and an iPad split view, and
large accessibility text switches dense horizontal controls to vertical layouts.
The Release gate also inspects the built application bundle and requires all
270 pronunciation WAV files under `fr/v2`, matching the lookup derived from the
course audio prefix; a missing asset fails CI instead of silently shipping only
speech synthesis.

## Generate and test

1. Install the full Xcode application and an iOS Simulator runtime.
2. Run `npx tsx scripts/export-ios-curriculum.ts` from the repository root.
3. Run `xcodegen generate --spec ios/Paretto/project.yml`.
4. Open `ios/Paretto/Paretto.xcodeproj` and run the `Paretto` scheme.
5. Core rules can be verified without Xcode using
   `swift test --package-path ios/ParettoCore`.
6. The complete SwiftUI source set and app integration tests can be built on
   macOS without the iOS SDK using `swift test --package-path ios/Paretto`.
7. With Xcode installed, run the native unit and UI suites with:

   ```sh
   xcodebuild \
     -project ios/Paretto/Paretto.xcodeproj \
     -scheme Paretto \
     -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
     test
   ```

Debug builds use the locally running web service at `http://localhost:3000`.
Private on-device guest learning is available in every configuration; Sign in
with Apple adds account access and supported cross-device synchronization.
Staging and production builds require their corresponding API URL build setting
and never silently fall back to a placeholder host.

`Configuration/Shared.xcconfig` is tracked and attached to Debug, Staging, and
Release. The tracked Staging and Release defaults point at the corresponding
Cloudflare Worker origins and can be replaced by an ignored local override:

```sh
cp ios/Paretto/Configuration/Local.xcconfig.example \
  ios/Paretto/Configuration/Local.xcconfig
```

Replace both example origins in that local file only when testing a different
deployment. Missing local configuration does not break project generation or
compilation. At runtime, Staging and Release reject empty, unresolved,
credential-bearing, or non-HTTPS URLs. A valid URL alone does not enable native
sign-in: each environment must set `NATIVE_API_ENABLED=true`, provide the
complete Apple credential and independent native-secret set, apply migration
0014, and report `nativeReady: true` before signed distribution.

Sign in with Apple requires the app identifier and capability to be enabled in
the owner's Apple Developer account before signed-device or TestFlight use.
Never commit Apple credentials, signing certificates, session tokens, or a
populated local configuration file.

The bundle identifier changed before the first public or TestFlight
distribution, so Paretto is a clean pre-release cutover. Compatibility probes
for older development-state paths and Keychain service names remain covered by
tests, but they are not a promise of cross-bundle migration: iOS sandboxes and
Keychain access groups prevent a differently signed app from reading that data
unless an explicit shared-container migration is provisioned first.

Every Apple authorization request uses a cryptographically random nonce. The
SHA-256 base64url digest is sent to Apple and the raw nonce is sent once to the
backend for identity-token verification. Native sessions are stored with
`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and are removed during sign-out
and account deletion.

## Shared account migration

The native service uses the exact verified Apple provider subject to create or
match the Better Auth provider record. It never joins accounts merely because
their email addresses match. When that provider identity is linked:

- native and web clients address the same canonical `learning_state` row;
- an existing native-only snapshot is merged once with optimistic revision
  checks, then the legacy row is removed only after the canonical write is
  observable;
- web-only consent and dice-receipt fields are preserved during native saves;
- native-only session detail is never fabricated from the web's summary shape;
- deletion from either client revokes Apple authorization and clears native
  sessions, credentials, local progress, canonical progress, and account data.

If a verified Apple email is already owned by a different Better Auth account
without the same Apple provider subject, linking fails safe as native-only.
Connecting that Apple identity through the web and signing in again is the
explicit migration path.

The native client does not send product analytics events and exposes no
analytics opt-in control. `LearningSettings.analytics` remains in the encoded
state with a default of `false` only so earlier local state and the shared API
schema continue to decode safely.

## Release configuration

- Set `PARETTO_STAGING_API_BASE_URL` and `PARETTO_PRODUCTION_API_BASE_URL` to
  HTTPS origins. Release builds deliberately reject an unresolved or non-HTTPS
  service URL.
- Configure backend `APPLE_CLIENT_ID`, Apple server credentials,
  `APPLE_TOKEN_ENCRYPTION_SECRET`, `NATIVE_SESSION_SECRET`, and the canonical
  `USER_KEY_SECRET` before changing `NATIVE_API_ENABLED` to `true`.
- Enable Sign in with Apple for `com.paretto.app`, select the correct
  development team, and use distribution-managed signing for archives.
- Keep the backend native progress validator synchronized with
  `LearningState`, including challenge sessions, collectibles, challenge state,
  and dice state.
- Verify the bundled privacy manifest, in-app Privacy/Terms/Support links,
  App Store privacy answers, screenshots, and age rating against the deployed
  production service before submission.
- Run the Xcode unit/UI suites on current iPhone and iPad simulators, then smoke
  test Sign in with Apple, audio, reminders, VoiceOver, export, offline relaunch,
  sync conflict recovery, and account deletion on signed physical devices.
