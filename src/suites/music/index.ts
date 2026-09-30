import { lazy } from "react";
import { PiWaveform } from "react-icons/pi";
import type { ClientSuite } from "../types";
import { songContext } from "./context";
import { useMusic } from "./store";
import { runMusicTool } from "./tools";

/** The music suite (a DAW). A shell for now: an empty song with its own assistant. */
export const musicSuite: ClientSuite<"music"> = {
  id: "music",
  icon: PiWaveform,
  tint: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  open: (projectId) => useMusic.getState().open(projectId),
  close: () => useMusic.getState().close(),
  // Songs aren't edited yet, so there's never anything unsaved.
  flush: async () => {},
  discard: () => {},
  Workspace: lazy(() => import("./workspace")),
  describe: (p) => `${p.tempo} BPM`,
  useLiveName: (projectId) => useMusic((s) => (s.projectId === projectId ? (s.song?.name ?? null) : null)),
  chat: {
    pitch: "can read your song. The music editor is new, so there's not much it can change yet.",
    useSuggestions: () => ["What can you do?"],
    ask: "help with your song",
    useContextLabel: () => useMusic((s) => (s.song ? songContext(s.song).label : "")),
    contextHint: "Sent with your message, so the assistant knows the song",
  },
  messageContext() {
    const { song } = useMusic.getState();
    return song ? songContext(song) : null;
  },
  runTool: runMusicTool,
};
