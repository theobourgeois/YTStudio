import { PLACEMENT_NAMES, SHAPE_NAMES, setShape, slopeText, updateBands } from "@shared/music/pro-q";
import { canBeDynamic, shapeSlopes } from "@shared/music/pro-q-presets";
import { EQ_PLACEMENTS, EQ_SHAPES, type EqSlope, type ProQ } from "@shared/music/types";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { clearBandsDynamics, deleteBands, editEq, invertBands, makeBandsDynamic, selected, splitSelected } from "./actions";
import { ShapeIcon } from "./shape-icon";

/** The bands a band's menu acts on: the selection when it's in it, else the band alone (Pro-Q's). */
export function menuTargets(effectId: string, band: number): number[] {
  const now = selected(effectId);
  return now.includes(band) ? now : [band];
}

/**
 * A band's menu (right-click its dot, or ▾ beside its values): its shape, slope and placement, bypass,
 * Make Dynamic or Clear Dynamics, Invert Gain, Split, Gain-Q interaction, Delete.
 */
export function BandMenuItems({ effectId, pq, band: id }: { effectId: string; pq: ProQ; band: number }) {
  const band = pq.bands.find((b) => b.id === id);
  if (!band) return null;
  const ids = menuTargets(effectId, id);
  const several = ids.length > 1;
  const dynamic = band.range !== 0;
  return (
    <ContextMenuContent className="w-52" data-testid="pro-q-band-menu">
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ShapeIcon shape={band.shape} className="mr-2 size-3.5" /> {several ? "Shape (all)" : SHAPE_NAMES[band.shape]}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup value={band.shape} onValueChange={(v) => editEq(effectId, (p) => setShape(p, ids, v as typeof band.shape))}>
            {EQ_SHAPES.map((shape) => (
              <ContextMenuRadioItem key={shape} value={shape}>
                <ShapeIcon shape={shape} className="mr-2 size-3.5" /> {SHAPE_NAMES[shape]}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={band.shape === "flatTilt"}>Slope: {slopeText(band.slope)}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup value={String(band.slope)} onValueChange={(v) => editEq(effectId, (p) => updateBands(p, ids, { slope: (v === "brickwall" ? v : Number(v)) as EqSlope }))}>
            {shapeSlopes(band.shape).map((slope) => (
              <ContextMenuRadioItem key={slope} value={String(slope)}>
                {slopeText(slope)}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Stereo placement: {PLACEMENT_NAMES[band.placement]}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup value={band.placement} onValueChange={(v) => editEq(effectId, (p) => updateBands(p, ids, { placement: v as typeof band.placement }))}>
            {EQ_PLACEMENTS.map((placement) => (
              <ContextMenuRadioItem key={placement} value={placement}>
                {PLACEMENT_NAMES[placement]}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => editEq(effectId, (p) => updateBands(p, ids, { enabled: !band.enabled }))}>
        {band.enabled ? "Bypass" : "Enable"}
        <ContextMenuShortcut>Alt+click</ContextMenuShortcut>
      </ContextMenuItem>
      {dynamic ? (
        <ContextMenuItem onSelect={() => clearBandsDynamics(effectId, ids)}>Clear Dynamics</ContextMenuItem>
      ) : (
        <ContextMenuItem disabled={!canBeDynamic(band.shape)} onSelect={() => makeBandsDynamic(effectId, ids)}>
          Make Dynamic
          <ContextMenuShortcut>Alt+wheel</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => invertBands(effectId, ids)}>Invert Gain</ContextMenuItem>
      <ContextMenuItem onSelect={() => splitSelected(effectId, ids)}>{band.placement === "mid" || band.placement === "side" ? "Split into Mid and Side" : "Split into Left and Right"}</ContextMenuItem>
      {band.placement !== "stereo" && <ContextMenuItem onSelect={() => editEq(effectId, (p) => updateBands(p, ids, { placement: "stereo" }))}>Reset Placement</ContextMenuItem>}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => editEq(effectId, (p) => ({ ...p, gainQ: !p.gainQ }))}>
        {pq.gainQ ? "✓ " : ""}Gain-Q Interaction
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => deleteBands(effectId, ids)}>
        Delete{several ? ` ${ids.length} bands` : ""}
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
