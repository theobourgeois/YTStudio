/**
 * The Shader effect's code (the visualizer, docs/visualizer/README.md, V6): GLSL the user (or the
 * assistant) writes, in one of three dialects, turned into a video effect's fragment shader with its
 * parameters declared in the code.
 *
 * - `native`: ours, the same `vec4 effect(vec2 uv)` as every built-in effect (`effect-prelude.ts`), with
 *   parameters declared in comments: `// @param amount number 0 1 0.5 "Amount"`.
 * - `isf`: the Interactive Shader Format: a JSON header (`/*{ "INPUTS": [...] }*\/`) declares the
 *   parameters, `main` writes `gl_FragColor`, `IMG_THIS_PIXEL(inputImage)` reads the clip, `TIME` and
 *   `RENDERSIZE`; `audio` and `audioFFT` inputs hear the sound.
 * - `shadertoy`: `mainImage(out vec4 fragColor, in vec2 fragCoord)` with `iTime`, `iResolution`...;
 *   `iChannel0` is Shadertoy's 512×2 sound texture (the spectrum on row 0, the waveform on row 1),
 *   `iChannel1` the clip's picture (`// @iChannel0 input` changes either). `// @param` lines work too.
 *
 * Pure: parsing never compiles (the tab checks compiles, `src/lib/shader-compiler.ts`; the export's page
 * refuses what doesn't). User code is put after `#line 1 1`, so a compiler's log names the user's own
 * lines on source string 1 (`compileProblems` reads it back). Each shader is keyed by a hash of its code,
 * so any number of them can be drawn side by side.
 */
import type { AudioRequest } from "./compositor.ts";
import { AUDIO_PRELUDE, MAIN, PRELUDE, RESERVED_AUDIO_UNIFORMS, RESERVED_EFFECT_UNIFORMS } from "./effect-prelude.ts";
import { clamp, isFiniteNumber, tidy } from "./math.ts";
import type { BooleanSpec, ChoiceSpec, ColorSpec, NumberSpec, ParamSpec, SourceSpec, Vec2Spec } from "./params.ts";
import { type UniformSpec, type UniformValue, paramUniforms } from "./transition-gl.ts";
import type { ParamValues, ShaderCode, ShaderDialect } from "./types.ts";

export const SHADER_DIALECTS: readonly ShaderDialect[] = ["native", "isf", "shadertoy"];

export const DIALECT_LABELS: Record<ShaderDialect, string> = { native: "GLSL", isf: "ISF", shadertoy: "Shadertoy" };

/** The longest a shader's code can be (characters). */
export const MAX_SHADER_CODE = 64 * 1024;

/** Most parameters a shader declares. */
export const MAX_SHADER_PARAMS = 32;

/** What's wrong with a shader: on one of the user's lines (from 1), or in general (`line` null). */
export interface ShaderProblem {
  line: number | null;
  message: string;
}

/** The moment a shader draws: its clip's source time, the time since the clip started, the frame rate. */
export interface ShaderClock {
  time: number;
  clipTime: number;
  fps: number;
}

/** A shader's code read: everything an effect definition needs, and what's wrong with it before compiling. */
export interface ParsedShader {
  /** The compositor's key for it: `fx:shader:<hash of the code>`. */
  key: string;
  /** Its own name (`// @name "..."`), if it gives one. */
  label: string | null;
  params: ParamSpec[];
  /** The complete fragment shader. */
  source: string;
  /** Its parameters' values and the moment as its uniforms. */
  uniforms: (values: ParamValues, clock: ShaderClock) => UniformValue[];
  /** What it hears, when it reads the sound (it then has a `source` parameter). */
  audio: AudioRequest | null;
  /** Reads the time, so it changes by itself. */
  animated: boolean;
  passes: number;
  grow: number;
  /** Declarations that are wrong (the shader still compiles without them, or doesn't). */
  problems: ShaderProblem[];
  /** What works differently here than where the code came from (an ISF image input with nothing to read...). */
  notes: string[];
}

/** A shader's code from untrusted storage, or undefined when it isn't one. */
export function normalizeShaderCode(raw: unknown): ShaderCode | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { code, dialect } = raw as Partial<ShaderCode>;
  if (typeof code !== "string" || code.length > MAX_SHADER_CODE) return undefined;
  return { code: code.replace(/\r\n?/g, "\n"), dialect: SHADER_DIALECTS.includes(dialect as ShaderDialect) ? (dialect as ShaderDialect) : "native" };
}

