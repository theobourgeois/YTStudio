/**
 * The shader editor (the visualizer's V6, docs/visualizer/README.md): a window on the video's desktop editing
 * one clip's Shader effect. The code recompiles as it's typed (the preview follows it; a burst of typing is
 * one undo step), its problems show on their lines and below, its declared parameters are listed (they're
 * set in Properties), and it starts from examples in each dialect. Save to Library keeps the clip with its
 * shader. The editor itself (CodeMirror) loads with the window.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { PiBooks, PiCheckCircle, PiCodeBlock, PiInfo, PiWarningCircle } from "react-icons/pi";
import { SHADER, definitionOf, setShaderCode } from "@shared/effects";
import { DEFAULT_SHADER, DIALECT_LABELS, SHADER_DIALECTS, SHADER_EXAMPLES, type ShaderProblem, problemText, shaderApi } from "@shared/shader-code";
import { getClip } from "@shared/timeline";
import type { ShaderCode, ShaderDialect } from "@shared/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FloatingWindow, centredOnDesktop } from "@/components/windows/floating-window";
import { useSaveToLibrary } from "@/components/library/library-dialogs";
import { EditGesture } from "@/lib/edit-gesture";
import { shaderProblems } from "@/lib/shader-compiler";
import { useEditor } from "@/stores/editor";
import { SHADER_WINDOW, useShaderEditor } from "@/stores/shader-editor";
import { cn } from "cn";
import type { CodeEditorHandle } from "./code-editor";

const CodeEditor = lazy(() => import("./code-editor"));

/** How long typing pauses before the code is compiled and drawn (ms), and before it's an undo step. */
const RECOMPILE_MS = 180;
const SETTLE_MS = 1200;

export function ShaderWindow() {
  const target = useShaderEditor((s) => s.target);
  if (!target) return null;
  return <ShaderWindowBody key={`${target.clipId}/${target.effectId}`} clipId={target.clipId} effectId={target.effectId} />;
}

