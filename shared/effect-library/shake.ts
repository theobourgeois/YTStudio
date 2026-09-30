/** Shakes in the style of Sapphire S_Shake: the edit staple, with its own motion blur. */
import type { EffectDefinition } from "../effects.ts";
import type { NumberSpec, ParamSpec } from "../params.ts";
import { degrees, percent, videoEffect } from "./common.ts";

/**
 * Smooth-to-snappy random motion, about -1..1 and never beyond it (so Zoom To
 * Hide can bound it): gradient noise like After Effects' wiggle() when smooth,
 * random steps it snaps between plus faster jitter when jagged.
 */
const SHAKE_NOISE = `
float shakeGrad(float t, float ch) {
  float i = floor(t);
  float f = fract(t);
  float g0 = hash(vec2(i, ch)) * 2.0 - 1.0;
  float g1 = hash(vec2(i + 1.0, ch)) * 2.0 - 1.0;
  float u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return 2.0 * mix(g0 * f, g1 * (f - 1.0), u);
}
// Holds a random place, then jumps to the next one in the first fifth of each step.
float shakeSnap(float t, float ch) {
  float i = floor(t);
  float a = hash(vec2(i, ch + 0.5)) * 2.0 - 1.0;
  float b = hash(vec2(i + 1.0, ch + 0.5)) * 2.0 - 1.0;
  return mix(a, b, smoothstep(0.0, 0.2, fract(t)));
}
float shakeNoise(float t, float ch) {
  float soft = 0.0;
  float sharp = 0.0;
  if (jaggedness < 1.0) soft = (shakeGrad(t, ch) + 0.35 * shakeGrad(t * 2.03 + 5.3, ch + 0.25)) / 1.35;
  if (jaggedness > 0.0)
    sharp = 0.6 * shakeSnap(t, ch) + 0.25 * shakeGrad(t * 2.7 + 3.1, ch + 0.37) + 0.15 * shakeGrad(t * 5.9 + 7.3, ch + 0.71);
  // Pushed up and eased back under 1, so it spends its time near the amplitude rather than around the middle.
  return tanh(1.7 * mix(soft, sharp, clamp(jaggedness, 0.0, 1.0)));
}
`;

/**
 * The shake itself, after the effect's own `float wobble(float t, float ch)`
 * (a component's motion at source time t, -1..1) and `float reach(float t)`
 * (how much of the shake is on at t, 0..1). `shakeEffect(uv)` is the picture.
 *
 * Every pixel follows where the shake reads it from over the shutter: that
 * path is worked out at a few moments (`SHAKE_POINTS`) and joined up, then
 * averaged at as many moments as the move needs to smear without steps
 * (1 when still, up to `SHAKE_SAMPLES`), staggered per pixel so a very long
 * smear turns fine grain rather than separate copies.
 */
