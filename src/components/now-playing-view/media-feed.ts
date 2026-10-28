/**
 * The user's clips and pictures in MilkDrop's looks (docs/now-playing.md, "Your media"): after each frame of
 * Butterchurn's, the clip is painted into the frame it just drew, which the next frame warps (zooms, swirls, smears)
 * like everything else in it, and over what it showed. So the clip is plainly there, and what went in before streams
 * off it as trails in the preset's own motion (a preset warps all of its buffer every frame: what's only in it is soon
 * unrecognisable). A clip on a flat background has it taken out (`backdropOf`, measured on the clip every so often) and floats
 * at its own shape; footage fills the frame. How much and which of it (`MediaMix`: all of it, only its light, only its
 * edges) is the music's (`media-mix.ts`). A shared screen or window (`screen.ts`) goes in the same way, whole and
 * as it is: all of it shown, nothing taken out, by a feed of its own (the clips come in over it now and then). A 3D model
 * is drawn by three.js (`model-stage.ts`, loaded the first time one's shown) on a transparent background, every frame,
 * and goes in like a clip whose background is taken out. Drawn with Butterchurn's own WebGL context, into its own buffer,
 * leaving its state as it was.
 */
import type { ButterchurnRenderer } from "butterchurn";
import { errorMessage } from "@shared/errors";
import { log } from "@/lib/log";
import type { ModelShow, ModelStage } from "./model-stage";
import { type Backdrop, type MediaMix, PALE, amountOver, backdropOf, floatSize, placementOf, shownAt } from "./media-mix";

