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
          Paretto stores an offline progress queue and a small set of interface
          preferences in first-party browser storage. This lets a lesson survive
          a refresh or a temporary loss of connectivity. The data is isolated to
          the Paretto origin and is not available to unrelated websites.
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
          Administrators receive a separate, strictly necessary HttpOnly,
          Secure, SameSite=Strict cookie after successful sign-in. It expires
          after eight hours. Cloudflare Turnstile may use strictly necessary
          challenge storage when you submit Support; it is used for
          abuse-prevention, not advertising.
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
          record and this browser&apos;s offline progress copy. Browser settings can
          also clear site storage, but doing so before queued work synchronizes
          may discard local-only work and disconnect the anonymous browser
          profile from its server record.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
