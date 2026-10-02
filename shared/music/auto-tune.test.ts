import { describe, expect, it } from "vitest";
import {
  applyAutoTunePreset,
  autoTunes,
  currentPreset,
  detectKey,
  engineAutoTune,
  engineControlValue,
  findAutoTune,
  keyText,
  notesEdited,
  referenceHz,
  setAllNotes,
  setAutoTuneNote,
  trackingThreshold,
  updateAutoTune,
  vibratoGain,
} from "./auto-tune.ts";
import { AUTO_TUNE_PLUGIN, AUTO_TUNE_PRESETS, DEFAULT_AUTO_TUNE, INPUT_TYPES, noteName, normalizeAutoTune, scaleNotes } from "./auto-tune-presets.ts";
import { controlOf, createAutomation, targetKey } from "./automation.ts";
import { compileSong } from "./compile.ts";
import { addChannels, setChannelNotes } from "./edits.ts";
import { setEffect } from "./mixer.ts";
import { addClips, editClips } from "./playlist.ts";
import { FIRST_PATTERN_ID, createMusicProject, normalizeMusicProject } from "./project.ts";
import type { MusicProject, Note } from "./types.ts";

const P = FIRST_PATTERN_ID;
const FX = "fx_tune";

/** A song with an Auto-Tune in Insert 1's first slot. */
function withAutoTune(): MusicProject {
  const song = addChannels(createMusicProject("Vocal"), [{ id: "chan_vox", name: "Vox", sampleId: "media_vox" }]);
  return setEffect(song, "insert_1", 0, AUTO_TUNE_PLUGIN, FX);
}
const at = (song: MusicProject) => findAutoTune(song, FX)!.autoTune;

describe("a new Auto-Tune", () => {
  it("is hard-tuned, Alto/Tenor, C Chromatic", () => {
    const song = withAutoTune();
    expect(at(song)).toBe(DEFAULT_AUTO_TUNE);
    expect(at(song)).toMatchObject({ input: "altoTenor", key: 0, scale: "chromatic", retuneSpeed: 0, humanize: 0, flexTune: 0, formant: true });
    expect(at(song).notes.every((n) => n === "tune")).toBe(true);
    expect(autoTunes(song)).toHaveLength(1);
    expect(findAutoTune(song, "fx_none")).toBeNull();
  });

  it("survives a save and a load, and anything wrong in it is its default", () => {
    let song = updateAutoTune(withAutoTune(), FX, { key: 9, scale: "minor", retuneSpeed: 25, vibrato: { shape: "sine", pitch: 30 } });
    song = setAutoTuneNote(song, FX, 0, "bypass");
    const loaded = normalizeMusicProject(JSON.parse(JSON.stringify(song)));
    expect(at(loaded)).toEqual(at(song));
    expect(normalizeAutoTune({ input: "tuba", key: 13, scale: "mystery", retuneSpeed: 9000, notes: ["tune"], throat: 0, vibrato: { shape: "zigzag", amplitude: 5 } })).toMatchObject({
      input: "altoTenor",
      key: 0,
      scale: "chromatic",
      retuneSpeed: 400,
      throat: 0.5,
      vibrato: { shape: "none", amplitude: 0.3 },
    });
    expect(normalizeAutoTune(null)).toBe(DEFAULT_AUTO_TUNE);
  });
});

