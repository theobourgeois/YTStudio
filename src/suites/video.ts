import { PiFilmSlate } from "react-icons/pi";
import { formatDuration } from "@shared/format";
import { messageContext } from "@/assistant/context";
import { runTool } from "@/assistant/tools";
import VideoWorkspace from "@/components/workspace/video-workspace";
import { discardPendingSave, flushAutosave, useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import type { ClientSuite } from "./types";

/**
 * The video editor, which predates suites: its store is `stores/editor.ts`, its workspace
 * `components/workspace/video-workspace.tsx` and its tools `src/assistant/`. This only plugs them in.
 */
export const videoSuite: ClientSuite<"video"> = {
  id: "video",
  icon: PiFilmSlate,
  tint: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  open: (projectId) => useEditor.getState().openProject(projectId),
  close: () => useEditor.getState().closeProject(),
  flush: () => flushAutosave(),
  discard: (projectId) => discardPendingSave(projectId),
  Workspace: VideoWorkspace,
  describe: (p) => (p.clipCount === 0 ? "Empty" : `${formatDuration(p.duration)} · ${p.clipCount} clip${p.clipCount === 1 ? "" : "s"}`),
  useLiveName: (projectId) => useEditor((s) => (s.projectId === projectId ? s.project.name : null)),
  chat: {
    pitch: "can watch your footage, read what's said, and cut, arrange, caption and style your video.",
    useSuggestions() {
      const hasClips = useEditor((s) => s.project.clips.length > 0);
      const hasMedia = useEditor((s) => s.assets.length > 0);
      const selected = useEditor((s) => s.selectedClipIds.length);
      return !hasClips
        ? [hasMedia ? "Put my media on the timeline in the best order" : "What can you do?", "Organise my Library into folders"]
        : [
            ...(selected ? [`Add a slow zoom-in to the selected clip${selected === 1 ? "" : "s"}`] : []),
            "Cut out the silences and filler words",
            "Add captions",
            "Make the first 3 seconds grab attention",
            "Add a cross dissolve between every clip",
          ];
    },
    ask: "edit your video",
    useContextLabel() {
      const selected = useEditor((s) => s.selectedClipIds.length);
      const first = useEditor((s) => {
        const clip = s.project.clips.find((c) => c.id === s.selectedClipIds[0]);
        return clip ? (s.assets.find((a) => a.id === clip.assetId)?.name ?? "Text") : null;
      });
      // Rounded to tenths so it doesn't re-render every frame during playback.
      const tenth = usePlayback((s) => Math.round(s.time * 10));
      const t = tenth / 10;
      const time = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}.${Math.round((t % 1) * 10)}`;
      if (selected === 0) return `Playhead ${time}`;
      return `${selected === 1 ? `“${first}”` : `${selected} clips`} · ${time}`;
    },
    contextHint: "Sent with your message, so “this clip” and “here” make sense",
  },
  messageContext() {
    const editor = useEditor.getState();
    if (!editor.projectId) return null;
    return messageContext({
      project: editor.project,
      assets: editor.assets,
      playhead: usePlayback.getState().time,
      selectedClipIds: editor.selectedClipIds,
      selectedTransition: editor.selectedTransition,
      selectedGap: editor.selectedGap,
    });
  },
  runTool,
  async importFiles(files) {
    const assets = await useEditor.getState().importFiles(files);
    useEditor.getState().addAssetsToTimeline(assets.map((a) => a.id));
  },
};
