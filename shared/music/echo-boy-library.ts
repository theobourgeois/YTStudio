/**
 * EchoBoy's factory presets (`docs/soundtoys/echoboy-manual.md`, Factory presets): in its v1 folders, the ones
 * its manuals and reviews show made to their settings (15 ips Tape Echo, AnaLogged, RockVocal, DarkEchoCan,
 * Complex Pedal Pattern, the Chorus folder), the rest ours, made for what each folder is for.
 */
import { DEFAULT_ECHO_BOY, normalizeEchoBoy } from "./echo-boy-presets.ts";
import { RHYTHM_PATTERNS, editEchoBoy, echoTempo, layOutRhythm, usePattern } from "./echo-boy.ts";
import type { EchoBoy, EchoNote, EchoRhythm, EchoSync, MusicProject } from "./types.ts";

export const PRESET_FOLDERS = ["Basic", "Bass", "Chorus", "Classic", "Drums", "Effected", "Guitar", "MultiTap", "Rhythmic", "Spacy", "Verbs", "Vocal", "WayOut"] as const;
export type PresetFolder = (typeof PRESET_FOLDERS)[number];

/** A preset: its folder, name, and what it changes from a new EchoBoy (its rhythm by a pattern's name, laid out or not). */
export interface EchoPreset {
  folder: PresetFolder;
  name: string;
  settings: Partial<Omit<EchoBoy, "rhythm" | "preset">>;
  rhythm?: { pattern?: string; time?: [EchoSync, EchoNote | number]; repeats?: number } & Partial<Omit<EchoRhythm, "time" | "taps" | "pattern" | "repeats">>;
}

const note = (n: EchoNote, sync: EchoSync = "note") => ({ sync, ms: 250, note: n });
const ms = (value: number) => ({ sync: "time" as const, ms: value, note: 8 as EchoNote });

