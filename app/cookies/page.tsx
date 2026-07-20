import { LegalDocument, LegalSection } from "../legal-document";

export const metadata = {
  title: "Cookies & local storage — Pas à Pas",
  description: "The device storage and necessary authentication used by Pas à Pas.",
};

export default function CookiesPage() {
  return (
    <LegalDocument
      eyebrow="Cookies & storage"
      title="No advertising trackers. Only the storage needed to keep learning dependable."
    >
      <LegalSection title="What the app uses">
        <p>
          Pas à Pas stores an offline progress queue and a small set of interface
          preferences in first-party browser storage. This lets a lesson survive
          a refresh or a temporary loss of connectivity. The data is isolated to
          the Pas à Pas origin and is not available to unrelated websites.
        </p>
      </LegalSection>

      <LegalSection title="Authentication">
        <p>
          The hosting or identity platform may use strictly necessary cookies to
          keep you signed in, prevent request forgery, and apply site-access
          rules. Pas à Pas does not read those cookies directly. Blocking them
          may prevent sign-in or synchronized progress from working.
        </p>
        <p>
          The native app does not use a browser cookie for its session. It stores
          a short opaque access token in the iOS Keychain; the server stores only
          a keyed hash of that token.
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
          may discard that local-only work.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
