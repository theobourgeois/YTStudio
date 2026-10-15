import { describe, expect, it } from "vitest";
import { OPACITY, MOTION, setLink, solidEffects } from "./effects.ts";
import {
  DEFAULT_RESPONSE,
  applyLink,
  defineSignal,
  deleteSignal,
  follow,
  hitLevel,
  normalizeLink,
  depthOf,
  normalizeSignalDefs,
  setSignalEvents,
  shapeValue,
} from "./links.ts";
import { normalizeProject } from "./normalize.ts";
import { MAIN_TRACK_ID, createDefaultProject } from "./timeline.ts";
import type { Clip, ParamLink, Project, SignalDef } from "./types.ts";

const solid: Clip = { id: "solid", assetId: "", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 6, effects: solidEffects() };
const base: Project = { ...createDefaultProject(), clips: [solid] };
const bass: ParamLink = { signal: { name: "bass" }, mode: "add", amount: 0.5, response: DEFAULT_RESPONSE };
const kick: SignalDef = { id: "sig_kick", name: "Kick", color: "#f97316", kind: "events", events: [{ time: 1, velocity: 1 }] };

describe("links' validation", () => {
  it("keeps a valid link and fills in its response", () => {
    expect(normalizeLink({ signal: { name: "bass" }, amount: 2 }, false)).toEqual({ signal: { name: "bass" }, mode: "add", amount: 2, response: DEFAULT_RESPONSE });
  });

  it("refuses unknown signals, missing amounts and points where numbers go", () => {
    expect(normalizeLink({ signal: { name: "kick" }, amount: 1 }, false)).toBeUndefined();
    expect(normalizeLink({ signal: { name: "bass" } }, false)).toBeUndefined();
    expect(normalizeLink({ signal: { name: "bass" }, amount: [1, 2] }, false)).toBeUndefined();
    expect(normalizeLink({ signal: { name: "bass" }, amount: [1, 2] }, true)?.amount).toEqual([1, 2]);
  });

  it("makes a map without a target an add, and clamps the response", () => {
    const link = normalizeLink({ signal: { id: "x" }, mode: "map", amount: 1, response: { threshold: 3, attack: -1, curve: 0 } }, false)!;
    expect(link.mode).toBe("add");
    expect(link.response).toMatchObject({ threshold: 0.99, attack: 0, curve: 0.1 });
  });

  it("keeps the mix as no source at all", () => {
    expect(normalizeLink({ signal: { name: "bass", source: { kind: "master" } }, amount: 1 }, false)?.signal).toEqual({ name: "bass" });
  });

  it("keeps signals with unique ids and names, auto-gain on by default", () => {
    const defs = normalizeSignalDefs([
      { id: "a", name: "Kick", kind: "band", low: 120, high: 40 },
      { id: "a", name: "Again", kind: "events" },
      { id: "b", name: "kick", kind: "events", events: [{ time: 2 }, { time: 1, velocity: 3 }, { time: -1 }] },
      { id: "c", kind: "nothing" },
    ]);
    expect(defs.map((d) => d.name)).toEqual(["Kick", "kick 2"]);
    expect(defs[0]).toMatchObject({ kind: "band", low: 40, high: 120, autoGain: true, onsets: false, source: { kind: "master" } });
    expect(defs[1]).toMatchObject({ events: [{ time: 1, velocity: 1 }, { time: 2, velocity: 1 }] });
  });

  it("survives a load and save, on clips of nested sequences too", () => {
    const p = defineSignal(setLink(base, "solid", OPACITY.type, "opacity", bass), kick);
    const loaded = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(loaded.signals).toEqual([kick]);
    expect(loaded.clips[0].effects.find((e) => e.type === OPACITY.type)?.links).toEqual({ opacity: bass });
  });
});

describe("links' depth", () => {
  it("keeps a depth that names a signal, its floor and threshold in range", () => {
    const link = normalizeLink({ signal: { name: "onsetLow" }, amount: 0.2, depth: { signal: { name: "intensity" }, floor: 2, threshold: -1 } }, false);
    expect(link?.depth).toEqual({ signal: { name: "intensity" }, floor: 1, threshold: 0 });
    expect(normalizeLink({ signal: { name: "bass" }, amount: 1, depth: { signal: { name: "nope" } } }, false)?.depth).toBeUndefined();
  });

  it("moves its floor at nothing, all the way at full, nothing under its threshold", () => {
    const depth = { signal: { name: "intensity" }, floor: 0.25, threshold: 0.5 };
    expect(depthOf(depth, 0)).toBe(0.25);
    expect(depthOf(depth, 1)).toBe(1);
    expect(depthOf(depth, 0.4)).toBe(0.25);
    expect(depthOf(depth, 0.75)).toBeCloseTo(0.625);
  });
});

