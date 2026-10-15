/**
 * MilkDrop's looks (docs/now-playing.md, step 8): presets of Butterchurn's (MilkDrop 2 in WebGL 2), each a look whose
 * picture is Butterchurn's canvas drawn live (`MILKDROP_ASSET`: the view's `MilkDrop` draws the preset of the MilkDrop
 * look on screen, and the engine takes the canvas as it is each frame). The editor's energy, effects, frame and
 * transitions go over it as over any look. Which presets, and what each suits (`milkdrop-presets.ts`), were picked from
 * sheets of them on music (`scripts/milkdrop-sheet.ts`). Pure.
 */
import { defaultEffects } from "./effects.ts";
import { withIds } from "./live-kit.ts";
import type { LiveLook } from "./live-looks.ts";
import { MILKDROP_PRESETS, type MilkdropPreset } from "./milkdrop-presets.ts";
import type { MediaAsset } from "./types.ts";

export { MILKDROP_DIR, MILKDROP_PRESETS, type MilkdropPreset } from "./milkdrop-presets.ts";

/** The picture MilkDrop's looks show: Butterchurn's canvas (`PreviewSource.livePicture`). */
export const MILKDROP_ASSET = "milkdrop";
/** The size it's drawn at: 16:9, as the frame (more is slower, and MilkDrop was made for less). */
export const MILKDROP_SIZE = { width: 1280, height: 720 };

/** The picture of a MilkDrop look: Butterchurn's canvas, filling the frame. */
export function milkdropAsset(): MediaAsset {
  return {
    id: MILKDROP_ASSET,
    projectId: null,
    name: "MilkDrop",
    kind: "image",
    duration: Number.MAX_SAFE_INTEGER,
    width: MILKDROP_SIZE.width,
    height: MILKDROP_SIZE.height,
    fps: null,
    hasVideo: true,
    hasAudio: false,
    size: 0,
    createdAt: 0,
    status: "ready",
    // (Nothing to load: the engine takes the canvas.)
    src: "",
    poster: null,
    filmstrip: null,
    waveform: null,
  };
}

const byLook = new Map(MILKDROP_PRESETS.map((p) => [`md-${p.id}`, p]));

/** The preset a look draws, if it's a MilkDrop look. */
export const milkdropPreset = (lookId: string): MilkdropPreset | null => byLook.get(lookId) ?? null;

/** MilkDrop's looks: each its preset drawn live, filling the frame. */
export const MILKDROP_LOOKS: LiveLook[] = MILKDROP_PRESETS.map((p) => ({
  id: `md-${p.id}`,
  name: p.title,
  kind: "milkdrop",
  suits: p.suits,
  layers: () => [{ assetId: MILKDROP_ASSET, effects: withIds(defaultEffects()) }],
}));
