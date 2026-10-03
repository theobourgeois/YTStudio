/**
 * Automation (`docs/fl-studio/automation.md`): automation clips, curves over time for one control each,
 * placed on the playlist. This is all of their maths, pure and tested: FL Studio's curve types and the LFO
 * (`automationValue`, a clip's value at a tick of its curve), what a control is at any tick of the song
 * (`controlAt`: the rules decided with Théo), the controls a song has (`controlOf`), and the edits.
 *
 * Values on a curve are 0..1 of the control's range (squeezed by the clip's Min / Max); `controlOf` turns
 * them into the control's own (a pan's -1..1).
 */
import { createId } from "../ids.ts";
import { clamp } from "../math.ts";
import { AUTO_TUNE_CONTROL_INFO } from "./auto-tune-presets.ts";
import { ECHO_CONTROL_SPECS } from "./echo-boy.ts";
import { PITCH_WHEEL_CONTROL_INFO, controlField } from "./pitch-wheel-presets.ts";
import { GROSS_SLOTS, GROSS_TIME_PRESETS, GROSS_VOLUME_PRESETS, MAX_GROSS_ATTACK, MAX_GROSS_RELEASE } from "./gross-beat-presets.ts";
import { EQ_CONTROL_SCALES } from "./pro-q-presets.ts";
import { OTT_CONTROL_SPECS } from "./ott.ts";
import { PRO_C_CONTROL_SPECS } from "./pro-c.ts";
import { REVERB_CONTROL_SPECS } from "./reverb.ts";
import { PAN_CONTROLS, panControlFraction, panControlValue } from "./panman-presets.ts";
import { type ClipContext, addClips, clipContext, clipEnd, lastUsedTrack, trackAt } from "./playlist.ts";
import { DEFAULT_LFO, MAX_TEMPO, MIN_TEMPO, PITCH_KNOB_RANGE, MAX_AUTOMATIONS, MAX_AUTOMATION_POINTS, MAX_NAME, MAX_PATTERN_TICKS, MAX_PLAYLIST_TRACKS, normalizeLfo } from "./project.ts";
import { type Automation, type AutomationLfo, type AutomationPoint, type AutomationTarget, type CurveType, type MusicProject, type PlaylistClip, STEP_TICKS } from "./types.ts";

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

/** The curve types' names, as FL's point menu has them. */
export const CURVE_NAMES: Record<CurveType, string> = {
  single: "Single curve",
  double: "Double curve",
  altSingle: "Alt single curve",
  altDouble: "Alt double curve",
  hold: "Hold",
  stairs: "Stairs",
  smoothStairs: "Smooth stairs",
  pulse: "Pulse",
  wave: "Wave",
  halfSine: "Half sine",
  smooth: "Smooth",
};

/** How strongly the tension bends a curve: at ±1 it's x⁸ or its inverse. */
const BEND = 8;

/** `x` (0..1) bent by a tension: positive starts slow (eases in), negative starts fast, 0 is straight. */
const bend = (x: number, tension: number) => (tension === 0 ? x : x ** BEND ** tension);

/** How many steps (stairs) or cycles (pulse, wave) a tension makes: 8 or 4 at 0, fewer down to -1, more up to 1. */
export const stepCount = (tension: number) => Math.max(2, Math.round(2 ** (3 + 2.5 * tension)));
export const cycleCount = (tension: number) => Math.max(1, Math.round(2 ** (2 + 2.5 * tension)));

/**
 * How far along a segment of `curve` its value is, `x` (0..1) of the way through it in time: 0 is the point
 * it starts from, 1 the point it arrives at. Every curve is 1 at its end (it arrives), and all but Hold,
 * Pulse and Half sine are continuous on the way.
 */
export function curveAt(curve: CurveType, tension: number, x: number): number {
  if (x >= 1) return 1;
  if (x <= 0) return 0;
  switch (curve) {
    case "single":
      return bend(x, tension);
    case "altSingle":
      return 1 - bend(1 - x, -tension);
    case "double":
      // An S: the first half bent one way, the second the mirror of it.
      return x < 0.5 ? bend(2 * x, tension) / 2 : 1 - bend(2 - 2 * x, tension) / 2;
    case "altDouble":
      // The other S: fast at the ends, slow through the middle (or the reverse).
      return x < 0.5 ? (1 - bend(1 - 2 * x, tension)) / 2 : 0.5 + (1 - bend(2 - 2 * x, tension)) / 2;
    case "hold":
      return 0;
    case "stairs": {
      const n = stepCount(tension);
      return Math.min(1, Math.floor(x * n) / (n - 1));
    }
    case "smoothStairs": {
      const n = stepCount(tension);
      const k = Math.floor(x * n);
      const f = x * n - k;
      return (k + f * f * (3 - 2 * f)) / n;
    }
    case "pulse": {
      const n = cycleCount(tension);
      return Math.floor(x * 2 * n) % 2 === 0 ? 0 : 1;
    }
    case "wave": {
      // From the first value to the second in half a cycle, then on round, arriving at the second.
      const n = cycleCount(tension);
      return (1 - Math.cos(Math.PI * (2 * n - 1) * x)) / 2;
    }
    case "halfSine":
      // A quarter of a sine: quick away, slowing to a stop as it arrives (a tape stop), bent by the tension.
      return Math.sin((bend(x, tension) * Math.PI) / 2);
    case "smooth": {
      const a = 2 ** (1 + 1.5 * tension);
      const p = x ** a;
      return p / (p + (1 - x) ** a);
    }
  }
}

