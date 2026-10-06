/**
 * Storm Sea (docs/visualizer/scenes.md): skimming a heaving night sea in a storm, a low ceiling of cloud, lightning
 * on the hits lighting the clouds from inside and the sea below; or a calm moonlit or sunset sea. The sea is a
 * heightfield of sharpened directional waves (`seaHeight`, mirrored here for the camera's heave). Stepped: how
 * far it's skimmed (a speed on the bass), the waves' clock and height (the level), the camera's heave and roll,
 * and the flashes: each hit a seeded place in the clouds, flickering out.
 */
import type { SceneSpec } from "./index.ts";
import { type Vec3, cameraUniforms, clamp01, float, num, random, sceneDt, smoothTo, soundUniforms, vec4 } from "./kit.ts";

const FLASHES = 3;

/** Directions, wavenumbers and speeds of the sea's octaves (the GLSL's own, in the same order). */
const OCTAVES = Array.from({ length: 8 }, (_, i) => {
  const a = i * 2.39996 + 0.4;
  return { dir: [Math.cos(a), Math.sin(a)] as [number, number], k: 0.028 * 1.85 ** i, w: 0.9 * Math.sqrt(1.85) ** i, amp: 0.52 ** i, sharp: Math.max(1.2, 3.2 - i * 0.35) };
});

/** The sea's height at (x, z) at wave time `t`, its first `octaves` (the camera only needs the swell). */
export function seaHeight(x: number, z: number, t: number, height: number, octaves = 3): number {
  let h = 0;
  for (let i = 0; i < octaves; i++) {
    const o = OCTAVES[i];
    const ph = (x * o.dir[0] + z * o.dir[1]) * o.k - t * o.w;
    const s = 0.5 + 0.5 * Math.sin(ph + 0.6 * Math.sin(ph * 0.5));
    h += o.amp * s ** o.sharp;
  }
  return h * 4.6 * height;
}

interface Flash {
  x: number;
  y: number;
  z: number;
  age: number;
  power: number;
}

interface SeaState {
  time: number;
  /** The waves' own clock, and how far it's skimmed. */
  waves: number;
  dist: number;
  speed: number;
  swell: number;
  y: number;
  roll: number;
  flashes: Flash[];
  rng: { seed: number };
}

/** A flash's brightness at an age: a strike, a couple of re-strikes, then gone (deterministic). */
const flicker = (age: number) => (age < 0 ? 0 : Math.exp(-age * 5) * (age < 0.06 ? 1.6 : 0.55 + 0.45 * Math.sign(Math.sin(age * 41 + 1.3))));