export const ECHO_PRESETS: readonly EchoPreset[] = [
  { folder: "Basic", name: "Quarter Note Tape", settings: { echo1: note(4), feedback: 0.35, mix: 0.4, style: "Studio Tape" } },
  { folder: "Basic", name: "Eighth Note Tape", settings: { echo1: note(8), feedback: 0.4, mix: 0.4, style: "Studio Tape" } },
  { folder: "Basic", name: "Dotted Eighth", settings: { echo1: note(8, "dot"), feedback: 0.45, mix: 0.38, style: "Master Tape", width: 0.6 } },
  { folder: "Basic", name: "Clean Digital 1/4", settings: { echo1: note(4), feedback: 0.4, mix: 0.4, style: "Digital Delay" } },
  { folder: "Basic", name: "Slapback", settings: { echo1: ms(110), feedback: 0.1, mix: 0.42, style: "Studio Tape", width: 0.3 } },

  { folder: "Bass", name: "Dub Bass Throw", settings: { echo1: note(8, "dot"), feedback: 0.55, mix: 0.35, style: "Space Echo", lowCut: 60, highCut: 3500 } },
  { folder: "Bass", name: "Tight Low Slap", settings: { echo1: ms(70), feedback: 0.08, mix: 0.3, style: "Analog Delay", width: 0, highCut: 2500 } },
  { folder: "Bass", name: "Octave Thump", settings: { echo1: note(16), feedback: 0.2, mix: 0.3, style: "Fat", lowCut: 40, highCut: 1800 } },

  { folder: "Chorus", name: "Chorus Deep", settings: { echo1: ms(18), feedback: 0.15, mix: 0.5, style: "Analog Chorus", width: 0.85 } },
  { folder: "Chorus", name: "Chorus Light", settings: { echo1: ms(12), feedback: 0.05, mix: 0.35, style: "DigitalChorus", width: 0.7 } },
  { folder: "Chorus", name: "Chorus Ping-Pong Wash", settings: { mode: "pingPong", echo1: ms(23), echo2: ms(31), feedback: 0.35, mix: 0.45, style: "CE-1 Chorus", width: 0.8 } },
  { folder: "Chorus", name: "Chorus Wash", settings: { echo1: ms(27), feedback: 0.4, mix: 0.45, style: "Analog Chorus", width: 0.9 } },
  { folder: "Chorus", name: "DoubleJumper", settings: { mode: "dual", echo1: ms(19), echo2: ms(29), feedback: 0.2, mix: 0.45, style: "Memory Man", width: 0.75, offset: 0 } },
  { folder: "Chorus", name: "DualChorus", settings: { mode: "dual", echo1: ms(14), echo2: ms(21), feedback: 0.1, mix: 0.45, style: "CE-1 Chorus", width: 0.8, offset: 0 } },
  { folder: "Chorus", name: "DualWarbler", settings: { mode: "dual", echo1: ms(24), echo2: ms(36), feedback: 0.25, mix: 0.45, style: "Binsonette", width: 0.8, offset: 0 } },
  { folder: "Chorus", name: "Rich Chorus", settings: { echo1: ms(20), feedback: 0.1, mix: 0.5, style: "CE-1 Chorus", width: 0.85, primeNumbers: true } },
  { folder: "Chorus", name: "Rich Feedback Chorus", settings: { echo1: ms(16), feedback: 0.55, mix: 0.45, style: "Analog Chorus", width: 0.85, primeNumbers: true } },

  { folder: "Classic", name: "15 ips Tape Echo", settings: { echo1: ms(126.2), feedback: 0.3, mix: 0.4, style: "Studio Tape" } },
  { folder: "Classic", name: "AnaLogged", settings: { mode: "dual", echo1: note(8), echo2: note(8), feedback: 0.45, mix: 0.4, style: "DM-2", primeNumbers: true, width: 0.6 } },
  { folder: "Classic", name: "Space Echo Dub", settings: { echo1: note(8, "dot"), feedback: 0.7, mix: 0.4, style: "Space Echo", lowCut: 120, saturation: 0.6 } },
  { folder: "Classic", name: "EP-3 Rockabilly", settings: { echo1: ms(140), feedback: 0.2, mix: 0.4, style: "EchoPlex", width: 0.2 } },
  { folder: "Classic", name: "Memory Man Lead", settings: { echo1: ms(380), feedback: 0.45, mix: 0.38, style: "Memory Man", width: 0.6 } },
  { folder: "Classic", name: "DarkEchoCan", settings: { mode: "pingPong", echo1: ms(93.8), echo2: ms(93.8), feedback: 0.5, mix: 0.4, style: "TelRay", width: 0.75 } },

  { folder: "Drums", name: "Snare Slap Room", settings: { echo1: ms(45), feedback: 0.2, mix: 0.3, style: "Splattered", width: 0.8 } },
  { folder: "Drums", name: "Gated Reflections", settings: { mode: "rhythm", feedback: 0, mix: 0.35, style: "Limited", width: 0.7 }, rhythm: { time: ["note", 32], repeats: 6, shape: "decay", shapeAmount: 0.9, panShape: "alt3" } },
  { folder: "Drums", name: "Nasty Old Verb", settings: { echo1: ms(60), feedback: 0.5, mix: 0.35, style: "Verbed", saturation: 0.7 } },
  { folder: "Drums", name: "Kick Smear", settings: { echo1: note(16), feedback: 0.25, mix: 0.25, style: "Distressed", highCut: 4000 } },

  { folder: "Effected", name: "Telephone Throw", settings: { echo1: note(4), feedback: 0.45, mix: 0.45, style: "Telephone" } },
  { folder: "Effected", name: "PopStarRadioEcho", settings: { mode: "pingPong", echo1: note(8), echo2: note(8), feedback: 0.4, mix: 0.4, style: "FM Radio", width: 0.75 } },
  { folder: "Effected", name: "Shortwave Ghost", settings: { echo1: note(4, "dot"), feedback: 0.55, mix: 0.4, style: "Shortwave" } },
  { folder: "Effected", name: "Transmitter Grit", settings: { echo1: note(8), feedback: 0.4, mix: 0.4, style: "Transmitter", saturation: 0.65 } },
  { folder: "Effected", name: "Queeked Out", settings: { echo1: note(16, "dot"), feedback: 0.5, mix: 0.4, style: "Queeked" } },

  { folder: "Guitar", name: "Lead Dotted Eighth", settings: { echo1: note(8, "dot"), feedback: 0.4, mix: 0.35, style: "Analog Delay", width: 0.7 } },
  { folder: "Guitar", name: "DirtyFaderSolo", settings: { mode: "dual", echo1: note(8), echo2: note(8, "dot"), feedback: 0.5, mix: 0.38, style: "Distorted", saturation: 0.6 } },
  { folder: "Guitar", name: "Surf Tank", settings: { echo1: ms(95), feedback: 0.35, mix: 0.45, style: "Binsonette" } },
  { folder: "Guitar", name: "Edge Ping Pong", settings: { mode: "pingPong", echo1: note(8, "dot"), echo2: note(4), feedback: 0.35, mix: 0.35, style: "DM-2", width: 0.75 } },

  { folder: "MultiTap", name: "Complex Pedal Pattern", settings: { mode: "rhythm", feedback: 0.3, mix: 0.4, style: "DM-2" }, rhythm: { pattern: "Complex Pedal Pattern", shape: "decay", shapeAmount: 0.6 } },
  { folder: "MultiTap", name: "Gallop Taps", settings: { mode: "rhythm", feedback: 0.25, mix: 0.4, style: "Studio Tape" }, rhythm: { pattern: "Gallop", panShape: "alt1" } },
  { folder: "MultiTap", name: "Bouncing Ball", settings: { mode: "rhythm", feedback: 0, mix: 0.4, style: "Analog Delay" }, rhythm: { pattern: "Bounce", shape: "decay", shapeAmount: 0.3, panShape: "sweepR" } },
  { folder: "MultiTap", name: "Eighties Reverse", settings: { mode: "rhythm", feedback: 0, mix: 0.45, style: "Digital Delay" }, rhythm: { time: ["note", 16], repeats: 7, shape: "reverse", shapeAmount: 1, panShape: "pan" } },

  { folder: "Rhythmic", name: "Clave Echo", settings: { mode: "rhythm", feedback: 0.35, mix: 0.4, style: "Analog Delay" }, rhythm: { pattern: "Clave", panShape: "alt2" } },
  { folder: "Rhythmic", name: "Tresillo Dub", settings: { mode: "rhythm", feedback: 0.55, mix: 0.4, style: "Space Echo" }, rhythm: { pattern: "Tresillo", panShape: "alt1" } },
  { folder: "Rhythmic", name: "Shuffle Eighths", settings: { echo1: note(8), feedback: 0.5, mix: 0.4, style: "Studio Tape", groove: -0.8 } },
  { folder: "Rhythmic", name: "Triplet Ping Pong", settings: { mode: "pingPong", echo1: note(8, "trip"), echo2: note(8, "trip"), feedback: 0.45, mix: 0.38, style: "Master Tape", width: 0.75 } },

  { folder: "Spacy", name: "Long Tape Wash", settings: { echo1: note(4, "dot"), feedback: 0.75, mix: 0.4, style: "Ambient", width: 0.85, highCut: 5000 } },
  { folder: "Spacy", name: "Oil Can Drift", settings: { mode: "dual", echo1: ms(430), echo2: ms(610), feedback: 0.65, mix: 0.4, style: "TelRay", width: 0.9 } },
  { folder: "Spacy", name: "Self-Oscillation", settings: { echo1: ms(280), feedback: 0.92, mix: 0.5, style: "Space Echo", saturation: 0.6 } },

  { folder: "Verbs", name: "Small Room", settings: { echo1: ms(28), feedback: 0.35, mix: 0.3, style: "Diffused", width: 0.85 } },
  { folder: "Verbs", name: "Plate-ish", settings: { echo1: ms(55), feedback: 0.6, mix: 0.3, style: "Diffused", width: 0.9, highCut: 7000 } },
  { folder: "Verbs", name: "Cheap Verb Chaser", settings: { echo1: note(8), feedback: 0.3, mix: 0.35, style: "Verbed", width: 0.8 } },

  { folder: "Vocal", name: "RockVocal", settings: { mode: "dual", echo1: note(16, "trip"), echo2: note(16, "trip"), feedback: 0.3, mix: 0.35, style: "Studio Tape", width: 0.7 } },
  { folder: "Vocal", name: "HallwayVocal", settings: { mode: "dual", echo1: ms(62), echo2: ms(74), feedback: 0.25, mix: 0.35, style: "Splattered", width: 0.85, offset: 0 } },
  { folder: "Vocal", name: "Vocal Throw 1/4", settings: { echo1: note(4), feedback: 0.45, mix: 0.4, style: "Studio Tape", lowCut: 250, highCut: 6000 } },
  { folder: "Vocal", name: "Vocal Doubler", settings: { mode: "dual", echo1: ms(19), echo2: ms(27), feedback: 0, mix: 0.4, style: "Master Tape", width: 0.85, offset: 0 } },

  { folder: "WayOut", name: "Runaway Tape", settings: { echo1: note(16), feedback: 0.95, mix: 0.45, style: "Saturated", saturation: 0.75 } },
  { folder: "WayOut", name: "Vibrato Ghost", settings: { echo1: ms(5), feedback: 0, mix: 0.75, style: "Vibrato" } },
  { folder: "WayOut", name: "Robot Flange", settings: { echo1: ms(3), feedback: 0.85, mix: 0.5, style: "Digital Delay", primeNumbers: true } },
];

