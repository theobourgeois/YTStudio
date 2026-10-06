/**
 * Make visualizer, the video side (docs/visualizer/README.md, V5): a song handed over by the music suite
 * (`SongHandoff`) as a video project. The mix plays on an audio track; each stem is on a muted track
 * named after it (no sound of its own, but its signals drive pictures); each channel's notes are an
 * events signal; the song's tempo map is the exact beat (`Project.tempo`); its arrangement is markers;
 * and a starting look (`VisualizerLook`) reacts at once, bound to the song by role (the kick, the snare,
 * the bass), whatever it finds of each. Pure, and tested.
 */
import { defaultEffects, effectDefinition, sanitizeEffect, solidEffects, textEffects, visualizerEffects } from "./effects.ts";
import type { HandoffMedia, SongHandoff, VisualizerOptions } from "./handoff.ts";
import { createId } from "./ids.ts";
import { DEFAULT_RESPONSE, MAX_EVENTS, MAX_SIGNALS, normalizeSignalDef, uniqueSignalName } from "./links.ts";
import { roundTime } from "./math.ts";
import { normalizeSongTempo } from "./normalize.ts";
import { MIN_CLIP_DURATION, createDefaultProject } from "./timeline.ts";
import type { Clip, Effect, HitShape, MediaAsset, ParamLink, ParamValues, Project, SignalDef, SignalRef, SignalRole, Track } from "./types.ts";

type Asset = Pick<MediaAsset, "id" | "duration">;

/** Where a role was found in the song: its notes (an events signal), its stem (an audio track), or neither. */
interface Bound {
  /** Its hits: the notes, else the stem's onsets, else the mix's onsets in the role's range. */
  hits: SignalRef;
  /** How loud it is now: the stem's level, else its notes held, else the mix's band for it. */
  level: SignalRef;
  /** What a visualizer listening to it hears (its `source` and `hits` parameters). */
  listen: { source: string; hits: string };
}

/** The mix's own signals for a role the song didn't say anything about. */
const MIX_HITS: Record<SignalRole, string> = { kick: "onsetLow", snare: "onsetMid", hats: "onsetHigh", bass: "onsetLow", vocal: "onsetMid", lead: "onsetMid", mix: "onset" };
const MIX_LEVEL: Record<SignalRole, string> = { kick: "bass", snare: "mid", hats: "high", bass: "bass", vocal: "mid", lead: "mid", mix: "level" };
const VISUALIZER_HITS: Record<SignalRole, string> = { kick: "kicks", snare: "snares", hats: "hats", bass: "kicks", vocal: "snares", lead: "snares", mix: "any" };

