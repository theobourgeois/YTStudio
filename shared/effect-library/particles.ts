/**
 * Particle World: simulated particles in the style of CC Particle World and
 * Trapcode Particular, drawn by the compositor as instanced quads (see
 * `particles.ts`). Each particle is born at its own moment from the emitter
 * and flies by closed-form physics (speed, gravity, wind, air resistance) plus
 * a turbulence field, so any frame can be drawn on its own. Emitting from the
 * layer (its opaque parts, in its colours) is the disintegration effect.
 */
import type { EffectDefinition } from "../effects.ts";
import { PARTICLE_SHAPES } from "../particles.ts";
import type { ParamValues } from "../types.ts";
import { degrees, percent, videoEffect } from "./common.ts";

const num = (v: ParamValues, key: string) => Number(v[key] ?? 0);

/**
 * The dissolve both the layer and the particles use (they must agree to the pixel): how far
 * it's got at a time into the clip (-1: no dissolve), and the grain it eats the layer along.
 */
const DISSOLVE = `
float dissolveAt(float t) {
  return dissolveDuration <= 0.0 ? -1.0 : clamp((t - dissolveStart) / dissolveDuration, 0.0, 1.0) * 1.08;
}
float dissolveGrain(vec2 uv) {
  return clamp((fbm(aspect(uv) * dissolveScale + seed * 3.1) - 0.2) / 0.6, 0.0, 1.0);
}`;

/** Most particles one effect draws. */
const MAX_PARTICLES = 60_000;