/** A 64-bit hash of a shader's code (cyrb53, twice), in hex: the same code always gets the same key. */
export function shaderHash({ code, dialect }: ShaderCode): string {
  const text = `${dialect}\n${code}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Reading the code
// ---------------------------------------------------------------------------

/** The code without its comments (same length and lines), for finding what it uses. */
export function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, " "));
}

/** The user's code ready to follow a prelude: `#version` lines blanked (the prelude has one), so lines keep their numbers. */
const withoutVersion = (code: string) => code.replace(/^[ \t]*#[ \t]*version\b[^\n]*/gm, "");

const uses = (code: string, ...names: string[]) => names.some((n) => new RegExp(`\\b${n}\\b`).test(code));

/** `amountOfLight` -> "Amount Of Light", `glow_size` -> "Glow Size". */
export function humanise(key: string): string {
  const words = key
    .replace(/_+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || key;
}

const GLSL_WORDS = new Set(
  (
    "attribute const uniform varying layout centroid flat smooth break continue do for while switch case default if else in out inout " +
    "float int void bool true false invariant discard return mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 " +
    "vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 lowp mediump highp precision sampler2D sampler3D samplerCube " +
    "sampler2DShadow samplerCubeShadow sampler2DArray sampler2DArrayShadow isampler2D isampler3D isamplerCube isampler2DArray usampler2D " +
    "usampler3D usamplerCube usampler2DArray struct main texture texelFetch textureLod textureSize sample filter input output class union " +
    "enum typedef template this goto inline noinline volatile public static extern external interface long short double half fixed unsigned"
  ).split(" "),
);

/** Names a shader's own prelude (`native`) defines: helpers and the audio functions. */
const NATIVE_NAMES = [
  ...RESERVED_EFFECT_UNIFORMS,
  ...RESERVED_AUDIO_UNIFORMS,
  "PI",
  "inside",
  "ease",
  "easeIn",
  "easeOut",
  "hash",
  "hash2",
  "noise",
  "fbm",
  "rot",
  "luma",
  "dirVec",
  "toUv",
  "aspect",
  "mirrored",
  "getColor",
  "getColorOrClear",
  "getInput",
  "frameUv",
  "unpremultiply",
  "withRgb",
  "effect",
  "spectrumRow",
  "spectrum",
  "spectrumAgo",
  "wave",
];

const SHADERTOY_NAMES = [
  "iResolution",
  "iTime",
  "iTimeDelta",
  "iFrame",
  "iFrameRate",
  "iMouse",
  "iDate",
  "iSampleRate",
  "iChannel0",
  "iChannel1",
  "iChannel2",
  "iChannel3",
  "iChannelResolution",
  "iChannelTime",
  "mainImage",
];

const ISF_NAMES = ["TIME", "TIMEDELTA", "FRAMEINDEX", "DATE", "PASSINDEX", "RENDERSIZE", "isf_FragNormCoord", "isf_FragColor", "vv_FragNormCoord"];

/** The prelude names every dialect shares (the compositor sets some of them by name). */
const SHARED_NAMES = ["vUv", "fragColor", "uSrc", "uInput", "uResolution", "uFrame", "uFlipY", "source", ...RESERVED_AUDIO_UNIFORMS];

/** Why `key` can't name a parameter of a shader in `dialect`, or null when it can. */
function badKey(key: string, dialect: ShaderDialect): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `"${key}" isn't a name GLSL takes (letters, digits and _, not starting with a digit)`;
  if (key.length > 40) return `"${key}" is too long (40 characters at most)`;
  if (key.startsWith("gl_") || key.startsWith("_vz") || key.includes("__")) return `"${key}" is a name GLSL keeps for itself`;
  if (GLSL_WORDS.has(key)) return `"${key}" is a GLSL word`;
  const taken = [...SHARED_NAMES, ...(dialect === "native" ? NATIVE_NAMES : dialect === "isf" ? ISF_NAMES : SHADERTOY_NAMES)];
  if (key === "source") return `"source" is the parameter that says what it listens to`;
  if (taken.includes(key)) return `"${key}" is already defined for every shader`;
  return null;
}

/** A number spec for `min`..`max`: steps and decimals that suit its range. */
function numberSpec(key: string, label: string, min: number, max: number, value: number, integer = false): NumberSpec {
  const range = max - min;
  const step = integer ? 1 : range <= 0 ? 0.01 : 10 ** Math.floor(Math.log10(range / 100));
  const decimals = integer ? 0 : Math.max(0, Math.min(4, -Math.floor(Math.log10(step))));
  return { kind: "number", key, label, default: tidy(clamp(value, min, max)), min, max, step, decimals, slider: Number.isFinite(range) && range > 0 && range <= 1000 };
}

/** A point on the clip's frame (fractions, y down: `toUv` turns it into uv), like a Center parameter. */
const pointSpec = (key: string, label: string, value: [number, number]): Vec2Spec => ({
  kind: "vec2",
  key,
  label,
  default: value,
  space: "media",
  min: -10,
  max: 10,
  step: 1,
  decimals: 1,
});

/** One `// @directive args` line. */
interface Directive {
  name: string;
  args: string[];
  /** The last quoted argument, a label. */
  label: string | null;
  line: number;
}

/** The `// @name args` lines of the code, in order. */
function directives(code: string): Directive[] {
  const found: Directive[] = [];
  code.split("\n").forEach((text, i) => {
    const m = /^\s*\/\/\s*@([A-Za-z]\w*)\b(.*)$/.exec(text);
    if (!m) return;
    const args: string[] = [];
    let label: string | null = null;
    for (const t of m[2].matchAll(/"([^"]*)"|(\S+)/g)) {
      if (t[1] !== undefined) label = t[1].trim().slice(0, 60);
      else args.push(t[2]);
    }
    found.push({ name: m[1], args, label, line: i + 1 });
  });
  return found;
}

/** A parameter from `// @param key kind ...` (see the top of this file), or a problem. */
function declaredParam(d: Directive, dialect: ShaderDialect): ParamSpec | string {
  const [key, kindWord, ...rest] = d.args;
  if (!key) return "`@param` needs a name and a kind, like `// @param amount number 0 1 0.5`";
  const bad = badKey(key, dialect);
  if (bad) return bad;
  const label = d.label ?? humanise(key);
  const kind = (kindWord ?? "").toLowerCase();
  const nums = rest.map(Number);
  switch (kind) {
    case "number":
    case "float":
    case "int": {
      if (nums.some((n) => !Number.isFinite(n))) return `${key}: a number's range and default are numbers, like \`${key} number 0 1 0.5\``;
      const [min, max, value] = nums.length >= 2 ? nums : [0, 1, nums[0] ?? 0];
      if (!(min < max)) return `${key}: its minimum must be less than its maximum`;
      return numberSpec(key, label, min, max, value ?? min, kind === "int");
    }
    case "bool":
    case "boolean":
      if (rest[0] !== undefined && rest[0] !== "true" && rest[0] !== "false") return `${key}: a switch is true or false`;
      return { kind: "boolean", key, label, default: rest[0] === "true" } satisfies BooleanSpec;
    case "choice": {
      const options = (rest[0] ?? "").split("|").map((o) => o.trim()).filter(Boolean);
      if (options.length < 2) return `${key}: a choice lists its options with |, like \`${key} choice Bars|Line|Dots\``;
      const value = rest[1] && options.includes(rest[1]) ? rest[1] : options[0];
      return { kind: "choice", key, label, default: value, options: options.map((o) => ({ value: o, label: o })) } satisfies ChoiceSpec;
    }
    case "point":
    case "vec2": {
      const [x = 0.5, y = 0.5] = nums;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return `${key}: a point is two numbers (fractions of the frame), like \`${key} point 0.5 0.5\``;
      return pointSpec(key, label, [tidy(clamp(x, -10, 10)), tidy(clamp(y, -10, 10))]);
    }
    case "color":
    case "colour": {
      const value = (rest[0] ?? "#ffffff").toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(value)) return `${key}: a colour is like #ff3d7f`;
      return { kind: "color", key, label, default: value } satisfies ColorSpec;
    }
    default:
      return `${key}: the kind is one of number, int, bool, choice, point or color`;
  }
}

const SOURCE: SourceSpec = { kind: "source", key: "source", label: "Listens To", default: "master" };

