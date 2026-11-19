'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import './reflective-login-card.css';

const VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uImage;
uniform vec2 uStep;
out vec4 fragColor;
void main() {
  vec3 c = texture(uImage, vUv).rgb * 0.227027;
  c += texture(uImage, vUv + uStep * 1.384615).rgb * 0.316216;
  c += texture(uImage, vUv - uStep * 1.384615).rgb * 0.316216;
  c += texture(uImage, vUv + uStep * 3.230769).rgb * 0.070270;
  c += texture(uImage, vUv - uStep * 3.230769).rgb * 0.070270;
  fragColor = vec4(c, 1.0);
}`;
const METAL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uEnvironment;
uniform vec2 uSize;
uniform vec2 uTilt;
uniform vec3 uToneStart;
uniform vec3 uToneMiddle;
uniform vec3 uToneEnd;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float d = roundBox(p, uSize * 0.5 - 0.65, 24.0);
  vec2 slope = normalize(vec2(dFdx(d), dFdy(d)) + vec2(0.00001));
  float bevel = smoothstep(-8.0, -0.8, d);
  float grain = hash(floor(vUv * uSize * 1.6)) - 0.5;
  vec3 N = normalize(vec3(slope * bevel * 0.68 + vec2(grain * 0.009), 1.0));
  float sx = sin(uTilt.x), cx = cos(uTilt.x), sy = sin(uTilt.y), cy = cos(uTilt.y);
  // These spring angles also drive CSS rotateX/rotateY.
  N = vec3(N.x, cx * N.y - sx * N.z, sx * N.y + cx * N.z);
  N = vec3(cy * N.x + sy * N.z, N.y, -sy * N.x + cy * N.z);
  vec3 I = normalize(vec3((vUv - 0.5) * vec2(0.22, 0.36), -1.25));
  vec3 R = reflect(I, N);
  vec2 q = R.xy / max(R.z, 0.2);
  vec2 UV = vUv + 0.12 * q;
  // The texture is a planar Canvas environment, not a panorama.
  vec3 reflected = texture(uEnvironment, clamp(UV, 0.002, 0.998)).rgb;
  float gray = dot(reflected, vec3(0.2126, 0.7152, 0.0722));
  vec3 tint = vUv.x < 0.48 ? mix(uToneStart, uToneMiddle, vUv.x / 0.48) : mix(uToneMiddle, uToneEnd, (vUv.x - 0.48) / 0.52);
  vec3 metal = mix(tint * 0.62, mix(tint, vec3(1.0), 0.62), pow(gray, 0.75));
  float brushed = sin(vUv.y * uSize.y * 4.0 + grain * 0.8) * 0.003;
  metal += grain * 0.012 + brushed;
  float rim = (1.0 - smoothstep(0.0, 1.8, abs(d + 1.3))) * 0.20;
  metal += rim * (0.60 + dot(N.xy, normalize(vec2(-0.6, 0.8))) * 0.40);
  float alpha = 1.0 - smoothstep(-0.7, 0.7, d);
  fragColor = vec4(metal, alpha);
}`;
const ENV_SIZE = 512;

