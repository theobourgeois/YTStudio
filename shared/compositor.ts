/**
 * The renderer: one WebGL 2 compositor draws every picture the app shows,
 * so the preview, the transition library's thumbnails and the export (in a
 * headless browser the server drives, see `server/gl-browser.ts`) look the
 * same, pixel for pixel.
 *
 * A frame is built up in an offscreen buffer, bottom layer first:
 * - `drawPicture` puts a stored picture where its Motion puts it (an affine
 *   map, see `placementAffine`), faded by its Opacity, over what's there.
 *   Its edges are antialiased, so rotated and scaled pictures look smooth.
 * - `drawTransition` draws each side of a transition into a canvas-sized layer
 *   the same way, mixes the two with the transition's shader
 *   (`transition-gl.ts`) and puts the result over what's there.
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

/** A stored picture (by key) placed on the canvas. */
export interface Placed {
  key: string;
  affine: Affine;
  opacity: number;
}

export interface Shader {
  key: string;
  source: string;
}

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
  /** Draw a stored picture over the frame (nothing if it isn't stored). */
  drawPicture(picture: Placed): void;
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
  const PICTURE_VS = `#version 300 es
in vec2 aPos;
uniform mat3 uMatrix;
uniform vec2 uMargin;
out vec2 vTex;
void main() {
  vTex = aPos * (1.0 + 2.0 * uMargin) - uMargin;
  vec3 p = uMatrix * vec3(vTex, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;
  // `uPixels`: output px per picture fraction along u and v, for the edge
  // coverage. A YUV picture has its planes in uSrc (Y), uU and uV, and its
  // matrix's red and blue luma weights in uK.
  const PICTURE_FS = `#version 300 es
precision highp float;
in vec2 vTex;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform sampler2D uU;
uniform sampler2D uV;
uniform bool uYuv;
uniform vec2 uK;
uniform float uOpacity;
uniform vec2 uPixels;
vec4 pictureAt(vec2 t) {
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
  vec2 edge = clamp(min(vTex, 1.0 - vTex) * uPixels + 0.5, 0.0, 1.0);
  vec4 c = pictureAt(clamp(vTex, 0.0, 1.0));
  fragColor = vec4(c.rgb * c.a, c.a) * (uOpacity * edge.x * edge.y);
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

  const pictureProgram = link(PICTURE_VS, PICTURE_FS);
  const copyProgram = link(QUAD_VS, COPY_FS);
  let yuvProgram: ReturnType<typeof link> | null = null;
  const transitions = new Map<string, ReturnType<typeof link>>();

  const texture = () => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  // Canvas-sized render targets: the frame being built, and the two sides of a transition.
  const target = () => ({ tex: texture(), fbo: gl.createFramebuffer()! });
  const frame = target();
  const sides = [target(), target()];
  // Where `readYuv420` packs the frame (sized on first use).
  const yuv = { ...target(), width: 0, height: 0 };
  let width = 0;
  let height = 0;

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

  /** Draw a picture into the bound framebuffer (blending as currently set). */
  const place = (p: Placed) => {
    const pic = pictures.get(p.key);
    if (!pic || !(p.opacity > 0)) return;
    const [a, b, c, d, e, f] = p.affine;
    // Output px per picture fraction along each of its axes.
    const pu = Math.hypot(a * width, b * height);
    const pv = Math.hypot(c * width, d * height);
    if (!(pu > 1e-6 && pv > 1e-6)) return;
    // Mipmaps keep a big picture drawn small from shimmering.
    const shrunk = pic.width > pu * 1.5 || pic.height > pv * 1.5;
    // All three units are bound (an RGBA picture's U and V to nothing): a sampler
    // left on a texture that's being drawn into would make the draw fail.
    for (let i = 0; i < 3; i++) {
      const tex = pic.textures[i] ?? null;
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (!tex) continue;
      if (shrunk && !pic.mipmapped) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, shrunk ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    }
    if (shrunk) pic.mipmapped = true;
    // Canvas fractions (y down) -> clip space (y up), column-major.
    const matrix = new Float32Array([2 * a, -2 * b, 0, 2 * c, -2 * d, 0, 2 * e - 1, 1 - 2 * f, 1]);
    const { program, loc } = pictureProgram;
    gl.useProgram(program);
    gl.uniformMatrix3fv(loc("uMatrix"), false, matrix);
    gl.uniform2f(loc("uMargin"), Math.min(1, 1 / pu), Math.min(1, 1 / pv));
    gl.uniform2f(loc("uPixels"), pu, pv);
    gl.uniform1i(loc("uSrc"), 0);
    gl.uniform1i(loc("uU"), 1);
    gl.uniform1i(loc("uV"), 2);
    gl.uniform1i(loc("uYuv"), pic.yuv ? 1 : 0);
    if (pic.yuv) gl.uniform2f(loc("uK"), pic.yuv[0], pic.yuv[1]);
    gl.uniform1f(loc("uOpacity"), Math.min(1, p.opacity));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
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

  const bind = (t: { fbo: WebGLFramebuffer } | null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, width, height);
  };
  const blendOver = () => {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };

  /** Pack the frame as YUV 4:2:0 into `yuv` (left bound, for reading). */
  const packYuv = () => {
    if (width % 8 !== 0 || height % 2 !== 0) throw new Error(`Can't pack a ${width}x${height} frame as YUV 4:2:0.`);
    const w = width / 4;
    const h = height + height / 2;
    if (yuv.width !== w || yuv.height !== h) {
      yuv.width = w;
      yuv.height = h;
      gl.bindTexture(gl.TEXTURE_2D, yuv.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, yuv.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, yuv.tex, 0);
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
      for (const { tex, fbo } of [frame, ...sides]) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      }
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
      bind(frame);
      blendOver();
      place(picture);
      gl.disable(gl.BLEND);
    },

    drawTransition(shader, uniforms, progress, from, to) {
      // Each side into its own transparent layer.
      [from, to].forEach((side, i) => {
        bind(sides[i]);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (side) {
          blendOver();
          place(side);
          gl.disable(gl.BLEND);
        }
      });

      let entry = transitions.get(shader.key);
      if (!entry) {
        entry = link(QUAD_VS, shader.source);
        transitions.set(shader.key, entry);
      }
      const { program, loc } = entry;
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
      for (const u of uniforms) {
        const l = loc(u.name);
        if (!l) continue;
        if (u.type === "int") gl.uniform1i(l, u.value as number);
        else if (u.type === "vec2") gl.uniform2f(l, (u.value as number[])[0], (u.value as number[])[1]);
        else gl.uniform1f(l, u.value as number);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
    },

    present(opts = {}) {
      bind(null);
      gl.disable(gl.BLEND);
      const { program, loc } = copyProgram;
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frame.tex);
      gl.uniform1i(loc("uSrc"), 0);
      gl.uniform1i(loc("uFlipY"), opts.flipY ? 1 : 0);
      gl.uniform1i(loc("uStraight"), opts.straight ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
      for (const { program } of transitions.values()) gl.deleteProgram(program);
      if (yuvProgram) gl.deleteProgram(yuvProgram.program);
      for (const b of idleBuffers) gl.deleteBuffer(b);
      idleBuffers.length = 0;
      channel?.port1.close();
      transitions.clear();
      gl.deleteProgram(pictureProgram.program);
      gl.deleteProgram(copyProgram.program);
      for (const key of [...pictures.keys()]) deletePicture(key);
      for (const { tex, fbo } of [frame, ...sides, yuv]) {
        gl.deleteTexture(tex);
        gl.deleteFramebuffer(fbo);
      }
      gl.deleteBuffer(quad);
    },
  };
}
