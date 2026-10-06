/**
 * A Shader effect's row in Properties, above its declared parameters: its dialect, whether it compiles (its
 * first problem if not) and Edit code, which opens the shader editor.
 */
import { useMemo } from "react";
import { PiCode, PiWarningCircle } from "react-icons/pi";
import type { EffectDefinition } from "@shared/effects";
import { DEFAULT_SHADER, DIALECT_LABELS, problemText } from "@shared/shader-code";
import type { Effect } from "@shared/types";
import { Button } from "@/components/ui/button";
import { shaderProblems } from "@/lib/shader-compiler";
import { useShaderEditor } from "@/stores/shader-editor";

export function ShaderRow({ clipId, effect, def }: { clipId: string; effect: Effect; def: EffectDefinition }) {
  const problems = useMemo(() => shaderProblems(def), [def]);
  const dialect = (effect.shader ?? DEFAULT_SHADER).dialect;
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 pb-1.5 text-[11px]" data-shader-row>
      <span className="shrink-0 text-muted-foreground">{DIALECT_LABELS[dialect]}</span>
      {problems.length > 0 && (
        <span className="flex min-w-0 items-center gap-1 text-destructive" title={problems.map(problemText).join("\n")} data-shader-problem>
          <PiWarningCircle className="size-3.5 shrink-0" />
          <span className="truncate">{problemText(problems[0])}</span>
        </span>
      )}
      <Button size="xs" variant="outline" className="ml-auto shrink-0" onClick={() => useShaderEditor.getState().open(clipId, effect.id)}>
        <PiCode /> Edit code
      </Button>
    </div>
  );
}

/** Whether a Shader effect has problems (Properties marks its header). */
export function useShaderBroken(def: EffectDefinition): boolean {
  return useMemo(() => !!def.shader?.parsed && shaderProblems(def).length > 0, [def]);
}
