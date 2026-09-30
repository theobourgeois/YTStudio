import { stepString } from "@shared/music/edits";
import type { MusicProject } from "@shared/music/types";
import type { MediaAsset } from "@shared/types";
import { describeChannel } from "./tool-edits";

/** The song in a line, for the chat's label and the sidebar. */
export const songTiming = (song: MusicProject) => `${song.settings.tempo} BPM, ${song.settings.timeSignature.join("/")}`;

/**
 * The whole song as text, for the assistant (`get_song`): settings, the rack's channels, every
 * pattern's steps drawn out, and the project's audio files.
 */
export function describeSong(song: MusicProject, assets: MediaAsset[], patternId: string | null): string {
  const sampleName = (id: string | null) => (id ? (assets.find((a) => a.id === id)?.name ?? null) : null);
  const shown = song.patterns.find((p) => p.id === patternId) ?? song.patterns[0];
  const used = new Set(song.channels.map((c) => c.sampleId));
  const lines = [
    `Song: "${song.name}", ${songTiming(song)}, swing ${Math.round(song.settings.swing * 100)}%.`,
    "",
    song.channels.length ? "Channels (in the rack's order):" : "No channels yet (add_channel makes one).",
    ...song.channels.map((c) => `- ${describeChannel(c, sampleName(c.sampleId))}`),
    "",
    "Patterns (x = a step on, - = off; a step is a sixteenth note):",
    ...song.patterns.flatMap((p) => [
      `- "${p.name}" (id ${p.id}, ${p.steps} steps)${p === shown ? ", shown in the rack: it's the one that plays" : ""}`,
      ...song.channels.map((c) => `    ${stepString(p, c.id)}  ${c.name}`),
    ]),
  ];
  const spare = assets.filter((a) => a.hasAudio && !used.has(a.id));
  if (spare.length) lines.push("", "Audio files in the project that no channel uses:", ...spare.map((a) => `- ${a.name} (mediaId ${a.id})`));
  return lines.join("\n");
}

/** What the assistant is told about the song with each message, and the chat's label for it. */
export function songContext(song: MusicProject, patternId: string | null): { context: string; label: string } {
  const shown = song.patterns.find((p) => p.id === patternId) ?? song.patterns[0];
  const channels = song.channels.length ? `${song.channels.length} channel${song.channels.length === 1 ? "" : "s"} (${song.channels.map((c) => c.name).join(", ")})` : "no channels yet";
  return {
    context: `Song: "${song.name}", ${songTiming(song)}, ${channels}. The channel rack shows the pattern "${shown.name}".`,
    label: songTiming(song),
  };
}
