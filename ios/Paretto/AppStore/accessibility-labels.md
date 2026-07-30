# Accessibility Nutrition Label worksheet

Evaluate all common tasks in the exact uploaded build before saving these
answers in App Store Connect. The repository’s automated checks establish the
implementation baseline but do not pretend to be a human assistive-technology
certification.

## Prepared support claims

| Feature | Prepared answer | Release evidence |
| --- | --- | --- |
| Larger Text | Supports | Dynamic Type is used throughout; onboarding launches at accessibility XXXL in UI tests; dense layouts switch vertically |
| Reduced Motion | Supports | System Reduce Motion and the in-app reduced-motion preference remove app animations |
| Sufficient Contrast | Supports | Branded foreground/background pairs and system semantic colors are used; final uploaded screens still require visual confirmation |
| Differentiate Without Color Alone | Supports | State and actions use text, symbols, labels, disabled state, and progress values rather than color alone |
| VoiceOver | Supports after final evaluation | Controls use native SwiftUI semantics, explicit labels, hints, headings, and stable navigation; complete the Apple common-task pass before selecting |
| Voice Control | Supports after final evaluation | Interactive controls have visible or explicit accessible names; complete the Apple common-task pass before selecting |
| Captions | Not applicable | The app has no video or spoken instructional track; French word audio is paired with visible French text, IPA, and translation |
| Audio Descriptions | Not applicable | The app has no video content |

## Common-task script

1. Start as a guest and complete onboarding.
2. Start a lesson, play pronunciation audio, reveal all five cards, and finish.
3. Open Review, Wordbook, Journey, Challenge, Travel Dice, and Profile.
4. Schedule and remove a reminder.
5. Start Sign in with Apple, cancel safely, and return to the same context.
6. Confirm sign-out and delete-account dialogs expose their purpose and Cancel.
7. Export learning data.
8. Repeat at the largest supported Dynamic Type size and with Reduce Motion.

Do not claim VoiceOver or Voice Control in App Store Connect until the exact
signed candidate completes this script without an inaccessible blocker.
