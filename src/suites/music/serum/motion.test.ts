import { describe, expect, it } from "vitest";
import type { SerumControl, SerumLfo } from "@shared/music/serum-sound";
import { divisionBeats, envelopePosition, lfoPeriod, lfoPosition, notesNow, sounding } from "./motion";

const c = (value: number): SerumControl => ({ param: "", value });
const lfo = (extra: Partial<SerumLfo> = {}, rate = 0.5): Pick<SerumLfo, "mode" | "sync" | "dotted" | "triplets" | "rate10x" | "controls"> => ({
  mode: "retrigger",
  sync: true,
  dotted: false,
  triplets: false,
  rate10x: false,
  controls: { rate: c(rate), smooth: c(0), rise: c(0), delay: c(0), phase: c(0) },
  ...extra,
});
const held = (sinceOn: number) => ({ held: 1, sinceOn, sinceOff: -1 });
const at = { tempo: 120, release: 0.1, songBeats: null, clock: 0 };

describe("an LFO's motion", () => {
  it("reads divisions as beats (a bar is 4), dotted and triplet too", () => {
    expect(divisionBeats("1/4")).toBe(1);
    expect(divisionBeats("bar")).toBe(4);
    expect(divisionBeats("4 bar")).toBe(16);
    expect(divisionBeats("1.5 bar")).toBe(6);
    expect(divisionBeats("1/8.")).toBe(0.75);
    expect(divisionBeats("1/4 t")).toBeCloseTo(2 / 3);
    expect(divisionBeats("fast")).toBeNull();
  });

  it("lasts a division at the song's tempo when synced, 1/Hz when free", () => {
    expect(lfoPeriod(lfo(), 120)).toBe(0.5);
    expect(lfoPeriod(lfo({ sync: false }), 120)).toBeCloseTo(1 / 6.25);
    expect(lfoPeriod(lfo({ sync: false }, 0), 120)).toBeNull();
  });

  it("starts again with each note (retrigger), from its phase", () => {
    expect(lfoPosition(lfo(), held(0.125), at)).toBeCloseTo(0.25);
    expect(lfoPosition(lfo(), held(0.625), at)).toBeCloseTo(0.25);
    const phased = lfo();
    phased.controls.phase = c(0.5);
    expect(lfoPosition(phased, held(0.125), at)).toBeCloseTo(0.75);
  });

  it("runs once as an envelope and stays at its end, or freely with the song's beats", () => {
    expect(lfoPosition(lfo({ mode: "envelope" }), held(0.25), at)).toBeCloseTo(0.5);
    expect(lfoPosition(lfo({ mode: "envelope" }), held(3), at)).toBe(1);
    expect(lfoPosition(lfo({ mode: "free" }), held(0.1), { ...at, songBeats: 2.25 })).toBeCloseTo(0.25);
    expect(lfoPosition(lfo({ mode: "free" }), held(0.1), { ...at, clock: 1.125 })).toBeCloseTo(0.25);
  });

  it("isn't anywhere while no voice plays: before any note, or once the release is over", () => {
    expect(lfoPosition(lfo(), { held: 0, sinceOn: -1, sinceOff: -1 }, at)).toBeNull();
    expect(sounding({ held: 0, sinceOn: 2, sinceOff: 0.05 }, 0.1)).toBe(true);
    expect(sounding({ held: 0, sinceOn: 2, sinceOff: 0.5 }, 0.1)).toBe(false);
  });

  it("keeps the engine's clocks running between its reports", () => {
    expect(notesNow({ held: 1, sinceOn: 1, sinceOff: -1 }, 0.25)).toEqual({ held: 1, sinceOn: 1.25, sinceOff: -1 });
  });
});

describe("an envelope's motion", () => {
  // Attack 1 s (0.5), no hold, decay 1 s, release 1 s.
  const env = { controls: { attack: c(0.5), hold: c(0), decay: c(0.5), sustain: c(0.5), release: c(0.5), attackCurve: c(0.5), decayCurve: c(0.5), releaseCurve: c(0.5) } };

  it("follows a held note through attack and decay, then waits at the sustain", () => {
    expect(envelopePosition(env, held(0.5))).toBeCloseTo(0.5);
    expect(envelopePosition(env, held(1.5))).toBeCloseTo(1.5);
    expect(envelopePosition(env, held(10))).toBeCloseTo(2);
  });

  it("goes through the release once the note is let go", () => {
    expect(envelopePosition(env, { held: 0, sinceOn: 3, sinceOff: 0.25 })).toBeCloseTo(2.25);
    expect(envelopePosition(env, { held: 0, sinceOn: 5, sinceOff: 2 })).toBeNull();
  });
});
