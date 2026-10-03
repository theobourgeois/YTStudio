import { scaleName } from "@shared/music/scales";
import { lengthOf, stepString } from "@shared/music/edits";
import { getMixerTrack } from "@shared/music/mixer";
import { MASTER_TRACK_ID } from "@shared/music/project";
import type { MusicProject } from "@shared/music/types";
import type { MediaAsset } from "@shared/types";
import { trackLabel } from "./mixer/tool-edits";
import { playlistSummary } from "./playlist/tool-edits";
import { describeChannel, describeLength } from "./tool-edits";

/** The song in a line, for the chat's label and the Home screen. */
export const songTiming = (song: MusicProject) =>
  `${song.settings.tempo} BPM, ${song.settings.timeSignature.join("/")}${song.settings.scale ? `, in ${scaleName(song.settings.scale)}` : ""}`;

/**
 * The whole song as text, for the assistant (`get_song`): settings, the rack's channels, every
 * pattern's steps drawn out, and the project's audio files.
 */
export function describeSong(song: MusicProject, assets: MediaAsset[], patternId: string | null): string {
  const sampleName = (id: string | null) => (id ? (assets.find((a) => a.id === id)?.name ?? null) : null);
  const shown = song.patterns.find((p) => p.id === patternId) ?? song.patterns[0];
  const used = new Set(song.channels.map((c) => c.sampleId));
  const lines = [
    `Song: "${song.name}", ${songTiming(song)}, swing ${Math.round(song.settings.swing * 100)}%, main volume ${Math.round(song.settings.volume * 100)}%.`,
    "",
    song.channels.length ? "Channels (in the rack's order):" : "No channels yet (add_channel makes one).",
    ...song.channels.map((c) => `- ${describeChannel(c, sampleName(c.sampleId))}${c.kind === "audio" ? " (an audio clip's channel: its clips play on the playlist, and it can have steps and notes too)" : ""}`),
    "",
    "Patterns (x = a step on, - = off; a step is a sixteenth note):",
    ...song.patterns.flatMap((p) => [
      `- "${p.name}" (id ${p.id}, ${describeLength(song, p)})${p === shown ? ", shown in the rack: it's the one that plays" : ""}`,
      ...song.channels.map((c) => `    ${stepString(p, c.id, lengthOf(song, p))}  ${c.name}`),
    ]),
  ];
  // Where each channel's sound goes, in short (get_mixer has the rest).
  const routed = song.channels.filter((c) => c.mixerTrack !== MASTER_TRACK_ID);
  const effects = song.mixer.tracks.reduce((n, t) => n + t.effects.filter(Boolean).length, 0);
  lines.push(
    "",
    routed.length
      ? `Mixer: ${routed.map((c) => `"${c.name}" → ${trackLabel(song, getMixerTrack(song, c.mixerTrack)!)}`).join(", ")}; the other channels play into the master.`
      : "Mixer: every channel plays into the master.",
    `${effects ? `${effects} effect${effects === 1 ? "" : "s"} in the mixer. ` : ""}get_mixer has every track's level, effects and sends.`,
    playlistSummary(song),
  );
  if (song.modulators.length) {
    const links = song.modulators.reduce((n, m) => n + m.links.length, 0);
    lines.push(`${song.modulators.length} modulator${song.modulators.length === 1 ? "" : "s"} moving ${links} control${links === 1 ? "" : "s"} (get_modulators).`);
  }
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
