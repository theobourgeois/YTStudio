import type { Clip, ExportResolution, Project, TextLayoutAt } from "@shared/types";
import { APPEARANCE, TEXT, atFrameRate, hasExpressions, isTextClip, textStyleAt } from "@shared/effects";
import { keyframeTimes } from "@shared/animation";
import { sequenceView } from "@shared/sequences";
import { isOnVideoTrack, outputSize } from "@shared/timeline";
import { layoutText, textFont, textUnit } from "@/lib/text-render";
import { fontsSettled } from "@/stores/fonts";

/** Most layouts sent for one text whose words or size are animated (sampled less often past that). */
const MAX_LAYOUTS = 3000;

/**
 * Lay out every text clip at the export's size, the same way the preview does: the server
 * has no way to measure text in the user's fonts, so the tab does, and the export's page
 * then draws each frame's text itself (its colours, its animators...) from the layout. A
 * text whose layout changes over time (its words, size or font are keyframed) gets one for
 * each change, each saying from when it holds.
 */
export async function layoutTexts(project: Project, resolution: ExportResolution): Promise<Record<string, TextLayoutAt[]>> {
  // The main sequence's texts and every nested sequence's (at the size the export draws that sequence).
  const views = [project, ...(project.sequences ?? []).map((s) => sequenceView(project, s.id))];
  const clips = views.flatMap((view) => view.clips.filter((c) => isTextClip(c) && isOnVideoTrack(view, c)).map((clip) => ({ clip, view })));
  if (clips.length === 0) return {};
  await fontsSettled();
  const out: Record<string, TextLayoutAt[]> = {};
  for (const { clip, view } of clips) {
    const aspect = view.settings.aspectRatio;
    const unit = textUnit(outputSize(aspect, resolution), aspect);
    const layouts: TextLayoutAt[] = [];
    let last = "";
    for (const time of lookTimes(clip, view.settings.fps)) {
      const style = atFrameRate(view.settings.fps, () => textStyleAt(clip, time));
      // Installed fonts are usually ready at once; this waits for any that aren't
      // (before laying out, so the layout is measured in the real font).
      await document.fonts.load(textFont(style, unit), style.text || " ").catch(() => {});
      const layout = layoutText(style, unit);
      const key = JSON.stringify(layout);
      if (key === last) continue;
      last = key;
      layouts.push({ layout, ...(layouts.length ? { from: time } : {}) });
    }
    out[clip.id] = layouts;
  }
  return out;
}

/**
 * Source times to lay a text out at: its first frame, and, while its Text or Appearance is
 * animated (they decide its size and margins), every output frame between its first and
 * last keyframes (the layout holds outside them), or with an expression every frame of it.
 */
function lookTimes(clip: Clip, fps: number): number[] {
  const animated = clip.effects.filter((e) => e.enabled && (e.type === TEXT.type || e.type === APPEARANCE.type));
  const keys = animated.flatMap((effect) => keyframeTimes(clip, { effectId: effect.id }));
  // An expression can change it at any frame of the clip.
  const always = animated.some(hasExpressions);
  if (keys.length === 0 && !always) return [clip.in];
  const from = always ? clip.in : Math.max(clip.in, Math.min(...keys));
  const to = always ? clip.out : Math.min(clip.out, Math.max(...keys));
  // The export's frames: frame f shows timeline time (f + 0.001) / fps.
  const first = Math.ceil((clip.start + (from - clip.in)) * fps - 1e-3);
  const last = Math.floor((clip.start + (to - clip.in)) * fps);
  const every = Math.max(1, Math.ceil((last - first + 1) / MAX_LAYOUTS));
  const times = [clip.in];
  for (let f = first; f <= last; f += every) times.push(clip.in + (f + 1e-3) / fps - clip.start);
  times.push(to);
  return times;
}
