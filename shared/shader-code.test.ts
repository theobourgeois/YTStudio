import { describe, expect, it } from "vitest";
import type { ChoiceSpec, NumberSpec, Vec2Spec } from "./params.ts";
import {
  DEFAULT_SHADER,
  MAX_SHADER_CODE,
  SHADER_EXAMPLES,
  compileProblems,
  humanise,
  normalizeShaderCode,
  parseShader,
  problemText,
  shaderApi,
  shaderHash,
  stripComments,
} from "./shader-code.ts";
import type { ShaderCode } from "./types.ts";

const native = (code: string): ShaderCode => ({ code, dialect: "native" });
const clock = { time: 2, clipTime: 1.5, fps: 30 };

describe("shader code", () => {
  it("is normalised from storage, or refused", () => {
    expect(normalizeShaderCode({ code: "a\r\nb", dialect: "isf" })).toEqual({ code: "a\nb", dialect: "isf" });
    expect(normalizeShaderCode({ code: "x", dialect: "hlsl" })).toEqual({ code: "x", dialect: "native" });
    expect(normalizeShaderCode({ code: "x".repeat(MAX_SHADER_CODE + 1), dialect: "native" })).toBeUndefined();
    expect(normalizeShaderCode({ dialect: "native" })).toBeUndefined();
    expect(normalizeShaderCode("void main() {}")).toBeUndefined();
  });

  it("is keyed by a hash of its code and dialect", () => {
    const a = parseShader(native("vec4 effect(vec2 uv) { return vec4(1.0); }"));
    expect(a.key).toMatch(/^fx:shader:[0-9a-f]{16}$/);
    expect(parseShader(native("vec4 effect(vec2 uv) { return vec4(1.0); }")).key).toBe(a.key);
    expect(parseShader(native("vec4 effect(vec2 uv) { return vec4(0.5); }")).key).not.toBe(a.key);
    expect(shaderHash({ code: "x", dialect: "native" })).not.toBe(shaderHash({ code: "x", dialect: "isf" }));
  });

  it("keeps the user's lines: its code follows #line 1 1, without its #version", () => {
    const parsed = parseShader(native("#version 300 es\nvec4 effect(vec2 uv) { return vec4(1.0); }"));
    expect(parsed.source.startsWith("#version 300 es")).toBe(true);
    expect(parsed.source.match(/#version/g)).toHaveLength(1);
    const user = parsed.source.slice(parsed.source.indexOf("#line 1 1\n") + 10);
    expect(user.split("\n")[1]).toBe("vec4 effect(vec2 uv) { return vec4(1.0); }");
  });

  it("strips comments without moving lines", () => {
    const code = "a // b\n/* c\nd */ e";
    expect(stripComments(code).split("\n")).toHaveLength(3);
    expect(stripComments(code)).not.toMatch(/[bcd]/);
    expect(stripComments(code)).toContain("e");
  });

  it("names parameters from their keys", () => {
    expect(humanise("amountOfLight")).toBe("Amount Of Light");
    expect(humanise("glow_size")).toBe("Glow Size");
  });
});

describe("native shaders", () => {
  it("declare parameters in comments", () => {
    const parsed = parseShader(
      native(`// @param amount number 0 2 0.5 "How Much"
// @param count int 1 10 3
// @param glow bool true
// @param mode choice Bars|Line|Dots Line
// @param centre point 0.25 0.75
// @param tint color #FF3D7F
vec4 effect(vec2 uv) { return getColor(uv); }`),
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.params.map((p) => [p.key, p.kind, p.label, p.default])).toEqual([
      ["amount", "number", "How Much", 0.5],
      ["count", "number", "Count", 3],
      ["glow", "boolean", "Glow", true],
      ["mode", "choice", "Mode", "Line"],
      ["centre", "vec2", "Centre", [0.25, 0.75]],
      ["tint", "color", "Tint", "#ff3d7f"],
    ]);
    const amount = parsed.params[0] as NumberSpec;
    expect([amount.min, amount.max]).toEqual([0, 2]);
    expect((parsed.params[1] as NumberSpec).step).toBe(1);
    expect((parsed.params[3] as ChoiceSpec).options.map((o) => o.value)).toEqual(["Bars", "Line", "Dots"]);
    expect((parsed.params[4] as Vec2Spec).space).toBe("media");
    // Each declaration is a uniform, on its own line so a compile error there names it.
    expect(parsed.source).toContain("#line 1 1\nuniform float amount;");
    expect(parsed.source).toContain("#line 4 1\nuniform int mode;");
    expect(parsed.source).toContain("#line 6 1\nuniform vec3 tint;");
    expect(parsed.audio).toBeNull();
    expect(parsed.animated).toBe(false);
  });

  it("say what's wrong with a declaration, on its line", () => {
    const parsed = parseShader(
      native(`// @param 2fast number 0 1 0
// @param time number 0 1 0
// @param amount
// @param amount number 1 0 0
// @param ok number 0 1 0
// @param ok bool
// @param mode choice OnlyOne
// @param tint color red
// @wobble 3
vec4 effect(vec2 uv) { return getColor(uv); }`),
    );
    expect(parsed.problems.map((p) => p.line)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
    expect(parsed.problems[1].message).toMatch(/already defined/);
    expect(parsed.params.map((p) => p.key)).toEqual(["ok"]);
  });

  it("must define effect(uv)", () => {
    expect(parseShader(native("void main() {}")).problems).toEqual([{ line: null, message: expect.stringMatching(/vec4 effect\(vec2 uv\)/) }]);
  });

  it("hear the sound when they read it, with a Listens To parameter", () => {
    const quiet = parseShader(native("vec4 effect(vec2 uv) { return getColor(uv) * time; }"));
    expect(quiet.audio).toBeNull();
    expect(quiet.animated).toBe(true);
    const bars = parseShader(native("// @fall 0.3\nvec4 effect(vec2 uv) { return vec4(spectrum(uv.x)); }"));
    expect(bars.audio).toEqual({ rows: 1, span: 0, fall: 0.3, window: 0, hits: "onset" });
    expect(bars.params.at(-1)).toMatchObject({ kind: "source", key: "source" });
    expect(bars.source).toContain("uniform highp sampler2D uSpectrum;");
    const trails = parseShader(native("// @history 3\n// @hits kicks\nvec4 effect(vec2 uv) { return vec4(spectrumAgo(uv.x, 1.0) + wave(0.5).x + hitAge[0]); }"));
    expect(trails.audio).toEqual({ rows: 64, span: 3, fall: 0.1, window: 0.05, hits: "onsetLow" });
    // In a comment it isn't read.
    expect(parseShader(native("// spectrum(x) would\nvec4 effect(vec2 uv) { return vec4(0.0); }")).audio).toBeNull();
  });

  it("give their values and the moment as uniforms", () => {
    const parsed = parseShader(native("// @param mode choice A|B|C\n// @param on bool\nvec4 effect(vec2 uv) { return vec4(0.0); }"));
    expect(parsed.uniforms({ mode: "C", on: true }, clock)).toEqual([
      { name: "mode", type: "int", value: 2 },
      { name: "on", type: "float", value: 1 },
      { name: "time", type: "float", value: 2 },
      { name: "clipTime", type: "float", value: 1.5 },
      { name: "fps", type: "float", value: 30 },
    ]);
  });

  it("take passes, room and a name", () => {
    const parsed = parseShader(native('// @name "Neon"\n// @passes 3\n// @grow 0.2\nvec4 effect(vec2 uv) { return vec4(0.0); }'));
    expect([parsed.label, parsed.passes, parsed.grow]).toEqual(["Neon", 3, 0.2]);
  });
});

describe("Shadertoy shaders", () => {
  it("call mainImage with the frame's pixel, opaque", () => {
    const parsed = parseShader(SHADER_EXAMPLES.find((e) => e.id === "shadertoy-new")!.shader);
    expect(parsed.problems).toEqual([]);
    expect(parsed.params).toEqual([]);
    expect(parsed.animated).toBe(true);
    expect(parsed.source).toContain("mainImage(c, gl_FragCoord.xy);");
    expect(parsed.source).toContain("#define iResolution vec3(uResolution, 1.0)");
    // None of our helpers: its own hash() or noise() can't clash.
    expect(parsed.source).not.toMatch(/float hash\(vec2 p\)/);
    expect(parsed.uniforms({}, clock)).toEqual(
      expect.arrayContaining([
        { name: "iTime", type: "float", value: 2 },
        { name: "iFrame", type: "int", value: 60 },
        { name: "iTimeDelta", type: "float", value: 1 / 30 },
        { name: "iDate", type: "vec4", value: [2026, 0, 1, 2] },
      ]),
    );
  });

  it("hear the sound through iChannel0 only when they read it", () => {
    const audio = parseShader(SHADER_EXAMPLES.find((e) => e.id === "shadertoy-audio")!.shader);
    expect(audio.audio).toMatchObject({ window: 0.02 });
    expect(audio.params.map((p) => p.key)).toEqual(["source"]);
    expect(audio.source).toContain("const _VzChannel iChannel0 = _VzChannel(1);");
    // Our audio functions are renamed, so the shader's own `wave` doesn't clash.
    expect(audio.source).toContain("vec2 _vz_wave(float x)");
    expect(audio.source).not.toMatch(/\bvec2 wave\(/);
  });

  it("choose their channels and declare parameters", () => {
    const parsed = parseShader({
      dialect: "shadertoy",
      code: "// @iChannel0 input\n// @iChannel2 audio\n// @param zoom number 1 4 2\nvoid mainImage(out vec4 c, in vec2 p) { c = texture(iChannel0, p / iResolution.xy) * zoom; }",
    });
    expect(parsed.problems).toEqual([]);
    expect(parsed.source).toContain("const _VzChannel iChannel0 = _VzChannel(2);");
    expect(parsed.audio).toBeNull();
    expect(parsed.params.map((p) => p.key)).toEqual(["zoom"]);
    expect(parseShader({ dialect: "shadertoy", code: "// @iChannel1 video\nvoid mainImage(out vec4 c, in vec2 p) {}" }).problems[0]).toMatchObject({ line: 1 });
    expect(parseShader({ dialect: "shadertoy", code: "void main() {}" }).problems[0].message).toMatch(/mainImage/);
  });

  it("note channels that read nothing", () => {
    const parsed = parseShader({ dialect: "shadertoy", code: "void mainImage(out vec4 c, in vec2 p) { c = texture(iChannel3, vec2(0.5)); }" });
    expect(parsed.notes).toEqual([expect.stringMatching(/iChannel3 reads nothing/)]);
  });
});

describe("ISF shaders", () => {
  const isf = (header: object, body = "void main() { gl_FragColor = IMG_THIS_PIXEL(inputImage); }"): ShaderCode => ({
    dialect: "isf",
    code: `/*${JSON.stringify(header, null, 2)}*/\n${body}`,
  });

  it("make parameters of their inputs", () => {
    const parsed = parseShader(
      isf({
        ISFVSN: "2",
        INPUTS: [
          { NAME: "inputImage", TYPE: "image" },
          { NAME: "amount", TYPE: "float", MIN: 0, MAX: 4, DEFAULT: 1, LABEL: "Amount" },
          { NAME: "flip", TYPE: "bool", DEFAULT: true },
          { NAME: "flash", TYPE: "event" },
          { NAME: "mode", TYPE: "long", VALUES: [10, 20, 30], LABELS: ["Ten", "Twenty", "Thirty"], DEFAULT: 20 },
          { NAME: "tint", TYPE: "color", DEFAULT: [1, 0.5, 0, 0.5] },
          { NAME: "centre", TYPE: "point2D", DEFAULT: [100, 200], MIN: [0, 0], MAX: [1920, 1080] },
        ],
      }),
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.params.map((p) => [p.key, p.kind, p.default])).toEqual([
      ["amount", "number", 1],
      ["flip", "boolean", true],
      ["flash", "boolean", false],
      ["mode", "choice", "20"],
      ["tint", "color", "#ff8000"],
      ["centre", "vec2", [100, 200]],
    ]);
    expect((parsed.params[3] as ChoiceSpec).options).toEqual([
      { value: "10", label: "Ten" },
      { value: "20", label: "Twenty" },
      { value: "30", label: "Thirty" },
    ]);
    expect(parsed.source).toMatch(/uniform bool flip;/);
    expect(parsed.source).toMatch(/uniform int mode;/);
    expect(parsed.source).toMatch(/uniform vec4 tint;/);
    expect(parsed.source).toContain("const _VzImage inputImage = _VzImage(0, 0);");
    // A long sends its value (not its index), a colour its alpha, a switch 0 or 1.
    const uniforms = parsed.uniforms({ amount: 2, flip: false, flash: true, mode: "30", tint: "#00ff00", centre: [5, 6] }, clock);
    expect(uniforms).toEqual(
      expect.arrayContaining([
        { name: "amount", type: "float", value: 2 },
        { name: "flip", type: "float", value: 0 },
        { name: "flash", type: "float", value: 1 },
        { name: "mode", type: "int", value: 30 },
        { name: "tint", type: "vec4", value: [0, 1, 0, 0.5] },
        { name: "centre", type: "vec2", value: [5, 6] },
        { name: "TIME", type: "float", value: 2 },
        { name: "FRAMEINDEX", type: "int", value: 60 },
      ]),
    );
  });

  it("turn gl_FragColor and main into ours, and premultiply what they write", () => {
    const parsed = parseShader(isf({ INPUTS: [{ NAME: "inputImage", TYPE: "image" }] }));
    expect(parsed.source).toContain("void _vzIsfMain() { isf_FragColor = IMG_THIS_PIXEL(inputImage); }");
    expect(parsed.source).toContain("_vzOut = vec4(c.rgb * c.a, c.a);");
  });

  it("hear audio and audioFFT inputs", () => {
    const parsed = parseShader(SHADER_EXAMPLES.find((e) => e.id === "isf-audio")!.shader);
    expect(parsed.problems).toEqual([]);
    expect(parsed.audio).not.toBeNull();
    expect(parsed.params.map((p) => p.key)).toEqual(["bars", "gain", "source"]);
    expect(parsed.source).toContain("const _VzImage fft = _VzImage(2, 0);");
  });

  it("say what isn't supported, and where", () => {
    const parsed = parseShader(
      isf({
        PASSES: [{ TARGET: "buf", PERSISTENT: true }, {}],
        IMPORTED: { noise: { PATH: "noise.png" } },
        INPUTS: [
          { NAME: "inputImage", TYPE: "image" },
          { NAME: "other", TYPE: "image" },
          { NAME: "TIME", TYPE: "float" },
          { NAME: "colours", TYPE: "gradient" },
        ],
      }),
    );
    expect(parsed.problems.map((p) => p.message)).toEqual([
      expect.stringMatching(/already defined/),
      expect.stringMatching(/"gradient" aren't supported/),
      expect.stringMatching(/PASSES/),
      expect.stringMatching(/IMPORTED/),
    ]);
    // The input named on its own line of the header.
    expect(parsed.problems[0].line).toBeGreaterThan(1);
    expect(parsed.notes).toEqual([expect.stringMatching(/other reads nothing/)]);
  });

  it("need their header, valid", () => {
    expect(parseShader({ dialect: "isf", code: "void main() {}" }).problems[0].message).toMatch(/JSON header/);
    expect(parseShader({ dialect: "isf", code: '/*{ "INPUTS": [ }*/\nvoid main() {}' }).problems[0].message).toMatch(/isn't valid JSON/);
    expect(parseShader({ dialect: "isf", code: "/*{}*/\nvarying vec2 v;\nvoid main() {}" }).problems).toEqual([{ line: 2, message: expect.stringMatching(/vertex shaders/) }]);
  });
});

describe("compiler logs", () => {
  it("are read onto the user's lines", () => {
    const log = "ERROR: 1:5: 'zz' : undeclared identifier\nERROR: 0:40: 'x' : syntax error\nERROR: 2:3: 'effect' : no matching overloaded function found\nERROR: 3 compilation errors.  No code generated.";
    expect(compileProblems(log)).toEqual([
      { line: 5, message: "'zz': undeclared identifier" },
      { line: null, message: "'x': syntax error" },
      { line: null, message: "The code must define vec4 effect(vec2 uv)" },
    ]);
    expect(compileProblems("Shader didn't compile: ERROR: 1:2: 'a' : wrong")).toEqual([{ line: 2, message: "'a': wrong" }]);
    expect(problemText({ line: 3, message: "oops" })).toBe("Line 3: oops");
  });

  it("name ISF's own words", () => {
    expect(compileProblems("ERROR: 1:4: 'isf_FragColor' : l-value required")).toEqual([{ line: 4, message: "'gl_FragColor': l-value required" }]);
  });
});

describe("the reference", () => {
  it("covers each dialect", () => {
    expect(shaderApi("native").join("\n")).toMatch(/vec4 effect\(vec2 uv\)/);
    expect(shaderApi("isf").join("\n")).toMatch(/IMG_THIS_PIXEL/);
    expect(shaderApi("shadertoy").join("\n")).toMatch(/iChannel0/);
    expect(shaderApi().length).toBe(shaderApi("native").length + shaderApi("isf").length + shaderApi("shadertoy").length);
  });

  it("has examples that read without problems", () => {
    for (const ex of SHADER_EXAMPLES) expect(parseShader(ex.shader).problems, ex.id).toEqual([]);
    expect(SHADER_EXAMPLES[0].shader).toBe(DEFAULT_SHADER);
  });
});