const SHAKE_CORE = `
// The camera's distance from the picture, in frame heights (a normal lens): how strongly tilts foreshorten.
const float SHAKE_FOCAL = 1.3;
const int SHAKE_POINTS = 13;
const int SHAKE_SAMPLES = 24;
// Where points past the horizon of a steep tilt go: nothing is there.
const float SHAKE_NOWHERE = 1e4;
vec2 shakePath[SHAKE_POINTS];

// The picture as a card turned about its middle (tilt.x around the horizontal, tilt.y the vertical axis), seen
// from SHAKE_FOCAL away: what point of the card a point of the frame (square units, centred) sees.
vec2 shakeUntilt(vec2 p, vec2 tilt) {
  if (tilt.x == 0.0 && tilt.y == 0.0) return p;
  float cx = cos(tilt.x);
  float sx = sin(tilt.x);
  float cy = cos(tilt.y);
  float sy = sin(tilt.y);
  mat3 m = transpose(mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy) * mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx));
  vec3 d = m * vec3(p, SHAKE_FOCAL);
  vec3 c = m[2] * SHAKE_FOCAL;
  if (d.z < 1e-3 || c.z < 1e-3) return vec2(SHAKE_NOWHERE);
  return (c.z / d.z) * d.xy - c.xy;
}

// The least zoom that keeps the frame covered through the furthest drift, turn, tilt and zoom out at strength r.
float shakeCover(float r) {
  if (zoomToHide < 0.5 || r <= 0.0) return 1.0;
  vec2 halfSize = vec2(0.5 * ratio, 0.5);
  vec2 tilt = min(radians(vec2(tiltX, tiltY)) * r, vec2(1.05));
  // A card's outline stays straight, so it covers the frame when the frame's corners land on it.
  float tilted = 1.0;
  for (int i = 0; i < 12; i++) {
    vec2 corner = vec2(i % 2 == 0 ? 1.0 : -1.0, (i / 2) % 2 == 0 ? 1.0 : -1.0) * halfSize;
    int which = i / 4;
    vec2 q = shakeUntilt(corner, which == 0 ? tilt : which == 1 ? vec2(tilt.x, 0.0) : vec2(0.0, tilt.y));
    tilted = max(tilted, max(abs(q.x) / halfSize.x, abs(q.y) / halfSize.y));
  }
  vec2 box = halfSize * min(tilted, 20.0) + vec2(amplitudeX, amplitudeY) * r;
  float turn = min(radians(rotation) * r, 0.5 * PI);
  float c = cos(turn);
  float s = sin(turn);
  float cover = max((box.x * c + box.y * s) / halfSize.x, (box.x * s + box.y * c) / halfSize.y);
  return cover * pow(1.0 + zoom, r);
}

// Where the picture is read from (uv) for the frame's point p (square units, centred) at source time t.
vec2 shakeSource(vec2 p, float t) {
  float r = amount * reach(t);
  if (r <= 0.0) return p / vec2(ratio, 1.0) + 0.5;
  float ch = seed * 7.31;
  vec2 shift = vec2(
    amplitudeX == 0.0 ? 0.0 : amplitudeX * wobble(t, ch + 1.0),
    amplitudeY == 0.0 ? 0.0 : amplitudeY * wobble(t, ch + 2.0)) * r;
  float turn = rotation == 0.0 ? 0.0 : radians(rotation) * r * wobble(t, ch + 3.0);
  // Zooms in and out alike: 20% is x1.2 at most and /1.2 at least.
  float scale = zoom == 0.0 ? 1.0 : pow(1.0 + zoom, r * wobble(t, ch + 4.0));
  vec2 tilt = vec2(
    tiltX == 0.0 ? 0.0 : radians(tiltX) * wobble(t, ch + 5.0),
    tiltY == 0.0 ? 0.0 : radians(tiltY) * wobble(t, ch + 6.0));
  vec2 q = shakeUntilt(p, clamp(tilt * r, -1.05, 1.05));
  if (q.x >= SHAKE_NOWHERE) return q;
  q = rot(turn) * (q - shift) / (scale * shakeCover(r));
  return q / vec2(ratio, 1.0) + 0.5;
}

vec4 shakeSample(vec2 q, vec2 fw) {
  if (q.x >= SHAKE_NOWHERE) return vec4(0.0);
  vec2 texel = 0.5 / resolution;
  if (edges == 0) return getColor(clamp(mirrored(q), texel, 1.0 - texel));
  if (edges == 1) return getColor(clamp(q, texel, 1.0 - texel));
  // Transparent, with an edge a pixel soft whatever the zoom or tilt.
  vec2 inner = min(q, 1.0 - q) / fw;
  return getColor(clamp(q, texel, 1.0 - texel)) * clamp(0.5 + min(inner.x, inner.y), 0.0, 1.0);
}

// The path at dt from time (within -span..span), joined up between its moments.
vec2 shakePathAt(float dt, float span) {
  float x = clamp(0.5 + 0.5 * dt / span, 0.0, 1.0) * float(SHAKE_POINTS - 1);
  int i = min(int(x), SHAKE_POINTS - 2);
  return mix(shakePath[i], shakePath[i + 1], x - float(i));
}

vec4 shakeEffect(vec2 uv) {
  vec2 p = aspect(uv);
  // The shutter (Motion Blur 100% = a whole frame) and how far apart in time the colours are read.
  float shutter = 0.5 * motionBlur / max(fps, 1.0);
  float split = chromaSplit * 0.15 / max(frequency, 0.5);
  float span = shutter + split;
  if (span <= 0.0) {
    vec2 q = shakeSource(p, time);
    return shakeSample(q, max(fwidth(q), vec2(1e-6)));
  }
  float travel = 0.0;
  for (int i = 0; i < SHAKE_POINTS; i++) {
    shakePath[i] = shakeSource(p, time + span * (float(i) / float(SHAKE_POINTS - 1) * 2.0 - 1.0));
    if (i > 0) travel += length((shakePath[i] - shakePath[i - 1]) * resolution);
  }
  vec2 fw = max(fwidth(shakePath[SHAKE_POINTS / 2]), vec2(1e-6));
  // A sample every half pixel this pixel travels while the shutter is open (so short smears are exact).
  float moved = travel * shutter / span;
  int n = moved > 0.25 ? clamp(int(ceil(moved * 2.0)) + 1, 2, SHAKE_SAMPLES) : 1;
  // Staggered per pixel (and per frame) so a long smear is fine grain rather than copies.
  float jitter = 0.5;
  if (n > 1) {
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    jitter = fract(ign + 0.618034 * floor(time * max(fps, 1.0) + 0.5));
  }
  vec4 sum = vec4(0.0);
  for (int k = 0; k < SHAKE_SAMPLES; k++) {
    if (k >= n) break;
    float dt = shutter * ((float(k) + jitter) / float(n) * 2.0 - 1.0);
    if (split > 0.0) {
      // Red a little behind along the path, blue a little ahead.
      vec4 r = shakeSample(shakePathAt(dt - split, span), fw);
      vec4 g = shakeSample(shakePathAt(dt, span), fw);
      vec4 b = shakeSample(shakePathAt(dt + split, span), fw);
      sum += vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
    } else sum += shakeSample(shakePathAt(dt, span), fw);
  }
  return sum / float(n);
}
`;