/** A video project of a song (see the file's comment). `media` are the handoff's files, imported. */
export function videoFromSong(song: SongHandoff, media: HandoffMedia<Asset>, options: VisualizerOptions): Project {
  const base = createDefaultProject();
  const length = Math.max(MIN_CLIP_DURATION, roundTime(media.mix.duration ?? song.length));

  // Audio: the mix, then each stem muted (heard by signals, not by ears).
  const mixTrack: Track = { id: createId("track"), kind: "audio", name: "Mix", muted: false };
  const stemTracks: Track[] = song.stems.map((stem) => ({ id: createId("track"), kind: "audio", name: stem.name.slice(0, 80) || "Stem", muted: true }));
  const audioClip = (asset: Asset, trackId: string): Clip => ({
    id: createId("clip"),
    assetId: asset.id,
    trackId,
    start: 0,
    in: 0,
    out: roundTime(Math.max(MIN_CLIP_DURATION, asset.duration ?? length)),
    effects: defaultEffects(),
  });
  const audioClips = [audioClip(media.mix, mixTrack.id), ...media.stems.map((asset, i) => audioClip(asset, stemTracks[i].id))];

  // Each channel's notes: an events signal named after it.
  const signals: SignalDef[] = [];
  for (const notes of song.notes) {
    if (signals.length >= MAX_SIGNALS || !notes.events.length) continue;
    const def = normalizeSignalDef(
      {
        id: createId("sig"),
        name: uniqueSignalName(notes.channel || "Notes", signals.map((s) => s.name)),
        color: notes.color,
        ...(notes.role && { role: notes.role }),
        kind: "events",
        events: notes.events.slice(0, MAX_EVENTS),
      },
      signals.length,
    );
    if (def) signals.push(def);
  }

  const bind = (role: SignalRole): Bound => {
    const notes = signals.find((s) => s.role === role);
    const stem = song.stems.findIndex((s) => s.role === role);
    const track = stem >= 0 ? { kind: "track" as const, trackId: stemTracks[stem].id } : null;
    return {
      hits: notes ? { id: notes.id } : track ? { name: "onset", source: track } : { name: MIX_HITS[role] },
      level: track ? { name: "level", source: track } : notes ? { id: notes.id } : { name: MIX_LEVEL[role] },
      listen: track ? { source: `t:${track.trackId}`, hits: "any" } : { source: "master", hits: VISUALIZER_HITS[role] },
    };
  };

  const look = LOOKS[options.look]({ name: song.name, length, bind });
  const videoTracks: Track[] = look.length
    ? look.map((_, i) => ({ id: i === look.length - 1 ? base.tracks[0].id : createId("track"), kind: "video", name: `Video ${look.length - i}`, muted: false }))
    : [base.tracks[0]];
  const videoClips: Clip[] = look.map((clip, i) => ({ ...clip, trackId: videoTracks[i].id }));

  const tempo = normalizeSongTempo({ assetIds: [media.mix.id, ...media.stems.map((s) => s.id)], beatsPerBar: song.tempo.timeSignature[0], beats: song.tempo.beats });
  const markers = song.markers
    .filter((m) => m.time >= 0 && m.time <= length)
    .map((m) => ({ id: createId("marker"), time: roundTime(m.time), ...(m.label && { label: m.label.slice(0, 200) }) }))
    .sort((a, b) => a.time - b.time);

  return {
    version: 1,
    name: song.name,
    settings: { aspectRatio: options.aspectRatio, fps: options.fps },
    tracks: [...videoTracks, mixTrack, ...stemTracks],
    clips: [...videoClips, ...audioClips],
    ...(markers.length && { markers }),
    ...(signals.length && { signals }),
    ...(tempo && { tempo }),
  };
}

// ---------------------------------------------------------------------------
// The starting looks
// ---------------------------------------------------------------------------

interface LookInput {
  name: string;
  length: number;
  bind: (role: SignalRole) => Bound;
}

/** A look's layers, top to bottom (each on a video track of its own), without their tracks. */
type Look = (input: LookInput) => Omit<Clip, "trackId">[];

const punch = (decay: number): HitShape => ({ attack: 0.005, hold: 0, decay });
const hitLink = (signal: SignalRef, mode: ParamLink["mode"], amount: number, decay: number): ParamLink => ({ signal, mode, amount, response: DEFAULT_RESPONSE, hit: punch(decay) });
const levelLink = (signal: SignalRef, mode: ParamLink["mode"], amount: number, release = 0.18): ParamLink => ({ signal, mode, amount, response: { ...DEFAULT_RESPONSE, release } });

/** A layer as long as the song. */
const layer = (length: number, effects: Effect[]): Omit<Clip, "trackId"> => ({ id: createId("clip"), assetId: "", start: 0, in: 0, out: length, effects });

/** A built-in effect's (Motion, Opacity) values and links changed. */
function tweak(effects: Effect[], type: string, params: ParamValues, links?: Record<string, ParamLink>): Effect[] {
  return effects.map((e) => (e.type === type ? { ...e, params: { ...e.params, ...params }, ...(links && { links: { ...e.links, ...links } }) } : e));
}

/** A video effect of `type`, its values and links (the nth of its type has id `type_n`). */
function videoEffect(type: string, params: ParamValues, links?: Record<string, ParamLink>, nth = 1): Effect {
  const def = effectDefinition(type);
  if (!def) throw new Error(`No effect ${type}`);
  return sanitizeEffect(def, { params, ...(links && { links }) }, nth > 1 ? `${type}_${nth}` : type);
}

