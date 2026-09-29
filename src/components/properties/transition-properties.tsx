/**
 * The selected transition's properties, like Premiere's Effect Controls for a
 * transition: its duration and alignment, then its own parameters, drawn
 * from their specs like any effect's.
 */
import { useEffect, useMemo, useRef } from "react";
import { PiTrash } from "react-icons/pi";
import { formatDuration } from "@shared/format";
import { clipName, outputSize } from "@shared/timeline";
import {
  type TransitionRef,
  type TransitionWindow,
  findWindow,
  resetTransitionParams,
  setTransitionParams,
} from "@shared/transition-windows";
import { ALIGNMENT_SPEC, DURATION_SPEC, TAG_LABELS, defaultTransitionParams } from "@shared/transitions";
import { sameValue } from "@shared/params";
import type { Clip } from "@shared/types";
import { drawThumbnail } from "@/components/transitions/thumbnails";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditor } from "@/stores/editor";
import type { DisplayContext } from "./display";
import { ParamRow, ResetButton, useParamEditors } from "./param-rows";

export function TransitionProperties({ transitionRef }: { transitionRef: TransitionRef }) {
  const project = useEditor((s) => s.project);
  const assets = useEditor((s) => s.assets);
  const w = useMemo(() => findWindow(project, transitionRef), [project, transitionRef]);
  const commit = useEditor((s) => s.commit);
  const editor = useParamEditors(
    (patch) => (p) => setTransitionParams(p, transitionRef, patch),
    (key) =>
      commit((p) => {
        if (key === DURATION_SPEC.key) return setTransitionParams(p, transitionRef, { duration: w?.def.duration ?? DURATION_SPEC.default });
        if (key === ALIGNMENT_SPEC.key) return setTransitionParams(p, transitionRef, { alignment: ALIGNMENT_SPEC.default });
        return resetTransitionParams(p, transitionRef, [key]);
      }),
  );
  if (!w) return null;

  const { def, transition } = w;
  const nameOf = (clip: Clip) => clipName(clip, assets.find((a) => a.id === clip.assetId));
  const where =
    w.from && w.to
      ? `${nameOf(w.from)} → ${nameOf(w.to)}`
      : w.to
        ? `Into ${nameOf(w.to)}`
        : `Out of ${nameOf(w.from!)}`;
  const canvas = outputSize(project.settings.aspectRatio, "1080p");
  const ctx: DisplayContext = { canvas, media: canvas };
  const timing = { duration: transition.duration, alignment: transition.alignment };
  const durationSpec = { ...DURATION_SPEC, default: def.duration };
  const timingSpecs = [durationSpec, ALIGNMENT_SPEC];
  const values = { ...defaultTransitionParams(def), ...transition.params };
  const changed = def.params.some((p) => !sameValue(values[p.key], p.default));

  return (
    <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
      <div className="flex items-center gap-2.5 border-b px-3 py-2.5">
        <Thumb window={w} />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium">{def.label}</p>
          <p className="truncate text-xs text-muted-foreground" title={where}>
            {where}
          </p>
        </div>
      </div>

      <section aria-label="Timing" className="border-b pt-1 pb-2">
        <SectionTitle>Timing</SectionTitle>
        <ParamRow spec={durationSpec} values={timing} specs={timingSpecs} ctx={ctx} edit={editor(DURATION_SPEC.key)} />
        {w.from && w.to && <ParamRow spec={ALIGNMENT_SPEC} values={timing} specs={timingSpecs} ctx={ctx} edit={editor(ALIGNMENT_SPEC.key)} />}
        {Math.abs(w.end - w.start - transition.duration) > 1e-3 && (
          <p className="px-3 pt-1 text-[11px] leading-relaxed text-muted-foreground">
            Plays for {formatDuration(w.end - w.start)}: shortened to fit the {w.from && w.to ? "clips" : "clip"}.
          </p>
        )}
      </section>

      {def.params.length > 0 && (
        <section aria-label={def.label} className="border-b pt-1 pb-2">
          <div className="flex items-center pr-1">
            <SectionTitle>{def.label}</SectionTitle>
            {changed && (
              <span className="ml-auto">
                <ResetButton label={`Reset ${def.label}`} onClick={() => commit((p) => resetTransitionParams(p, transitionRef))} />
              </span>
            )}
          </div>
          {def.params.map((spec) => (
            <ParamRow key={spec.key} spec={spec} values={values} specs={def.params} ctx={ctx} edit={editor(spec.key)} />
          ))}
        </section>
      )}

      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <span className="flex flex-wrap gap-1">
          {def.tags.map((t) => (
            <span key={t} className="rounded-full border px-2 text-[11px] leading-5 text-muted-foreground">
              {TAG_LABELS[t]}
            </span>
          ))}
        </span>
        <Button variant="outline" size="xs" onClick={() => useEditor.getState().deleteSelected()}>
          <PiTrash />
          Remove
        </Button>
      </div>
    </ScrollArea>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="flex h-8 items-center px-3 text-[13px] font-medium">{children}</h3>;
}

/** The transition's library thumbnail. */
function Thumb({ window: w }: { window: TransitionWindow }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) void drawThumbnail(w.def, 0.36, ref.current);
  }, [w.def]);
  return (
    <div className="h-9 w-[54px] shrink-0 overflow-hidden rounded-md bg-black ring-1 ring-border ring-inset">
      <canvas ref={ref} className="size-full" />
    </div>
  );
}