const HITS = { any: "onset", kicks: "onsetLow", snares: "onsetMid", hats: "onsetHigh" } as const;

/** The GLSL type of a uniform spec, as `uniformDeclarations` declares it. */
const glslType = (p: UniformSpec) => (p.kind === "choice" ? "int" : p.kind === "vec2" ? "vec2" : p.kind === "color" ? "vec3" : "float");

/** Declarations that say on which of the user's lines they were declared, so a compile error there points at it. */
const declaredAt = (decls: { line: number; text: string }[]) => decls.map((d) => `#line ${d.line} 1\n${d.text}`).join("\n");

/** The audio prelude with its functions renamed, for dialects whose code may define `wave` or `spectrum` of its own. */
const HIDDEN_AUDIO_PRELUDE = AUDIO_PRELUDE.replace(/\b(spectrumRow|spectrumAgo|spectrum|wave|spectrumBands)\b/g, "_vz_$1");

/** The common start of the ISF and Shadertoy dialects' shaders: no helpers, so their own `hash` or `noise` don't clash. */
const DIALECT_PRELUDE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 _vzOut;
uniform sampler2D uSrc;
uniform vec2 uResolution;
vec4 _vzPicture(vec2 uv) {
  vec4 c = texture(uSrc, uv);
  return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
}
`;

/** A linear spectrum (an FFT's bins up to `top` Hz) read from our log one; 0 where there's no sound. */
const linearSpectrum = (top: number) => `
float _vzLinearSpectrum(float x) {
  float hz = clamp(x, 0.0, 1.0) * ${top.toFixed(1)};
  return _vz_spectrum(log(max(hz, 20.0) / 20.0) / log(1000.0));
}
`;

/** The sound wave a shader reads, 0..1 around 0.5 as ISF and Shadertoy keep it. */
const AUDIO_WAVE = `
float _vzWave(float x, int channel) {
  vec2 w = _vz_wave(x);
  return (channel == 0 ? w.x : w.y) * 0.5 + 0.5;
}
`;

/** Read a native shader: its `@param` lines, `@name`, and what it uses. */
function parseNative(shader: ShaderCode, key: string): ParsedShader {
  const problems: ShaderProblem[] = [];
  const params: ParamSpec[] = [];
  const decls: { line: number; text: string }[] = [];
  const bare = stripComments(shader.code);
  let label: string | null = null;
  let passes = 1;
  let grow = 0;
  let fall = 0.1;
  let history = 2;
  let window = 0.05;
  let hits: AudioRequest["hits"] = "onset";
  let forceAudio = false;
  for (const d of directives(shader.code)) {
    const n = Number(d.args[0]);
    switch (d.name) {
      case "param": {
        const spec = declaredParam(d, "native");
        if (typeof spec === "string") problems.push({ line: d.line, message: spec });
        else if (params.some((p) => p.key === spec.key)) problems.push({ line: d.line, message: `${spec.key} is declared twice` });
        else if (params.length >= MAX_SHADER_PARAMS) problems.push({ line: d.line, message: `A shader has ${MAX_SHADER_PARAMS} parameters at most` });
        else {
          params.push(spec);
          decls.push({ line: d.line, text: `uniform ${glslType(spec as UniformSpec)} ${spec.key};` });
        }
        break;
      }
      case "name":
        label = d.label ?? (d.args.join(" ").slice(0, 60) || null);
        break;
      case "passes":
        if (Number.isInteger(n) && n >= 1 && n <= 8) passes = n;
        else problems.push({ line: d.line, message: "`@passes` is a whole number from 1 to 8" });
        break;
      case "grow":
        if (Number.isFinite(n) && n >= 0 && n <= 1) grow = n;
        else problems.push({ line: d.line, message: "`@grow` is the room past the frame, a fraction of its height from 0 to 1" });
        break;
      case "audio":
        forceAudio = true;
        break;
      case "fall":
        if (Number.isFinite(n) && n >= 0 && n <= 5) fall = n;
        else problems.push({ line: d.line, message: "`@fall` is how many seconds the spectrum takes to fall, 0 to 5" });
        forceAudio = true;
        break;
      case "history":
        if (Number.isFinite(n) && n > 0 && n <= 10) history = n;
        else problems.push({ line: d.line, message: "`@history` is how many seconds back spectrumAgo reaches, up to 10" });
        forceAudio = true;
        break;
      case "wave":
        if (Number.isFinite(n) && n > 0 && n <= 1) window = n;
        else problems.push({ line: d.line, message: "`@wave` is the waveform's window in seconds, up to 1" });
        forceAudio = true;
        break;
      case "hits": {
        const which = d.args[0] as keyof typeof HITS;
        if (which in HITS) hits = HITS[which];
        else problems.push({ line: d.line, message: "`@hits` is any, kicks, snares or hats" });
        forceAudio = true;
        break;
      }
      default:
        problems.push({ line: d.line, message: `There's no @${d.name}: use @param, @name, @passes, @grow, @audio, @fall, @history, @wave or @hits` });
    }
  }
  const hears = forceAudio || uses(bare, ...RESERVED_AUDIO_UNIFORMS.filter((n) => !n.startsWith("u")), "spectrum", "spectrumAgo", "wave");
  if (!/\bvec4\s+effect\s*\(\s*vec2\b/.test(bare)) problems.push({ line: null, message: "The code must define vec4 effect(vec2 uv): the colour at uv" });
  const audio: AudioRequest | null = hears
    ? { rows: uses(bare, "spectrumAgo") ? 64 : 1, span: uses(bare, "spectrumAgo") ? history : 0, fall, window: uses(bare, "wave") ? window : 0, hits }
    : null;
  const uniformSpecs = params as UniformSpec[];
  const source = `${PRELUDE}${audio ? AUDIO_PRELUDE : ""}\n${declaredAt(decls)}\n#line 1 1\n${withoutVersion(shader.code)}\n#line 1 2\n${MAIN}`;
  return {
    key,
    label,
    params: audio ? [...params, SOURCE] : params,
    source,
    uniforms: (values, clock) => [
      ...paramUniforms(uniformSpecs, values),
      { name: "time", type: "float", value: clock.time },
      { name: "clipTime", type: "float", value: clock.clipTime },
      { name: "fps", type: "float", value: clock.fps },
    ],
    audio,
    animated: uses(bare, "time", "clipTime"),
    passes,
    grow,
    problems,
    notes: [],
  };
}

