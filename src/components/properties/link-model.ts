/**
 * What the link popover offers and starts from (pure, tested): the signals a parameter can follow,
 * grouped as the picker lists them, the sources a built-in one can be heard from, and a new link sized
 * for the parameter (a rotation moves by degrees, a scale by a fraction).
 */
import { BUILT_IN_SIGNALS } from "@shared/audio-signals";
import { DEFAULT_RESPONSE, isHitSignal } from "@shared/links";
import { hasMedia } from "@shared/effects";
import type { NumberSpec, ParamSpec } from "@shared/params";
import type { Clip, ParamLink, Project, SignalRef, SignalSource } from "@shared/types";

export interface Option {
  value: string;
  label: string;
}

const LABELS: Record<string, string> = {
  level: "Level",
  peak: "Peak",
  sub: "Sub",
  bass: "Bass",
  lowMid: "Low mids",
  mid: "Mids",
  upperMid: "Upper mids",
  presence: "Presence",
  air: "Air",
  onset: "Any hit",
  onsetLow: "Kicks",
  onsetMid: "Snares, notes",
  onsetHigh: "Hats",
  width: "Stereo width",
  balance: "Balance",
  brightness: "Brightness",
  intensity: "Intensity",
  beat: "The beat",
  downbeat: "Each bar",
};

/** A signal's name as the picker shows it. */
export const signalLabel = (name: string) => LABELS[name] ?? name;

/** The picker's groups: the sound's levels, its hits and the beat, then the video's own signals. */
export function signalOptions(project: Pick<Project, "signals">): { label: string; options: Option[] }[] {
  const sound = BUILT_IN_SIGNALS.filter((s) => !isHitSignal(s.name)).map((s) => ({ value: `b:${s.name}`, label: signalLabel(s.name) }));
  const hits = [...BUILT_IN_SIGNALS.filter((s) => isHitSignal(s.name)).map((s) => s.name), "beat", "downbeat"].map((name) => ({ value: `b:${name}`, label: signalLabel(name) }));
  const own = (project.signals ?? []).map((d) => ({ value: `c:${d.id}`, label: d.name }));
  return [
    { label: "Sound", options: sound },
    { label: "Hits", options: hits },
    ...(own.length ? [{ label: "This video's signals", options: own }] : []),
  ];
}

/** A reference as a picker value, and back (a built-in one's source is kept apart). */
export const refValue = (ref: SignalRef) => ("id" in ref ? `c:${ref.id}` : `b:${ref.name}`);
export const refFrom = (value: string): SignalRef => (value.startsWith("c:") ? { id: value.slice(2) } : { name: value.slice(2) });

/** Whether a link's signal comes as hits (it then takes a hit shape). */
export function isHits(ref: SignalRef, project: Pick<Project, "signals">): boolean {
  if ("name" in ref) return isHitSignal(ref.name);
  const def = project.signals?.find((d) => d.id === ref.id);
  return def?.kind === "events" || (def?.kind === "band" && def.onsets);
}

/** Where a built-in signal can be heard from: the mix, the clip's own sound, an audio track. */
export function sourceOptions(view: Pick<Project, "tracks">, clip: Pick<Clip, "effects" | "assetId">): Option[] {
  return [
    { value: "master", label: "The mix" },
    ...(clip.assetId && hasMedia(clip) ? [{ value: "self", label: "This clip's sound" }] : []),
    ...view.tracks.filter((t) => t.kind === "audio").map((t) => ({ value: `t:${t.id}`, label: t.name })),
  ];
}

export function sourceValue(source: SignalSource | undefined, clipId: string): string {
  if (!source || source.kind === "master") return "master";
  if (source.kind === "clip") return source.clipId === clipId ? "self" : `c:${source.clipId}`;
  return `t:${source.trackId}`;
}

export function sourceFrom(value: string, clipId: string): SignalSource | undefined {
  if (value === "self") return { kind: "clip", clipId };
  if (value.startsWith("t:")) return { kind: "track", trackId: value.slice(2) };
  if (value.startsWith("c:")) return { kind: "clip", clipId: value.slice(2) };
  return undefined;
}

/** How far a new link moves a parameter at full signal: a fifth of its usual range (a point lifts a little). */
export function defaultAmount(spec: ParamSpec): number | [number, number] {
  if (spec.kind === "vec2") return spec.space === "px" ? [0, -40] : [0, -0.04];
  const n = spec as NumberSpec;
  if (n.unit === "°") return 15;
  const span = Math.min(n.max - n.min, (n.scale ?? 1) >= 100 ? 1 : 100);
  return Math.max(0.01, Math.round(span * 0.2 * 100) / 100);
}

/** A new link: the bass of the mix, added. */
export function defaultLink(spec: ParamSpec): ParamLink {
  return { signal: { name: "bass" }, mode: "add", amount: defaultAmount(spec), response: { ...DEFAULT_RESPONSE } };
}
