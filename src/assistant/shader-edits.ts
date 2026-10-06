/**
 * The assistant's shaders (`set_shader`, the visualizer's V6): its own GLSL as a Shader effect, compiled
 * before anything changes (through `EditEnv.compile`, the tab's compiler), so a shader that doesn't compile
 * comes back as its errors on the model's own lines rather than a broken effect.
 */
import { SHADER, addEffect, definitionOf, setParams, setShaderCode, shaderDefinition } from "@shared/effects";
import { effectShader } from "@shared/effect-gl";
import type { ParamSpec } from "@shared/params";
import { DIALECT_LABELS, MAX_SHADER_CODE, SHADER_DIALECTS, normalizeShaderCode, problemText } from "@shared/shader-code";
import { getClip } from "@shared/timeline";
import type { ParamValues, Project, ShaderDialect } from "@shared/types";
import { type EditEnv, type EditOutcome, checkParams, withNotes } from "./edits";
import { type Input, ToolError, oneOf, optObject, optString, string, strings, value } from "./input";
import { clipOf, effectOf } from "./lookup";

/** A declared parameter in a line: `amount (number 0..1, default 0.6)`. */
function paramText(spec: ParamSpec): string {
  switch (spec.kind) {
    case "number":
      return `${spec.key} (number ${spec.min}..${spec.max}, default ${spec.default})`;
    case "choice":
      return `${spec.key} (one of ${spec.options.map((o) => JSON.stringify(o.value)).join(", ")}, default ${JSON.stringify(spec.default)})`;
    case "source":
      return `${spec.key} (what it listens to: "master", "self" or "t:<audio track id>", default "master")`;
    default:
      return `${spec.key} (${spec.kind}, default ${value(spec.default)})`;
  }
}

export function setShaderTool(project: Project, input: Input, env: EditEnv): EditOutcome {
  const ids = strings(input, "clipIds");
  ids.forEach((id) => clipOf(project, id));
  const text = string(input, "code");
  if (text.length > MAX_SHADER_CODE) throw new ToolError(`The code is ${text.length} characters: ${MAX_SHADER_CODE} at most.`);
  const dialect: ShaderDialect = oneOf(input, "dialect", SHADER_DIALECTS) ?? "native";
  const code = normalizeShaderCode({ code: text, dialect })!;
  const def = shaderDefinition(code);
  const parsed = def.shader!.parsed!;
  const problems = [...parsed.problems, ...(env.compile?.(effectShader(def)!) ?? [])];
  if (problems.length) {
    throw new ToolError(
      `The shader doesn't compile, so nothing changed (lines are your code's):\n${problems.map(problemText).join("\n")}\n` +
        `See get_catalog "shader_api" for what a ${DIALECT_LABELS[dialect]} shader can use.`,
    );
  }
  const raw = optObject(input, "params") ?? {};
  const { values, notes } = checkParams(def.params, raw, def.label);
  const effectId = optString(input, "effect");
  let p = project;
  const placed = new Map<string, string>();
  if (effectId !== undefined) {
    for (const id of ids) {
      const { effect } = effectOf(clipOf(p, id), effectId);
      if (effect.type !== SHADER.type) throw new ToolError(`${effect.id} on ${id} isn't a Shader effect: leave out \`effect\` to add one.`);
      p = setShaderCode(p, id, effect.id, code);
      placed.set(id, effect.id);
    }
  } else {
    const res = addEffect(p, ids, SHADER.type, undefined, code);
    if (!res.added.size) throw new ToolError("A Shader effect only goes on clips on video tracks (add_layer kind solid makes one to draw on).");
    p = res.project;
    for (const [id, added] of res.added) placed.set(id, added);
    const skipped = ids.filter((id) => !placed.has(id));
    if (skipped.length) notes.push(`a Shader effect only goes on clips on video tracks, so skipped: ${skipped.join(", ")}`);
  }
  if (Object.keys(values).length) for (const [id, fx] of placed) p = setParams(p, id, fx, values as ParamValues);
  const first = [...placed][0];
  const own = first && getClip(p, first[0])?.effects.find((e) => e.id === first[1]);
  const shown = own ? definitionOf(own)! : def;
  const lines = [
    `${effectId === undefined ? "Added" : "Changed"} the ${DIALECT_LABELS[dialect]} shader "${shown.label}" (effect ids: ${[...placed].map(([c, e]) => `${c}: ${e}`).join(", ")}). It compiles.`,
    shown.params.length
      ? `Its parameters (set_properties / set_keyframes / link_param on that effect id): ${shown.params.map(paramText).join(", ")}.`
      : "It declares no parameters.",
    ...(parsed.audio ? ["It hears the sound: its `source` says what (the mix by default)."] : []),
    ...parsed.notes.map((n) => `Note: ${n}.`),
    "Look at it with view_frames.",
  ];
  return { project: p, text: withNotes(lines.join("\n"), notes) };
}
