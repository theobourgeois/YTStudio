/**
 * What the editor shows when a message is sent, for the assistant: the
 * playhead and selection (what "this clip" and "here" mean) in full, and a
 * short label the chat shows under the message.
 */
import { formatTime } from "@shared/format";
import { clipEnd, clipName, getClip, getTrack, projectDuration } from "@shared/timeline";
import type { MediaAsset, Project } from "@shared/types";
import type { TransitionRef } from "@shared/transition-windows";
import { range, secs } from "./input";

export interface EditorSnapshot {
  project: Project;
  assets: readonly MediaAsset[];
  playhead: number;
  selectedClipIds: readonly string[];
  selectedTransition: TransitionRef | null;
  selectedGap: { trackId: string; start: number; end: number } | null;
}

export function messageContext(s: EditorSnapshot): { context: string; label: string } {
  const assets = Object.fromEntries(s.assets.map((a) => [a.id, a]));
  const { project } = s;
  const lines = [
    `Video: "${project.name}", ${project.settings.aspectRatio}, ${project.settings.fps} fps, ${secs(projectDuration(project))}s long, ${project.clips.length} clips on ${project.tracks.length} tracks, ${s.assets.length} media files`,
    `Playhead: ${secs(s.playhead)}s`,
  ];
  let label = `Playhead ${formatTime(s.playhead)}`;
  const clips = s.selectedClipIds.flatMap((id) => getClip(project, id) ?? []);
  if (clips.length) {
    lines.push("Selected clips:");
    for (const c of clips) {
      lines.push(`- ${c.id} "${clipName(c, assets[c.assetId])}" on "${getTrack(project, c.trackId)?.name ?? c.trackId}", ${range(c.start, clipEnd(c))}`);
    }
    label = `${clips.length === 1 ? `“${clipName(clips[0], assets[clips[0].assetId])}”` : `${clips.length} clips`} · ${formatTime(s.playhead)}`;
  } else if (s.selectedTransition) {
    lines.push(`Selected: the transition at ${s.selectedTransition.clipId}'s ${s.selectedTransition.edge} edge`);
    label = `Transition · ${formatTime(s.playhead)}`;
  } else if (s.selectedGap) {
    lines.push(`Selected: the gap ${range(s.selectedGap.start, s.selectedGap.end)} on track ${s.selectedGap.trackId}`);
    label = `Gap · ${formatTime(s.playhead)}`;
  } else {
    lines.push("Nothing is selected.");
  }
  return { context: lines.join("\n"), label };
}
