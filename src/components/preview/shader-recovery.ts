/**
 * When the GPU is lost while the preview draws (Chromium's watchdog resets it when a shader runs too long:
 * a loop that never ends), the user's shader drawn newest is the likely cause: it's turned off (an undo step,
 * so it can be turned back on) and the user is told, so the restored preview doesn't hang again.
 */
import { toast } from "sonner";
import { definitionOf } from "@shared/effects";
import type { Effect, Project } from "@shared/types";
import { forgetDrawn, suspectShader } from "@/lib/shader-compiler";
import { useEditor } from "@/stores/editor";

/** Every enabled Shader effect drawing the shader `key`, turned off; the same project when there's none. */
export function turnOffShader(project: Project, key: string): Project {
  let changed = false;
  const clips = project.clips.map((clip) => {
    if (!clip.effects.some((e) => e.enabled && e.type === "shader" && definitionOf(e)?.shader?.key === key)) return clip;
    changed = true;
    return { ...clip, effects: clip.effects.map((e) => (e.enabled && e.type === "shader" && definitionOf(e)?.shader?.key === key ? { ...e, enabled: false } : e)) };
  });
  return changed ? { ...project, clips } : project;
}

/** The preview's WebGL context was lost: turn off the shader that probably did it, and say so. */
export function recoverFromLostContext(): void {
  const editor = useEditor.getState();
  const on = new Map<string, Effect>();
  for (const e of editor.project.clips.flatMap((c) => c.effects)) {
    const key = e.enabled && e.type === "shader" ? definitionOf(e)?.shader?.key : undefined;
    if (key) on.set(key, e);
  }
  const key = suspectShader(new Set(on.keys()));
  if (!key) return;
  forgetDrawn(key);
  const name = definitionOf(on.get(key)!)?.label ?? "Shader";
  editor.commit((p) => turnOffShader(p, key));
  toast.error(`"${name}" stopped the graphics card, so it's turned off`, {
    description: "A loop that never ends, or too much work for each pixel. Fix its code, then turn it back on (fx).",
    duration: 10_000,
  });
}
