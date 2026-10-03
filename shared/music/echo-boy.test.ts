import { describe, expect, it } from "vitest";
import { controlOf, createAutomation, editPoints } from "./automation.ts";
import { compileSong } from "./compile.ts";
import {
  ECHO_CONTROL_SPECS,
  RHYTHM_PATTERNS,
  addTap,
  echoBoys,
  echoMs,
  editStyle,
  editTaps,
  engineEchoBoy,
  findEchoBoy,
  heardTaps,
  knobToMs,
  layOutRhythm,
  mixGains,
  moveTap,
  msToKnob,
  parseEchoTime,
  primeTimes,
  revertStyle,
  setStyle,
  styleLabel,
  styleOf,
  tappedTempo,
  timeText,
  updateEchoBoy,
  usePattern,
} from "./echo-boy.ts";
import { ECHO_PRESETS, loadPreset, presetSettings } from "./echo-boy-library.ts";
import { DEFAULT_ECHO_BOY, ECHO_BOY_PLUGIN, evenTaps, noteBeats, normalizeEchoBoy } from "./echo-boy-presets.ts";
import { ECHO_STYLES, decayDb, styleNamed } from "./echo-boy-styles.ts";
import { setEffect } from "./mixer.ts";
import { addClips, editClips } from "./playlist.ts";
import { FIRST_PATTERN_ID, createMusicProject, normalizeMusicProject, normalizeTarget } from "./project.ts";
import { ECHO_CONTROLS, type EchoBoy, type MusicProject } from "./types.ts";

const P = FIRST_PATTERN_ID;
const BAR = 384;
const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

/** A song at 120 BPM with an EchoBoy in Insert 1's first slot. */
function withEchoBoy(): MusicProject {
  return setEffect(createMusicProject("Echoes", 120), "insert_1", 0, ECHO_BOY_PLUGIN, "fx_echo");
}
const eb = (song: MusicProject) => findEchoBoy(song, "fx_echo")!.echoBoy;
const engine = (patch: Partial<EchoBoy>, tempo = 120) => engineEchoBoy({ ...DEFAULT_ECHO_BOY, ...patch }, tempo);

describe("EchoBoy's settings", () => {
  it("is put in a slot with its defaults, and found", () => {
    const song = withEchoBoy();
    expect(eb(song)).toEqual(DEFAULT_ECHO_BOY);
    expect(echoBoys(song).map((e) => e.effect.id)).toEqual(["fx_echo"]);
    expect(findEchoBoy(song, "fx_nope")).toBeNull();
  });

  it("survives a save and load, and repairs what's wrong", () => {
    let song = updateEchoBoy(withEchoBoy(), "fx_echo", { mode: "dual", feedback: 0.8, echo2: { sync: "time", ms: 333 } });
    song = editStyle(song, "fx_echo", (s) => ({ ...s, wobble: { ...s.wobble, depth: 40 } }));
    expect(eb(normalizeMusicProject(JSON.parse(JSON.stringify(song))))).toEqual(eb(song));
    const repaired = normalizeEchoBoy({ mode: "loud", mix: 7, echo1: { sync: "note", note: 3 }, style: "Nope", rhythm: { taps: [{ beat: 9, level: 1 }, { beat: 0.5, level: 4 }, { beat: 0.5 }] } });
    expect(repaired.mode).toBe("single");
    expect(repaired.mix).toBe(1);
    expect(repaired.echo1).toEqual({ sync: "note", ms: 250, note: 8 });
    expect(repaired.style).toBe("Studio Tape");
    expect(repaired.rhythm.taps).toEqual([{ beat: 0.5, level: 1 }]);
  });

  it("returns the same song when nothing changes, and forgets a preset's name once the sound does", () => {
    const song = updateEchoBoy(withEchoBoy(), "fx_echo", { preset: "AnaLogged" });
    expect(updateEchoBoy(song, "fx_echo", { mix: DEFAULT_ECHO_BOY.mix })).toBe(song);
    expect(eb(song).preset).toBe("AnaLogged");
    expect(eb(updateEchoBoy(song, "fx_echo", { mix: 0.9 })).preset).toBeNull();
  });

  it("keeps each echo's ms and note value apart, as EchoBoy's knobs do", () => {
    let song = updateEchoBoy(withEchoBoy(), "fx_echo", { echo1: { sync: "time", ms: 126.2 } });
    song = updateEchoBoy(song, "fx_echo", { echo1: { sync: "dot" } });
    expect(eb(song).echo1).toEqual({ sync: "dot", ms: 126.2, note: 8 });
  });

  it("picks styles by name and says Custom once the Style Editor changes one", () => {
    let song = setStyle(withEchoBoy(), "fx_echo", "Space Echo");
    expect(styleLabel(eb(song))).toBe("Space Echo");
    expect(setStyle(song, "fx_echo", "Not a style")).toBe(song);
    song = editStyle(song, "fx_echo", (s) => ({ ...s, high: { ...s.high, gain: -20 } }));
    expect(styleLabel(eb(song))).toBe("Custom");
    expect(styleOf(eb(song)).high.gain).toBe(-20);
    expect(eb(revertStyle(song, "fx_echo")).custom).toBeNull();
    // Another style throws the edit away.
    expect(eb(setStyle(song, "fx_echo", "TelRay")).custom).toBeNull();
  });

  it("has EchoBoy's 31 styles, each one valid", () => {
    expect(ECHO_STYLES).toHaveLength(31);
    expect(new Set(ECHO_STYLES.map((s) => s.name)).size).toBe(31);
    for (const s of ECHO_STYLES) expect(normalizeEchoBoy({ custom: s.settings, style: s.name }).custom).toEqual(s.settings);
  });
});

