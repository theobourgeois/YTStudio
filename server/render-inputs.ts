/**
 * What drawing a project needs from the library, gathered once for an export or a preview render: each media
 * file's path and colour matrix, reversed copies (made now if they aren't yet), the signals of what reacts to
 * sound, and the plan made from them.
 */
import { signalAssets, usesSignals } from "../shared/audio-signals.ts";
import { hasMedia } from "../shared/effects.ts";
import type { SignalData } from "../shared/signals/format.ts";
import { allClips, isNestedClip } from "../shared/sequences.ts";
import type { Project, TextLayoutAt } from "../shared/types.ts";
import type { MediaLibrary } from "./media.ts";
import { probeColorSpace } from "./probe.ts";
import { type RenderAsset, type RenderOptions, type RenderPlan, planRender } from "./render.ts";
import { readSignals } from "./signals.ts";

export interface RenderInputs {
  plan: RenderPlan;
  assets: Record<string, RenderAsset>;
  /** The options the plan was made with (the signals filled in). */
  opts: RenderOptions;
}

/** Gather a project's media and plan it (null once `signal` aborts). Throws when media was deleted meanwhile. */
export async function renderInputs(
  library: MediaLibrary,
  project: Project,
  texts: Record<string, TextLayoutAt[]>,
  options: Omit<RenderOptions, "signals">,
  signal: AbortSignal,
): Promise<RenderInputs | null> {
  const byId = library.byId();
  const assets: Record<string, RenderAsset> = {};
  for (const clip of allClips(project)) {
    // Text, solids, shapes and adjustment layers are drawn by the compositor itself, and a nested sequence from its clips.
    if (!hasMedia(clip) || isNestedClip(clip)) continue;
    const asset = byId[clip.assetId];
    if (!asset) throw new Error("Some media was deleted before the render started.");
    if (assets[asset.id]) continue;
    const file = library.sourcePath(asset);
    const colorSpace = asset.kind === "video" && asset.hasVideo ? await probeColorSpace(file) : null;
    assets[asset.id] = { ...asset, path: file, colorSpace };
  }
  // Clips played backwards play their media's reversed copy (made now if it isn't yet).
  for (const clip of project.clips) {
    const asset = assets[clip.assetId];
    if (clip.reversed && asset && !asset.reversedPath) asset.reversedPath = await library.reversedPath(clip.assetId);
    if (signal.aborted) return null;
  }
  // What reacts to sound reads its files' signals (analysed now if they aren't yet).
  const signals = new Map<string, SignalData>();
  if (usesSignals(project)) {
    for (const id of signalAssets(project, (id) => !!assets[id]?.hasAudio)) {
      signals.set(id, await readSignals(await library.signalsPath(id)));
      if (signal.aborted) return null;
    }
  }
  const opts: RenderOptions = { ...options, signals };
  let plan = planRender(project, assets, opts, texts);
  // Media shown backwards elsewhere (a remapped clip running back, a reversed nest) needs its reversed copy too.
  if (plan.needsReversed.length) {
    for (const id of plan.needsReversed) {
      assets[id].reversedPath = await library.reversedPath(id);
      if (signal.aborted) return null;
    }
    plan = planRender(project, assets, opts, texts);
  }
  return { plan, assets, opts };
}
