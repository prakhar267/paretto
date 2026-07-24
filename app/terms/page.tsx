import { LegalDocument, LegalSection } from "../legal-document";

export const metadata = {
  title: "Terms of use — Loquivo",
  description: "The terms governing use of the Loquivo learning service.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      eyebrow="Terms of use"
      title="A fair agreement for learning, creating, and operating responsibly."
      intro="By accessing Loquivo, you agree to these Terms. If you do not agree, do not use the service."
    >
      <LegalSection title="The service">
        <p>
          Loquivo provides French vocabulary lessons, pronunciation,
          spaced-repetition practice, progress tracking, and related cultural
          context. Features may change as the curriculum improves. The service
          is educational and does not guarantee a particular exam, immigration,
          academic, employment, or fluency outcome.
        </p>
      </LegalSection>

      <LegalSection title="Eligibility and browser profiles">
        <p>
          You must be at least 13 and legally able to accept these Terms. A
          parent or guardian must authorize use where required by local law.
          The web service currently keeps progress in an anonymous browser
          profile. Protect access to the device and browser that holds it, and
          export progress before clearing site data or moving browsers.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You may not:</p>
        <ul>
          <li>interfere with, overload, probe, or bypass service security;</li>
          <li>access another learner&apos;s information or administrative tools;</li>
          <li>automate abusive requests, distribute malware, or use the service unlawfully;</li>
          <li>resell the service or copy substantial curriculum or branding without permission; or</li>
          <li>submit unlawful, harmful, infringing, or sensitive material through support.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Content and intellectual property">
        <p>
          Loquivo and its original interface, curriculum arrangement,
          illustrations, copy, and software are protected by applicable
          intellectual-property laws. You receive a limited, personal,
          revocable, non-transferable right to use the service for learning.
          Individual French words and facts are not claimed as proprietary.
          Third-party and open-source materials remain subject to their stated
          licenses in the attribution notice.
        </p>
      </LegalSection>

      <LegalSection title="Your submissions">
        <p>
          You retain rights in material you send through Support. You grant the
          operator a limited right to process it only to respond, protect the
          service, comply with law, and improve the reported issue. Product
          feedback may be used without restriction or compensation, without
          identifying you publicly.
        </p>
      </LegalSection>

      <LegalSection title="Availability, suspension, and changes">
        <p>
          Reasonable efforts are made to keep the service reliable, but
          uninterrupted availability is not guaranteed. Access may be limited
          to maintain security, comply with law, or address misuse. You may stop
          using the service and delete learning progress at any time. Material
          changes to these Terms will be dated here and may be announced in the
          product before taking effect.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers and liability">
        <p>
          To the extent permitted by law, the service is provided “as is” and
          “as available.” Implied warranties are excluded only where legally
          allowed. The operator is not liable for indirect, incidental,
          special, consequential, or lost-profit damages arising from use of
          the service. Nothing in these Terms excludes liability that cannot be
          excluded by law, including mandatory consumer protections.
        </p>
      </LegalSection>

      <LegalSection title="Disputes and governing rules">
        <p>
          Contact Support first so concerns can be resolved informally. These
          Terms are governed by the laws of India. Subject to mandatory
          consumer rights and any court that must hear a matter under applicable
          law, courts in Jaipur, Rajasthan have jurisdiction over unresolved
          disputes. Nothing here removes mandatory rights available where you
          live. If one term is unenforceable, the remaining terms continue.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