describe("EchoBoy's times", () => {
  it("turns note values into ms at the tempo", () => {
    expect(noteBeats(8)).toBe(0.5);
    expect(echoMs({ sync: "note", ms: 0, note: 8 }, 120)).toBe(250);
    expect(echoMs({ sync: "dot", ms: 0, note: 8 }, 120)).toBe(375);
    expect(round(echoMs({ sync: "trip", ms: 0, note: 8 }, 120))).toBe(166.667);
    expect(echoMs({ sync: "time", ms: 126.2, note: 8 }, 90)).toBe(126.2);
    // Never past 15 s.
    expect(echoMs({ sync: "note", ms: 0, note: 2 }, 1)).toBe(15_000);
  });

  it("says times as EchoBoy's LCD does", () => {
    expect(timeText({ sync: "time", ms: 126.2, note: 8 })).toBe("126.2 ms");
    expect(timeText({ sync: "time", ms: 4.5, note: 8 })).toBe("4.50 ms");
    expect(timeText({ sync: "note", ms: 0, note: 8 })).toBe("1/8");
    expect(timeText({ sync: "trip", ms: 0, note: 16 })).toBe("1/16 tri");
    expect(timeText({ sync: "dot", ms: 0, note: 4 })).toBe("1/4 dot");
  });

  it("tapers the time knob: 1 ms near the bottom, 120 ms at the middle, 15 s at the top", () => {
    expect(knobToMs(0)).toBe(0);
    expect(knobToMs(1)).toBe(15_000);
    expect(Math.round(knobToMs(0.5))).toBe(122);
    for (const ms of [0, 1, 126.2, 500, 15_000]) expect(knobToMs(msToKnob(ms))).toBeCloseTo(ms, 0);
  });

  it("reads typed times", () => {
    expect(parseEchoTime("126.2")).toEqual({ sync: "time", ms: 126.2 });
    expect(parseEchoTime("1.5 s")).toEqual({ sync: "time", ms: 1500 });
    expect(parseEchoTime("1/8")).toEqual({ sync: "note", note: 8 });
    expect(parseEchoTime("1/8 dot")).toEqual({ sync: "dot", note: 8 });
    expect(parseEchoTime("1/16t")).toEqual({ sync: "trip", note: 16 });
    expect(parseEchoTime("1/3")).toBeNull();
    expect(parseEchoTime("loud")).toBeNull();
    expect(parseEchoTime("20000")).toBeNull();
  });

  it("taps a tempo from the last few taps, starting again after a pause", () => {
    expect(tappedTempo([1000])).toBeNull();
    expect(tappedTempo([1000, 1500, 2000, 2500])).toBe(120);
    expect(tappedTempo([0, 500, 5000, 5800])).toBe(75);
  });

  it("rounds times to free primes for Prime Numbers", () => {
    expect(primeTimes([250, 250, 375, 1.5])).toEqual([251, 257, 373, 1.5]);
  });
});