describe("links' maths", () => {
  it("adds, multiplies and maps, a point's parts each", () => {
    expect(applyLink(10, { ...bass, amount: 4 }, 0.5)).toBe(12);
    expect(applyLink(10, { ...bass, mode: "multiply", amount: 1 }, 0.5)).toBe(15);
    expect(applyLink(10, { ...bass, mode: "map", amount: 0, to: 20 }, 0.25)).toBe(12.5);
    expect(applyLink([0.5, 0.5], { ...bass, amount: [0.1, -0.2] }, 1)).toEqual([0.6, 0.3]);
    expect(applyLink([1, 2], { ...bass, mode: "multiply", amount: 1 }, 1)).toEqual([2, 4]);
  });

  it("shapes: nothing under the threshold, the rest stretched and curved", () => {
    expect(shapeValue(0.4, 0.5, 1)).toBe(0);
    expect(shapeValue(0.75, 0.5, 1)).toBe(0.5);
    expect(shapeValue(0.75, 0.5, 2)).toBe(0.25);
  });

  it("follows up in its attack and down in its release", () => {
    expect(follow(0, 1, 0, 1, 0.005)).toBe(1);
    const up = follow(0, 1, 0.1, 1, 0.1);
    expect(up).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(follow(1, 0, 0.1, 0.2, 0.2)).toBeCloseTo(Math.exp(-1), 6);
  });

  it("shapes a hit: attack, hold, decay", () => {
    const shape = { attack: 0.1, hold: 0.1, decay: 0.2 };
    expect(hitLevel(-0.01, shape)).toBe(0);
    expect(hitLevel(0.05, shape)).toBeCloseTo(0.5, 6);
    expect(hitLevel(0.15, shape)).toBe(1);
    expect(hitLevel(0.3, shape)).toBeCloseTo(0.5, 6);
    expect(hitLevel(0.5, shape)).toBe(0);
  });
});

describe("links' edits", () => {
  it("links and unlinks, the same project when nothing changes", () => {
    const linked = setLink(base, "solid", OPACITY.type, "opacity", bass);
    expect(setLink(linked, "solid", OPACITY.type, "opacity", { ...bass })).toBe(linked);
    expect(setLink(linked, "solid", OPACITY.type, "opacity", null).clips[0].effects.find((e) => e.type === OPACITY.type)?.links).toBeUndefined();
    // Not on a choice.
    expect(setLink(base, "solid", OPACITY.type, "blendMode", bass)).toBe(base);
    // A point takes a point's amount.
    const moved = setLink(base, "solid", MOTION.type, "position", { ...bass, amount: [0.1, 0] });
    expect(moved.clips[0].effects.find((e) => e.type === MOTION.type)?.links?.position.amount).toEqual([0.1, 0]);
  });

  it("defines, renames apart, replaces and deletes signals, and deleting one unlinks it", () => {
    const one = defineSignal(base, kick);
    expect(defineSignal(one, kick)).toBe(one);
    const two = defineSignal(one, { ...kick, id: "sig_2" });
    expect(two.signals?.map((d) => d.name)).toEqual(["Kick", "Kick 2"]);
    const linked = setLink(two, "solid", OPACITY.type, "opacity", { ...bass, signal: { id: "sig_kick" } });
    const gone = deleteSignal(linked, "sig_kick");
    expect(gone.signals?.map((d) => d.id)).toEqual(["sig_2"]);
    expect(gone.clips[0].effects.find((e) => e.type === OPACITY.type)?.links).toBeUndefined();
    expect(deleteSignal(deleteSignal(gone, "sig_2"), "sig_2").signals).toBeUndefined();
  });

  it("sets an events signal's hits, sorted", () => {
    const p = setSignalEvents(defineSignal(base, kick), "sig_kick", [{ time: 3, velocity: 0.5 }, { time: 2, velocity: 1 }]);
    const def = p.signals?.[0];
    expect(def?.kind === "events" && def.events.map((e) => e.time)).toEqual([2, 3]);
  });
});
