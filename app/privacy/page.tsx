import { LegalDocument, LegalSection } from "../legal-document";

export const metadata = {
  title: "Privacy & data — Pas à Pas",
  description: "How Pas à Pas collects, protects, retains, and deletes data.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      eyebrow="Privacy & data"
      title="A useful learning record, with a deliberately small data footprint."
      intro="This notice explains what Pas à Pas processes, why it is needed, and the controls available to every learner."
    >
      <LegalSection title="Information we process">
        <p>
          Pas à Pas stores the display name you choose, vocabulary progress,
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
          The hosting platform provides the signed-in email address with each
          authenticated request. Before progress or product events reach the
          database, Pas à Pas converts that address into a keyed, one-way
          account identifier. The platform-provided account email is not
          automatically stored in learning, analytics, or support tables. A
          reply address explicitly entered into the support form is stored with
          that request so the team can respond.
        </p>
        <p>
          In the native iPhone and iPad app, Sign in with Apple provides an
          opaque Apple account identifier and may provide a relay email and
          display name. Pas à Pas stores a keyed form of the Apple identifier
          with that optional relay email and display name so it can maintain and
          present the native account. These account details are retained while
          the native account is active and removed when the account is deleted.
          Pas à Pas also hashes native session tokens before database storage,
          encrypts the Apple refresh token needed for account revocation, and
          keeps the usable Pas à Pas session token in the device Keychain.
        </p>
        <p>
          Administrative tools require both a signed-in identity and a
          server-controlled allowlist. Administrative changes are recorded in
          an audit trail. Reasonable technical safeguards are used, but no
          internet service can promise absolute security.
        </p>
      </LegalSection>

      <LegalSection title="How information is used">
        <ul>
          <li>Deliver lessons, calculate reviews, sync devices, and recover offline work.</li>
          <li>Respond to support requests and protect the service from abuse.</li>
          <li>Maintain published curriculum and record accountable editorial changes.</li>
          <li>
            Measure a small set of product interactions only when you enable
            optional product analytics in your preferences.
          </li>
        </ul>
        <p>
          Information is not sold, used for targeted advertising, or disclosed
          to other learners. Pas à Pas does not record or upload your microphone.
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
          Hosting, database, authentication, and delivery providers process
          information only to operate Pas à Pas. Their infrastructure may
          process information in countries other than the learner&apos;s own. Where
          applicable, the operator relies on the provider&apos;s contractual and
          security safeguards for those transfers.
        </p>
      </LegalSection>

      <LegalSection title="Retention and deletion">
        <p>
          Learning progress is retained while the account uses the service.
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
          In the native app, “Delete account and learning data” removes the
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

      <LegalSection title="Children and changes">
        <p>
          Pas à Pas is not directed to children under 13. Where local law sets
          a higher age for independent consent, a parent or guardian must
          authorize use. Material privacy changes will be dated here and, when
          appropriate, highlighted inside the product.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
