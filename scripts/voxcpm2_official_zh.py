"""Run the current upstream VoxCPM UI with local models and Chinese labels."""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
RUNTIME = PROJECT / ".npc-runtime"
UPSTREAM = RUNTIME / "voxcpm-next"
TTS = RUNTIME / "models" / "VoxCPM2"
ASR = RUNTIME / "models" / "SenseVoiceSmall"
DENOISER = RUNTIME / "models" / "ZipEnhancer"

for path in (UPSTREAM / "app.py", TTS / "model.safetensors", ASR / "model.pt", DENOISER / "pytorch_model.bin"):
    if not path.is_file():
        raise SystemExit(f"缺少本地模型或官方程序：{path}")

os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
sys.path.insert(0, str(UPSTREAM / "src"))
os.chdir(UPSTREAM)  # Upstream app.py serves its logo from ./assets.

import gradio as gr  # noqa: E402
import voxcpm  # noqa: E402


spec = importlib.util.spec_from_file_location("voxcpm_official_app", UPSTREAM / "app.py")
if spec is None or spec.loader is None:
    raise SystemExit("无法加载 VoxCPM 官方后台")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

# All supported browser locales get the upstream Chinese copy. The upstream
# source stays unchanged so its commit remains verifiable against GitHub.
zh = dict(app._I18N_TRANSLATIONS["zh-CN"])
zh.update(
    {
        "control_label": "🎛️ 声音与风格描述（可选）",
        "target_text_label": "✍️ 要合成的台词",
        "show_prompt_text_info": "自动转写参考音频，也可手动修改。开启后声音与风格描述暂时禁用。",
        "prompt_text_label": "参考录音的逐字内容（自动转写，可修改）",
    }
)
app.I18N = gr.I18n(**{locale: zh for locale in ("en", "en-US", "zh", "zh-CN", "zh-Hans")})
app.DEFAULT_TARGET_TEXT = "你好，欢迎使用 VoxCPM2 本地语音后台。"

original_init = app.VoxCPMDemo.__init__


def local_init(self, *args, **kwargs):
    original_init(self, *args, **kwargs)
    self.asr_model_id = str(ASR)


def local_get_or_load_voxcpm(self):
    if self.voxcpm_model is None:
        app.logger.info("从本机加载官方 VoxCPM2 权重：%s", TTS)
        self.voxcpm_model = voxcpm.VoxCPM.from_pretrained(
            str(TTS),
            zipenhancer_model_id=str(DENOISER),
            load_denoiser=True,
            local_files_only=True,
            optimize=self.optimize,
            device=self.device,
        )
    return self.voxcpm_model


app.VoxCPMDemo.__init__ = local_init
app.VoxCPMDemo.get_or_load_voxcpm = local_get_or_load_voxcpm


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VoxCPM2 官方中文版本地后台")
    parser.add_argument("--port", type=int, default=8808)
    args = parser.parse_args()
    app.run_demo(server_name="127.0.0.1", server_port=args.port, model_id=str(TTS), device="mps")
