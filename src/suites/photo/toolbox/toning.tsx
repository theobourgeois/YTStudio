/**
 * Dodge, Burn and Sponge (O; docs/photo/tools/toning.md): brushes that lighten, darken or change the saturation of
 * the pixels they're painted over, Photoshop's. Alt held swaps Dodge and Burn. Each has its own brush and options.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { setMask } from "@shared/photo/edits";
import type { SpongeMode, ToneRange } from "@shared/photo/reference/toning";
import { liveRenderer } from "../live";
import { currentDoc, currentSelection, usePhoto } from "../store";
import { usePhotoUi } from "../ui";
import { BrushRing, Choice, ConvertDialog, OptionsRow, PERCENT, SIZE, STRENGTH, Scrub, Toggle, useConvertAsk } from "./brush-tool-ui";
import { dragStroke } from "./brush-press";
import { EffectStroke } from "./effect-stroke";
import { effectTargetOf } from "./effect-target";
import type { DocPointOf, ToolKit } from "./kit";
import { type ToningTool, toningBrush, toningStroke, useToning } from "./toning-options";

const VERBS: Record<ToningTool, string> = { dodge: "dodge", burn: "burn", sponge: "sponge" };

const RANGES: readonly { value: ToneRange; label: string }[] = [
  { value: "shadows", label: "Shadows" },
  { value: "midtones", label: "Midtones" },
  { value: "highlights", label: "Highlights" },
];

const MODES: readonly { value: SpongeMode; label: string }[] = [
  { value: "desaturate", label: "Desaturate" },
  { value: "saturate", label: "Saturate" },
];

/** A press: the active layer's pixels (or mask) toned along the pointer, one undo step. */
const press = (tool: ToningTool) => (e: ReactPointerEvent<HTMLDivElement>, docPoint: DocPointOf) => {
  const renderer = liveRenderer();
  const doc = currentDoc();
  if (!renderer || !doc) return;
  const ui = usePhotoUi.getState();
  const target = effectTargetOf(doc, ui.selectedLayerId, ui.target, "toning");
  if ("error" in target) return void toast.error(target.error);
  if ("convert" in target) return useConvertAsk.getState().set({ layerId: target.convert, verb: VERBS[tool] });
  if (target.addMask) {
    usePhoto.getState().commit((d) => setMask(d, target.layerId, null));
    ui.setTarget("mask");
  }
  const s = toningStroke(useToning.getState(), tool, e.altKey);
  const effect = { kind: "tone" as const, effect: s.effect, cap: s.cap, mask: target.part === "mask" };
  dragStroke(e, docPoint, new EffectStroke(renderer, target.layerId, target.part, currentSelection(), s.brush, effect, { airbrush: s.airbrush }));
};

/** Dodge's and Burn's options: Size, Hardness, Range, Exposure, Airbrush, Protect Tones. */
function DodgeBurnOptions({ tool }: { tool: "dodge" | "burn" }) {
  const o = useToning((s) => s[tool]);
  const set = (patch: Partial<typeof o>) => useToning.getState().setDodgeBurn(tool, patch);
  return (
    <OptionsRow tool={tool}>
      <Scrub label="Size" value={o.size} display={SIZE} onChange={(size) => set({ size })} />
      <Scrub label="Hardness" value={Math.round(o.hardness * 100)} display={PERCENT} onChange={(v) => set({ hardness: v / 100 })} />
      <Choice label="Range" value={o.range} options={RANGES} onChange={(range) => set({ range })} />
      <Scrub label="Exposure" value={Math.round(o.exposure * 100)} display={STRENGTH} onChange={(v) => set({ exposure: v / 100 })} title="How far a stroke goes (it never goes further, however long it scrubs)" />
      <Toggle label="Airbrush" title="Build up while the button is held, up to the Exposure" checked={o.airbrush} onChange={(airbrush) => set({ airbrush })} />
      <Toggle label="Protect Tones" title="Keep colours from shifting hue, and shadows and highlights from clipping" checked={o.protectTones} onChange={(protectTones) => set({ protectTones })} />
      <span className="text-muted-foreground/70">Alt: {tool === "dodge" ? "Burn" : "Dodge"}</span>
    </OptionsRow>
  );
}

/** Sponge's options: Size, Hardness, Mode, Flow, Airbrush, Vibrance. */
function SpongeOptions() {
  const o = useToning((s) => s.sponge);
  const set = useToning((s) => s.setSponge);
  return (
    <OptionsRow tool="sponge">
      <Scrub label="Size" value={o.size} display={SIZE} onChange={(size) => set({ size })} />
      <Scrub label="Hardness" value={Math.round(o.hardness * 100)} display={PERCENT} onChange={(v) => set({ hardness: v / 100 })} />
      <Choice label="Mode" value={o.mode} options={MODES} onChange={(mode) => set({ mode })} />
      <Scrub label="Flow" value={Math.round(o.flow * 100)} display={STRENGTH} onChange={(v) => set({ flow: v / 100 })} title="How fast the change builds (scrubbing keeps adding)" />
      <Toggle label="Airbrush" title="Build up while the button is held" checked={o.airbrush} onChange={(airbrush) => set({ airbrush })} />
      <Toggle label="Vibrance" title="Minimise clipping: muted colours change most, and nothing clips" checked={o.vibrance} onChange={(vibrance) => set({ vibrance })} />
    </OptionsRow>
  );
}

const overlay = (tool: ToningTool) =>
  function ToningOverlay() {
    const size = useToning((s) => s[tool].size);
    const hardness = useToning((s) => s[tool].hardness);
    return (
      <>
        <BrushRing size={size} hardness={hardness} tool={tool} />
        <ConvertDialog />
      </>
    );
  };

export const dodgeKit: ToolKit = { Options: () => <DodgeBurnOptions tool="dodge" />, press: press("dodge"), Overlay: overlay("dodge"), cursor: "cursor-none", brush: toningBrush("dodge") };
export const burnKit: ToolKit = { Options: () => <DodgeBurnOptions tool="burn" />, press: press("burn"), Overlay: overlay("burn"), cursor: "cursor-none", brush: toningBrush("burn") };
export const spongeKit: ToolKit = { Options: SpongeOptions, press: press("sponge"), Overlay: overlay("sponge"), cursor: "cursor-none", brush: toningBrush("sponge") };
