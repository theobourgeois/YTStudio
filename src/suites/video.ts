import { createElement, lazy } from "react";
import { api } from "@/lib/api";
import { layoutTexts } from "@/components/export/layout-texts";
import { PiFilmSlate } from "react-icons/pi";
import { formatDuration } from "@shared/format";
import type { Project } from "@shared/types";
import { messageContext } from "@/assistant/context";
import { docFor } from "@/assistant/doc";
import { runTool } from "@/assistant/tools";
import { acceptMediaFiles } from "@/components/media/import-media";
import VideoWorkspace from "@/components/workspace/video-workspace";
import { discardPendingSave, editorProjectId, flushAutosave, useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import type { ClientSuite } from "./types";
import { aspectOf, EmptyFrame } from "./video-sketch";
import { VideoSettings } from "./video-settings";

/**
 * The video editor, which predates suites: its store is `stores/editor.ts`, its workspace
 * `components/workspace/video-workspace.tsx` and its tools `src/assistant/`. This only plugs them in.
 */
export const videoSuite: ClientSuite<"video"> = {
  id: "video",
  async previewInputs(id) {
    return { texts: await layoutTexts(await api.getProject(id), "720p", 0.5) };
  },
  icon: PiFilmSlate,
  tint: "bg-red-500/12 text-red-600 dark:text-red-400",
  swatch: "bg-red-500 dark:bg-red-400",
  aspect: (p) => aspectOf(p.aspectRatio),
  sketch: (p) => (p.clipCount === 0 ? createElement(EmptyFrame, { aspect: aspectOf(p.aspectRatio) }) : null),
  preview: "video",
  open: (projectId) => useEditor.getState().openProject(projectId),
  close: () => useEditor.getState().closeProject(),
  flush: () => flushAutosave(),
  discard: (projectId) => discardPendingSave(projectId),
  Workspace: VideoWorkspace,
  // Now Playing's visualizer: the looks are the editor's effects (shared/live-looks.ts).
  NowPlaying: lazy(() => import("@/components/now-playing-view/view")),
  settings: {
    title: "Video editor",
    description: "How the video editor previews, how its timeline behaves, and how new clips start.",
    Panel: VideoSettings,
  },
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
  documents: {
    current: (projectId) => videoDocument(useEditor.getState(), projectId),
    useCurrent: (projectId) => useEditor((s) => videoDocument(s, projectId)),
    async snapshot(projectId) {
      const open = videoDocument(useEditor.getState(), projectId);
      if (open && editorProjectId() === projectId) return { doc: open, exact: true };
      // A video edited in the background is a copy kept here while it's being edited.
      return { doc: (await docFor(projectId)).document, exact: true };
    },
    restore(projectId, doc) {
      if (useEditor.getState().projectId === projectId) useEditor.getState().restoreDocument(doc as Project);
    },
  },
  // Images alone start a photo (the photo suite takes them); anything with video or sound starts a video.
  startsWith: (files) => {
    const media = acceptMediaFiles(files);
    return media.length && media.every(isImageFile) ? [] : media;
  },
  async importFiles(files) {
    const assets = await useEditor.getState().importFiles(files);
    useEditor.getState().addAssetsToTimeline(assets.map((a) => a.id));
  },
};

/** The whole video (every sequence) while it's open; mid-drag, as it was before the drag. */
function videoDocument(s: ReturnType<typeof useEditor.getState>, projectId: string): Project | null {
  return s.projectId === projectId && !s.loading ? (s.gestureDocument ?? s.document) : null;
}

/** An image file, by its type or its name. */
export const isImageFile = (file: File) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
