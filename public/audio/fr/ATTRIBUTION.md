# French pronunciation audio attribution

Paretto bundles 270 synthetic French pronunciation clips generated with
Kokoro-82M and the single-speaker `ff_siwis` French female voice. The release
uses Kokoro ONNX model version 1.0 at 24,000 Hz. These clips are synthetic and
are not human narration.

Model and voice attribution:

- Model: `hexgrad/Kokoro-82M` — <https://huggingface.co/hexgrad/Kokoro-82M>
- Runtime: `thewh1teagle/kokoro-onnx` — <https://github.com/thewh1teagle/kokoro-onnx>
- Voice: `ff_siwis` (French, female, single speaker)
- Source dataset: SIWIS French Speech Synthesis Database —
  <https://datashare.ed.ac.uk/handle/10283/2353>
- Model license: Apache License 2.0 —
  <https://www.apache.org/licenses/LICENSE-2.0>
- SIWIS dataset license: Creative Commons Attribution 4.0 International
  (CC BY 4.0) — <https://creativecommons.org/licenses/by/4.0/>

The model, voice pack, runtime, and temporary generation environment are not
bundled with the application. The exact model and voice-pack hashes, processing
settings, and every generated clip's SHA-256, byte size, duration, and source
text are recorded in `manifest.json`.

The previous Piper `fr_FR-mls-medium` release was retired because its
125-speaker corpus produced an inconsistent, robotic learner experience.
Apple's macOS `say` command was not used.
