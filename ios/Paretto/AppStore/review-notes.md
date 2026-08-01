# App Review notes

Paretto is a French-learning app with 54 short lessons and 270 pronunciation
recordings packaged in the application.

An account is not required. On first launch, enter any first name and choose
“Start with Paris basics.” The first lesson is available from Today. Review,
Wordbook, Château Challenge, and Travel Dice unlock from vocabulary the reviewer
has learned.

Sign in with Apple is optional and adds secure account access and supported
cross-device synchronization. It does not unlock lessons. The submitted build
must be connected to the production service and its Apple capability before
review, but reviewers can exercise the complete local learning journey without
an Apple account.

The app has no advertising, subscription, in-app purchase, user-generated
content, or product analytics. All pronunciation audio is bundled and can play
offline. Learning progress is saved on device and queued for synchronization
when an authenticated learner is offline.

Account controls are in Profile:

- “Sign out” requires confirmation and clears the account session and private
  account-scoped data from the device.
- “Delete account and learning data” is available inside the app. It revokes
  the Paretto session, requests Sign in with Apple token revocation, deletes
  synchronized learning and account data, and clears local progress.
- “Export learning data” creates a JSON export of the learner’s local state.

Privacy Policy, Terms, and Support are linked from Profile. No special hardware
or review credentials are required for the guest learning path.
