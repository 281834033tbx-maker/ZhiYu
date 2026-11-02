"""Transcode Xiaoman's source clips into silent, browser-compatible desktop assets."""

from pathlib import Path
import argparse
import subprocess

FFMPEG = Path('/Users/boxuantong/.hermes/tools/ffmpeg-9.0.1-darwin-arm64/ffmpeg')
DEFAULT_SOURCE = Path('/Users/boxuantong/Desktop/人物/许晓曼/视频')
OUTPUT = Path(__file__).resolve().parents[1] / 'public/desktop-npc/video/xu-xiaoman'
CLIPS = (
    ('00-待机.mp4', '00-idle.mp4'),
    ('02-身体前倾.mp4', '02-lean-forward.mp4'),
    ('03-撩动头发.mp4', '03-touch-hair.mp4'),
    ('04-发呆.mp4', '04-daydream.mp4'),
    ('05-回消息-普通.mp4', '05-reply-normal.mp4'),
    ('06-回复消息-开心.mp4', '06-reply-happy.mp4'),
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()
    if not FFMPEG.is_file():
        raise SystemExit(f'FFmpeg unavailable: {FFMPEG}')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for original, target_name in CLIPS:
        source = args.source / original
        target = OUTPUT / target_name
        if not source.is_file():
            raise SystemExit(f'Missing source: {source}')
        print(f'{source.name} -> {target.name}', flush=True)
        subprocess.run([
            str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y',
            '-i', str(source), '-map', '0:v:0', '-an',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-r', '24',
            '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
            '-movflags', '+faststart', str(target),
        ], check=True)
        if target.stat().st_size < 100_000:
            raise SystemExit(f'Encoded file unexpectedly small: {target}')


if __name__ == '__main__':
    main()
