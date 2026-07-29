# Production French audio

`FrenchAudioButton` is a drop-in replacement for the current direct
`speechSynthesis` calls. It shares one `FrenchAudioService` across the app, so a
new pronunciation cancels the previous one. Static same-origin WAV files are
tried first when listed in the public manifest; any missing, failed, or offline
asset falls back to a French voice exposed by the learner's device.

## UI integration

Replace each pronunciation `<button>` with the component while keeping the
existing class and icon:

```tsx
<FrenchAudioButton
  wordId={word.id}
  text={word.french}
  enabled={state.settings.sound}
  preloadWords={nextWords.map((item) => ({ wordId: item.id, text: item.french }))}
  className="audio-button"
>
  {({ isPlaying }) => (
    <><Volume2 size={19} aria-hidden="true" />
    {isPlaying ? "Pause French audio" : "Hear it in French"}</>
  )}
</FrenchAudioButton>
```

The component supplies a changing accessible label, `aria-pressed`, a polite
live status, and `data-audio-status` / `data-audio-source` hooks. Do not call the
old `speakFrench` helper for the same control. The `enabled` prop is mandatory;
when the learner turns sound off, active media and speech are cancelled.

## Static asset release pipeline

Assets use deterministic paths:

```text
/audio/fr/{assetVersion}/{wordId}.wav
```

The runtime and verifier both consume `public/audio/fr/manifest.json`, so there
is one availability source of truth. Before creating a new release:

1. Use an approved synthetic TTS provider, or install an open-source synthesizer
   plus a French voice whose model card explicitly permits the intended
   redistribution. Record the generator, exact voice/model, and license URL. Do
   not use a voice merely because the engine itself is open.
2. Produce one optimized WAV per word in `public/audio/fr/{assetVersion}`. Never
   use third-party or human recordings without written distribution rights.
3. Add each ID to `availableWordIds` and add an `assets[id]` entry containing the
   deterministic public `path`, exact `bytes`, lowercase SHA-256 checksum,
   duration, and source text.
4. Set `generation` to `status: "ready"`, `synthetic: true`,
   `distributionCleared: true`, plus `generator`, `voice`, model/config hashes,
   and `license: { name, url }`.
5. Run `node scripts/verify-french-audio-assets.mjs`. CI/release must stop if it
   reports an unknown ID, untracked file, checksum mismatch, implausible
   duration, missing attribution, or unclear distribution status.

### New CMS vocabulary

Cloudflare Worker assets are immutable at runtime, so CMS audio is deliberately
an audited build-time intake instead of a browser upload that could appear live
without a reviewed release. For a new CMS word:

1. Save a JSON request with the immutable `cms-*` public ID, exact French
   transcript and content revision; separate content-author and pronunciation
   reviewer emails/timestamps; generator/voice; review notes; and a concrete
   public licence name/URL plus an internal distribution-rights reference with
   its approver and timestamp.
2. Stage and technically inspect the WAV without changing production:

   ```sh
   npm run audio:cms:intake -- stage --request request.json --wav clip.wav
   ```

3. Have the operator inspect the generated receipt and clip, then promote them
   into the checked-in release:

   ```sh
   npm run audio:cms:intake -- promote \
     --receipt work/cms-audio-intake/cms-example/receipt.json
   npm run audio:verify
   ```

Promotion adds non-personal per-clip review and licence provenance plus a hash of
the private intake receipt to the public manifest; reviewer emails and internal
notes stay out of public assets. It never approves or publishes a CMS item. The
normal independent CMS review remains required, and approval will continue to
fail if the manifest transcript differs from the current French text.

The current v2 release contains 270 WAV clips produced with Kokoro-82M and the
single-speaker `ff_siwis` French female neural voice at 24,000 Hz. The model is
Apache 2.0 and its SIWIS French source dataset is CC BY 4.0:
<https://huggingface.co/hexgrad/Kokoro-82M>. The pinned, reproducible generator
is `scripts/generate-french-audio-kokoro.py`; model files remain build inputs and
are never committed or shipped. The public attribution file and manifest must
ship with the audio. Apple's macOS `say` command was not used.

To reproduce the release in an isolated environment:

```sh
uv venv --python 3.12 /tmp/paretto-kokoro
uv pip install --python /tmp/paretto-kokoro/bin/python \
  kokoro-onnx==0.5.0 soundfile==0.14.0
curl -fL \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \
  -o /tmp/kokoro-v1.0.onnx
curl -fL \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin \
  -o /tmp/voices-v1.0.bin
/tmp/paretto-kokoro/bin/python scripts/generate-french-audio-kokoro.py \
  --model /tmp/kokoro-v1.0.onnx \
  --voices /tmp/voices-v1.0.bin
npm run audio:verify
```

The generator refuses model or voice-pack files whose SHA-256 does not match
the audited v1.0 release.
