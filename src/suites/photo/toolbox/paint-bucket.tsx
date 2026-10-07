/**
 * The Paint Bucket (G, with the Gradient: docs/photo/tools/paint-bucket.md): a click fills the area of similar colour
 * around it with the foreground colour or a pattern. Its options bar is Photoshop's: Fill, Mode, Opacity, Tolerance,
 * Anti-alias, Contiguous, All Layers. The click's work is `flood-actions.ts`.
 */
import { Fragment } from "react";
import { PiPaintBucket } from "react-icons/pi";
import { FILL_MODES, type FillMode } from "@shared/photo/fill-compose";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PatternPicker } from "../layer-style/controls/pattern-picker";
import { Scrub, Toggle } from "../options-bar";
import { usePhotoDoc } from "../store";
import { useBucketOptions } from "./fill-options";
import { paintBucketAt } from "./flood-actions";
import { floodCursor, tellOutcome } from "./flood-ui";
import type { ToolKit } from "./kit";

const PERCENT = { min: 1, max: 100, step: 1, decimals: 0, unit: "%" };
const TOLERANCE = { min: 0, max: 255, step: 1, decimals: 0, unit: "" };
const NO_PATTERNS: never[] = [];

/** The Mode menu: the painting modes, in Photoshop's groups. */
export function FillModeSelect({ value, onChange }: { value: FillMode; onChange: (mode: FillMode) => void }) {
  return (
    <span className="flex items-center gap-1" data-option="Mode">
      <span className="text-muted-foreground">Mode</span>
      <Select value={value} onValueChange={(v) => onChange(v as FillMode)}>
        <SelectTrigger size="sm" className="h-6 w-32 text-xs" aria-label="Mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FILL_MODES.map((m, i) => (
            <Fragment key={m.id}>
              {i > 0 && FILL_MODES[i - 1].group !== m.group && <SelectSeparator />}
              <SelectItem value={m.id}>{m.label}</SelectItem>
            </Fragment>
          ))}
        </SelectContent>
      </Select>
    </span>
  );
}

function BucketOptionsBar() {
  const o = useBucketOptions();
  const set = useBucketOptions((s) => s.set);
  const patterns = usePhotoDoc((d) => d.patterns ?? NO_PATTERNS);
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs whitespace-nowrap" data-tool-options="paint-bucket">
      <span className="flex items-center gap-1" data-option="Fill">
        <span className="text-muted-foreground">Fill</span>
        <Select value={o.source} onValueChange={(v) => set({ source: v as "foreground" | "pattern" })}>
          <SelectTrigger size="sm" className="h-6 w-28 text-xs" aria-label="Fill">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="foreground">Foreground</SelectItem>
            <SelectItem value="pattern">Pattern</SelectItem>
          </SelectContent>
        </Select>
      </span>
      {o.source === "pattern" && (
        <span className="flex w-40 items-center" data-option="Pattern">
          <PatternPicker value={o.pattern} patterns={patterns} onChange={(pattern) => set({ pattern })} />
        </span>
      )}
      <FillModeSelect value={o.mode} onChange={(mode) => set({ mode })} />
      <Scrub label="Opacity" value={Math.round(o.opacity * 100)} display={PERCENT} onChange={(v) => set({ opacity: v / 100 })} />
      <Scrub label="Tolerance" value={o.tolerance} display={TOLERANCE} onChange={(v) => set({ tolerance: v })} />
      <Toggle label="Anti-alias" checked={o.antiAlias} onChange={(antiAlias) => set({ antiAlias })} />
      <Toggle label="Contiguous" checked={o.contiguous} onChange={(contiguous) => set({ contiguous })} />
      <Toggle label="All Layers" title="All Layers: decide by the photo as it shows (else the active layer alone); the fill still goes on the active layer" checked={o.allLayers} onChange={(allLayers) => set({ allLayers })} />
    </div>
  );
}

export const paintBucketKit: ToolKit = {
  Options: BucketOptionsBar,
  press: (e, docPoint) => {
    const at = docPoint(e.clientX, e.clientY);
    void paintBucketAt(at).then((outcome) => tellOutcome(outcome, "Paint Bucket"));
  },
  Overlay: floodCursor(PiPaintBucket, "paint-bucket"),
  cursor: "cursor-crosshair",
};
