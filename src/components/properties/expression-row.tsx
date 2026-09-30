/**
 * A property's expression (After Effects'), under its row: the script, what's wrong with it
 * if anything, ready-made ones to start from, and the pick-whip, dragged onto another
 * property of the clip to read its value (`prop("motion.rotation")`). Expressions are added
 * and removed by ⌥-clicking a property's stopwatch, or from its name's menu.
 */
import { useEffect, useRef, useState } from "react";
import { PiFunction, PiSpiral, PiX } from "react-icons/pi";
import { type EffectDefinition, canExpress, effectDefinition, effectValuesAt, expressionProblem, paramSpec, setExpression } from "@shared/effects";
import type { NumberSpec, ParamSpec } from "@shared/params";
import { getClip } from "@shared/timeline";
import type { Clip, Effect } from "@shared/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EditGesture } from "@/lib/edit-gesture";
import { startPointerDrag } from "@/lib/pointer-drag";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";

/** What a new expression says: the property's own value, so nothing changes until it's edited. */
export const NEW_EXPRESSION = "value";

/** Add an expression to a property, or take it away (⌥-click on its stopwatch). */
export function toggleExpression(clipId: string, effectId: string, key: string) {
  useEditor.getState().commit((p) => {
    const has = getClip(p, clipId)?.effects.find((e) => e.id === effectId)?.expressions?.[key] !== undefined;
    return setExpression(p, clipId, effectId, key, has ? null : NEW_EXPRESSION);
  });
}

/** Expressions to start from, sized for the property (a wiggle of a rotation is in degrees, of a scale a few percent). */
function snippets(spec: ParamSpec): { label: string; source: string }[] {
  const amount =
    spec.kind === "vec2"
      ? spec.space === "px" ? 20 : 0.02
      : Math.max(0.01, Math.round(Math.min((spec as NumberSpec).max - (spec as NumberSpec).min, (spec as NumberSpec).unit === "°" ? 3600 : 100) * 0.05 * 100) / 100);
  return [
    { label: "Wiggle", source: `wiggle(2, ${amount})` },
    { label: "Loop the keyframes", source: 'loopOut("cycle")' },
    { label: "Loop back and forth", source: 'loopOut("pingpong")' },
    { label: "Keep going past the last keyframe", source: 'loopOut("continue")' },
    { label: "Grow over time", source: spec.kind === "vec2" ? `value + [time * ${amount}, 0]` : `value + time * ${amount}` },
    { label: "Swing back and forth", source: spec.kind === "vec2" ? `value + [Math.sin(time * 3) * ${amount}, 0]` : `value + Math.sin(time * 3) * ${amount}` },
    { label: "Step at 12 frames a second", source: "posterizeTime(12); value" },
  ];
}

/** A value as the row shows it: short, rounded. */
function shown(v: unknown): string {
  const n = (x: number) => String(Math.round(x * 1000) / 1000);
  return typeof v === "number" ? n(v) : Array.isArray(v) ? `[${(v as number[]).map(n).join(", ")}]` : "";
}

