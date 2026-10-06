/** The Shader effect (V6): its instance's definition, edits that keep what it still declares, storage, drawing. */
import { describe, expect, it } from "vitest";
import { effectPasses, provideShaderCheck } from "./effect-gl.ts";
import {
  SHADER,
  addEffect,
  copyEffects,
  defaultEffects,
  definitionOf,
  effectDefinition,
  effectLabel,
  effectValuesAt,
  normalizeEffects,
  pasteEffects,
  setParams,
  setShaderCode,
  shaderDefinition,
} from "./effects.ts";
import { DEFAULT_SHADER } from "./shader-code.ts";
import { createDefaultProject, MAIN_TRACK_ID } from "./timeline.ts";
import type { Clip, Effect, Keyframe, Project, ShaderCode } from "./types.ts";

const clipWith = (effects: Effect[] = defaultEffects(), id = "c"): Clip => ({ id, assetId: "a", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 5, effects });
const projectWith = (...clips: Clip[]): Project => ({ ...createDefaultProject(), clips });
const native = (code: string): ShaderCode => ({ code, dialect: "native" });
const AMOUNT = native("// @param amount number 0 1 0.5\n// @param tint color #ff0000\nvec4 effect(vec2 uv) { return getColor(uv) * amount; }");
const shaderOf = (p: Project, clipId = "c") => p.clips.find((c) => c.id === clipId)!.effects.find((e) => e.type === "shader")!;

/** A project whose clip has a Shader effect with `code`. */
function withShader(code: ShaderCode = AMOUNT): Project {
  const added = addEffect(projectWith(clipWith()), ["c"], "shader");
  return setShaderCode(added.project, "c", "shader", code);
}

describe("the Shader effect", () => {
  it("is a video effect whose starting code is the default shader", () => {
    expect(effectDefinition("shader")).toBe(SHADER);
    const p = addEffect(projectWith(clipWith()), ["c"], "shader").project;
    const effect = shaderOf(p);
    expect(effect.shader).toEqual(DEFAULT_SHADER);
    expect(definitionOf(effect)).toBe(SHADER);
    expect(Object.keys(effect.params)).toEqual(SHADER.params.map((s) => s.key));
  });

  it("has its own code's definition, built once per code", () => {
    const p = withShader();
    const def = definitionOf(shaderOf(p))!;
    expect(def.params.map((s) => s.key)).toEqual(["amount", "tint"]);
    expect(definitionOf({ type: "shader", shader: { ...AMOUNT } })).toBe(def);
    expect(shaderDefinition(AMOUNT)).toBe(def);
    // The starting shader's amount and tint carried over (it declares both).
    expect(shaderOf(p).params).toEqual({ amount: 0.6, tint: "#ff3d7f" });
  });

  it("keeps the values, keyframes, expressions and links of what new code still declares", () => {
    let p = withShader();
    p = setParams(p, "c", "shader", { amount: 0.8, tint: "#00ff00" });
    const keys: Keyframe[] = [
      { time: 0, value: 0.1, easing: "linear" },
      { time: 1, value: 0.9, easing: "linear" },
    ];
    p = { ...p, clips: p.clips.map((c) => ({ ...c, effects: c.effects.map((e) => (e.type === "shader" ? { ...e, keyframes: { amount: keys }, expressions: { amount: "value * 2" } } : e)) })) };
    const next = setShaderCode(p, "c", "shader", native("// @param amount number 0 2 1\n// @param tint bool\nvec4 effect(vec2 uv) { return getColor(uv) * amount; }"));
    const effect = shaderOf(next);
    expect(effect.params).toEqual({ amount: 0.8, tint: false });
    expect(effect.keyframes).toEqual({ amount: keys });
    expect(effect.expressions).toEqual({ amount: "value * 2" });
    expect(effect.shader?.code).toContain("number 0 2 1");
    // The same code: the same project.
    expect(setShaderCode(next, "c", "shader", { ...effect.shader! })).toBe(next);
    // Not a shader: left alone.
    expect(setShaderCode(next, "c", "motion", AMOUNT)).toBe(next);
  });

  it("is read back from storage with its code, and its values against it", () => {
    const stored = [...defaultEffects(), { id: "shader", type: "shader", enabled: true, params: { amount: 7, gone: 1 }, shader: AMOUNT }];
    const [effect] = normalizeEffects(JSON.parse(JSON.stringify(stored))).filter((e) => e.type === "shader");
    expect(effect.shader).toEqual(AMOUNT);
    expect(effect.params).toEqual({ amount: 1, tint: "#ff0000" });
    // Code that isn't code: the default shader.
    const [fallback] = normalizeEffects([...defaultEffects(), { id: "shader", type: "shader", enabled: true, params: {}, shader: { code: 5 } }]).filter((e) => e.type === "shader");
    expect(fallback.shader).toEqual(DEFAULT_SHADER);
  });

  it("is pasted with its code", () => {
    const from = withShader().clips[0];
    const p = pasteEffects(projectWith(clipWith(defaultEffects(), "d")), ["d"], copyEffects(from));
    expect(shaderOf(p, "d").shader).toEqual(AMOUNT);
    // Onto a clip with a Shader effect of another code: the code comes too, with the values.
    const other = setShaderCode(addEffect(projectWith(clipWith(defaultEffects(), "e")), ["e"], "shader").project, "e", "shader", native("vec4 effect(vec2 uv) { return vec4(1.0); }"));
    const pasted = shaderOf(pasteEffects(other, ["e"], copyEffects(from)), "e");
    expect(pasted.shader).toEqual(AMOUNT);
    expect(pasted.params).toEqual(from.effects.find((e) => e.type === "shader")!.params);
  });

  it("is labelled by its @name", () => {
    const p = withShader(native('// @name "Neon"\nvec4 effect(vec2 uv) { return vec4(1.0); }'));
    expect(effectLabel(p.clips[0], shaderOf(p))).toBe("Neon");
  });

  it("reads its values through its own definition", () => {
    const p = withShader();
    const effect = shaderOf(p);
    expect(effectValuesAt(definitionOf(effect)!, effect, 0, p.clips[0])).toEqual({ amount: 0.6, tint: "#ff3d7f" });
  });

  it("is drawn by a pass keyed by its code, with its own uniforms, unless it doesn't compile", () => {
    const p = withShader();
    const clip = p.clips[0];
    const [pass] = effectPasses(clip, 0.5);
    expect(pass.shader.key).toBe(definitionOf(shaderOf(p))!.shader!.key);
    expect(pass.shader.source).toContain("uniform float amount;");
    expect(pass.uniforms).toEqual(expect.arrayContaining([{ name: "amount", type: "float", value: 0.6 }, { name: "time", type: "float", value: 0.5 }]));
    // The tab's compiler says it doesn't: the clip draws without it.
    provideShaderCheck(() => false);
    try {
      expect(effectPasses(clip, 0.5)).toEqual([]);
    } finally {
      provideShaderCheck(null);
    }
  });
});