describe("EchoBoy in the engine", () => {
  it("mixes dry and wet as EchoBoy does: both full at 12 o'clock", () => {
    expect(mixGains(0)).toEqual([1, 0]);
    expect(mixGains(0.5)).toEqual([1, 1]);
    expect(mixGains(0.75)).toEqual([0.5, 1]);
  });

  it("plays Single Echo as a pair of lines a side, each feeding the other", () => {
    const e = engine({ mode: "single", echo1: { sync: "note", ms: 0, note: 8 }, width: 0, feedback: 0.5 });
    expect(e.lines.map((l) => l.delay)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(e.lines.map((l) => l.input)).toEqual([[1, 0], [0, 0], [0, 1], [0, 0]]);
    expect(e.feedback).toEqual([0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0]);
    expect(e.amount).toBeCloseTo(0.575);
    expect(e.side).toBe(0);
    expect(e.lines.every((l) => !l.glide)).toBe(true);
  });

  it("swings every other repeat with Groove, and offsets the right side with Width", () => {
    const shuffled = engine({ echo1: { sync: "note", ms: 0, note: 8 }, groove: -1, width: 0.75, offset: 9 });
    // Towards Shuffle the odd repeats come later: a triplet's feel at the end of the knob.
    expect(shuffled.lines.map((l) => round(l.delay, 4))).toEqual([0.3333, 0.1667, 0.3423, 0.1667]);
    expect(shuffled.side).toBe(1);
    expect(engine({ width: 1 }).side).toBe(2);
  });

  it("plays Dual Echo with Echo 1 left, Echo 2 right, FB Mix crossing them", () => {
    const e = engine({ mode: "dual", echo1: { sync: "time", ms: 100, note: 8 }, echo2: { sync: "time", ms: 300, note: 8 }, width: 0, feedbackMix: 1, accent2: 0.5 });
    expect(e.lines.map((l) => l.delay)).toEqual([0.1, 0.1, 0.3, 0.3]);
    expect(e.lines.every((l) => l.glide)).toBe(true);
    // Cross: each takes its feedback from the other side.
    expect(e.feedback.slice(0, 4)).toEqual([0, 0, 0, 1]);
    expect(e.lines.map((l) => l.out)).toEqual([[1, 0], [1, 0], [0, 1], [0, 0.5]]);
  });

  it("plays Ping-Pong as Ping into Pong, two repeats with no feedback", () => {
    const e = engine({ mode: "pingPong", echo1: { sync: "time", ms: 500, note: 8 }, echo2: { sync: "time", ms: 250, note: 8 } });
    expect(e.lines.map((l) => l.delay)).toEqual([0.5, 0.25]);
    expect(e.fixed).toEqual([0, 0, 1, 0]);
    expect(e.feedback).toEqual([0, 1, 0, 0]);
    expect(e.lines[0].input).toEqual([0.5, 0.5]);
  });

  it("plays Rhythm Echo as one line the pattern's length, read by its taps", () => {
    const rhythm = { ...DEFAULT_ECHO_BOY.rhythm, shapeAmount: 0, panShape: "center" as const };
    const e = engine({ mode: "rhythm", rhythm });
    expect(e.lines.map((l) => l.delay)).toEqual([1]);
    expect(e.taps.map((t) => [t.delay, t.left, t.one])).toEqual([[0, 1, true], [0.25, 1, false], [0.5, 1, false], [0.75, 1, false]]);
  });

  it("folds the front Saturation knob into the style's drives, and maps Decay to dB a repeat", () => {
    const studio = styleNamed("Studio Tape");
    expect(engine({ saturation: 1 }).saturation.decay).toBe(studio.saturation.decay + 18);
    expect(engine({ saturation: 0.5 }).saturation.out).toBe(studio.saturation.out);
    expect(decayDb(-40)).toBe(-6);
    expect(decayDb(0)).toBe(0);
    expect(round(decayDb(-16), 2)).toBe(-0.96);
    expect(decayDb(18)).toBe(6);
    // Low Cut at its least and High Cut at its most are off.
    expect([engine({}).lowCut, engine({}).highCut]).toEqual([0, 0]);
    expect(engine({ lowCut: 300, highCut: 4000 })).toMatchObject({ lowCut: 300, highCut: 4000 });
  });

  it("follows the song's tempo, or its own", () => {
    expect(engine({}, 60).lines[0].delay).toBe(0.5);
    expect(engine({ followTempo: false, bpm: 120 }, 60).lines[0].delay).toBe(0.25);
  });
});

describe("Rhythm Echo", () => {
  it("lays taps out from the Rhythm knob and Repeats, growing the pattern to hold them", () => {
    const laid = layOutRhythm(DEFAULT_ECHO_BOY.rhythm, 120, { time: { sync: "note", ms: 0, note: 16 }, repeats: 11 });
    expect(laid.taps).toHaveLength(12);
    expect(laid.length).toBe(3);
    expect(laid.pattern).toBe("1/16 Notes");
    expect(evenTaps(0.25, 4, 2).map((t) => t.beat)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("edits taps: none on another's beat, Custom from then on", () => {
    const taps = evenTaps(0.5, 3, 2);
    expect(addTap(taps, 0.5)).toEqual(taps);
    expect(addTap(taps, 0.25).map((t) => t.beat)).toEqual([0, 0.25, 0.5, 1, 1.5]);
    expect(moveTap(taps, 1, 1, 0.5)[1]).toEqual({ beat: 0.5, level: 0.5 });
    expect(editTaps(DEFAULT_ECHO_BOY.rhythm, addTap(taps, 1.75)).pattern).toBe("Custom");
  });

  it("shapes and pans the taps it plays, leaving the One alone", () => {
    const rhythm = usePattern(DEFAULT_ECHO_BOY.rhythm, RHYTHM_PATTERNS.find((p) => p.name === "1/8 Notes")!);
    const heard = heardTaps({ ...DEFAULT_ECHO_BOY, rhythm: { ...rhythm, shape: "decay", shapeAmount: 1, panShape: "alt3" } }, 120);
    expect(heard[0]).toEqual({ beat: 0, level: 1, pan: 0, one: true });
    expect(heard.slice(1).map((t) => round(t.level, 3))).toEqual([0.775, 0.55, 0.325]);
    expect(heard.slice(1).map((t) => t.pan)).toEqual([-1, 1, -1]);
  });
});

describe("EchoBoy's automation", () => {
  it("validates its targets and names its controls", () => {
    expect(normalizeTarget({ kind: "echoBoy", effect: "fx_echo", control: "feedback" })).toEqual({ kind: "echoBoy", effect: "fx_echo", control: "feedback" });
    expect(normalizeTarget({ kind: "echoBoy", effect: "fx_echo", control: "volume" })).toBeNull();
    const song = updateEchoBoy(withEchoBoy(), "fx_echo", { highCut: 4000 });
    const cut = controlOf(song, { kind: "echoBoy", effect: "fx_echo", control: "highCut" });
    expect(cut).toMatchObject({ name: "High Cut", owner: "YT-Delay (Insert 1)", exists: true });
    expect(cut.format(cut.own!)).toBe("4.00 kHz");
    expect(cut.toControl(1)).toBeCloseTo(20_000);
    expect(cut.toControl(cut.own!)).toBeCloseTo(4000);
    const echo = controlOf(song, { kind: "echoBoy", effect: "fx_echo", control: "echo1" });
    expect(echo.format(echo.own!)).toBe("1/8");
    expect(ECHO_CONTROL_SPECS.echo1.set(eb(song), 1).echo1.note).toBe(64);
  });

  it("sends its automated controls as lanes in the engine's units", () => {
    let song = updateEchoBoy(withEchoBoy(), "fx_echo", { echo1: { sync: "time", ms: 100 }, width: 0 });
    song = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: BAR * 2 }]).clips);
    const made = createAutomation(song, { kind: "echoBoy", effect: "fx_echo", control: "echo1" }, { start: 0, length: BAR }, { id: "auto_echo" });
    song = editPoints(made.song, "auto_echo", () => [
      { tick: 0, value: msToKnob(100), tension: 0, curve: "single" },
      { tick: BAR, value: msToKnob(400), tension: 0, curve: "single" },
    ]);
    const compiled = compileSong(song, P, null, "song");
    const track = compiled.tracks.findIndex((t) => t.id === "insert_1");
    expect(compiled.tracks[track].effects[0].echoBoy!.lines[0].delay).toBe(0.1);
    const lane = compiled.lanes.find((l) => l.target.kind === "echo")!;
    expect(lane.target).toEqual({ kind: "echo", track, effect: 0, control: "delays" });
    // Four lines' delays at each point, from 100 ms to 400 ms.
    expect(lane.values.slice(0, 4)).toEqual([0.1, 0.1, 0.1, 0.1]);
    expect(lane.values.slice(-4).map((v) => round(v, 2))).toEqual([0.4, 0.4, 0.4, 0.4]);
    // Nothing automated, no lanes.
    expect(compileSong(withEchoBoy(), P, null, "song").lanes).toEqual([]);
  });
});

