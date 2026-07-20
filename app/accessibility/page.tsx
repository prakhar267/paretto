import { LegalDocument, LegalSection } from "../legal-document";

export const metadata = {
  title: "Accessibility — Pas à Pas",
  description: "Pas à Pas accessibility features, target, and feedback process.",
};

export default function AccessibilityPage() {
  return (
    <LegalDocument
      eyebrow="Accessibility"
      title="French practice should work with the way you navigate, read, hear, and learn."
      intro="Pas à Pas is designed toward WCAG 2.2 Level AA. This is a commitment and testing target, not an unsupported certification claim."
    >
      <LegalSection title="Included accessibility features">
        <ul>
          <li>Keyboard-operable navigation, lessons, dialogs, challenges, and controls.</li>
          <li>Visible focus, skip navigation, semantic landmarks, headings, labels, and live status messages.</li>
          <li>Dialog focus trapping, Escape dismissal, focus restoration, and background isolation.</li>
          <li>Responsive text and controls with touch targets designed for mobile use.</li>
          <li>Reduced-motion support and a persistent in-product motion preference.</li>
          <li>Text equivalents for pronunciation, rewards, progress, icons, and cultural content.</li>
          <li>Audio as reinforcement rather than the only way to understand a lesson.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Known variation">
        <p>
          Device-generated pronunciation can vary by operating system, installed
          voice, and browser. Packaged audio is preferred where available, and
          every audio prompt has visible French text. Very old browsers and
          third-party browser extensions may affect visual or keyboard behavior.
        </p>
      </LegalSection>

      <LegalSection title="Feedback and response">
        <p>
          Report a barrier through Support and include the page, browser or
          assistive technology, what you expected, and what happened. Do not
          include passwords or sensitive personal information. Accessibility
          reports are prioritized as product defects and tracked to resolution.
        </p>
      </LegalSection>

      <LegalSection title="Assessment approach">
        <p>
          Release checks combine automated semantics and contrast rules,
          keyboard-only journeys, reduced-motion checks, zoom and responsive
          layouts, and manual screen-reader/device verification when supported
          testing environments are available. The statement is updated when a
          material limitation is identified or resolved.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
