/**
 * The Magic Eraser (E, in the Eraser group: docs/photo/tools/magic-eraser.md): a click erases the area of similar
 * colour around it, a white background in one click. A pixel layer's pixels go transparent; a placed image is erased
 * through its mask (given one), never rasterised. Its options bar is Photoshop's (Tolerance, Anti-alias, Contiguous,
 * Sample All Layers, Opacity) and our Defringe. The click's work is `flood-actions.ts`.
 */
import { PiSparkle } from "react-icons/pi";
import { Scrub, Toggle } from "../options-bar";
import { useMagicEraserOptions } from "./fill-options";
import { magicEraseAt } from "./flood-actions";
import { floodCursor, tellOutcome } from "./flood-ui";
import type { ToolKit } from "./kit";

const PERCENT = { min: 1, max: 100, step: 1, decimals: 0, unit: "%" };
const TOLERANCE = { min: 0, max: 255, step: 1, decimals: 0, unit: "" };

function MagicEraserOptionsBar() {
  const o = useMagicEraserOptions();
  const set = useMagicEraserOptions((s) => s.set);
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs whitespace-nowrap" data-tool-options="magic-eraser">
      <Scrub label="Tolerance" value={o.tolerance} display={TOLERANCE} onChange={(v) => set({ tolerance: v })} />
      <Toggle label="Anti-alias" checked={o.antiAlias} onChange={(antiAlias) => set({ antiAlias })} />
      <Toggle label="Contiguous" checked={o.contiguous} onChange={(contiguous) => set({ contiguous })} />
      <Toggle label="All Layers" title="Sample All Layers: decide by the photo as it shows (else the active layer alone); only the active layer is erased" checked={o.sampleAll} onChange={(sampleAll) => set({ sampleAll })} />
      <Scrub label="Opacity" value={Math.round(o.opacity * 100)} display={PERCENT} onChange={(v) => set({ opacity: v / 100 })} />
      <Toggle label="Defringe" title="Defringe: unmix the edge from the colour clicked, so no rim of the old background is left" checked={o.defringe} onChange={(defringe) => set({ defringe })} />
    </div>
  );
}

export const magicEraserKit: ToolKit = {
  Options: MagicEraserOptionsBar,
  press: (e, docPoint) => {
    const at = docPoint(e.clientX, e.clientY);
    void magicEraseAt(at).then((outcome) => tellOutcome(outcome, "Magic Eraser"));
  },
  Overlay: floodCursor(PiSparkle, "magic-eraser"),
  cursor: "cursor-crosshair",
};
