/**
 * Running transition shaders with WebGL 2. The same renderer draws the
 * preview (in the app), the library's thumbnails, and the export (in a
 * headless browser the server drives, see `server/transition-render.ts`),
 * so a transition looks the same everywhere.
 *
 * A frame is drawn in two steps:
 * 1. Each side's picture (the outgoing and incoming clip) is drawn where its
 *    Motion puts it into a canvas-sized layer, faded by its Opacity, with
 *    premultiplied alpha. Uncovered canvas stays transparent.
 * 2. The transition's shader mixes the two layers into the output.
 */
import type { ParamValue, Vec2 } from "./types.ts";
import type { TransitionDefinition } from "./transitions.ts";

/**
 * Everything a transition's GLSL can use:
 *
 * - `progress` (0..1), `ratio` (canvas width / height), `resolution` (px).
 * - `getFromColor(uv)` / `getToColor(uv)`: the outgoing / incoming picture,
 *   premultiplied RGBA, transparent outside 0..1. `uv` (0, 0) is bottom left.
 * - Helpers: `PI`, `ease` (smooth in and out) plus `easeIn`/`easeOut`,
 *   `hash`/`hash2` (random 0..1), `noise` (smooth value noise), `fbm`
 *   (layered noise), `rot` (2D rotation), `luma`, `inside(uv)`,
 *   `dirVec(direction)` (0 left, 1 right, 2 up, 3 down), `toUv` (a point
 *   parameter to uv), `aspect(uv)` (uv around the centre in square units),
 *   `mirrored(uv)` (repeats the picture as reflections past its edges).
 *
 * The result must be premultiplied (rgb never above alpha); it's clamped.
 */
const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform bool uStraight;
uniform float progress;
uniform float ratio;
uniform vec2 resolution;

#define PI 3.141592653589793

bool inside(vec2 uv) { return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))); }
vec4 getFromColor(vec2 uv) { return inside(uv) ? texture(uFrom, uv) : vec4(0.0); }
vec4 getToColor(vec2 uv) { return inside(uv) ? texture(uTo, uv) : vec4(0.0); }

