/**
 * What the assistant reads of a sequence's sound (get_signals): which files sound where, the beat, the
 * hits, and signals' values over a stretch, in timeline seconds. The assistant can't hear: this (and
 * plot_signals' picture) is how it finds a song's shape before making pictures react to it.
 */
import {
  BUILT_IN_SIGNALS,
  type SignalReader,
  type SignalSource,
  beatGridAt,
  customSignalHits,
  customSignalLevel,
  eventTimes as sharedEventTimes,
  isOnsetName,
  isSignalName,
  signalValue,
  sourceHits,
} from "@shared/audio-signals";
import { findSignal } from "@shared/links";
import { hasMedia } from "@shared/effects";
import { ONSET_SCALARS } from "@shared/signals/format";
import { isNestedClip, sequenceView } from "@shared/sequences";
import { clipEnd, projectDuration, trackClips } from "@shared/timeline";
import { ToolError, range, secs } from "./input";

/** Rows of values at most, and hits listed per kind. */
const MAX_ROWS = 400;
const MAX_HITS = 120;
const ONSET_LABELS: Record<string, string> = { onset: "any", onsetLow: "kicks, below 150 Hz", onsetMid: "snares, notes", onsetHigh: "hats, above 4 kHz" };

const two = (v: number) => v.toFixed(2);

export interface SignalQuery {
  source: SignalSource;
  /** How the source is named to the model. */
  label: string;
  from: number;
  to: number;
  /** Signals to list values of (none: the summary alone). */
  signals: string[];
  /** Seconds between values. */
  step?: number;
  /** Whether a media file has sound (those without aren't listed). */
  hasAudio: (assetId: string) => boolean;
}

/** A sequence's length (the stretch to describe when none is given). */
export const sequenceLength = (reader: SignalReader, sequenceId: string | null) => projectDuration(sequenceView(reader.document, sequenceId));

