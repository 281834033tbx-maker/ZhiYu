#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
PYTHON="$ROOT/.npc-runtime/qwen3-tts-env/bin/python"
MODEL="$ROOT/.npc-runtime/models/Qwen3-TTS-12Hz-0.6B-CustomVoice"
if [[ ! -x "$PYTHON" || ! -f "$MODEL/model.safetensors" ]]; then
  echo "Qwen3-TTS 本地环境或模型不完整。"
  read -k 1 "?按任意键关闭…"
  exit 1
fi
export HF_HOME="$ROOT/.npc-runtime/hf-cache"
export HF_HUB_OFFLINE=1
export PYTORCH_ENABLE_MPS_FALLBACK=1
exec "$PYTHON" "$ROOT/scripts/qwen3-tts-server.py" --model "$MODEL" --host 127.0.0.1 --port 9873
