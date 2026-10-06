/**
 * Make visualizer, the music side (docs/visualizer/README.md, V5): what a song hands over to become a
 * video (`shared/handoff.ts`). The server renders its mix and a stem per mixer track; this works out the
 * rest from the song itself, exactly: which stems and channels there are (and what each probably is),
 * each channel's notes in seconds as the song plays them (muted ones left out), its beat from its
 * tempo map, and its arrangement as markers. Pure, and tested.
 *
 * Routes (`/api/music/visualizer`, `server/music/visualizer.ts`): POST `/` starts one (`MakeVisualizerRequest`,
 * answers the `VisualizerJob`), GET `/:id` follows it, POST `/:id/abort` stops its render.
 */
import { HANDOFF_COLORS, type HandoffNotes, type VisualizerOptions, guessRole, normalizeVisualizerOptions } from "../handoff.ts";
import type { ProjectSummary, SignalEvent, SignalRole } from "../types.ts";
import { type EngineSong, type PlayMode, compileSong } from "./compile.ts";
import { trackName } from "./mixer.ts";
import { clipContext, clipLength, trackAt } from "./playlist.ts";
import { MASTER_TRACK_ID } from "./project.ts";
import { heardMixer } from "./solo.ts";
import { songSeconds } from "./tempo.ts";
import { type MusicProject, PPQ } from "./types.ts";

/** A mixer track whose sound can be a stem. */
export interface StemSource {
  trackId: string;
  name: string;
  color: string;
  role?: SignalRole;
  /** The channels playing into it (their names). */
  channels: string[];
}

/** A channel whose notes can be hits. */
export interface NotesSource {
  channelId: string;
  name: string;
  color: string;
  role?: SignalRole;
  /** How many notes it plays. */
  notes: number;
}

/** What a song can hand over: its stems, its channels' notes, and the channels with no stem of their own. */
export interface VisualizerSources {
  /** The playlist, or (a song with no clips yet) the pattern shown, played once. */
  mode: PlayMode;
  /** Seconds. */
  length: number;
  stems: StemSource[];
  channels: NotesSource[];
  /** Channels heard straight through the master: they're in the mix, but no stem is theirs alone. */
  direct: string[];
}

/** What the user chose in the Make visualizer window: which stems and channels' notes, their roles, and the video's options. */
export interface VisualizerChoice {
  /** Mixer track ids. */
  stems: string[];
  /** Channel ids. */
  channels: string[];
  /** By track or channel id: what it is ("none": nothing in particular). Absent: the guess. */
  roles: Record<string, SignalRole | "none">;
  video: VisualizerOptions;
}

/** `POST /api/music/visualizer`: make a video project of the song as it is now. */
export interface MakeVisualizerRequest {
  projectId: string;
  song: MusicProject;
  /** The pattern shown (played when the song has no playlist clips). */
  patternId: string | null;
  choice: VisualizerChoice;
}

/** A song being made into a video: rendered by the engine, then the video project made of it. */
export interface VisualizerJob {
  id: string;
  /** The song's project. */
  projectId: string;
  state: "rendering" | "making" | "done" | "failed" | "aborted";
  /** 0..1 of the render. */
  rendered: number;
  /** What couldn't be heard (a plugin not installed): the names. */
  missing: string[];
  error: string | null;
  /** The new video project, once it's made. */
  project: ProjectSummary | null;
}

/** The arrangement's sections are this many bars apart at least. */
const MIN_SECTION_BARS = 2;

/** The song played once as the visualizer hears it: the playlist, or the pattern shown when there's nothing on it. */
export function visualizerMode(song: MusicProject): PlayMode {
  return song.playlist.clips.some((c) => !c.muted) ? "song" : "pattern";
}

/** Seconds from the song's start to one of its ticks (song mode: through its tempo clips). */
function secondsOf(song: MusicProject, mode: PlayMode) {
  return mode === "song" ? (tick: number) => songSeconds(song, tick) : (tick: number) => (tick * 60) / (song.settings.tempo * PPQ);
}

/** A compiled song's engine ticks (its tempo clips already applied) as seconds. */
const engineSeconds = (compiled: EngineSong, tick: number) => (tick * 60) / (compiled.tempo * compiled.ppq);

/** Whether a compiled channel is heard: not muted, on a track that isn't (`compileSong` keeps them, silent). */
function audible(compiled: EngineSong, index: number): boolean {
  const channel = compiled.channels[index];
  if (!channel || channel.gainLeft + channel.gainRight <= 0) return false;
  const gains = compiled.tracks[channel.track]?.gains;
  return !!gains && gains.some((g) => g !== 0);
}