/** A preset's settings at a tempo: a new EchoBoy, the preset's changes, its pattern. */
export function presetSettings(preset: EchoPreset, songTempo: number): EchoBoy {
  const base = normalizeEchoBoy({ ...DEFAULT_ECHO_BOY, ...preset.settings, preset: preset.name });
  if (!preset.rhythm) return base;
  const { pattern, time, repeats, ...rest } = preset.rhythm;
  let rhythm: EchoRhythm = { ...base.rhythm, ...rest };
  const found = pattern && RHYTHM_PATTERNS.find((p) => p.name === pattern);
  if (found) rhythm = usePattern(rhythm, found);
  else if (time || repeats) {
    const [sync, value] = time ?? [rhythm.time.sync, rhythm.time.note];
    const t = sync === "time" ? { sync, ms: value, note: rhythm.time.note } : { sync, ms: rhythm.time.ms, note: value as EchoNote };
    rhythm = layOutRhythm(rhythm, echoTempo(base, songTempo), { time: t, repeats: repeats ?? rhythm.repeats });
  }
  return normalizeEchoBoy({ ...base, rhythm });
}

/** Load a preset by name (the whole EchoBoy as the preset makes it). */
export function loadPreset(song: MusicProject, effectId: string, name: string): MusicProject {
  const preset = ECHO_PRESETS.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!preset) return song;
  return editEchoBoy(song, effectId, () => presetSettings(preset, song.settings.tempo));
}
