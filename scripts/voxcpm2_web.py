"""Local, single-user VoxCPM2 voice generation console."""

from __future__ import annotations

import sys
import time
import uuid
from pathlib import Path

import gradio as gr
import soundfile as sf
from voxcpm import VoxCPM


PROJECT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT / ".npc-runtime" / "models" / "VoxCPM2"
OUTPUT_DIR = PROJECT / ".npc-runtime" / "audio" / "voxcpm2"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

if not (MODEL_DIR / "model.safetensors").is_file():
    raise SystemExit(f"找不到 VoxCPM2 模型：{MODEL_DIR}")

print("正在加载本地 VoxCPM2 模型，请稍等……", flush=True)
load_started = time.monotonic()
model = VoxCPM.from_pretrained(
    str(MODEL_DIR),
    load_denoiser=False,
    local_files_only=True,
    optimize=False,
    device="mps",
)
print(f"模型已加载，用时 {time.monotonic() - load_started:.1f} 秒。", flush=True)


def synthesize(text: str, description: str, reference: str | None, transcript: str):
    text = (text or "").strip()
    description = (description or "").strip()
    transcript = (transcript or "").strip()
    if not text:
        raise gr.Error("请先输入要生成的台词。")
    if len(text) > 300:
        raise gr.Error("一次最多输入 300 个字，请分段生成。")
    if transcript and not reference:
        raise gr.Error("填写参考录音的逐字文本时，也需要上传参考录音。")

    spoken_text = f"({description}){text}" if description else text
    kwargs = {
        "text": spoken_text,
        "cfg_value": 2.0,
        "inference_timesteps": 10,
    }
    if reference:
        kwargs["reference_wav_path"] = reference
        if transcript:
            kwargs["prompt_wav_path"] = reference
            kwargs["prompt_text"] = transcript

    started = time.monotonic()
    try:
        audio = model.generate(**kwargs)
    except Exception as exc:
        print(f"语音生成失败：{exc!r}", file=sys.stderr, flush=True)
        raise gr.Error(f"生成失败：{exc}") from exc

    output = OUTPUT_DIR / f"voice-{uuid.uuid4().hex[:12]}.wav"
    sf.write(output, audio, model.tts_model.sample_rate)
    duration = len(audio) / model.tts_model.sample_rate
    status = f"已生成 {duration:.1f} 秒语音；用时 {time.monotonic() - started:.1f} 秒。"
    print(f"{status} {output}", flush=True)
    return str(output), str(output), status


with gr.Blocks(title="智域 · VoxCPM2 本地语音工作台") as demo:
    gr.Markdown("# 智域 · 本地语音工作台\n输入台词，点击生成即可试听和下载 WAV。首次生成可能需要等待。")
    text = gr.Textbox(label="要说的话", value="你好，欢迎来到智域。", lines=3)
    description = gr.Textbox(
        label="声音或情绪描述（可选）",
        placeholder="例如：温柔、轻快的年轻女性声音",
    )
    reference = gr.Audio(
        label="参考录音（可选；要克隆特定声音时上传 WAV）",
        type="filepath",
        sources=["upload", "microphone"],
    )
    transcript = gr.Textbox(
        label="参考录音的逐字内容（可选；填写后提高克隆相似度）",
        placeholder="要与参考录音里的实际说话内容一致",
    )
    generate = gr.Button("生成语音", variant="primary")
    output_audio = gr.Audio(label="试听", type="filepath")
    output_file = gr.File(label="下载 WAV")
    status = gr.Textbox(label="状态", interactive=False)
    generate.click(
        synthesize,
        inputs=[text, description, reference, transcript],
        outputs=[output_audio, output_file, status],
    )
    gr.Markdown("仅在这台 Mac 的本机地址开放。生成结果保存在 `.npc-runtime/audio/voxcpm2/`；此工作台暂未连接智域 NPC 聊天。")


if __name__ == "__main__":
    demo.queue(default_concurrency_limit=1).launch(
        server_name="127.0.0.1",
        server_port=8808,
        share=False,
        show_error=True,
        allowed_paths=[str(OUTPUT_DIR)],
    )
