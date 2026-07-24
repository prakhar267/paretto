import { LegalDocument, LegalSection } from "../legal-document";

export const metadata = {
  title: "Attributions — Loquivo",
  description: "Open-source, font, icon, and French audio attributions for Loquivo.",
};

export default function AttributionsPage() {
  return (
    <LegalDocument
      eyebrow="Attributions"
      title="The tools and open materials that helped Loquivo speak clearly."
      intro="Loquivo keeps required notices discoverable here and ships machine-readable audio provenance with every release."
    >
      <LegalSection title="French pronunciation audio">
        <p>
          The packaged French clips were synthesized with Piper 1.4.2 using the
          <strong> fr_FR-mls-medium</strong> voice. Its model card identifies the
          French Multilingual LibriSpeech dataset, 22,050 Hz sample rate, and a
          model trained from scratch. The voice is distributed under the
          Creative Commons Attribution 4.0 International license (CC BY 4.0).
        </p>
        <ul>
          <li><a href="https://huggingface.co/rhasspy/piper-voices/tree/main/fr/fr_FR/mls/medium">Voice model and model card</a></li>
          <li><a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0 license</a></li>
          <li><a href="/audio/fr/ATTRIBUTION.md">Shipped audio attribution record</a></li>
          <li><a href="/audio/fr/manifest.json">Per-clip source, checksum, duration, and generator manifest</a></li>
        </ul>
        <p>
          Piper and the model files were generation tools and are not bundled in
          the web application. The resulting WAV clips are versioned and
          checksum-verified before release.
        </p>
      </LegalSection>

      <LegalSection title="Interface libraries and fonts">
        <ul>
          <li><a href="https://lucide.dev/license">Lucide icons — ISC License</a></li>
          <li><a href="https://fonts.google.com/specimen/Manrope">Manrope typeface — SIL Open Font License</a></li>
          <li><a href="https://fonts.google.com/specimen/Fraunces">Fraunces typeface — SIL Open Font License</a></li>
        </ul>
        <p>
          JavaScript package license notices remain available from the exact
          package versions recorded in the lockfile and release artifact.
        </p>
      </LegalSection>

      <LegalSection title="Original product material">
        <p>
          The Loquivo interface, original curriculum arrangement, regional
          learning copy, and product illustrations were created for this
          application unless a notice above states otherwise. French words,
          grammar facts, and geographic facts are not claimed as proprietary.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
