/**
 * The user's clips and pictures fed into MilkDrop's feedback (docs/now-playing.md, "Your media"): after each frame of
 * Butterchurn's, a little of the clip is painted into the frame it just drew, which the next frame warps (zooms,
 * swirls, smears) like everything else in it. So the clip is never shown on top: it's paint the preset moves, a
 * little more each frame, the old carried off. How much and which of it (`MediaMix`: all of it, only its light, only
 * its edges) is the music's (`media-mix.ts`). Drawn with Butterchurn's own WebGL context, into its own buffer, leaving
 * its state as it was.
 */
import type { ButterchurnRenderer } from "butterchurn";
import type { MediaMix } from "./media-mix";

const VERTEX = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() {
  uv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

/**
 * The clip, filling the frame (`fit`: how much of its width and height it shows, kept to its shape, and `zoom`d), as
 * much of it as the mode lets through: all of it, its light (dark parts let the preset's black through), or its edges
 * (outlines that glow); its colours a little richer.
 */
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D media;
uniform vec2 fit;
uniform vec2 texel;
uniform float amount;
uniform int mode;
uniform vec2 key;
uniform float saturation;
uniform float bright;
out vec4 color;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 at(vec2 p) { return texture(media, p).rgb; }
void main() {
  vec2 p = (uv - 0.5) * fit + 0.5;
  vec3 c = at(p);
  float l = luma(c);
  float keep = 1.0;
  if (mode == 1) keep = smoothstep(key.x, key.y, l);
  else if (mode == 2) {
    float tl = luma(at(p + texel * vec2(-1, 1))), t = luma(at(p + texel * vec2(0, 1))), tr = luma(at(p + texel * vec2(1, 1)));
    float ml = luma(at(p + texel * vec2(-1, 0))), mr = luma(at(p + texel * vec2(1, 0)));
    float bl = luma(at(p + texel * vec2(-1, -1))), b = luma(at(p + texel * vec2(0, -1))), br = luma(at(p + texel * vec2(1, -1)));
    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
    keep = smoothstep(key.x, key.y, length(vec2(gx, gy)));
    // Its outlines as light, in its own colours.
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

  /** How much of the clip goes in (0.1..1). */
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
    // (Washed out, as much as blown out: pale pictures are what Théo bins.)
    this.value = mean > 0.5 || whiteShare > 0.12 ? Math.max(0.1, this.value * 0.6) : Math.min(1, this.value * 1.1);
  }
}

/** What's being fed: a clip or a picture, and its texture. */
interface Fed {
  id: string;
  el: HTMLVideoElement | HTMLImageElement;
  width: number;
  height: number;
  /** A frame of it is on the GPU. */
  loaded: boolean;
  /** The video's time when its frame was last taken (a new one is taken when it moves on). */
  taken: number;
}

export class MediaFeed {
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private texture: WebGLTexture | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private fed: Fed | null = null;
  private failed = false;
  private readonly brake = new Brake();
  /** Frames it has fed (for the tests). */
  frames = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** What it feeds: a clip or picture's URL (`kind`), or nothing. A clip plays muted, looping, from `from` seconds in. */
  show(media: { id: string; src: string; kind: "video" | "image"; from?: number; rate?: number } | null): void {
    if (media?.id === this.fed?.id) {
      if (media && this.fed?.el instanceof HTMLVideoElement && media.rate) this.fed.el.playbackRate = media.rate;
      return;
    }
    this.release();
    if (!media) return;
    const fed: Fed = { id: media.id, el: media.kind === "video" ? document.createElement("video") : new Image(), width: 0, height: 0, loaded: false, taken: -1 };
    if (fed.el instanceof HTMLVideoElement) {
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
    } else {
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
    if (this.fed?.el instanceof HTMLVideoElement && this.fed.el.playbackRate !== rate) this.fed.el.playbackRate = rate;
  }

  /**
   * Paint `amount` of it into the frame Butterchurn just drew (its next frame warps it in), less while the picture
   * (`canvas`) is turning white. Whether it did.
   */
  feed(renderer: ButterchurnRenderer, mix: MediaMix, amount: number, canvas?: HTMLCanvasElement): boolean {
    if (canvas && this.frames % MEASURE_EVERY === 0) this.brake.measure(canvas);
    amount *= this.brake.gain;
    const fed = this.fed;
    if (!fed || this.failed || amount <= 0 || !fed.width || !fed.height) return false;
    const gl = this.gl;
    if (!this.program && !this.build()) return false;
    if (!this.upload(fed)) return false;
    const frameAspect = renderer.texsizeX / renderer.texsizeY;
    const mediaAspect = fed.width / fed.height;
    // Filling the frame, kept to its shape: the wider of the two shows less of its width.
    const fit = mediaAspect > frameAspect ? [frameAspect / mediaAspect, 1] : [1, mediaAspect / frameAspect];
    const zoom = Math.max(1, mix.zoom);
    const blend = gl.getParameter(gl.BLEND) as boolean;
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.targetFrameBuffer);
    gl.viewport(0, 0, renderer.texsizeX, renderer.texsizeY);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Butterchurn binds sampler objects of its own (mipmapped) to its units: one there makes this texture black.
    const sampler = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
    gl.bindSampler(0, null);
    gl.uniform1i(this.uniforms.media, 0);
    gl.uniform2f(this.uniforms.fit, fit[0] / zoom, fit[1] / zoom);
    gl.uniform2f(this.uniforms.texel, 1.5 / fed.width, 1.5 / fed.height);
    gl.uniform1f(this.uniforms.amount, Math.min(1, amount));
    gl.uniform1i(this.uniforms.mode, mix.mode === "light" ? 1 : mix.mode === "edges" ? 2 : 0);
    gl.uniform2f(this.uniforms.key, mix.key[0], mix.key[1]);
    gl.uniform1f(this.uniforms.saturation, mix.saturation);
    gl.uniform1f(this.uniforms.bright, BRIGHT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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

  /** Its frame on the GPU: a picture once, a clip whenever it has moved on. */
  private upload(fed: Fed): boolean {
    const gl = this.gl;
    const video = fed.el instanceof HTMLVideoElement ? fed.el : null;
    if (video && video.readyState < 2) return fed.loaded;
    if (fed.loaded && (!video || video.currentTime === fed.taken)) return true;
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
      for (const name of ["media", "fit", "texel", "amount", "mode", "key", "saturation", "bright"]) this.uniforms[name] = gl.getUniformLocation(program, name);
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
      el.removeAttribute("src");
      el.load();
    }
    this.fed = null;
  }

  dispose(): void {
    this.release();
  }
}