/** The index of the last point at or before `tick` (points on one tick: the last of them, so a jump is taken). */
function pointBefore(points: readonly AutomationPoint[], tick: number): number {
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (points[mid].tick <= tick) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** A curve's value (0..1) at a tick of it: its points joined by their segments, the last value past the end. */
export function curveValue(points: readonly AutomationPoint[], tick: number): number {
  const i = pointBefore(points, tick);
  const from = points[i];
  const to = points[i + 1];
  if (!to || tick <= from.tick) return from.value;
  return from.value + (to.value - from.value) * curveAt(to.curve, to.tension, (tick - from.tick) / (to.tick - from.tick));
}

/**
 * The LFO's swing at a tick of the curve, -1..1: a triangle peaking at `skew` of its cycle (a saw at either
 * end), shaped by its tension (towards a square above 0, peakier below).
 */
export function lfoAt(lfo: AutomationLfo, tick: number, barTicks: number): number {
  const cycle = (((tick / barTicks) * lfo.speed) % 1 + 1) % 1;
  const peak = clamp(lfo.skew, 0.001, 0.999);
  const rise = cycle < peak ? cycle / peak : (1 - cycle) / (1 - peak);
  const swing = rise * 2 - 1;
  return Math.sign(swing) * Math.abs(swing) ** 4 ** -lfo.tension;
}

/** An automation clip's value (0..1 of its control's range) at a tick of its curve: the curve, the LFO, then Min / Max. */
export function automationValue(automation: Automation, tick: number, barTicks: number): number {
  let value = curveValue(automation.points, Math.min(tick, automation.length));
  const { lfo } = automation;
  if (lfo.enabled && lfo.level !== 0) {
    const swing = lfoAt(lfo, tick, barTicks);
    const amount = Math.abs(lfo.level);
    if (lfo.multiply) {
      // Scaled by the LFO from its trough to its peak (upside down when the level is below 0).
      const lift = (1 + (lfo.level > 0 ? swing : -swing)) / 2;
      value *= 1 - amount + amount * lift;
    } else value += (lfo.level * swing) / 2;
    value = clamp(value, 0, 1);
  }
  return automation.min + value * (automation.max - automation.min);
}

/**
 * The ticks inside a curve where its value may jump (Hold's, Stairs' and Pulse's steps, points on one
 * tick) or turn sharply (a wave's peaks), from `from` to `to`: where a sampler of it must look closely.
 */
export function curveBreaks(automation: { readonly points: readonly AutomationPoint[] }, from: number, to: number): number[] {
  const breaks: number[] = [];
  const { points } = automation;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (b.tick < from) continue;
    if (a.tick > to) break;
    const span = b.tick - a.tick;
    breaks.push(b.tick);
    if (span <= 0) continue;
    // Stairs' and pulses' steps are jumps; smooth stairs' and waves' turns are where a straight line would cut a corner.
    const steps =
      b.curve === "stairs" || b.curve === "smoothStairs" ? stepCount(b.tension) : b.curve === "pulse" ? cycleCount(b.tension) * 2 : b.curve === "wave" ? cycleCount(b.tension) * 2 - 1 : 0;
    for (let k = 1; k < steps; k++) {
      const at = a.tick + (span * k) / steps;
      if (at >= from && at <= to) breaks.push(at);
    }
  }
  return breaks;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/** A target as a string, the same for the same control: what lanes and held controls are keyed by. */
export function targetKey(target: AutomationTarget): string {
  switch (target.kind) {
    case "channel":
      return `channel:${target.channel}:${target.control}`;
    case "mixer":
      return `mixer:${target.track}:${target.control}`;
    case "send":
      return `send:${target.track}>${target.to}`;
    case "effect":
      return `effect:${target.effect}`;
    case "grossBeat":
      return `gross:${target.effect}:${target.control}`;
    case "autoTune":
      return `tune:${target.effect}:${target.control}`;
    case "echoBoy":
      return `echo:${target.effect}:${target.control}`;
    case "proQ":
      return `proq:${target.effect}:${target.band}:${target.control}`;
    case "ott":
      return `ott:${target.effect}:${target.control}`;
    case "proC":
      return `proc:${target.effect}:${target.control}`;
    case "panMan":
      return `panman:${target.effect}:${target.control}`;
    case "pitchWheel":
      return `wheel:${target.effect}:${target.control}`;
    case "reverb":
      return `verb:${target.effect}:${target.control}`;
    case "main":
      return "main";
    case "tempo":
      return "tempo";
    case "plugin":
      return `plugin:${target.owner}:${target.id}:${target.param}`;
  }
}

/** What a control is: its name, its owner's, whether it's still there, and its value as the document has it. */
export interface ControlInfo {
  /** "Volume", "Pan", "Send to Insert 2", a plugin parameter's name. */
  name: string;
  /** What it belongs to: "Kick", "Insert 3", "Master", "Serum 2 (Lead)". */
  owner: string;
  /** Its channel, track, effect or send is still in the song. */
  exists: boolean;
  /** Its own value as a fraction of its range (0..1), or null for a plugin's parameter (only the plugin knows it). */
  own: number | null;
  /** A fraction of its range as its own value (a pan's -1..1), and back. */
  toControl: (fraction: number) => number;
  fromControl: (value: number) => number;
  /** A fraction of its range, said the way its knob says it. */
  format: (fraction: number) => string;
}

const unit = { toControl: (v: number) => v, fromControl: (v: number) => clamp(v, 0, 1) };
const signed = { toControl: (v: number) => v * 2 - 1, fromControl: (v: number) => clamp((v + 1) / 2, 0, 1) };
const percent = (v: number) => `${Math.round(v * 100)}%`;
const panText = (v: number) => (Math.abs(v) < 0.005 ? "Centre" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? "left" : "right"}`);
const separationText = (v: number) => (Math.abs(v) < 0.005 ? "As it is" : `${Math.round(Math.abs(v) * 100)}% ${v > 0 ? "narrower" : "wider"}`);

/** A mixer track's name, as the mixer says it. */
export function mixerTrackName(song: Pick<MusicProject, "mixer">, id: string): string {
  const index = song.mixer.tracks.findIndex((t) => t.id === id);
  if (index < 0) return "A deleted track";
  return song.mixer.tracks[index].name ?? (index === 0 ? "Master" : `Insert ${index}`);
}

/** The mixer track an effect is in, and the effect. */
export function findEffect(song: Pick<MusicProject, "mixer">, effectId: string) {
  for (const track of song.mixer.tracks) {
    const effect = track.effects.find((e) => e?.id === effectId);
    if (effect) return { track, effect };
  }
  return null;
}

/** What a control is in this song (`ControlInfo`). */
export function controlOf(song: MusicProject, target: AutomationTarget): ControlInfo {
  switch (target.kind) {
    case "channel": {
      const channel = song.channels.find((c) => c.id === target.channel);
      if (target.control === "pitch") {
        // Semitones either way of the knob's reach; a plugin channel's keys move by whole ones.
        const toControl = (v: number) => (clamp(v, 0, 1) * 2 - 1) * PITCH_KNOB_RANGE;
        return {
          name: "Pitch",
          owner: channel?.name ?? "A deleted channel",
          exists: !!channel,
          own: channel ? clamp((channel.pitch / PITCH_KNOB_RANGE + 1) / 2, 0, 1) : null,
          toControl,
          fromControl: (value) => clamp((value / PITCH_KNOB_RANGE + 1) / 2, 0, 1),
          format: (v) => {
            const semitones = toControl(v);
            return channel?.kind === "plugin" ? `${semitones > 0 ? "+" : ""}${Math.round(semitones)} st` : `${semitones > 0 ? "+" : ""}${Math.round(semitones * 100)} cents`;
          },
        };
      }
      const pan = target.control === "pan";
      return {
        name: pan ? "Pan" : "Volume",
        owner: channel?.name ?? "A deleted channel",
        exists: !!channel,
        own: channel ? (pan ? signed.fromControl(channel.pan) : channel.volume) : null,
        ...(pan ? signed : unit),
        format: (v) => (pan ? panText(signed.toControl(v)) : percent(v)),
      };
    }
    case "mixer": {
      const track = song.mixer.tracks.find((t) => t.id === target.track);
      const control = target.control;
      const two = control !== "volume";
      return {
        name: control === "pan" ? "Pan" : control === "stereo" ? "Stereo separation" : "Volume",
        owner: mixerTrackName(song, target.track),
        exists: !!track,
        own: track ? (two ? signed.fromControl(track[control]) : track.volume) : null,
        ...(two ? signed : unit),
        format: (v) => (control === "pan" ? panText(signed.toControl(v)) : control === "stereo" ? separationText(signed.toControl(v)) : percent(v)),
      };
    }
    case "send": {
      const track = song.mixer.tracks.find((t) => t.id === target.track);
      const send = track?.sends.find((s) => s.to === target.to);
      return { name: `Send to ${mixerTrackName(song, target.to)}`, owner: mixerTrackName(song, target.track), exists: !!send, own: send ? send.level : null, ...unit, format: percent };
    }
    case "effect": {
      const found = findEffect(song, target.effect);
      return {
        name: "Mix",
        owner: found ? `${found.effect!.plugin.name} (${mixerTrackName(song, found.track.id)})` : "A deleted effect",
        exists: !!found,
        own: found ? found.effect!.mix : null,
        ...unit,
        format: percent,
      };
    }
    case "proQ": {
      const found = findEffect(song, target.effect);
      const pq = found?.effect?.proQ;
      const owner = found && pq ? `${found.effect!.plugin.name} (${mixerTrackName(song, found.track.id)})` : "A deleted Pro-Q";
      const scale = EQ_CONTROL_SCALES[target.control];
      const own = target.control === "output" || target.control === "pan" || target.control === "gainScale" ? target.control : null;
      const band = own ? null : pq?.bands.find((b) => b.id === target.band);
      const value = !pq ? null : own ? pq[own] : band ? band[target.control as "frequency" | "gain" | "q" | "range"] : null;
      const said = (v: number) => {
        const x = scale.toValue(clamp(v, 0, 1));
        if (target.control === "frequency") return x >= 1000 ? `${(x / 1000).toFixed(2)} kHz` : `${x.toFixed(1)} Hz`;
        if (target.control === "q") return x.toFixed(2);
        if (target.control === "pan") return Math.abs(x) < 0.005 ? "Centre" : `${Math.round(Math.abs(x) * 100)}% ${x < 0 ? "left" : "right"}`;
        if (target.control === "gainScale") return `${Math.round(x * 100)}%`;
        return `${x > 0 ? "+" : ""}${x.toFixed(1)} dB`;
      };
      const names = { frequency: "Frequency", gain: "Gain", q: "Q", range: "Dynamic range", output: "Output", pan: "Pan", gainScale: "Gain Scale" };
      return {
        name: own ? names[own] : `Band ${target.band} ${names[target.control]}`,
        owner,
        exists: value !== null,
        own: value === null ? null : clamp(scale.toFraction(value), 0, 1),
        toControl: (v) => scale.toValue(clamp(v, 0, 1)),
        fromControl: (x) => clamp(scale.toFraction(x), 0, 1),
        format: said,
      };
    }
    case "grossBeat": {
      const found = findEffect(song, target.effect);
      const gb = found?.effect?.grossBeat;
      const owner = found && gb ? `${found.effect!.plugin.name} (${mixerTrackName(song, found.track.id)})` : "A deleted Gross Beat";
      const control = target.control;
      if (control === "timeMix" || control === "volumeMix")
        return { name: control === "timeMix" ? "Time" : "Volume", owner, exists: !!gb, own: gb ? gb[control] : null, ...unit, format: percent };
      // ATT and REL (seconds, up to their most) and TNS (-1..1).
      if (control === "attack" || control === "release") {
        const most = control === "attack" ? MAX_GROSS_ATTACK : MAX_GROSS_RELEASE;
        const seconds = { toControl: (v: number) => clamp(v, 0, 1) * most, fromControl: (v: number) => clamp(v / most, 0, 1) };
        const said = (v: number) => (v * most < 1 ? `${Math.round(v * most * 1000)} ms` : `${(v * most).toFixed(2)} s`);
        return { name: control === "attack" ? "Attack" : "Release", owner, exists: !!gb, own: gb ? gb[control] / most : null, ...seconds, format: said };
      }
      if (control === "tension") return { name: "Tension", owner, exists: !!gb, own: gb ? signed.fromControl(gb.tension) : null, ...signed, format: (v) => percent(signed.toControl(v)) };
      // A slot: its number from the fraction (36 of them across the range), said with its name.
      const kind = control === "timeSlot" ? "time" : "volume";
      const last = GROSS_SLOTS - 1;
      const slotAt = (v: number) => Math.round(clamp(v, 0, 1) * last);
      return {
        name: kind === "time" ? "Time slot" : "Volume slot",
        owner,
        exists: !!gb,
        own: gb ? gb[control] / last : null,
        toControl: slotAt,
        fromControl: (v) => clamp(v / last, 0, 1),
        format: (v) => {
          const n = slotAt(v);
          const name = gb?.[kind][n]?.name ?? (kind === "time" ? GROSS_TIME_PRESETS : GROSS_VOLUME_PRESETS)[n].name;
          return `${n + 1}: ${name}`;
        },
      };
    }
    case "panMan": {
      // In its own units (degrees, Hz, dB): the clip's 0..1 is the knob's range.
      const found = findEffect(song, target.effect);
      const pm = found?.effect?.panMan;
      const control = PAN_CONTROLS[target.control];
      return {
        name: control.name,
        owner: found && pm ? `${found.effect!.plugin.name} (${mixerTrackName(song, found.track.id)})` : "A deleted PanMan",
        exists: !!pm,
        own: pm ? panControlFraction(target.control, pm[target.control]) : null,
        toControl: (v) => panControlValue(target.control, v),
        fromControl: (v) => panControlFraction(target.control, v),
        format: (v) => control.format(panControlValue(target.control, v)),
      };
    }
    case "autoTune": {
      const found = findEffect(song, target.effect);
      const at = found?.effect?.autoTune;
      const owner = found && at ? `${found.effect!.plugin.name} (${mixerTrackName(song, found.track.id)})` : "A deleted Auto-Tune";
      const info = AUTO_TUNE_CONTROL_INFO[target.control];
      const span = info.max - info.min;
      const toControl = (v: number) => {
        const x = info.min + clamp(v, 0, 1) * span;
        return info.whole ? Math.round(x) : x;
      };
      return {
        name: info.name,
        owner,
        exists: !!at,
        own: at ? clamp((info.get(at) - info.min) / span, 0, 1) : null,
        toControl,
        fromControl: (x) => clamp((x - info.min) / span, 0, 1),
        format: (v) => info.format(toControl(v)),
      };
    }
    case "pitchWheel": {
      const found = findEffect(song, target.effect);
      const pw = found?.effect?.pitchWheel;
      const owner = found && pw ? `${found.effect!.plugin.name} (${mixerTrackName(song, found.track.id)})` : "A deleted Pitch Wheel";
      const info = PITCH_WHEEL_CONTROL_INFO[target.control];
      const span = info.max - info.min;
      const toControl = (v: number) => info.min + clamp(v, 0, 1) * span;
      const { wheel, field } = controlField(target.control);
      return {
        name: info.name,
        owner,
        exists: !!pw,
        own: pw ? clamp((pw[wheel][field] - info.min) / span, 0, 1) : null,
        toControl,
        fromControl: (x) => clamp((x - info.min) / span, 0, 1),
        format: (v) => info.format(toControl(v)),
      };
    }
    case "echoBoy": {
      const found = findEffect(song, target.effect);
      const eb = found?.effect?.echoBoy ?? null;
      const spec = ECHO_CONTROL_SPECS[target.control];
      return {
        name: spec.name,
        owner: found && eb ? `${found.effect!.plugin.name} (${mixerTrackName(song, found.track.id)})` : "A deleted EchoBoy",
        exists: !!eb,
        own: eb ? spec.fromControl(spec.get(eb)) : null,
        toControl: spec.toControl,
        fromControl: spec.fromControl,
        format: (v) => spec.format(spec.toControl(v), eb),
      };
    }
    case "ott": {
      const found = findEffect(song, target.effect);
      const ott = found?.effect?.ott ?? null;
      const spec = OTT_CONTROL_SPECS[target.control];
      return {
        name: spec.name,
        owner: found && ott ? `${found.effect!.plugin.name} (${mixerTrackName(song, found.track.id)})` : "A deleted OTT",
        exists: !!ott,
        own: ott ? spec.fromControl(spec.get(ott)) : null,
        toControl: spec.toControl,
        fromControl: spec.fromControl,
        format: (v) => spec.format(spec.toControl(v)),
      };
    }
    case "reverb": {
      const found = findEffect(song, target.effect);
      const reverb = found?.effect?.reverb ?? null;
      const spec = REVERB_CONTROL_SPECS[target.control];
      return {
        name: spec.name,
        owner: found && reverb ? `${found.effect!.plugin.name} (${mixerTrackName(song, found.track.id)})` : "A deleted Reverb",
        exists: !!reverb,
        own: reverb ? spec.fromControl(spec.get(reverb)) : null,
        toControl: spec.toControl,
        fromControl: spec.fromControl,
        format: (v) => spec.format(spec.toControl(v)),
      };
    }
    case "proC": {
      const found = findEffect(song, target.effect);
      const proC = found?.effect?.proC ?? null;
      const spec = PRO_C_CONTROL_SPECS[target.control];
      return {
        name: spec.name,
        owner: found && proC ? `${found.effect!.plugin.name} (${mixerTrackName(song, found.track.id)})` : "A deleted Pro-C",
        exists: !!proC,
        own: proC ? spec.fromControl(spec.get(proC)) : null,
        toControl: spec.toControl,
        fromControl: spec.fromControl,
        format: (v) => spec.format(spec.toControl(v)),
      };
    }
    case "main":
      return { name: "Main volume", owner: "Song", exists: true, own: song.settings.volume, ...unit, format: percent };
    case "tempo": {
      // BPM across the song's whole range (a clip's Min / Max narrow it: `TEMPO_CLIP_RANGE`).
      const toControl = (v: number) => MIN_TEMPO + clamp(v, 0, 1) * (MAX_TEMPO - MIN_TEMPO);
      const fromControl = (bpm: number) => clamp((bpm - MIN_TEMPO) / (MAX_TEMPO - MIN_TEMPO), 0, 1);
      return { name: "Tempo", owner: "Song", exists: true, own: fromControl(song.settings.tempo), toControl, fromControl, format: (v) => `${Math.round(toControl(v) * 100) / 100} BPM` };
    }
    case "plugin": {
      let owner: string | null = null;
      if (target.owner === "channel") {
        const channel = song.channels.find((c) => c.id === target.id && c.kind === "plugin");
        if (channel) owner = channel.plugin && channel.plugin.name !== channel.name ? `${channel.plugin.name} (${channel.name})` : channel.name;
      } else {
        const found = findEffect(song, target.id);
        if (found) owner = `${found.effect!.plugin.name} (${mixerTrackName(song, found.track.id)})`;
      }
      return { name: target.name, owner: owner ?? "A deleted plugin", exists: owner !== null, own: null, ...unit, format: percent };
    }
  }
}

/** An automation clip's name for a control: "Volume (Kick)", "Cutoff (Serum 2)". */
export const controlName = (info: ControlInfo) => `${info.name} (${info.owner})`.slice(0, MAX_NAME);

// ---------------------------------------------------------------------------
// A control over the song
// ---------------------------------------------------------------------------

/** An automation clip on the playlist as it plays: its clip, curve, and where it is in the song. */
export interface PlacedAutomation {
  clip: PlaylistClip;
  automation: Automation;
  start: number;
  end: number;
}

/** The clips driving each control (by `targetKey`), in order of start. Muted clips and clips on muted tracks drive nothing. */
export type AutomationIndex = ReadonlyMap<string, readonly PlacedAutomation[]>;

const indexes = new WeakMap<PlaylistClip[], { automations: Automation[]; tracks: MusicProject["playlist"]["tracks"]; ctx: ClipContext; index: AutomationIndex }>();

/** The song's `AutomationIndex` (made once per clip list, automation list, tracks and context). */
export function automationIndex(song: MusicProject): AutomationIndex {
  const ctx = clipContext(song);
  const known = indexes.get(song.playlist.clips);
  if (known && known.automations === song.automations && known.tracks === song.playlist.tracks && known.ctx === ctx) return known.index;
  const byId = new Map(song.automations.map((a) => [a.id, a]));
  const index = new Map<string, PlacedAutomation[]>();
  for (const clip of song.playlist.clips) {
    if (clip.kind !== "automation" || clip.muted || trackAt(song, clip.track).muted) continue;
    const automation = byId.get(clip.ref);
    if (!automation) continue;
    const key = targetKey(automation.target);
    let list = index.get(key);
    if (!list) index.set(key, (list = []));
    list.push({ clip, automation, start: clip.start, end: clipEnd(clip, ctx) });
  }
  indexes.set(song.playlist.clips, { automations: song.automations, tracks: song.playlist.tracks, ctx, index });
  return index;
}

/** Of two clips over one tick, the one that wins: the later start, then the lower track, then the later clip. */
const wins = (a: PlacedAutomation, b: PlacedAutomation) => a.start > b.start || (a.start === b.start && (a.clip.track > b.clip.track || (a.clip.track === b.clip.track && a.clip.id > b.clip.id)));

/** A clip's value at a tick of the song (inside it, or its last value at its end). */
export function placedValue(placed: PlacedAutomation, tick: number, barTicks: number): number {
  const at = Math.min(tick, placed.end) - placed.start + placed.clip.offset;
  return automationValue(placed.automation, at, barTicks);
}

/**
 * Which clip says what a control is at `tick` of the song, and whether it's inside it or holding its
 * last value: where clips of it are, the one that started latest; after them, the one that ended latest
 * (it holds its value); before them all, none (the control is its own value).
 */
export function clipAtTick(placed: readonly PlacedAutomation[], tick: number): { placed: PlacedAutomation; holding: boolean } | null {
  let inside: PlacedAutomation | null = null;
  let before: PlacedAutomation | null = null;
  for (const p of placed) {
    if (p.start > tick) break;
    if (tick < p.end) {
      if (!inside || wins(p, inside)) inside = p;
    } else if (!before || p.end > before.end || (p.end === before.end && wins(p, before))) before = p;
  }
  if (inside) return { placed: inside, holding: false };
  return before ? { placed: before, holding: true } : null;
}

/**
 * What a control is at `tick` of the song in song mode, as a fraction of its range: its clip's curve, or
 * the last value of the clip before; null before any clip of it (or none at all): it's its own value then.
 */
export function controlAt(song: MusicProject, target: AutomationTarget, tick: number): number | null {
  const placed = automationIndex(song).get(targetKey(target));
  if (!placed) return null;
  const found = clipAtTick(placed, tick);
  return found ? placedValue(found.placed, tick, clipContext(song).barTicks) : null;
}

/** Whether any clip drives the control (in song mode). */
export const isAutomated = (song: MusicProject, target: AutomationTarget) => automationIndex(song).has(targetKey(target));

/**
 * The ticks from `from` to `to` where a control may jump: where its clips start and end, and their curves'
 * own breaks. Between two of them it changes smoothly (or not at all).
 */
export function controlBreaks(placed: readonly PlacedAutomation[], from: number, to: number): number[] {
  const breaks = new Set<number>();
  for (const p of placed) {
    if (p.start > to) break;
    if (p.end < from) continue;
    if (p.start >= from) breaks.add(p.start);
    if (p.end <= to) breaks.add(p.end);
    const shift = p.start - p.clip.offset;
    for (const at of curveBreaks(p.automation, Math.max(from, p.start) - shift, Math.min(to, p.end) - shift)) {
      const tick = at + shift;
      if (tick > p.start && tick < p.end) breaks.add(tick);
    }
  }
  return [...breaks].filter((t) => t >= from && t <= to).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Editing a curve's points (pure functions of a point list: the same list when nothing changes)
// ---------------------------------------------------------------------------

const tidyPoint = (p: AutomationPoint): AutomationPoint => ({ ...p, tick: Math.round(p.tick), value: clamp(p.value, 0, 1), tension: clamp(p.tension, -1, 1) });

/** Add a point (on the tick of others: after them). Its segment takes the shape of the one it splits. */
export function addPoint(points: AutomationPoint[], tick: number, value: number, length: number): { points: AutomationPoint[]; index: number } {
  if (points.length >= MAX_AUTOMATION_POINTS) return { points, index: -1 };
  const at = Math.round(clamp(tick, 0, length));
  let index = points.length;
  while (index > 0 && points[index - 1].tick > at) index--;
  // At 0, after the first point, so the curve still starts at 0.
  if (index === 0) index = 1;
  const after = points[index];
  const point = tidyPoint({ tick: Math.max(at, points[index - 1].tick), value, tension: after?.curve === "single" ? 0 : (after?.tension ?? 0), curve: after?.curve ?? "single" });
  return { points: [...points.slice(0, index), point, ...points.slice(index)], index };
}

/** Move a point: it stays between its neighbours (the first stays at 0, the last within the curve). */
export function movePoint(points: AutomationPoint[], index: number, tick: number, value: number, length: number): AutomationPoint[] {
  const point = points[index];
  if (!point) return points;
  const low = index === 0 ? 0 : points[index - 1].tick;
  const high = index === 0 ? 0 : index === points.length - 1 ? length : points[index + 1].tick;
  const next = tidyPoint({ ...point, tick: clamp(tick, low, high), value });
  if (next.tick === point.tick && next.value === point.value) return points;
  return points.map((p, i) => (i === index ? next : p));
}

/**
 * Move a point in FL's Slide mode: every point after it moves along with it (by as many ticks), so what
 * follows keeps its shape. It can't pass the point before, nor push the last past the curve's end.
 */
export function slidePoint(points: AutomationPoint[], index: number, tick: number, value: number, length: number): AutomationPoint[] {
  const point = points[index];
  if (!point) return points;
  const last = points[points.length - 1].tick;
  const delta = index === 0 ? 0 : clamp(Math.round(tick) - point.tick, points[index - 1].tick - point.tick, length - last);
  const moved = tidyPoint({ ...point, tick: point.tick + delta, value });
  if (delta === 0 && moved.value === point.value) return points;
  return points.map((p, i) => (i < index ? p : i === index ? moved : { ...p, tick: p.tick + delta }));
}

/**
 * FL's Step mode: steps painted onto a curve, `cells` (a step's start → its value, in ticks of the curve),
 * each `cell` ticks long. A step is a held value: what was in it goes, it jumps to its value at its start
 * and back to what the curve was at its end (unless another step follows). Points beyond the most a curve
 * may have aren't added.
 */
export function paintSteps(points: AutomationPoint[], cells: ReadonlyMap<number, number>, cell: number, length: number): AutomationPoint[] {
  let next = points;
  for (const [from, value] of [...cells].sort((a, b) => a[0] - b[0])) {
    const start = Math.round(clamp(from, 0, length));
    const end = Math.round(Math.min(from + cell, length));
    if (end <= start) continue;
    const after = curveValue(next, end);
    // The curve up to the step keeps its shape: a point where it starts, on the segment it cuts (a held one needs none).
    const arriving = next.find((p) => p.tick >= start);
    const lead = start > 0 && arriving && arriving.curve !== "hold" ? { ...arriving, tick: start, value: arriving.tick === start ? arriving.value : curveValue(next, start) } : null;
    const before = next.filter((p) => p.tick < start);
    const rest = next.filter((p) => p.tick >= end);
    // Held to its end, then the curve as it was there: onto the point already there, or a new one.
    const close: AutomationPoint[] =
      rest[0]?.tick === end ? [{ ...rest[0], curve: "hold", tension: 0 }, ...rest.slice(1)] : end < length ? [{ tick: end, value: after, tension: 0, curve: "hold" }, ...rest] : rest;
    const painted = [...before, ...(lead ? [lead] : []), { tick: start, value: clamp(value, 0, 1), tension: 0, curve: "hold" as const }, ...close];
    if (painted.length > MAX_AUTOMATION_POINTS) break;
    next = painted;
  }
  return next;
}

/** Delete a point. The first stays (a curve always starts somewhere). */
export function deletePoint(points: AutomationPoint[], index: number): AutomationPoint[] {
  if (index <= 0 || index >= points.length) return points;
  return points.filter((_, i) => i !== index);
}

/** Change a point's segment: its curve type, tension or value. */
export function updatePoint(points: AutomationPoint[], index: number, patch: Partial<Pick<AutomationPoint, "curve" | "tension" | "value">>): AutomationPoint[] {
  const point = points[index];
  if (!point) return points;
  const next = tidyPoint({ ...point, ...patch });
  if (next.curve === point.curve && next.tension === point.tension && next.value === point.value) return points;
  return points.map((p, i) => (i === index ? next : p));
}

const mapValues = (points: AutomationPoint[], change: (value: number, i: number) => number): AutomationPoint[] => {
  let any = false;
  const next = points.map((p, i) => {
    const value = clamp(change(p.value, i), 0, 1);
    if (value === p.value) return p;
    any = true;
    return { ...p, value };
  });
  return any ? next : points;
};

/** Flip vertically: the top becomes the bottom. */
export const flipPoints = (points: AutomationPoint[]) => mapValues(points, (v) => 1 - v);

/** Scale levels by `factor` about `around` (0.5: the middle). */
export const scalePoints = (points: AutomationPoint[], factor: number, around = 0.5) => mapValues(points, (v) => around + (v - around) * factor);

/** Normalize levels: stretched so the lowest is at 0 and the highest at 1. */
export function normalizePointLevels(points: AutomationPoint[]): AutomationPoint[] {
  let low = 1;
  let high = 0;
  for (const p of points) {
    low = Math.min(low, p.value);
    high = Math.max(high, p.value);
  }
  if (high - low < 1e-9) return points;
  return mapValues(points, (v) => (v - low) / (high - low));
}

/** Decimate points: every second one between the first and the last goes. */
export function decimatePoints(points: AutomationPoint[]): AutomationPoint[] {
  if (points.length <= 2) return points;
  return points.filter((_, i) => i === 0 || i === points.length - 1 || i % 2 === 0);
}

/** Smooth: each point between the first and last moves halfway towards its neighbours' average. */
export const smoothPoints = (points: AutomationPoint[]) =>
  mapValues(points, (v, i) => (i === 0 || i === points.length - 1 ? v : (points[i - 1].value + 2 * v + points[i + 1].value) / 4));

// ---------------------------------------------------------------------------
// Editing the song's automation clips
// ---------------------------------------------------------------------------

/** FL's automation clips' colour: what an automation clip without one of its own is drawn in. */
export const AUTOMATION_COLOR = "#7c6aa8";

/** Apply `change` to an automation clip (the same song if it returns the same clip). */
export function editAutomation(song: MusicProject, id: string, change: (automation: Automation) => Automation): MusicProject {
  const index = song.automations.findIndex((a) => a.id === id);
  if (index < 0) return song;
  const before = song.automations[index];
  const after = change(before);
  if (after === before) return song;
  const automations = [...song.automations];
  automations[index] = after;
  return { ...song, automations };
}

/** Change an automation clip's points (a function of its point list: `addPoint`, `movePoint`...). */
export const editPoints = (song: MusicProject, id: string, change: (points: AutomationPoint[], automation: Automation) => AutomationPoint[]) =>
  editAutomation(song, id, (a) => {
    const points = change(a.points, a);
    return points === a.points ? a : { ...a, points };
  });

export type AutomationPatch = Partial<Pick<Automation, "name" | "color" | "min" | "max" | "length">> & { lfo?: Partial<AutomationLfo> };

/** Change an automation clip's name, colour, range, length or LFO. Points past a shorter length are dropped. */
export function updateAutomation(song: MusicProject, id: string, patch: AutomationPatch): MusicProject {
  return editAutomation(song, id, (a) => {
    const next: Automation = {
      ...a,
      name: patch.name === undefined ? a.name : patch.name.trim().slice(0, MAX_NAME) || a.name,
      color: patch.color === undefined ? a.color : patch.color && /^#[0-9a-f]{6}$/i.test(patch.color) ? patch.color.toLowerCase() : null,
      min: patch.min === undefined ? a.min : clamp(patch.min, 0, 1),
      max: patch.max === undefined ? a.max : clamp(patch.max, 0, 1),
      length: patch.length === undefined ? a.length : Math.round(clamp(patch.length, 1, MAX_PATTERN_TICKS)),
      lfo: patch.lfo ? normalizeLfo({ ...a.lfo, ...patch.lfo }) : a.lfo,
    };
    if (next.length < a.length) next.points = a.points.filter((p, i) => i === 0 || p.tick <= next.length);
    const same =
      next.name === a.name && next.color === a.color && next.min === a.min && next.max === a.max && next.length === a.length && JSON.stringify(next.lfo) === JSON.stringify(a.lfo);
    return same ? a : next;
  });
}

/** Delete automation clips, and their clips on the playlist. */
export function removeAutomations(song: MusicProject, ids: ReadonlySet<string>): MusicProject {
  if (!song.automations.some((a) => ids.has(a.id))) return song;
  return {
    ...song,
    automations: song.automations.filter((a) => !ids.has(a.id)),
    playlist: { ...song.playlist, clips: song.playlist.clips.filter((c) => c.kind !== "automation" || !ids.has(c.ref)) },
  };
}

/** Where a new automation clip goes on the playlist, and how long it is: over the time selection, or the whole song. */
export interface AutomationPlace {
  start: number;
  length: number;
  /** Its track (default: the first one below every clip). */
  track?: number;
}

/**
 * Create automation clip (a control's menu, FL's): a new automation clip for `target`, flat at the control's
 * value now (a plugin parameter's `value`, which only the engine knows), and a clip of it at `place`.
 * The control's own value stays what it was: it's what plays before the clip.
 */
export function createAutomation(
  song: MusicProject,
  target: AutomationTarget,
  place: AutomationPlace,
  options: { id?: string; value?: number; name?: string } = {},
): { song: MusicProject; automationId: string; clipId: number } {
  const none = { song, automationId: "", clipId: -1 };
  if (song.automations.length >= MAX_AUTOMATIONS) return none;
  const info = controlOf(song, target);
  if (!info.exists) return none;
  const length = Math.round(clamp(place.length, STEP_TICKS, MAX_PATTERN_TICKS));
  const value = clamp(options.value ?? info.own ?? 0.5, 0, 1);
  // A tempo clip shows FL's range (60 to 180 BPM), taking in the tempo it starts at; the others, all of theirs.
  const range =
    target.kind === "tempo"
      ? { min: info.fromControl(Math.min(TEMPO_CLIP_RANGE.min, info.toControl(value) - 10)), max: info.fromControl(Math.max(TEMPO_CLIP_RANGE.max, info.toControl(value) + 10)) }
      : { min: 0, max: 1 };
  const start = range.max > range.min ? clamp((value - range.min) / (range.max - range.min), 0, 1) : value;
  const automation: Automation = {
    id: options.id ?? createId("auto"),
    name: (options.name ?? controlName(info)).slice(0, MAX_NAME),
    color: null,
    target,
    length,
    points: [
      { tick: 0, value: start, tension: 0, curve: "single" },
      { tick: length, value: start, tension: 0, curve: "single" },
    ],
    min: range.min,
    max: range.max,
    lfo: DEFAULT_LFO,
  };
  const track = place.track ?? Math.min(lastUsedTrack(song.playlist.clips) + 1, MAX_PLAYLIST_TRACKS - 1);
  const { clips, created } = addClips(song.playlist.clips, [{ kind: "automation", ref: automation.id, track, start: place.start, length: null, offset: 0 }]);
  return { song: { ...song, automations: [...song.automations, automation], playlist: { ...song.playlist, clips } }, automationId: automation.id, clipId: created[0] ?? -1 };
}

/** The tempo range a new tempo automation clip's Min / Max cover (FL's default), widened to take in the song's own tempo. */
export const TEMPO_CLIP_RANGE = { min: 60, max: 180 };

/** The automation clips of a control (every one, playing or not). */
export const automationsOf = (song: MusicProject, target: AutomationTarget) => {
  const key = targetKey(target);
  return song.automations.filter((a) => targetKey(a.target) === key);
};

/** Where in its curve a clip is at a tick of the song (the clip's own ticks into the curve). */
export const curveTickAt = (clip: PlaylistClip, tick: number) => tick - clip.start + clip.offset;