export const PARTICLE_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "particle-world",
    label: "Particle World",
    tags: ["generate", "light"],
    animated: true,
    params: [
      {
        kind: "choice",
        key: "emitter",
        label: "Emitter",
        default: "point",
        options: [
          { value: "point", label: "Point" },
          { value: "line", label: "Line" },
          { value: "box", label: "Box" },
          { value: "circle", label: "Circle" },
          { value: "layer", label: "Layer (its shape)" },
          { value: "dissolve", label: "Dissolving Layer" },
        ],
      },
      { kind: "vec2", key: "emitterPosition", label: "Position", default: [0.5, 0.7], space: "media", min: -10, max: 10, step: 1, decimals: 1 },
      percent("emitterWidth", "Emitter Width", 0.3, { max: 2 }),
      percent("emitterHeight", "Emitter Height", 0.1, { max: 2 }),
      {
        kind: "choice",
        key: "birthMode",
        label: "Birth",
        default: "continuous",
        options: [
          { value: "continuous", label: "Continuous" },
          { value: "burst", label: "Burst" },
        ],
      },
      { kind: "number", key: "birthRate", label: "Birth Rate", default: 150, min: 0, max: 20_000, unit: " /s", step: 5, decimals: 0 },
      { kind: "number", key: "burstCount", label: "Burst Count", default: 400, min: 1, max: MAX_PARTICLES, step: 10, decimals: 0, disabledFor: (v) => v.birthMode !== "burst" },
      // Seconds into the clip.
      { kind: "number", key: "burstTime", label: "Burst Time", default: 0, min: -3600, max: 3600, unit: " s", step: 0.01, decimals: 2, disabledFor: (v) => v.birthMode !== "burst" },
      // Particle World's pre-run: the clip starts this far into the emission (so snow is already falling).
      { kind: "number", key: "prerun", label: "Pre-Run", default: 0, min: 0, max: 30, unit: " s", step: 0.1, decimals: 1 },
      { kind: "number", key: "lifetime", label: "Longevity", default: 2, min: 0.05, max: 30, unit: " s", step: 0.05, decimals: 2 },
      percent("lifeRandom", "Longevity Random", 0.4),
      // Speeds and forces in frame heights (per second, per second squared).
      { kind: "number", key: "speed", label: "Velocity", default: 0.35, min: 0, max: 10, step: 0.01, decimals: 2 },
      percent("speedRandom", "Velocity Random", 0.5),
      degrees("direction", "Direction", 0),
      { ...degrees("spread", "Spread", 50, 0, 360), slider: true },
      { kind: "number", key: "gravity", label: "Gravity", default: 0.25, min: -10, max: 10, step: 0.01, decimals: 2 },
      { kind: "number", key: "wind", label: "Wind", default: 0, min: -10, max: 10, step: 0.01, decimals: 2 },
      { kind: "number", key: "drag", label: "Air Resistance", default: 0.4, min: 0, max: 20, step: 0.05, decimals: 2 },
      percent("turbulence", "Turbulence", 0.04, { max: 1, decimals: 1 }),
      { kind: "number", key: "turbulenceScale", label: "Turbulence Scale", default: 3, min: 0.1, max: 50, step: 0.1, decimals: 1 },
      { kind: "choice", key: "shape", label: "Particle Type", default: "glow", options: PARTICLE_SHAPES.map(({ value, label }) => ({ value, label })) },
      percent("size", "Size", 0.012, { min: 0.0005, max: 0.3, decimals: 1 }),
      percent("sizeRandom", "Size Random", 0.5),
      {
        kind: "choice",
        key: "sizeOverLife",
        label: "Size Over Life",
        default: "shrink",
        options: [
          { value: "constant", label: "Constant" },
          { value: "shrink", label: "Shrink" },
          { value: "grow", label: "Grow" },
          { value: "pulse", label: "Grow and Shrink" },
        ],
      },
      percent("opacity", "Opacity", 1),
      percent("fadeIn", "Fade In", 0.1),
      percent("fadeOut", "Fade Out", 0.5),
      {
        kind: "choice",
        key: "colorMode",
        label: "Color",
        default: "gradient",
        options: [
          { value: "single", label: "Birth Color" },
          { value: "gradient", label: "Birth to Death" },
          { value: "layer", label: "From Layer" },
          { value: "random", label: "Random Hues" },
        ],
      },
      { kind: "color", key: "birthColor", label: "Birth Color", default: "#ffe2a8" },
      { kind: "color", key: "deathColor", label: "Death Color", default: "#ff4a1a" },
      percent("glow", "Glow", 0.4),
      // How far each particle smears along its path, in frames: its motion blur.
      percent("streak", "Motion Blur", 0.5, { max: 5 }),
      { kind: "number", key: "spin", label: "Spin", default: 0, min: -3600, max: 3600, unit: "°/s", step: 1, decimals: 0 },
      {
        kind: "choice",
        key: "particleBlend",
        label: "Blend",
        default: "add",
        options: [
          { value: "over", label: "Normal" },
          { value: "add", label: "Add" },
          { value: "screen", label: "Screen" },
        ],
      },
      // The layer under the particles: shown, faded, or eaten away (Dissolving Layer emits from the edge that's going).
      percent("layerOpacity", "Layer Opacity", 1),
      { kind: "number", key: "dissolveStart", label: "Dissolve Start", default: 0, min: -3600, max: 3600, unit: " s", step: 0.05, decimals: 2 },
      { kind: "number", key: "dissolveDuration", label: "Dissolve Duration", default: 0, min: 0, max: 60, unit: " s", step: 0.05, decimals: 2 },
      { kind: "number", key: "dissolveScale", label: "Dissolve Grain", default: 6, min: 0.5, max: 60, step: 0.5, decimals: 1 },
      percent("dissolveGlow", "Dissolve Edge Glow", 0.6, { max: 3 }),
      { kind: "number", key: "seed", label: "Random Seed", default: 0, min: 0, max: 1000, step: 1, decimals: 0 },
      // Grow Bounds: how far past the clip's frame particles can fly and still show (a fraction of its height each side).
      percent("room", "Room Past Frame", 0.5, { max: 3 }),
    ],
    grow: (v) => num(v, "room"),
    demo: { birthRate: 400, speed: 0.5, gravity: 0.4, size: 0.02, glow: 0.8 },
    // The layer under the particles: faded, and eaten away by the dissolve with a glowing edge.
    glsl: `${DISSOLVE}
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv) * layerOpacity;
  float d = dissolveAt(clipTime);
  if (d < 0.0) return c;
  float g = dissolveGrain(uv);
  float keep = smoothstep(d, d + 0.015, g);
  float edge = smoothstep(d + 0.07, d, g) * keep;
  vec4 o = c * keep;
  o.rgb = min(o.rgb + deathColor * edge * dissolveGlow * o.a, vec3(o.a));
  return o;
}`,
    particles: {
      count: (v) =>
        Math.min(MAX_PARTICLES, v.birthMode === "burst" ? num(v, "burstCount") : Math.ceil(num(v, "birthRate") * num(v, "lifetime") * (1 + num(v, "lifeRandom"))) + 1),
      blend: (v) => (v.particleBlend === "over" ? 0 : v.particleBlend === "screen" ? 2 : 1),
      glsl: `${DISSOLVE}
float rnd(float n, float k) { return hash(vec2(n * 0.61803 + seed * 13.17 + k * 7.31, k * 1.37 + n * 0.0017 + 3.7)); }
vec3 hueColor(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
Particle particle(int id) {
  // Seconds of emission so far: from the clip's start (plus the pre-run).
  float now = clipTime + prerun;
  float n;
  float born;
  if (birthMode == 0) {
    // The id-th most recent birth: particle n is born around n / birthRate seconds in.
    if (birthRate <= 0.0) return deadParticle();
    n = floor(now * birthRate) - float(id);
    if (n < 0.0) return deadParticle();
    born = (n + rnd(n, 9.0)) / birthRate;
  } else {
    n = float(id);
    born = burstTime + prerun + rnd(n, 9.0) * 0.03;
  }
  float age = now - born;
  float life = max(0.02, lifetime * (1.0 + lifeRandom * (rnd(n, 1.0) * 2.0 - 1.0)));
  if (age < 0.0 || age > life) return deadParticle();
  float t = age / life;

  // Where it was born, in square units (the layer's heights; the clip's frame is S of them tall).
  float S = frameScale();
  float frameWidth = frameRatio() * S;
  vec2 origin = frameUv(emitterPosition);
  vec2 local = vec2(0.0);
  if (emitter == 1) local = vec2((rnd(n, 2.0) - 0.5) * emitterWidth * frameWidth, 0.0);
  else if (emitter == 2) local = (vec2(rnd(n, 2.0), rnd(n, 3.5)) - 0.5) * vec2(emitterWidth * frameWidth, emitterHeight * S);
  else if (emitter == 3) {
    float a = rnd(n, 2.0) * 2.0 * PI;
    local = vec2(cos(a) * emitterWidth * frameWidth, sin(a) * emitterHeight * S) * 0.5 * sqrt(rnd(n, 3.5));
  } else if (emitter == 4) {
    // From the layer's opaque parts: a few random tries over its frame, the first that lands on it.
    bool found = false;
    for (int i = 0; i < 12; i++) {
      vec2 c = uFrame.xy + vec2(rnd(n, 20.0 + float(i)), rnd(n, 40.0 + float(i))) * (uFrame.zw - uFrame.xy);
      if (layerAt(c).a > 0.5) {
        origin = c;
        found = true;
        break;
      }
    }
    if (!found) return deadParticle();
  } else if (emitter == 5) {
    // From the edge the dissolve was eating when it was born.
    float d = dissolveAt(clipTime - age);
    if (d <= 0.0 || d >= 1.0) return deadParticle();
    bool found = false;
    for (int i = 0; i < 24; i++) {
      vec2 c = uFrame.xy + vec2(rnd(n, 20.0 + float(i)), rnd(n, 60.0 + float(i))) * (uFrame.zw - uFrame.xy);
      float g = dissolveGrain(c);
      if (g <= d && g > d - 0.06 && layerAt(c).a > 0.5) {
        origin = c;
        found = true;
        break;
      }
    }
    if (!found) return deadParticle();
  }
  vec2 p0 = vec2(origin.x * ratio, origin.y) + local;
  vec2 birthUv = vec2(p0.x / ratio, p0.y);

  // Flight: launched at a speed and angle (0° up), pulled by gravity and wind, slowed by the air.
  float angle = radians(direction + spread * (rnd(n, 4.0) - 0.5));
  float sp = speed * S * max(0.0, 1.0 + speedRandom * (rnd(n, 5.0) * 2.0 - 1.0));
  vec2 v0 = vec2(sin(angle), cos(angle)) * sp;
  vec2 g = vec2(wind, -gravity) * S;
  vec2 pos;
  vec2 vel;
  if (drag < 1e-3) {
    pos = p0 + v0 * age + 0.5 * g * age * age;
    vel = v0 + g * age;
  } else {
    float e = exp(-drag * age);
    pos = p0 + v0 * (1.0 - e) / drag + g * (age / drag - (1.0 - e) / (drag * drag));
    vel = v0 * e + g * (1.0 - e) / drag;
  }
  // Turbulence: a slowly changing swirl that carries it further the older it is.
  vec2 tp = pos / S * turbulenceScale + vec2(n * 0.013, n * 0.007);
  vec2 swirl = vec2(fbm(tp + vec2(0.0, time * 0.4)), fbm(tp + vec2(17.3, 5.1 - time * 0.4))) - 0.5;
  pos += swirl * turbulence * S * 4.0 * min(age, 1.5);

  Particle p;
  p.alive = true;
  p.position = vec2(pos.x / ratio, pos.y);
  p.velocity = vec2(vel.x / ratio, vel.y);
  float grow = sizeOverLife == 1 ? 1.0 - t : sizeOverLife == 2 ? t : sizeOverLife == 3 ? sin(PI * t) : 1.0;
  p.size = size * S * max(0.0, 1.0 + sizeRandom * (rnd(n, 6.0) * 2.0 - 1.0)) * grow;
  float alpha = opacity * smoothstep(0.0, max(fadeIn, 1e-3), t) * (1.0 - smoothstep(1.0 - max(fadeOut, 1e-3), 1.0, t));
  vec3 rgb = birthColor;
  if (colorMode == 1) rgb = mix(birthColor, deathColor, t);
  else if (colorMode == 2 || emitter >= 4) {
    vec4 c = layerAt(birthUv);
    rgb = c.a > 0.0 ? c.rgb / c.a : birthColor;
    if (colorMode == 1) rgb = mix(rgb, deathColor, t);
  } else if (colorMode == 3) rgb = mix(hueColor(rnd(n, 7.0)), vec3(1.0), 0.15);
  p.color = vec4(rgb, alpha);
  p.rotation = radians(spin * age + rnd(n, 8.0) * 360.0);
  p.shape = float(shape);
  p.glow = glow;
  p.streak = streak / max(fps, 1.0);
  return p;
}`,
    },
  }),
];
