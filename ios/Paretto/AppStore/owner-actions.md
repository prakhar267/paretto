# Owner actions after Apple membership and domain purchase

Everything in this directory can be prepared before enrollment. These actions
cannot be completed without the account owner:

1. Enroll in the Apple Developer Program and accept the current agreements.
2. Confirm that “Paretto” is available in App Store Connect. If Apple rejects
   the name as unavailable, change only the store display name; keep the bundle
   identifier stable.
3. Register `com.paretto.app`, enable Sign in with Apple, select the Apple Team
   in Xcode, and create the App Store Connect record with SKU
   `PARETTO-IOS-001`.
4. Add a real App Review contact name, phone number, and email in App Store
   Connect. Keep those personal details out of the public repository.
5. Configure the Sign in with Apple server key and production secrets using the
   runbook in `docs/APP-STORE-LAUNCH.md`; never commit the private key.
6. Upload a signed archive, run TestFlight on a real iPhone and iPad, confirm
   the prepared accessibility answers against that binary, and submit.
7. After purchasing a domain, attach it to the production Worker, verify HTTPS,
   then replace the three metadata URLs and Apple web return-domain settings.

No Apple password, verification code, recovery key, certificate private key, or
private `.p8` key should be sent to Codex or stored in Git.
