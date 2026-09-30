import { lazy } from "react";
import { PiWaveform } from "react-icons/pi";
import type { ClientSuite } from "../types";
import { songContext, songTiming } from "./context";
import { discardSong, flushSongs, useMusic } from "./store";
import { runMusicTool } from "./tools";

/** The music suite (a DAW, after FL Studio): the channel rack so far, with its own assistant. */
export const musicSuite: ClientSuite<"music"> = {
  id: "music",
  icon: PiWaveform,
  tint: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  open: (projectId) => useMusic.getState().open(projectId),
  close: () => useMusic.getState().close(),
  flush: () => flushSongs(),
  discard: (projectId) => discardSong(projectId),
  Workspace: lazy(() => import("./workspace")),
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
};
