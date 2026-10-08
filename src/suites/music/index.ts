import { lazy } from "react";
import { PiWaveform } from "react-icons/pi";
import type { MusicProject } from "@shared/music/types";
import { api } from "@/lib/api";
import type { ClientSuite } from "../types";
import { songContext, songTiming } from "./context";
import { newSongOptions } from "./preferences";
import { discardSong, flushSongs, useMusic } from "./store";
import { runMusicTool } from "./tools";

/** The music suite (a DAW, after FL Studio): the channel rack so far, with its own assistant. */
export const musicSuite: ClientSuite<"music"> = {
  id: "music",
  icon: PiWaveform,
  tint: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  menus: ["Patterns", "Tools"],
  preview: "sound",
  open: (projectId) => useMusic.getState().open(projectId),
  close: () => useMusic.getState().close(),
  flush: () => flushSongs(),
  discard: (projectId) => discardSong(projectId),
  Workspace: lazy(() => import("./workspace")),
  settings: {
    title: "Music",
    description: "The music editor (the DAW): where its sound goes, and your plugins.",
    Panel: lazy(() => import("./settings")),
  },
  describe: (p) => `${p.tempo} BPM`,
  useLiveName: (projectId) => useMusic((s) => (s.projectId === projectId ? (s.history?.doc.name ?? null) : null)),
  chat: {
    pitch: "can read your song and program its drums: channels, steps, patterns, tempo and swing.",
    useSuggestions() {
      const hasChannels = useMusic((s) => (s.history?.doc.channels.length ?? 0) > 0);
      return hasChannels ? ["Make a four-on-the-floor house beat", "Add swing and soften every other hat", "Make a second pattern with a fill"] : ["Start a drum beat with the starter kit", "What can you do?"];
    },
    ask: "help with your song",
    useContextLabel: () => useMusic((s) => (s.history ? songTiming(s.history.doc) : "")),
    contextHint: "Sent with your message, so the assistant knows the song",
  },
  messageContext() {
    const { history, patternId } = useMusic.getState();
    return history ? songContext(history.doc, patternId) : null;
  },
  runTool: runMusicTool,
  documents: {
    current: (projectId) => openSong(useMusic.getState(), projectId),
    useCurrent: (projectId) => useMusic((s) => openSong(s, projectId)),
    async snapshot(projectId) {
      const open = openSong(useMusic.getState(), projectId);
      if (open) return { doc: open, exact: true };
      // A song that isn't open is edited on the server's copy (its tools load and save it).
      return { doc: await api.getDocument("music", projectId), exact: false };
    },
    restore(projectId, song) {
      if (useMusic.getState().projectId === projectId) useMusic.getState().restore(song as MusicProject);
    },
  },
  newProjectOptions: newSongOptions,
};

/** The song while it's open; mid-gesture, as it was before it. */
function openSong(s: ReturnType<typeof useMusic.getState>, projectId: string): MusicProject | null {
  return s.projectId === projectId && s.history ? (s.history.gestureBase ?? s.history.doc) : null;
}