/** A colour for the nth thing handed over without one. */
const colourOf = (color: string | null | undefined, i: number) => (color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : HANDOFF_COLORS[i % HANDOFF_COLORS.length]);

/** What `song` can hand over (`patternId`: the pattern shown). */
export function visualizerSources(song: MusicProject, patternId: string | null): VisualizerSources {
  const mode = visualizerMode(song);
  const compiled = compileSong(song, patternId, null, mode);
  const counts = new Map<number, number>();
  for (const note of compiled.notes) if (audible(compiled, note.channel)) counts.set(note.channel, (counts.get(note.channel) ?? 0) + 1);
  const clipped = new Set(mode === "song" ? compiled.audioClips.map((c) => c.channel) : []);
  // Channels that make a sound: notes, or (song mode) audio clips.
  const sounding = song.channels.filter((_, i) => (counts.has(i) || clipped.has(i)) && audible(compiled, i));

  // Their tracks, and every track they send into (a bus), but the master: each is a stem.
  const fed = new Map<string, string[]>();
  for (const channel of sounding) fed.set(channel.mixerTrack, [...(fed.get(channel.mixerTrack) ?? []), channel.name]);
  const byId = new Map(song.mixer.tracks.map((t) => [t.id, t]));
  const queue = [...fed.keys()];
  while (queue.length) {
    const track = byId.get(queue.shift()!);
    for (const send of track?.sends ?? []) {
      if (send.level <= 0 || fed.has(send.to)) continue;
      fed.set(send.to, []);
      queue.push(send.to);
    }
  }
  // Soloed out is as silent as muted.
  const silent = new Set(heardMixer(song).mixer.tracks.filter((t) => t.muted).map((t) => t.id));
  const stems: StemSource[] = song.mixer.tracks
    .filter((t) => t.id !== MASTER_TRACK_ID && fed.has(t.id) && !silent.has(t.id))
    .map((t, i) => {
      const channels = fed.get(t.id)!;
      const guessed = guessRole(t.name) ?? (channels.length ? sameRole(channels) : undefined);
      return { trackId: t.id, name: trackName(song, t.id), color: colourOf(t.color, i), ...(guessed && { role: guessed }), channels };
    });
  const channels: NotesSource[] = song.channels.flatMap((c, i) => {
    const notes = counts.get(i);
    if (!notes) return [];
    const role = guessRole(c.name);
    return [{ channelId: c.id, name: c.name, color: colourOf(c.color, i), ...(role && { role }), notes }];
  });
  return {
    mode,
    length: engineSeconds(compiled, compiled.loopTicks),
    stems,
    channels,
    direct: sounding.filter((c) => c.mixerTrack === MASTER_TRACK_ID).map((c) => c.name),
  };
}

/** The role all of `names` share, if they do. */
function sameRole(names: string[]): SignalRole | undefined {
  const roles = new Set(names.map((n) => guessRole(n)));
  return roles.size === 1 ? [...roles][0] : undefined;
}

/** The first choice offered: every stem and every channel's notes, as guessed. */
export function defaultChoice(sources: VisualizerSources, video: VisualizerOptions): VisualizerChoice {
  return { stems: sources.stems.map((s) => s.trackId), channels: sources.channels.map((c) => c.channelId), roles: {}, video };
}

const ROLES: readonly (SignalRole | "none")[] = ["kick", "snare", "hats", "bass", "vocal", "lead", "mix", "none"];

/** A choice from a request (untrusted), against the song's own tracks and channels. */
export function normalizeVisualizerChoice(raw: unknown, song: MusicProject): VisualizerChoice {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tracks = new Set(song.mixer.tracks.map((t) => t.id));
  const channels = new Set(song.channels.map((c) => c.id));
  const ids = (list: unknown, known: Set<string>) => (Array.isArray(list) ? [...new Set(list.filter((id): id is string => typeof id === "string" && known.has(id)))] : []);
  const roles: VisualizerChoice["roles"] = {};
  if (v.roles && typeof v.roles === "object") {
    for (const [id, role] of Object.entries(v.roles)) if ((tracks.has(id) || channels.has(id)) && ROLES.includes(role as SignalRole)) roles[id] = role as SignalRole | "none";
  }
  return { stems: ids(v.stems, tracks), channels: ids(v.channels, channels), roles, video: normalizeVisualizerOptions(v.video) };
}

/** A role chosen, else guessed. */
const roleOf = (choice: VisualizerChoice, id: string, guessed: SignalRole | undefined) => {
  const chosen = choice.roles[id];
  return chosen === "none" ? undefined : (chosen ?? guessed);
};

