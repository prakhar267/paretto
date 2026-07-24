import {
  LegalDocument,
  LegalSection,
  OPERATOR_NAME,
  OPERATOR_POSTAL_ADDRESS,
} from "../legal-document";

export const metadata = {
  title: "Privacy & data — Loquivo",
  description: "How Loquivo collects, protects, retains, and deletes data.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      eyebrow="Privacy & data"
      title="A useful learning record, with a deliberately small data footprint."
      intro="This notice explains what Loquivo processes, why it is needed, and the controls available to every learner."
    >
      <LegalSection title="Information we process">
        <p>
          Loquivo stores the display name you choose, vocabulary progress,
          review schedules, session history, rewards, streaks, and learning
          preferences. The browser keeps an origin-isolated offline copy so a
          weak connection cannot erase an unfinished lesson.
        </p>
        <p>
          If you contact support, we store the category, subject, message,
          ticket status, an opaque account reference, and—only if you choose to
          provide it—a reply email address. Do not include passwords, payment
          data, health information, or other sensitive data in a support message.
        </p>
      </LegalSection>

      <LegalSection title="Account identity and security">
        <p>
          The web app creates a random, high-entropy identifier in a strictly
          necessary, HttpOnly first-party cookie. Before progress, support, or
          optional product events reach the database, Loquivo combines that
          random value with a server secret to create a one-way learner key.
          The raw cookie value is not stored in those tables. This anonymous
          browser profile does not contain a sign-in email and does not
          currently synchronize to another browser or device.
        </p>
        <p>
          A reply address explicitly entered into the support form is stored
          with that request so the team can respond. Cloudflare Turnstile also
          processes challenge, browser, network, and IP information to distinguish
          people from automated abuse. Loquivo validates the challenge for
          this site and form action; it does not store the challenge token.
        </p>
        <p>
          Administrative tools require an allowlisted email and a generated
          high-entropy access key. The server stores only a one-way verifier,
          issues an HttpOnly signed session lasting up to eight hours, and
          rate-limits attempts using a keyed hash of the connecting IP address.
          Administrative changes are recorded in an audit trail. Reasonable
          technical safeguards are used, but no internet service can promise
          absolute security.
        </p>
      </LegalSection>

      <LegalSection title="How information is used">
        <ul>
          <li>Deliver lessons, calculate reviews, sync this browser session, and recover queued offline work.</li>
          <li>Respond to support requests and protect the service from abuse.</li>
          <li>Maintain published curriculum and record accountable editorial changes.</li>
          <li>
            Measure a small set of product interactions only when you enable
            optional product analytics in your preferences.
          </li>
        </ul>
        <p>
          Information is not sold, used for targeted advertising, or disclosed
          to other learners. Loquivo does not record or upload your microphone.
        </p>
      </LegalSection>

      <LegalSection title="Audio and product analytics">
        <p>
          Pronunciation first uses packaged French audio when available. If an
          asset is unavailable, the app can use the device&apos;s French speech
          service. That fallback is controlled by the device or browser and may
          be processed by its provider under the provider&apos;s settings.
        </p>
        <p>
          Optional analytics contain an allowlisted event name, coarse product
          context, timestamps, and an opaque account reference. They do not
          contain lesson answers, free-form profile text, email addresses, or
          advertising identifiers. Analytics can be disabled at any time.
          The server checks the saved account preference before accepting each
          optional event; changing only a browser request cannot bypass consent.
        </p>
      </LegalSection>

      <LegalSection title="Service providers and international processing">
        <p>
          Cloudflare provides hosting, database, delivery, and abuse-prevention
          services. Its infrastructure may process information in countries
          other than the learner&apos;s own. Where applicable, the operator relies
          on the provider&apos;s contractual and security safeguards for those
          transfers.
        </p>
      </LegalSection>

      <LegalSection title="Retention and deletion">
        <p>
          Learning progress is retained until it is deleted through the browser
          profile or becomes eligible under an applicable operational retention
          rule. Clearing the learner cookie alone disconnects the browser from
          its pseudonymous server record and is not a deletion request.
          Hashed administrator sign-in attempt records become eligible for
          bounded deletion after 24 hours.
          Optional product events become eligible for automatic deletion 400
          days after receipt. Resolved or closed support requests and
          administrative audit records become eligible 730 days after their
          last update or creation unless a longer period is required for
          security, disputes, or law.
        </p>
        <p>
          A daily maintenance job removes eligible records in bounded batches,
          with a throttled
          request-time cleanup as a fallback. A provider or database outage can
          delay a run; the next successful run clears the expired backlog and
          operations alerts track failures.
        </p>
        <p>
          A documented legal or security preservation requirement can place a
          specific record, account reference, entity, or data class on hold.
          Held records are excluded from deletion until an authorized operator
          records a reason for releasing the hold; both actions are audited.
        </p>
        <p>
          “Delete my learning data” removes the primary progress record and the
          current browser&apos;s offline copy. Support or legal records are handled
          separately because they may need to preserve an existing request or
          compliance record. Infrastructure recovery copies may remain for a
          limited provider backup cycle before expiring.
        </p>
        <p>
          When native account synchronization is enabled in a future app
          release, “Delete account and learning data” will remove the
          native account, synchronized progress, active sessions, and encrypted
          Apple credential in addition to the on-device copy. The service first
          asks Apple to revoke the associated refresh token. A temporary Apple
          outage reports an error so revocation can be retried; an already invalid
          credential does not strand deletion of the local account data.
        </p>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <p>
          You can export progress, disable audio, IPA, motion, or analytics, and
          delete learning progress from Profile. Depending on local law, you may
          also request access, correction, restriction, objection, portability,
          or deletion through Support. Identity may need to be verified before
          fulfilling an account request.
        </p>
      </LegalSection>

      <LegalSection title="Operator and privacy contact">
        <p>
          {OPERATOR_NAME} operates this service from{" "}
          {OPERATOR_POSTAL_ADDRESS}. Use the Support page for privacy questions,
          access or deletion requests, and complaints. The form accepts an
          optional reply address and records the request so it can be reviewed
          and resolved.
        </p>
      </LegalSection>

      <LegalSection title="Children and changes">
        <p>
          Loquivo is not directed to children under 13. Where local law sets
          a higher age for independent consent, a parent or guardian must
          authorize use. Material privacy changes will be dated here and, when
          appropriate, highlighted inside the product.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
