/* ElectricBorder -- ported from reactbits.dev's React component to plain
   vanilla JS/Canvas2D. No WebGL, no external deps (unlike Strands/Aurora/
   WebThreads) -- this one was always just canvas + CSS, the React layer
   only supplied refs/useEffect for lifecycle, which a plain function
   replaces directly. Math and drawing logic below is unchanged from the
   source. */

function random(x) {
  return (Math.sin(x * 12.9898) * 43758.5453) % 1;
}

function noise2D(x, y) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;

  const a = random(i + j * 57);
  const b = random(i + 1 + j * 57);
  const c = random(i + (j + 1) * 57);
  const d = random(i + 1 + (j + 1) * 57);

  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);

  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

function octavedNoise(x, octaves, lacunarity, gain, baseAmplitude, baseFrequency, time, seed, baseFlatness) {
  let y = 0;
  let amplitude = baseAmplitude;
  let frequency = baseFrequency;
  for (let i = 0; i < octaves; i++) {
    let octaveAmplitude = amplitude;
    if (i === 0) octaveAmplitude *= baseFlatness;
    y += octaveAmplitude * noise2D(frequency * x + seed * 100, time * frequency * 0.3);
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return y;
}

function getCornerPoint(centerX, centerY, radius, startAngle, arcLength, progress) {
  const angle = startAngle + progress * arcLength;
  return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
}

function getRoundedRectPoint(t, left, top, width, height, radius) {
  const straightWidth = width - 2 * radius;
  const straightHeight = height - 2 * radius;
  const cornerArc = (Math.PI * radius) / 2;
  const totalPerimeter = 2 * straightWidth + 2 * straightHeight + 4 * cornerArc;
  const distance = t * totalPerimeter;

  let accumulated = 0;

  if (distance <= accumulated + straightWidth) {
    const progress = (distance - accumulated) / straightWidth;
    return { x: left + radius + progress * straightWidth, y: top };
  }
  accumulated += straightWidth;

  if (distance <= accumulated + cornerArc) {
    const progress = (distance - accumulated) / cornerArc;
    return getCornerPoint(left + width - radius, top + radius, radius, -Math.PI / 2, Math.PI / 2, progress);
  }
  accumulated += cornerArc;

  if (distance <= accumulated + straightHeight) {
    const progress = (distance - accumulated) / straightHeight;
    return { x: left + width, y: top + radius + progress * straightHeight };
  }
  accumulated += straightHeight;

  if (distance <= accumulated + cornerArc) {
    const progress = (distance - accumulated) / cornerArc;
    return getCornerPoint(left + width - radius, top + height - radius, radius, 0, Math.PI / 2, progress);
  }
  accumulated += cornerArc;

  if (distance <= accumulated + straightWidth) {
    const progress = (distance - accumulated) / straightWidth;
    return { x: left + width - radius - progress * straightWidth, y: top + height };
  }
  accumulated += straightWidth;

  if (distance <= accumulated + cornerArc) {
    const progress = (distance - accumulated) / cornerArc;
    return getCornerPoint(left + radius, top + height - radius, radius, Math.PI / 2, Math.PI / 2, progress);
  }
  accumulated += cornerArc;

  if (distance <= accumulated + straightHeight) {
    const progress = (distance - accumulated) / straightHeight;
    return { x: left, y: top + height - radius - progress * straightHeight };
  }
  accumulated += straightHeight;

  const progress = (distance - accumulated) / cornerArc;
  return getCornerPoint(left + radius, top + radius, radius, Math.PI, Math.PI / 2, progress);
}

export function initElectricBorder(container, options = {}) {
  const opts = {
    color: "#5227FF",
    speed: 1,
    chaos: 0.12,
    borderRadius: 24,
    ...options,
  };

  container.style.setProperty("--electric-border-color", opts.color);
  container.style.borderRadius = opts.borderRadius + "px";

  const canvas = container.querySelector(".eb-canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const octaves = 10;
  const lacunarity = 1.6;
  const gain = 0.7;
  const amplitude = opts.chaos;
  const frequency = 10;
  const baseFlatness = 0;
  const displacement = 60;
  const borderOffset = 60;

  let width, height, lastDpr;
  let timeRef = 0;
  let lastFrameTime = 0;
  let animId = 0;

  function updateSize() {
    const rect = container.getBoundingClientRect();
    width = rect.width + borderOffset * 2;
    height = rect.height + borderOffset * 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.scale(dpr, dpr);
    lastDpr = dpr;
  }
  updateSize();

  function draw(currentTime) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr !== lastDpr) updateSize();

    const deltaTime = (currentTime - lastFrameTime) / 1000;
    timeRef += deltaTime * opts.speed;
    lastFrameTime = currentTime;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(lastDpr, lastDpr);

    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const scale = displacement;
    const left = borderOffset;
    const top = borderOffset;
    const borderWidth = width - 2 * borderOffset;
    const borderHeight = height - 2 * borderOffset;
    const maxRadius = Math.min(borderWidth, borderHeight) / 2;
    const radius = Math.min(opts.borderRadius, maxRadius);

    const approximatePerimeter = 2 * (borderWidth + borderHeight) + 2 * Math.PI * radius;
    const sampleCount = Math.floor(approximatePerimeter / 2);

    ctx.beginPath();
    for (let i = 0; i <= sampleCount; i++) {
      const progress = i / sampleCount;
      const point = getRoundedRectPoint(progress, left, top, borderWidth, borderHeight, radius);
      const xNoise = octavedNoise(progress * 8, octaves, lacunarity, gain, amplitude, frequency, timeRef, 0, baseFlatness);
      const yNoise = octavedNoise(progress * 8, octaves, lacunarity, gain, amplitude, frequency, timeRef, 1, baseFlatness);
      const displacedX = point.x + xNoise * scale;
      const displacedY = point.y + yNoise * scale;
      if (i === 0) ctx.moveTo(displacedX, displacedY);
      else ctx.lineTo(displacedX, displacedY);
    }
    ctx.closePath();
    ctx.stroke();

    animId = requestAnimationFrame(draw);
  }

  const ro = new ResizeObserver(() => updateSize());
  ro.observe(container);

  animId = requestAnimationFrame(draw);

  return function destroy() {
    cancelAnimationFrame(animId);
    ro.disconnect();
  };
}
