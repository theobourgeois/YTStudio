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

/**
 * A projective map (a homography, row-major 3x3) from a point of a picture
 * (u, v fractions, v down) to the canvas (fractions, y down), in homogeneous
 * coordinates: x = (m0·u + m1·v + m2) / w, y = (m3·u + m4·v + m5) / w, with
 * w = m6·u + m7·v + m8 (a depth in front of the camera). A 3D layer seen in
 * perspective (see `camera.ts`).
 */
export type Projective = [number, number, number, number, number, number, number, number, number];

/** Where a picture goes: an affine map for a 2D layer, a projective one for a 3D layer. */
export type Placement2D = Affine | Projective;

/** A placement as a row-major 3x3 matrix. */
export function toMatrix3(t: Placement2D): Projective {
  return t.length === 9 ? t : [t[0], t[2], t[4], t[1], t[3], t[5], 0, 0, 1];
}

/** Where a picture's point (u, v) lands on the canvas (fractions), or null behind the camera. */
export function placePoint(t: Placement2D, u: number, v: number): [number, number] | null {
  const m = toMatrix3(t);
  const w = m[6] * u + m[7] * v + m[8];
  if (!(w > 1e-9)) return null;
  return [(m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w];
}

export interface Shader {
  key: string;
  source: string;
  /** Its own vertex shader (a particle effect's, which places each particle); the full-frame quad's otherwise. */
  vertex?: string;
  /** A particle effect's: the fragment shader (a usual effect's) that draws the layer under its particles. */
  base?: string;
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
  /**
   * A time effect (see `EffectShader.history`): its earlier inputs (and outputs) are kept
   * under `id`, by `time` (its clip's source time), for `reach` seconds; it gets its own last
   * output with `feedback`, and optical flow with `flow`. `record: false` reads without
   * adding this moment (motion blur's in-between moments).
   */
  history?: { id: string; time: number; fps: number; reach: number; feedback?: boolean; flow?: boolean; record?: false };
  /**
   * A particle effect: its shader's `base` draws the layer (from its input, like any effect),
   * then `count` particles (instances of a quad its vertex shader places) go over that,
   * mixed in by `blend` (0 over, 1 add, 2 screen). The vertex shader reads the input
   * (`uSrc`), to emit from the layer's shape and colours.
   */
  particles?: { count: number; blend: number };
  /** A visualizer's sound at this moment (see `EffectShader.audio`): bound as `uSpectrum`, `uWave` and its scalars. */
  audio?: AudioInputs;
  /**
   * A simulation (see `EffectShader.simulation`): its state is kept under `id`, frame by frame of its
   * clip; this is frame `frame` (0 is the clip's first). `version` says what its states were made from
   * (the clip, the sound): a new one makes them stale. It reads its state at `frame - 1`: kept, or a
   * checkpoint, or (when neither is there) the newest earlier one it has, even stale: exact only for a
   * simulation whose `memory` (frames) that state is older than. `record: false` reads without keeping
   * this frame (motion blur's in-between moments).
   */
  simulation?: { id: string; version: string; frame: number; fps: number; memory?: number; record?: false };
  /**
   * Room this effect needs past the picture's frame (a fraction of its height on every side),
   * like After Effects' Grow Bounds: particles flying off a text, a glow spilling past it.
   * The layer is made that much bigger for every effect; `uFrame` says where the frame is in it.
   */
  grow?: number;
}

/** What a visualizer asks for: rows of spectrum over `span` seconds, each falling over `fall`; a waveform `window` seconds long (0: none). */
export interface AudioRequest {
  rows: number;
  span: number;
  fall: number;
  window: number;
  /** Which hits `hits` are: any (`onset`, the default), kicks (`onsetLow`), snares and notes (`onsetMid`), hats (`onsetHigh`). */
  hits?: "onset" | "onsetLow" | "onsetMid" | "onsetHigh";
}

/**
 * What a visualizer hears at a moment (`audioInputs` in `audio-signals.ts`), in plain numbers so it
 * travels to the export's page with the rest of a frame's layers.
 */
/** Hits a visualizer hears at once (`AudioInputs.hits`; its shader's `hitAge` and `hitVelocity`). */
export const MAX_AUDIO_HITS = 8;

export interface AudioInputs {
  /** `rows` rows of 96 bands (20 Hz–20 kHz, log), 0..1 against the sound's loud parts; row 0 is now. */
  spectrum: number[];
  rows: number;
  /** Seconds from row 0 back to the last row. */
  span: number;
  /** The sound around now: `wave.length / 2` points, left then right, -1..1. */
  wave: number[];
  /** The last hits (up to `MAX_AUDIO_HITS`), newest first: seconds since each, and how hard it was. */
  hits: [age: number, velocity: number][];
  /** level, bass, mid, high, onset (0..1), the beat (count, phase 0..1, seconds since), seconds since the last hit, bpm. */
  scalars: { level: number; bass: number; mid: number; high: number; onset: number; beat: number; beatPhase: number; sinceBeat: number; sinceOnset: number; bpm: number };
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

/**
 * Track matte modes (After Effects' TrkMat), in menu order: a layer shows only where its
 * matte (the layer on the track above) is opaque or bright, or only where it isn't.
 */
export const MATTE_MODES = ["none", "alpha", "alpha-inverted", "luma", "luma-inverted"] as const;

export function matteIndex(mode: string): number {
  return Math.max(0, MATTE_MODES.indexOf(mode as (typeof MATTE_MODES)[number]));
}

/**
 * A mask on a layer (After Effects'): the layer only shows inside its path (or outside it,
 * `inverted`), before its effects run. Several combine in order: the first decides what
 * shows, each later one adds to that, takes away from it or keeps only what they share.
 */
export interface MaskShape {
  /** SVG path data, in fractions of the layer's frame (x right, y down). */
  d: string;
  /** 0 add, 1 subtract, 2 intersect (see `MASK_MODES`). */
  mode: number;
  inverted?: boolean;
  /** How much it covers (0..1). */
  opacity: number;
  /** How soft its edge is and how far it's grown (shrunk when negative), as fractions of the frame's height. */
  feather: number;
  expansion: number;
}

export const MASK_MODES = ["add", "subtract", "intersect"] as const;

export function maskModeIndex(mode: string): number {
  return Math.max(0, MASK_MODES.indexOf(mode as (typeof MASK_MODES)[number]));
}

/** What fills or strokes a vector shape: a CSS colour, or a gradient between two points (in the drawing's px). */
export type VectorPaint =
  | string
  | { type: "linear" | "radial"; from: [number, number]; to: [number, number]; stops: [number, string][] };

/** One shape of a vector drawing: a path, filled and then stroked. */
export interface VectorOp {
  /** SVG path data, in the drawing's px. */
  d: string;
  /** Where the path goes in the drawing (a repeater's copies): an affine map of its px. */
  transform?: Affine;
  fill?: VectorPaint;
  fillRule?: "nonzero" | "evenodd";
  stroke?: VectorPaint;
  /** Stroke width and dashes (dash, gap, ...) in the drawing's px. */
  strokeWidth?: number;
  join?: "miter" | "round" | "bevel";
  cap?: "butt" | "round" | "square";
  miterLimit?: number;
  dash?: number[];
  dashOffset?: number;
  /** 0..1 over both the fill and the stroke. */
  opacity?: number;
}

/**
 * A vector drawing (a shape layer's picture): shapes in a space of `width` x `height` px,
 * bottom first, drawn by the browser's 2D canvas at whatever size the layer is shown, so
 * it's sharp at any scale.
 */
export interface VectorDrawing {
  width: number;
  height: number;
  ops: VectorOp[];
  /**
   * How far its shapes reach past the frame, as a fraction of its height: the layer is drawn
   * with that much room on every side, so they aren't cut off at the frame's edges.
   */
  bleed?: number;
}

/** What one text animator does to a text at a moment (see `shared/text-animators.ts`), in the drawing's px. */
export interface TextAnimatorDrawing {
  position: [number, number];
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  blur: number;
  /** Px added after each letter it acts on. */
  tracking: number;
  /** A colour to turn the fill into, or null. */
  fill: string | null;
  /** For each letter (code point) of each line: the unit it's in (-1: none) and how much the animator acts on it (0..1). */
  glyphs: { unit: number; amount: number }[][];
}

/**
 * A text as it's drawn (a text clip's picture): laid out by the browser tab that knows the
 * fonts (`src/lib/text-render.ts`), then drawn here with the 2D canvas at whatever size the
 * layer is shown, in the preview and the export alike. Lengths are px of a `width` x `height`
 * frame; with `animators`, each letter is drawn on its own.
 */
export interface TextDrawing {
  width: number;
  height: number;
  /** CSS `font` shorthand, and the width (`font-stretch`), which the shorthand can't say in a canvas. */
  font: string;
  stretch: string;
  fontPx: number;
  letterSpacing: number;
  align: "left" | "center" | "right";
  /** Each line's text, left edge and baseline. */
  lines: { text: string; x: number; y: number }[];
  fill: string;
  /** The outline: `width` px on each side of the letters' edge (half of it hidden under the fill). */
  stroke?: { color: string; width: number };
  /** The box behind the text. */
  box?: { color: string; x: number; y: number; width: number; height: number; radius: number };
  /** A drop shadow, `offset` px down and to the right. */
  shadow?: { color: string; offset: number; blur: number };
  animators?: TextAnimatorDrawing[];
}

/** One moment of a motion-blurred layer: where it is and how it looks then. */
export interface Sample<S = Shader> {
  affine: Placement2D;
  opacity: number;
  effects?: EffectPass<S>[];
}

/** A stored picture (by key), or a solid colour, placed on the canvas, after its effects (in order). */
export interface Placed<S = Shader> {
  key: string;
  affine: Placement2D;
  opacity: number;
  /**
   * The picture's shape as placed (width / height), which effects work in: a 3D layer's
   * perspective doesn't squash them. By default it's taken from `affine`.
   */
  aspect?: number;
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
  /** A vector drawing instead of a stored picture (`key` is then unused): a shape layer's shapes. */
  vector?: VectorDrawing;
  /** A text instead of a stored picture (`key` is then unused). */
  text?: TextDrawing;
  /** Masks cutting the layer out, in order, before its effects (an adjustment layer: where it changes what's below). */
  masks?: MaskShape[];
  /**
   * Motion blur: the moments across the shutter to average (replacing `affine`,
   * `opacity` and `effects`). Fewer than two draws the layer once.
   */
  samples?: Sample<S>[];
  /** A track matte: the layer shows only through `layer` (drawn first, never itself), by `mode` (see `MATTE_MODES`). */
  matte?: { mode: number; layer: Placed<S> };
  /**
   * Time interpolation (a retimed clip between two of its media's frames, Premiere's Frame
   * Blending and Optical Flow): the picture is `amount` (0..1) of the way from the stored
   * picture `key` to the stored picture `interpolate.key`, cross-faded, or with `flow`, each
   * warped along the optical flow between them to where things are in between (Twixtor).
   */
  interpolate?: { key: string; amount: number; flow: boolean; /** The export's: which frame of its media `key` is. */ index?: number };
}

/** An adjustment layer: the frame so far, through its effects and placed by its Motion (the canvas at 100%). */
export type Adjustment<S = Shader> = Omit<Placed<S>, "key" | "solid" | "vector" | "text">;

export interface Compositor {
  readonly gl: WebGL2RenderingContext;
  /** Output size in px; resizes the canvas. */
  resize(width: number, height: number): void;
  /** Store a picture under `key` (replacing what was there). */
  setPicture(key: string, source: PictureSource): void;
  hasPicture(key: string): boolean;
  deletePicture(key: string): void;
  /**
   * Keep the picture under `key` as `previous` (swapping their textures, so nothing is copied):
   * the frame before a video's next one, for time interpolation.
   */
  shiftPicture(key: string, previous: string): void;
  /** Start a frame filled with `color` (premultiplied RGBA 0..1; default opaque black). */
  clear(color?: [number, number, number, number]): void;
  /** Draw a stored picture over the frame (nothing if it isn't stored), by its blend mode. */
  drawPicture(picture: Placed): void;
  /** Run the frame so far through an adjustment layer. */
  drawAdjustment(adjustment: Adjustment): void;
  /**
   * Start drawing a group (a nested sequence, After Effects' precomp): a transparent frame of
   * `width` x `height` px that the draws after it go into, until `endGroup`. Groups nest.
   */
  beginGroup(width: number, height: number): void;
  /** Finish the group: its frame becomes the picture `key` (to place like any other), and drawing goes back to the frame it interrupted. */
  endGroup(key: string): void;
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
  /**
   * The frame (not the canvas) as RGBA with straight alpha, top row first, read without waiting for the GPU:
   * what a ProRes or PNG export encodes (its alpha too, when the frame was begun transparent).
   */
  readRgbaAsync(): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * The first frame a simulation must be stepped from (`advance`) before frame `frame` of version
   * `version` can be drawn exactly: `frame` itself when its state a frame before is kept (or it's the
   * first), else the frame after the newest state or checkpoint it has before then (0 with none), but never
   * before `frame - memory` (a simulation that forgets: replaying that long from anything gives the same).
   */
  simulationFrom(id: string, version: string, frame: number, memory?: number): number;
  /**
   * Run a layer's effects without drawing it, so its simulations step (up to the last of them): how a
   * replay catches a simulation up to the frame being drawn.
   */
  advance(picture: Placed): void;
  /** GPU memory simulations' checkpoints may take, in bytes (0: none are kept, as in the export). */
  setCheckpointBudget(bytes: number): void;
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
  // A 3D layer's matrix is projective: its third row is the depth, which becomes w
  // (so the picture is drawn in true perspective), and filling needs a divide per pixel.
  const PICTURE_VS = `#version 300 es
in vec2 aPos;
uniform mat3 uMatrix;
uniform mat3 uInverse;
uniform vec2 uMargin;
uniform bool uFill;
out vec2 vTex;
out vec3 vFill;
void main() {
  if (uFill) {
    vec2 p = aPos * 2.0 - 1.0;
    vFill = uInverse * vec3(p, 1.0);
    vTex = vec2(0.0);
    gl_Position = vec4(p, 0.0, 1.0);
    return;
  }
  vTex = aPos * (1.0 + 2.0 * uMargin) - uMargin;
  vFill = vec3(0.0);
  vec3 p = uMatrix * vec3(vTex, 1.0);
  gl_Position = vec4(p.xy, 0.0, p.z);
}`;
  // `uPixels`: output px per picture fraction along u and v, for the edge
  // coverage. A YUV picture has its planes in uSrc (Y), uU and uV, and its
  // matrix's red and blue luma weights in uK. A layer (a picture after its
  // effects) is already premultiplied, and stored bottom row first. Past the
  // edges (`uFill`), the textures' wrap mode decides what shows.
  const PICTURE_FS = `#version 300 es
precision highp float;
in vec2 vTex;
in vec3 vFill;
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
uniform bool uPerspective;
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
    // Past the horizon of a 3D layer there's nothing.
    if (vFill.z <= 0.0) discard;
    vec4 c = pictureAt(vFill.xy / vFill.z);
    fragColor = (uLayer ? c : vec4(c.rgb * c.a, c.a)) * uOpacity;
    return;
  }
  // Output px per picture fraction: fixed for a 2D layer, changing across a layer in perspective.
  vec2 pixels = uPerspective ? 1.0 / max(fwidth(vTex), vec2(1e-6)) : uPixels;
  vec2 edge = clamp(min(vTex, 1.0 - vTex) * pixels + 0.5, 0.0, 1.0);
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
uniform sampler2D uMatte;
uniform int uMatteMode;
uniform sampler2D uMask;
uniform bool uMasked;
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
  // A track matte's coverage: its alpha or its brightness, or the opposite.
  float m = 1.0;
  if (uMatteMode > 0) {
    vec4 M = texture(uMatte, vUv);
    m = uMatteMode <= 2 ? M.a : dot(M.rgb, vec3(0.2126, 0.7152, 0.0722));
    if (uMatteMode == 2 || uMatteMode == 4) m = 1.0 - m;
    if (!uReplace) S *= m;
  }
  // An adjustment layer's masks: it only changes what's below inside them.
  if (uMasked) m *= texture(uMask, vUv).a;
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
  fragColor = uReplace ? mix(B, top, uOpacity * m) : top;
}`;

  // A layer (uSrc, bottom row first) times the coverage of its masks (uMask, top row first).
  const MASK_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform sampler2D uMask;
void main() {
  fragColor = texture(uSrc, vUv) * texture(uMask, vec2(vUv.x, 1.0 - vUv.y)).a;
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

  // Optical flow (for time effects' `getFlow`): pictures as luma at a small size, halved
  // into a pyramid, then Lucas-Kanade from the coarsest level down, each level starting
  // from the one above (flow is kept in uv, so it carries over between sizes).
  const LUMA_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform highp sampler2DArray uArr;
uniform bool uFromArray;
uniform float uLayer;
uniform vec2 uStep;
float lumaAt(vec2 p) {
  vec4 c = uFromArray ? texture(uArr, vec3(p, uLayer)) : texture(uSrc, p);
  return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
}
void main() {
  // A little box filter, so the small picture doesn't alias.
  float l = 0.25 * (lumaAt(vUv + uStep * vec2(-0.25, -0.25)) + lumaAt(vUv + uStep * vec2(0.25, -0.25)) +
    lumaAt(vUv + uStep * vec2(-0.25, 0.25)) + lumaAt(vUv + uStep * vec2(0.25, 0.25)));
  fragColor = vec4(l, 0.0, 0.0, 1.0);
}`;
  const LK_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform sampler2D uFlowIn;
uniform bool uHasIn;
uniform vec2 uTexel;
void main() {
  vec2 d = uHasIn ? texture(uFlowIn, vUv).xy : vec2(0.0);
  mat2 A = mat2(0.0);
  vec2 b = vec2(0.0);
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 p = vUv + vec2(float(x), float(y)) * uTexel;
      float w = exp(-0.25 * float(x * x + y * y));
      float ix = 0.5 * (texture(uCur, p + vec2(uTexel.x, 0.0)).r - texture(uCur, p - vec2(uTexel.x, 0.0)).r);
      float iy = 0.5 * (texture(uCur, p + vec2(0.0, uTexel.y)).r - texture(uCur, p - vec2(0.0, uTexel.y)).r);
      float it = texture(uCur, p).r - texture(uPrev, p - d).r;
      A += w * mat2(ix * ix, ix * iy, ix * iy, iy * iy);
      b += w * vec2(ix * it, iy * it);
    }
  }
  // Regularised: flat areas keep the coarser estimate.
  A += mat2(1e-4, 0.0, 0.0, 1e-4);
  vec2 step = -inverse(A) * b;
  step = clamp(step, vec2(-2.0), vec2(2.0));
  fragColor = vec4(d + step * uTexel, 0.0, 1.0);
}`;
  const FLOW_SMOOTH_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uFlowIn;
uniform sampler2D uCur;
uniform vec2 uTexel;
void main() {
  // An edge-aware average: neighbours on the same surface (similar brightness) count most.
  float l0 = texture(uCur, vUv).r;
  vec2 sum = vec2(0.0);
  float total = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 p = vUv + vec2(float(x), float(y)) * uTexel;
      float dl = texture(uCur, p).r - l0;
      float w = exp(-0.3 * float(x * x + y * y) - dl * dl * 400.0);
      sum += texture(uFlowIn, p).xy * w;
      total += w;
    }
  }
  fragColor = vec4(sum / total, 0.0, 1.0);
}`;

  // A moment between two frames: each warped by its flow towards the other, then cross-faded.
  const INTERP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uAB;
uniform sampler2D uBA;
uniform bool uFlow;
uniform float uAmount;
void main() {
  if (!uFlow) {
    fragColor = mix(texture(uA, vUv), texture(uB, vUv), uAmount);
    return;
  }
  // B(x) = A(x - ab(x)) and A(x) = B(x - ba(x)): at the moment between, what's at x was
  // amount of the way along its path from A.
  vec2 ab = texture(uAB, vUv).xy;
  vec2 ba = texture(uBA, vUv).xy;
  vec4 a = texture(uA, vUv - uAmount * ab);
  vec4 b = texture(uB, vUv - (1.0 - uAmount) * ba);
  // Where the two disagree (something appeared or was covered), lean on the nearer frame.
  float disagree = clamp(length(a - b) * 2.0, 0.0, 1.0);
  float t = mix(uAmount, step(0.5, uAmount), disagree * 0.6);
  fragColor = mix(a, b, t);
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
  // The user's own shaders (the Shader effect, keyed by their code's hash): a new one for every edit of
  // the code, so only the most recently used are kept.
  const USER_SHADERS = 24;
  const userPrograms = new Set<string>();
  const shaderProgram = (shader: Shader) => {
    let entry = programs.get(shader.key);
    const user = shader.key.startsWith("fx:shader:");
    if (entry) {
      if (user) {
        userPrograms.delete(shader.key);
        userPrograms.add(shader.key);
      }
      return entry;
    }
    const pending = compiling.get(shader.key) ?? startLink(shader.vertex ?? QUAD_VS, shader.source);
    compiling.delete(shader.key);
    entry = finishLink(pending);
    programs.set(shader.key, entry);
    if (user) {
      userPrograms.add(shader.key);
      for (const old of userPrograms) {
        if (userPrograms.size <= USER_SHADERS) break;
        gl.deleteProgram(programs.get(old)!.program);
        programs.delete(old);
        userPrograms.delete(old);
      }
    }
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
  let sides = [target(), target()];
  let accumTarget = target();
  // Where a track matte is drawn before the layer it cuts out.
  let matteTarget = target();
  // Where an adjustment layer's masks are placed (made when first needed), by frame size.
  const maskTargets = new Map<string, Target>();
  // Where `readYuv420` packs the frame (sized on first use).
  const yuv = { ...target(), width: 0, height: 0 };
  // Where `readRgbaAsync` copies the frame, straight and top row first (sized on first use).
  const rgba = { ...target(), width: 0, height: 0 };
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
    /** Already premultiplied and stored bottom row first, like a frame: a group's (`endGroup`). */
    layer?: boolean;
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

  /** A placement as a row-major 3x3 matrix (a local copy of `toMatrix3`: this function can't refer outside itself). */
  const matrixOf = (t: Placement2D): number[] => (t.length === 9 ? t : [t[0], t[2], t[4], t[1], t[3], t[5], 0, 0, 1]);
  /** A picture's corners on a `tw` x `th` target in px (null: behind the camera). */
  const cornersOf = (m: number[], tw: number, th: number) =>
    ([[0, 0], [1, 0], [0, 1], [1, 1]] as const).map(([u, v]) => {
      const w = m[6] * u + m[7] * v + m[8];
      return w > 1e-9 ? ([((m[0] * u + m[1] * v + m[2]) / w) * tw, ((m[3] * u + m[4] * v + m[5]) / w) * th] as const) : null;
    });
  /** Output px per picture fraction along u and v (the most, for a layer in perspective), and the least of either. */
  const shownSize = (t: Placement2D, tw: number, th: number): { pu: number; pv: number; least: number } | null => {
    if (t.length === 6) {
      const [a, b, c, d] = t;
      const pu = Math.hypot(a * tw, b * th);
      const pv = Math.hypot(c * tw, d * th);
      return { pu, pv, least: Math.min(pu, pv) };
    }
    const [c00, c10, c01, c11] = cornersOf(t, tw, th);
    const span = (p: readonly number[] | null, q: readonly number[] | null) => (p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : NaN);
    const us = [span(c00, c10), span(c01, c11)].filter(Number.isFinite);
    const vs = [span(c00, c01), span(c10, c11)].filter(Number.isFinite);
    // Partly behind the camera: as big as a canvas side, which is as much detail as is ever needed.
    const pu = us.length ? Math.max(...us) : Math.max(tw, th);
    const pv = vs.length ? Math.max(...vs) : Math.max(tw, th);
    const least = Math.min(...(us.length ? us : [pu]), ...(vs.length ? vs : [pv]));
    return { pu, pv, least };
  };
  /** The inverse of a 3x3 matrix (row-major), or null. */
  const invert3 = (m: number[]): number[] | null => {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!(Math.abs(det) > 1e-18)) return null;
    return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((x) => x / det);
  };

  /**
   * Draw a picture by `placement` into the bound framebuffer, `tw` x `th` px (blending as
   * currently set). `layer`: it's a picture after its effects (see PICTURE_FS). With
   * `edges` (see `EDGE_MODES`) it continues past its edges over the whole target.
   */
  const drawTextures = (pic: Picture, placement: Placement2D, opacity: number, tw: number, th: number, layer: boolean, edges = 0) => {
    if (!(opacity > 0)) return;
    const m = matrixOf(placement);
    const perspective = placement.length === 9;
    if (perspective && cornersOf(m, tw, th).every((c) => !c)) return;
    const size = shownSize(placement, tw, th);
    if (!size || !(size.pu > 1e-6 && size.pv > 1e-6)) return;
    const { pu, pv, least } = size;
    // Canvas fractions (y down) -> clip space (y up), keeping w: x' = 2x - w, y' = w - 2y.
    const r0 = [2 * m[0] - m[6], 2 * m[1] - m[7], 2 * m[2] - m[8]];
    const r1 = [m[6] - 2 * m[3], m[7] - 2 * m[4], m[8] - 2 * m[5]];
    const r2 = [m[6], m[7], m[8]];
    const clip = [...r0, ...r1, ...r2];
    const inverse = edges ? invert3(clip) : null;
    if (edges && !inverse) return;
    // Mipmaps keep a big picture drawn small from shimmering (layers are made about the size they're shown).
    // (A group's picture is drawn at its own size, like a stored picture, so it may need them too.)
    const shrunk = (!layer || !!pic.layer) && (pic.width > pu * 1.5 || pic.height > pv * 1.5);
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
    const { program, loc } = pictureProgram;
    gl.useProgram(program);
    // Column-major for GL.
    const columns = (r: number[]) => new Float32Array([r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]]);
    gl.uniformMatrix3fv(loc("uMatrix"), false, columns(clip));
    if (inverse) gl.uniformMatrix3fv(loc("uInverse"), false, columns(inverse));
    gl.uniform1i(loc("uFill"), edges ? 1 : 0);
    gl.uniform1i(loc("uPerspective"), perspective ? 1 : 0);
    // The quad reaches a pixel past the edges to fade them (not far past, in perspective: never behind the camera).
    const margin = perspective ? Math.min(0.02, 1 / Math.max(least, 1)) : 0;
    gl.uniform2f(loc("uMargin"), perspective ? margin : Math.min(1, 1 / pu), perspective ? margin : Math.min(1, 1 / pv));
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
      else if (u.type === "vec4") gl.uniform4f(l, v[0], v[1], v[2], v[3]);
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
    | { kind: "picture"; pic: Picture; next?: { pic: Picture; amount: number; flow: boolean } }
    | { kind: "solid"; color: [number, number, number, number]; width: number; height: number }
    | { kind: "vector"; drawing: VectorDrawing }
    | { kind: "text"; drawing: TextDrawing }
    | { kind: "frame" };

  const sourceOf = (p: Placed): Source | null => {
    if (p.solid) return { kind: "solid", ...p.solid };
    if (p.vector) return { kind: "vector", drawing: p.vector };
    if (p.text) return { kind: "text", drawing: p.text };
    const pic = pictures.get(p.key);
    if (!pic) return null;
    const next = p.interpolate && pictures.get(p.interpolate.key);
    // Only strictly between the two frames is there anything to interpolate.
    const amount = p.interpolate?.amount ?? 0;
    if (!next || !(amount > 1e-3 && amount < 1 - 1e-3)) return { kind: "picture", pic: next && amount >= 1 - 1e-3 ? next : pic };
    return { kind: "picture", pic, next: { pic: next, amount, flow: p.interpolate!.flow } };
  };

  // ---------------------------------------------------------------------------
  // Time effects: each one's earlier inputs (a texture array of up to 48 frames, at
  // most 960 px on a side), its last two outputs (for feedback) and optical flow.
  // ---------------------------------------------------------------------------
  const HISTORY_DEPTH = 48;
  const HISTORY_SIDE = 960;
  interface History {
    array: WebGLTexture;
    w: number;
    h: number;
    depth: number;
    /** Each layer's time (NaN: empty). */
    times: number[];
    next: number;
    latest: number;
    /** Its outputs: the newest first, and their times. */
    outputs: [Target, Target] | null;
    outputTimes: [number, number];
    used: number;
  }
  const histories = new Map<string, History>();
  let draws = 0;
  const historyFbo = gl.createFramebuffer()!;
  let flowPrograms: { luma: ReturnType<typeof link>; lk: ReturnType<typeof link>; smooth: ReturnType<typeof link> } | null = null;
  // The flow pyramid's targets, by size: luma now and before, and flow in two buffers.
  const flowTargets = new Map<string, { cur: Target; prev: Target; a: Target; b: Target }>();

  const deleteHistory = (h: History) => {
    gl.deleteTexture(h.array);
    for (const t of h.outputs ?? []) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
  };

  /** The history under `info.id`, for layers of `w` x `h` px, fresh when its size or depth changed or time jumped. */
  const historyFor = (info: NonNullable<EffectPass["history"]>, w: number, h: number): History => {
    const k = Math.min(1, HISTORY_SIDE / Math.max(w, h));
    const hw = Math.max(1, Math.round(w * k));
    const hh = Math.max(1, Math.round(h * k));
    const depth = Math.max(2, Math.min(HISTORY_DEPTH, Math.ceil(info.reach * info.fps) + 2));
    let hist = histories.get(info.id);
    if (hist && (hist.w !== hw || hist.h !== hh || hist.depth < depth || !!hist.outputs !== !!info.feedback)) {
      deleteHistory(hist);
      hist = undefined;
    }
    if (!hist) {
      const array = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, array);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, hw, hh, depth, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      let outputs: [Target, Target] | null = null;
      if (info.feedback) {
        outputs = [target(), target()];
        for (const t of outputs) allocate(t, hw, hh);
      }
      hist = { array, w: hw, h: hh, depth, times: new Array(depth).fill(NaN), next: 0, latest: NaN, outputs, outputTimes: [NaN, NaN], used: draws };
      histories.set(info.id, hist);
    }
    hist.used = draws;
    const step = 1 / Math.max(1, info.fps);
    // Played backwards, or jumped: what's recorded isn't this moment's past any more.
    if (!Number.isNaN(hist.latest) && (info.time < hist.latest - 1.5 * step || info.time > hist.latest + info.reach + 2 * step)) {
      hist.times.fill(NaN);
      hist.latest = NaN;
      hist.outputTimes = [NaN, NaN];
    }
    return hist;
  };

  /** How long ago each recorded frame was (-1: empty, or too old to matter). */
  const historyAges = (hist: History, info: NonNullable<EffectPass["history"]>) =>
    hist.times.map((t) => {
      const age = info.time - t;
      return Number.isNaN(t) || age < 0 || age > info.reach + 1.5 / info.fps ? -1 : age;
    });

  /** Draw `tex` (or a layer of the history array) into `t` (`w` x `h`) as luma. */
  const drawLuma = (t: Target, w: number, h: number, source: { tex: WebGLTexture } | { array: WebGLTexture; layer: number }, sw: number, sh: number) => {
    const { program, loc } = flowPrograms!.luma;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(program);
    gl.uniform1i(loc("uFlipY"), 0);
    gl.uniform1i(loc("uSrc"), 0);
    gl.uniform1i(loc("uArr"), 3);
    const fromArray = "array" in source;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fromArray ? null : source.tex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, fromArray ? source.array : null);
    gl.uniform1i(loc("uFromArray"), fromArray ? 1 : 0);
    gl.uniform1f(loc("uLayer"), fromArray ? source.layer : 0);
    gl.uniform2f(loc("uStep"), sw / w / sw, sh / h / sh);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.activeTexture(gl.TEXTURE0);
  };

  /**
   * Optical flow from `prev` (a texture, or a layer of a history's array; `pw` x `ph` px) to
   * `cur` (`cw` x `ch` px): how far the picture moved, in uv, as a float texture (null without
   * float targets). Flows worked out at once need different `slot`s (their targets are shared).
   */
  const computeFlow = (
    prev: { tex: WebGLTexture } | { array: WebGLTexture; layer: number },
    pw: number,
    ph: number,
    cur: WebGLTexture,
    cw: number,
    ch: number,
    slot = 0,
  ): WebGLTexture | null => {
    if (!floatTargets) return null;
    flowPrograms ??= { luma: link(QUAD_VS, LUMA_FS), lk: link(QUAD_VS, LK_FS), smooth: link(QUAD_VS, FLOW_SMOOTH_FS) };
    const k = Math.min(1, 320 / Math.max(cw, ch));
    const levels: { w: number; h: number; t: { cur: Target; prev: Target; a: Target; b: Target } }[] = [];
    for (let i = 0; i < 4; i++) {
      const w = Math.max(4, Math.round((cw * k) / 2 ** i));
      const h = Math.max(4, Math.round((ch * k) / 2 ** i));
      const id = `${w}x${h}/${slot}`;
      let t = flowTargets.get(id);
      if (!t) {
        t = { cur: target(), prev: target(), a: target(), b: target() };
        allocate(t.cur, w, h);
        allocate(t.prev, w, h);
        allocate(t.a, w, h, true);
        allocate(t.b, w, h, true);
        flowTargets.set(id, t);
      }
      levels.push({ w, h, t });
    }
    gl.disable(gl.BLEND);
    for (const { w, h, t } of levels) {
      drawLuma(t.cur, w, h, { tex: cur }, cw, ch);
      drawLuma(t.prev, w, h, prev, pw, ph);
    }
    let flow: WebGLTexture | null = null;
    for (let i = levels.length - 1; i >= 0; i--) {
      const { w, h, t } = levels[i];
      // Two steps of Lucas-Kanade at this level, the first from the coarser level's flow.
      for (let pass = 0; pass < 2; pass++) {
        const out = pass === 0 ? t.a : t.b;
        const { program, loc } = flowPrograms.lk;
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(program);
        gl.uniform1i(loc("uFlipY"), 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, t.cur.tex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, t.prev.tex);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, pass === 0 ? flow : t.a.tex);
        gl.uniform1i(loc("uCur"), 0);
        gl.uniform1i(loc("uPrev"), 1);
        gl.uniform1i(loc("uFlowIn"), 2);
        gl.uniform1i(loc("uHasIn"), pass === 0 && !flow ? 0 : 1);
        gl.uniform2f(loc("uTexel"), 1 / w, 1 / h);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      // Smoothed back into the first buffer, which the next level up starts from.
      const { program, loc } = flowPrograms.smooth;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.a.fbo);
      gl.useProgram(program);
      gl.uniform1i(loc("uFlipY"), 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.b.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, t.cur.tex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.uniform1i(loc("uFlowIn"), 0);
      gl.uniform1i(loc("uCur"), 1);
      gl.uniform2f(loc("uTexel"), 1 / w, 1 / h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      flow = t.a.tex;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return flow;
  };

  /**
   * Get a time effect's history ready before it draws: its earlier frames, its output a frame
   * ago and the flow since the last frame. Returns what to bind (see `bindHistory`).
   */
  const beginHistory = (info: NonNullable<EffectPass["history"]>, input: WebGLTexture, w: number, h: number) => {
    const hist = historyFor(info, w, h);
    const ages = historyAges(hist, info);
    // The newest earlier frame (not this moment's own), for the flow.
    let prevLayer = -1;
    ages.forEach((age, i) => {
      if (age > 0.25 / info.fps && (prevLayer < 0 || age < ages[prevLayer])) prevLayer = i;
    });
    const flow = info.flow && prevLayer >= 0 ? computeFlow({ array: hist.array, layer: prevLayer }, hist.w, hist.h, input, w, h) : null;
    // Its output a frame ago: the newest one, unless that's this moment's own (a redraw).
    let feedback: WebGLTexture | null = null;
    if (hist.outputs) {
      const [t0, t1] = hist.outputTimes;
      const pick = Math.abs(info.time - t0) < 1e-4 ? 1 : 0;
      const age = info.time - (pick ? t1 : t0);
      if (age > 0.25 / info.fps && age < info.reach + 2 / info.fps) feedback = hist.outputs[pick].tex;
    }
    return { hist, ages, flow, feedback };
  };

  const bindHistory = (loc: (name: string) => WebGLUniformLocation | null, state: ReturnType<typeof beginHistory>) => {
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, state.hist.array);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, state.feedback);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, state.flow);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(loc("uHistory"), 3);
    gl.uniform1i(loc("uFeedback"), 4);
    gl.uniform1i(loc("uFlow"), 5);
    const ages = new Float32Array(HISTORY_DEPTH).fill(-1);
    state.ages.forEach((a, i) => (ages[i] = a));
    gl.uniform1fv(loc("uHistoryAge"), ages);
    gl.uniform1i(loc("uHistoryCount"), state.ages.length);
    gl.uniform1i(loc("hasFeedback"), state.feedback ? 1 : 0);
    gl.uniform1i(loc("hasFlow"), state.flow ? 1 : 0);
  };

  /** A visualizer's sound (`EffectPass.audio`): its spectrum and waveform as float textures on units 6 and 7, and its scalars. */
  let audioTextures: { spectrum: WebGLTexture; wave: WebGLTexture } | null = null;
  const bindAudio = (loc: (name: string) => WebGLUniformLocation | null, audio: AudioInputs) => {
    if (!audioTextures) {
      const make = () => {
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
      };
      audioTextures = { spectrum: make(), wave: make() };
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const rows = Math.max(1, audio.rows);
    const spectrum = new Float32Array(96 * rows);
    spectrum.set(audio.spectrum.slice(0, 96 * rows));
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, audioTextures.spectrum);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 96, rows, 0, gl.RED, gl.FLOAT, spectrum);
    const points = Math.max(1, Math.floor(audio.wave.length / 2));
    const wave = new Float32Array(points * 2);
    wave.set(audio.wave.slice(0, points * 2));
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, audioTextures.wave);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, points, 1, 0, gl.RG, gl.FLOAT, wave);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(loc("uSpectrum"), 6);
    gl.uniform1i(loc("uSpectrumRows"), rows);
    gl.uniform1f(loc("uSpectrumSpan"), audio.span);
    gl.uniform1i(loc("uWave"), 7);
    gl.uniform1i(loc("uWavePoints"), audio.wave.length >= 4 ? points : 0);
    const s = audio.scalars;
    gl.uniform1f(loc("audioLevel"), s.level);
    gl.uniform1f(loc("audioBass"), s.bass);
    gl.uniform1f(loc("audioMid"), s.mid);
    gl.uniform1f(loc("audioHigh"), s.high);
    gl.uniform1f(loc("audioOnset"), s.onset);
    gl.uniform1f(loc("sinceOnset"), s.sinceOnset);
    gl.uniform1f(loc("beatCount"), s.beat);
    gl.uniform1f(loc("beatPhase"), s.beatPhase);
    gl.uniform1f(loc("sinceBeat"), s.sinceBeat);
    gl.uniform1f(loc("bpm"), s.bpm);
    const ages = new Float32Array(8).fill(1e4);
    const velocities = new Float32Array(8);
    audio.hits.slice(0, 8).forEach(([age, v], i) => {
      ages[i] = age;
      velocities[i] = v;
    });
    gl.uniform1fv(loc("hitAge"), ages);
    gl.uniform1fv(loc("hitVelocity"), velocities);
  };

  /** After a time effect drew: add this moment's input (and output) to its history. */
  const endHistory = (info: NonNullable<EffectPass["history"]>, state: ReturnType<typeof beginHistory>, input: WebGLTexture, output: WebGLTexture) => {
    for (const unit of [3, 4, 5]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(unit === 3 ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
    if (info.record === false) return;
    const { hist } = state;
    const step = 1 / Math.max(1, info.fps);
    gl.disable(gl.BLEND);
    let layer = -1;
    if (Number.isNaN(hist.latest) || info.time - hist.latest >= 0.5 * step) {
      layer = hist.next;
      hist.next = (hist.next + 1) % hist.depth;
      hist.latest = info.time;
    } else if (Math.abs(info.time - hist.latest) < 1e-4) {
      layer = (hist.next - 1 + hist.depth) % hist.depth;
    }
    if (layer >= 0) {
      hist.times[layer] = info.time;
      gl.bindFramebuffer(gl.FRAMEBUFFER, historyFbo);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, hist.array, 0, layer);
      gl.viewport(0, 0, hist.w, hist.h);
      copy(input);
    }
    if (hist.outputs) {
      const [t0] = hist.outputTimes;
      if (Number.isNaN(t0) || info.time - t0 >= 0.5 * step) {
        hist.outputs.reverse();
        hist.outputTimes = [info.time, t0];
      }
      if (Math.abs(hist.outputTimes[0] - info.time) < 1e-4) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, hist.outputs[0].fbo);
        gl.viewport(0, 0, hist.w, hist.h);
        copy(output);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Simulations (`EffectPass.simulation`): each one's state (its output) at its two newest frames, in half
  // floats (8 bits would never fade a trail to black), and a checkpoint every CHECKPOINT_EVERY frames, all
  // simulations' sharing a budget (the least recently used let go first).
  // ---------------------------------------------------------------------------
  const CHECKPOINT_EVERY = 30;
  interface SimState {
    target: Target;
    w: number;
    h: number;
    /** The frame it holds (NaN: none), of `version`. */
    frame: number;
    version: string;
  }
  interface Simulation {
    states: [SimState, SimState];
    checkpoints: Map<number, SimState>;
    version: string;
    used: number;
  }
  const simulations = new Map<string, Simulation>();
  let checkpointBudget = 256 * 1024 * 1024;
  /** Every checkpoint's bytes, by `${id}\n${frame}`, least recently used first. */
  const checkpointUse = new Map<string, number>();
  const stateBytes = (w: number, h: number) => w * h * (floatTargets ? 8 : 4);
  const newState = (): SimState => ({ target: target(), w: 0, h: 0, frame: NaN, version: "" });
  const sizeState = (st: SimState, w: number, h: number) => {
    if (st.w === w && st.h === h) return;
    allocate(st.target, w, h, floatTargets);
    st.w = w;
    st.h = h;
  };
  const deleteState = (st: SimState) => {
    gl.deleteTexture(st.target.tex);
    gl.deleteFramebuffer(st.target.fbo);
  };
  const dropCheckpoint = (id: string, frame: number) => {
    const sim = simulations.get(id);
    const st = sim?.checkpoints.get(frame);
    if (st) deleteState(st);
    sim?.checkpoints.delete(frame);
    checkpointUse.delete(`${id}\n${frame}`);
  };
  const dropCheckpoints = (id: string, sim: Simulation) => {
    for (const frame of [...sim.checkpoints.keys()]) dropCheckpoint(id, frame);
  };
  /** Keep checkpoints within the budget, the least recently used let go first. */
  const trimCheckpoints = () => {
    let total = 0;
    for (const b of checkpointUse.values()) total += b;
    for (const [key, b] of checkpointUse) {
      if (total <= checkpointBudget) break;
      const at = key.lastIndexOf("\n");
      dropCheckpoint(key.slice(0, at), Number(key.slice(at + 1)));
      total -= b;
    }
  };
  const deleteSimulation = (id: string, sim: Simulation) => {
    dropCheckpoints(id, sim);
    for (const st of sim.states) deleteState(st);
    simulations.delete(id);
  };
  /** The simulation under `id`; a new version's makes its states stale and lets go of its checkpoints. */
  const simulationFor = (info: NonNullable<EffectPass["simulation"]>): Simulation => {
    let sim = simulations.get(info.id);
    if (!sim) {
      sim = { states: [newState(), newState()], checkpoints: new Map(), version: info.version, used: draws };
      simulations.set(info.id, sim);
    }
    if (sim.version !== info.version) {
      dropCheckpoints(info.id, sim);
      sim.version = info.version;
    }
    sim.used = draws;
    return sim;
  };
  /** Every state a simulation has of its version (kept, or checkpoints). */
  const exactStates = (sim: Simulation): SimState[] => [
    ...sim.states.filter((st) => st.version === sim.version && !Number.isNaN(st.frame)),
    ...sim.checkpoints.values(),
  ];
  /** What a simulation's frame `frame` reads: its state a frame before, else the newest earlier one it has (even stale), else none. */
  const stateBefore = (id: string, sim: Simulation, frame: number): SimState | null => {
    if (frame <= 0) return null;
    const exact = exactStates(sim).find((st) => st.frame === frame - 1);
    if (exact) {
      const key = `${id}\n${exact.frame}`;
      const bytes = checkpointUse.get(key);
      if (bytes !== undefined && sim.checkpoints.get(exact.frame) === exact) {
        checkpointUse.delete(key);
        checkpointUse.set(key, bytes);
      }
      return exact;
    }
    let best: SimState | null = null;
    for (const st of [...sim.states, ...sim.checkpoints.values()]) {
      if (Number.isNaN(st.frame) || st.frame >= frame) continue;
      // Of two as old, the one of this version.
      if (!best || st.frame > best.frame || (st.frame === best.frame && st.version === sim.version)) best = st;
    }
    return best;
  };
  // Where a simulation draws a frame it doesn't keep (motion blur's in-between moments).
  const passingState = newState();

  /** Draw a simulation's pass into its next state (from `input`, the layer so far), then copy that into `out` (the layer). */
  const runSimulation = (
    info: NonNullable<EffectPass["simulation"]>,
    loc: (name: string) => WebGLUniformLocation | null,
    w: number,
    h: number,
    input: WebGLTexture,
    out: Target,
  ) => {
    const sim = simulationFor(info);
    const before = stateBefore(info.id, sim, info.frame);
    // Written into the state that isn't being read (the older of the two).
    let st: SimState;
    if (info.record === false) st = passingState;
    else {
      const [a, b] = sim.states;
      st = before === a ? b : before === b ? a : Number.isNaN(a.frame) || (!Number.isNaN(b.frame) && a.frame < b.frame) ? a : b;
    }
    sizeState(st, w, h);
    // (Allocating binds on unit 0: the input goes back there, and on 1 for `getInput`.)
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, before?.target.tex ?? null);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(loc("uState"), 8);
    gl.uniform1i(loc("hasState"), before ? 1 : 0);
    gl.uniform1i(loc("simFrame"), info.frame);
    gl.uniform1f(loc("simStep"), 1 / Math.max(1, info.fps));
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.target.fbo);
    gl.viewport(0, 0, w, h);
    gl.uniform1i(loc("pass"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    if (info.record !== false) {
      st.frame = info.frame;
      st.version = sim.version;
      // A checkpoint now and then, to replay from after a seek.
      if (checkpointBudget > 0 && info.frame > 0 && info.frame % CHECKPOINT_EVERY === 0 && !sim.checkpoints.has(info.frame)) {
        const cp = newState();
        sizeState(cp, w, h);
        cp.frame = info.frame;
        cp.version = sim.version;
        gl.bindFramebuffer(gl.FRAMEBUFFER, cp.target.fbo);
        gl.viewport(0, 0, w, h);
        copy(st.target.tex);
        sim.checkpoints.set(info.frame, cp);
        checkpointUse.set(`${info.id}\n${info.frame}`, stateBytes(w, h));
        trimCheckpoints();
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.viewport(0, 0, w, h);
    copy(st.target.tex);
  };

  // ---------------------------------------------------------------------------
  // Masks and vector drawings: drawn with the browser's 2D canvas (the export's page has
  // one too), then uploaded. The last few are kept, so a still shape isn't drawn again.
  // ---------------------------------------------------------------------------
  type Ctx2d = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  const boards: (Ctx2d | null)[] = [];
  /** One of a few 2D canvases, cleared at `w` x `h`. */
  const board = (i: number, w: number, h: number): Ctx2d | null => {
    if (boards[i] === undefined) {
      const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : typeof document !== "undefined" ? document.createElement("canvas") : null;
      boards[i] = canvas ? (canvas.getContext("2d") as Ctx2d | null) : null;
    }
    const ctx = boards[i];
    if (!ctx) return null;
    // Setting the size clears the canvas and resets its state.
    ctx.canvas.width = w;
    ctx.canvas.height = h;
    return ctx;
  };
  const MAX_RASTERS = 16;
  const rasters = new Map<string, Picture>();
  /** The picture kept under `id` (most recently used last), or a fresh one drawn by `draw` and uploaded. */
  const raster = (id: string, w: number, h: number, draw: (ctx: Ctx2d) => void): Picture | null => {
    const hit = rasters.get(id);
    if (hit) {
      rasters.delete(id);
      rasters.set(id, hit);
      return hit;
    }
    const ctx = board(0, w, h);
    if (!ctx) return null;
    draw(ctx);
    // The least recently used one's texture is filled again.
    let tex: WebGLTexture | null = null;
    if (rasters.size >= MAX_RASTERS) {
      const [old, stale] = rasters.entries().next().value as [string, Picture];
      rasters.delete(old);
      tex = stale.textures[0];
    }
    tex ??= texture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas as TexImageSource);
    const pic: Picture = { textures: [tex], yuv: null, width: w, height: h, mipmapped: false };
    rasters.set(id, pic);
    return pic;
  };

  /** Where a layer's frame is inside the layer itself: all of it, unless the layer has room around the frame. */
  interface FrameBox {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  const boxKey = (f: FrameBox) => `${f.x},${f.y},${f.w}x${f.h}`;

  /** How much of a `w` x `h` layer (its frame at `frame`) its masks leave, as a picture's alpha. */
  const maskPicture = (masks: MaskShape[], w: number, h: number, frame: FrameBox = { x: 0, y: 0, w, h }): Picture | null =>
    raster(`m:${w}x${h}:${boxKey(frame)}:${JSON.stringify(masks)}`, w, h, (acc) => {
      // A first mask that takes away (or keeps what's shared) starts from the whole layer.
      if (masks[0].mode !== 0) {
        acc.fillStyle = "#fff";
        acc.fillRect(0, 0, w, h);
      }
      for (const mask of masks) {
        const sigma = Math.max(0, mask.feather * frame.h) / 2;
        // Room around the layer, so a soft edge doesn't fade where the mask runs off it.
        const room = Math.min(512, Math.ceil(sigma * 3));
        const one = board(1, w + 2 * room, h + 2 * room);
        if (!one) continue;
        const shape = new Path2D();
        shape.addPath(new Path2D(mask.d), new DOMMatrix([frame.w, 0, 0, frame.h, room + frame.x, room + frame.y]));
        one.fillStyle = "#fff";
        one.strokeStyle = "#fff";
        one.lineJoin = "round";
        one.fill(shape, "nonzero");
        const grow = mask.expansion * frame.h;
        if (Math.abs(grow) > 1e-3) {
          // Grown by a stroke of that width around it; shrunk by rubbing the same stroke out.
          one.lineWidth = 2 * Math.abs(grow);
          if (grow < 0) one.globalCompositeOperation = "destination-out";
          one.stroke(shape);
          one.globalCompositeOperation = "source-over";
        }
        if (mask.inverted) {
          one.globalCompositeOperation = "xor";
          one.fillRect(0, 0, w + 2 * room, h + 2 * room);
          one.globalCompositeOperation = "source-over";
        }
        acc.globalAlpha = Math.min(1, Math.max(0, mask.opacity));
        acc.globalCompositeOperation = mask.mode === 1 ? "destination-out" : mask.mode === 2 ? "destination-in" : "source-over";
        if (sigma > 0.25 && "filter" in acc) {
          acc.filter = `blur(${sigma}px)`;
          acc.drawImage(one.canvas, -room, -room);
          acc.filter = "none";
        } else if (sigma > 0.25) {
          // No canvas filters (Safari): the shape's blurred shadow, the shape itself drawn out of sight.
          const far = w + 2 * room + 16;
          acc.shadowColor = "#fff";
          acc.shadowBlur = sigma * 2;
          acc.shadowOffsetX = far;
          acc.drawImage(one.canvas, -room - far, -room);
          acc.shadowColor = "transparent";
          acc.shadowOffsetX = 0;
          acc.shadowBlur = 0;
        } else {
          acc.drawImage(one.canvas, -room, -room);
        }
      }
      acc.globalAlpha = 1;
      acc.globalCompositeOperation = "source-over";
    });

  /** A vector drawing in a `w` x `h` px layer, its frame at `frame`. */
  const vectorPicture = (drawing: VectorDrawing, w: number, h: number, frame: FrameBox): Picture | null =>
    raster(`v:${w}x${h}:${boxKey(frame)}:${JSON.stringify(drawing)}`, w, h, (ctx) => {
      const sx = frame.w / Math.max(1e-6, drawing.width);
      const sy = frame.h / Math.max(1e-6, drawing.height);
      const paint = (p: VectorPaint): string | CanvasGradient => {
        if (typeof p === "string") return p;
        const g =
          p.type === "radial"
            ? ctx.createRadialGradient(p.from[0], p.from[1], 0, p.from[0], p.from[1], Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1]))
            : ctx.createLinearGradient(p.from[0], p.from[1], p.to[0], p.to[1]);
        for (const [at, color] of p.stops) g.addColorStop(Math.min(1, Math.max(0, at)), color);
        return g;
      };
      for (const op of drawing.ops) {
        const t = op.transform ?? IDENTITY_AFFINE;
        ctx.setTransform(sx * t[0], sy * t[1], sx * t[2], sy * t[3], sx * t[4] + frame.x, sy * t[5] + frame.y);
        ctx.globalAlpha = Math.min(1, Math.max(0, op.opacity ?? 1));
        const shape = new Path2D(op.d);
        if (op.fill !== undefined) {
          ctx.fillStyle = paint(op.fill);
          ctx.fill(shape, op.fillRule ?? "nonzero");
        }
        if (op.stroke !== undefined && (op.strokeWidth ?? 0) > 0) {
          ctx.strokeStyle = paint(op.stroke);
          ctx.lineWidth = op.strokeWidth!;
          ctx.lineJoin = op.join ?? "miter";
          ctx.lineCap = op.cap ?? "butt";
          ctx.miterLimit = op.miterLimit ?? 4;
          ctx.setLineDash(op.dash ?? []);
          ctx.lineDashOffset = op.dashOffset ?? 0;
          ctx.stroke(shape);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
    });

  /** A text in a `w` x `h` px layer, its frame at `frame`. */
  const textPicture = (text: TextDrawing, w: number, h: number, frame: FrameBox): Picture | null =>
    raster(`t:${w}x${h}:${boxKey(frame)}:${JSON.stringify(text)}`, w, h, (ctx) => {
      const sx = frame.w / Math.max(1e-6, text.width);
      const sy = frame.h / Math.max(1e-6, text.height);
      ctx.setTransform(sx, 0, 0, sy, frame.x, frame.y);
      ctx.font = text.font;
      if ("fontStretch" in ctx) ctx.fontStretch = text.stretch as CanvasFontStretch;
      // Canvas letter spacing isn't in every browser yet: there, each letter is placed by hand.
      const spaced = "letterSpacing" in (ctx as object);
      if (spaced) ctx.letterSpacing = `${text.letterSpacing}px`;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";

      // The shadow falls from the first thing drawn: the box, else the stroke, else the letters.
      // Canvas shadows and filters ignore the transform, hence the scaling by hand.
      let shadowPending = !!text.shadow;
      const castShadow = (on: boolean) => {
        if (on && text.shadow) {
          ctx.shadowColor = text.shadow.color;
          ctx.shadowOffsetX = text.shadow.offset * sx;
          ctx.shadowOffsetY = text.shadow.offset * sy;
          ctx.shadowBlur = text.shadow.blur * sy;
        } else {
          ctx.shadowColor = "transparent";
        }
        shadowPending = false;
      };
      const eachLine = (paint: (t: string, x: number, y: number) => void) => {
        for (const line of text.lines) {
          if (!line.text) continue;
          if (spaced) {
            paint(line.text, line.x, line.y);
            continue;
          }
          let cx = line.x;
          for (const ch of line.text) {
            paint(ch, cx, line.y);
            cx += ctx.measureText(ch).width + text.letterSpacing;
          }
        }
      };

      /** One letter of an animated text: where it's drawn, and what its animators do to it. */
      interface Glyph {
        text: string;
        x: number;
        y: number;
        opacity: number;
        blur: number;
        fill: string;
        /** One per animator that acts on it, in order: moved by (dx, dy), then turned and scaled around (cx, cy). */
        transforms: { dx: number; dy: number; cx: number; cy: number; rotation: number; scale: number }[];
      }
      const mixColor = (a: string, b: string, f: number): string => {
        if (f <= 0) return a;
        const [x, y] = [Number.parseInt(a.slice(1), 16), Number.parseInt(b.slice(1), 16)];
        const ch = (shift: number) => Math.round(((x >> shift) & 255) + (((y >> shift) & 255) - ((x >> shift) & 255)) * Math.min(1, f));
        return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
      };
      const animators = text.animators ?? [];
      const glyphsOf = (): Glyph[] => {
        const em = text.fontPx;
        const amountAt = (j: number, i: number, k: number) => animators[j].glyphs[i]?.[k] ?? { unit: -1, amount: 0 };
        // Where each letter sits in its line, from the widths of the text before it (so kerning is kept).
        const placed = text.lines.map((line, i) => {
          const chars = [...line.text];
          const edges = [0];
          let prefix = "";
          for (const [k, ch] of chars.entries()) {
            prefix += ch;
            edges.push(ctx.measureText(prefix).width + (spaced ? 0 : (k + 1) * text.letterSpacing));
          }
          // Tracking from the animators opens the line up after each letter; the line stays aligned as it was.
          const extra = chars.map((_, k) => animators.reduce((sum, a, j) => sum + amountAt(j, i, k).amount * a.tracking, 0));
          const total = extra.reduce((a, b) => a + b, 0);
          let shift = text.align === "left" ? 0 : text.align === "right" ? -total : -total / 2;
          const xs = chars.map((_, k) => {
            const x = line.x + edges[k] + shift;
            shift += extra[k];
            return x;
          });
          return { chars, xs, widths: chars.map((_, k) => edges[k + 1] - edges[k]), y: line.y };
        });
        // Each animator's units: the box around their letters, to turn and scale around its middle.
        const centres = animators.map((_, j) => {
          const boxes = new Map<number, { left: number; right: number; top: number; bottom: number }>();
          placed.forEach((line, i) => {
            line.chars.forEach((_, k) => {
              const u = amountAt(j, i, k).unit;
              if (u < 0) return;
              const box = boxes.get(u) ?? { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
              box.left = Math.min(box.left, line.xs[k]);
              box.right = Math.max(box.right, line.xs[k] + line.widths[k]);
              // About the middle of the letters: between the baseline and the capitals' tops.
              box.top = Math.min(box.top, line.y - em * 0.7);
              box.bottom = Math.max(box.bottom, line.y);
              boxes.set(u, box);
            });
          });
          return boxes;
        });
        const out: Glyph[] = [];
        placed.forEach((line, i) => {
          line.chars.forEach((ch, k) => {
            if (!ch.trim()) return;
            const glyph: Glyph = { text: ch, x: line.xs[k], y: line.y, opacity: 1, blur: 0, fill: text.fill, transforms: [] };
            animators.forEach((a, j) => {
              const { unit: u, amount } = amountAt(j, i, k);
              if (!(amount > 0)) return;
              glyph.opacity *= 1 + amount * (a.opacity - 1);
              glyph.blur += amount * a.blur;
              if (a.fill) glyph.fill = mixColor(glyph.fill.startsWith("#") ? glyph.fill : text.fill, a.fill, amount);
              const box = centres[j].get(u)!;
              glyph.transforms.push({
                dx: amount * a.position[0],
                dy: amount * a.position[1],
                cx: (box.left + box.right) / 2,
                cy: (box.top + box.bottom) / 2,
                rotation: amount * a.rotation,
                scale: 1 + amount * (a.scale - 1),
              });
            });
            if (glyph.opacity > 0) out.push(glyph);
          });
        });
        return out;
      };
      // With animators, each letter is drawn on its own, where and how they put it.
      const glyphs = animators.length ? glyphsOf() : null;
      const eachGlyph = (paint: (g: Glyph) => void) => {
        for (const g of glyphs!) {
          ctx.save();
          ctx.globalAlpha = g.opacity;
          if (g.blur > 0 && "filter" in ctx) ctx.filter = `blur(${g.blur * sy}px)`;
          for (const t of g.transforms) {
            ctx.translate(t.dx, t.dy);
            ctx.translate(t.cx, t.cy);
            ctx.rotate((t.rotation * Math.PI) / 180);
            ctx.scale(t.scale, t.scale);
            ctx.translate(-t.cx, -t.cy);
          }
          paint(g);
          ctx.restore();
        }
      };

      if (text.box) {
        castShadow(shadowPending);
        ctx.fillStyle = text.box.color;
        ctx.beginPath();
        ctx.roundRect(text.box.x, text.box.y, text.box.width, text.box.height, text.box.radius);
        ctx.fill();
      }
      if (text.stroke && text.stroke.width > 0) {
        castShadow(shadowPending);
        ctx.strokeStyle = text.stroke.color;
        // Centred on the outline, half of it hidden under the fill.
        ctx.lineWidth = 2 * text.stroke.width;
        ctx.lineJoin = "round";
        if (glyphs) eachGlyph((g) => ctx.strokeText(g.text, g.x, g.y));
        else eachLine((t, x, y) => ctx.strokeText(t, x, y));
      }
      castShadow(shadowPending);
      ctx.fillStyle = text.fill;
      if (glyphs) {
        eachGlyph((g) => {
          ctx.fillStyle = g.fill;
          ctx.fillText(g.text, g.x, g.y);
        });
      } else eachLine((t, x, y) => ctx.fillText(t, x, y));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.shadowColor = "transparent";
    });
  let maskProgram: ReturnType<typeof link> | null = null;

  let interpProgram: ReturnType<typeof link> | null = null;
  /**
   * The moment `next.amount` of the way from picture `a` to `next.pic`, into one of `set`'s
   * layers (`w` x `h`): both frames are drawn into the others first. Returns which layer.
   */
  const interpolateInto = (set: Target[], a: Picture, next: { pic: Picture; amount: number; flow: boolean }, w: number, h: number) => {
    for (const [i, pic] of [a, next.pic].entries()) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, set[i].fbo);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawTextures(pic, IDENTITY_AFFINE, 1, w, h, !!pic.layer);
    }
    const ab = next.flow ? computeFlow({ tex: set[0].tex }, w, h, set[1].tex, w, h, 0) : null;
    const ba = next.flow ? computeFlow({ tex: set[1].tex }, w, h, set[0].tex, w, h, 1) : null;
    interpProgram ??= link(QUAD_VS, INTERP_FS);
    const { program, loc } = interpProgram;
    gl.bindFramebuffer(gl.FRAMEBUFFER, set[2].fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    [set[0].tex, set[1].tex, ab, ba].forEach((tex, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    });
    gl.uniform1i(loc("uA"), 0);
    gl.uniform1i(loc("uB"), 1);
    gl.uniform1i(loc("uAB"), 2);
    gl.uniform1i(loc("uBA"), 3);
    gl.uniform1i(loc("uFlipY"), 0);
    gl.uniform1i(loc("uFlow"), ab && ba ? 1 : 0);
    gl.uniform1f(loc("uAmount"), next.amount);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    for (let i = 3; i >= 0; i--) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    return 2;
  };

  /**
   * A layer ready to place: the stored picture, or with effects, a layer of it about the
   * size it's shown (never bigger than itself; a frame is always the canvas) with every
   * effect run over it. Past its edges, effects read what `edges` says.
   */
  const prepare = (
    source: Source,
    placement: Placement2D,
    effects: EffectPass[] | undefined,
    edges: number,
    aspect?: number,
    masks?: MaskShape[],
  ): { pic: Picture; layer: boolean; placement?: Placement2D } | null => {
    const passes = effects?.filter((fx) => fx.passes > 0) ?? [];
    // An adjustment layer's masks say where it changes the frame (see `blendInto`), not what its effects see.
    const masked = source.kind !== "frame" && !!masks?.length;
    if (!passes.length && !masked && source.kind === "picture" && !source.next) return { pic: source.pic, layer: !!source.pic.layer };
    if (!passes.length && !masked && source.kind === "solid") {
      const [r, g, b, a] = source.color;
      gl.bindTexture(gl.TEXTURE_2D, solidTex);
      const bytes = new Uint8Array([r, g, b, a].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)));
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return { pic: { textures: [solidTex], yuv: null, width: source.width, height: source.height, mipmapped: true }, layer: true };
    }
    const size = shownSize(placement, width, height);
    if (!size || !(size.pu > 1e-6 && size.pv > 1e-6)) return null;
    const { pu, pv } = size;
    let w: number;
    let h: number;
    let placed = placement;
    if (source.kind === "frame") {
      w = width;
      h = height;
    } else {
      // Rounded up to 32 px so a picture that's scaling doesn't need new layers every frame.
      // (A vector drawing or a text has as much detail as it's asked for.)
      const own = source.kind === "picture" ? source.pic : source.kind === "solid" ? source : { width: maxLayer, height: maxLayer };
      const side = (shown: number, max: number) => Math.max(1, Math.min(max, maxLayer, Math.ceil(shown / 32) * 32));
      w = side(pu, own.width);
      h = side(pv, own.height);
    }
    let ratio = source.kind === "frame" ? width / height : (aspect ?? pu / pv);
    // Where the frame is in the layer: all of it, until the layer is given room around it.
    let frameRect = [0, 0, 1, 1];
    let box: FrameBox = { x: 0, y: 0, w, h };
    /** Give the layer `room` (a fraction of the frame's height) on every side; it's placed so the frame stays where it was. */
    const makeRoom = (room: number) => {
      const m = Math.round(Math.min(room, 4) * h);
      const W = Math.min(maxLayer, w + 2 * m);
      const H = Math.min(maxLayer, h + 2 * m);
      const [mx, my] = [(W - w) / 2, (H - h) / 2];
      ratio = (ratio * h + 2 * mx) / (h + 2 * my);
      frameRect = [mx / W, my / H, 1 - mx / W, 1 - my / H];
      box = { x: mx, y: my, w, h };
      const m3 = matrixOf(placement);
      const [fx0, fy0] = [mx / W, my / H];
      const [sx, sy] = [1 / (1 - 2 * fx0), 1 / (1 - 2 * fy0)];
      const grown = [
        m3[0] * sx, m3[1] * sy, m3[2] - (m3[0] * fx0 * sx + m3[1] * fy0 * sy),
        m3[3] * sx, m3[4] * sy, m3[5] - (m3[3] * fx0 * sx + m3[4] * fy0 * sy),
        m3[6] * sx, m3[7] * sy, m3[8] - (m3[6] * fx0 * sx + m3[7] * fy0 * sy),
      ];
      placed = placement.length === 9 ? (grown as Projective) : ([grown[0], grown[3], grown[1], grown[4], grown[2], grown[5]] as Affine);
      w = W;
      h = H;
    };
    // Room past the frame that effects ask for (Grow Bounds).
    const grow = source.kind === "frame" ? 0 : Math.max(0, ...passes.map((fx) => fx.grow ?? 0));
    // A vector drawing or a text is drawn by the 2D canvas at that size, straight into a layer with
    // the room its shapes (and its effects) need; with nothing else to do to it, that's the layer.
    let drawn: Picture | null = null;
    if (source.kind === "vector" || source.kind === "text") {
      const room = Math.max(grow, source.kind === "vector" ? (source.drawing.bleed ?? 0) : 0);
      if (room > 0) makeRoom(room);
      drawn = source.kind === "vector" ? vectorPicture(source.drawing, w, h, box) : textPicture(source.drawing, w, h, box);
      if (!drawn) return null;
      if (!passes.length && !masked) return { pic: drawn, layer: false, placement: placed };
    }
    let set = scratchSet(w, h);
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
    } else if (source.kind === "vector" || source.kind === "text") {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawTextures(drawn!, IDENTITY_AFFINE, 1, w, h, false);
    } else if (source.next) {
      input = interpolateInto(set, source.pic, source.next, w, h);
    } else {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawTextures(source.pic, IDENTITY_AFFINE, 1, w, h, !!source.pic.layer);
    }
    // Masks cut the picture out before any effect sees it.
    const coverage = masked ? maskPicture(masks!, w, h, box) : null;
    if (coverage) {
      maskProgram ??= link(QUAD_VS, MASK_FS);
      const dst = input === 0 ? 1 : 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, set[dst].fbo);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.useProgram(maskProgram.program);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, coverage.textures[0]);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, set[input].tex);
      gl.uniform1i(maskProgram.loc("uSrc"), 0);
      gl.uniform1i(maskProgram.loc("uMask"), 1);
      gl.uniform1i(maskProgram.loc("uFlipY"), 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      input = dst;
    }
    // Room past the frame (Grow Bounds): the picture so far goes in the middle of a bigger layer.
    // (What the 2D canvas drew already has its room.)
    if (grow > 0 && !drawn) {
      const [w0, h0] = [w, h];
      makeRoom(grow);
      const big = scratchSet(w, h);
      for (const t of big) setWrap(t.tex, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, big[0].fbo);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const inner: Affine = [w0 / w, 0, 0, h0 / h, box.x / w, box.y / h];
      drawTextures({ textures: [set[input].tex], yuv: null, width: w0, height: h0, mipmapped: false }, inner, 1, w, h, true);
      set = big;
      input = 0;
    }
    for (const fx of passes) {
      if (fx.particles) {
        // Particles: the layer under them (the effect's base shader over its input), then every particle as a quad.
        const dst = [0, 1, 2].find((i) => i !== input)!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, set[dst].fbo);
        gl.viewport(0, 0, w, h);
        gl.disable(gl.BLEND);
        if (fx.shader.base) {
          const base = shaderProgram({ key: `${fx.shader.key}#base`, source: fx.shader.base });
          gl.useProgram(base.program);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, set[input].tex);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, set[input].tex);
          gl.uniform1i(base.loc("uSrc"), 0);
          gl.uniform1i(base.loc("uInput"), 1);
          gl.uniform1i(base.loc("uFlipY"), 0);
          gl.uniform1f(base.loc("ratio"), ratio);
          gl.uniform2f(base.loc("resolution"), w, h);
          gl.uniform1i(base.loc("pass"), 0);
          gl.uniform4f(base.loc("uFrame"), frameRect[0], frameRect[1], frameRect[2], frameRect[3]);
          setUniforms(base.loc, fx.uniforms);
          if (fx.audio) bindAudio(base.loc, fx.audio);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, null);
        } else copy(set[input].tex);
        const { program, loc } = shaderProgram(fx.shader);
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, set[input].tex);
        gl.uniform1i(loc("uSrc"), 0);
        gl.uniform1f(loc("ratio"), ratio);
        gl.uniform2f(loc("resolution"), w, h);
        gl.uniform4f(loc("uFrame"), frameRect[0], frameRect[1], frameRect[2], frameRect[3]);
        setUniforms(loc, fx.uniforms);
        gl.enable(gl.BLEND);
        const mode = fx.particles.blend;
        if (mode === 1) gl.blendFunc(gl.ONE, gl.ONE);
        else if (mode === 2) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
        else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        if (fx.particles.count > 0) gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(200_000, Math.floor(fx.particles.count)));
        gl.disable(gl.BLEND);
        input = dst;
        continue;
      }
      // A time effect's earlier frames and flow (which draws on its own targets first).
      const temporal = fx.history ? beginHistory(fx.history, set[input].tex, w, h) : null;
      const { program, loc } = shaderProgram(fx.shader);
      gl.useProgram(program);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.uniform1i(loc("uSrc"), 0);
      gl.uniform1i(loc("uInput"), 1);
      gl.uniform1i(loc("uFlipY"), 0);
      gl.uniform1f(loc("ratio"), ratio);
      gl.uniform2f(loc("resolution"), w, h);
      gl.uniform2f(loc("uResolution"), w, h);
      gl.uniform4f(loc("uFrame"), frameRect[0], frameRect[1], frameRect[2], frameRect[3]);
      setUniforms(loc, fx.uniforms);
      if (temporal) bindHistory(loc, temporal);
      if (fx.audio) bindAudio(loc, fx.audio);
      if (fx.simulation) {
        // A simulation draws into its state, which becomes the layer.
        const dst = [0, 1, 2].find((i) => i !== input)!;
        runSimulation(fx.simulation, loc, w, h, set[input].tex, set[dst]);
        if (fx.history && temporal) endHistory(fx.history, temporal, set[input].tex, set[dst].tex);
        input = dst;
        continue;
      }
      const effectInput = input;
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
      if (fx.history && temporal) {
        endHistory(fx.history, temporal, set[effectInput].tex, set[input].tex);
        gl.viewport(0, 0, w, h);
      }
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    return { pic: { textures: [set[input].tex], yuv: null, width: w, height: h, mipmapped: false }, layer: true, placement: placed };
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
      if (!(p.opacity > 0)) {
        // Unseen, a simulation still steps: what it shows next follows from this frame.
        const last = p.effects?.findLastIndex((fx) => !!fx.simulation) ?? -1;
        if (last >= 0 && source.kind !== "frame") prepare(source, p.affine, p.effects!.slice(0, last + 1), edges, p.aspect, p.masks);
        return;
      }
      const prepared = prepare(source, p.affine, p.effects, edges, p.aspect, p.masks);
      if (!prepared) return;
      bind(t);
      blendOver();
      drawTextures(prepared.pic, prepared.placement ?? p.affine, p.opacity, width, height, prepared.layer, edges);
      gl.disable(gl.BLEND);
      return;
    }
    clearTarget(accumTarget);
    const n = samples.length;
    for (const sample of samples) {
      if (!(sample.opacity > 0)) continue;
      const prepared = prepare(source, sample.affine, sample.effects ?? p.effects, edges, p.aspect, p.masks);
      if (!prepared) continue;
      bind(accumTarget);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      // Each moment adds its share; the float buffer keeps the sum smooth.
      drawTextures(prepared.pic, prepared.placement ?? sample.affine, sample.opacity / n, width, height, prepared.layer, edges);
    }
    bind(t);
    blendOver();
    copy(accumTarget.tex);
    gl.disable(gl.BLEND);
  };

  /** Draw a track matte into its target; the mode to use it with (0 when there's none to draw). */
  const drawMatte = (matte: Placed["matte"]): number => {
    clearTarget(matteTarget);
    if (!matte || matte.mode <= 0) return 0;
    const source = sourceOf(matte.layer);
    if (source) drawLayer(matteTarget, source, matte.layer);
    return matte.mode;
  };

  /**
   * Mix canvas-sized `layer` into the frame by blend mode `mode` (see BLEND_FS), through the
   * track matte in `matteTarget` (by `matteMode`), swapping the frame with its spare.
   */
  const blendInto = (layer: Target, mode: number, opacity: number, replace: boolean, matteMode = 0, mask: Target | null = null) => {
    blendProgram ??= link(QUAD_VS, BLEND_FS);
    const { program, loc } = blendProgram;
    bind(spare);
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, frame.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, layer.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, matteTarget.tex);
    gl.uniform1i(loc("uBase"), 0);
    gl.uniform1i(loc("uLayer"), 1);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, mask ? mask.tex : null);
    gl.uniform1i(loc("uMask"), 3);
    gl.uniform1i(loc("uMasked"), mask ? 1 : 0);
    gl.uniform1i(loc("uMatte"), 2);
    gl.uniform1i(loc("uMatteMode"), matteMode);
    gl.uniform1i(loc("uFlipY"), 0);
    gl.uniform1i(loc("uMode"), mode);
    gl.uniform1f(loc("uOpacity"), Math.min(1, Math.max(0, opacity)));
    gl.uniform1i(loc("uReplace"), replace ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    [frame, spare] = [spare, frame];
  };

  /**
   * An adjustment layer's masks, placed where the layer is, in a frame-sized target (its
   * alpha is where the layer changes the frame); null without masks.
   */
  const placeMasks = (adjustment: Adjustment): Target | null => {
    if (!adjustment.masks?.length) return null;
    const coverage = maskPicture(adjustment.masks, width, height);
    if (!coverage) return null;
    const id = `${width}x${height}`;
    let t = maskTargets.get(id);
    if (!t) {
      t = target();
      allocate(t, width, height);
      maskTargets.set(id, t);
    }
    clearTarget(t);
    blendOver();
    drawTextures(coverage, adjustment.affine, 1, width, height, false);
    gl.disable(gl.BLEND);
    return t;
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
  /** Copy the frame into `rgba`, top row first and un-premultiplied (left bound, for reading). */
  const packRgba = () => {
    if (rgba.width !== width || rgba.height !== height) {
      rgba.width = width;
      rgba.height = height;
      allocate(rgba, width, height);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, rgba.fbo);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    copy(frame.tex, { flipY: true, straight: true });
    return { w: width, h: height };
  };
  /** Pixel-pack buffers not in use by `readAsync`. */
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

  /**
   * Read what was just packed (the framebuffer bound, \`w\` x \`h\` texels) without waiting for the GPU: copied
   * into a pixel-pack buffer, then fetched once a fence says the copy is done.
   */
  const readAsync = ({ w, h }: { w: number; h: number }): Promise<Uint8Array<ArrayBuffer>> => {
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
  };

  // Groups (`beginGroup`): each level of nesting draws into its own set of frame-sized
  // targets (kept by level and size), and the level above it is set aside meanwhile.
  interface FrameSet {
    frame: Target;
    spare: Target;
    sides: Target[];
    accum: Target;
    matte: Target;
    width: number;
    height: number;
  }
  const groupSets = new Map<string, FrameSet>();
  const outer: FrameSet[] = [];
  const currentSet = (): FrameSet => ({ frame, spare, sides, accum: accumTarget, matte: matteTarget, width, height });
  const useSet = (set: FrameSet) => {
    ({ frame, spare, sides, width, height } = set);
    accumTarget = set.accum;
    matteTarget = set.matte;
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
      for (const t of [frame, spare, ...sides, matteTarget]) allocate(t, w, h);
      allocate(accumTarget, w, h, floatTargets);
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

    shiftPicture(key, previous) {
      const current = pictures.get(key);
      if (!current) return;
      const older = pictures.get(previous);
      pictures.set(previous, current);
      if (older) pictures.set(key, older);
      else pictures.delete(key);
    },

    clear(color = [0, 0, 0, 1]) {
      // Time effects that stopped drawing let go of their frames.
      draws++;
      if (draws % 120 === 0) {
        for (const [id, h] of histories) {
          if (draws - h.used <= 240) continue;
          deleteHistory(h);
          histories.delete(id);
        }
        // Simulations too, but for their checkpoints, which the budget lets go of.
        for (const [id, sim] of simulations) {
          if (draws - sim.used <= 240 || sim.checkpoints.size) continue;
          deleteSimulation(id, sim);
        }
      }
      bind(frame);
      gl.disable(gl.BLEND);
      gl.clearColor(color[0], color[1], color[2], color[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },

    drawPicture(picture) {
      const source = sourceOf(picture);
      if (!source) return;
      const mode = picture.blend ?? 0;
      if (mode === 0 && !picture.matte) {
        drawLayer(frame, source, picture);
        return;
      }
      const matteMode = drawMatte(picture.matte);
      clearTarget(sides[0]);
      drawLayer(sides[0], source, picture);
      blendInto(sides[0], mode, 1, false, matteMode);
    },

    simulationFrom(id, version, frame, memory) {
      if (frame <= 0) return frame;
      const sim = simulations.get(id);
      const kept = sim && sim.version === version ? exactStates(sim) : [];
      if (kept.some((st) => st.frame === frame - 1)) return frame;
      let from = 0;
      for (const st of kept) if (st.frame < frame) from = Math.max(from, st.frame + 1);
      return memory !== undefined ? Math.max(from, frame - Math.max(1, Math.ceil(memory))) : from;
    },

    advance(picture) {
      const source = sourceOf(picture);
      const effects = picture.effects ?? [];
      const last = effects.findLastIndex((fx) => !!fx.simulation);
      if (!source || last < 0) return;
      prepare(source, picture.affine, effects.slice(0, last + 1), picture.edges ?? 0, picture.aspect, picture.masks);
    },

    setCheckpointBudget(bytes) {
      checkpointBudget = Math.max(0, bytes);
      trimCheckpoints();
    },

    drawAdjustment(adjustment) {
      // Opacity mixes the adjusted frame with the one below; each moment is drawn whole.
      const whole = { ...adjustment, opacity: 1, samples: adjustment.samples?.map((s) => ({ ...s, opacity: 1 })) };
      if (!(adjustment.opacity > 0)) return;
      const matteMode = drawMatte(adjustment.matte);
      const mask = placeMasks(adjustment);
      clearTarget(sides[0]);
      drawLayer(sides[0], { kind: "frame" }, whole);
      blendInto(sides[0], adjustment.blend ?? 0, adjustment.opacity, true, matteMode, mask);
    },

    beginGroup(w, h) {
      w = Math.max(1, Math.min(maxLayer, Math.round(w)));
      h = Math.max(1, Math.min(maxLayer, Math.round(h)));
      const id = `${outer.length}:${w}x${h}`;
      let set = groupSets.get(id);
      if (!set) {
        set = { frame: target(), spare: target(), sides: [target(), target()], accum: target(), matte: target(), width: w, height: h };
        for (const t of [set.frame, set.spare, ...set.sides, set.matte]) allocate(t, w, h);
        allocate(set.accum, w, h, floatTargets);
        groupSets.set(id, set);
      }
      outer.push(currentSet());
      useSet(set);
      bind(frame);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },

    endGroup(key) {
      const parent = outer.pop();
      if (!parent) return;
      // The group's frame becomes the picture (swapping textures, so nothing is copied); the frame gets a fresh one.
      let pic = pictures.get(key);
      if (pic && (pic.yuv || pic.textures.length !== 1)) {
        deletePicture(key);
        pic = undefined;
      }
      if (!pic) {
        pic = { textures: [texture()], yuv: null, width, height, mipmapped: false, layer: true };
        pictures.set(key, pic);
      }
      const spareTex = pic.textures[0];
      pic.textures[0] = frame.tex;
      frame.tex = spareTex;
      allocate(frame, width, height);
      Object.assign(pic, { width, height, mipmapped: false, layer: true });
      useSet(parent);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    prepareShader(shader) {
      if (programs.has(shader.key)) return true;
      let pending = compiling.get(shader.key);
      if (!pending) {
        pending = startLink(shader.vertex ?? QUAD_VS, shader.source);
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
        const m = side && matrixOf(side.affine);
        const w = m ? m[6] / 2 + m[7] / 2 + m[8] : 0;
        if (!m || !(w > 1e-9)) return [0.5, 0.5];
        return [(m[0] / 2 + m[1] / 2 + m[2]) / w, 1 - (m[3] / 2 + m[4] / 2 + m[5]) / w];
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
      return readAsync(packYuv());
    },

    readRgbaAsync() {
      return readAsync(packRgba());
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
      for (const set of groupSets.values()) {
        for (const { tex, fbo } of [set.frame, set.spare, ...set.sides, set.accum, set.matte]) {
          gl.deleteTexture(tex);
          gl.deleteFramebuffer(fbo);
        }
      }
      groupSets.clear();
      for (const { tex, fbo } of [frame, spare, ...sides, accumTarget, matteTarget, yuv, rgba]) {
        gl.deleteTexture(tex);
        gl.deleteFramebuffer(fbo);
      }
      gl.deleteTexture(solidTex);
      for (const pic of rasters.values()) gl.deleteTexture(pic.textures[0]);
      rasters.clear();
      for (const { tex, fbo } of maskTargets.values()) {
        gl.deleteTexture(tex);
        gl.deleteFramebuffer(fbo);
      }
      maskTargets.clear();
      if (maskProgram) gl.deleteProgram(maskProgram.program);
      for (const h of histories.values()) deleteHistory(h);
      for (const [id, sim] of [...simulations]) deleteSimulation(id, sim);
      deleteState(passingState);
      histories.clear();
      for (const t of flowTargets.values()) {
        for (const x of [t.cur, t.prev, t.a, t.b]) {
          gl.deleteTexture(x.tex);
          gl.deleteFramebuffer(x.fbo);
        }
      }
      flowTargets.clear();
      gl.deleteFramebuffer(historyFbo);
      if (flowPrograms) for (const f of Object.values(flowPrograms)) gl.deleteProgram(f.program);
      if (interpProgram) gl.deleteProgram(interpProgram.program);
      gl.deleteBuffer(quad);
    },
  };
}