/** A visualizer layer drawing `type` (then `more` over it), alone over what's below. */
function visualizer(length: number, type: string, params: ParamValues, more: Effect[] = []): Omit<Clip, "trackId"> {
  return layer(length, [...visualizerEffects(type, params), ...more]);
}

/** A dark gradient to draw over (the canvas is black). */
const background = (length: number, inner: string, outer: string) =>
  layer(length, [...solidEffects({ color: "#000000" }), videoEffect("gradient-ramp", { rampShape: "radial", rampStart: [0.5, 0.5], rampEnd: [1.1, 1.1], startColor: inner, endColor: outer })]);

/** The song's name, small, at `y` (a fraction of the frame's height). */
const title = (length: number, name: string, y: number) =>
  layer(length, tweak(textEffects({ text: name || "Untitled", size: 58, tracking: 120, textCase: "upper" }), "motion", { position: [0.5, y] }));

/** An adjustment layer: its effects apply to everything below. */
const adjustment = (length: number, effects: Effect[]): Omit<Clip, "trackId"> => ({ ...layer(length, [...defaultEffects(), ...effects]), adjustment: true });

const LOOKS: Record<VisualizerOptions["look"], Look> = {
  pulse({ name, length, bind }) {
    const kick = bind("kick");
    const snare = bind("snare");
    const circle = visualizer(length, "audio-circle", { radius: 0.17, barLength: 0.17, color: "#7cf7ff", color2: "#ff3d9a", pulse: 0.1 }, [
      videoEffect("audio-ring", { blendMode: "over", radius: 0.13, amplitude: 0.05, color: "#ffffff", glow: 0.5 }),
    ]);
    return [
      adjustment(length, [videoEffect("rgb-split", { amount: 0 }, { amount: hitLink(snare.hits, "add", 0.018, 0.16) })]),
      title(length, name, 0.84),
      { ...circle, effects: tweak(circle.effects, "motion", {}, { scale: hitLink(kick.hits, "multiply", 0.12, 0.28) }) },
      background(length, "#1d0b35", "#000000"),
    ];
  },
  bars({ name, length, bind }) {
    const kick = bind("kick");
    const bass = bind("bass");
    return [
      adjustment(length, [videoEffect("glow", { threshold: 0.45, reach: 0.04, intensity: 0.4 }, { intensity: levelLink(bass.level, "add", 1.2) })]),
      title(length, name, 0.16),
      visualizer(length, "audio-bars", { center: [0.5, 0.8], width: 0.92, height: 0.34, bars: 40, color: "#33d6ff", color2: "#ff4fd8" }, [
        videoEffect("audio-burst", { blendMode: "over", source: kick.listen.source, hits: kick.listen.hits, center: [0.5, 0.45], count: 32, spread: 0.5, color: "#ffffff", color2: "#33d6ff" }),
      ]),
      background(length, "#06233a", "#000000"),
    ];
  },
  wave({ name, length, bind }) {
    const bass = bind("bass");
    const snare = bind("snare");
    const hats = bind("hats");
    const flash = layer(length, tweak(solidEffects({ color: "#ffffff" }), "opacity", { opacity: 0, blendMode: "screen" }, { opacity: hitLink(snare.hits, "add", 0.28, 0.2) }));
    const wave = visualizer(length, "audio-ring", { radius: 0.2, amplitude: 0.11, pulse: 0.2, thickness: 0.008, color: "#ff5cf0", glow: 0.6 }, [
      videoEffect("audio-burst", { blendMode: "over", source: hats.listen.source, hits: hats.listen.hits, count: 14, life: 0.5, spread: 0.32, particleSize: 0.004, color: "#ffffff", color2: "#ff5cf0" }),
    ]);
    return [
      flash,
      title(length, name, 0.86),
      { ...wave, effects: tweak(wave.effects, "motion", {}, { scale: levelLink(bass.level, "multiply", 0.12, 0.25) }) },
      background(length, "#2a0a24", "#000000"),
    ];
  },
  none: () => [],
};