float ease(float t) { t = clamp(t, 0.0, 1.0); return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
float easeIn(float t) { t = clamp(t, 0.0, 1.0); return t * t * t; }
float easeOut(float t) { t = clamp(t, 0.0, 1.0); return 1.0 - pow(1.0 - t, 3.0); }

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
float luma(vec4 c) { return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)); }
vec2 dirVec(int d) { return d == 0 ? vec2(-1.0, 0.0) : d == 1 ? vec2(1.0, 0.0) : d == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0); }
vec2 toUv(vec2 p) { return vec2(p.x, 1.0 - p.y); }
vec2 aspect(vec2 uv) { return (uv - 0.5) * vec2(ratio, 1.0); }
vec2 mirrored(vec2 p) { return 1.0 - abs(1.0 - mod(p, 2.0)); }
`;

const MAIN = `
void main() {
  vec4 c = clamp(transition(vUv), 0.0, 1.0);
  c.rgb = min(c.rgb, vec3(c.a));
  if (uStraight) c.rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  fragColor = c;
}
`;

/** Names the prelude uses, which parameters can't have. */
export const RESERVED_UNIFORMS = ["progress", "ratio", "resolution", "uFrom", "uTo", "uStraight", "vUv", "fragColor"];

/** The complete fragment shader of a transition. */
export function fragmentSource(def: Pick<TransitionDefinition, "params" | "glsl">): string {
  const uniforms = def.params
    .map((p) => `uniform ${p.kind === "choice" ? "int" : p.kind === "vec2" ? "vec2" : "float"} ${p.key};`)
    .join("\n");
  return `${PRELUDE}\n${uniforms}\n${def.glsl}\n${MAIN}`;
}

const shaders = new Map<string, { key: string; source: string }>();

/** A transition's shader, built once. */
export function transitionShader(def: TransitionDefinition): { key: string; source: string } {
  let shader = shaders.get(def.type);
  if (!shader) {
    shader = { key: def.type, source: fragmentSource(def) };
    shaders.set(def.type, shader);
  }
  return shader;
}

export interface UniformValue {
  name: string;
  type: "float" | "int" | "vec2";
  value: number | Vec2;
}

/** A transition's parameter values as uniforms (see `TransitionDefinition.params`). */
export function transitionUniforms(def: TransitionDefinition, params: Record<string, ParamValue>): UniformValue[] {
  return def.params.map((spec) => {
    const v = params[spec.key] ?? spec.default;
    switch (spec.kind) {
      case "number":
        return { name: spec.key, type: "float", value: v as number };
      case "boolean":
        return { name: spec.key, type: "float", value: v ? 1 : 0 };
      case "choice":
        return { name: spec.key, type: "int", value: Math.max(0, spec.options.findIndex((o) => o.value === v)) };
      case "vec2":
        return { name: spec.key, type: "vec2", value: v as Vec2 };
    }
  });
}

/** A frame as raw RGBA bytes (straight alpha, top row first). */
export interface RawFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

export type LayerSource = TexImageSource | RawFrame;

/**
 * 2D affine map [a, b, c, d, e, f] from a point of the source picture (u, v
 * as fractions, v down) to the canvas (fractions, y down):
 * x = a·u + c·v + e, y = b·u + d·v + f. The identity fills the canvas.
 */
export type Affine = [number, number, number, number, number, number];

export interface TransitionRenderer {
  readonly gl: WebGL2RenderingContext;
  /** Output (and layer) size in px; resizes the canvas. */
  resize(width: number, height: number): void;
  /**
   * Draw one side (0 = outgoing, 1 = incoming) into its layer: `source` placed
   * by `affine` (default: filling the canvas) and faded by `opacity`. Null
   * leaves the layer empty (transparent).
   */
  layer(index: 0 | 1, source: LayerSource | null, affine?: Affine, opacity?: number): void;
  /**
   * Mix the layers with a transition shader (compiled once per `key`) into
   * the canvas. `flipY` puts the top row first for `readPixels`; `straight`
   * un-premultiplies the output.
   */
  draw(
    shader: { key: string; source: string },
    uniforms: UniformValue[],
    progress: number,
    opts?: { flipY?: boolean; straight?: boolean },
  ): void;
  /** The canvas as raw RGBA, top row first (after a `draw` with `flipY`). */
  read(): Uint8Array<ArrayBuffer>;
  dispose(): void;
}

/**
 * Create a renderer on a WebGL 2 context.
 *
 * This function is also serialised (`toString()`) into the export's headless
 * page, so it must not refer to anything outside its own body.
 */
export function createTransitionRenderer(gl: WebGL2RenderingContext): TransitionRenderer {
  const QUAD_VS = `#version 300 es
in vec2 aPos;
uniform bool uFlipY;
out vec2 vUv;
void main() {
  vUv = aPos;
  vec2 p = aPos * 2.0 - 1.0;
  gl_Position = vec4(p.x, uFlipY ? -p.y : p.y, 0.0, 1.0);
}`;
  // Places the source by a 3x3 matrix from source fractions (v down) to clip space.
  const LAYER_VS = `#version 300 es
