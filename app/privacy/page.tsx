import {
  LegalDocument,
  LegalSection,
  OPERATOR_NAME,
  OPERATOR_POSTAL_ADDRESS,
} from "../legal-document";

export const metadata = {
  title: "Privacy & data — Paretto",
  description: "How Paretto collects, protects, retains, and deletes data.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      eyebrow="Privacy & data"
      title="A useful learning record, with a deliberately small data footprint."
      intro="This notice explains what Paretto processes, why it is needed, and the controls available to every learner."
    >
      <LegalSection title="Information we process">
        <p>
          Paretto stores the display name you choose, vocabulary progress,
          review schedules, session history, rewards, streaks, and learning
          preferences. When browser storage is available, Paretto keeps an
          origin-isolated offline queue so a weak connection does not erase an
          unfinished lesson. The app reports when the browser blocks that queue
          and does not describe an unconfirmed save as complete.
        </p>
        <p>
          If you create a learner account, Paretto also stores your account
          name, normalized email address, email-verification state, password
          verifier or linked identity-provider account, and security-session
          records. Plain-text passwords are never stored. Optional Google or
          Apple sign-in is offered only when that provider is configured.
        </p>
        <p>
          The native app assigns a random per-installation and per-account
          reward replica identifier and includes it with synchronized learning
          progress. It lets Paretto merge offline XP, coins, challenges, dice
          outcomes, and other saved learning-game state without duplicating
          rewards. It is not an advertising identifier and is not used for
          tracking.
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
          The web app first creates a random, high-entropy identifier in a
          strictly necessary, HttpOnly first-party cookie. Before anonymous
          progress, support, or optional product events reach the database,
          Paretto combines that value with a server secret to create a one-way
          learner key. The raw cookie value is not stored in those tables.
          When you sign in, Paretto securely connects that browser&apos;s
          learning record to the learner account and uses a separate signed,
          HttpOnly session cookie for cross-browser synchronization.
        </p>
        <p>
          Public email-and-password registration is available only when
          transactional email is configured, and production accounts always
          require email verification. A delivery outage does not make an
          unverified account eligible to sign in. Verification and reset links
          are short-lived. Existing verified learners can still sign in if
          registration is temporarily disabled. Authentication requests use an
          atomic quota keyed by a one-way hash of the connecting IP and
          authentication route; its limiter records do not store the raw IP,
          route, or submitted email. Account sessions expire, and deleting an
          account removes its synchronized learning record, product events, and
          associated support records in addition to the authentication record.
        </p>
        <p>
          A reply address explicitly entered into the support form is stored
          with that request so the team can respond. Cloudflare Turnstile also
          processes challenge, browser, network, and IP information to distinguish
          people from automated abuse. Paretto validates the challenge for
          this site and form action; it does not store the challenge token.
          Paretto also applies a separate hourly support quota using a keyed,
          one-way bucket derived only from Cloudflare&apos;s connecting-IP header.
          The support quota table does not store the raw IP address, reply
          address, or support message.
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
          to other learners. Paretto does not record or upload your microphone.
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
          services. When account or support email is enabled, Resend delivers
          verification, recovery, receipt, and status messages. If you choose
          Google or Apple sign-in, that provider processes the authorization
          request under its own terms. These providers may process information
          in countries other than the learner&apos;s own. Where applicable, the
          operator relies on their contractual and security safeguards for
          those transfers.
        </p>
      </LegalSection>

      <LegalSection title="Retention and deletion">
        <p>
          Learning progress is retained until it is deleted through the browser
          profile or becomes eligible under an applicable operational retention
          rule. Clearing the learner cookie alone disconnects the browser from
          its pseudonymous server record and is not a deletion request.
          Hashed administrator sign-in attempt records become eligible for
          bounded deletion after 24 hours. Expired learner sessions and
          verification tokens are deleted in bounded maintenance batches;
          inactive one-way authentication rate-limit buckets become eligible
          after 24 hours. Inactive one-way support quota buckets also become
          eligible after 24 hours.
          Optional product events become eligible for automatic deletion 400
          days after receipt. Resolved or closed support requests and
          administrative audit records become eligible 730 days after their
          last update or creation unless a longer period is required for
          security, disputes, or law.
        </p>
        <p>
          A daily maintenance job removes eligible records in bounded batches.
          A provider or database outage can delay a run; the next successful
          run clears the expired backlog. The health endpoint exposes failed,
          missed, and stalled runs so the operator&apos;s external monitor can
          alert on them.
        </p>
        <p>
          A documented legal or security preservation requirement can place a
          specific record, account reference, entity, or data class on hold.
          Held records are excluded from deletion until an authorized operator
          records a reason for releasing the hold; both actions are audited.
        </p>
        <p>
          “Delete my learning data” removes the primary progress record and the
          current browser&apos;s offline learning content. The service and browser
          retain only an opaque reset number for that learning identity so an
          offline tab or device cannot restore deleted lessons; it contains no
          vocabulary, scores, profile text, or activity history. “Delete account”
          also removes that reset marker and the
          web learner account and ends account access immediately. Synchronized
          learning data, product events, support records, native sessions, and
          linked credentials are placed into a durable deletion job so a
          temporary database or provider outage cannot strand them. Failed jobs
          are retried by scheduled maintenance. Separately preserved legal
          records remain inaccessible to the former account and are deleted
          automatically after the recorded hold is released. Infrastructure
          recovery copies may remain for a limited provider backup cycle before
          expiring.
        </p>
        <p>
          When native account synchronization is enabled, a verified Apple
          identity can be linked to the same learner account without relying on
          an email-address match. Native account deletion removes synchronized
          progress, active native sessions, and the encrypted Apple credential
          in addition to the on-device copy. The service first asks Apple to
          revoke the associated refresh token; a temporary Apple outage reports
          an error so revocation can be retried.
        </p>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <p>
          You can export or restore progress, disable audio, IPA, motion, or
          analytics, sign out, delete learning progress, and delete a learner
          account from Profile. Depending on local law, you may also request
          access, correction, restriction, objection, portability, or deletion
          through Support. Identity may need to be verified before fulfilling
          an account request.
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
          Paretto is not directed to children under 13. Where local law sets
          a higher age for independent consent, a parent or guardian must
          authorize use. Material privacy changes will be dated here and, when
          appropriate, highlighted inside the product.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