/** get_signals' answer. */
export function describeSignals(reader: SignalReader, sequenceId: string | null, query: SignalQuery): string {
  const view = sequenceView(reader.document, sequenceId);
  const read = signalReadersOf(reader, sequenceId, query.source, query.signals);
  const { from, to } = query;
  const lines = [`${query.label}, ${range(from, to)}s (timeline seconds; values 0..1, 1 as loud as the file's own loud parts):`];

  // Which files sound, and whether they're analysed.
  const sounds: string[] = [];
  for (const track of view.tracks) {
    for (const clip of trackClips(view, track.id)) {
      if (!hasMedia(clip) || clipEnd(clip) <= from || clip.start >= to) continue;
      if (query.source.kind === "track" && query.source.trackId !== track.id) continue;
      if (query.source.kind === "clip" && query.source.clipId !== clip.id) continue;
      if (query.source.kind === "master" && track.muted) continue;
      if (isNestedClip(clip)) {
        sounds.push(`${clip.id} (a nested sequence) on "${track.name}" ${range(clip.start, clipEnd(clip))}s`);
        continue;
      }
      if (!query.hasAudio(clip.assetId)) continue;
      const data = reader.store.get(clip.assetId);
      const rhythm = data?.header.rhythm;
      const tempo = rhythm?.bpm ? `, ${rhythm.bpm} BPM (sure ${two(rhythm.confidence)})` : data ? ", no steady beat" : "";
      sounds.push(`${clip.id} on "${track.name}" ${range(clip.start, clipEnd(clip))}s${data ? tempo : " (not analysed: silent to signals)"}`);
    }
  }
  lines.push(sounds.length ? `Sounds: ${sounds.join(" · ")}` : "Nothing sounds there.");

  // The beat (of the song playing in the middle of the stretch, or at its start).
  const grid = beatGridAt(reader, sequenceId, (from + to) / 2) ?? beatGridAt(reader, sequenceId, from);
  if (grid) {
    const inside = (t: number) => t >= from && t <= to;
    const beats = grid.beats.filter(inside);
    const downbeats = grid.downbeats.filter(inside);
    const sections = grid.sections.filter((s) => s.end > from && s.start < to);
    const loudest = Math.max(...sections.map((s) => s.db));
    lines.push(
      `Beat (of ${grid.clipId}): ${grid.bpm.toFixed(1)} BPM, ${beats.length} beats here` +
        (beats.length ? ` from ${secs(beats[0])}s, a beat every ${secs(60 / grid.bpm)}s` : ""),
    );
    if (downbeats.length) lines.push(`Bars start at: ${list(downbeats)}`);
    if (sections.length) {
      lines.push(
        `Sections (by loudness): ${sections.map((s) => `${range(s.start, s.end)}s ${s.db >= loudest - 2 ? "loud" : s.db >= loudest - 8 ? "medium" : "quiet"} (${s.db} dB)`).join(", ")}`,
      );
    }
    const drops = grid.drops.filter(inside);
    if (drops.length) lines.push(`Drops (the energy jumps up): ${list(drops)}`);
  } else lines.push("No steady beat here.");

  // Hits.
  lines.push("Hits (time, velocity 0..1):");
  for (const name of ONSET_SCALARS) {
    const hits = sourceHits(reader, sequenceId, query.source, name).filter(([t]) => t >= from && t <= to);
    const shown = hits.slice(0, MAX_HITS).map(([t, v]) => `${secs(t)} (${two(v)})`);
    lines.push(`  ${name} (${ONSET_LABELS[name]}): ${hits.length}${shown.length ? `: ${shown.join(", ")}${hits.length > MAX_HITS ? ", …" : ""}` : ""}`);
  }

  // The video's own signals: how often each is on, and their hits here.
  const own = reader.document.signals ?? [];
  if (own.length) {
    lines.push("The video's own signals (define_signal; values in `signals` by name):");
    for (const def of own) {
      const hits = customSignalHits(reader, def, from, to);
      const has = def.kind === "events" || (def.kind === "band" && def.onsets);
      let on = 0;
      const n = 200;
      for (let i = 0; i < n; i++) if (customSignalLevel(reader, def, sequenceId, from + ((to - from) * (i + 0.5)) / n) > 0.5) on++;
      lines.push(`  "${def.name}" (${def.id}, ${def.kind}${def.role ? `, ${def.role}` : ""}): over 0.5 ${Math.round((on / n) * 100)}% of the time${has ? `; ${hits.length} hits${hits.length ? `: ${list(hits.map(([t]) => t))}` : ""}` : ""}`);
    }
  }

  // An overview of the loudness, two numbers a second at most.
  const overview = Math.max(0.5, (to - from) / 60);
  const levels: string[] = [];
  for (let t = from; t < to; t += overview) levels.push(two(signalValue(reader, sequenceId, query.source, "level", t)));
  lines.push(`Level every ${secs(overview)}s from ${secs(from)}s: ${levels.join(" ")}`);

  // Values.
  if (query.signals.length) {
    const step = Math.max(0.01, query.step ?? Math.max(0.05, (to - from) / 100));
    const rows = Math.min(MAX_ROWS, Math.floor((to - from) / step) + 1);
    lines.push(`Every ${secs(step)}s${rows === MAX_ROWS ? ` (the first ${MAX_ROWS})` : ""}:`);
    lines.push(["t", ...query.signals].join("\t"));
    for (let i = 0; i < rows; i++) {
      const t = from + i * step;
      lines.push([secs(t), ...read.map((at) => two(at(t, step)))].join("\t"));
    }
  }
  return lines.join("\n");
}

/** Times, a handful listed, the rest counted. */
function list(times: number[], most = 40): string {
  const shown = times.slice(0, most).map(secs).join(", ");
  return times.length > most ? `${shown}, … (${times.length})` : shown;
}

/** The moments of a kind of event in a stretch: beats, bars, drops or a kind of hit (its errors the model's). */
export function eventTimes(reader: SignalReader, sequenceId: string | null, source: SignalSource, kind: string, from: number, to: number): number[] {
  try {
    return sharedEventTimes(reader, sequenceId, source, kind, from, to);
  } catch (err) {
    throw new ToolError(`\`at\` must be "beats", "bars", "drops" or a kind of hit: ${ONSET_SCALARS.map((n) => `"${n}"`).join(", ")}.`, { cause: err });
  }
}

/**
 * How to read each of `names` over time (a built-in signal of `source`, or one of the video's own by
 * name), or a message saying which exist. `step` is how far apart values are read (an onset is its
 * strongest since the one before).
 */
export function signalReadersOf(reader: SignalReader, sequenceId: string | null, source: SignalSource, names: string[]): ((t: number, step: number) => number)[] {
  return names.map((name) => {
    if (isSignalName(name)) return (t: number, step: number) => signalValue(reader, sequenceId, source, name, t, isOnsetName(name) ? step : 0);
    const def = findSignal(reader.document, name);
    if (def) return (t: number) => customSignalLevel(reader, def, sequenceId, t);
    const own = (reader.document.signals ?? []).map((d) => `"${d.name}"`);
    throw new ToolError(`There's no signal "${name}". Signals: ${BUILT_IN_SIGNALS.map((s) => s.name).join(", ")}${own.length ? `; the video's own: ${own.join(", ")}` : ""}.`);
  });
}
