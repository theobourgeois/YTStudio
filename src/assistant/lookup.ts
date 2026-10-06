/** Finding what a tool call names (clips, their effects), with messages the model can act on. */
import { type EffectDefinition, effectDefinition } from "@shared/effects";
import { getClip } from "@shared/timeline";
import type { Clip, Effect, Project } from "@shared/types";
import { ToolError } from "./input";

export function clipOf(project: Project, id: string): Clip {
  const clip = getClip(project, id);
  if (!clip) throw new ToolError(`There's no clip "${id}". Call get_timeline for the current clip ids.`);
  return clip;
}

/** One of a clip's effects, by id (or by type when that's unambiguous). */
export function effectOf(clip: Clip, id: string): { effect: Effect; def: EffectDefinition } {
  const effect = clip.effects.find((e) => e.id === id) ?? clip.effects.find((e) => e.type === id);
  const def = effect && effectDefinition(effect.type);
  if (!effect || !def) {
    throw new ToolError(`Clip ${clip.id} has no effect "${id}". Its effects: ${clip.effects.map((e) => e.id).join(", ")}.`);
  }
  return { effect, def };
}