export const STORM_SEA: SceneSpec<SeaState> = {
  type: "storm-sea",
  label: "Storm Sea",
  params: [
    {
      kind: "choice",
      key: "weather",
      label: "Weather",
      default: "storm",
      options: [
        { value: "storm", label: "Storm" },
        { value: "moonlit", label: "Moonlit" },
        { value: "sunset", label: "Sunset" },
      ],
    },
    { kind: "number", key: "waveHeight", label: "Wave Height", default: 1, min: 0.2, max: 2.5, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "lightning", label: "Lightning", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  glsl: /* glsl */ `
uniform float ssWaves;
uniform float ssSwell;
uniform vec4 ssFlash0;
uniform vec4 ssFlash1;
uniform vec4 ssFlash2;
uniform vec4 ssBolt0;
uniform vec4 ssBolt1;
uniform vec4 ssBolt2;

float seaHeight(vec2 p, int octaves) {
  float h = 0.0;
  float amp = 1.0;
  float k = 0.028;
  float w = 0.9;
  float sharp = 3.2;
  // A little warp, so the crests aren't straight lines.
  p += (vec2(vnoise2d(p * 0.05).x, vnoise2d(p * 0.05 + 7.3).x) - 0.5) * 6.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float a = float(i) * 2.39996 + 0.4;
    float ph = dot(p, vec2(cos(a), sin(a))) * k - ssWaves * w;
    float s = 0.5 + 0.5 * sin(ph + 0.6 * sin(ph * 0.5));
    h += amp * pow(s, max(1.2, sharp));
    amp *= 0.52;
    k *= 1.85;
    w *= 1.36;
    sharp -= 0.35;
  }
  return h * 4.6 * ssSwell;
}
float marchSea(vec3 ro, vec3 rd, float tmax) {
  // Above the highest crest, stepping by how high above the water it is.
  float t = 0.5;
  float lastT = t;
  for (int i = 0; i < 160; i++) {
    vec3 p = ro + rd * t;
    float dh = p.y - seaHeight(p.xz, 5);
    if (dh < 0.0) {
      float a = lastT;
      float b = t;
      for (int k = 0; k < 6; k++) {
        float m = 0.5 * (a + b);
        vec3 q = ro + rd * m;
        if (q.y - seaHeight(q.xz, 5) < 0.0) b = m; else a = m;
      }
      return 0.5 * (a + b);
    }
    lastT = t;
    t += max(dh * 0.6, 0.02 + t * 0.004);
    if (t > tmax) break;
  }
  return -1.0;
}
vec3 seaNormal(vec2 p, float t) {
  float e = 0.02 + t * 0.0015;
  int o = t < 80.0 ? 8 : 6;
  float h = seaHeight(p, o);
  vec3 n = normalize(vec3(h - seaHeight(p + vec2(e, 0.0), o), e, h - seaHeight(p + vec2(0.0, e), o)));
  // Wind ripples on top, near the lens only (far off they'd shimmer).
  vec2 q = p * 1.3 + vec2(ssWaves * 1.5, ssWaves * 0.7);
  vec2 g = vnoise2d(q).yz + 0.5 * vnoise2d(q * 2.3 + 4.1).yz;
  return normalize(n + vec3(g.x, 0.0, g.y) * 0.12 * exp(-t * 0.03));
}

// The flashes: where each is (xyz) and how bright (w).
vec3 flashLight(vec3 p, out vec3 dirToBrightest) {
  vec3 sum = vec3(0.0);
  float best = 0.0;
  dirToBrightest = vec3(0.0, 1.0, 0.0);
  vec4 fl[3];
  fl[0] = ssFlash0;
  fl[1] = ssFlash1;
  fl[2] = ssFlash2;
  for (int i = 0; i < 3; i++) {
    if (fl[i].w <= 0.0) continue;
    vec3 d = fl[i].xyz - p;
    float l2 = dot(d, d);
    float e = fl[i].w * 6000.0 / (l2 + 4000.0);
    sum += vec3(0.75, 0.82, 1.0) * e;
    if (e > best) { best = e; dirToBrightest = normalize(d); }
  }
  return sum * lightning;
}

vec3 skyBase(vec3 rd) {
  float y = max(rd.y, 0.0);
  if (weather == 1) return mix(vec3(0.03, 0.045, 0.08), vec3(0.004, 0.008, 0.02), pow(y, 0.5));
  if (weather == 2) return mix(mix(vec3(1.5, 0.48, 0.14), vec3(0.55, 0.18, 0.32), smoothstep(0.0, 0.15, y)), vec3(0.05, 0.06, 0.2), smoothstep(0.1, 0.7, y));
  return mix(vec3(0.03, 0.035, 0.045), vec3(0.008, 0.01, 0.014), pow(y, 0.6));
}
// The cloud deck: marched through a slab, lit by the flashes inside it (and the moon or the sun).
vec4 clouds(vec3 ro, vec3 rd) {
  if (rd.y <= 0.0) return vec4(0.0);
  float base = weather == 0 ? 70.0 : 160.0;
  float top = base + (weather == 0 ? 90.0 : 40.0);
  float t0 = (base - ro.y) / rd.y;
  float t1 = (top - ro.y) / rd.y;
  int n = int(mix(8.0, 18.0, quality));
  float dt = (t1 - t0) / float(n);
  vec3 col = vec3(0.0);
  float trans = 1.0;
  float jitter = hash12(gl_FragCoord.xy);
  for (int i = 0; i < 18; i++) {
    if (i >= n || trans < 0.03) break;
    float t = t0 + dt * (float(i) + jitter);
    vec3 p = ro + rd * t;
    float dens = fbm3(p * 0.012 + vec3(ssWaves * 0.02, 0.0, ssWaves * 0.05), 5);
    dens = smoothstep(weather == 0 ? 0.38 : 0.55, 0.85, dens) * (weather == 0 ? 0.08 : 0.04);
    if (dens <= 0.0) continue;
    vec3 tb;
    vec3 lit = flashLight(p, tb) * 0.18;
    vec3 amb = weather == 0 ? vec3(0.02, 0.023, 0.03) : weather == 1 ? vec3(0.05, 0.06, 0.09) : vec3(0.7, 0.3, 0.25);
    float a = 1.0 - exp(-dens * dt);
    col += trans * a * (amb + lit);
    trans *= 1.0 - a;
  }
  return vec4(col, 1.0 - trans);
}
// A bolt: a jagged line down from the clouds at (x, z), its brightness w.
float bolt(vec3 ro, vec3 rd, vec4 b) {
  if (b.w <= 0.0) return 0.0;
  vec2 rel = b.xz - ro.xz;
  vec2 hd = normalize(rd.xz);
  float along = dot(rel, hd);
  if (along <= 0.0) return 0.0;
  float t = along / max(length(rd.xz), 1e-4);
  float y = ro.y + rd.y * t;
  if (y < 0.0 || y > b.y) return 0.0;
  // Jagged: offsets that grow finer down the bolt.
  float jag = (vnoise3(vec3(y * 0.08, b.x, 0.0)) - 0.5) * 14.0 + (vnoise3(vec3(y * 0.4, b.z, 1.0)) - 0.5) * 4.0;
  float side = dot(rel, vec2(-hd.y, hd.x)) + jag;
  float w = 0.25 + t * 0.002;
  return b.w * (exp(-abs(side) / w) * 2.0 + exp(-abs(side) / (w * 12.0)) * 0.3);
}
vec3 sky(vec3 ro, vec3 rd) {
  vec3 col = skyBase(rd);
  if (weather == 1) {
    // The moon, low.
    vec3 m = normalize(vec3(-0.3, 0.18, 1.0));
    float md = max(dot(rd, m), 0.0);
    col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.9993, 0.9996, md) * 4.0 + pow(md, 200.0) * 0.4 + pow(md, 12.0) * 0.06);
  } else if (weather == 2) {
    vec3 s = normalize(vec3(0.2, 0.05, 1.0));
    float sd = max(dot(rd, s), 0.0);
    col += vec3(1.0, 0.6, 0.3) * (smoothstep(0.9990, 0.9995, sd) * 20.0 + pow(sd, 60.0) * 1.5 + pow(sd, 6.0) * 0.4);
  }
  vec4 cl = clouds(ro, rd);
  col = col * (1.0 - cl.a) + cl.rgb;
  col += vec3(0.7, 0.8, 1.0) * (bolt(ro, rd, ssBolt0) + bolt(ro, rd, ssBolt1) + bolt(ro, rd, ssBolt2)) * lightning;
  return col;
}

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  vec3 col;
  float t = rd.y < 0.02 ? marchSea(ro, rd, 900.0) : -1.0;
  if (t < 0.0) {
    col = sky(ro, rd);
  } else {
    vec3 p = ro + rd * t;
    vec3 n = seaNormal(p.xz, t);
    vec3 r = reflect(rd, n);
    r.y = abs(r.y);
    float fres = clamp(1.0 - dot(n, -rd), 0.0, 1.0);
    fres = 0.02 + 0.98 * pow(fres, 3.0) * 0.45;
    vec3 refl = sky(p, r) * (weather == 2 ? 0.7 : 1.0);
    // The water's own colour, and light through the crests (thin water near their tops).
    vec3 deep = weather == 2 ? vec3(0.005, 0.02, 0.04) : vec3(0.004, 0.012, 0.018);
    vec3 shallow = weather == 2 ? vec3(0.04, 0.1, 0.11) : vec3(0.03, 0.09, 0.08);
    float crest = clamp((p.y - seaHeight(p.xz, 2)) * 0.6 + 0.3, 0.0, 1.0);
    vec3 tb;
    vec3 fl = flashLight(p, tb);
    vec3 amb = weather == 2 ? vec3(0.22, 0.12, 0.08) : weather == 1 ? vec3(0.06, 0.08, 0.13) : vec3(0.025, 0.03, 0.04);
    vec3 water = mix(deep, shallow, crest * crest) * (amb * 3.0 + fl * 0.4);
    col = mix(water, refl, fres);
    // Glints of the flashes (and the moon or sun) on the water.
    col += fl * pow(clamp(dot(r, tb), 0.0, 1.0), 60.0) * 0.6;
    if (weather == 1) col += vec3(0.8, 0.85, 1.0) * pow(clamp(dot(r, normalize(vec3(-0.3, 0.18, 1.0))), 0.0, 1.0), 300.0) * 2.0;
    if (weather == 2) col += vec3(1.2, 0.7, 0.35) * pow(clamp(dot(r, normalize(vec3(0.2, 0.05, 1.0))), 0.0, 1.0), 200.0) * 4.0;
    // Foam: whitecaps where the crests break, and streaks of it the wind has drawn out.
    // (Where the water stands above the swell's own surface: a crest of the small waves on a big one.)
    float above = p.y - seaHeight(p.xz, 3);
    float crestFoam = smoothstep(0.5, 1.1, above) * smoothstep(0.45, 0.8, fbm3(vec3(p.xz * 1.2, ssWaves * 0.3), 4));
    float streaks = smoothstep(0.62, 0.85, fbm3(vec3(p.x * 0.9, 0.0, p.z * 0.09) + vec3(0.0, ssWaves * 0.05, 0.0), 4));
    streaks *= smoothstep(0.4, 0.7, vnoise3(vec3(p.xz * 2.5, 2.0))) * (weather == 0 ? 0.55 : 0.12);
    float foam = clamp(crestFoam * (weather == 0 ? 1.0 : 0.4) + streaks, 0.0, 1.0);
    col = mix(col, (amb * 3.0 + fl * 0.6) * 0.7, foam * 0.75);
    // Spray and haze in the distance.
    vec3 haze = weather == 2 ? vec3(0.9, 0.4, 0.2) : weather == 1 ? vec3(0.02, 0.03, 0.05) : vec3(0.015, 0.018, 0.022);
    col = mix(col, haze + fl * 0.05, 1.0 - exp(-t * (weather == 0 ? 0.008 : weather == 2 ? 0.0015 : 0.003)));
  }
  // Rain: streaks falling fast across the frame (a storm's, heavier with the highs).
  if (weather == 0) {
    // Thin streaks slanting in the wind, two layers at two speeds.
    float s2 = 0.0;
    for (int l = 0; l < 2; l++) {
      float fl2 = float(l);
      vec2 q = vec2((uv.x + uv.y * 0.12) * ratio * (260.0 + fl2 * 140.0), uv.y * (5.0 + fl2 * 3.0) + ssWaves * (11.0 + fl2 * 6.0));
      float col2 = floor(q.x);
      float on = step(0.86, hash12(vec2(col2, fl2 + floor(q.y + hash12(vec2(col2, 7.0 + fl2)) * 9.0))));
      float y = fract(q.y + hash12(vec2(col2, 3.0 + fl2)) * 9.0);
      float x = abs(fract(q.x) - 0.5);
      s2 += on * smoothstep(0.0, 0.15, y) * (1.0 - smoothstep(0.15, 0.5, y)) * smoothstep(0.35, 0.0, x) * (0.6 - fl2 * 0.25);
    }
    vec3 tb;
    col += (vec3(0.025, 0.028, 0.034) + flashLight(camPos + vec3(0.0, 30.0, 40.0), tb) * 0.03) * s2 * (0.4 + sHigh);
  }
  return col;
}
`,
  init: () => ({ time: 0, waves: 0, dist: 0, speed: 8, swell: 1, y: 7, roll: 0, flashes: [], rng: { seed: 0x5ea5eed } }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    const height = Math.max(0.2, num(frame.values, "waveHeight", 1));
    s.time += dt;
    s.waves += dt * (0.8 + 0.6 * a.level);
    s.swell = smoothTo(s.swell, height * (0.7 + 0.6 * a.bass + 0.3 * a.level), frame.dt, 1.5);
    s.speed = smoothTo(s.speed, 6 + 14 * a.bass + 8 * a.punch, frame.dt, 0.7);
    s.dist += s.speed * dt;
    // The camera rides the swell: its height follows the water under it, a little ahead.
    const under = seaHeight(0, s.dist + 6, s.waves, 1) * s.swell;
    s.y = smoothTo(s.y, under + 4 + 2.5 * s.swell, frame.dt, 0.35);
    const slope = (seaHeight(2, s.dist + 6, s.waves, 1) - seaHeight(-2, s.dist + 6, s.waves, 1)) * s.swell;
    s.roll = smoothTo(s.roll, Math.max(-0.35, Math.min(0.35, -slope * 0.06)), frame.dt, 0.4);
    for (const f of s.flashes) f.age += frame.dt;
    s.flashes = s.flashes.filter((f) => f.age < 1.2);
    if (a.onBeat) {
      // A strike somewhere ahead in the clouds, seeded.
      s.flashes.push({ x: (random(s.rng) - 0.5) * 240, y: 75 + random(s.rng) * 20, z: s.dist + 60 + random(s.rng) * 220, age: 0, power: 0.6 + 0.6 * clamp01(frame.hit) });
      if (s.flashes.length > FLASHES) s.flashes.shift();
    }
  },
  uniforms(s, frame) {
    const pos: Vec3 = [0, s.y, s.dist];
    const target: Vec3 = [0, s.y - 3.2 + 1.2 * Math.sin(s.time * 0.23), s.dist + 40];
    const weather = frame.values.weather;
    const flashes = Array.from({ length: FLASHES }, (_, i) => s.flashes[i]);
    return [
      ...cameraUniforms(pos, target, s.roll, 70),
      ...soundUniforms(frame),
      float("ssWaves", s.waves),
      float("ssSwell", s.swell),
      ...flashes.map((f, i) => vec4(`ssFlash${i}`, f && weather === "storm" ? [f.x, f.y, f.z, f.power * flicker(f.age)] : [0, 0, 0, 0])),
      // The bolt itself shows only while it strikes.
      ...flashes.map((f, i) => vec4(`ssBolt${i}`, f && weather === "storm" && f.age < 0.25 ? [f.x, f.y, f.z, f.power * flicker(f.age)] : [0, 0, 0, 0])),
    ];
  },
};