in vec2 aPos;
uniform mat3 uMatrix;
out vec2 vTex;
void main() {
  vTex = aPos;
  vec3 p = uMatrix * vec3(aPos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;
  const LAYER_FS = `#version 300 es
precision highp float;
in vec2 vTex;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform float uOpacity;
void main() {
  vec4 c = texture(uSrc, vTex);
  fragColor = vec4(c.rgb * c.a, c.a) * uOpacity;
}`;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader didn't compile: ${log}`);
    }
    return shader;
  };
  const link = (vs: string, fs: string) => {
    const program = gl.createProgram()!;
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Shader didn't link: ${log}`);
    }
    const locations = new Map<string, WebGLUniformLocation | null>();
    const loc = (name: string) => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name)!;
    };
    return { program, loc };
  };

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const layerProgram = link(LAYER_VS, LAYER_FS);
  const programs = new Map<string, ReturnType<typeof link>>();

  const texture = () => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  // Where each side's source picture is uploaded, and the layer it's drawn into.
  const sources = [texture(), texture()];
  const layers = [0, 1].map(() => {
    const tex = texture();
    const fbo = gl.createFramebuffer()!;
    return { tex, fbo };
  });
  let width = 0;
  let height = 0;

  const isRaw = (s: LayerSource): s is { data: Uint8Array; width: number; height: number } =>
    (s as { data?: unknown }).data instanceof Uint8Array;
  const sizeOf = (s: LayerSource): [number, number] => {
    if (isRaw(s)) return [s.width, s.height];
    if (typeof HTMLVideoElement !== "undefined" && s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight];
    if (typeof HTMLImageElement !== "undefined" && s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight];
    if (typeof VideoFrame !== "undefined" && s instanceof VideoFrame) return [s.displayWidth, s.displayHeight];
    const any = s as { width: number; height: number };
    return [any.width, any.height];
  };

  return {
    gl,

    resize(w, h) {
      w = Math.max(1, Math.round(w));
      h = Math.max(1, Math.round(h));
      if (w === width && h === height) return;
      width = w;
      height = h;
      gl.canvas.width = w;
      gl.canvas.height = h;
      for (const { tex, fbo } of layers) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    layer(index, source, affine = [1, 0, 0, 1, 0, 0], opacity = 1) {
      const target = layers[index];
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const [sw, sh] = source ? sizeOf(source) : [0, 0];
      if (source && sw > 0 && sh > 0 && opacity > 0) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sources[index]);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        if (isRaw(source)) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
        } else {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }
        // Mipmaps keep a big source drawn small (the preview) from shimmering.
        const shrunk = sw > width * 1.5 || sh > height * 1.5;
        if (shrunk) gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, shrunk ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);

        const [a, b, c, d, e, f] = affine;
        // Canvas fractions (y down) -> clip space (y up), column-major.
        const matrix = new Float32Array([2 * a, -2 * b, 0, 2 * c, -2 * d, 0, 2 * e - 1, 1 - 2 * f, 1]);
        gl.useProgram(layerProgram.program);
        gl.uniformMatrix3fv(layerProgram.loc("uMatrix"), false, matrix);
        gl.uniform1i(layerProgram.loc("uSrc"), 0);
        gl.uniform1f(layerProgram.loc("uOpacity"), Math.min(1, opacity));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    draw(shader, uniforms, progress, opts = {}) {
      let entry = programs.get(shader.key);
      if (!entry) {
        entry = link(QUAD_VS, shader.source);
        programs.set(shader.key, entry);
      }
      const { program, loc } = entry;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, layers[0].tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, layers[1].tex);
      gl.uniform1i(loc("uFrom"), 0);
      gl.uniform1i(loc("uTo"), 1);
      gl.uniform1i(loc("uFlipY"), opts.flipY ? 1 : 0);
      gl.uniform1i(loc("uStraight"), opts.straight ? 1 : 0);
      gl.uniform1f(loc("progress"), Math.min(1, Math.max(0, progress)));
      gl.uniform1f(loc("ratio"), width / height);
      gl.uniform2f(loc("resolution"), width, height);
      for (const u of uniforms) {
        const l = loc(u.name);
        if (!l) continue;
        if (u.type === "int") gl.uniform1i(l, u.value as number);
        else if (u.type === "vec2") gl.uniform2f(l, (u.value as number[])[0], (u.value as number[])[1]);
        else gl.uniform1f(l, u.value as number);
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0);
    },

    read() {
      const out = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    },

    dispose() {
      for (const { program } of programs.values()) gl.deleteProgram(program);
      programs.clear();
      gl.deleteProgram(layerProgram.program);
      for (const t of sources) gl.deleteTexture(t);
      for (const { tex, fbo } of layers) {
        gl.deleteTexture(tex);
        gl.deleteFramebuffer(fbo);
      }
      gl.deleteBuffer(quad);
    },
  };
}
