# French pronunciation audio attribution

Loquivo bundles 270 synthetic French pronunciation clips. They were generated
with Piper 1.4.2 using the `fr_FR-mls-medium` voice at 22,050 Hz. These clips are
synthetic and are not human narration.

Voice/model attribution:

- Voice: `fr_FR-mls-medium`, from `rhasspy/piper-voices`
- Model card: <https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/mls/medium/MODEL_CARD>
- Model files: <https://huggingface.co/rhasspy/piper-voices/tree/main/fr/fr_FR/mls/medium>
- Dataset: Multilingual LibriSpeech (French), OpenSLR 94 — <https://openslr.org/94/>
- Training: trained from scratch; medium quality; 125 speakers
- License: Creative Commons Attribution 4.0 International (CC BY 4.0) — <https://creativecommons.org/licenses/by/4.0/>

The CC BY 4.0 attribution and license link must remain with distributions of
these clips. The exact model/config hashes and every generated clip's SHA-256,
byte size, duration, and source text are recorded in `manifest.json`.

The model, Piper installation, and temporary build environment are not bundled
with the application. Apple's macOS `say` command was not used.
