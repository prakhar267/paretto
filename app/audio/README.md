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

The current release contains 270 WAV clips produced with Piper 1.4.2 and the
`fr_FR-mls-medium` voice. Its model card identifies the French Multilingual
LibriSpeech dataset, CC BY 4.0 licensing, 22,050 Hz sample rate, and training from
scratch: <https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/mls/medium/MODEL_CARD>.
The public attribution file and manifest must ship with the audio. Apple's
macOS `say` command was not used.
