import type { ExportResolution, Project, TextRaster } from "@shared/types";
import { isTextClip, motionAt, textStyleAt } from "@shared/effects";
import { isOnVideoTrack, outputSize } from "@shared/timeline";
import { layoutText, rasterizeText, textFont, textUnit } from "@/lib/text-render";
import { fontsSettled } from "@/stores/fonts";

/**
 * Draw every text clip at the export's size, the same way the preview does,
 * for the server to place like a still (as at the clip's first frame, since
 * the export doesn't animate yet). A text scaled up is drawn bigger so it
 * stays sharp.
 */
export async function drawTexts(project: Project, resolution: ExportResolution): Promise<Record<string, TextRaster>> {
  const clips = project.clips.filter((c) => isTextClip(c) && isOnVideoTrack(project, c));
  if (clips.length === 0) return {};
  await fontsSettled();
  const aspect = project.settings.aspectRatio;
  const unit = textUnit(outputSize(aspect, resolution), aspect);
  const out: Record<string, TextRaster> = {};
  for (const clip of clips) {
    const style = textStyleAt(clip, clip.in);
    // Installed fonts are usually ready at once; this waits for any that aren't
    // (before laying out, so the layout is measured in the real font).
    await document.fonts.load(textFont(style, unit), style.text || " ").catch(() => {});
    const layout = layoutText(style, unit);
    const { scaleX, scaleY } = motionAt(clip, clip.in);
    const canvas = document.createElement("canvas");
    rasterizeText(canvas, style, layout, unit, Math.max(1, Math.abs(scaleX), Math.abs(scaleY)));
    out[clip.id] = { png: canvas.toDataURL("image/png").split(",")[1], width: layout.width, height: layout.height };
  }
  return out;
}
