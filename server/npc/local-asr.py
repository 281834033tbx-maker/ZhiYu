"""Offline speech-to-text for one local recording. Prints JSON only on stdout."""
import json
import os
import sys

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
import numpy as np


def main():
    model_dir, audio_path = sys.argv[1:3]
    os.environ["HF_HUB_OFFLINE"] = "1"
    model = WhisperModel(model_dir, device="cpu", compute_type="int8", cpu_threads=4)
    audio = decode_audio(audio_path)
    # Only reject near-digital silence. A quiet but valid microphone should reach the model.
    peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
    if len(audio) < 6400 or peak < 0.00001:
        text = ""
    else:
        audio = np.clip(audio * min(30.0, max(1.0, 0.2 / peak)), -1.0, 1.0)
        segments, _ = model.transcribe(audio, language="zh", beam_size=3, vad_filter=True)
        text = "".join(segment.text for segment in segments).strip()
        # VAD can discard brief, quiet speech. Retry without VAD before calling it silence.
        if not text:
            segments, _ = model.transcribe(audio, language="zh", beam_size=3, vad_filter=False)
            text = "".join(segment.text for segment in segments).strip()
    print(json.dumps({"text": text}, ensure_ascii=False))


if __name__ == "__main__":
    main()
