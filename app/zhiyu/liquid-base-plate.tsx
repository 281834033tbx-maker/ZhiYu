'use client';

import {useEffect, useId, useRef, useState, type CSSProperties} from 'react';
import './liquid-base-plate.css';

/* Background-only adaptation of rdev/liquid-glass-react's GlassContainer,
 * SVG edge compositing and two highlight layers:
 * https://github.com/rdev/liquid-glass-react/blob/master/src/index.tsx
 *
 * Copyright 2025 MAX ROVENSKY
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the “Software”), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

// Negative displacement pulls sampled pixels inward, as upstream standard mode.
const REFRACTION_SCALE = -20;
const EDGE_WIDTH = 22;
type Lens = {width:number; height:number; map:string};

/** R/G encode a rounded rectangle's edge normals; B encodes edge opacity.
 * Its centre is composited from SourceGraphic, without displacement or tint.
 * Map generation is bounded to 1024px on its longest side, and only on resize. */
function edgeMap(width:number, height:number, radius:number):string {
  const density = Math.min(1, 1024 / Math.max(width, height));
  const mapWidth = Math.max(1, Math.round(width * density));
  const mapHeight = Math.max(1, Math.round(height * density));
  const canvas = document.createElement('canvas');
  canvas.width = mapWidth;
  canvas.height = mapHeight;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const image = context.createImageData(mapWidth, mapHeight);
  const halfWidth = width / 2, halfHeight = height / 2;
  const corner = Math.max(0, Math.min(radius, halfWidth, halfHeight));
  const band = Math.min(EDGE_WIDTH, halfWidth, halfHeight);
  for (let y = 0; y < mapHeight; y++) {
    const py = (y + .5) * height / mapHeight - halfHeight;
    for (let x = 0; x < mapWidth; x++) {
      const px = (x + .5) * width / mapWidth - halfWidth;
      const qx = Math.abs(px) - (halfWidth - corner);
      const qy = Math.abs(py) - (halfHeight - corner);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const length = Math.hypot(ox, oy);
      const inside = -(length + Math.min(Math.max(qx, qy), 0) - corner);
      const t = inside >= 0 ? Math.max(0, 1 - inside / band) : 0;
      const amount = t * t * (3 - 2 * t);
      let nx = 0, ny = 0;
      if (length > 0) {
        nx = ox / length * Math.sign(px);
        ny = oy / length * Math.sign(py);
      } else if (qx > qy) nx = Math.sign(px);
      else ny = Math.sign(py);
      const index = (y * mapWidth + x) * 4;
      image.data[index] = Math.round(128 + nx * amount * 110);
      image.data[index + 1] = Math.round(128 + ny * amount * 110);
      image.data[index + 2] = Math.round(amount * 255);
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Put first in a positioned desktop app. Keep navigation/content above z=0.
 * This component neither paints a base colour nor wraps or moves its siblings. */
export default function LiquidBasePlate() {
  const node = useRef<HTMLDivElement>(null);
  const filterId = 'zy-liquid-' + useId().replace(/[^a-zA-Z0-9_-]/g, '-');
  const [lens, setLens] = useState<Lens | null>(null);
  const [reducedTransparency, setReducedTransparency] = useState(false);
  useEffect(() => {
    const element = node.current;
    if (!element) return;
    const preference = window.matchMedia('(prefers-reduced-transparency: reduce)');
    const chromium = /(?:Chrom(?:e|ium)|Edg|OPR)\//.test(navigator.userAgent);
    const supported = chromium && typeof CSS !== 'undefined'
      && CSS.supports('backdrop-filter', 'blur(1px)') && CSS.supports('filter', 'url(#glass)');
    let frame = 0, active = true, previous = '';
    const measure = () => {
      frame = 0;
      if (!active) return;
      const reduced = preference.matches;
      setReducedTransparency(reduced);
      if (reduced || !supported) {previous = ''; setLens(null); return;}
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width), height = Math.round(rect.height);
      if (!width || !height) return;
      const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      const key = `${width}:${height}:${radius}`;
      if (key === previous) return;
      previous = key;
      try {
        const map = edgeMap(width, height, radius);
        setLens(map ? {width, height, map} : null);
      } catch { setLens(null); }
    };
    const schedule = () => {if (!frame && active) frame = requestAnimationFrame(measure);};
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(element);
    if (!observer) window.addEventListener('resize', schedule);
    preference.addEventListener('change', schedule);
    schedule();
    return () => {
      active = false;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', schedule);
      preference.removeEventListener('change', schedule);
    };
  }, []);
  // Apply SVG directly to the sampled backdrop. Filtering a transparent span
  // with CSS `filter` can otherwise process an empty SourceGraphic in Chromium.
  const warpStyle = lens ? {
    backdropFilter:`url("#${filterId}") blur(6px) saturate(100%)`,
    WebkitBackdropFilter:`url("#${filterId}") blur(6px) saturate(100%)`,
  } as CSSProperties : undefined;
  return <div ref={node} className="zy-liquid-base-plate" aria-hidden="true" data-liquid-refraction={reducedTransparency ? 'reduced' : lens ? 'svg' : 'frosted'}>
    {lens && <svg className="zy-liquid-base-plate__filters" width={lens.width} height={lens.height} focusable="false" aria-hidden="true">
      <defs><filter id={filterId} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x={-24} y={-24} width={lens.width + 48} height={lens.height + 48} colorInterpolationFilters="sRGB">
        <feImage href={lens.map} x="0" y="0" width={lens.width} height={lens.height} preserveAspectRatio="none" result="displacement"/>
        <feColorMatrix in="displacement" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="edge-mask"/>
        <feDisplacementMap in="SourceGraphic" in2="displacement" scale={REFRACTION_SCALE} xChannelSelector="R" yChannelSelector="G" result="refracted"/>
        <feComposite in="refracted" in2="edge-mask" operator="in" result="edge"/>
        <feComposite in="SourceGraphic" in2="edge-mask" operator="out" result="centre"/>
        <feComposite in="edge" in2="centre" operator="over"/>
      </filter></defs>
    </svg>}
    <span className="zy-liquid-base-plate__warp" style={warpStyle}/>
    <span className="zy-liquid-base-plate__rim zy-liquid-base-plate__rim--screen"/>
    <span className="zy-liquid-base-plate__rim zy-liquid-base-plate__rim--overlay"/>
  </div>;
}
