import type { Clip, ExportResolution, Project, TextRaster } from "@shared/types";
import { APPEARANCE, MOTION, TEXT, type TextStyle, findEffect, isTextClip, textStyleAt } from "@shared/effects";
import { keyframeTimes } from "@shared/animation";
import { isOnVideoTrack, outputSize } from "@shared/timeline";
import { layoutText, rasterizeText, textFont, textUnit } from "@/lib/text-render";
import { fontsSettled } from "@/stores/fonts";

/** Most drawings sent for one animated text (sampled less often past that). */
const MAX_DRAWINGS = 1500;

/**
 * Draw every text clip at the export's size, the same way the preview does,
 * for the server to place like a still (its Motion and Opacity are applied
 * per frame by the export). A text whose look is animated is drawn again at
 * each output frame where it changes; each drawing says from when it's shown.
 * A text scaled up is drawn bigger so it stays sharp.
 */
export async function drawTexts(project: Project, resolution: ExportResolution): Promise<Record<string, TextRaster[]>> {
  const clips = project.clips.filter((c) => isTextClip(c) && isOnVideoTrack(project, c));
  if (clips.length === 0) return {};
  await fontsSettled();
  const aspect = project.settings.aspectRatio;
  const unit = textUnit(outputSize(aspect, resolution), aspect);
  const out: Record<string, TextRaster[]> = {};
  for (const clip of clips) {
    const scale = Math.max(1, maxScale(clip));
    const rasters: TextRaster[] = [];
    let last = "";
    for (const time of lookTimes(clip, project.settings.fps)) {
      const style = textStyleAt(clip, time);
      const key = JSON.stringify(style);
      if (key === last) continue;
      last = key;
      rasters.push({ ...(await rasterize(style, unit, scale)), ...(rasters.length ? { from: time } : {}) });
    }
    out[clip.id] = rasters;
  }
  return out;
}

async function rasterize(style: TextStyle, unit: number, scale: number): Promise<Omit<TextRaster, "from">> {
  // Installed fonts are usually ready at once; this waits for any that aren't
  // (before laying out, so the layout is measured in the real font).
  await document.fonts.load(textFont(style, unit), style.text || " ").catch(() => {});
  const layout = layoutText(style, unit);
  const canvas = document.createElement("canvas");
  rasterizeText(canvas, style, layout, unit, scale);
  return { png: canvas.toDataURL("image/png").split(",")[1], width: layout.width, height: layout.height };
}

/**
 * Source times to draw a text at: its first frame, and, while its Text or
 * Appearance is animated, every output frame between its first and last
 * keyframes (the look holds outside them).
 */
function lookTimes(clip: Clip, fps: number): number[] {
  const keys = [TEXT, APPEARANCE].flatMap((def) => {
    const effect = findEffect(clip, def.type);
    return effect?.enabled ? keyframeTimes(clip, { effectId: effect.id }) : [];
  });
  if (keys.length === 0) return [clip.in];
  const from = Math.max(clip.in, Math.min(...keys));
  const to = Math.min(clip.out, Math.max(...keys));
  // The export's frames: frame f shows timeline time (f + 0.001) / fps.
  const first = Math.ceil((clip.start + (from - clip.in)) * fps - 1e-3);
  const last = Math.floor((clip.start + (to - clip.in)) * fps);
  const every = Math.max(1, Math.ceil((last - first + 1) / MAX_DRAWINGS));
  const times = [clip.in];
  for (let f = first; f <= last; f += every) times.push(clip.in + (f + 1e-3) / fps - clip.start);
  times.push(to);
  return times;
}

/** The largest scale the clip's Motion ever gives it (to draw it sharp enough). */
function maxScale(clip: Clip): number {
  const motion = findEffect(clip, MOTION.type);
  if (!motion?.enabled) return 1;
  let max = 0;
  for (const key of ["scale", "scaleWidth"]) {
    const keys = motion.keyframes?.[key];
    const values = keys?.length ? keys.map((k) => k.value as number) : [motion.params[key] as number];
    for (const v of values) max = Math.max(max, Math.abs(v));
  }
  return max;
}
