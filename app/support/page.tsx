import { LegalDocument, LegalSection } from "../legal-document";
import { loadTurnstilePublicSiteKey } from "../turnstile";
import SupportForm from "./SupportForm";

export const metadata = {
  title: "Learner support — Paretto",
  description: "Contact the Paretto learner-care team securely.",
};

export default async function SupportPage() {
  const turnstileSiteKey = await loadTurnstilePublicSiteKey();
  return (
    <LegalDocument
      eyebrow="Learner support"
      title="Tell us what is getting in the way."
      intro="Send a focused request to the support queue. The team can track it from first review through resolution."
    >
      <LegalSection title="Before you send">
        <p>
          Never include passwords, payment-card details, health information, or
          another person&apos;s private information. For a vocabulary or audio
          correction, include the French word and the region where you found it.
        </p>
      </LegalSection>

      <SupportForm turnstileSiteKey={turnstileSiteKey} />

      <LegalSection title="Response and privacy">
        <p>
          A reply email is optional. Without one, the request can still help us
          improve the product, but we cannot contact you directly. Support
          records use an opaque account reference and follow the retention
          period described in the Privacy notice. Cloudflare Turnstile checks
          each submission for automated abuse before it reaches the support
          queue.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
