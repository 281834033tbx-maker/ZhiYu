#!/usr/bin/env python3
import argparse
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

MAX_BODY = 32 * 1024
SPEAKERS = {"Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric", "Ryan", "Aiden", "Ono_Anna", "Sohee"}


class State:
    model = None
    lock = threading.Lock()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "ZhiyuQwenTTS/1.0"

    def log_message(self, fmt, *args):
        print("qwen3-tts:", fmt % args, flush=True)

    def reply(self, status, body, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            return self.reply(404, json_bytes({"error": "not found"}))
        self.reply(200, json_bytes({"ready": State.model is not None, "device": "cpu"}))

    def do_POST(self):
        if self.path != "/synthesize":
            return self.reply(404, json_bytes({"error": "not found"}))
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 2 or size > MAX_BODY:
                return self.reply(413, json_bytes({"error": "request too large"}))
            data = json.loads(self.rfile.read(size))
            text = data.get("text")
            speaker = data.get("speaker", "Serena")
            language = data.get("language", "Chinese")
            if not isinstance(text, str) or not text.strip() or len(text) > 4000:
                return self.reply(400, json_bytes({"error": "text is invalid"}))
            if speaker not in SPEAKERS:
                return self.reply(400, json_bytes({"error": "speaker is invalid"}))
            with State.lock:
                wavs, sample_rate = State.model.generate_custom_voice(
                    text=text.strip(), language=language, speaker=speaker
                )
            output = io.BytesIO()
            sf.write(output, wavs[0], sample_rate, format="WAV", subtype="PCM_16")
            self.reply(200, output.getvalue(), "audio/wav")
        except Exception as error:
            print("qwen3-tts synthesis error:", repr(error), flush=True)
            self.reply(500, json_bytes({"error": "inference failed"}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9873)
    args = parser.parse_args()
    print(json.dumps({"status": "loading", "model": args.model}, ensure_ascii=False), flush=True)
    State.model = Qwen3TTSModel.from_pretrained(
        args.model, device_map="cpu", dtype=torch.float32, attn_implementation="eager"
    )
    print(json.dumps({"status": "ready", "host": args.host, "port": args.port}, ensure_ascii=False), flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