/** The stems chosen, with their roles, in the mixer's order. */
export function chosenStems(sources: VisualizerSources, choice: VisualizerChoice): (StemSource & { role?: SignalRole })[] {
  return sources.stems.filter((s) => choice.stems.includes(s.trackId)).map(({ role, ...s }) => {
    const chosen = roleOf(choice, s.trackId, role);
    return { ...s, ...(chosen && { role: chosen }) };
  });
}

/** Each chosen channel's notes as hits, in seconds from the song's start, as the song plays them. */
export function songNotes(song: MusicProject, patternId: string | null, sources: VisualizerSources, choice: VisualizerChoice): HandoffNotes[] {
  const compiled = compileSong(song, patternId, null, sources.mode);
  const events = new Map<number, SignalEvent[]>();
  const round = (s: number) => Math.round(s * 1e4) / 1e4;
  for (const note of compiled.notes) {
    if (!audible(compiled, note.channel)) continue;
    const list = events.get(note.channel) ?? [];
    const time = engineSeconds(compiled, note.tick);
    list.push({ time: round(time), velocity: Math.min(1, Math.max(0, note.velocity)), length: round(engineSeconds(compiled, note.tick + note.length) - time), key: note.key });
    events.set(note.channel, list);
  }
  return sources.channels
    .filter((c) => choice.channels.includes(c.channelId))
    .map((c) => {
      const index = song.channels.findIndex((ch) => ch.id === c.channelId);
      const role = roleOf(choice, c.channelId, c.role);
      return { channel: c.name, color: c.color, ...(role && { role }), events: (events.get(index) ?? []).sort((a, b) => a.time - b.time) };
    })
    .filter((n) => n.events.length);
}

/** Every beat from the song's start to `until` seconds (past its end, at its last tempo), in seconds. */
export function songBeats(song: MusicProject, mode: PlayMode, until: number): number[] {
  const seconds = secondsOf(song, mode);
  const beatTicks = (PPQ * 4) / song.settings.timeSignature[1];
  const beats: number[] = [];
  for (let k = 0; beats.length < 100_000; k++) {
    const t = seconds(k * beatTicks);
    if (t > until + 1e-6) break;
    beats.push(Math.round(t * 1e4) / 1e4);
  }
  return beats;
}

/**
 * The arrangement as markers (song mode): the playlist's own markers, and where what plays changes (the
 * set of patterns heard at a bar's start), named after what's heard then, `MIN_SECTION_BARS` apart at least.
 */
export function songMarkers(song: MusicProject, mode: PlayMode): { time: number; label: string }[] {
  if (mode !== "song") return [];
  const seconds = secondsOf(song, mode);
  const ctx = clipContext(song);
  const names = new Map(song.patterns.map((p) => [p.id, p.name]));
  const own = (song.playlist.markers ?? []).filter((m) => m.kind === "marker").map((m) => ({ tick: m.tick, label: m.name }));
  const ownBars = new Set(own.map((m) => Math.round(m.tick / ctx.barTicks)));

  const clips = song.playlist.clips.filter((c) => c.kind === "pattern" && !c.muted && !trackAt(song, c.track).muted);
  const end = Math.max(0, ...clips.map((c) => c.start + clipLength(c, ctx)));
  const sections: { tick: number; label: string }[] = [];
  let before = "";
  let lastBar = -Infinity;
  for (let bar = 0; bar * ctx.barTicks < end; bar++) {
    const tick = bar * ctx.barTicks;
    const heard = new Set<string>();
    for (const c of clips) {
      // Inside the clip, and inside its pattern there (past it, a clip plays nothing).
      if (tick < c.start || tick >= c.start + clipLength(c, ctx) || c.offset + (tick - c.start) >= ctx.patternTicks(c.ref)) continue;
      heard.add(c.ref);
    }
    const key = [...heard].sort().join(" ");
    if (key === before) continue;
    before = key;
    if (bar === 0 || !heard.size || bar - lastBar < MIN_SECTION_BARS || ownBars.has(bar)) continue;
    lastBar = bar;
    const label = [...heard].map((id) => names.get(id) ?? "Pattern").sort().join(" + ");
    sections.push({ tick, label: label.length > 60 ? `${label.slice(0, 59)}…` : label });
  }
  return [...own, ...sections]
    .map((m) => ({ time: Math.round(seconds(m.tick) * 1e4) / 1e4, label: m.label }))
    .sort((a, b) => a.time - b.time);
}
