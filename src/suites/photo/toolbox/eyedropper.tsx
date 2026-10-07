/**
 * The Eyedropper (I: docs/photo/tools/eyedropper.md): a click on the canvas makes the colour there the foreground
 * colour (Alt: the background), a drag follows the pointer with Photoshop's sampling ring (`colour-sampling.tsx`).
 * Its options, Sample Size and Sample, are also how the colour pickers sample the canvas.
 */
import { SAMPLE_SIZES } from "@shared/photo/magic-wand";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EYEDROPPER_CURSOR } from "../canvas/cursors";
import { colourSwatch, startSampling } from "../colour-sampling";
import { Toggle } from "../options-bar";
import { useEyedropperOptions } from "./eyedropper-options";
import type { ToolKit } from "./kit";

function EyedropperOptionsBar() {
  const o = useEyedropperOptions();
  const set = useEyedropperOptions((s) => s.set);
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs whitespace-nowrap" data-tool-options="eyedropper">
      <span className="flex items-center gap-1" data-option="Sample Size">
        <span className="text-muted-foreground">Sample Size</span>
        <Select value={String(o.sampleSize)} onValueChange={(v) => set({ sampleSize: Number(v) })}>
          <SelectTrigger size="sm" className="h-6 w-32 text-xs" aria-label="Sample size">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SAMPLE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n === 1 ? "Point Sample" : `${n} × ${n} Average`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
      <span className="flex items-center gap-1" data-option="Sample">
        <span className="text-muted-foreground">Sample</span>
        <Select value={o.sampleAll ? "all" : "layer"} onValueChange={(v) => set({ sampleAll: v === "all" })}>
          <SelectTrigger size="sm" className="h-6 w-28 text-xs" aria-label="Sample">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="layer">Current Layer</SelectItem>
            <SelectItem value="all">All Layers</SelectItem>
          </SelectContent>
        </Select>
      </span>
      <Toggle label="Show Sampling Ring" checked={o.ring} onChange={(ring) => set({ ring })} />
    </div>
  );
}

export const eyedropperKit: ToolKit = {
  Options: EyedropperOptionsBar,
  press: (e, docPoint) => startSampling(e, docPoint, colourSwatch(e.altKey ? "background" : "foreground")),
  pointer: EYEDROPPER_CURSOR,
};