export function ExpressionRow({ clip, effect, def, spec, time }: { clip: Clip; effect: Effect; def: EffectDefinition; spec: ParamSpec; time: number }) {
  const source = effect.expressions?.[spec.key] ?? "";
  const [text, setText] = useState(source);
  const area = useRef<HTMLTextAreaElement>(null);
  const gesture = useRef<EditGesture | null>(null);
  // Changed from elsewhere (undo, the assistant): show that.
  const typed = useRef(source);
  useEffect(() => {
    if (source !== typed.current) {
      typed.current = source;
      setText(source);
    }
  }, [source]);
  const finish = () => {
    gesture.current?.end();
    gesture.current = null;
  };
  useEffect(() => finish, []);

  const write = (next: string) => {
    setText(next);
    // An empty box is still an expression (its value passes through) until it's removed.
    const stored = next.trim() ? next : NEW_EXPRESSION;
    typed.current = stored;
    if (!gesture.current) {
      gesture.current = new EditGesture();
      gesture.current.begin();
    }
    gesture.current.apply((p) => setExpression(p, clip.id, effect.id, spec.key, stored));
  };
  /** Put text where the caret is (or over a new expression's "value"). */
  const insert = (snippet: string, replace = false) => {
    const el = area.current;
    const all = replace || text.trim() === "" || text.trim() === NEW_EXPRESSION;
    const [from, to] = all || !el ? [0, text.length] : [el.selectionStart, el.selectionEnd];
    write(text.slice(0, from) + snippet + text.slice(to));
    finish();
    el?.focus();
  };

  const problem = expressionProblem(def, effect, spec.key, time, clip);
  const result = problem ? "" : shown(effectValuesAt(def, effect, time, clip)[spec.key]);
  const label = `${spec.label} expression`;
  return (
    <div className="mb-1 ml-7 mr-2 rounded-md border bg-muted/30" data-expression={spec.key}>
      <div className="flex items-start gap-1 p-1">
        <textarea
          ref={area}
          aria-label={label}
          aria-invalid={!!problem}
          spellCheck={false}
          rows={Math.min(6, Math.max(1, text.split("\n").length))}
          value={text}
          onChange={(e) => write(e.target.value)}
          onBlur={() => {
            finish();
            if (!text.trim()) setText(NEW_EXPRESSION);
          }}
          // Typing here is the script, not shortcuts.
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          className={cn(
            "min-w-0 flex-1 resize-none rounded bg-transparent px-1.5 py-1 font-mono text-[11px] leading-4 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring/60",
            problem && "text-destructive",
          )}
        />
        <PickWhip clipId={clip.id} onPick={(path) => insert(`prop("${path}")`)} />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`${spec.label} expression examples`} className={ICON_BUTTON}>
              <PiFunction className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {snippets(spec).map((s) => (
              <DropdownMenuItem key={s.label} onSelect={() => insert(s.source, true)} className="flex-col items-start gap-0">
                <span>{s.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{s.source}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Remove ${label}`}
              className={ICON_BUTTON}
              onClick={() => {
                finish();
                useEditor.getState().commit((p) => setExpression(p, clip.id, effect.id, spec.key, null));
              }}
            >
              <PiX className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Remove the expression</TooltipContent>
        </Tooltip>
      </div>
      <p className={cn("truncate px-2.5 pb-1 text-[10px] leading-3.5", problem ? "text-destructive" : "text-muted-foreground")} data-expression-status>
        {problem ?? `= ${result}`}
      </p>
    </div>
  );
}

const ICON_BUTTON =
  "grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

/** Drag it onto another property's row to read that property: `onPick` gets its path ("effect.key"). */
function PickWhip({ clipId, onPick }: { clipId: string; onPick: (path: string) => void }) {
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const from = e.currentTarget.getBoundingClientRect();
    const [x0, y0] = [from.left + from.width / 2, from.top + from.height / 2];
    let svg: SVGSVGElement | null = null;
    let line: SVGLineElement | null = null;
    let hovered: HTMLElement | null = null;
    let picked: string | null = null;
    /** The property row under the pointer, when an expression can read it (a number, a point or a switch). */
    const targetAt = (x: number, y: number): { row: HTMLElement; path: string } | null => {
      const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-param]") ?? null;
      const effectId = row?.closest<HTMLElement>("[data-effect-id]")?.dataset.effectId;
      const key = row?.dataset.param;
      const effect = effectId ? getClip(useEditor.getState().project, clipId)?.effects.find((fx) => fx.id === effectId) : undefined;
      const def = effect && effectDefinition(effect.type);
      const spec = def && key ? paramSpec(def, key) : undefined;
      if (!row || !effect || !spec || !(canExpress(def!, spec) || spec.kind === "number" || spec.kind === "boolean")) return null;
      return { row, path: `${effect.id}.${spec.key}` };
    };
    const cleanup = () => {
      svg?.remove();
      hovered?.removeAttribute("data-pick-target");
    };
    startPointerDrag(e, {
      threshold: 2,
      cursor: "crosshair",
      onStart: () => {
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "pointer-events-none fixed inset-0 z-50 size-full");
        line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("class", "stroke-brand");
        line.setAttribute("stroke-width", "1.5");
        line.setAttribute("stroke-dasharray", "4 3");
        line.setAttribute("x1", String(x0));
        line.setAttribute("y1", String(y0));
        svg.append(line);
        document.body.append(svg);
      },
      onMove: (ev) => {
        line?.setAttribute("x2", String(ev.clientX));
        line?.setAttribute("y2", String(ev.clientY));
        const target = targetAt(ev.clientX, ev.clientY);
        picked = target?.path ?? null;
        if ((target?.row ?? null) !== hovered) {
          hovered?.removeAttribute("data-pick-target");
          target?.row.setAttribute("data-pick-target", "");
          hovered = target?.row ?? null;
        }
      },
      onEnd: () => {
        cleanup();
        if (picked) onPick(picked);
      },
      onCancel: cleanup,
    });
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="Pick-whip: drag onto another property to read it" onPointerDown={onPointerDown} className={cn(ICON_BUTTON, "cursor-crosshair touch-none hover:text-brand")}>
          <PiSpiral className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">Drag onto another property to link to it</TooltipContent>
    </Tooltip>
  );
}
