import type { MusicProject } from "@shared/music/types";

/** What the assistant is told about the song with each message, and the chat's label for it. */
export function songContext(song: MusicProject): { context: string; label: string } {
  const { tempo, timeSignature } = song.settings;
  const timing = `${tempo} BPM, ${timeSignature.join("/")}`;
  return { context: `Song: "${song.name}", ${timing}. It has no tracks yet.`, label: timing };
}
