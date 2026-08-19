/* MagicRings -- ported from reactbits.dev's React+three.js component to
   plain vanilla JS/ogl for this site, same treatment as aurora.js/strands.js:
   the shader logic is framework-agnostic already, only the React mount
   lifecycle and mouse/hover/click interactivity (unused for a background
   effect) were stripped. */
import { Renderer, Program, Mesh, Color, Triangle } from "https://esm.sh/ogl@1.0.6";

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime, uAttenuation, uLineThickness;
uniform float uBaseRadius, uRadiusStep, uScaleRate;
uniform float uOpacity, uNoiseAmount, uRotation, uRingGap;
uniform float uFadeIn, uFadeOut;
uniform vec2 uResolution;
uniform vec3 uColor, uColorTwo;
uniform int uRingCount;

out vec4 fragColor;

const float HP = 1.5707963;
const float CYCLE = 3.45;

float fade(float t) {
  return t < uFadeIn ? smoothstep(0.0, uFadeIn, t) : 1.0 - smoothstep(uFadeOut, CYCLE - 0.2, t);
}

float ring(vec2 p, float ri, float cut, float t0, float px) {
  float t = mod(uTime + t0, CYCLE);
  float r = ri + t / CYCLE * uScaleRate;
  float d = abs(length(p) - r);
  float a = atan(abs(p.y), abs(p.x)) / HP;
  float th = max(1.0 - a, 0.5) * px * uLineThickness;
  float h = (1.0 - smoothstep(th, th * 1.5, d)) + 1.0;
  d += pow(cut * a, 3.0) * r;
  return h * exp(-uAttenuation * d) * fade(t);
}

void main() {
  float px = 1.0 / min(uResolution.x, uResolution.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) * px;
  float cr = cos(uRotation), sr = sin(uRotation);
  p = mat2(cr, -sr, sr, cr) * p;
  vec3 c = vec3(0.0);
  float rcf = max(float(uRingCount) - 1.0, 1.0);
  for (int i = 0; i < 10; i++) {
    if (i >= uRingCount) break;
    float fi = float(i);
    vec3 rc = mix(uColor, uColorTwo, fi / rcf);
    c = mix(c, rc, vec3(ring(p, uBaseRadius + fi * uRadiusStep, pow(uRingGap, fi), i == 0 ? 0.0 : 2.95 * fi, px)));
  }
  float n = fract(sin(dot(gl_FragCoord.xy + uTime * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * uNoiseAmount;
  fragColor = vec4(c, max(c.r, max(c.g, c.b)) * uOpacity);
}
`;

export function initMagicRings(container, options = {}) {
  const opts = {
    color: "#fc42ff",
    colorTwo: "#42fcff",
    ringCount: 6,
    speed: 1,
    attenuation: 10,
    lineThickness: 2,
    baseRadius: 0.35,
    radiusStep: 0.1,
    scaleRate: 0.1,
    opacity: 1,
    noiseAmount: 0.1,
    rotation: 0,
    ringGap: 1.5,
    fadeIn: 0.7,
    fadeOut: 0.5,
    ...options,
  };

  const renderer = new Renderer({ alpha: true, antialias: true });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);
  gl.canvas.style.backgroundColor = "transparent";

  const geometry = new Triangle(gl);
  if (geometry.attributes.uv) delete geometry.attributes.uv;

  const toRGB = (hex) => {
    const c = new Color(hex);
    return [c.r, c.g, c.b];
  };

  const program = new Program(gl, {
    vertex: VERT,
    fragment: FRAG,
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uAttenuation: { value: opts.attenuation },
      uResolution: { value: [container.offsetWidth, container.offsetHeight] },
      uColor: { value: toRGB(opts.color) },
      uColorTwo: { value: toRGB(opts.colorTwo) },
      uLineThickness: { value: opts.lineThickness },
      uBaseRadius: { value: opts.baseRadius },
      uRadiusStep: { value: opts.radiusStep },
      uScaleRate: { value: opts.scaleRate },
      uRingCount: { value: opts.ringCount },
      uOpacity: { value: opts.opacity },
      uNoiseAmount: { value: opts.noiseAmount },
      uRotation: { value: (opts.rotation * Math.PI) / 180 },
      uRingGap: { value: opts.ringGap },
      uFadeIn: { value: opts.fadeIn },
      uFadeOut: { value: opts.fadeOut },
    },
  });

  const mesh = new Mesh(gl, { geometry, program });
  container.appendChild(gl.canvas);

  function resize() {
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    renderer.setSize(width, height);
    program.uniforms.uResolution.value = [width, height];
  }
  window.addEventListener("resize", resize);
  resize();

  let animateId = 0;
  let lastT = 0;
  let elapsed = 0;
  const update = (t) => {
    animateId = requestAnimationFrame(update);
    const dt = lastT === 0 ? 0 : Math.min(t - lastT, 100);
    lastT = t;
    elapsed += dt * 0.001 * opts.speed;
    program.uniforms.uTime.value = elapsed;
    renderer.render({ scene: mesh });
  };
  animateId = requestAnimationFrame(update);

  return function destroy() {
    cancelAnimationFrame(animateId);
    window.removeEventListener("resize", resize);
    if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