const number = (key: string, label: string, value: number, min: number, max: number, unit: string, decimals: number): NumberSpec => ({
  kind: "number",
  key,
  label,
  default: value,
  min,
  max,
  unit,
  step: decimals > 1 ? 0.01 : decimals === 1 ? 0.1 : 1,
  decimals,
  slider: true,
});

/** The shake's own controls (both effects), with their defaults. */
function shakeParams(d: {
  frequency: number;
  amplitude: number;
  rotation: number;
  zoom: number;
  tilt: number;
  jaggedness: number;
}): ParamSpec[] {
  return [
    // Shakes per second.
    number("frequency", "Frequency", d.frequency, 0, 40, " /s", 1),
    // How far it moves at most, as a fraction of the frame's height.
    percent("amplitudeX", "Amplitude X", d.amplitude, { max: 0.5, decimals: 1 }),
    percent("amplitudeY", "Amplitude Y", d.amplitude, { max: 0.5, decimals: 1 }),
    degrees("rotation", "Rotation", d.rotation, 0, 45),
    // Punches in and out: 10% is x1.1 in, /1.1 out.
    percent("zoom", "Zoom", d.zoom, { max: 1, decimals: 1 }),
    // Turns the picture in 3D, like the camera swinging (S_Shake's tilts).
    degrees("tiltX", "Tilt X", d.tilt, 0, 45),
    degrees("tiltY", "Tilt Y", d.tilt, 0, 45),
    // 0: smooth drift; 100%: snaps and jitters.
    percent("jaggedness", "Jaggedness", d.jaggedness),
    // The shutter, in frames (100% = a whole frame): the shake smears along its own path.
    percent("motionBlur", "Motion Blur", 1, { max: 3 }),
    // Red and blue read a moment behind and ahead along the path: colour fringes on the moves.
    percent("chromaSplit", "Chromatic Split", 0),
    { kind: "number", key: "seed", label: "Random Seed", default: 0, min: 0, max: 1000, step: 1, decimals: 0 },
    {
      kind: "choice",
      key: "edges",
      label: "Edges",
      default: "mirror",
      options: [
        { value: "mirror", label: "Mirror" },
        { value: "extend", label: "Repeat Edge" },
        { value: "none", label: "Transparent" },
      ],
    },
    // Zooms in just enough that the furthest shake at the current strength never shows past the frame.
    { kind: "boolean", key: "zoomToHide", label: "Zoom To Hide", default: false },
  ];
}

