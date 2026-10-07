/**
 * The Move tool's options bar (Photoshop's, with Free Transform's): the transform modes (pressing one starts Free
 * Transform in it), and while a session is going its numbers for the active layer (X, Y, W, H, the angle and the
 * skew, each part of the session's one step) and its commit and cancel.
 */
import { cn } from "cn";
import { PiCheck, PiX } from "react-icons/pi";
import { MAX_SKEW } from "@shared/photo/project";
import { canDistort, setTransform } from "@shared/photo/edits";
import { type LayerTransform, isPlaced } from "@shared/photo/types";
import { type LayerWarp, WARP_STYLES, WARP_STYLE_LABELS, type WarpStyle, type WarpStyleSettings, styleWarp } from "@shared/photo/warp";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  { mode: "warp", label: "Warp", title: "Bend the layer by its grid's points, or by a Warp Style (images and pixel layers)" },
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
      {session && (mode === "warp" ? <WarpControls /> : <SessionNumbers />)}
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

const PERCENT_100 = { min: -100, max: 100, step: 1, decimals: 0, unit: "%" };

/** Warp's options (Photoshop's): its Warp Style, and a style's Bend, distortions and orientation; a custom warp's points are dragged on the canvas. */
function WarpControls() {
  const id = usePhotoUi((s) => (s.selectedLayerIds.length === 1 ? s.selectedLayerId : null));
  const layer = usePhotoDoc((d) => (id ? d.layers.find((x) => x.id === id) : undefined));
  if (!id || !layer || !isPlaced(layer) || !canDistort(layer)) return <span className="text-muted-foreground">Select one image or pixel layer to warp</span>;
  const warp = layer.transform.warp;
  const style = warp?.style ?? null;
  const set = (next: LayerWarp | undefined) => sessionGesture()?.apply((d) => setTransform(d, id, { warp: next }));
  const settings = (patch: Partial<WarpStyleSettings>): WarpStyleSettings => ({ style: "arc", bend: 50, horizontal: 0, vertical: 0, orientation: "horizontal", ...style, ...patch });
  const value = style ? style.style : warp ? "custom" : "none";
  return (
    <div className="flex items-center gap-2" data-warp-controls>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === "none") set(undefined);
          else if (v !== "custom") set(styleWarp(settings({ style: v as WarpStyle })));
        }}
      >
        <SelectTrigger size="sm" className="h-6 w-32 text-xs" aria-label="Warp style" data-warp-style>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          {warp && !style && <SelectItem value="custom">Custom</SelectItem>}
          {WARP_STYLES.map((w) => (
            <SelectItem key={w} value={w}>
              {WARP_STYLE_LABELS[w]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {style && (
        <>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            title="Bend across or down (Photoshop's Change the Warp Orientation)"
            onClick={() => set(styleWarp(settings({ orientation: style.orientation === "horizontal" ? "vertical" : "horizontal" })))}
            data-warp-orientation={style.orientation}
          >
            {style.orientation === "horizontal" ? "Horizontal" : "Vertical"}
          </Button>
          <Scrub label="Bend" value={style.bend} display={PERCENT_100} onChange={(bend) => set(styleWarp(settings({ bend })))} />
          <Scrub label="H" value={style.horizontal} display={PERCENT_100} onChange={(horizontal) => set(styleWarp(settings({ horizontal })))} />
          <Scrub label="V" value={style.vertical} display={PERCENT_100} onChange={(vertical) => set(styleWarp(settings({ vertical })))} />
        </>
      )}
    </div>
  );
}