describe("EchoBoy's automation, every knob", () => {
  /** `song` in song mode, `control` automated from `from` to `to` (its fractions) over a bar. */
  function lanesOf(song: MusicProject, control: (typeof ECHO_CONTROLS)[number], from = 0, to = 1) {
    let s = editClips(song, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: BAR * 2 }]).clips);
    const made = createAutomation(s, { kind: "echoBoy", effect: "fx_echo", control }, { start: 0, length: BAR }, { id: "auto_x" });
    s = editPoints(made.song, "auto_x", () => [
      { tick: 0, value: from, tension: 0, curve: "single" },
      { tick: BAR, value: to, tension: 0, curve: "single" },
    ]);
    return compileSong(s, P, null, "song").lanes.filter((l) => l.target.kind === "echo");
  }
  const controlsOf = (lanes: ReturnType<typeof lanesOf>) => lanes.map((l) => (l.target.kind === "echo" ? l.target.control : "")).sort();

  it("has a spec for every control, whose taper goes there and back", () => {
    const song = withEchoBoy();
    for (const control of ECHO_CONTROLS) {
      const info = controlOf(song, { kind: "echoBoy", effect: "fx_echo", control });
      expect(info.exists, control).toBe(true);
      expect(info.own, control).not.toBeNull();
      for (const f of [0, 0.3, 1]) expect(ECHO_CONTROL_SPECS[control].fromControl(ECHO_CONTROL_SPECS[control].toControl(f)), control).toBeCloseTo(f, 6);
    }
  });

  it("moves the lines' outputs with Balance, the matrix with FB Mix, the EQ with the Style Editor's", () => {
    const dual = updateEchoBoy(withEchoBoy(), "fx_echo", { mode: "dual" });
    const balance = lanesOf(dual, "balance");
    expect(controlsOf(balance)).toEqual(["outs"]);
    // Hard left at the start: the right's lines silent; hard right at the end: the left's.
    expect(balance[0].values.slice(0, 8)).toEqual([1, 0, 1, 0, 0, 0, 0, 0]);
    expect(balance[0].values.slice(-8)).toEqual([0, 0, 0, 0, 0, 1, 0, 1]);
    const mix = lanesOf(dual, "feedbackMix");
    expect(controlsOf(mix)).toEqual(["matrix"]);
    expect(mix[0].values.length % 16).toBe(0);
    const low = lanesOf(withEchoBoy(), "lowFreq");
    expect(controlsOf(low)).toEqual(["eq"]);
    expect(low[0].values[0]).toBeCloseTo(20, 6);
    expect(low[0].values[low[0].values.length - 10]).toBeCloseTo(2000, 6);
  });

  it("lays Rhythm Echo's taps out again as its Rhythm knob is automated, every tap the engine has", () => {
    const rhythm = updateEchoBoy(withEchoBoy(), "fx_echo", { mode: "rhythm" });
    const lanes = lanesOf(rhythm, "rhythmTime", 0.2, 0.6);
    expect(controlsOf(lanes)).toEqual(["delays", "taps"]);
    const taps = lanes.find((l) => l.target.kind === "echo" && l.target.control === "taps")!;
    expect(taps.values.length % (16 * 4)).toBe(0);
    // Single mode has no taps: no lane of them.
    expect(controlsOf(lanesOf(withEchoBoy(), "groove"))).toEqual(["delays"]);
  });
});

