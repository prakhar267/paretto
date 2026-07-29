import { LegalDocument, LegalSection } from "../legal-document";

export const metadata = {
  title: "Attributions — Paretto",
  description: "Open-source, font, icon, and French audio attributions for Paretto.",
};

export default function AttributionsPage() {
  return (
    <LegalDocument
      eyebrow="Attributions"
      title="The tools and open materials that helped Paretto speak clearly."
      intro="Paretto keeps required notices discoverable here and ships machine-readable audio provenance with every release."
    >
      <LegalSection title="French pronunciation audio">
        <p>
          The packaged French clips were synthesized with Kokoro-82M using the
          single-speaker <strong>ff_siwis French female voice</strong> at
          24,000 Hz. Kokoro&apos;s model weights use the Apache License 2.0, and
          the underlying SIWIS French Speech Synthesis Database uses the
          Creative Commons Attribution 4.0 International license (CC BY 4.0).
        </p>
        <ul>
          <li><a href="https://huggingface.co/hexgrad/Kokoro-82M">Kokoro-82M model and model card</a></li>
          <li><a href="https://github.com/thewh1teagle/kokoro-onnx">Kokoro ONNX runtime</a></li>
          <li><a href="https://datashare.ed.ac.uk/handle/10283/2353">SIWIS French source dataset</a></li>
          <li><a href="https://www.apache.org/licenses/LICENSE-2.0">Apache License 2.0</a></li>
          <li><a href="https://creativecommons.org/licenses/by/4.0/">SIWIS CC BY 4.0 license</a></li>
          <li><a href="/audio/fr/ATTRIBUTION.md">Shipped audio attribution record</a></li>
          <li><a href="/audio/fr/manifest.json">Per-clip source, checksum, duration, and generator manifest</a></li>
        </ul>
        <p>
          Kokoro, its voice pack, and the model files are generation tools and
          are not bundled in the web application. The resulting WAV clips are
          versioned and checksum-verified before release.
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
          The Paretto interface, original curriculum arrangement, regional
          learning copy, and product illustrations were created for this
          application unless a notice above states otherwise. French words,
          grammar facts, and geographic facts are not claimed as proprietary.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
