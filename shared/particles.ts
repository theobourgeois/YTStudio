/**
 * Particle effects (After Effects' CC Particle World, Trapcode Particular): each
 * particle is a quad the compositor draws (instanced, `EffectPass.particles`),
 * placed by the effect's `Particle particle(int id)` in a vertex shader and
 * shaded here. A particle's state is worked out in closed form from its birth,
 * so any moment can be drawn on its own: seeking and the export need no
 * simulation run up to it.
 *
 * What `particle(id)` can use: the effect's parameters, `time`, `fps`,
 * `ratio`, `resolution`, `uSrc` (its layer: `layerAt(uv)` for colours and
 * shapes to emit from), `hash`/`hash2`/`noise`/`fbm`, `PI`. It returns a
 * `Particle`: alive, position (uv, y up), size (diameter, a fraction of the
 * height), straight colour, rotation, velocity (uv per second: with `streak`,
 * the particle is smeared along it), shape and glow.
 */
import { GLSL_HELPERS } from "./transition-gl.ts";

/** Particle shapes, the order `Particle.shape` counts in. */
export const PARTICLE_SHAPES = [
  { value: "glow", label: "Glow Dot" },
  { value: "disc", label: "Disc" },
  { value: "square", label: "Square" },
  { value: "sparkle", label: "Sparkle" },
  { value: "ring", label: "Ring" },
  { value: "bokeh", label: "Bokeh" },
  { value: "shard", label: "Shard" },
] as const;

const VS_PRELUDE = `#version 300 es
precision highp float;
precision highp int;
in vec2 aPos;
uniform sampler2D uSrc;
uniform float ratio;
uniform vec2 resolution;
uniform float time;
uniform float clipTime;
uniform float fps;
uniform vec4 uFrame;
${GLSL_HELPERS}
struct Particle {
  bool alive;
  vec2 position;
  float size;
  vec4 color;
  float rotation;
  vec2 velocity;
  float shape;
  float glow;
  float streak;
};
Particle deadParticle() { Particle p; p.alive = false; return p; }
vec4 layerAt(vec2 uv) { return textureLod(uSrc, uv, 0.0); }
// The clip's frame within this layer (which an effect may have grown: Grow Bounds): a point of
// the frame (fractions, y down) to uv, a frame-sized length to the layer's uv height, and the
// frame's width / height.
vec2 frameUv(vec2 p) { vec2 q = toUv(p); return uFrame.xy + q * (uFrame.zw - uFrame.xy); }
float frameScale() { return uFrame.w - uFrame.y; }
float frameRatio() { return ratio * (uFrame.z - uFrame.x) / max(uFrame.w - uFrame.y, 1e-6); }
`;

/** Places the quad: a disc of the particle's size (grown for its glow), stretched along its velocity by its streak. */
const VS_MAIN = `
out vec2 vLocal;
out vec4 vColor;
flat out float vShape;
out float vGlow;
out float vHalf;
out float vPixel;
void main() {
  Particle p = particle(gl_InstanceID);
  if (!p.alive || p.color.a <= 0.0 || p.size <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float radius = max(p.size * 0.5, 0.5 / resolution.y);
  // Room for the glow's halo.
  float reach = 1.0 + p.glow * 1.5 + 2.0 / (radius * resolution.y);
  // Smeared along its path over the shutter (motion blur), in square units (heights).
  vec2 travel = p.velocity * vec2(ratio, 1.0) * p.streak;
  float len = length(travel);
  vec2 along = len > 1e-6 ? travel / len : vec2(cos(p.rotation), sin(p.rotation));
  vec2 across = vec2(-along.y, along.x);
  float half_ = len * 0.5 / radius;
  vec2 corner = aPos * 2.0 - 1.0;
  vLocal = vec2(corner.x * (reach + half_), corner.y * reach);
  vec2 offset = (along * vLocal.x + across * vLocal.y) * radius;
  vec2 uv = p.position + offset / vec2(ratio, 1.0);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  vColor = p.color;
  vShape = p.shape;
  vGlow = p.glow;
  vHalf = half_;
  vPixel = 1.0 / max(radius * resolution.y, 1e-3);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vColor;
flat in float vShape;
in float vGlow;
in float vHalf;
in float vPixel;
out vec4 fragColor;
void main() {
  // Distance from the particle's path (a segment when it's smeared), in radii.
  vec2 q = vec2(vLocal.x - clamp(vLocal.x, -vHalf, vHalf), vLocal.y);
  float d = length(q);
  float aa = max(vPixel * 1.5, 0.02);
  float a;
  int shape = int(vShape + 0.5);
  if (shape == 0) a = exp(-d * d * 2.5);
  else if (shape == 1) a = smoothstep(1.0 + aa, 1.0 - aa, d);
  else if (shape == 2) a = smoothstep(1.0 + aa, 1.0 - aa, max(abs(q.x), abs(q.y)));
  else if (shape == 3) {
    // Four rays and a hot core.
    float rays = exp(-abs(q.x) * 9.0) * exp(-q.y * q.y * 0.6) + exp(-abs(q.y) * 9.0) * exp(-q.x * q.x * 0.6);
    a = clamp(rays * 0.9 + exp(-d * d * 12.0), 0.0, 1.0) * smoothstep(2.4, 1.4, d);
  } else if (shape == 4) a = smoothstep(0.22 + aa, 0.22 - aa, abs(d - 0.8));
  else if (shape == 5) a = smoothstep(1.0 + aa, 1.0 - aa, d) * (0.45 + 0.55 * smoothstep(0.55, 0.95, d));
  else a = smoothstep(1.0 + aa, 1.0 - aa, abs(q.x) * 0.8 + abs(q.y) * 1.6);
  // A soft halo around it.
  a = max(a, vGlow * 0.6 * exp(-d * 1.6));
  // Smeared, the same light is spread over a longer path.
  a *= 1.0 / (1.0 + vHalf * 0.5);
  if (a <= 0.002) discard;
  float alpha = vColor.a * clamp(a, 0.0, 1.0);
  fragColor = vec4(vColor.rgb * alpha, alpha);
}`;

/** A particle effect's shaders: its `particle(id)` (with its parameters' uniforms) in the vertex shader, the shapes in the fragment one. */
export function particleSources(uniforms: string, glsl: string): { vertex: string; fragment: string } {
  return { vertex: `${VS_PRELUDE}\n${uniforms}\n${glsl}\n${VS_MAIN}`, fragment: FS };
}
