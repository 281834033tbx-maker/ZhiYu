"""Finish the specific 2026-09-30 five-second MuseTalk sample.

The silent intervals below were measured from this exact speech-5s.wav using
FFmpeg silencedetect. They are not general-purpose lip-sync timing rules.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/musetalk-shy-5s-20260930'
BASE = np.array(Image.open(OUT/'reference.png').convert('RGB'))
INTERVALS = [(0.0, 0.17725), (2.149313, 2.861875), (4.692375, 5.0)]


def smooth(value):
    value = float(np.clip(value, 0, 1))
    return value * value * (3 - 2 * value)


def speech_weight(t):
    for start, end in INTERVALS:
        if start <= t <= end:
            outgoing = 0 if start == 0 else 1 - smooth((t-start)/0.08)
            incoming = 0 if end == 5 else smooth((t-(end-0.08))/0.08)
            return max(outgoing, incoming)
    return 1.0


def main():
    metadata = json.loads((OUT/'generation-metadata.json').read_text())
    x1, y1, x2, y2 = metadata['bbox']
    alpha = np.asarray(Image.open(OUT/'mouth-mask.png'), dtype=np.float32)/255
    alpha[alpha < 0.015] = 0
    allowed = np.zeros(BASE.shape[:2], dtype=bool)
    allowed[y1:y2,x1:x2] = alpha > 0
    outside_changed = 0
    changes = []
    selected = [0, 12, 38, 64, 95, 124]
    sheet = Image.new('RGB', (1350, 900))
    for i in range(125):
        path = OUT/'frames'/f'{i:05d}.png'
        out = np.array(Image.open(path).convert('RGB'))
        weight = speech_weight(i/25)
        if weight < 1:
            out[y1:y2,x1:x2] = np.rint(
                BASE[y1:y2,x1:x2]*(1-weight) + out[y1:y2,x1:x2]*weight
            ).astype(np.uint8)
            Image.fromarray(out).save(path)
        changed = np.any(out != BASE, axis=2)
        count = int(np.count_nonzero(changed & ~allowed))
        outside_changed += count
        changes.append(int(changed.sum()))
        if count: raise RuntimeError(f'Unexpected outside-mask changes in frame {i}')
        if i in selected:
            j = selected.index(i)
            sheet.paste(Image.fromarray(out).crop((1530,210,1980,660)), ((j%3)*450,(j//3)*450))
    sheet.save(OUT/'final-face-contact-sheet.jpg', quality=95)
    report = {
        'frames_checked': 125,
        'duration_seconds': 5,
        'source_size': [BASE.shape[1], BASE.shape[0]],
        'outside_mask_changed_pixels_total': outside_changed,
        'maximum_changed_pixels_per_frame': max(changes),
        'first_frame_equals_reference': changes[0] == 0,
        'last_frame_equals_reference': changes[-1] == 0,
        'silence_intervals_seconds': INTERVALS,
        'silence_blend_seconds': 0.08,
        'verification_scope': 'Lossless PNG frames before MP4 encoding; not a perceptual realism or live latency test',
        'body_and_eyes_motion': 'none; original photo retained',
    }
    (OUT/'pixel-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__ == '__main__': main()
