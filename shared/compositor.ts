/**
 * The renderer: one WebGL 2 compositor draws every picture the app shows,
 * so the preview, the transition library's thumbnails and the export (in a
 * headless browser the server drives, see `server/gl-browser.ts`) look the
 * same, pixel for pixel. It works like After Effects' layer stack:
 *
 * A frame is built up in an offscreen buffer, bottom layer first:
 * - `drawPicture` puts a stored picture (or a solid colour) where its Motion
 *   puts it (an affine map, see `placementAffine`), faded by its Opacity and
 *   mixed with what's there by its blend mode. Its edges are antialiased, so
 *   rotated and scaled pictures look smooth, or the picture continues past
 *   them (mirrored, tiled or stretched: `Placed.edges`). A picture with video
 *   effects is first drawn into a layer of its own at about the size it's
 *   shown, and each effect's shader (`effect-gl.ts`) runs over that in turn;
 *   the result is what gets placed.
 * - `drawAdjustment` is an adjustment layer: the frame so far goes through
 *   the effects, then Motion, and replaces what was there (faded by Opacity,
 *   or mixed by a blend mode).
 * - `drawTransition` draws each side of a transition into a canvas-sized layer
 *   the same way, mixes the two with the transition's shader
 *   (`transition-gl.ts`) and puts the result over what's there.
 * - Motion blur: a layer given `samples` is drawn once per moment across the
 *   shutter (each with its own placement and effect values) and averaged in
 *   a float buffer before it's mixed in.
 * Everything is premultiplied alpha. `present` then copies the frame to the
 * canvas (flipped for `read`, which returns it top row first).
 */
import type { UniformValue } from "./transition-gl.ts";

/** A frame as raw RGBA bytes (straight alpha, top row first). */
export interface RawFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * A video frame as planar YUV 4:2:0 bytes (Y, then U, then V; limited range;
 * even width and height), and its YCbCr matrix as the luma weights of red
 * and blue (BT.709: 0.2126, 0.0722). Turned into RGB on the GPU.
 */
export interface YuvFrame {
  yuv: Uint8Array;
  width: number;
  height: number;
  kr: number;
  kb: number;
}

export type PictureSource = TexImageSource | RawFrame | YuvFrame;

/**
 * 2D affine map [a, b, c, d, e, f] from a point of a picture (u, v as
 * fractions, v down) to the canvas (fractions, y down):
 * x = a·u + c·v + e, y = b·u + d·v + f. The identity fills the canvas.
 */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export interface Shader {
  key: string;
  source: string;
}

/**
 * A video effect run over a picture before it's placed. `S` is its shader,
 * or the shader's key where the sources travel separately (the export).
 */
export interface EffectPass<S = Shader> {
  shader: S;
  uniforms: UniformValue[];
  /** Times the shader runs in a row, each over the last one's result (its `pass` uniform counts them). */
  passes: number;
}

/**
 * How a layer mixes with what's below it, in the order menus list them (the
 * compositor takes the index). The separable and non-separable modes follow
 * the W3C compositing spec (Photoshop's and After Effects' maths). The
 * stencil and silhouette modes don't draw the layer: its alpha (or luma)
 * keeps (or cuts out) what's below, like After Effects'.
 */
