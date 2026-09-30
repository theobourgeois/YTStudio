/**
 * Masks (After Effects'): a path on a clip's own frame that the clip only shows inside of.
 * A clip can have any number; they combine in order (`compositor.ts` `MaskShape`). The
 * path is drawn and edited on the Program monitor with the pen tool; how they're drawn
 * is in `shared/masks.ts`.
 */
import type { EffectDefinition } from "../effects.ts";
import { PERCENT, PIXELS } from "../params.ts";
import { rectPath } from "../path.ts";

/** A new mask's path when nothing says otherwise: a rectangle a tenth in from the frame's edges. */
export const DEFAULT_MASK_PATH = rectPath(0.1, 0.1, 0.8, 0.8);

export const MASK: EffectDefinition = {
  type: "mask",
  label: "Mask",
  builtIn: false,
  stackable: "mask",
  // Anything with a picture, and adjustment layers (where they change what's below).
  appliesTo: (c) => c.visual && c.kind !== "camera" && c.kind !== "null",
  params: [
    // In fractions of the clip's frame, so it stays on the picture whatever size that's shown at.
    { kind: "path", key: "path", label: "Mask Path", default: DEFAULT_MASK_PATH },
    {
      kind: "choice",
      key: "mode",
      label: "Mode",
      default: "add",
      options: [
        { value: "add", label: "Add" },
        { value: "subtract", label: "Subtract" },
        { value: "intersect", label: "Intersect" },
      ],
    },
    { kind: "boolean", key: "inverted", label: "Inverted", default: false },
    // Px of the clip's frame as if it were 1080 px high, so a feather looks the same in the preview and the export.
    { kind: "number", key: "feather", label: "Feather", default: 0, min: 0, max: 2000, ...PIXELS, decimals: 1 },
    { kind: "number", key: "opacity", label: "Mask Opacity", default: 1, min: 0, max: 1, slider: true, ...PERCENT, decimals: 0 },
    { kind: "number", key: "expansion", label: "Expansion", default: 0, min: -2000, max: 2000, ...PIXELS, decimals: 1 },
  ],
};