export const SHAKE_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "shake",
    label: "Shake",
    tags: ["camera", "distort"],
    params: [
      // The master: keyframe it from 0 (exactly the picture) up on the hit and back.
      percent("amount", "Amount", 1, { max: 5 }),
      ...shakeParams({ frequency: 8, amplitude: 0.02, rotation: 1.5, zoom: 0.03, tilt: 2, jaggedness: 0.25 }),
    ],
    demo: { frequency: 5, amplitudeX: 0.08, amplitudeY: 0.08, rotation: 6, zoom: 0.1, tiltX: 18, tiltY: 18, motionBlur: 2.5, chromaSplit: 0.25 },
    animated: true,
    glsl: `${SHAKE_NOISE}
float wobble(float t, float ch) { return shakeNoise(t * frequency, ch); }
float reach(float t) { return 1.0; }
${SHAKE_CORE}
vec4 effect(vec2 uv) {
  if (amount <= 0.0) return getColor(uv);
  return shakeEffect(uv);
}`,
  }),
  videoEffect({
    type: "shake-hit",
    label: "Impact Shake",
    tags: ["camera"],
    params: [
      // When it hits, in seconds of the clip's media.
      number("hitTime", "Hit Time", 0, 0, 36_000, " s", 2),
      // How long it takes to settle.
      number("decay", "Decay", 0.8, 0.05, 10, " s", 2),
      percent("amount", "Strength", 1, { max: 5 }),
      ...shakeParams({ frequency: 12, amplitude: 0.05, rotation: 3, zoom: 0.08, tilt: 5, jaggedness: 0.3 }),
    ],
    demo: { hitTime: 0.3, decay: 1.2, amplitudeX: 0.08, amplitudeY: 0.08, rotation: 6, tiltX: 12, tiltY: 12, motionBlur: 2 },
    animated: true,
    glsl: `${SHAKE_NOISE}
// A bang, then a ringing that settles: every part starts near its furthest (in a random direction) and swings
// back and forth, roughened by the noise.
float wobble(float t, float ch) {
  float since = max(t - hitTime, 0.0);
  vec2 h = hash2(vec2(ch, 3.7));
  float swing = cos(2.0 * PI * frequency * since + (h.x - 0.5) * 1.2) * (h.y < 0.5 ? -1.0 : 1.0);
  return 0.7 * swing + 0.3 * shakeNoise(since * frequency, ch);
}
float reach(float t) {
  float since = t - hitTime;
  float x = since / max(decay, 0.01);
  // Kicks in over part of a frame: a jump from nothing would blur into two copies rather than a streak.
  float kick = min(0.6 / max(fps, 1.0), 0.2 * decay);
  return x < 0.0 || x >= 1.0 ? 0.0 : smoothstep(0.0, kick, since) * pow(1.0 - x, 2.5);
}
${SHAKE_CORE}
vec4 effect(vec2 uv) {
  // Before the hit and after it has settled (even across the shutter), exactly the picture.
  float span = 0.5 * motionBlur / max(fps, 1.0) + chromaSplit * 0.15 / max(frequency, 0.5);
  if (amount <= 0.0 || time + span < hitTime || time - span >= hitTime + max(decay, 0.01)) return getColor(uv);
  return shakeEffect(uv);
}`,
  }),
];
