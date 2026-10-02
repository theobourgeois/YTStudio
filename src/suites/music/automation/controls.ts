/**
 * Every control of a song that can be automated, for the Automate window (`chooser.tsx`): the main
 * volume, each channel's volume and pan, each mixer track's fader, pan, stereo separation, sends and
 * effects' mixes, and the plugins whose own parameters the engine lists. Pure, so it's tested.
 */
import { controlOf, mixerTrackName, targetKey } from "@shared/music/automation";
import { type AutomationTarget, ECHO_CONTROLS, type MusicProject } from "@shared/music/types";

export interface ControlRow {
  key: string;
  target: AutomationTarget;
  /** "Volume", "Send to Insert 2". */
  name: string;
  /** What it belongs to: "Kick", "Insert 3". */
  owner: string;
  /** Automation clips already drive it. */
  automated: boolean;
}

export interface ControlGroup {
  title: string;
  rows: ControlRow[];
}

/** A plugin of the song: a plugin channel's instrument, or a mixer effect. Its parameters are the engine's to list. */
export interface PluginOwner {
  owner: "channel" | "effect";
  id: string;
  /** "Serum 2 (Lead)", "Pro-Q 4 (Insert 2)". */
  name: string;
}

/** The song's controls in groups: the song, the channels, the mixer (only tracks something plays into, and the master). */
export function songControls(song: MusicProject): ControlGroup[] {
  const automated = new Set(song.automations.map((a) => targetKey(a.target)));
  const row = (target: AutomationTarget): ControlRow => {
    const info = controlOf(song, target);
    return { key: targetKey(target), target, name: info.name, owner: info.owner, automated: automated.has(targetKey(target)) };
  };
  const groups: ControlGroup[] = [{ title: "Song", rows: [row({ kind: "main" })] }];
  groups.push({
    title: "Channels",
    rows: song.channels.flatMap((c) => [row({ kind: "channel", channel: c.id, control: "volume" }), row({ kind: "channel", channel: c.id, control: "pan" })]),
  });
  const used = new Set([...song.channels.map((c) => c.mixerTrack), ...song.mixer.tracks.flatMap((t) => (t.effects.some(Boolean) ? [t.id] : []))]);
  const mixer: ControlRow[] = [];
  for (const track of song.mixer.tracks) {
    const master = track.id === song.mixer.tracks[0].id;
    if (!master && !used.has(track.id) && track.name === null) continue;
    for (const control of ["volume", "pan", "stereo"] as const) mixer.push(row({ kind: "mixer", track: track.id, control }));
    for (const send of track.sends) if (send.to !== song.mixer.tracks[0].id || track.sends.length > 1) mixer.push(row({ kind: "send", track: track.id, to: send.to }));
    for (const effect of track.effects) {
      if (!effect) continue;
      mixer.push(row({ kind: "effect", effect: effect.id }));
      // Gross Beat's own: the slots playing and its two knobs.
      if (effect.grossBeat) for (const control of ["timeSlot", "volumeSlot", "timeMix", "volumeMix"] as const) mixer.push(row({ kind: "grossBeat", effect: effect.id, control }));
      // EchoBoy's: its knobs.
      if (effect.echoBoy) for (const control of ECHO_CONTROLS) mixer.push(row({ kind: "echoBoy", effect: effect.id, control }));
    }
  }
  groups.push({ title: "Mixer", rows: mixer });
  return groups;
}

/** The song's plugins, whose parameters can be automated: plugin channels' instruments, then the mixer's effects. */
export function pluginOwners(song: MusicProject): PluginOwner[] {
  const owners: PluginOwner[] = song.channels.flatMap((c) =>
    c.kind === "plugin" && c.plugin ? [{ owner: "channel" as const, id: c.id, name: c.plugin.name === c.name ? c.name : `${c.plugin.name} (${c.name})` }] : [],
  );
  for (const track of song.mixer.tracks)
    // (Gross Beat and EchoBoy are ours: their controls are among the song's, not a plugin's parameters.)
    for (const effect of track.effects) if (effect && !effect.grossBeat && !effect.echoBoy) owners.push({ owner: "effect", id: effect.id, name: `${effect.plugin.name} (${mixerTrackName(song, track.id)})` });
  return owners;
}

/** Whether a row matches what's typed: every word, in its name or its owner's, in any order. */
export function matches(query: string, ...texts: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = texts.join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}