describe("its edits", () => {
  it("returns the same song when nothing changes", () => {
    const song = withAutoTune();
    expect(updateAutoTune(song, FX, {})).toBe(song);
    expect(updateAutoTune(song, FX, { retuneSpeed: 0, key: 0 })).toBe(song);
    expect(updateAutoTune(song, "fx_none", { retuneSpeed: 10 })).toBe(song);
    expect(setAutoTuneNote(song, FX, 3, "tune")).toBe(song);
  });

  it("clamps what's out of range", () => {
    const song = updateAutoTune(withAutoTune(), FX, { retuneSpeed: -5, humanize: 2, transpose: 30.4, detune: -500, throat: 9, vibrato: { rate: 50 } });
    expect(at(song)).toMatchObject({ retuneSpeed: 0, humanize: 1, transpose: 12, detune: -100, throat: 1.8, vibrato: { rate: 10 } });
  });

  it("makes a new key or scale's notes, unless notes are given", () => {
    let song = updateAutoTune(withAutoTune(), FX, { key: 2, scale: "major" });
    expect(at(song).notes).toEqual(scaleNotes(2, "major"));
    // D major: D E F# G A B C#.
    expect(at(song).notes.flatMap((n, pc) => (n === "tune" ? [pc] : []))).toEqual([1, 2, 4, 6, 7, 9, 11]);
    song = setAutoTuneNote(song, FX, 6, "bypass");
    expect(notesEdited(at(song))).toBe(true);
    // Another setting keeps the edit; another scale doesn't.
    expect(at(updateAutoTune(song, FX, { retuneSpeed: 20 })).notes[6]).toBe("bypass");
    expect(notesEdited(at(updateAutoTune(song, FX, { scale: "minor" })))).toBe(false);
  });

  it("never removes every note", () => {
    let song = updateAutoTune(withAutoTune(), FX, { scale: "majorPentatonic" });
    for (const pc of [0, 2, 4, 7]) song = setAutoTuneNote(song, FX, pc, "remove");
    expect(setAutoTuneNote(song, FX, 9, "remove")).toBe(song);
    // Remove All keeps the key's note.
    song = setAllNotes(updateAutoTune(withAutoTune(), FX, { key: 5 }), FX, "remove");
    expect(at(song).notes.flatMap((n, pc) => (n === "tune" ? [pc] : []))).toEqual([5]);
    expect(at(setAllNotes(song, FX, "tune")).notes.every((n) => n === "tune")).toBe(true);
  });

  it("puts a preset's sound on, leaving the key, scale and voice", () => {
    let song = updateAutoTune(withAutoTune(), FX, { key: 7, scale: "minor", input: "soprano", retuneSpeed: 50 });
    song = applyAutoTunePreset(song, FX, "natural vocal");
    expect(at(song)).toMatchObject({ key: 7, scale: "minor", input: "soprano", retuneSpeed: 30, humanize: 0.4, flexTune: 0.2 });
    expect(currentPreset(at(song))).toBe("Natural Vocal");
    expect(applyAutoTunePreset(song, FX, "Natural Vocal")).toBe(song);
    expect(applyAutoTunePreset(song, FX, "nothing")).toBe(song);
    // Presets set back what the last one changed.
    song = applyAutoTunePreset(applyAutoTunePreset(song, FX, "Vibrato Lead"), FX, "Hard Tune");
    expect(at(song)).toMatchObject({ retuneSpeed: 0, humanize: 0, vibrato: { shape: "none" } });
    expect(currentPreset(DEFAULT_AUTO_TUNE)).toBe("Hard Tune");
    expect(new Set(AUTO_TUNE_PRESETS.map((p) => p.name)).size).toBe(AUTO_TUNE_PRESETS.length);
  });
});

describe("detecting the song's key", () => {
  const notes = (pitches: number[], length = 96): Note[] => pitches.map((pitch, i) => ({ id: i + 1, start: i * length, length, pitch, velocity: 0.8, pan: 0, muted: false }));
  const songWith = (pitches: number[], drums: number[] = []) => {
    let song = addChannels(createMusicProject("Song"), [
      { id: "chan_keys", name: "Keys", sampleId: null },
      { id: "chan_kick", name: "Kick", sampleId: null },
    ]);
    song = setChannelNotes(song, P, "chan_keys", () => notes(pitches));
    if (drums.length) song = setChannelNotes(song, P, "chan_kick", () => notes(drums, 24));
    return song;
  };

  it("hears a major and a minor key from the notes, leaving out drums", () => {
    // A minor: A C E, G B D, F A C, E G# B.
    expect(detectKey(songWith([57, 60, 64, 69, 55, 59, 62, 67, 53, 57, 60, 65, 52, 56, 59, 64, 57, 60, 64, 57]))).toMatchObject({ key: 9, scale: "minor" });
    // E♭ major, with a kick on C hammering away (one pitch: a drum, left out).
    const eFlat = songWith([63, 67, 70, 75, 68, 72, 75, 70, 74, 77, 63, 67, 70], Array(40).fill(60));
    expect(detectKey(eFlat)).toMatchObject({ key: 3, scale: "major" });
    expect(keyText(3, "major")).toBe("D# Major");
  });

  it("says nothing without enough pitched notes", () => {
    expect(detectKey(createMusicProject("Empty"))).toBeNull();
    expect(detectKey(songWith([60, 60, 60]))).toBeNull();
  });
});