function ShaderWindowBody({ clipId, effectId }: { clipId: string; effectId: string }) {
  const [initial] = useState(() => ({ ...centredOnDesktop(820, 560, "video"), width: 820, height: 560 }));
  const effect = useEditor((s) => getClip(s.project, clipId)?.effects.find((e) => e.id === effectId));
  const shader = effect?.type === SHADER.type ? (effect.shader ?? DEFAULT_SHADER) : null;
  const def = useMemo(() => (effect && shader ? definitionOf({ type: effect.type, shader }) : undefined), [effect, shader]);
  const problems = useMemo(() => (def ? shaderProblems(def) : []), [def]);
  const close = () => useShaderEditor.getState().close();
  const editor = useRef<CodeEditorHandle>(null);
  const [reference, setReference] = useState(false);

  // Typing: compiled after a pause, one undo step per burst.
  const gesture = useRef<EditGesture | null>(null);
  const timers = useRef<{ compile?: number; settle?: number }>({});
  const pending = useRef<string | null>(null);
  const dialect = shader?.dialect ?? "native";
  const flush = () => {
    window.clearTimeout(timers.current.compile);
    const text = pending.current;
    pending.current = null;
    if (text === null) return;
    if (!gesture.current) {
      gesture.current = new EditGesture();
      gesture.current.begin();
    }
    gesture.current.apply((p) => setShaderCode(p, clipId, effectId, { code: text, dialect }));
  };
  const settle = () => {
    flush();
    window.clearTimeout(timers.current.settle);
    gesture.current?.end();
    gesture.current = null;
  };
  const typed = (text: string) => {
    pending.current = text;
    window.clearTimeout(timers.current.compile);
    window.clearTimeout(timers.current.settle);
    timers.current.compile = window.setTimeout(flush, RECOMPILE_MS);
    timers.current.settle = window.setTimeout(settle, SETTLE_MS);
  };
  // Closing (or this effect going) keeps what was typed.
  const settleRef = useRef(settle);
  settleRef.current = settle;
  useEffect(() => () => settleRef.current(), []);

  /** A one-shot change of the whole code (a dialect, an example). */
  const replace = (code: ShaderCode) => {
    settle();
    useEditor.getState().commit((p) => setShaderCode(p, clipId, effectId, code));
  };

  const parsed = def?.shader?.parsed;
  const title = def ? `${def.label === SHADER.label ? "Shader" : `Shader: ${def.label}`}` : "Shader";

  return (
    <FloatingWindow id={SHADER_WINDOW} title={title} initial={initial} resizable={{ minWidth: 520, minHeight: 320 }} keepsKeys onClose={close}>
      {!shader || !def ? (
        <p className="p-4 text-xs text-muted-foreground" data-shader-gone>
          This shader is gone: its clip or the effect was deleted.
        </p>
      ) : (
        <div className="flex h-full min-h-0 flex-col text-xs" data-shader-window>
          <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
            <Select value={dialect} onValueChange={(d) => replace({ code: shader.code, dialect: d as ShaderDialect })}>
              <SelectTrigger size="sm" className="h-7 w-32" aria-label="Dialect">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHADER_DIALECTS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {DIALECT_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <PiCodeBlock /> Examples
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80">
                {SHADER_EXAMPLES.map((ex) => (
                  <DropdownMenuItem key={ex.id} onSelect={() => replace(ex.shader)} className="flex-col items-start gap-0.5">
                    <span>{ex.label}</span>
                    <span className="text-[11px] text-muted-foreground">{ex.description}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant={reference ? "secondary" : "ghost"} aria-pressed={reference} onClick={() => setReference((r) => !r)}>
              <PiInfo /> Reference
            </Button>
            <Status problems={problems} />
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => useSaveToLibrary.getState().open([clipId])}>
              <PiBooks /> Save to Library
            </Button>
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">
              <Suspense fallback={<div className="h-full bg-sunken" />}>
                <CodeEditor
                  ref={editor}
                  value={shader.code}
                  onChange={typed}
                  typing={() => gesture.current !== null || pending.current !== null}
                  problems={problems}
                  label="Shader code"
                />
              </Suspense>
            </div>
            {reference && (
              <div className="w-72 shrink-0 overflow-y-auto border-l bg-surface-1 p-2.5 leading-snug" data-shader-reference>
                {shaderApi(dialect).map((line, i) => (
                  <p key={i} className={cn("mb-1.5", line.startsWith("  ") ? "pl-2 text-muted-foreground" : "font-medium")}>
                    {line.trim()}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="max-h-36 shrink-0 overflow-y-auto border-t px-2 py-1.5" data-shader-problems>
            {problems.map((p, i) => (
              <button
                key={i}
                type="button"
                disabled={p.line === null}
                onClick={() => p.line !== null && editor.current?.goTo(p.line)}
                className="flex w-full cursor-pointer items-start gap-1.5 rounded px-1 py-0.5 text-left text-destructive hover:bg-accent/60 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <PiWarningCircle className="mt-px size-3.5 shrink-0" />
                <span>{problemText(p)}</span>
              </button>
            ))}
            {parsed?.notes.map((note, i) => (
              <p key={`n${i}`} className="flex items-start gap-1.5 px-1 py-0.5 text-muted-foreground">
                <PiInfo className="mt-px size-3.5 shrink-0" />
                {note}
              </p>
            ))}
            <p className="px-1 py-0.5 text-muted-foreground" data-shader-params>
              {def.params.length
                ? `Parameters (set in Properties): ${def.params.map((s) => s.label).join(", ")}`
                : "No parameters: declare some with // @param lines (see Reference)."}
            </p>
          </div>
        </div>
      )}
    </FloatingWindow>
  );
}

/** Whether the shader compiles, or how many problems it has. */
function Status({ problems }: { problems: readonly ShaderProblem[] }) {
  return problems.length ? (
    <span className="flex items-center gap-1 text-destructive" data-shader-status="problems">
      <PiWarningCircle className="size-3.5" />
      {problems.length === 1 ? "1 problem" : `${problems.length} problems`}
    </span>
  ) : (
    <span className="flex items-center gap-1 text-muted-foreground" data-shader-status="ok">
      <PiCheckCircle className="size-3.5 text-brand" />
      Compiles
    </span>
  );
}
