import { describe, expect, it } from "vitest";
import { controlOf, createAutomation, editPoints, updateAutomation } from "./automation.ts";
import { setSteps } from "./edits.ts";
import { addClips, editClips } from "./playlist.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "./project.ts";
import { TEMPO_TARGET, engineTick, songClock, songSeconds, songTick, tempoAt, tempoMap } from "./tempo.ts";
import type { AutomationPoint, MusicProject } from "./types.ts";

const BAR = 384;
const P = FIRST_PATTERN_ID;

/** A song at 120 BPM, four bars long, with a tempo clip over bars `start`..`start + length` drawn along `points` (in BPM). */
function song(points: { tick: number; bpm: number; curve?: AutomationPoint["curve"] }[], start = BAR, length = BAR): MusicProject {
  let s = setSteps(createMusicProject("Tempo", 120), P, "chan_none", [], true);
  s = editClips(s, (clips) => addClips(clips, [{ kind: "pattern", ref: P, track: 0, start: 0, length: BAR * 4 }]).clips);
  const made = createAutomation(s, TEMPO_TARGET, { start, length });
  const info = controlOf(made.song, TEMPO_TARGET);
  // Its range the whole of the tempo's, so the points are BPM as they are.
  return editPoints(updateAutomation(made.song, made.automationId, { min: 0, max: 1 }), made.automationId, () =>
    points.map((p) => ({ tick: p.tick, value: info.fromControl(p.bpm), tension: 0, curve: p.curve ?? "single" })),
  );
}

describe("tempo automation", () => {
  it("is no map without a tempo clip: the song's ticks are the engine's", () => {
    const s = createMusicProject("Plain", 120);
    expect(tempoMap(s)).toBeNull();
    expect(engineTick(null, 500)).toBe(500);
    expect(songTick(null, 500)).toBe(500);
    expect(tempoAt(s, 1000)).toBe(120);
    expect(songSeconds(s, BAR)).toBeCloseTo(2);
  });

  it("makes a new tempo clip flat at the song's tempo, its Min / Max FL's 60 to 180", () => {
    const made = createAutomation(createMusicProject("Tempo", 140), TEMPO_TARGET, { start: 0, length: BAR });
    const automation = made.song.automations[0];
    const info = controlOf(made.song, TEMPO_TARGET);
    expect(info.toControl(automation.min)).toBeCloseTo(60);
    expect(info.toControl(automation.max)).toBeCloseTo(180);
    expect(info.toControl(automation.min + automation.points[0].value * (automation.max - automation.min))).toBeCloseTo(140);
    // A song faster than its range widens it.
    const fast = createAutomation(createMusicProject("Fast", 200), TEMPO_TARGET, { start: 0, length: BAR }).song.automations[0];
    expect(info.toControl(fast.max)).toBeCloseTo(210);
  });

  it("holds the song's own tempo before the clip, follows it, and holds its last tempo after", () => {
    // Twice as fast, held from bar 2.
    const s = song([{ tick: 0, bpm: 240 }, { tick: BAR, bpm: 240 }]);
    const map = tempoMap(s)!;
    expect(tempoAt(s, BAR / 2)).toBeCloseTo(120);
    expect(tempoAt(s, BAR * 1.5)).toBeCloseTo(240);
    expect(tempoAt(s, BAR * 3)).toBeCloseTo(240);
    // The engine plays at 120: a bar at 240 takes half the engine's ticks.
    expect(engineTick(map, BAR)).toBeCloseTo(BAR);
    expect(engineTick(map, BAR * 2)).toBeCloseTo(BAR * 1.5);
    expect(engineTick(map, BAR * 3)).toBeCloseTo(BAR * 2);
    expect(songSeconds(s, BAR * 3)).toBeCloseTo(2 + 1 + 1);
    for (const tick of [0, 100, BAR, BAR * 1.25, BAR * 2.5, BAR * 10]) expect(songTick(map, engineTick(map, tick))).toBeCloseTo(tick, 6);
  });

  it("integrates a ramp exactly: the time a tick takes is the sum of every moment's tempo", () => {
    // From 120 up to 180 across bar 2.
    const s = song([{ tick: 0, bpm: 120 }, { tick: BAR, bpm: 180 }]);
    const map = tempoMap(s)!;
    // Summed in small steps at the tempo in each.
    let seconds = 0;
    const steps = 38_400;
    const step = BAR / steps;
    for (let k = 0; k < steps; k++) seconds += (step / 96) * (60 / tempoAt(s, BAR + (k + 0.5) * step));
    expect(songSeconds(s, BAR * 2) - songSeconds(s, BAR)).toBeCloseTo(seconds, 5);
    for (const tick of [BAR * 1.1, BAR * 1.5, BAR * 1.99]) expect(songTick(map, engineTick(map, tick))).toBeCloseTo(tick, 6);
    // Monotonic: later in the song is later in time.
    let last = -1;
    for (let t = 0; t < BAR * 4; t += 7) {
      const e = engineTick(map, t);
      expect(e).toBeGreaterThan(last);
      last = e;
    }
  });

  it("jumps where a held curve does", () => {
    const s = song([{ tick: 0, bpm: 120 }, { tick: BAR / 2, bpm: 90, curve: "hold" }, { tick: BAR, bpm: 90 }]);
    expect(tempoAt(s, BAR + BAR / 2 - 1)).toBeCloseTo(120);
    expect(tempoAt(s, BAR + BAR / 2 + 1)).toBeCloseTo(90);
    const map = tempoMap(s)!;
    expect(engineTick(map, BAR * 2) - engineTick(map, BAR * 1.5)).toBeCloseTo(((BAR / 2) * 120) / 90, 3);
  });

  it("gives the engine's ticks into a loop and back, from where the loop starts", () => {
    const s = song([{ tick: 0, bpm: 240 }, { tick: BAR, bpm: 240 }]);
    const clock = songClock(tempoMap(s), BAR);
    expect(clock.warped).toBe(true);
    expect(clock.toEngine(0)).toBeCloseTo(0);
    expect(clock.toEngine(BAR)).toBeCloseTo(BAR / 2);
    expect(clock.toSong(BAR / 2)).toBeCloseTo(BAR);
    const plain = songClock(null, 96);
    expect(plain).toMatchObject({ from: 96, warped: false });
    expect(plain.toEngine(10)).toBe(10);
  });

  it("is made again only when the song's automation, clips or tempo change", () => {
    const s = song([{ tick: 0, bpm: 150 }]);
    expect(tempoMap(s)).toBe(tempoMap({ ...s, name: "Renamed" }));
    expect(tempoMap({ ...s, settings: { ...s.settings, tempo: 100 } })).not.toBe(tempoMap(s));
    expect(tempoMap(editPoints(s, s.automations[0].id, (points) => points.map((p) => ({ ...p, value: p.value / 2 }))))).not.toBe(tempoMap(s));
  });
});
