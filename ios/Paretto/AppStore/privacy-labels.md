# App Privacy answers

These answers describe the iOS 1.5.1 binary. The separate website has its own
opt-in analytics behavior.

## Tracking

- Data used to track the user: **No**
- Data linked across third-party apps or websites for advertising: **No**
- Advertising identifier accessed: **No**

## Data linked to the user

| App Store Connect data type | Purpose | Notes |
| --- | --- | --- |
| Contact Info → Name | App Functionality | Optional Apple display name or the learner’s chosen profile name |
| Contact Info → Email Address | App Functionality | Optional Apple private-relay or account email; never shown to other learners |
| Identifiers → User ID | App Functionality | Opaque Apple/provider and Paretto account identifiers |
| Identifiers → Device ID | App Functionality | Per-install replica identifier used for conflict-safe progress merging; not an advertising ID |
| Usage Data → Product Interaction | App Functionality | Lesson progress, preferences, review state, and session summaries |
| User Content → Gameplay Content | App Functionality | Challenge, collectible, dice, and reward progress |

Every listed type is linked only when the learner chooses an account. Guest
progress remains on device. None is used for third-party advertising, developer
advertising, marketing, analytics, or personalization outside the learning
features.

## Data not collected by the iOS binary

Payment information, financial information, precise or coarse location, contacts,
photos or videos, audio recordings from the user, health or fitness data,
browsing history, search history, diagnostics, purchases, sensitive information,
and other user-generated content are not collected.

## Required manifest alignment

`ParettoApp/PrivacyInfo.xcprivacy` declares no tracking, the six linked
app-functionality categories above, and UserDefaults reason `CA92.1`.
`ITSAppUsesNonExemptEncryption` is `false`; the app relies on Apple platform
encryption and does not implement non-exempt export-controlled encryption.