/** What a Shadertoy channel reads: nothing, the sound (its 512×2 texture), or the clip's picture. */
type ChannelKind = "none" | "audio" | "input";
const CHANNEL_IDS: Record<ChannelKind, number> = { none: 0, audio: 1, input: 2 };

/** Read a Shadertoy shader: `mainImage`, its channels (`// @iChannel0 audio|input|none`) and `@param` lines. */
function parseShadertoy(shader: ShaderCode, key: string): ParsedShader {
  const problems: ShaderProblem[] = [];
  const notes: string[] = [];
  const params: ParamSpec[] = [];
  const decls: { line: number; text: string }[] = [];
  const bare = stripComments(shader.code);
  const channels: ChannelKind[] = ["audio", "input", "none", "none"];
  let label: string | null = null;
  for (const d of directives(shader.code)) {
    const channel = /^iChannel([0-3])$/.exec(d.name);
    if (channel) {
      const kind = d.args[0] as ChannelKind;
      if (kind in CHANNEL_IDS) channels[Number(channel[1])] = kind;
      else problems.push({ line: d.line, message: `@${d.name} is audio (the sound), input (the clip's picture) or none` });
    } else if (d.name === "param") {
      const spec = declaredParam(d, "shadertoy");
      if (typeof spec === "string") problems.push({ line: d.line, message: spec });
      else if (params.some((p) => p.key === spec.key)) problems.push({ line: d.line, message: `${spec.key} is declared twice` });
      else if (params.length >= MAX_SHADER_PARAMS) problems.push({ line: d.line, message: `A shader has ${MAX_SHADER_PARAMS} parameters at most` });
      else {
        params.push(spec);
        decls.push({ line: d.line, text: `uniform ${glslType(spec as UniformSpec)} ${spec.key};` });
      }
    } else if (d.name === "name") label = d.label ?? (d.args.join(" ").slice(0, 60) || null);
    else problems.push({ line: d.line, message: `There's no @${d.name} for a Shadertoy shader: use @param, @name or @iChannel0..3` });
  }
  if (!/\bvoid\s+mainImage\s*\(/.test(bare)) problems.push({ line: null, message: "The code must define void mainImage(out vec4 fragColor, in vec2 fragCoord)" });
  const read = channels.map((kind, i) => kind !== "none" && uses(bare, `iChannel${i}`));
  channels.forEach((kind, i) => {
    if (kind === "none" && uses(bare, `iChannel${i}`)) notes.push(`iChannel${i} reads nothing here (black): only the sound and the clip's picture can be channels`);
  });
  const hears = channels.some((kind, i) => kind === "audio" && read[i]);
  const audio: AudioRequest | null = hears ? { rows: 1, span: 0, fall: 0.08, window: 0.02, hits: "onset" } : null;
  if (/\b(iChannel[0-3])\s*,/.test(bare) && /\bsampler2D\s+\w+\s*[,)]/.test(bare)) {
    notes.push("Channels here aren't sampler2D: a function taking a sampler2D can't be given one");
  }
  const source = `${DIALECT_PRELUDE}${audio ? HIDDEN_AUDIO_PRELUDE + linearSpectrum(12000) + AUDIO_WAVE : ""}
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform float iFrameRate;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform float iSampleRate;
uniform float iChannelTime[4];
#define iResolution vec3(uResolution, 1.0)
vec3 iChannelResolution[4];
struct _VzChannel { int id; };
const _VzChannel iChannel0 = _VzChannel(${CHANNEL_IDS[channels[0]]});
const _VzChannel iChannel1 = _VzChannel(${CHANNEL_IDS[channels[1]]});
const _VzChannel iChannel2 = _VzChannel(${CHANNEL_IDS[channels[2]]});
const _VzChannel iChannel3 = _VzChannel(${CHANNEL_IDS[channels[3]]});
vec2 _vzChannelSize(_VzChannel c) { return c.id == 1 ? vec2(512.0, 2.0) : c.id == 2 ? uResolution : vec2(1.0); }
vec4 _vzChannel(_VzChannel c, vec2 uv) {
${
  audio
    ? `  if (c.id == 1) {
    float v = fract(uv.y) < 0.5 ? _vzLinearSpectrum(fract(uv.x)) : _vzWave(fract(uv.x), 0);
    return vec4(v, v, v, 1.0);
  }
`
    : ""
}  if (c.id == 2) return _vzPicture(uv);
  return vec4(0.0, 0.0, 0.0, 1.0);
}
vec4 texture(_VzChannel c, vec2 uv) { return _vzChannel(c, uv); }
vec4 texture(_VzChannel c, vec2 uv, float bias) { return _vzChannel(c, uv); }
vec4 textureLod(_VzChannel c, vec2 uv, float lod) { return _vzChannel(c, uv); }
vec4 textureGrad(_VzChannel c, vec2 uv, vec2 dx, vec2 dy) { return _vzChannel(c, uv); }
vec4 texelFetch(_VzChannel c, ivec2 p, int lod) { return _vzChannel(c, (vec2(p) + 0.5) / _vzChannelSize(c)); }
ivec2 textureSize(_VzChannel c, int lod) { return ivec2(_vzChannelSize(c)); }
${declaredAt(decls)}
#line 1 1
${withoutVersion(shader.code)}
#line 1 2
void main() {
  for (int i = 0; i < 4; i++) iChannelResolution[i] = vec3(i == 0 ? _vzChannelSize(iChannel0) : i == 1 ? _vzChannelSize(iChannel1) : i == 2 ? _vzChannelSize(iChannel2) : _vzChannelSize(iChannel3), 1.0);
  vec4 c = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(c, gl_FragCoord.xy);
  _vzOut = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
}
`;
  const uniformSpecs = params as UniformSpec[];
  return {
    key,
    label,
    params: audio ? [...params, SOURCE] : params,
    source,
    uniforms: (values, { time, fps }) => [
      ...paramUniforms(uniformSpecs, values),
      { name: "iTime", type: "float", value: time },
      { name: "iTimeDelta", type: "float", value: 1 / fps },
      { name: "iFrame", type: "int", value: Math.max(0, Math.round(time * fps)) },
      { name: "iFrameRate", type: "float", value: fps },
      { name: "iMouse", type: "vec4", value: [0, 0, 0, 0] },
      // A date that never changes, so frames are the same whenever they're drawn; its seconds run with the clip.
      { name: "iDate", type: "vec4", value: [2026, 0, 1, time] },
      { name: "iSampleRate", type: "float", value: 48000 },
    ],
    audio,
    animated: uses(bare, "iTime", "iFrame", "iDate", "iTimeDelta"),
    passes: 1,
    grow: 0,
    problems,
    notes,
  };
}

