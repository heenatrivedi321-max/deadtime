/* WebThreads -- ported from reactbits.dev's React+ogl component to plain
   vanilla JS/WebGL, same treatment as strands.js and aurora.js: the
   shader/WebGL logic is framework-agnostic already, only the React
   mount/unmount + prop-reactivity wrapper was stripped. Mouse-tracking
   and IntersectionObserver/visibility-driven start-stop are preserved
   since they're plain DOM/WebGL, not React-specific. */
import { Renderer, Program, Mesh, Triangle } from "https://esm.sh/ogl@1.0.6";

const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255];
};

const FAN_MODE = { center: 0, left: 1, right: 2 };

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uThreadCount;
uniform float uFrequency;
uniform float uSpread;
uniform float uTaper;
uniform float uPosition;
uniform float uFanMode;
uniform float uGlow;
uniform float uFalloff;
uniform float uThickness;
uniform float uBrightness;
uniform float uOpacity;
uniform float uMirror;
uniform float uShimmer;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform float uEnableMouse;
uniform float uMouseActive;
out vec4 fragColor;

#define TAU 6.28318530718
#define MAX_THREADS 10

float glow(float x, float str, float dist) {
  return dist / pow(max(x, 1e-4), str);
}

void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float n = max(uThreadCount, 1.0);

  float pinchX = uFanMode < 0.5 ? 0.5 : (uFanMode < 1.5 ? 0.0 : 1.0);
  if (uEnableMouse > 0.5) {
    pinchX = mix(pinchX, uMouse.x, clamp(uMouseStrength, 0.0, 1.0) * uMouseActive);
  }

  float spreadDx = uSpread * abs(uv.x - pinchX);
  float baseT = iTime * uSpeed;
  float tauOverN = TAU / n;
  float mirror = uMirror > 0.5 ? sign(pinchX - uv.x) : 1.0;
  bool doShimmer = uShimmer > 0.5;
  float shimmerT = iTime * 1.7;
  float invThickness = 1.0 / max(uThickness, 0.01);
  float xFreq = uv.x * uFrequency;
  float yOff = uv.y - uPosition;
  float ciScale = n > 1.0 ? 1.0 / (n - 1.0) : 0.0;

  vec3 col = vec3(0.0);
  float gsum = 0.0;

  for (int idx = 0; idx < MAX_THREADS; idx++) {
    float i = float(idx);
    if (i >= n) break;

    float amplitude = spreadDx * (1.0 + i * uTaper);
    float shimmer = doShimmer ? sin(shimmerT + i * 1.3) * 0.35 : 0.0;
    float phase = (baseT + i * tauOverN) * mirror + shimmer;

    float sdf = abs(yOff + sin(xFreq + phase) * amplitude) * invThickness;

    float g = glow(sdf, uFalloff, uGlow);
    float ci = i * ciScale;
    vec3 threadCol = mix(uColor1, uColor2, ci);

    col += g * threadCol;
    gsum += g;
  }

  float coreAmt = smoothstep(0.5, 2.2, gsum);
  col = mix(col, uColor3 * gsum, coreAmt * 0.5);

  float bright = uBrightness;
  if (uEnableMouse > 0.5) {
    vec2 md = uv - uMouse;
    float d2 = dot(md, md);
    bright += clamp(uMouseStrength, 0.0, 1.0) * uMouseActive * exp(-d2 * 6.0) * 0.6;
  }
  col *= bright;

  float alpha = clamp(gsum, 0.0, 1.0) * uOpacity;

  vec3 outRgb = col * alpha;

  if (uGrain > 0.5) {
    float gv = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453) - 0.5) * uGrainIntensity;
    outRgb = clamp(outRgb + gv, 0.0, 1.0);
    alpha = clamp(alpha + gv, 0.0, 1.0);
  }

  fragColor = vec4(outRgb, alpha);
}
`;

export function initWebThreads(container, options = {}) {
  const opts = {
    color1: "#5227FF",
    color2: "#FF9FFC",
    color3: "#FFFFFF",
    speed: 0.2,
    threadCount: 6,
    frequency: 5.0,
    spread: 0.18,
    taper: 1.0,
    position: 0.5,
    fanMode: "center",
    glow: 0.02,
    falloff: 0.6,
    thickness: 1.1,
    brightness: 0.6,
    opacity: 1.0,
    mirror: true,
    shimmer: false,
    grain: true,
    grainIntensity: 0.05,
    mouseInteraction: true,
    mouseStrength: 0.3,
    ...options,
  };

  const renderer = new Renderer({
    webgl: 2,
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);
  const canvas = gl.canvas;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);

  const geometry = new Triangle(gl);
  const program = new Program(gl, {
    vertex: VERT,
    fragment: FRAG,
    uniforms: {
      iTime: { value: 0 },
      iResolution: { value: new Float32Array([1, 1]) },
      uSpeed: { value: opts.speed },
      uThreadCount: { value: Math.round(opts.threadCount) },
      uFrequency: { value: opts.frequency },
      uSpread: { value: opts.spread },
      uTaper: { value: opts.taper },
      uPosition: { value: opts.position },
      uFanMode: { value: FAN_MODE[opts.fanMode] ?? 0 },
      uGlow: { value: opts.glow },
      uFalloff: { value: opts.falloff },
      uThickness: { value: opts.thickness },
      uBrightness: { value: opts.brightness },
      uOpacity: { value: opts.opacity },
      uMirror: { value: opts.mirror ? 1.0 : 0.0 },
      uShimmer: { value: opts.shimmer ? 1.0 : 0.0 },
      uGrain: { value: opts.grain ? 1.0 : 0.0 },
      uGrainIntensity: { value: opts.grainIntensity },
      uColor1: { value: new Float32Array(hexToRgb(opts.color1)) },
      uColor2: { value: new Float32Array(hexToRgb(opts.color2)) },
      uColor3: { value: new Float32Array(hexToRgb(opts.color3)) },
      uMouse: { value: new Float32Array([0.5, 0.5]) },
      uMouseStrength: { value: opts.mouseStrength },
      uEnableMouse: { value: opts.mouseInteraction ? 1.0 : 0.0 },
      uMouseActive: { value: 0 },
    },
  });

  const mesh = new Mesh(gl, { geometry, program });

  const setSize = () => {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h);
    const res = program.uniforms.iResolution.value;
    res[0] = gl.drawingBufferWidth;
    res[1] = gl.drawingBufferHeight;
    renderer.render({ scene: mesh });
  };
  const ro = new ResizeObserver(setSize);
  ro.observe(container);
  setSize();

  const currentMouse = [0.5, 0.5];
  const targetMouse = [0.5, 0.5];
  let currentActive = 0;
  let targetActive = 0;

  const onMouseMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    targetMouse[0] = (e.clientX - rect.left) / rect.width;
    targetMouse[1] = 1.0 - (e.clientY - rect.top) / rect.height;
    targetActive = 1;
  };
  const onMouseEnter = () => { targetActive = 1; };
  const onMouseLeave = () => { targetActive = 0; };
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseenter", onMouseEnter);
  canvas.addEventListener("mouseleave", onMouseLeave);

  let raf = 0;
  let isVisible = true;
  let isPageVisible = !document.hidden;
  const t0 = performance.now();

  const loop = (t) => {
    program.uniforms.iTime.value = (t - t0) * 0.001;
    currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
    currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);
    currentActive += 0.05 * (targetActive - currentActive);
    program.uniforms.uMouse.value[0] = currentMouse[0];
    program.uniforms.uMouse.value[1] = currentMouse[1];
    program.uniforms.uMouseActive.value = currentActive;
    renderer.render({ scene: mesh });
    raf = requestAnimationFrame(loop);
  };
  const tryStart = () => { if (isVisible && isPageVisible && raf === 0) raf = requestAnimationFrame(loop); };
  const tryStop = () => { if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; } };

  const io = new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting;
    isVisible ? tryStart() : tryStop();
  }, { threshold: 0 });
  io.observe(container);

  const onVisibility = () => {
    isPageVisible = !document.hidden;
    isPageVisible ? tryStart() : tryStop();
  };
  document.addEventListener("visibilitychange", onVisibility);

  tryStart();

  return function destroy() {
    tryStop();
    ro.disconnect();
    io.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mouseenter", onMouseEnter);
    canvas.removeEventListener("mouseleave", onMouseLeave);
    if (canvas.parentNode === container) container.removeChild(canvas);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
