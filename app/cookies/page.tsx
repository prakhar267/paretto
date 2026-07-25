import { LegalDocument, LegalSection } from "../legal-document";

export const metadata = {
  title: "Cookies & local storage — Paretto",
  description: "The device storage and necessary authentication used by Paretto.",
};

export default function CookiesPage() {
  return (
    <LegalDocument
      eyebrow="Cookies & storage"
      title="No advertising trackers. Only the storage needed to keep learning dependable."
    >
      <LegalSection title="What the app uses">
        <p>
          When the browser permits first-party storage, Paretto stores an
          offline progress queue and a small set of interface preferences. This
          lets a lesson survive a refresh or temporary loss of connectivity.
          The data is isolated to the Paretto origin and is not available to
          unrelated websites. If storage is blocked or unavailable, the app
          reports that condition instead of promising an offline copy.
        </p>
      </LegalSection>

      <LegalSection title="Authentication">
        <p>
          The web app sets a strictly necessary anonymous learner cookie for up
          to one year. It contains a random value, is unavailable to JavaScript,
          is sent only to this site, and lets the server locate this
          browser&apos;s learning journal. Clearing it disconnects that browser
          from the existing server record, so export or delete learning data
          before clearing site data if you need either action.
        </p>
        <p>
          If you sign in, Paretto sets a separate signed, HttpOnly learner
          session cookie for up to 30 days and refreshes it while the account is
          active. It is used only for account access and synchronized progress.
          Short-lived verification and password-reset records protect account
          workflows. Account abuse quotas are server-side one-way buckets that
          do not contain the raw IP, authentication path, or email. Expired
          records are removed in bounded maintenance batches.
        </p>
        <p>
          Administrators receive a separate, strictly necessary HttpOnly,
          Secure, SameSite=Strict cookie after successful sign-in. It expires
          after eight hours. Cloudflare Turnstile may use strictly necessary
          challenge storage when you submit Support; it is used for
          abuse-prevention, not advertising. Support IP quotas use a keyed,
          one-way server-side bucket and do not add a browser identifier.
        </p>
      </LegalSection>

      <LegalSection title="Optional analytics">
        <p>
          Product analytics are off unless you enable them in Profile. The
          application&apos;s analytics endpoint does not set an advertising cookie
          or use a cross-site identifier. Disabling analytics stops future
          optional product events; necessary operational and security logs may
          still be produced when the service handles a request.
        </p>
      </LegalSection>

      <LegalSection title="Your controls">
        <p>
          Use Profile to change analytics, audio, pronunciation, and motion
          preferences. “Delete my learning data” removes the server progress
          record and replaces this browser&apos;s offline progress copy with an
          empty reset marker. That marker contains only a reset number needed to
          reject stale offline copies from other tabs or devices. Signed-in learners
          can also sign out or delete the account and synchronized learning
          data. Browser settings can clear site storage, but doing so before
          queued work synchronizes may discard local-only work and disconnect
          an anonymous browser profile from its server record.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