/** An ISF input as the header declares it. */
interface IsfInput {
  NAME?: unknown;
  TYPE?: unknown;
  DEFAULT?: unknown;
  MIN?: unknown;
  MAX?: unknown;
  LABEL?: unknown;
  VALUES?: unknown;
  LABELS?: unknown;
}

/** What an ISF image input reads: the clip's picture, the sound's wave or its FFT, or nothing. */
const IMAGE_KINDS = { input: 0, wave: 1, fft: 2, none: 3 } as const;

/** The 1-based line of character `at` in `code`. */
const lineAt = (code: string, at: number) => code.slice(0, at).split("\n").length;

/** Read an ISF shader: its JSON header (inputs as parameters), and its code turned into GLSL ES 3.00. */
function parseIsf(shader: ShaderCode, key: string): ParsedShader {
  const problems: ShaderProblem[] = [];
  const notes: string[] = [];
  const params: ParamSpec[] = [];
  const decls: { line: number; text: string }[] = [];
  const images: { name: string; kind: keyof typeof IMAGE_KINDS; size: number }[] = [];
  /** How each parameter becomes its uniform. */
  const mappers: ((values: ParamValues) => UniformValue)[] = [];
  let label: string | null = null;
  const code = shader.code;
  const header = /\/\*\s*(\{[\s\S]*?\})\s*\*\//.exec(code);
  let json: Record<string, unknown> = {};
  if (!header) problems.push({ line: 1, message: 'An ISF shader starts with its JSON header: /*{ "ISFVSN": "2", "INPUTS": [...] }*/' });
  else {
    try {
      const parsed = JSON.parse(header[1]) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
      else problems.push({ line: lineAt(code, header.index), message: "The ISF header must be a JSON object" });
    } catch (error) {
      problems.push({ line: lineAt(code, header.index), message: `The ISF header isn't valid JSON: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  const headerLine = header ? lineAt(code, header.index) : 1;
  /** The line an input's NAME is on, for its problems. */
  const inputLine = (name: string) => {
    const at = header ? code.indexOf(`"${name}"`, header.index) : -1;
    return at >= 0 ? lineAt(code, at) : headerLine;
  };
  const inputs = Array.isArray(json.INPUTS) ? (json.INPUTS as IsfInput[]) : [];
  const num = (v: unknown, fallback: number) => (isFiniteNumber(v) ? v : fallback);
  for (const input of inputs) {
    if (!input || typeof input !== "object") continue;
    const name = typeof input.NAME === "string" ? input.NAME : "";
    const type = typeof input.TYPE === "string" ? input.TYPE : "";
    const line = inputLine(name);
    const inputLabel = typeof input.LABEL === "string" && input.LABEL.trim() ? input.LABEL.trim().slice(0, 60) : humanise(name);
    if (type === "image" || type === "audio" || type === "audioFFT") {
      if (!/^[A-Za-z_]\w*$/.test(name)) {
        problems.push({ line, message: `"${name}" isn't a name GLSL takes` });
        continue;
      }
      const firstPicture = type === "image" && !images.some((i) => i.kind === "input");
      if (type === "image" && !firstPicture) notes.push(`${name} reads nothing here (transparent): only one image input, the clip's picture, can be read`);
      const kind = type === "audio" ? "wave" : type === "audioFFT" ? "fft" : firstPicture ? "input" : "none";
      images.push({ name, kind, size: Math.max(2, Math.min(4096, Math.round(num(input.MAX, type === "audioFFT" ? 256 : 512)))) });
      continue;
    }
    const bad = badKey(name, "isf");
    if (bad) {
      problems.push({ line, message: bad });
      continue;
    }
    if (params.length >= MAX_SHADER_PARAMS) {
      problems.push({ line, message: `A shader has ${MAX_SHADER_PARAMS} parameters at most` });
      break;
    }
    switch (type) {
      case "float": {
        const min = num(input.MIN, 0);
        const max = num(input.MAX, Math.max(min + 1, 1));
        if (!(min < max)) {
          problems.push({ line, message: `${name}: its MIN must be less than its MAX` });
          continue;
        }
        const spec = numberSpec(name, inputLabel, min, max, num(input.DEFAULT, min));
        params.push(spec);
        decls.push({ line, text: `uniform float ${name};` });
        mappers.push((v) => ({ name, type: "float", value: (v[name] as number) ?? spec.default }));
        break;
      }
      case "bool":
      case "event": {
        params.push({ kind: "boolean", key: name, label: inputLabel, default: input.DEFAULT === true || input.DEFAULT === 1 });
        decls.push({ line, text: `uniform bool ${name};` });
        mappers.push((v) => ({ name, type: "float", value: v[name] ? 1 : 0 }));
        break;
      }
      case "long": {
        const values = Array.isArray(input.VALUES) ? input.VALUES.filter(isFiniteNumber).map(Math.round) : [];
        const labels = Array.isArray(input.LABELS) ? input.LABELS : [];
        const list = values.length ? values : Array.from({ length: Math.max(2, Math.round(num(input.MAX, 1)) + 1) }, (_, i) => i);
        const options = list.map((v, i) => ({ value: String(v), label: typeof labels[i] === "string" ? String(labels[i]).slice(0, 40) : String(v) }));
        const fallback = String(Math.round(num(input.DEFAULT, list[0])));
        const spec: ChoiceSpec = { kind: "choice", key: name, label: inputLabel, default: options.some((o) => o.value === fallback) ? fallback : options[0].value, options };
        params.push(spec);
        decls.push({ line, text: `uniform int ${name};` });
        mappers.push((v) => ({ name, type: "int", value: Number(v[name] ?? spec.default) || 0 }));
        break;
      }
      case "color": {
        const d = Array.isArray(input.DEFAULT) ? input.DEFAULT.map((c) => num(c, 1)) : [1, 1, 1, 1];
        const hex = `#${d.slice(0, 3).map((c) => Math.round(clamp(c, 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`;
        const alpha = clamp(num(d[3], 1), 0, 1);
        params.push({ kind: "color", key: name, label: inputLabel, default: hex });
        decls.push({ line, text: `uniform vec4 ${name};` });
        mappers.push((v) => {
          const n = Number.parseInt(String(v[name] ?? hex).slice(1), 16) || 0;
          return { name, type: "vec4", value: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha] };
        });
        break;
      }
      case "point2D": {
        const d = Array.isArray(input.DEFAULT) ? input.DEFAULT.map((c) => num(c, 0)) : [0, 0];
        const lo = Array.isArray(input.MIN) ? Math.min(...input.MIN.map((c) => num(c, -1e4))) : -1e4;
        const hi = Array.isArray(input.MAX) ? Math.max(...input.MAX.map((c) => num(c, 1e4))) : 1e4;
        // As the code reads them (ISF keeps points in pixels or fractions as each shader likes).
        const spec: Vec2Spec = { kind: "vec2", key: name, label: inputLabel, default: [d[0] ?? 0, d[1] ?? 0], space: "px", min: lo, max: hi, step: hi - lo <= 4 ? 0.01 : 1, decimals: hi - lo <= 4 ? 2 : 0 };
        params.push(spec);
        decls.push({ line, text: `uniform vec2 ${name};` });
        mappers.push((v) => ({ name, type: "vec2", value: (v[name] as number[]) ?? spec.default }));
        break;
      }
      default:
        problems.push({ line, message: `${name}: ISF inputs of type "${type}" aren't supported (float, bool, event, long, color, point2D, image, audio, audioFFT are)` });
    }
  }
  const passes = Array.isArray(json.PASSES) ? json.PASSES : [];
  if (passes.length > 1 || passes.some((p) => p && typeof p === "object" && "TARGET" in p)) {
    problems.push({ line: headerLine, message: "Shaders with several PASSES (or a TARGET) aren't supported yet: one pass only" });
  }
  if (json.IMPORTED && typeof json.IMPORTED === "object" && Object.keys(json.IMPORTED).length) {
    problems.push({ line: headerLine, message: "IMPORTED images aren't supported: a shader can read the clip's picture and the sound" });
  }
  const bare = stripComments(code);
  if (!/\bvoid\s+main\s*\(/.test(bare)) problems.push({ line: null, message: "The code must define void main(), writing gl_FragColor" });
  if (/\bvarying\b/.test(bare)) problems.push({ line: lineAt(code, bare.search(/\bvarying\b/)), message: "ISF vertex shaders aren't supported: no varyings" });
  for (const d of directives(code)) {
    if (d.name === "name") label = d.label ?? (d.args.join(" ").slice(0, 60) || null);
  }
  const hears = images.some((i) => i.kind === "wave" || i.kind === "fft");
  const audio: AudioRequest | null = hears ? { rows: 1, span: 0, fall: 0.08, window: 0.02, hits: "onset" } : null;
  const imageConsts = images.map((i, n) => `const _VzImage ${i.name} = _VzImage(${IMAGE_KINDS[i.kind]}, ${n});`).join("\n");
  const sizes = images.map((i, n) => `  if (i.index == ${n}) return ${i.kind === "input" ? "uResolution" : i.kind === "wave" ? `vec2(${i.size.toFixed(1)}, 2.0)` : `vec2(${i.size.toFixed(1)}, 1.0)`};`).join("\n");
  // Its code: gl_FragColor is ours, its main is called by ours.
  const body = withoutVersion(code)
    .replace(/\bgl_FragColor\b/g, "isf_FragColor")
    .replace(/\bmain(\s*\()/g, "_vzIsfMain$1");
  const source = `${DIALECT_PRELUDE}${audio ? HIDDEN_AUDIO_PRELUDE + linearSpectrum(24000) + AUDIO_WAVE : ""}
uniform float TIME;
uniform float TIMEDELTA;
uniform int FRAMEINDEX;
uniform vec4 DATE;
const int PASSINDEX = 0;
#define RENDERSIZE uResolution
vec2 isf_FragNormCoord;
#define vv_FragNormCoord isf_FragNormCoord
vec4 isf_FragColor;
struct _VzImage { int kind; int index; };
${imageConsts}
vec2 _vzSize(_VzImage i) {
${sizes}
  return vec2(1.0);
}
vec4 _vzNorm(_VzImage i, vec2 uv) {
  if (i.kind == 0) return _vzPicture(uv);
${
  audio
    ? `  if (i.kind == 1) { float v = _vzWave(clamp(uv.x, 0.0, 1.0), uv.y < 0.5 ? 0 : 1); return vec4(v, v, v, 1.0); }
  if (i.kind == 2) { float v = _vzLinearSpectrum(uv.x); return vec4(v, v, v, 1.0); }
`
    : ""
}  return vec4(0.0);
}
vec4 texture(_VzImage i, vec2 uv) { return _vzNorm(i, uv); }
vec4 texture(_VzImage i, vec2 uv, float bias) { return _vzNorm(i, uv); }
#define texture2D texture
#define IMG_NORM_PIXEL(i, uv) _vzNorm(i, uv)
#define IMG_PIXEL(i, p) _vzNorm(i, (p) / _vzSize(i))
#define IMG_THIS_PIXEL(i) _vzNorm(i, isf_FragNormCoord)
#define IMG_THIS_NORM_PIXEL(i) _vzNorm(i, isf_FragNormCoord)
#define IMG_SIZE(i) _vzSize(i)
${declaredAt(decls)}
#line 1 1
${body}
#line 1 2
void main() {
  isf_FragNormCoord = vUv;
  isf_FragColor = vec4(0.0);
  _vzIsfMain();
  vec4 c = clamp(isf_FragColor, 0.0, 1.0);
  _vzOut = vec4(c.rgb * c.a, c.a);
}
`;
  return {
    key,
    label,
    params: audio ? [...params, SOURCE] : params,
    source,
    uniforms: (values, { time, fps }) => [
      ...mappers.map((m) => m(values)),
      { name: "TIME", type: "float", value: time },
      { name: "TIMEDELTA", type: "float", value: 1 / fps },
      { name: "FRAMEINDEX", type: "int", value: Math.max(0, Math.round(time * fps)) },
      { name: "DATE", type: "vec4", value: [2026, 1, 1, time] },
    ],
    audio,
    animated: uses(bare, "TIME", "FRAMEINDEX", "DATE", "TIMEDELTA"),
    passes: 1,
    grow: 0,
    problems,
    notes,
  };
}

/** Read a shader's code (see the top of this file). */
export function parseShader(shader: ShaderCode): ParsedShader {
  const key = `fx:shader:${shaderHash(shader)}`;
  if (shader.dialect === "isf") return parseIsf(shader, key);
  if (shader.dialect === "shadertoy") return parseShadertoy(shader, key);
  return parseNative(shader, key);
}

// ---------------------------------------------------------------------------
// Compiler logs
// ---------------------------------------------------------------------------

/**
 * What a compiler's log says is wrong, on the user's lines: `ERROR: 1:12: 'x' : undeclared identifier`
 * is line 12 of their code (string 1, see the top of this file); errors elsewhere (the prelude, our
 * `main`) have no line of theirs.
 */
export function compileProblems(log: string): ShaderProblem[] {
  const problems: ShaderProblem[] = [];
  const seen = new Set<string>();
  for (const raw of log.split("\n")) {
    const m = /\bERROR:\s*(\d+):(\d+):\s*(.*)$/.exec(raw);
    if (!m) {
      const general = /\bERROR:\s*(.*)$/.exec(raw);
      if (general && !/compilation errors?/i.test(general[1])) problems.push({ line: null, message: general[1].trim() });
      continue;
    }
    const [, string, line, text] = m;
    const message = tidyMessage(text);
    const at = string === "1" ? Number(line) : null;
    const id = `${at}:${message}`;
    if (seen.has(id)) continue;
    seen.add(id);
    problems.push({ line: at, message });
  }
  return problems;
}

/** A compiler's message made readable: `'x' : undeclared identifier` -> "'x': undeclared identifier". */
function tidyMessage(text: string): string {
  const t = text.trim().replace(/\s+:\s+/g, ": ");
  if (/'effect'\s*:\s*no matching overloaded function/.test(t)) return "The code must define vec4 effect(vec2 uv)";
  if (/'mainImage'\s*:\s*no matching overloaded function/.test(t)) return "The code must define void mainImage(out vec4 fragColor, in vec2 fragCoord)";
  if (/'_vzIsfMain'\s*:\s*no matching overloaded function/.test(t)) return "The code must define void main()";
  return t.replace(/_vzIsfMain/g, "main").replace(/isf_FragColor/g, "gl_FragColor");
}

/** A problem in a line: "Line 12: 'x': undeclared identifier". */
export const problemText = (p: ShaderProblem) => (p.line === null ? p.message : `Line ${p.line}: ${p.message}`);

// ---------------------------------------------------------------------------
// Starting points
// ---------------------------------------------------------------------------

/** A new Shader effect's code: rings over the clip that move with the bass, to change. */
export const DEFAULT_SHADER: ShaderCode = {
  dialect: "native",
  code: `// @name "Shader"
// Your own effect in GLSL ES 3.00: effect(uv) is the colour at uv, (0, 0) bottom left.
// Parameters declared like these show in Properties, keyframable and linkable:
// @param amount number 0 1 0.6 "Amount"
// @param rings number 2 60 18 "Rings"
// @param speed number -4 4 1 "Speed"
// @param tint color #ff3d7f "Tint"

vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  float d = length(aspect(uv));
  // audioBass is the sound's bass now (0..1): see the Shader API for the rest.
  float wave = 0.5 + 0.5 * sin(d * rings - time * speed * 4.0 + audioBass * 4.0);
  float glow = amount * smoothstep(0.55, 1.0, wave) * (0.4 + 0.6 * audioBass);
  return vec4(c.rgb + tint * glow * c.a, c.a);
}
`,
};

/** Examples to start from (the shader editor's Examples menu, and the assistant's catalogue). */
export const SHADER_EXAMPLES: readonly { id: string; label: string; description: string; shader: ShaderCode }[] = [
  { id: "rings", label: "Bass rings", description: "Rings over the clip that pulse with the bass (ours).", shader: DEFAULT_SHADER },
  {
    id: "spectrum-glow",
    label: "Glowing spectrum",
    description: "A mirrored spectrum with a fading history, drawn over the clip (ours, reads spectrumAgo).",
    shader: {
      dialect: "native",
      code: `// @name "Glowing spectrum"
// @param color color #39d0ff "Color"
// @param height number 0.1 1 0.45 "Height"
// @history 1.5

vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  float x = abs(uv.x - 0.5) * 2.0;
  float level = 0.0;
  for (int i = 0; i < 6; i++) {
    float ago = float(i) * 0.12;
    float s = spectrumAgo(x, ago) * height;
    level = max(level, smoothstep(0.012, 0.0, abs(uv.y - 0.5) - s) * (1.0 - float(i) / 6.0));
  }
  return vec4(c.rgb + color * level, max(c.a, level));
}
`,
    },
  },
  {
    id: "shadertoy-new",
    label: "Shadertoy: new shader",
    description: "Shadertoy's own starting shader: colours cycling over time.",
    shader: {
      dialect: "shadertoy",
      code: `void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    // Normalized pixel coordinates (from 0 to 1)
    vec2 uv = fragCoord/iResolution.xy;

    // Time varying pixel color
    vec3 col = 0.5 + 0.5*cos(iTime+uv.xyx+vec3(0,2,4));

    // Output to screen
    fragColor = vec4(col,1.0);
}
`,
    },
  },
  {
    id: "shadertoy-audio",
    label: "Shadertoy: sound input",
    description: "Reads iChannel0 as Shadertoy's sound texture: the spectrum on row 0, the waveform on row 1.",
    shader: {
      dialect: "shadertoy",
      code: `// iChannel0 is the sound: texture(iChannel0, vec2(x, 0.25)) the spectrum, vec2(x, 0.75) the wave.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float fft = texture(iChannel0, vec2(uv.x, 0.25)).x;
    float wave = texture(iChannel0, vec2(uv.x, 0.75)).x;
    vec3 col = vec3(0.1, 0.6, 1.0) * step(uv.y, fft);
    col += vec3(1.0) * smoothstep(0.012, 0.0, abs(wave - uv.y));
    fragColor = vec4(col, 1.0);
}
`,
    },
  },
  {
    id: "isf-filter",
    label: "ISF: colour filter",
    description: "An ISF filter on the clip's picture, with a float, a switch and a colour.",
    shader: {
      dialect: "isf",
      code: `/*{
  "DESCRIPTION": "Tints the picture towards a colour, optionally inverted",
  "ISFVSN": "2",
  "CATEGORIES": ["Color Effect"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0, "LABEL": "Amount" },
    { "NAME": "invert", "TYPE": "bool", "DEFAULT": false, "LABEL": "Invert" },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [1.0, 0.45, 0.1, 1.0], "LABEL": "Tint" }
  ]
}*/

void main() {
  vec4 c = IMG_THIS_PIXEL(inputImage);
  vec3 rgb = invert ? 1.0 - c.rgb : c.rgb;
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(mix(rgb, tint.rgb * l * 1.6, amount), c.a);
}
`,
    },
  },
  {
    id: "isf-audio",
    label: "ISF: audio bars",
    description: "An ISF generator reading an audioFFT input: bars of the spectrum, coloured by height.",
    shader: {
      dialect: "isf",
      code: `/*{
  "DESCRIPTION": "Spectrum bars from an audioFFT input",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Audio Reactive"],
  "INPUTS": [
    { "NAME": "fft", "TYPE": "audioFFT", "MAX": 64 },
    { "NAME": "bars", "TYPE": "long", "VALUES": [16, 32, 64], "LABELS": ["16", "32", "64"], "DEFAULT": 32, "LABEL": "Bars" },
    { "NAME": "gain", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.25, "MAX": 4.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float n = float(bars);
  float x = (floor(uv.x * n) + 0.5) / n;
  float level = IMG_NORM_PIXEL(fft, vec2(pow(x, 2.0), 0.5)).r * gain;
  float on = step(uv.y, level) * step(0.15, fract(uv.x * n));
  gl_FragColor = vec4(mix(vec3(0.1, 0.9, 0.6), vec3(1.0, 0.2, 0.5), uv.y) * on, 1.0);
}
`,
    },
  },
];

// ---------------------------------------------------------------------------
// The reference (the shader editor's, and the assistant's `get_catalog "shader_api"`)
// ---------------------------------------------------------------------------

/** What a shader in `dialect` can use, in short lines (all three when no dialect is given). */
export function shaderApi(dialect?: ShaderDialect): string[] {
  const native = [
    "GLSL (ours): GLSL ES 3.00 defining vec4 effect(vec2 uv): the colour at uv ((0, 0) bottom left of the clip's frame), premultiplied (rgb never above alpha).",
    "  getColor(uv): the clip's picture so far (premultiplied; past the edges as its Motion Edges say), getColorOrClear(uv) transparent past them, getInput(uv) what the effect started from (with @passes).",
    "  unpremultiply(c) its straight rgb, withRgb(c, rgb) straight rgb back with c's alpha.",
    "  ratio (width / height), resolution (px), time (the clip's own time, s), clipTime (s since it started), fps, pass (with @passes).",
    "  Helpers: PI, ease/easeIn/easeOut(t), hash(vec2), hash2(vec2), noise(vec2), fbm(vec2), rot(angle) (a mat2), luma(c), inside(uv), aspect(uv) (square units around the centre), mirrored(p), toUv(point) and frameUv(point) (a point parameter to uv).",
    "  The sound (using any adds a Listens To parameter: the mix, the clip's own sound or a track): spectrum(x) (0..1 at x along 20 Hz–20 kHz, log), spectrumAgo(x, seconds) (with @history), wave(x) (left and right, -1..1, x across a window around now: @wave), audioLevel, audioBass, audioMid, audioHigh, audioOnset (a hit's impulse), sinceOnset, beatCount, beatPhase (0..1), sinceBeat, bpm, hitAge[8] and hitVelocity[8] (the last hits, newest first: @hits).",
    '  Declarations, one per line: // @param key number min max default "Label" (also int), // @param key bool true, // @param key choice A|B|C B (a uniform int, the option\'s index), // @param key point 0.5 0.5 (fractions of the frame, y down: toUv(key) is its uv), // @param key color #ff3d7f (a vec3). Parameters show in Properties, keyframable and linkable.',
    '  Also: // @name "Neon tunnel", // @passes 3 (run again over its result), // @grow 0.2 (room past the frame), // @fall 0.1 (seconds the spectrum falls over), // @history 2 (seconds spectrumAgo reaches), // @wave 0.05 (seconds of waveform), // @hits kicks|snares|hats|any.',
  ];
  const isf = [
    'ISF (Interactive Shader Format, isf.video): a JSON header /*{ "ISFVSN": "2", "INPUTS": [...] }*/ then void main() writing gl_FragColor (straight alpha), GLSL ES 1.0 or 3.00 style (texture2D works).',
    "  INPUTS: float (MIN, MAX, DEFAULT), bool, event, long (VALUES, LABELS), color (a vec4), point2D (a vec2 as the code reads it), image (the first is the clip's picture; others read nothing), audio (the waveform: IMG_NORM_PIXEL(name, vec2(x, channel)), 0.5 is silence) and audioFFT (the spectrum, linear to 24 kHz). They become parameters in Properties.",
    "  IMG_THIS_PIXEL, IMG_THIS_NORM_PIXEL, IMG_NORM_PIXEL, IMG_PIXEL, IMG_SIZE, isf_FragNormCoord (vv_FragNormCoord), RENDERSIZE, TIME, TIMEDELTA, FRAMEINDEX, DATE, PASSINDEX (0), gl_FragCoord.",
    "  Not supported: several PASSES or TARGETs, persistent buffers, IMPORTED images, custom vertex shaders.",
  ];
  const shadertoy = [
    "Shadertoy: void mainImage(out vec4 fragColor, in vec2 fragCoord), GLSL ES 3.00; the picture is opaque (alpha is ignored).",
    "  iResolution, iTime (the clip's own time), iTimeDelta, iFrame, iFrameRate, iChannelResolution, iSampleRate, iDate (a fixed date: frames never depend on when they're drawn), iMouse (zero).",
    "  iChannel0 is the sound as Shadertoy's 512×2 texture: texture(iChannel0, vec2(x, 0.25)).x the spectrum (linear to 12 kHz), vec2(x, 0.75) the waveform (0.5 is silence); iChannel1 the clip's picture. // @iChannel0 audio|input|none (any of 0..3) changes them. texture, texelFetch, textureLod, textureSize work on them (they aren't sampler2Ds: a function taking a sampler2D can't be given one).",
    '  // @param lines declare parameters as in ours (// @param amount number 0 1 0.5), and // @name "...". Common, Buffer A–D and keyboard input aren\'t supported.',
  ];
  if (dialect === "native") return native;
  if (dialect === "isf") return isf;
  if (dialect === "shadertoy") return shadertoy;
  return [...native, ...isf, ...shadertoy];
}
