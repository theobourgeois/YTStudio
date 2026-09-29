import type { ExportResolution, Project, TextRaster } from "@shared/types";
import { isTextClip, motionAt, textStyleAt } from "@shared/effects";
import { isOnVideoTrack, outputSize } from "@shared/timeline";
import { textUnit } from "@/components/preview/placement";
import { drawText, drawingScale, layoutText } from "@/lib/text-render";
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
    const layout = layoutText(style, unit);
    // Installed fonts are usually ready at once; this waits for any that aren't.
    await document.fonts.load(layout.font, style.text || " ").catch(() => {});
    const { scaleX, scaleY } = motionAt(clip, clip.in);
    const scale = drawingScale(layout, Math.max(1, Math.abs(scaleX), Math.abs(scaleY)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(layout.width * scale));
    canvas.height = Math.max(1, Math.ceil(layout.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't draw the text for the export.");
    drawText(ctx, style, layout, unit, scale);
    out[clip.id] = { png: canvas.toDataURL("image/png").split(",")[1], width: layout.width, height: layout.height };
  }
  return out;
}
