/**
 * The Background Eraser (E, in the Eraser group; docs/photo/tools/background-eraser.md): a brush that erases only
 * the colour under its centre (the hotspot), taking that colour out of the soft edges it leaves, Photoshop's.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { type EraseLimits, type EraseSampling, hexColour8 } from "@shared/photo/background-eraser";
import { useColours } from "../colours";
import { liveRenderer } from "../live";
import { currentDoc, currentSelection } from "../store";
import { usePhotoUi } from "../ui";
import { BrushRing, Choice, ConvertDialog, OptionsRow, PERCENT, SIZE, Scrub, Toggle, useConvertAsk } from "./brush-tool-ui";
import { dragStroke } from "./brush-press";
import { EffectStroke } from "./effect-stroke";
import { effectTargetOf } from "./effect-target";
import { useEraserOptions } from "./eraser-options";
import type { DocPointOf, ToolKit } from "./kit";

const SAMPLING: readonly { value: EraseSampling; label: string }[] = [
  { value: "continuous", label: "Continuous" },
  { value: "once", label: "Once" },
  { value: "swatch", label: "Background Swatch" },
];

const LIMITS: readonly { value: EraseLimits; label: string }[] = [
  { value: "discontiguous", label: "Discontiguous" },
  { value: "contiguous", label: "Contiguous" },
  { value: "edges", label: "Find Edges" },
];

const TOLERANCE = { min: 0, max: 100, step: 1, decimals: 0, unit: "%" };

/** A press: the active pixel layer's colour under the hotspot erased along the pointer, one undo step. */
function press(e: ReactPointerEvent<HTMLDivElement>, docPoint: DocPointOf) {
  const renderer = liveRenderer();
  const doc = currentDoc();
  if (!renderer || !doc) return;
  const ui = usePhotoUi.getState();
  const target = effectTargetOf(doc, ui.selectedLayerId, ui.target, "eraser");
  if ("error" in target) return void toast.error(target.error);
  if ("convert" in target) return useConvertAsk.getState().set({ layerId: target.convert, verb: "erase" });
  const o = useEraserOptions.getState();
  const { foreground, background } = useColours.getState();
  const erase = { options: o, swatch: hexColour8(background), foreground: hexColour8(foreground) };
  const brush = { radius: o.size / 2, hardness: o.hardness, strength: 1, spacing: 0.25 };
  dragStroke(e, docPoint, new EffectStroke(renderer, target.layerId, target.part, currentSelection(), brush, { kind: "erase" }, { erase }));
}

/** Its options: Size, Hardness, Sampling, Limits, Tolerance, Protect Foreground Color. */
function EraserOptions() {
  const o = useEraserOptions();
  const set = useEraserOptions((s) => s.set);
  return (
    <OptionsRow tool="backgroundEraser">
      <Scrub label="Size" value={o.size} display={SIZE} onChange={(size) => set({ size })} />
      <Scrub label="Hardness" value={Math.round(o.hardness * 100)} display={PERCENT} onChange={(v) => set({ hardness: v / 100 })} />
      <Choice label="Sampling" value={o.sampling} options={SAMPLING} onChange={(sampling) => set({ sampling })} width="w-36" />
      <Choice label="Limits" value={o.limits} options={LIMITS} onChange={(limits) => set({ limits })} />
      <Scrub label="Tolerance" value={o.tolerance} display={TOLERANCE} onChange={(tolerance) => set({ tolerance })} title="How far a colour may be from the sample and still be erased" />
      <Toggle label="Protect Foreground" title="Protect Foreground Color: never erase colours near the foreground colour" checked={o.protectForeground} onChange={(protectForeground) => set({ protectForeground })} />
    </OptionsRow>
  );
}

function EraserOverlay() {
  const size = useEraserOptions((s) => s.size);
  const hardness = useEraserOptions((s) => s.hardness);
  return (
    <>
      <BrushRing size={size} hardness={hardness} hotspot tool="backgroundEraser" />
      <ConvertDialog />
    </>
  );
}

export const backgroundEraserKit: ToolKit = {
  Options: EraserOptions,
  press,
  Overlay: EraserOverlay,
  cursor: "cursor-none",
  brush: { get: () => useEraserOptions.getState(), set: (patch) => useEraserOptions.getState().set(patch) },
};
