"""MuseTalk 1.5 offline still-photo demo on Apple Metal.

Uses upstream UNet + positional encoding and audio feature extraction, plus the
official SD VAE weights. A manually reviewed crop replaces DWPose for this one
fixed photograph; this is not a general face tracker or an emotion/body model.
"""
from pathlib import Path
import argparse
import gc
import hashlib
import json
import os
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT / '.npc-runtime/MuseTalk'
os.environ.setdefault('HF_HOME', str(ROOT / '.npc-runtime/musetalk-hf-cache'))
os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')
sys.path.insert(0, str(REPO))

import cv2
import numpy as np
import torch
from accelerate import init_empty_weights
from diffusers import AutoencoderKL, UNet2DConditionModel
from PIL import Image, ImageDraw, ImageFilter
from transformers import WhisperModel
from musetalk.models.unet import PositionalEncoding
from musetalk.utils.audio_processor import AudioProcessor


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--image', type=Path, required=True)
    p.add_argument('--audio', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--probe', action='store_true')
    p.add_argument('--bbox', nargs=4, type=int, default=[1634, 327, 1910, 609])
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    dtype = torch.float16 if device.type == 'mps' else torch.float32
    torch.set_num_threads(4)
    torch.manual_seed(6301)
    started = time.monotonic()
    print(f'Device: {device}; UNet dtype: {dtype}', flush=True)
    base = np.array(Image.open(args.image).convert('RGB'))
    x1, y1, x2, y2 = args.bbox
    crop = cv2.resize(base[y1:y2, x1:x2], (256, 256), interpolation=cv2.INTER_LANCZOS4)
    Image.fromarray(crop).save(args.output/'input-face-crop.png')

    # Reviewed lower-face mask. Its finite support leaves every other source
    # pixel unchanged before MP4 encoding. No face enhancement or head warping.
    mask_image = Image.new('L', (x2-x1, y2-y1))
    draw = ImageDraw.Draw(mask_image)
    draw.ellipse((1698-x1, 477-y1, 1889-x1, 581-y1), fill=255)
    mask_image = mask_image.filter(ImageFilter.GaussianBlur(6))
    mask = np.array(mask_image, dtype=np.float32)/255
    mask[mask < 0.015] = 0
    mask_image.save(args.output/'mouth-mask.png')

    with torch.inference_mode():
        print('Loading Whisper audio encoder', flush=True)
        whisper = WhisperModel.from_pretrained(REPO/'models/whisper', local_files_only=True).to(device).eval()
        processor = AudioProcessor(str(REPO/'models/whisper'))
        features, samples = processor.get_audio_feature(str(args.audio), weight_dtype=torch.float32)
        audio_chunks = processor.get_whisper_chunk(features, device, torch.float32, whisper, samples, fps=25).cpu()
        del whisper, features
        gc.collect()
        if device.type == 'mps': torch.mps.empty_cache()
        print(f'Audio features ready: {len(audio_chunks)} frames', flush=True)

        print('Loading VAE', flush=True)
        vae = AutoencoderKL.from_pretrained(REPO/'models/sd-vae', local_files_only=True).to(device).eval()
        pixels = torch.from_numpy(crop.copy()).permute(2, 0, 1).unsqueeze(0).to(device=device, dtype=torch.float32)/255
        masked = pixels.clone()
        masked[:, :, 128:, :] = 0
        scale = vae.config.scaling_factor
        masked_latent = vae.encode(masked*2-1).latent_dist.sample()*scale
        reference_latent = vae.encode(pixels*2-1).latent_dist.sample()*scale
        latent = torch.cat([masked_latent, reference_latent], dim=1).to(dtype)

        print('Loading MuseTalk 1.5 UNet', flush=True)
        config = json.loads((REPO/'models/musetalkV15/musetalk.json').read_text())
        with init_empty_weights():
            unet = UNet2DConditionModel.from_config(config)
        weights = torch.load(REPO/'models/musetalkV15/unet.pth', map_location='cpu', weights_only=True, mmap=True)
        unet.load_state_dict(weights, assign=True)
        unet = unet.to(device=device, dtype=dtype).eval()
        del weights
        gc.collect()
        pe = PositionalEncoding(384).to(device=device, dtype=dtype)
        timestep = torch.tensor([0], device=device)
        if device.type == 'mps': torch.mps.synchronize()
        load_seconds = time.monotonic()-started
        print(f'Models ready after {load_seconds:.1f}s', flush=True)

        indexes = [5, 25, 50, 75, 100, 120] if args.probe else list(range(min(125, len(audio_chunks))))
        patches = []
        inference_started = time.monotonic()
        for i in indexes:
            embedding = pe(audio_chunks[i:i+1].to(device=device, dtype=dtype))
            prediction = unet(latent, timestep, encoder_hidden_states=embedding).sample
            generated = vae.decode(prediction.float()/scale).sample
            if not torch.isfinite(generated).all():
                raise RuntimeError(f'Non-finite generated frame {i}')
            face = ((generated[0].permute(1,2,0).float().cpu().numpy()/2+0.5).clip(0,1)*255).round().astype(np.uint8)
            patches.append(face)
            if args.probe:
                Image.fromarray(face).save(args.output/f'probe-face-{i:03d}.png')
            if (i+1)%10 == 0 or args.probe:
                print(f'Frame {i+1}/125, inference {time.monotonic()-inference_started:.1f}s', flush=True)

        inference_seconds = time.monotonic()-inference_started
        stack = np.stack(patches)
        np.save(args.output/('probe-mouth-patches.npy' if args.probe else 'mouth-patches.npy'), stack)
        montage = Image.new('RGB', (450*3, 450*2)) if args.probe else None
        frames_dir = args.output/('probe-frames' if args.probe else 'frames')
        frames_dir.mkdir(exist_ok=True)
        for j, (i, face) in enumerate(zip(indexes, patches)):
            patch = cv2.resize(face, (x2-x1,y2-y1), interpolation=cv2.INTER_LANCZOS4)
            out = base.copy()
            original = base[y1:y2,x1:x2]
            out[y1:y2,x1:x2] = np.rint(original*(1-mask[:,:,None])+patch*mask[:,:,None]).astype(np.uint8)
            image = Image.fromarray(out)
            image.save(frames_dir/f'{i:05d}.png')
            if montage is not None:
                montage.paste(image.crop((1530,210,1980,660)), ((j%3)*450,(j//3)*450))
        if montage is not None: montage.save(args.output/'probe-contact-sheet.jpg', quality=95)
        metadata = {
            'source': str(args.image), 'source_sha256': hashlib.sha256(args.image.read_bytes()).hexdigest(),
            'model': 'MuseTalk 1.5 official UNet / SD VAE / Whisper tiny',
            'device': str(device), 'load_and_audio_seconds': round(load_seconds,2),
            'inference_seconds': round(inference_seconds,2),
            'total_seconds': round(time.monotonic()-started,2),
            'frame_indices': indexes, 'fps': 25, 'bbox': args.bbox,
            'processing': 'Manual fixed-photo crop, original MuseTalk audio features and model, restricted lower-face blending',
            'limitations': ['Fixed photograph: no generated body motion, blinking or shy head movement', 'Expression outside lower-face mask remains from input photo', 'Offline MPS sample, not a realtime benchmark', 'MP4 encoding may change pixels outside mask'],
        }
        (args.output/('probe-metadata.json' if args.probe else 'generation-metadata.json')).write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
        print('Completed', json.dumps(metadata,ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
