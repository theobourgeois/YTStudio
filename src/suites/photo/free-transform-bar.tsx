/**
 * The Move tool's options bar (Photoshop's, with Free Transform's): the transform modes (pressing one starts Free
 * Transform in it), and while a session is going its numbers for the active layer (X, Y, W, H, the angle and the
 * skew, each part of the session's one step) and its commit and cancel.
 */
import { cn } from "cn";
import { PiCheck, PiX } from "react-icons/pi";
import { MAX_SKEW } from "@shared/photo/project";
import { setTransform } from "@shared/photo/edits";
import { type LayerTransform, isPlaced } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import type { TransformMode } from "./canvas/handles";
import { freeTransform, sessionGesture, useFreeTransform } from "./free-transform";
import { Scrub } from "./options-bar";
import { usePhotoDoc } from "./store";
import { usePhotoUi } from "./ui";

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const mod = MAC ? "⌘" : "Ctrl+";

const MODES: { mode: TransformMode; label: string; title: string }[] = [
  { mode: "scale", label: "Scale", title: "Handles scale (Shift: free proportions, Alt: from the centre)" },
  { mode: "skew", label: "Skew", title: `Edges slide along themselves (${mod}-drag an edge)` },
  { mode: "distort", label: "Distort", title: `Corners go anywhere (${mod}-drag a corner)` },
  { mode: "perspective", label: "Perspective", title: `A corner and its neighbour move apart or together (${MAC ? "⌘⌥⇧" : "Ctrl+Alt+Shift+"}-drag a corner)` },
];

const POSITION = { min: -1e6, max: 1e6, step: 1, decimals: 1, unit: "px" };
const PERCENT = { min: -100000, max: 100000, step: 1, decimals: 1, unit: "%" };
const ANGLE = { min: -180, max: 180, step: 1, decimals: 1, unit: "°" };
const SKEW = { min: -MAX_SKEW, max: MAX_SKEW, step: 1, decimals: 1, unit: "°" };

export function MoveOptionsBar() {
  const session = useFreeTransform((s) => s.session);
  const mode = session?.mode ?? null;
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs whitespace-nowrap" data-tool-options="move" data-free-transform={session ? mode : undefined}>
      <div className="flex items-center gap-0.5" role="group" aria-label="Transform mode">
        {MODES.map((m) => (
          <Button
            key={m.mode}
            size="sm"
            variant="ghost"
            title={m.title}
            aria-pressed={mode === m.mode}
            className={cn("h-6 px-2 text-xs", mode === m.mode && "bg-accent text-foreground")}
            onClick={() => freeTransform.setMode(m.mode)}
            data-transform-mode={m.mode}
          >
            {m.label}
          </Button>
        ))}
      </div>
      {session && <SessionNumbers />}
      {session && (
        <div className="flex items-center gap-0.5">
          <Button size="icon-sm" variant="ghost" title="Cancel the transform (Escape)" aria-label="Cancel transform" onClick={() => freeTransform.cancel()} data-transform-cancel>
            <PiX />
          </Button>
          <Button size="icon-sm" variant="ghost" title="Commit the transform (Enter)" aria-label="Commit transform" onClick={() => freeTransform.commit()} data-transform-commit>
            <PiCheck />
          </Button>
        </div>
      )}
    </div>
  );
}

/** The active layer's numbers while Free Transform is going (one layer: several share the box's handles only). */
function SessionNumbers() {
  const id = usePhotoUi((s) => (s.selectedLayerIds.length === 1 ? s.selectedLayerId : null));
  const t = usePhotoDoc((d) => {
    const l = id ? d.layers.find((x) => x.id === id) : undefined;
    return l && isPlaced(l) ? l.transform : null;
  });
  if (!id || !t) return null;
  const set = (patch: Partial<LayerTransform>) => sessionGesture()?.apply((d) => setTransform(d, id, patch));
  return (
    <div className="flex items-center gap-2" data-transform-numbers>
      <Scrub label="X" value={t.x} display={POSITION} onChange={(x) => set({ x })} />
      <Scrub label="Y" value={t.y} display={POSITION} onChange={(y) => set({ y })} />
      <Scrub label="W" value={t.scaleX * 100} display={PERCENT} onChange={(v) => set({ scaleX: v / 100 })} />
      <Scrub label="H" value={t.scaleY * 100} display={PERCENT} onChange={(v) => set({ scaleY: v / 100 })} />
      <Scrub label="Angle" value={t.rotation} display={ANGLE} onChange={(rotation) => set({ rotation })} />
      <Scrub label="Skew" value={t.skew ?? 0} display={SKEW} onChange={(skew) => set({ skew })} />
    </div>
  );
}
