/** Glitches: digital breakup, RGB splits, VHS. */
import type { TransitionDefinition, TransitionParamSpec } from "../transitions.ts";

const intensity = (value = 1): TransitionParamSpec => ({
  kind: "number",
  key: "intensity",
  label: "Intensity",
  default: value,
  min: 0,
  max: 2,
  scale: 100,
  unit: "%",
  step: 1,
  decimals: 0,
  slider: true,
});

const direction = (value: string): TransitionParamSpec => ({
  kind: "choice",
  key: "direction",
  label: "Direction",
  default: value,
  options: [
    { value: "left", label: "Left" },
    { value: "right", label: "Right" },
    { value: "up", label: "Up" },
    { value: "down", label: "Down" },
  ],
});

export const GLITCHES: TransitionDefinition[] = [
  {
    type: "glitch",
    label: "Glitch",
    tags: ["glitch"],
    duration: 0.5,
    params: [intensity()],
    glsl: `
// Everything random is seeded by progress quantised to 24 steps, so the breakup
// jumps from frame to frame. Strength follows 4p(1-p): nothing at either end.
vec4 grabSplit(vec2 p, vec2 off, bool incoming) {
  vec2 pr = vec2(fract(p.x + off.x), p.y + off.y);
  vec2 pb = vec2(fract(p.x - off.x), p.y - off.y);
  vec4 r = incoming ? getToColor(pr) : getFromColor(pr);
  vec4 g = incoming ? getToColor(p) : getFromColor(p);
  vec4 b = incoming ? getToColor(pb) : getFromColor(pb);
  return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}
vec4 transition(vec2 uv) {
  float env = 4.0 * progress * (1.0 - progress);
  float seed = floor(progress * 24.0);
  // Some frames break up hard, others only a little.
  float burst = mix(0.45, 1.0, step(0.4, hash(vec2(seed, 5.3))));
  float k = env * intensity * burst;

  // Horizontal slices of random heights, some shoved sideways (wrapping around).
  float rows = mix(8.0, 34.0, hash(vec2(seed, 1.7)));
  float band = floor(uv.y * rows);
  float shoved = step(1.0 - 0.55 * min(k, 1.2), hash(vec2(band + 31.0, seed)));
  vec2 p = uv;
  p.x += shoved * (hash(vec2(band, seed)) - 0.5) * 0.3 * k;
  // Fine scanline jitter.
  p.x += (hash(vec2(floor(uv.y * 420.0), seed + 9.0)) - 0.5) * 0.01 * k;

  // Wide macroblocks that copy a chunk from elsewhere in the frame.
  float n = mix(7.0, 16.0, hash(vec2(seed, 2.1)));
  vec2 grid = vec2(ratio * n * 0.5, n);
  vec2 cell = floor(uv * grid);
  float blockOn = step(1.0 - 0.14 * min(k, 1.5), hash(cell + seed * 7.13));
  p += blockOn * floor((hash2(cell + seed * 3.7) - 0.5) * 6.0) / grid;
  p = vec2(fract(p.x), clamp(p.y, 0.0, 1.0));

  // A and B flicker: whole frames and single slices flip back and forth around the middle.
  float t = smoothstep(0.3, 0.7, progress);
  float pick = 0.65 * hash(vec2(seed, 11.0)) + 0.35 * hash(vec2(band, seed + 3.0));
  bool incoming = pick < t;
  if (blockOn > 0.5 && hash(cell + seed) > 0.5) incoming = !incoming;

  // Channel split, stronger in the shoved slices, direction changing each step.
  float side = hash(vec2(seed, 8.1)) > 0.5 ? 1.0 : -1.0;
  vec2 off = vec2(side * (0.012 + 0.03 * shoved) * k, 0.003 * k * (hash(vec2(seed, 4.4)) - 0.5));
  vec4 c = grabSplit(p, off, incoming);

  // Corrupted blocks: a few posterised, fewer channel-swapped.
  float corrupt = hash(cell + 17.0 + seed);
  if (blockOn > 0.5 && corrupt > 0.55) {
    vec3 q = floor(c.rgb * 6.0 + 0.5) / 6.0;
    c.rgb = corrupt > 0.88 ? q.gbr : q;
  }
  // Thin bright digital lines.
  float streak = step(0.985, hash(vec2(floor(uv.y * 160.0), seed + 21.0))) * step(0.35, k);
  c.rgb += streak * 0.35 * k * c.a;
  return c;
}`,
  },
  {
    type: "rgb-split",
    label: "RGB Split",
    tags: ["glitch", "slide"],
    duration: 0.5,
    params: [direction("left"), intensity()],
    glsl: `
// A push where red, green and blue move on staggered timings (red leads, blue
// lags), so the channels tear apart mid-move and land back together on B.
vec4 pushed(vec2 uv, vec2 d, float t) {
  vec2 q = uv - d * t;
  return inside(q) ? getFromColor(q) : getToColor(q + d);
}
float channelT(float p, float lag, float spread) {
  return ease(clamp((p - lag * spread) / (1.0 - spread), 0.0, 1.0));
}
vec4 transition(vec2 uv) {
  vec2 d = dirVec(direction);
  float spread = clamp(0.3 * intensity, 0.0, 0.6);
  float env = 4.0 * progress * (1.0 - progress);
  float shutter = 0.06 * env;
  vec4 acc = vec4(0.0);
  float alpha = 0.0;
  // Motion blur: 6 taps per channel across a short shutter.
  for (int i = 0; i < 6; i++) {
    float o = (float(i) / 5.0 - 0.5) * shutter;
    vec4 r = pushed(uv, d, channelT(progress + o, 0.0, spread));
    vec4 g = pushed(uv, d, channelT(progress + o, 0.5, spread));
    vec4 b = pushed(uv, d, channelT(progress + o, 1.0, spread));
    acc += vec4(r.r, g.g, b.b, 0.0);
    alpha += max(r.a, max(g.a, b.a));
  }
  return vec4(acc.rgb / 6.0, alpha / 6.0);
}`,
  },
  {
    type: "pixelate",
    label: "Pixelate",
    tags: ["glitch", "stylize"],
    duration: 0.6,
    params: [
      { kind: "number", key: "blockSize", label: "Max Block Size", default: 80, min: 8, max: 300, unit: "px", step: 1, decimals: 0 },
    ],
    glsl: `
// The mosaic grows in doubling steps, flips to B block by block at its
// coarsest and resolves the same way. Block size is px at 1080p height.
vec4 transition(vec2 uv) {
  float env = 4.0 * progress * (1.0 - progress);
  float level = floor(pow(env, 0.6) * 6.0 + 0.5);
  float t = smoothstep(0.4, 0.6, progress);
  if (level < 0.5) return progress < 0.5 ? getFromColor(uv) : getToColor(uv);
  float size = blockSize / 1080.0 * pow(0.5, 6.0 - level);
  vec2 cellSize = vec2(size / ratio, size);
  vec2 cell = floor((uv - 0.5) / cellSize);
  vec2 center = (cell + 0.5) * cellSize + 0.5;
  bool incoming = hash(cell + level * 13.1) < t;
  vec4 c = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = (vec2(float(i % 2), float(i / 2)) - 0.5) * 0.5 * cellSize;
    vec2 q = clamp(center + o, vec2(0.0), vec2(1.0));
    c += incoming ? getToColor(q) : getFromColor(q);
  }
  return c * 0.25;
}`,
  },
  {
    type: "vhs",
    label: "VHS",
    tags: ["glitch", "stylize"],
    duration: 0.8,
    params: [intensity()],
    glsl: `
// Tape playback breaking up: wobble, a tracking tear travelling up, snow bands,
// chroma bleeding sideways, scanlines, and the cut as a vertical-hold roll
// with the black sync bar between the clips.
vec3 toYiq(vec3 c) { return mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c; }
vec3 fromYiq(vec3 c) { return mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * c; }
const float BAR = 0.08;
vec4 tape(vec2 q, float y) {
  // y: position on the rolling strip (A, then the bar, then B).
  if (y < 1.0) return getFromColor(vec2(q.x, y));
  if (y < 1.0 + BAR) return vec4(0.0, 0.0, 0.0, 1.0);
  return getToColor(vec2(q.x, y - 1.0 - BAR));
}
vec4 transition(vec2 uv) {
  float env = 4.0 * progress * (1.0 - progress);
  float k = env * intensity;
  float seed = floor(progress * 30.0);
  float roll = ease((progress - 0.4) / 0.2) * (1.0 + BAR);
  float y = uv.y + roll;

  // Horizontal wobble and the tracking tear.
  float wob = (noise(vec2(uv.y * 9.0, seed * 0.7)) - 0.5) * 0.014 * k;
  float bandY = mix(-0.2, 1.2, fract(progress * 1.6 + 0.3));
  float tearZone = smoothstep(0.07, 0.0, abs(uv.y - bandY));
  float tear = tearZone * (noise(vec2(uv.y * 90.0, seed)) - 0.2) * 0.07 * k;
  float head = smoothstep(0.045, 0.0, uv.y) * 0.05 * k;
  vec2 q = vec2(uv.x + wob + tear + head, uv.y);

  vec4 c = tape(q, y);
  vec3 yiq = toYiq(c.rgb);
  // Chroma smeared to the right and a little offset.
  vec2 chroma = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    vec2 o = vec2(0.004 * k + float(i) * 0.005 * k, 0.0);
    chroma += toYiq(tape(q - o, y).rgb).yz;
  }
  yiq.yz = mix(yiq.yz, chroma / 6.0, min(1.0, k * 1.5)) * (1.0 + 0.35 * k);
  vec3 rgb = fromYiq(yiq);

  // Lifted blacks, a brightness flicker, scanlines.
  rgb = mix(rgb, rgb * 0.9 + 0.05 * c.a, min(1.0, k));
  rgb *= 1.0 + (hash(vec2(seed, 2.0)) - 0.5) * 0.18 * k;
  float lines = min(resolution.y / 3.0, 360.0);
  rgb *= 1.0 - 0.22 * min(k, 1.0) * (0.5 + 0.5 * cos(uv.y * lines * 2.0 * PI));

  // Snow: in the tear band, a few random streaks, and a fine grain everywhere.
  float grain = hash(floor(uv * resolution * 0.5) + seed * 13.0);
  float streakRow = step(0.975, hash(vec2(floor(uv.y * 180.0), seed + 5.0)));
  float streak = streakRow * smoothstep(0.4, 1.0, noise(vec2(uv.x * 12.0 + seed * 3.0, uv.y * 180.0)));
  float snow = (tearZone * 0.7 + streak * 0.8) * grain + 0.1 * (grain - 0.5);
  rgb += snow * k * c.a;
  return vec4(rgb, c.a);
}`,
  },
  {
    type: "datamosh",
    label: "Datamosh",
    tags: ["glitch", "distort"],
    duration: 1,
    params: [intensity()],
    glsl: `
// Compression failure: B's motion and residuals get decoded onto A's pixels, so
// A's macroblocks drag and smear while B's edges bleed through, then B's
// blocks take over in blotches until the picture refreshes clean.
vec4 transition(vec2 uv) {
  float env = 4.0 * progress * (1.0 - progress);
  float seed = floor(progress * 20.0);
  // Macroblocks: square, 1/24 of the height.
  vec2 grid = vec2(ratio, 1.0) * 24.0;
  vec2 cell = floor(uv * grid);
  vec2 c = (cell + 0.5) / grid;
  // A coherent, blocky motion field: neighbouring blocks move together.
  vec2 mv = vec2(noise(aspect(c) * 3.0 + 4.0), noise(aspect(c) * 3.0 + 19.0)) * 2.0 - 1.0;
  mv += (hash2(cell) - 0.5) * 0.35;
  mv *= 0.22 * intensity;

  // Where B has taken over: blotches of blocks growing across the frame.
  float m = clamp(0.7 * (fbm(aspect(c) * 2.2 + 7.0) - 0.2) / 0.6 + 0.3 * hash(cell + 3.1), 0.0, 1.0);
  float front = mix(-0.15, 1.15, smoothstep(0.1, 0.9, progress));
  bool incoming = m < front;

  vec4 col;
  if (incoming) {
    // B still drifting, settling as the transition ends.
    float drag = env * smoothstep(1.0, 0.6, progress) * 0.5;
    col = getToColor(clamp(uv - mv * drag, 0.0, 1.0));
  } else {
    // A dragged along B's motion, plus B's residual (its edges) painted on top.
    float drag = smoothstep(0.0, 0.6, progress) * env;
    vec4 a = getFromColor(clamp(uv - mv * drag, 0.0, 1.0));
    vec4 res = getToColor(uv) - getToColor(clamp(uv - mv * drag * 0.5, 0.0, 1.0));
    col = a + res * min(1.0, 1.5 * env * intensity);
    col.a = a.a;
  }

  // Blocks right at the boundary break: flat (DC only) or colour-shifted.
  float edge = smoothstep(0.1, 0.0, abs(m - front)) * min(1.0, env * 2.0);
  float roll = hash(cell + seed * 1.7);
  if (roll < edge * 0.6) {
    vec4 flat_ = incoming ? getToColor(c) : getFromColor(c);
    col = mix(col, flat_, 0.85);
  }
  if (roll > 1.0 - edge * 0.15) {
    col.rgb = col.a * vec3(0.55, 1.05, 0.6) * luma(col) / max(col.a, 1e-4) + col.rgb * 0.35;
  }
  return col;
}`,
  },
  {
    type: "digital-wipe",
    label: "Digital Wipe",
    tags: ["glitch", "wipe"],
    duration: 0.7,
    params: [direction("right"), intensity()],
    glsl: `
// A wipe whose edge breaks into rows of digital blocks: each row runs ahead or
// behind, B's leading pixels streak forward like pixel sorting, and the
// channels split along the edge.
vec4 transition(vec2 uv) {
  vec2 d = dirVec(direction);
  vec2 n = vec2(-d.y, d.x);
  float along = dot(uv - 0.5, d) + 0.5;
  // Across the wipe, in height units so rows are the same size at any aspect.
  float across = d.x != 0.0 ? uv.y : uv.x * ratio;
  float seed = floor(progress * 20.0);

  const float W = 0.2;
  const float L = 0.16;
  float rows = 26.0;
  float row = floor(across * rows);
  float jag = W * (0.75 * hash(vec2(row, 1.0)) + 0.25 * hash(vec2(row, seed)));
  float front = -L + progress * (1.0 + W + 2.0 * L);
  float e = along - (front - jag);

  float k = intensity * clamp(1.0 - abs(e) / L, 0.0, 1.0);
  // Blocks in the edge zone flip.
  vec2 blk = vec2(floor(along * 18.0), row);
  bool incoming = e < 0.0;
  if (abs(e) < L * 0.45 && hash(blk + seed * 5.1) < 0.18 * intensity) incoming = !incoming;

  // Pixel sort: ahead of the edge, a random length of the row repeats B's edge pixels.
  float sortLen = L * hash(vec2(row, seed + 4.0)) * intensity;
  vec2 q = uv;
  if (!incoming && e >= 0.0 && e < sortLen) {
    q = uv - d * e;
    incoming = true;
  }
  vec2 off = d * 0.02 * k + n * 0.004 * k;
  vec4 r = incoming ? getToColor(q + off) : getFromColor(q + off);
  vec4 g = incoming ? getToColor(q) : getFromColor(q);
  vec4 b = incoming ? getToColor(q - off) : getFromColor(q - off);
  vec4 c = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
  // A faint bright seam on the edge rows.
  c.rgb += c.a * 0.25 * k * k * step(0.7, hash(vec2(row, seed + 2.0)));
  return c;
}`,
  },
];
