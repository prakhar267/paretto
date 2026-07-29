#!/usr/bin/env python3
"""Generate the versioned French pronunciation release with Kokoro ONNX.

The model and voice pack are intentionally supplied as command-line inputs.
They are build dependencies, not application assets, and must match the pinned
SHA-256 values below before any release files are written.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import unicodedata
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = PROJECT_ROOT / "public/audio/fr/manifest.json"
ASSET_VERSION = "v2"
VOICE = "ff_siwis"
LANGUAGE = "fr-fr"
SPEED = 0.90
SAMPLE_RATE_HZ = 24_000
MODEL_SHA256 = "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5"
VOICE_PACK_SHA256 = "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--voices", type=Path, required=True)
    parser.add_argument(
        "--generated-at",
        default="2026-07-30",
        help="Release date recorded in the public manifest (YYYY-MM-DD).",
    )
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).strip().split())


def master(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    audio = np.asarray(samples, dtype=np.float32).reshape(-1)
    if audio.size == 0 or not np.isfinite(audio).all():
        raise ValueError("Kokoro returned invalid audio samples")

    peak = float(np.max(np.abs(audio)))
    if peak <= 1e-6:
        raise ValueError("Kokoro returned silent audio")

    # Remove tiny DC bias, give every clip consistent headroom, and fade the
    # spoken edges before adding short learner-friendly start/end padding.
    audio = audio - float(np.mean(audio))
    peak = float(np.max(np.abs(audio)))
    audio = audio * (0.89 / peak)

    fade_frames = min(audio.size // 2, round(sample_rate * 0.008))
    if fade_frames > 0:
        fade = np.linspace(0.0, 1.0, fade_frames, dtype=np.float32)
        audio[:fade_frames] *= fade
        audio[-fade_frames:] *= fade[::-1]

    leading = np.zeros(round(sample_rate * 0.024), dtype=np.float32)
    trailing = np.zeros(round(sample_rate * 0.080), dtype=np.float32)
    return np.concatenate((leading, audio, trailing))


def main() -> None:
    args = parse_args()
    if sha256(args.model) != MODEL_SHA256:
        raise ValueError("Kokoro model SHA-256 does not match the pinned release")
    if sha256(args.voices) != VOICE_PACK_SHA256:
        raise ValueError("Kokoro voice-pack SHA-256 does not match the pinned release")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    word_ids = manifest["availableWordIds"]
    source_assets = manifest["assets"]
    if len(word_ids) != 270 or len(set(word_ids)) != len(word_ids):
        raise ValueError("Expected the verified 270-word French corpus")

    output_directory = MANIFEST_PATH.parent / ASSET_VERSION
    output_directory.mkdir(parents=True, exist_ok=True)
    for stale_file in output_directory.glob("*.wav"):
        stale_file.unlink()

    engine = Kokoro(str(args.model), str(args.voices))
    generated_assets: dict[str, dict[str, object]] = {}
    durations: list[float] = []

    for index, word_id in enumerate(word_ids, start=1):
        source = source_assets[word_id]
        text = normalize_text(source["text"])
        samples, sample_rate = engine.create(
            text,
            voice=VOICE,
            speed=SPEED,
            lang=LANGUAGE,
            trim=True,
        )
        if sample_rate != SAMPLE_RATE_HZ:
            raise ValueError(
                f"Unexpected Kokoro sample rate for {word_id}: {sample_rate}"
            )

        mastered = master(samples, sample_rate)
        duration = mastered.size / sample_rate
        if not math.isfinite(duration) or duration < 0.25 or duration > 6:
            raise ValueError(f"Implausible duration for {word_id}: {duration}")

        output_path = output_directory / f"{word_id}.wav"
        sf.write(
            output_path,
            mastered,
            sample_rate,
            format="WAV",
            subtype="PCM_16",
        )
        contents = output_path.read_bytes()
        generated_asset: dict[str, object] = {
            "path": f"/audio/fr/{ASSET_VERSION}/{word_id}.wav",
            "bytes": len(contents),
            "sha256": hashlib.sha256(contents).hexdigest(),
            "durationSeconds": round(duration, 6),
            "text": text,
        }
        if "provenance" in source:
            generated_asset["provenance"] = source["provenance"]
        generated_assets[word_id] = generated_asset
        durations.append(duration)
        print(f"[{index:03d}/{len(word_ids)}] {word_id}: {duration:.2f}s")

    manifest.update(
        {
            "assetVersion": ASSET_VERSION,
            "sampleRateHz": SAMPLE_RATE_HZ,
            "generation": {
                "status": "ready",
                "synthetic": True,
                "distributionCleared": True,
                "generatedAt": args.generated_at,
                "generator": "Kokoro ONNX",
                "generatorVersion": "1.0",
                "voice": VOICE,
                "voiceGender": "female",
                "quality": "high",
                "speakers": 1,
                "training": "multilingual neural TTS with SIWIS French voice",
                "modelSha256": MODEL_SHA256,
                "configSha256": VOICE_PACK_SHA256,
                "modelUrl": "https://huggingface.co/hexgrad/Kokoro-82M",
                "runtimeUrl": "https://github.com/thewh1teagle/kokoro-onnx",
                "dataset": {
                    "name": "SIWIS French Speech Synthesis Database",
                    "url": "https://datashare.ed.ac.uk/handle/10283/2353",
                    "license": "Creative Commons Attribution 4.0 International (CC BY 4.0)",
                },
                "license": {
                    "name": "Apache License 2.0 model; SIWIS data CC BY 4.0",
                    "url": "https://www.apache.org/licenses/LICENSE-2.0",
                    "attribution": "Kokoro-82M by hexgrad; ff_siwis voice derived from the SIWIS French Speech Synthesis Database.",
                },
                "processing": {
                    "speed": SPEED,
                    "language": LANGUAGE,
                    "sampleRateHz": SAMPLE_RATE_HZ,
                    "normalization": "Per-clip DC removal and peak normalization to 0.89",
                    "edgeFadeMilliseconds": 8,
                    "leadingPaddingMilliseconds": 24,
                    "trailingPaddingMilliseconds": 80,
                },
            },
            "assets": generated_assets,
            "summary": {
                "clipCount": len(generated_assets),
                "totalBytes": sum(
                    int(asset["bytes"]) for asset in generated_assets.values()
                ),
                "minimumDurationSeconds": round(min(durations), 6),
                "maximumDurationSeconds": round(max(durations), 6),
                "meanDurationSeconds": round(
                    sum(durations) / len(durations), 6
                ),
            },
            "attribution": {
                "path": "/audio/fr/ATTRIBUTION.md",
                "status": "bundled-synthetic-audio",
                "notice": "Pronunciation clips use Kokoro's single-speaker ff_siwis French female neural voice. They are synthetic and are not human narration.",
                "licenseNotice": "Kokoro-82M is Apache 2.0; SIWIS source data is CC BY 4.0. Required attribution and license links ship with every distribution.",
            },
            "localToolAudit": {
                "checkedAt": args.generated_at,
                "used": [
                    "Kokoro-82M ONNX v1.0",
                    VOICE,
                    "kokoro-onnx 0.5.0",
                ],
                "excluded": [
                    "Piper fr_FR-mls-medium retired for inconsistent robotic output",
                    "macOS say was not used",
                ],
            },
        }
    )
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "Generated "
        f"{len(generated_assets)} clips; duration range "
        f"{min(durations):.2f}s–{max(durations):.2f}s."
    )


if __name__ == "__main__":
    main()
