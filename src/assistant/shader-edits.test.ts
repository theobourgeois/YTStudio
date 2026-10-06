import { describe, expect, it } from "vitest";
import { definitionOf, solidEffects } from "@shared/effects";
import { SHADER_EXAMPLES } from "@shared/shader-code";
import { MAIN_TRACK_ID, createDefaultProject, getClip } from "@shared/timeline";
import type { Project } from "@shared/types";
import { describeCatalog, describeClips } from "./describe";
import { EDITS, type EditEnv } from "./edits";

const base = createDefaultProject();
const project: Project = {
  ...base,
  tracks: [...base.tracks, { id: "a1", kind: "audio", name: "Music", muted: false }],
  clips: [
    { id: "solid", assetId: "", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 4, effects: solidEffects() },
    { id: "sound", assetId: "", trackId: "a1", start: 0, in: 0, out: 4, effects: solidEffects() },
  ],
};
/** A compiler that finds an error wherever the code says `oops`, on that line. */
const env: EditEnv = {
  assets: {},
  playhead: 0,
  compile: (shader) => {
    const lines = shader.source.slice(shader.source.indexOf("#line 1 1\n") + 10).split("\n");
    const at = lines.findIndex((l) => l.includes("oops"));
    return at < 0 ? [] : [{ line: at + 1, message: "'oops': undeclared identifier" }];
  },
};
const TUNNEL = `// @name "Tunnel"
// @param speed number 0 4 1
// @param tint color #33ccff
vec4 effect(vec2 uv) {
  vec2 p = aspect(uv);
  float r = length(p);
  float rings = 0.5 + 0.5 * sin(8.0 / max(r, 0.01) - time * speed * 4.0);
  return vec4(tint * rings * smoothstep(0.0, 0.3, r), 1.0);
}`;
const shaderOn = (p: Project, clipId: string, id = "shader") => getClip(p, clipId)!.effects.find((e) => e.id === id);

describe("set_shader", () => {
  it("adds a Shader effect with the code, says its parameters, and sets them", () => {
    const out = EDITS.set_shader(project, { clipIds: ["solid"], code: TUNNEL, params: { speed: 2 } }, env);
    const effect = shaderOn(out.project, "solid")!;
    expect(effect.shader).toEqual({ code: TUNNEL, dialect: "native" });
    expect(effect.params).toMatchObject({ speed: 2, tint: "#33ccff" });
    expect(out.text).toMatch(/Added the GLSL shader "Tunnel" \(effect ids: solid: shader\)\. It compiles\./);
    expect(out.text).toMatch(/speed \(number 0\.\.4, default 1\), tint \(color, default "#33ccff"\)/);
  });

  it("refuses code that doesn't compile, with its errors on its lines, changing nothing", () => {
    expect(() => EDITS.set_shader(project, { clipIds: ["solid"], code: "vec4 effect(vec2 uv) {\n  return oops;\n}" }, env)).toThrow(
      /doesn't compile, so nothing changed[\s\S]*Line 2: 'oops': undeclared identifier/,
    );
    expect(() => EDITS.set_shader(project, { clipIds: ["solid"], code: "// @param 9 number\nvec4 effect(vec2 uv) { return vec4(1.0); }" }, env)).toThrow(/Line 1: "9" isn't a name/);
    expect(() => EDITS.set_shader(project, { clipIds: ["solid"], code: TUNNEL, params: { nope: 1 } }, env)).toThrow(/has no parameter "nope"\. Its parameters: speed, tint/);
  });

  it("rewrites a Shader effect, keeping what the new code still declares", () => {
    const first = EDITS.set_shader(project, { clipIds: ["solid"], code: TUNNEL, params: { speed: 3 } }, env).project;
    const code = TUNNEL.replace("// @param tint color #33ccff", "// @param glow number 0 1 0.5").replace("tint *", "vec3(glow) *");
    const out = EDITS.set_shader(first, { clipIds: ["solid"], effect: "shader", code }, env);
    expect(shaderOn(out.project, "solid")!.params).toEqual({ speed: 3, glow: 0.5 });
    expect(out.text).toMatch(/^Changed/);
    expect(out.project.clips[0].effects.filter((e) => e.type === "shader")).toHaveLength(1);
    expect(() => EDITS.set_shader(first, { clipIds: ["solid"], effect: "motion", code }, env)).toThrow(/isn't a Shader effect/);
  });

  it("takes ISF and Shadertoy code, which hear the sound when they read it", () => {
    const audio = SHADER_EXAMPLES.find((e) => e.id === "shadertoy-audio")!.shader;
    const out = EDITS.set_shader(project, { clipIds: ["solid"], code: audio.code, dialect: "shadertoy" }, env);
    expect(shaderOn(out.project, "solid")!.shader!.dialect).toBe("shadertoy");
    expect(out.text).toMatch(/It hears the sound/);
    expect(() => EDITS.set_shader(project, { clipIds: ["solid"], code: "void main() {}", dialect: "isf" }, env)).toThrow(/JSON header/);
  });

  it("only goes on clips on video tracks", () => {
    expect(() => EDITS.set_shader(project, { clipIds: ["sound"], code: TUNNEL }, env)).toThrow(/only goes on clips on video tracks/);
  });

  it("can go in a batch", () => {
    const out = EDITS.batch(project, {
        steps: [
          { tool: "set_shader", input: { clipIds: ["solid"], code: TUNNEL } },
          { tool: "set_properties", input: { clipIds: ["solid"], effect: "shader", params: { speed: 4 } } },
        ],
      }, env);
    expect(shaderOn(out.project, "solid")!.params.speed).toBe(4);
  });

  it("is read back by get_clips, code and all", () => {
    const out = EDITS.set_shader(project, { clipIds: ["solid"], code: TUNNEL }, env);
    const [clip] = JSON.parse(describeClips(out.project, {}, ["solid"]));
    const effect = clip.effects.find((e: { type: string }) => e.type === "shader");
    expect(effect.shader).toMatchObject({ dialect: "native", name: "Tunnel", code: TUNNEL });
    expect(definitionOf(shaderOn(out.project, "solid")!)!.label).toBe("Tunnel");
  });

  it("is explained by the catalogue's shader_api", () => {
    const api = describeCatalog("shader_api");
    expect(api).toMatch(/vec4 effect\(vec2 uv\)/);
    expect(api).toMatch(/mainImage/);
    expect(api).toMatch(/IMG_THIS_PIXEL/);
    for (const ex of SHADER_EXAMPLES) expect(api).toContain(`--- ${ex.id}`);
  });
});