describe("what the engine plays", () => {
  it("is in the engine's units", () => {
    const song = updateAutoTune(withAutoTune(), FX, { input: "lowMale", retuneSpeed: 50, naturalVibrato: -6, detune: 100, tracking: 1, vibrato: { shape: "saw", pitch: 50, delay: 250 } });
    const engine = engineAutoTune(at(song));
    expect(engine).toMatchObject({ minHz: INPUT_TYPES.lowMale.minHz, maxHz: INPUT_TYPES.lowMale.maxHz, retune: 0.05, vibrato: { shape: "saw", depth: 0.5, delay: 0.25 } });
    expect(engine.threshold).toBeCloseTo(0.35, 6);
    expect(engine.reference).toBeCloseTo(440 * 2 ** (1 / 12), 6);
    expect(engine.vibratoGain).toBeCloseTo(0.501, 3);
    expect(engine.notes).toEqual(Array(12).fill(0));
    expect(trackingThreshold(0)).toBeCloseTo(0.07, 6);
    expect(referenceHz(0)).toBe(440);
    expect(vibratoGain(0)).toBe(1);
    expect(engineAutoTune(at(setAutoTuneNote(setAutoTuneNote(song, FX, 1, "bypass"), FX, 2, "remove"))).notes.slice(0, 3)).toEqual([0, 1, 2]);
  });

  it("goes with its effect to the engine", () => {
    const song = withAutoTune();
    const compiled = compileSong(song, P);
    const track = compiled.tracks.find((t) => t.id === "insert_1")!;
    expect(track.effects[0]).toMatchObject({ id: FX, plugin: { id: AUTO_TUNE_PLUGIN.id }, autoTune: { retune: 0, minHz: 75 } });
  });

  it("automates its controls as lanes in their engine units, in song mode", () => {
    let song = withAutoTune();
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern" as const, ref: P, track: 0, start: 0, length: null }]).clips);
    const retune = createAutomation(song, { kind: "autoTune", effect: FX, control: "retuneSpeed" }, { start: 0, length: 384 }, { value: 0.5 });
    const key = createAutomation(retune.song, { kind: "autoTune", effect: FX, control: "key" }, { start: 0, length: 384 }, { value: 7 / 11 });
    const lanes = compileSong(key.song, P, null, "song").lanes;
    const retuneLane = lanes.find((l) => l.target.kind === "tune" && l.target.control === "retuneSpeed")!;
    expect(retuneLane.values[0]).toBeCloseTo(0.2, 6);
    const keyLane = lanes.find((l) => l.target.kind === "tune" && l.target.control === "key")!;
    expect(keyLane.values[0]).toBe(7);
    expect(engineControlValue("naturalVibrato", 6)).toBeCloseTo(1.995, 3);
    // In pattern mode, none.
    expect(compileSong(key.song, P).lanes).toEqual([]);
  });

  it("automates Detune, Tracking and Create Vibrato's knobs too, in the engine's units", () => {
    let song = withAutoTune();
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern" as const, ref: P, track: 0, start: 0, length: null }]).clips);
    const detune = createAutomation(song, { kind: "autoTune", effect: FX, control: "detune" }, { start: 0, length: 384 }, { value: 1 });
    const delay = createAutomation(detune.song, { kind: "autoTune", effect: FX, control: "vibratoDelay" }, { start: 0, length: 384 }, { value: 0.5 });
    const lanes = compileSong(delay.song, P, null, "song").lanes;
    // +100 cents: A4 a semitone up; half of 1500 ms, in seconds.
    expect(lanes.find((l) => l.target.kind === "tune" && l.target.control === "detune")!.values[0]).toBeCloseTo(440 * 2 ** (1 / 12), 3);
    expect(lanes.find((l) => l.target.kind === "tune" && l.target.control === "vibratoDelay")!.values[0]).toBeCloseTo(0.75, 6);
    const rate = controlOf(song, { kind: "autoTune", effect: FX, control: "vibratoRate" });
    expect(rate).toMatchObject({ name: "Vibrato Rate", exists: true });
    expect(rate.toControl(rate.own!)).toBeCloseTo(5.5, 6);
    expect(engineControlValue("tracking", 0)).toBeCloseTo(0.07, 6);
    expect(engineControlValue("vibratoPitch", 18)).toBeCloseTo(0.18, 6);
  });

  it("names its controls for automation", () => {
    const song = withAutoTune();
    expect(targetKey({ kind: "autoTune", effect: FX, control: "flexTune" })).toBe("tune:fx_tune:flexTune");
    const info = controlOf(song, { kind: "autoTune", effect: FX, control: "transpose" });
    expect(info).toMatchObject({ name: "Transpose", owner: "Auto-Tune (Insert 1)", exists: true, own: 0.5 });
    expect(info.toControl(1)).toBe(12);
    expect(info.format(0.75)).toBe("+6 st");
    expect(controlOf(song, { kind: "autoTune", effect: FX, control: "key" }).format(9 / 11)).toBe("A");
    expect(controlOf(song, { kind: "autoTune", effect: "fx_gone", control: "key" }).exists).toBe(false);
    expect(noteName(60)).toBe("C4");
  });
});
