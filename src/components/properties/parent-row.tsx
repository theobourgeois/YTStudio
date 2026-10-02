/**
 * A clip's Parent (After Effects' Parent & Link column): a menu of the clips it can follow,
 * and the pick-whip, dragged from here onto a clip in the timeline to parent to it.
 */
import { memo, useState } from "react";
import { PiCrosshairSimple, PiLinkBreak, PiSpiral } from "react-icons/pi";
import { clipKind } from "@shared/effects";
import { canParent } from "@shared/parenting";
import { clipEnd, clipName, getClip, videoTracks } from "@shared/timeline";
import type { Clip } from "@shared/types";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useEditor } from "@/stores/editor";

const NONE = "__none";

/** The clips `clip` could follow: null objects first, then what's on screen with it, top track first. */
function candidates(clipId: string) {
  const { project, assets } = useEditor.getState();
  const clip = getClip(project, clipId);
  if (!clip) return [];
  const order = new Map(videoTracks(project).map((t, i) => [t.id, i]));
  const assetById = new Map(assets.map((a) => [a.id, a]));
  return project.clips
    .filter((c) => order.has(c.trackId) && canParent(project, clip.id, c.id))
    .filter((c) => c.nullObject || (c.start < clipEnd(clip) && clipEnd(c) > clip.start))
    .sort((a, b) => Number(!!b.nullObject) - Number(!!a.nullObject) || order.get(a.trackId)! - order.get(b.trackId)! || a.start - b.start)
    .map((c) => ({ id: c.id, name: clipName(c, assetById.get(c.assetId)), isNull: !!c.nullObject }));
}

export const ParentRow = memo(function ParentRow({ clip }: { clip: Clip }) {
  const [open, setOpen] = useState(false);
  const parentId = clip.parent?.id ?? null;
  const parentName = useEditor((s) => {
    const parent = parentId ? getClip(s.project, parentId) : undefined;
    return parent ? clipName(parent, s.assets.find((a) => a.id === parent.assetId)) : null;
  });
  // Listed only while the menu is open (it looks through every clip).
  const options = open ? candidates(clip.id) : [];
  const setParent = (id: string | null) => useEditor.getState().setParent(selectedOr(clip.id), id);

  return (
    <div className="grid min-h-8 grid-cols-[1.25rem_5.5rem_minmax(0,1fr)_auto_1.25rem] items-center gap-x-1 pr-1 pl-1.5" data-param="parent">
      <PickWhip clipId={clip.id} />
      <span className="truncate text-xs text-muted-foreground">Parent</span>
      <Select value={parentId ?? NONE} onValueChange={(v) => setParent(v === NONE ? null : v)} open={open} onOpenChange={setOpen}>
        <SelectTrigger size="sm" aria-label="Parent" className="ml-1 h-7! w-full max-w-44 min-w-0 rounded px-2 text-xs shadow-none">
          <SelectValue>{parentName ?? "None"}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="max-h-80">
          <SelectItem value={NONE} className="text-xs">
            None
          </SelectItem>
          {options.length > 0 && <SelectSeparator />}
          {parentId && !options.some((o) => o.id === parentId) && (
            <SelectItem value={parentId} className="text-xs">
              {parentName}
            </SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id} className="text-xs">
              {o.isNull && <PiCrosshairSimple className="size-3" />}
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span />
      {parentId ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Unparent"
              onClick={() => setParent(null)}
              className="grid size-5 cursor-pointer place-items-center rounded text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <PiLinkBreak className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Unparent</TooltipContent>
        </Tooltip>
      ) : (
        <span />
      )}
    </div>
  );
});

/** The selected clips when `clipId` is one of them (they're parented together), else just it. */
function selectedOr(clipId: string): string[] {
  const { selectedClipIds } = useEditor.getState();
  return selectedClipIds.includes(clipId) ? selectedClipIds : [clipId];
}

/** Drag it onto a clip in the timeline to parent to that clip (a line follows the pointer). */
function PickWhip({ clipId }: { clipId: string }) {
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const from = e.currentTarget.getBoundingClientRect();
    const [x0, y0] = [from.left + from.width / 2, from.top + from.height / 2];
    let svg: SVGSVGElement | null = null;
    let line: SVGLineElement | null = null;
    let hovered: HTMLElement | null = null;
    const targetAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-clip-id]") ?? null;
      const id = el?.dataset.clipId;
      const { project } = useEditor.getState();
      return id && canParent(project, clipId, id) && clipKind(getClip(project, id)!) !== "camera" ? el : null;
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
        if (target !== hovered) {
          hovered?.removeAttribute("data-pick-target");
          target?.setAttribute("data-pick-target", "");
          hovered = target;
        }
      },
      onEnd: () => {
        const id = hovered?.dataset.clipId;
        cleanup();
        if (id) useEditor.getState().setParent(selectedOr(clipId), id);
      },
      onCancel: cleanup,
    });
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Pick-whip: drag onto a clip to parent to it"
          onPointerDown={onPointerDown}
          className="grid size-5 cursor-crosshair touch-none place-items-center rounded text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <PiSpiral className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">Drag onto a clip in the timeline to parent to it</TooltipContent>
    </Tooltip>
  );
}