const VERTEX = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() {
  uv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

/**
 * The clip, filling the frame (`place` 0: `fit` is how much of its width and height it shows, kept to its shape) or
 * floating in the middle at its own shape (1: `size` is its rectangle, of the frame; its edges fading, an ellipse's
 * unless its background's taken out or it's a screen, `boxed`, shown to its edges: no box), its background taken out if it's flat (`keyed`: near `bg` goes), and as much of the rest
 * as the mode lets through: all of it, its light (dark parts let the preset's black through), or its edges (outlines
 * that glow); its colours a little richer.
 */
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D media;
uniform int place;
uniform vec2 fit;
uniform vec2 size;
uniform vec2 texel;
uniform float amount;
uniform int mode;
uniform vec2 key;
uniform int keyed;
uniform int boxed;
uniform int cutout;
uniform vec3 bg;
uniform float saturation;
uniform float bright;
out vec4 color;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 at(vec2 p) { return texture(media, p).rgb; }
// What edges are found in: its brightness (a model's: where it is, too, so its outline is an edge).
float edge(vec2 p) {
  vec4 t = texture(media, p);
  return cutout == 1 ? max(luma(t.rgb), 0.35) * t.a : luma(t.rgb);
}
void main() {
  vec2 p;
  float inside = 1.0;
  if (place == 0) p = (uv - 0.5) * fit + 0.5;
  else {
    p = (uv - 0.5) / size + 0.5;
    float e = min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y));
    // Its background taken out, its edge only softened (what's left is the subject); else it fades out from the middle
    // as an ellipse, so it reads as a glow, not a box.
    inside = keyed == 1 ? smoothstep(0.0, 0.06, e) : boxed == 1 ? smoothstep(0.0, 0.004, e) : (1.0 - smoothstep(0.55, 1.0, length((p - 0.5) * 2.0))) * smoothstep(0.0, 0.02, e);
  }
  if (inside <= 0.0) {
    color = vec4(0.0);
    return;
  }
  vec3 c = at(p);
  float l = luma(c);
  float keep = inside;
  // Its flat background taken out (soft, for compression's noise about it).
  if (keyed == 1) keep *= smoothstep(0.2, 0.38, distance(c, bg));
  // A model: what isn't it is see-through (its outline kept for its edges).
  if (cutout == 1 && mode != 2) keep *= texture(media, p).a;
  if (mode == 1) keep *= smoothstep(key.x, key.y, l);
  else if (mode == 2) {
    float tl = edge(p + texel * vec2(-1, 1)), t = edge(p + texel * vec2(0, 1)), tr = edge(p + texel * vec2(1, 1));
    float ml = edge(p + texel * vec2(-1, 0)), mr = edge(p + texel * vec2(1, 0));
    float bl = edge(p + texel * vec2(-1, -1)), b = edge(p + texel * vec2(0, -1)), br = edge(p + texel * vec2(1, -1));
    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
    keep *= smoothstep(key.x, key.y, length(vec2(gx, gy)));
    // Its outlines as light, in its own colours.
    // (A model's outside is black: its silhouette glows in its colours, taken from just inside it.)
    if (cutout == 1) c = mix(c, at(p + normalize(vec2(gx, gy) + 1e-5) * texel * 2.0), 1.0 - texture(media, p).a);
    c = c / max(max(c.r, max(c.g, c.b)), 0.25);
  }
  c = clamp(mix(vec3(luma(c)), c, saturation), 0.0, 1.0);
  // Its highlights held down: a preset that brightens its feedback would pile them up to white.
  c = bright * c / (1.0 + 0.6 * c);
  color = vec4(c, keep * amount);
}`;

/** How bright the clip goes in (its highlights compressed besides: `c / (1 + 0.6c)`, 1 to 0.625). */
const BRIGHT = 1.2;
/** Every this many frames fed, how light the picture is (`Brake`). */
const MEASURE_EVERY = 12;
/** Footage (no background to take out) shows this much as much on top as a clip floating does. */
const FOOTAGE_ON_TOP = 0.55;
/**
 * Every this many frames fed, a clip's background looked at again (a picture's once): often at first, until it's been
 * seen a few times (a dancer may cover its edge in the frame it's first looked at), then now and then.
 */
const BACKDROP_EVERY = 90;
const BACKDROP_FIRST = { every: 15, times: 8 };

/**
 * Less of the clip while the picture is turning white or pale (some presets brighten their feedback: what's painted in
 * piles up), and back again as it clears: measured on the picture itself, small, every few frames.
 */
export class Brake {
  private value = 1;
  private readonly small = document.createElement("canvas");

  constructor() {
    this.small.width = 16;
    this.small.height = 9;
  }

  /** How much of the clip goes in (0.15..1: it never goes altogether). */
  get gain(): number {
    return this.value;
  }

  /** The picture `canvas` measured: braked if it's blown out, let go a little if it isn't. */
  measure(canvas: HTMLCanvasElement): void {
    const ctx = this.small.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0, 16, 9);
    const data = ctx.getImageData(0, 0, 16, 9).data;
    let sum = 0;
    let white = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      sum += l;
      if (l > 0.9) white++;
    }
    const mean = sum / (data.length / 4);
    const whiteShare = white / (data.length / 4);
    // (Washed out, as much as blown out: pale pictures are what Théo bins; but the clip stays plainly there.)
    this.value = mean > 0.6 || whiteShare > 0.22 ? Math.max(0.15, this.value * 0.7) : Math.min(1, this.value * 1.1);
  }
}

/** A model's stage is drawn this much smaller than the look (three.js draws it every frame). */
const MODEL_SCALE = 0.75;

const logger = log("now-playing");

/** What's being fed: a clip, a picture, a screen or a model, and its texture. */
interface Fed {
  id: string;
  el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
  /** A screen shared (live: no background looked for, shown whole and as it is). */
  live: boolean;
  /** A 3D model (drawn every frame by its stage, on a transparent background). */
  model: boolean;
  width: number;
  height: number;
  /** A frame of it is on the GPU. */
  loaded: boolean;
  /** The video's time when its frame was last taken (a new one is taken when it moves on). */
  taken: number;
  /** Its background (null: not looked at yet), and how many times it's been looked at. */
  backdrop: Backdrop | null;
  looked: number;
}

/** What the feed is given: a clip, a picture or a model by its URL, or a screen shared (`screen.ts`). */
export type FedMedia =
  | { id: string; kind: "video" | "image"; src: string; from?: number; rate?: number }
  | { id: string; kind: "model"; src: string; animations: string[]; show: ModelShow; from?: number; rate?: number }
  | { id: string; kind: "stream"; stream: MediaStream; from?: number; rate?: number };

export class MediaFeed {
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private texture: WebGLTexture | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private fed: Fed | null = null;
  private failed = false;
  /** The models' stage (three.js), made the first time one's shown and kept. */
  private stage: Promise<ModelStage> | null = null;
  private stageNow: ModelStage | null = null;
  /** A frame of the clip, small, to see its background by. */
  private readonly small = document.createElement("canvas");
  /** Frames it has fed (for the tests). */
  frames = 0;

  /** `brake`: shared by the feeds into one picture (a screen's and the clips': they pile up in it together). */
  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly brake = new Brake(),
  ) {}

  /**
   * What it feeds: a clip or picture's URL (`kind`), a screen's stream, or nothing. A clip plays muted, looping, from
   * `from` seconds in.
   */
  show(media: FedMedia | null): void {
    const same = media?.id === this.fed?.id && (media?.kind !== "stream" || (this.fed?.el as HTMLVideoElement).srcObject === media.stream);
    if (same) {
      if (media && this.fed?.el instanceof HTMLVideoElement && !this.fed.live && media.rate) this.fed.el.playbackRate = media.rate;
      if (media?.kind === "model") this.stageNow?.setPalette(media.show.palette);
      return;
    }
    this.release();
    if (!media) return;
    const live = media.kind === "stream";
    const el = media.kind === "image" ? new Image() : media.kind === "model" ? document.createElement("canvas") : document.createElement("video");
    const fed: Fed = { id: media.id, el, live, model: media.kind === "model", width: 0, height: 0, loaded: false, taken: -1, backdrop: null, looked: 0 };
    if (media.kind === "model") {
      // Drawn by its stage: fed once it's up (nothing until then).
      const { width, height } = this.gl.canvas;
      this.stage ??= import("./model-stage").then((m) => (this.stageNow = new m.ModelStage(Math.round(width * MODEL_SCALE), Math.round(height * MODEL_SCALE))));
      void this.stage
        .then(async (stage) => {
          await stage.load(media.src, media.animations, media.show);
          if (this.fed !== fed) return;
          fed.el = stage.canvas;
          fed.width = stage.canvas.width;
          fed.height = stage.canvas.height;
        })
        .catch((err) => logger.warn(`couldn't show the model ${media.id}: ${errorMessage(err)}`));
    } else if (media.kind === "stream" && fed.el instanceof HTMLVideoElement) {
      const video = fed.el;
      video.muted = true;
      video.playsInline = true;
      // (Its size changes when the window shared is resized.)
      const sized = () => {
        fed.width = video.videoWidth;
        fed.height = video.videoHeight;
      };
      video.addEventListener("loadedmetadata", () => {
        sized();
        void video.play().catch(() => {});
      });
      video.addEventListener("resize", sized);
      video.srcObject = media.stream;
    } else if (media.kind === "video" && fed.el instanceof HTMLVideoElement) {
      const video = fed.el;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "auto";
      video.crossOrigin = "anonymous";
      video.playbackRate = media.rate ?? 1;
      video.addEventListener("loadedmetadata", () => {
        fed.width = video.videoWidth;
        fed.height = video.videoHeight;
        if (media.from && Number.isFinite(video.duration)) video.currentTime = media.from % Math.max(1, video.duration);
        void video.play().catch(() => {});
      });
      video.src = media.src;
    } else if (media.kind === "image" && fed.el instanceof HTMLImageElement) {
      const img = fed.el;
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => {
        fed.width = img.naturalWidth;
        fed.height = img.naturalHeight;
      };
      img.src = media.src;
    }
    this.fed = fed;
  }

  /** The clip or picture fed, if any. */
  get showing(): string | null {
    return this.fed?.id ?? null;
  }

  /** Slow motion: the clip plays at `rate` (the picture's pace). */
  setRate(rate: number): void {
    if (this.fed?.el instanceof HTMLVideoElement && !this.fed.live && this.fed.el.playbackRate !== rate) this.fed.el.playbackRate = rate;
  }

  /**
   * The clip into the frame Butterchurn just drew (its next frame warps it in) and on top of what it showed, as `mix`
   * says for `hit` into a kick over `seconds`; less of both while the picture (`canvas`: given to one feed of a picture's)
   * is turning white or pale, and `fade` of it (0..1: a clip coming in over a screen). Whether it did.
   */
  feed(renderer: ButterchurnRenderer, mix: MediaMix, hit: number, seconds: number, canvas?: HTMLCanvasElement, fade = 1): boolean {
    if (canvas && this.frames % MEASURE_EVERY === 0) this.brake.measure(canvas);
    // (Away: it keeps playing, ready to come in, but nothing's painted.)
    if (fade <= 0) return false;
    const fed = this.fed;
    if (!fed || this.failed || !fed.width || !fed.height) return false;
    const gl = this.gl;
    if (!this.program && !this.build()) return false;
    // A model's frame drawn now (its animation by the picture's clock, punched in on the kick, reflecting the look).
    if (fed.model) this.stageNow?.render(seconds, hit, this.gl.canvas as HTMLCanvasElement);
    if (!this.upload(fed)) return false;
    const every = fed.looked < BACKDROP_FIRST.times ? BACKDROP_FIRST.every : BACKDROP_EVERY;
    if (!fed.live && !fed.model && (!fed.backdrop || (fed.el instanceof HTMLVideoElement && this.frames % every === 0))) {
      // (Once its background's been seen as flat it stays so unless it's clearly not: a dancer crossing it is no change.)
      fed.backdrop = this.backdropOf(fed) ?? fed.backdrop;
      fed.looked++;
    }
    const frameAspect = renderer.texsizeX / renderer.texsizeY;
    const mediaAspect = fed.width / fed.height;
    const keyed = fed.backdrop?.flat ?? false;
    // A screen floats at its own shape, all of it (a 16:9 one fills the frame): its edges are where its picture is.
    // A model's stage is the frame's shape (it's placed in it, and punched in, by its stage).
    const place = fed.live ? "float" : fed.model ? "fill" : placementOf(mediaAspect, frameAspect);
    // Punched in a little on each kick.
    const punch = fed.model ? 1 : 1 + 0.06 * Math.max(0, Math.min(1, hit));
    // Filling the frame, kept to its shape: the wider of the two shows less of its width.
    const fit = mediaAspect > frameAspect ? [frameAspect / mediaAspect, 1] : [1, mediaAspect / frameAspect];
    const zoom = fed.model ? 1 : Math.max(1, mix.zoom) * punch;
    const contain = mediaAspect > frameAspect ? [1, frameAspect / mediaAspect] : [mediaAspect / frameAspect, 1];
    const size = (fed.live ? contain : floatSize(mediaAspect, frameAspect, mix.size)).map((v) => v * punch);
    // On a background taken out, its light is all of it (what's left is the subject). On top, footage shows only its
    // light or its edges: the look shows through its darks (all of it on top would hide the look).
    // A pale clip whose background can't be taken out washes the look out: only its outlines.
    // A model is all subject, like a clip whose background's taken out.
    const subject = keyed || fed.model;
    const pale = !subject && (fed.backdrop?.light ?? 0) > PALE;
    const into = pale ? "edges" : subject && mix.mode === "light" ? "whole" : mix.mode;
    // A screen as it is (it's read as itself: its panels, its text), the look showing through as much as it isn't.
    const onTop = fed.live ? mix.mode : pale ? "edges" : subject ? (mix.mode === "edges" ? "edges" : "whole") : mix.mode === "whole" ? "light" : mix.mode;
    const gain = this.brake.gain * Math.max(0, Math.min(1, fade));
    const blend = gl.getParameter(gl.BLEND) as boolean;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Butterchurn binds sampler objects of its own (mipmapped) to its units: one there makes this texture black.
    const sampler = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
    gl.bindSampler(0, null);
    gl.uniform1i(this.uniforms.media, 0);
    gl.uniform1i(this.uniforms.place, place === "fill" ? 0 : 1);
    gl.uniform2f(this.uniforms.fit, fit[0] / zoom, fit[1] / zoom);
    gl.uniform2f(this.uniforms.size, size[0], size[1]);
    gl.uniform1i(this.uniforms.keyed, keyed ? 1 : 0);
    gl.uniform1i(this.uniforms.boxed, fed.live ? 1 : 0);
    gl.uniform1i(this.uniforms.cutout, fed.model ? 1 : 0);
    const bg = fed.backdrop?.color ?? [0, 0, 0];
    gl.uniform3f(this.uniforms.bg, bg[0], bg[1], bg[2]);
    gl.uniform2f(this.uniforms.texel, 1.5 / fed.width, 1.5 / fed.height);
    gl.uniform1f(this.uniforms.saturation, mix.saturation);
    gl.uniform1f(this.uniforms.bright, BRIGHT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    const pass = (target: WebGLFramebuffer | null, width: number, height: number, mode: string, amount: number, key: readonly number[]) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      gl.viewport(0, 0, width, height);
      gl.uniform2f(this.uniforms.key, key[0], key[1]);
      gl.uniform1f(this.uniforms.amount, Math.min(1, amount * gain));
      gl.uniform1i(this.uniforms.mode, mode === "light" ? 1 : mode === "edges" ? 2 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    // Into the feedback (the next frame warps it in), then on top of what was shown.
    pass(renderer.targetFrameBuffer, renderer.texsizeX, renderer.texsizeY, into, amountOver(mix, hit, seconds), mix.key);
    // Footage on top: less of it, and only its brighter light (all of a frame's mids on top wash the look pale).
    const footage = !subject && !fed.live && onTop === "light";
    pass(null, gl.drawingBufferWidth, gl.drawingBufferHeight, onTop, shownAt(mix, hit) * (subject || fed.live ? 1 : FOOTAGE_ON_TOP), footage ? [0.4, 0.85] : mix.key);
    // Butterchurn's state as it left it (it sets the rest itself each frame).
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindSampler(0, sampler);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (!blend) gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.frames++;
    return true;
  }

  /** How much it's holding back for the picture's sake (1: none). */
  get gain(): number {
    return this.brake.gain;
  }

  /** How the clip fed is placed: its background taken out or not (null: nothing fed, or not looked at yet). */
  get keyed(): boolean | null {
    if (this.fed?.model) return true;
    return this.fed?.backdrop ? this.fed.backdrop.flat : null;
  }

  /** The clip's background, from a small copy of its frame now. */
  private backdropOf(fed: Fed): Backdrop | null {
    const width = 32;
    const height = Math.max(8, Math.round(width / (fed.width / fed.height)));
    this.small.width = width;
    this.small.height = height;
    const ctx = this.small.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    try {
      ctx.drawImage(fed.el, 0, 0, width, height);
      return backdropOf(ctx.getImageData(0, 0, width, height).data, width, height, fed.backdrop);
    } catch {
      return null;
    }
  }

  /** Its frame on the GPU: a picture once, a clip whenever it has moved on. */
  private upload(fed: Fed): boolean {
    const gl = this.gl;
    const video = fed.el instanceof HTMLVideoElement ? fed.el : null;
    if (video && video.readyState < 2) return fed.loaded;
    if (fed.loaded && !fed.model && (!video || video.currentTime === fed.taken)) return true;
    const flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fed.el);
    } catch {
      // (Not loaded yet, or a picture the GPU may not read: tried again next frame.)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
      return fed.loaded;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
    gl.bindTexture(gl.TEXTURE_2D, null);
    fed.loaded = true;
    fed.taken = video ? video.currentTime : 0;
    return true;
  }

  private build(): boolean {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
      return shader;
    };
    try {
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.bindAttribLocation(program, 0, "corner");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "program");
      this.program = program;
      for (const name of ["media", "place", "fit", "size", "texel", "amount", "mode", "key", "keyed", "boxed", "cutout", "bg", "saturation", "bright"]) this.uniforms[name] = gl.getUniformLocation(program, name);
      // Its own vertex array: Butterchurn's attributes are left alone.
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  private release(): void {
    const el = this.fed?.el;
    if (el instanceof HTMLVideoElement) {
      el.pause();
      // (A screen's stream is its sharer's to stop: only let go of here.)
      el.srcObject = null;
      el.removeAttribute("src");
      el.load();
    }
    this.fed = null;
  }

  dispose(): void {
    this.release();
    void this.stage?.then((stage) => stage.dispose(), () => {});
    this.stage = null;
    this.stageNow = null;
  }
}