export const BLEND_MODES = [
  { value: "normal", label: "Normal" },
  { value: "darken", label: "Darken" },
  { value: "multiply", label: "Multiply" },
  { value: "color-burn", label: "Color Burn" },
  { value: "linear-burn", label: "Linear Burn" },
  { value: "darker-color", label: "Darker Color" },
  { value: "lighten", label: "Lighten" },
  { value: "screen", label: "Screen" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "add", label: "Add" },
  { value: "lighter-color", label: "Lighter Color" },
  { value: "overlay", label: "Overlay" },
  { value: "soft-light", label: "Soft Light" },
  { value: "hard-light", label: "Hard Light" },
  { value: "linear-light", label: "Linear Light" },
  { value: "vivid-light", label: "Vivid Light" },
  { value: "pin-light", label: "Pin Light" },
  { value: "hard-mix", label: "Hard Mix" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "subtract", label: "Subtract" },
  { value: "divide", label: "Divide" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
  { value: "stencil-alpha", label: "Stencil Alpha" },
  { value: "stencil-luma", label: "Stencil Luma" },
  { value: "silhouette-alpha", label: "Silhouette Alpha" },
  { value: "silhouette-luma", label: "Silhouette Luma" },
] as const;

export type BlendMode = (typeof BLEND_MODES)[number]["value"];

/** A blend mode's index for the compositor (0, Normal, for unknown ones). */
export function blendIndex(mode: string): number {
  return Math.max(0, BLEND_MODES.findIndex((m) => m.value === mode));
}

/** What shows past a picture's edges, for the compositor: nothing, mirrored, tiled, or its edge pixels stretched. */
export const EDGE_MODES = ["none", "mirror", "tile", "extend"] as const;

export function edgeIndex(mode: string): number {
  return Math.max(0, EDGE_MODES.indexOf(mode as (typeof EDGE_MODES)[number]));
}

/** One moment of a motion-blurred layer: where it is and how it looks then. */
export interface Sample<S = Shader> {
  affine: Affine;
  opacity: number;
  effects?: EffectPass<S>[];
}

/** A stored picture (by key), or a solid colour, placed on the canvas, after its effects (in order). */
export interface Placed<S = Shader> {
  key: string;
  affine: Affine;
  opacity: number;
  effects?: EffectPass<S>[];
  /** Index into `BLEND_MODES` (0, Normal, when absent). */
  blend?: number;
  /** Index into `EDGE_MODES` (0, nothing past the edges, when absent). */
  edges?: number;
  /**
   * A solid colour (premultiplied RGBA 0..1) instead of a stored picture (`key` is then
   * unused), `width` x `height` px at 100%, the most detail its effects are drawn with.
   */
  solid?: { color: [number, number, number, number]; width: number; height: number };
  /**
   * Motion blur: the moments across the shutter to average (replacing `affine`,
   * `opacity` and `effects`). Fewer than two draws the layer once.
   */
  samples?: Sample<S>[];
}

/** An adjustment layer: the frame so far, through its effects and placed by its Motion (the canvas at 100%). */
export type Adjustment<S = Shader> = Omit<Placed<S>, "key" | "solid">;

export interface Compositor {
  readonly gl: WebGL2RenderingContext;
  /** Output size in px; resizes the canvas. */
  resize(width: number, height: number): void;
  /** Store a picture under `key` (replacing what was there). */
  setPicture(key: string, source: PictureSource): void;
  hasPicture(key: string): boolean;
  deletePicture(key: string): void;
  /** Start a frame filled with `color` (premultiplied RGBA 0..1; default opaque black). */
  clear(color?: [number, number, number, number]): void;
  /** Draw a stored picture over the frame (nothing if it isn't stored), by its blend mode. */
  drawPicture(picture: Placed): void;
  /** Run the frame so far through an adjustment layer. */
  drawAdjustment(adjustment: Adjustment): void;
  /**
   * Start compiling a transition or effect shader in the background (compiling blocks for tens
   * of ms otherwise). True once it can be drawn without waiting; always true without
   * KHR_parallel_shader_compile, after compiling it now.
   */
  prepareShader(shader: Shader): boolean;
  /** Mix two stored pictures (null: nothing) with a transition shader (compiled once per key) over the frame. */
  drawTransition(shader: Shader, uniforms: UniformValue[], progress: number, from: Placed | null, to: Placed | null): void;
  /** Copy the frame to the canvas. `flipY` puts the top row first for `read`; `straight` un-premultiplies. */
  present(opts?: { flipY?: boolean; straight?: boolean }): void;
  /** The canvas as raw RGBA (top row first after a `present` with `flipY`). */
  read(): Uint8Array<ArrayBuffer>;
  /**
   * The frame (not the canvas) as planar YUV 4:2:0, BT.709 limited range,
   * top row first: what the export encodes, at under half the bytes of RGBA.
   * Needs a width that's a multiple of 8 and an even height.
   */
  readYuv420(): Uint8Array<ArrayBuffer>;
  /**
   * `readYuv420` without waiting for the GPU: the frame is copied out in the
   * background, so drawing (and anything else) can go on meanwhile.
   */
  readYuv420Async(): Promise<Uint8Array<ArrayBuffer>>;
  dispose(): void;
}

/**
 * Create a compositor on a WebGL 2 context.
 *
 * This function is also serialised (`toString()`) into the export's headless
 * page, so it must not refer to anything outside its own body.
 */
export function createCompositor(gl: WebGL2RenderingContext): Compositor {
  const QUAD_VS = `#version 300 es
in vec2 aPos;
uniform bool uFlipY;
out vec2 vUv;
void main() {
  vUv = aPos;
  vec2 p = aPos * 2.0 - 1.0;
  gl_Position = vec4(p.x, uFlipY ? -p.y : p.y, 0.0, 1.0);
}`;
  // Places a picture by a 3x3 matrix from picture fractions (v down) to clip
  // space. The quad reaches one output pixel past the picture's edges
  // (`uMargin`, in fractions) so the fragment shader can fade them smoothly.
  // With `uFill` the quad covers the whole target instead (the picture
  // continues past its edges): `uInverse` maps clip space back to the picture.
  const PICTURE_VS = `#version 300 es
in vec2 aPos;
uniform mat3 uMatrix;
uniform mat3 uInverse;
uniform vec2 uMargin;
uniform bool uFill;
out vec2 vTex;
void main() {
  if (uFill) {
    vec2 p = aPos * 2.0 - 1.0;
    vTex = (uInverse * vec3(p, 1.0)).xy;
    gl_Position = vec4(p, 0.0, 1.0);
    return;
  }
  vTex = aPos * (1.0 + 2.0 * uMargin) - uMargin;
  vec3 p = uMatrix * vec3(vTex, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;
  // `uPixels`: output px per picture fraction along u and v, for the edge
  // coverage. A YUV picture has its planes in uSrc (Y), uU and uV, and its
  // matrix's red and blue luma weights in uK. A layer (a picture after its
  // effects) is already premultiplied, and stored bottom row first. Past the
  // edges (`uFill`), the textures' wrap mode decides what shows.
  const PICTURE_FS = `#version 300 es
precision highp float;
in vec2 vTex;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform sampler2D uU;
uniform sampler2D uV;
uniform bool uYuv;
uniform bool uLayer;
uniform bool uFill;
uniform vec2 uK;
uniform float uOpacity;
uniform vec2 uPixels;
vec4 pictureAt(vec2 t) {
  if (uLayer) return texture(uSrc, vec2(t.x, 1.0 - t.y));
  if (!uYuv) return texture(uSrc, t);
  float y = (texture(uSrc, t).r * 255.0 - 16.0) / 219.0;
  float cb = (texture(uU, t).r * 255.0 - 128.0) / 224.0;
  float cr = (texture(uV, t).r * 255.0 - 128.0) / 224.0;
  float r = y + 2.0 * (1.0 - uK.x) * cr;
  float b = y + 2.0 * (1.0 - uK.y) * cb;
  float g = (y - uK.x * r - uK.y * b) / (1.0 - uK.x - uK.y);
  return vec4(clamp(vec3(r, g, b), 0.0, 1.0), 1.0);
}
void main() {
  if (uFill) {
    vec4 c = pictureAt(vTex);
    fragColor = (uLayer ? c : vec4(c.rgb * c.a, c.a)) * uOpacity;
    return;
  }
  vec2 edge = clamp(min(vTex, 1.0 - vTex) * uPixels + 0.5, 0.0, 1.0);
  vec4 c = pictureAt(clamp(vTex, 0.0, 1.0));
  fragColor = (uLayer ? c : vec4(c.rgb * c.a, c.a)) * (uOpacity * edge.x * edge.y);
}`;
  const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform bool uStraight;
void main() {
  vec4 c = texture(uSrc, vUv);
  if (uStraight) c.rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  fragColor = c;
}`;
  // Mixes a canvas-sized layer (uLayer) into the frame (uBase) by a blend mode
  // (the order of `BLEND_MODES`). `uReplace`: an adjustment layer, which
  // replaces what's below (by its mode), faded by `uOpacity`.
  const BLEND_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uBase;
uniform sampler2D uLayer;
uniform int uMode;
uniform float uOpacity;
uniform bool uReplace;
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(min(c.r, c.g), c.b);
  float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-6);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-6);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0.0);
}
float dodge(float b, float s) { return b <= 0.0 ? 0.0 : s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s)); }
float burn(float b, float s) { return b >= 1.0 ? 1.0 : s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s); }
float softLight(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}
float hardLight(float b, float s) { return s <= 0.5 ? b * 2.0 * s : b + (2.0 * s - 1.0) - b * (2.0 * s - 1.0); }
float vivid(float b, float s) { return s <= 0.5 ? burn(b, 2.0 * s) : dodge(b, 2.0 * s - 1.0); }
float channel(int m, float b, float s) {
  if (m == 1) return min(b, s);
  if (m == 2) return b * s;
  if (m == 3) return burn(b, s);
  if (m == 4) return max(0.0, b + s - 1.0);
  if (m == 6) return max(b, s);
  if (m == 7) return b + s - b * s;
  if (m == 8) return dodge(b, s);
  if (m == 9) return min(1.0, b + s);
  if (m == 11) return hardLight(s, b);
  if (m == 12) return softLight(b, s);
  if (m == 13) return hardLight(b, s);
  if (m == 14) return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
  if (m == 15) return vivid(b, s);
  if (m == 16) return s <= 0.5 ? min(b, 2.0 * s) : max(b, 2.0 * s - 1.0);
  if (m == 17) return b + s >= 1.0 ? 1.0 : 0.0;
  if (m == 18) return abs(b - s);
  if (m == 19) return b + s - 2.0 * b * s;
  if (m == 20) return max(0.0, b - s);
  if (m == 21) return s <= 0.0 ? (b > 0.0 ? 1.0 : 0.0) : min(1.0, b / s);
  return s;
}
vec3 blendRgb(int m, vec3 b, vec3 s) {
  if (m == 5) return lum(s) < lum(b) ? s : b;
  if (m == 10) return lum(s) > lum(b) ? s : b;
  if (m == 22) return setLum(setSat(s, sat(b)), lum(b));
  if (m == 23) return setLum(setSat(b, sat(s)), lum(b));
  if (m == 24) return setLum(s, lum(b));
  if (m == 25) return setLum(b, lum(s));
  return vec3(channel(m, b.r, s.r), channel(m, b.g, s.g), channel(m, b.b, s.b));
}
void main() {
  vec4 B = texture(uBase, vUv);
  vec4 S = texture(uLayer, vUv);
  vec4 top;
  if (uMode >= 26) {
    // Stencil / silhouette: the layer's alpha (or luma) keeps or cuts out what's below.
    float m = uMode == 26 || uMode == 28 ? S.a : dot(S.rgb, vec3(0.2126, 0.7152, 0.0722));
    top = B * (uMode <= 27 ? m : 1.0 - m);
  } else if (uMode == 0) {
    top = uReplace ? S : S + B * (1.0 - S.a);
  } else {
    vec3 cb = B.a > 0.0 ? B.rgb / B.a : vec3(0.0);
    vec3 cs = S.a > 0.0 ? S.rgb / S.a : vec3(0.0);
    vec3 mixed = clamp(blendRgb(uMode, cb, cs), 0.0, 1.0);
    top = vec4((1.0 - B.a) * S.rgb + (1.0 - S.a) * B.rgb + S.a * B.a * mixed, S.a + B.a - S.a * B.a);
  }
  fragColor = uReplace ? mix(B, top, uOpacity) : top;
}`;

  // Packs 4 bytes of the YUV 4:2:0 planes (Y, then U, then V, as one byte
  // stream) into each output texel: rows [0, H) are the Y plane, the rest U and V.
  const YUV_FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform ivec2 uSize;
const vec3 KY = vec3(0.2126, 0.7152, 0.0722);
// A pixel of the frame, from its top left (the frame's rows are stored bottom up).
vec3 rgbAt(vec2 px) {
  vec2 size = vec2(uSize);
  return texture(uSrc, vec2(px.x, size.y - px.y) / size).rgb;
}
void main() {
  int W = uSize.x;
  int H = uSize.y;
  int tx = int(gl_FragCoord.x);
  int ty = int(gl_FragCoord.y);
  vec4 o;
  if (ty < H) {
    for (int i = 0; i < 4; i++) {
      o[i] = (16.0 + 219.0 * dot(KY, rgbAt(vec2(float(tx * 4 + i) + 0.5, float(ty) + 0.5)))) / 255.0;
    }
  } else {
    int plane = W * H / 4;
    int j = ((ty - H) * (W / 4) + tx) * 4;
    bool v = j >= plane;
    if (v) j -= plane;
    int cx = j % (W / 2);
    int cy = j / (W / 2);
    for (int i = 0; i < 4; i++) {
      // The middle of the 2x2 block: filtering averages its four pixels.
      vec3 c = rgbAt(vec2(float(2 * (cx + i)) + 1.0, float(2 * cy) + 1.0));
      float y = dot(KY, c);
      o[i] = (128.0 + 224.0 * (v ? (c.r - y) / 1.5748 : (c.b - y) / 1.8556)) / 255.0;
    }
  }
  fragColor = o;
}`;

  // Compiling and linking don't wait for the GPU; asking for their status (or a uniform) does.
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  // Float buffers average motion blur's moments without banding (8 bits otherwise).
  const floatTargets = !!gl.getExtension("EXT_color_buffer_float");
  interface Pending {
    program: WebGLProgram;
    shaders: WebGLShader[];
  }
  const startLink = (vs: string, fs: string): Pending => {
    const program = gl.createProgram()!;
    const shaders = ([[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const).map(([type, source]) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      return shader;
    });
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    return { program, shaders };
  };
  const finishLink = ({ program, shaders }: Pending) => {
    const failed = shaders.find((shader) => !gl.getShaderParameter(shader, gl.COMPILE_STATUS));
    const error = failed
      ? `Shader didn't compile: ${gl.getShaderInfoLog(failed)}`
      : !gl.getProgramParameter(program, gl.LINK_STATUS)
        ? `Shader didn't link: ${gl.getProgramInfoLog(program)}`
        : null;
    for (const shader of shaders) gl.deleteShader(shader);
    if (error) {
      gl.deleteProgram(program);
      throw new Error(error);
    }
    const locations = new Map<string, WebGLUniformLocation | null>();
    const loc = (name: string) => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name)!;
    };
    return { program, loc };
  };
  const link = (vs: string, fs: string) => finishLink(startLink(vs, fs));

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const pictureProgram = link(PICTURE_VS, PICTURE_FS);
  const copyProgram = link(QUAD_VS, COPY_FS);
  let blendProgram: ReturnType<typeof link> | null = null;
  let yuvProgram: ReturnType<typeof link> | null = null;
  // Transition and effect programs, by shader key.
  const programs = new Map<string, ReturnType<typeof link>>();
  // Programs started by `prepareShader`, not yet checked.
  const compiling = new Map<string, Pending>();
  const shaderProgram = (shader: Shader) => {
    let entry = programs.get(shader.key);
    if (entry) return entry;
    const pending = compiling.get(shader.key) ?? startLink(QUAD_VS, shader.source);
    compiling.delete(shader.key);
    entry = finishLink(pending);
    programs.set(shader.key, entry);
    return entry;
  };

  const texture = () => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  interface Target {
    tex: WebGLTexture;
    fbo: WebGLFramebuffer;
  }
  const target = (): Target => ({ tex: texture(), fbo: gl.createFramebuffer()! });
  /** Give a target storage of `w` x `h` (RGBA, or half floats) and attach it. */
  const allocate = (t: Target, w: number, h: number, float = false) => {
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  };
  // Canvas-sized render targets: the frame being built and its spare (blend modes draw
  // from one into the other, then swap), the two sides of a transition (the first also
  // holds a layer about to be blended), and where motion blur's moments add up.
  let frame = target();
  let spare = target();
  const sides = [target(), target()];
  const accum = target();
  // Where `readYuv420` packs the frame (sized on first use).
  const yuv = { ...target(), width: 0, height: 0 };
  let width = 0;
  let height = 0;

  // Sets of three layers effects run in (by size, most recently used last): an effect reads
  // its input from one, and multi-pass effects go back and forth between the other two.
  const MAX_SCRATCH = 4;
  const scratch = new Map<string, Target[]>();
  const scratchSet = (w: number, h: number) => {
    const id = `${w}x${h}`;
    let set = scratch.get(id);
    if (set) scratch.delete(id);
    else {
      set = [target(), target(), target()];
      for (const t of set) allocate(t, w, h);
    }
    scratch.set(id, set);
    for (const [old, stale] of scratch) {
      if (scratch.size <= MAX_SCRATCH) break;
      for (const t of stale) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      scratch.delete(old);
    }
    return set;
  };
  // Fills a target (a local: this function can't refer to anything outside it).
  const IDENTITY_AFFINE: Affine = [1, 0, 0, 1, 0, 0];
  // The largest layer an effect runs in, per side.
  const maxLayer = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
  // A solid without effects is drawn from one texel of its colour.
  const solidTex = texture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

  interface Picture {
    /** RGBA, or a YUV picture's Y plane (then its U and V planes). */
    textures: WebGLTexture[];
    /** A YUV picture's luma weights of red and blue; null for RGBA. */
    yuv: [number, number] | null;
    width: number;
    height: number;
    /** Mipmaps are made the first time the picture is drawn much smaller than it is. */
    mipmapped: boolean;
  }
  const pictures = new Map<string, Picture>();

  const isRaw = (s: PictureSource): s is RawFrame => (s as { data?: unknown }).data instanceof Uint8Array;
  const isYuv = (s: PictureSource): s is YuvFrame => (s as { yuv?: unknown }).yuv instanceof Uint8Array;
  const sizeOf = (s: PictureSource): [number, number] => {
    if (isRaw(s) || isYuv(s)) return [s.width, s.height];
    if (typeof HTMLVideoElement !== "undefined" && s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight];
    if (typeof HTMLImageElement !== "undefined" && s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight];
    if (typeof VideoFrame !== "undefined" && s instanceof VideoFrame) return [s.displayWidth, s.displayHeight];
    const any = s as { width: number; height: number };
    return [any.width, any.height];
  };

  /** Texture wrap for an edge mode (see `EDGE_MODES`): what's sampled past the picture's edges. */
  const wrapOf = (edges: number) => (edges === 1 ? gl.MIRRORED_REPEAT : edges === 2 ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  const setWrap = (tex: WebGLTexture, wrap: number) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  };

  /**
   * Draw a picture by `affine` into the bound framebuffer, `tw` x `th` px (blending as
   * currently set). `layer`: it's a picture after its effects (see PICTURE_FS). With
   * `edges` (see `EDGE_MODES`) it continues past its edges over the whole target.
   */
  const drawTextures = (pic: Picture, affine: Affine, opacity: number, tw: number, th: number, layer: boolean, edges = 0) => {
    if (!(opacity > 0)) return;
    const [a, b, c, d, e, f] = affine;
    // Output px per picture fraction along each of its axes.
    const pu = Math.hypot(a * tw, b * th);
    const pv = Math.hypot(c * tw, d * th);
    const det = a * d - b * c;
    if (!(pu > 1e-6 && pv > 1e-6) || !(Math.abs(det) > 1e-12)) return;
    // Mipmaps keep a big picture drawn small from shimmering (layers are made about the size they're shown).
    const shrunk = !layer && (pic.width > pu * 1.5 || pic.height > pv * 1.5);
    const wrap = wrapOf(edges);
    // All three units are bound (an RGBA picture's U and V to nothing): a sampler
    // left on a texture that's being drawn into would make the draw fail.
    for (let i = 0; i < 3; i++) {
      const tex = pic.textures[i] ?? null;
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (!tex) continue;
      if (shrunk && !pic.mipmapped) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, shrunk ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    }
    if (shrunk) pic.mipmapped = true;
    // Canvas fractions (y down) -> clip space (y up), column-major.
    const matrix = new Float32Array([2 * a, -2 * b, 0, 2 * c, -2 * d, 0, 2 * e - 1, 1 - 2 * f, 1]);
    const { program, loc } = pictureProgram;
    gl.useProgram(program);
    gl.uniformMatrix3fv(loc("uMatrix"), false, matrix);
    if (edges) {
      // Clip space -> canvas fractions (x' = (x + 1) / 2, y' = (1 - y) / 2) -> picture fractions.
      const ia = d / det;
      const ib = -b / det;
      const ic = -c / det;
      const id = a / det;
      const ie = -(ia * e + ic * f);
      const iff = -(ib * e + id * f);
      gl.uniformMatrix3fv(
        loc("uInverse"),
        false,
        new Float32Array([ia / 2, ib / 2, 0, -ic / 2, -id / 2, 0, (ia + ic) / 2 + ie, (ib + id) / 2 + iff, 1]),
      );
    }
    gl.uniform1i(loc("uFill"), edges ? 1 : 0);
    gl.uniform2f(loc("uMargin"), Math.min(1, 1 / pu), Math.min(1, 1 / pv));
    gl.uniform2f(loc("uPixels"), pu, pv);
    gl.uniform1i(loc("uSrc"), 0);
    gl.uniform1i(loc("uU"), 1);
    gl.uniform1i(loc("uV"), 2);
    gl.uniform1i(loc("uYuv"), pic.yuv ? 1 : 0);
    gl.uniform1i(loc("uLayer"), layer ? 1 : 0);
    if (pic.yuv) gl.uniform2f(loc("uK"), pic.yuv[0], pic.yuv[1]);
    gl.uniform1f(loc("uOpacity"), Math.min(1, opacity));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
  };

  const setUniforms = (loc: (name: string) => WebGLUniformLocation | null, uniforms: UniformValue[]) => {
    for (const u of uniforms) {
      const l = loc(u.name);
      if (!l) continue;
      const v = u.value as number[];
      if (u.type === "int") gl.uniform1i(l, u.value as number);
      else if (u.type === "vec2") gl.uniform2f(l, v[0], v[1]);
      else if (u.type === "vec3") gl.uniform3f(l, v[0], v[1], v[2]);
      else gl.uniform1f(l, u.value as number);
    }
  };

  /** Draw a canvas-sized texture over the bound target (blending as currently set). */
  const copy = (tex: WebGLTexture, opts: { flipY?: boolean; straight?: boolean } = {}) => {
    const { program, loc } = copyProgram;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc("uSrc"), 0);
    gl.uniform1i(loc("uFlipY"), opts.flipY ? 1 : 0);
    gl.uniform1i(loc("uStraight"), opts.straight ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  /** Where a layer's picture comes from: a stored picture, a solid colour, or the frame so far (an adjustment). */
  type Source =
    | { kind: "picture"; pic: Picture }
    | { kind: "solid"; color: [number, number, number, number]; width: number; height: number }
    | { kind: "frame" };

  const sourceOf = (p: Placed): Source | null => {
    if (p.solid) return { kind: "solid", ...p.solid };
    const pic = pictures.get(p.key);
    return pic ? { kind: "picture", pic } : null;
  };

  /**
   * A layer ready to place: the stored picture, or with effects, a layer of it about the
   * size it's shown (never bigger than itself; a frame is always the canvas) with every
   * effect run over it. Past its edges, effects read what `edges` says.
   */
  const prepare = (source: Source, affine: Affine, effects: EffectPass[] | undefined, edges: number): { pic: Picture; layer: boolean } | null => {
    const passes = effects?.filter((fx) => fx.passes > 0) ?? [];
    if (!passes.length && source.kind === "picture") return { pic: source.pic, layer: false };
    if (!passes.length && source.kind === "solid") {
      const [r, g, b, a] = source.color;
      gl.bindTexture(gl.TEXTURE_2D, solidTex);
      const bytes = new Uint8Array([r, g, b, a].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)));
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return { pic: { textures: [solidTex], yuv: null, width: source.width, height: source.height, mipmapped: true }, layer: true };
    }
    const [a, b, c, d] = affine;
    const pu = Math.hypot(a * width, b * height);
    const pv = Math.hypot(c * width, d * height);
    if (!(pu > 1e-6 && pv > 1e-6)) return null;
    let w: number;
    let h: number;
    if (source.kind === "frame") {
      w = width;
      h = height;
    } else {
      // Rounded up to 32 px so a picture that's scaling doesn't need new layers every frame.
      const own = source.kind === "picture" ? source.pic : source;
      const side = (shown: number, max: number) => Math.max(1, Math.min(max, maxLayer, Math.ceil(shown / 32) * 32));
      w = side(pu, own.width);
      h = side(pv, own.height);
    }
    const set = scratchSet(w, h);
    const wrap = wrapOf(edges);
    for (const t of set) setWrap(t.tex, wrap);
    // The picture itself, filling the first layer (bottom row first, like every framebuffer).
    let input = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, set[0].fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    if (source.kind === "solid") {
      const [r, g, bl, al] = source.color;
      gl.clearColor(r, g, bl, al);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else if (source.kind === "frame") {
      copy(frame.tex);
    } else {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawTextures(source.pic, IDENTITY_AFFINE, 1, w, h, false);
    }
    const ratio = source.kind === "frame" ? width / height : pu / pv;
    for (const fx of passes) {
      const { program, loc } = shaderProgram(fx.shader);
      gl.useProgram(program);
      gl.uniform1i(loc("uSrc"), 0);
      gl.uniform1i(loc("uInput"), 1);
      gl.uniform1i(loc("uFlipY"), 0);
      gl.uniform1f(loc("ratio"), ratio);
      gl.uniform2f(loc("resolution"), w, h);
      setUniforms(loc, fx.uniforms);
      // Every pass can read the effect's input (`getInput`); passes go back and forth between the other two layers.
      let src = input;
      const others = [0, 1, 2].filter((i) => i !== input);
      for (let i = 0; i < fx.passes; i++) {
        const dst = src === others[0] ? others[1] : others[0];
        gl.bindFramebuffer(gl.FRAMEBUFFER, set[dst].fbo);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, set[input].tex);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, set[src].tex);
        gl.uniform1i(loc("pass"), i);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        src = dst;
      }
      input = src;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return { pic: { textures: [set[input].tex], yuv: null, width: w, height: h, mipmapped: false }, layer: true };
  };

  const bind = (t: { fbo: WebGLFramebuffer } | null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, width, height);
  };
  const blendOver = () => {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };
  const clearTarget = (t: Target) => {
    bind(t);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  /**
   * Draw a layer over canvas-sized target `t` (normal blending): prepared and placed
   * once, or, motion-blurred, once per sample, averaged in the float buffer first.
   */
  const drawLayer = (t: Target, source: Source, p: Omit<Placed, "key">) => {
    const edges = p.edges ?? 0;
    const samples = p.samples && p.samples.length > 1 ? p.samples : null;
    if (!samples) {
      if (!(p.opacity > 0)) return;
      const prepared = prepare(source, p.affine, p.effects, edges);
      if (!prepared) return;
      bind(t);
      blendOver();
      drawTextures(prepared.pic, p.affine, p.opacity, width, height, prepared.layer, edges);
      gl.disable(gl.BLEND);
      return;
    }
    clearTarget(accum);
    const n = samples.length;
    for (const sample of samples) {
      if (!(sample.opacity > 0)) continue;
      const prepared = prepare(source, sample.affine, sample.effects ?? p.effects, edges);
      if (!prepared) continue;
      bind(accum);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      // Each moment adds its share; the float buffer keeps the sum smooth.
      drawTextures(prepared.pic, sample.affine, sample.opacity / n, width, height, prepared.layer, edges);
    }
    bind(t);
    blendOver();
    copy(accum.tex);
    gl.disable(gl.BLEND);
  };

  /** Mix canvas-sized `layer` into the frame by blend mode `mode` (see BLEND_FS), swapping the frame with its spare. */
  const blendInto = (layer: Target, mode: number, opacity: number, replace: boolean) => {
    blendProgram ??= link(QUAD_VS, BLEND_FS);
    const { program, loc } = blendProgram;
    bind(spare);
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frame.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, layer.tex);
    gl.uniform1i(loc("uBase"), 0);
    gl.uniform1i(loc("uLayer"), 1);
    gl.uniform1i(loc("uFlipY"), 0);
    gl.uniform1i(loc("uMode"), mode);
    gl.uniform1f(loc("uOpacity"), Math.min(1, Math.max(0, opacity)));
    gl.uniform1i(loc("uReplace"), replace ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    [frame, spare] = [spare, frame];
  };

  const deletePicture = (key: string) => {
    const pic = pictures.get(key);
    if (!pic) return;
    for (const tex of pic.textures) gl.deleteTexture(tex);
    pictures.delete(key);
  };

  /** Fill one texture from bytes (same size: updated in place, e.g. every frame of a video). */
  const upload = (tex: WebGLTexture, resized: boolean, format: number, w: number, h: number, data: Uint8Array) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const internal = format === gl.RED ? gl.R8 : gl.RGBA;
    if (resized) gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, data);
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, gl.UNSIGNED_BYTE, data);
  };

  /** Pack the frame as YUV 4:2:0 into `yuv` (left bound, for reading). */
  const packYuv = () => {
    if (width % 8 !== 0 || height % 2 !== 0) throw new Error(`Can't pack a ${width}x${height} frame as YUV 4:2:0.`);
    const w = width / 4;
    const h = height + height / 2;
    if (yuv.width !== w || yuv.height !== h) {
      yuv.width = w;
      yuv.height = h;
      allocate(yuv, w, h);
    }
    yuvProgram ??= link(QUAD_VS, YUV_FS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, yuv.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(yuvProgram.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frame.tex);
    gl.uniform1i(yuvProgram.loc("uSrc"), 0);
    gl.uniform1i(yuvProgram.loc("uFlipY"), 0);
    gl.uniform2i(yuvProgram.loc("uSize"), width, height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return { w, h };
  };
  /** Pixel-pack buffers not in use by `readYuv420Async`. */
  const idleBuffers: WebGLBuffer[] = [];
  // Run `f` soon, letting other work (like incoming network data) go first.
  const channel = typeof MessageChannel !== "undefined" ? new MessageChannel() : null;
  const queued: (() => void)[] = [];
  if (channel) channel.port1.onmessage = () => queued.shift()?.();
  const yieldThen = (f: () => void) => {
    if (!channel) return void setTimeout(f, 0);
    queued.push(f);
    channel.port2.postMessage(null);
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
      for (const t of [frame, spare, ...sides]) allocate(t, w, h);
      allocate(accum, w, h, floatTargets);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    setPicture(key, source) {
      const [sw, sh] = sizeOf(source);
      if (!(sw > 0 && sh > 0)) {
        deletePicture(key);
        return;
      }
      const yuv = isYuv(source);
      let pic = pictures.get(key);
      if (pic && !!pic.yuv !== yuv) {
        deletePicture(key);
        pic = undefined;
      }
      const resized = !pic || pic.width !== sw || pic.height !== sh;
      if (!pic) {
        pic = { textures: yuv ? [texture(), texture(), texture()] : [texture()], yuv: null, width: sw, height: sh, mipmapped: false };
        pictures.set(key, pic);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      if (yuv) {
        const cw = sw / 2;
        const ch = sh / 2;
        const bytes = source.yuv;
        upload(pic.textures[0], resized, gl.RED, sw, sh, bytes.subarray(0, sw * sh));
        upload(pic.textures[1], resized, gl.RED, cw, ch, bytes.subarray(sw * sh, sw * sh + cw * ch));
        upload(pic.textures[2], resized, gl.RED, cw, ch, bytes.subarray(sw * sh + cw * ch, sw * sh + 2 * cw * ch));
        pic.yuv = [source.kr, source.kb];
      } else if (isRaw(source)) {
        upload(pic.textures[0], resized, gl.RGBA, sw, sh, source.data);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, pic.textures[0]);
        if (resized) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      }
      pic.width = sw;
      pic.height = sh;
      pic.mipmapped = false;
    },

    hasPicture(key) {
      return pictures.has(key);
    },

    deletePicture,

    clear(color = [0, 0, 0, 1]) {
      bind(frame);
      gl.disable(gl.BLEND);
      gl.clearColor(color[0], color[1], color[2], color[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },

    drawPicture(picture) {
      const source = sourceOf(picture);
      if (!source) return;
      const mode = picture.blend ?? 0;
      if (mode === 0) {
        drawLayer(frame, source, picture);
        return;
      }
      clearTarget(sides[0]);
      drawLayer(sides[0], source, picture);
      blendInto(sides[0], mode, 1, false);
    },

    drawAdjustment(adjustment) {
      // Opacity mixes the adjusted frame with the one below; each moment is drawn whole.
      const whole = { ...adjustment, opacity: 1, samples: adjustment.samples?.map((s) => ({ ...s, opacity: 1 })) };
      if (!(adjustment.opacity > 0)) return;
      clearTarget(sides[0]);
      drawLayer(sides[0], { kind: "frame" }, whole);
      blendInto(sides[0], adjustment.blend ?? 0, adjustment.opacity, true);
    },

    prepareShader(shader) {
      if (programs.has(shader.key)) return true;
      let pending = compiling.get(shader.key);
      if (!pending) {
        pending = startLink(QUAD_VS, shader.source);
        compiling.set(shader.key, pending);
      }
      return !parallel || gl.getProgramParameter(pending.program, parallel.COMPLETION_STATUS_KHR) === true;
    },

    drawTransition(shader, uniforms, progress, from, to) {
      // Each side into its own transparent layer.
      [from, to].forEach((side, i) => {
        clearTarget(sides[i]);
        const source = side && sourceOf(side);
        if (side && source) drawLayer(sides[i], source, side);
      });

      const { program, loc } = shaderProgram(shader);
      bind(frame);
      blendOver();
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sides[0].tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sides[1].tex);
      gl.uniform1i(loc("uFrom"), 0);
      gl.uniform1i(loc("uTo"), 1);
      gl.uniform1i(loc("uFlipY"), 0);
      gl.uniform1i(loc("uStraight"), 0);
      gl.uniform1f(loc("progress"), Math.min(1, Math.max(0, progress)));
      gl.uniform1f(loc("ratio"), width / height);
      gl.uniform2f(loc("resolution"), width, height);
      // The middle of each side's frame, in uv (y up); the canvas centre for an empty side.
      const centre = (side: Placed | null): [number, number] => {
        if (!side) return [0.5, 0.5];
        const [a, b, c, d, e, f] = side.affine;
        return [(a + c) / 2 + e, 1 - ((b + d) / 2 + f)];
      };
      gl.uniform2f(loc("fromCentre"), ...centre(from));
      gl.uniform2f(loc("toCentre"), ...centre(to));
      setUniforms(loc, uniforms);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
    },

    present(opts = {}) {
      bind(null);
      gl.disable(gl.BLEND);
      copy(frame.tex, opts);
    },

    read() {
      const out = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    },

    readYuv420() {
      const { w, h } = packYuv();
      const out = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out;
    },

    readYuv420Async() {
      const { w, h } = packYuv();
      const size = w * h * 4;
      // Each read in flight has its own buffer.
      const buffer = idleBuffers.pop() ?? gl.createBuffer()!;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
      gl.flush();
      return new Promise((resolve, reject) => {
        const poll = () => {
          const status = gl.clientWaitSync(sync, 0, 0);
          if (status === gl.TIMEOUT_EXPIRED) {
            yieldThen(poll);
            return;
          }
          gl.deleteSync(sync);
          if (status === gl.WAIT_FAILED) {
            idleBuffers.push(buffer);
            reject(new Error("Reading the frame back from the GPU failed."));
            return;
          }
          const out = new Uint8Array(size);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          idleBuffers.push(buffer);
          resolve(out);
        };
        yieldThen(poll);
      });
    },

    dispose() {
      for (const { program } of programs.values()) gl.deleteProgram(program);
      for (const { program, shaders } of compiling.values()) {
        for (const shader of shaders) gl.deleteShader(shader);
        gl.deleteProgram(program);
      }
      compiling.clear();
      if (yuvProgram) gl.deleteProgram(yuvProgram.program);
      if (blendProgram) gl.deleteProgram(blendProgram.program);
      for (const b of idleBuffers) gl.deleteBuffer(b);
      idleBuffers.length = 0;
      channel?.port1.close();
      programs.clear();
      for (const set of scratch.values()) {
        for (const { tex, fbo } of set) {
          gl.deleteTexture(tex);
          gl.deleteFramebuffer(fbo);
        }
      }
      scratch.clear();
      gl.deleteProgram(pictureProgram.program);
      gl.deleteProgram(copyProgram.program);
      for (const key of [...pictures.keys()]) deletePicture(key);
      for (const { tex, fbo } of [frame, spare, ...sides, accum, yuv]) {
        gl.deleteTexture(tex);
        gl.deleteFramebuffer(fbo);
      }
      gl.deleteTexture(solidTex);
      gl.deleteBuffer(quad);
    },
  };
}