describe("EchoBoy's presets", () => {
  it("each loads valid, named, its pattern laid out", () => {
    expect(new Set(ECHO_PRESETS.map((p) => p.name)).size).toBe(ECHO_PRESETS.length);
    for (const preset of ECHO_PRESETS) {
      const settings = presetSettings(preset, 120);
      expect(normalizeEchoBoy(settings)).toEqual(settings);
      expect(settings.preset).toBe(preset.name);
    }
    const pedal = presetSettings(ECHO_PRESETS.find((p) => p.name === "Complex Pedal Pattern")!, 120);
    expect(pedal.rhythm.pattern).toBe("Complex Pedal Pattern");
    expect(pedal.rhythm.taps).toHaveLength(12);
    expect(presetSettings(ECHO_PRESETS.find((p) => p.name === "Gated Reflections")!, 120).rhythm.taps.map((t) => t.beat)).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75]);
  });

  it("loads by name, replacing everything", () => {
    const song = loadPreset(updateEchoBoy(withEchoBoy(), "fx_echo", { lowCut: 900 }), "fx_echo", "15 ips tape echo");
    expect(eb(song)).toMatchObject({ preset: "15 ips Tape Echo", lowCut: 20, echo1: { sync: "time", ms: 126.2 }, style: "Studio Tape" });
    expect(loadPreset(song, "fx_echo", "No such preset")).toBe(song);
  });
});