/** Reflected objects are drawn locally, without images, cameras or network assets. */
function paintEnvironment(ctx: CanvasRenderingContext2D, seconds: number, tilt: { x: number; y: number }) {
  const s = ENV_SIZE;
  ctx.fillStyle = '#59636d';
  ctx.fillRect(0, 0, s, s);
  ctx.save();
  ctx.translate(s * 0.27 + tilt.y * 0.6, s * 0.22);
  ctx.rotate(-0.27);
  ctx.fillStyle = '#7495b5';
  ctx.fillRect(-s * 0.58, -s * 0.32, s * 0.93, s * 0.58);
  ctx.restore();
  const sphereX = s * 0.88 + Math.sin(seconds * 0.28) * 6;
  const sphereY = s * 0.77 + tilt.x * 0.8;
  const sphere = ctx.createRadialGradient(sphereX - 26, sphereY - 38, 3, sphereX, sphereY, s * 0.40);
  sphere.addColorStop(0, '#f8e7cf');
  sphere.addColorStop(0.35, '#d9a77d');
  sphere.addColorStop(0.78, '#8b6655');
  sphere.addColorStop(1, '#5f5e61');
  ctx.fillStyle = sphere;
  ctx.beginPath();
  ctx.arc(sphereX, sphereY, s * 0.40, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(s * 0.43 + tilt.y * 1.3, s * 0.45);
  ctx.rotate(-0.47);
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#fcfdfd';
  ctx.fillRect(-s * 0.76, -s * 0.073, s * 1.5, s * 0.146);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(246,250,252,.62)';
  ctx.fillRect(-s * 0.56, s * 0.20, s * 1.15, s * 0.022);
  ctx.restore();
}

type MetalPipeline = {
  draw: (environment: HTMLCanvasElement, width: number, height: number, x: number, y: number, tones: number[][]) => void;
  dispose: () => void;
};
function createMetalPipeline(gl: WebGL2RenderingContext): MetalPipeline {
  const programs: WebGLProgram[] = [], shaders: WebGLShader[] = [], textures: WebGLTexture[] = [], framebuffers: WebGLFramebuffer[] = [];
  const vao = gl.createVertexArray();
  const dispose = () => {
    programs.forEach(program => gl.deleteProgram(program));
    shaders.forEach(shader => gl.deleteShader(shader));
    textures.forEach(texture => gl.deleteTexture(texture));
    framebuffers.forEach(framebuffer => gl.deleteFramebuffer(framebuffer));
    if (vao) gl.deleteVertexArray(vao);
  };
  try {
    function program(fragment: string) {
      const result = gl.createProgram();
      if (!result) throw new Error('WebGL program unavailable');
      programs.push(result);
      for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('WebGL shader unavailable');
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Metal shader compilation failed');
        gl.attachShader(result, shader);
      }
      gl.linkProgram(result);
      if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error('Metal shader link failed');
      return result;
    }
    function texture() {
      const result = gl.createTexture();
      if (!result) throw new Error('WebGL texture unavailable');
      textures.push(result);
      gl.bindTexture(gl.TEXTURE_2D, result);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return result;
    }
    function target() {
      const image = texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ENV_SIZE, ENV_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const buffer = gl.createFramebuffer();
      if (!buffer) throw new Error('WebGL framebuffer unavailable');
      framebuffers.push(buffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, image, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Metal framebuffer incomplete');
      return { image, buffer };
    }
    const blur = program(BLUR), metal = program(METAL), source = texture();
    const horizontal = target(), vertical = target();
    const blurImage = gl.getUniformLocation(blur, 'uImage'), blurStep = gl.getUniformLocation(blur, 'uStep');
    const metalEnvironment = gl.getUniformLocation(metal, 'uEnvironment'), metalSize = gl.getUniformLocation(metal, 'uSize'), metalTilt = gl.getUniformLocation(metal, 'uTilt');
    const metalToneStart = gl.getUniformLocation(metal, 'uToneStart'), metalToneMiddle = gl.getUniformLocation(metal, 'uToneMiddle'), metalToneEnd = gl.getUniformLocation(metal, 'uToneEnd');
    gl.bindVertexArray(vao);
    gl.disable(gl.DEPTH_TEST);
    return {
      draw(environment, width, height, x, y, tones) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, source);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, environment);
        gl.useProgram(blur);
        gl.uniform1i(blurImage, 0);
        gl.viewport(0, 0, ENV_SIZE, ENV_SIZE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, horizontal.buffer);
        gl.uniform2f(blurStep, 2.2 / ENV_SIZE, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindTexture(gl.TEXTURE_2D, horizontal.image);
        gl.bindFramebuffer(gl.FRAMEBUFFER, vertical.buffer);
        gl.uniform2f(blurStep, 0, 2.2 / ENV_SIZE);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.useProgram(metal);
        gl.bindTexture(gl.TEXTURE_2D, vertical.image);
        gl.uniform1i(metalEnvironment, 0);
        gl.uniform2f(metalSize, width, height);
        gl.uniform2f(metalTilt, x * Math.PI / 180, y * Math.PI / 180);
        gl.uniform3fv(metalToneStart, tones[0]);
        gl.uniform3fv(metalToneMiddle, tones[1]);
        gl.uniform3fv(metalToneEnd, tones[2]);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export default function ReflectiveLoginCard({children}:{children:ReactNode}) {
  const hostRef = useRef<HTMLDivElement>(null), cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null), fallbackRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const host = hostRef.current, card = cardRef.current, canvas = canvasRef.current, fallback = fallbackRef.current;
    if (!host || !card || !canvas || !fallback) return;
    const environment = document.createElement('canvas');
    environment.width = environment.height = ENV_SIZE;
    const context = environment.getContext('2d', { alpha: false });
    if (!context) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let gl: WebGL2RenderingContext | null = null;
    try { gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false }); }
    catch { /* The Canvas environment remains available when graphics are disabled. */ }
    let pipeline: MetalPipeline | undefined;
    let disposed = false, contextLost = false, visible = true, raf = 0, last = 0;
    let width = 0, height = 0, dpr = 0;
    let paletteDirty = true, tones = [[127 / 255, 181 / 255, 174 / 255], [180 / 255, 191 / 255, 188 / 255], [178 / 255, 160 / 255, 202 / 255]];
    const target = { x: 0, y: 0 }, angle = { x: 0, y: 0 }, velocity = { x: 0, y: 0 };
    const setRenderer = () => { card.dataset.renderer = pipeline && !contextLost ? 'webgl2' : 'canvas'; };
    const initialise = () => {
      if (gl && !contextLost) { try { pipeline = createMetalPipeline(gl); } catch { pipeline = undefined; } }
      setRenderer();
    };
    const drawFallback = () => {
      const ctx = fallback.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, fallback.width, fallback.height);
      ctx.filter = 'grayscale(1) blur(16px)';
      ctx.drawImage(environment, -24, -24, fallback.width + 48, fallback.height + 48);
      ctx.filter = 'none';
      const tint = ctx.createLinearGradient(0, 0, fallback.width, 0);
      for (const [index, stop] of [0, 0.48, 1].entries()) tint.addColorStop(stop, 'rgb(' + tones[index].map(value => Math.round(value * 255)).join(' ') + ')');
      ctx.globalCompositeOperation = 'color';
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, fallback.width, fallback.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(222,231,237,.30)';
      ctx.fillRect(0, 0, fallback.width, fallback.height);
    };
    const frame = (now: number) => {
      raf = 0;
      if (disposed || document.hidden || !visible) return;
      const dt = Math.min((now - (last || now)) / 1000, 1 / 30);
      last = now;
      if (reduced.matches) { angle.x = angle.y = velocity.x = velocity.y = 0; }
      else {
        // Unit-mass spring: stiffness 120, damping 16. Substeps preserve interrupted velocity.
        const steps = Math.max(1, Math.ceil(dt / (1 / 120))), step = dt / steps;
        for (let n = 0; n < steps; n++) for (const axis of ['x', 'y'] as const) {
          velocity[axis] += (120 * (target[axis] - angle[axis]) - 16 * velocity[axis]) * step;
          angle[axis] += velocity[axis] * step;
        }
      }
      card.style.setProperty('--reflect-rotate-x', angle.x.toFixed(4) + 'deg');
      card.style.setProperty('--reflect-rotate-y', angle.y.toFixed(4) + 'deg');
      const nextWidth = card.clientWidth, nextHeight = card.clientHeight, nextDpr = Math.min(window.devicePixelRatio || 1, 2);
      if (nextWidth !== width || nextHeight !== height || nextDpr !== dpr) {
        width = nextWidth; height = nextHeight; dpr = nextDpr;
        canvas.width = fallback.width = Math.max(1, Math.round(width * dpr));
        canvas.height = fallback.height = Math.max(1, Math.round(height * dpr));
      }
      if (paletteDirty) {
        const style = getComputedStyle(card);
        tones = ['--zy-reflective-tone-start', '--zy-reflective-tone-middle', '--zy-reflective-tone-end'].map((name, index) => {
          const value = style.getPropertyValue(name).trim();
          if (/^#[0-9a-f]{6}$/i.test(value)) return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255);
          const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(channel => Number(channel) / 255);
          return channels?.length === 3 ? channels : tones[index];
        });
        paletteDirty = false;
      }
      paintEnvironment(context, reduced.matches ? 0 : now / 1000, angle);
      if (pipeline && !contextLost) {
        try { pipeline.draw(environment, width, height, angle.x, angle.y, tones); }
        catch { pipeline.dispose(); pipeline = undefined; setRenderer(); drawFallback(); }
      } else drawFallback();
      card.dataset.ready = 'true';
      if (!reduced.matches) raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (!disposed && !raf && !document.hidden && visible) { last = 0; raf = requestAnimationFrame(frame); } };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || reduced.matches) return;
      if(host.querySelector('input:focus,textarea:focus')){target.x=target.y=0;wake();return;}
      const bounds = host.getBoundingClientRect();
      target.x = Math.max(-12, Math.min(12, -(event.clientY - bounds.top - bounds.height / 2) / (bounds.height / 2) * 12));
      target.y = Math.max(-12, Math.min(12, (event.clientX - bounds.left - bounds.width / 2) / (bounds.width / 2) * 12));
      wake();
    };
    const leave = () => { target.x = target.y = 0; wake(); };
    const focus = () => { if(host.querySelector('input:focus,textarea:focus'))leave(); };
    const onVisibility = () => { if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; } else wake(); };
    const onLost = (event: Event) => { event.preventDefault(); contextLost = true; pipeline?.dispose(); pipeline = undefined; setRenderer(); wake(); };
    const onRestored = () => { contextLost = false; initialise(); wake(); };
    const onTheme = () => { paletteDirty = true; wake(); };
    const themeObserver = new MutationObserver(onTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-zy-theme', 'style'] });
    const intersectionObserver = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting !== false;
      if (!visible && raf) { cancelAnimationFrame(raf); raf = 0; }
      else wake();
    });
    intersectionObserver.observe(host);
    initialise();
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    host.addEventListener('pointercancel', leave);
    host.addEventListener('focusin', focus);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener('change', wake);
    window.addEventListener('resize', wake);
    wake();
    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
      host.removeEventListener('pointercancel', leave);
      host.removeEventListener('focusin', focus);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', wake);
      window.removeEventListener('resize', wake);
      themeObserver.disconnect();
      intersectionObserver.disconnect();
      pipeline?.dispose();
    };
  }, []);
  return <div className="zy-reflective-card-host" ref={hostRef}>
    <div className="zy-reflective-card" ref={cardRef} data-renderer="canvas" data-ready="false" aria-label="智域登录卡片">
      <canvas ref={canvasRef} className="zy-reflective-surface" aria-hidden="true" />
      <canvas ref={fallbackRef} className="zy-reflective-fallback" aria-hidden="true" />
      <div className="zy-reflective-content">{children}</div>
    </div>
  </div>;
}
