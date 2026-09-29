import { describe, expect, it } from "vitest";
import { defaultEffects } from "./effects.ts";
import { MAIN_TRACK_ID, createDefaultProject, getClip, normalizeProject, splitClip } from "./timeline.ts";
import { RESERVED_UNIFORMS, fragmentSource, transitionUniforms } from "./transition-gl.ts";
import {
  addTransition,
  canonicalRef,
  durationForEdge,
  findWindow,
  nearestEdge,
  removeTransition,
  setTransitionParams,
  trackTransitions,
  transitionAt,
  transitionTargetAt,
  windowProgress,
} from "./transition-windows.ts";
import {
  MAX_TRANSITION_DURATION,
  TRANSITIONS,
  TRANSITION_TAGS,
  createTransition,
  patchTransition,
  replaceTransitionType,
  sanitizeTransition,
} from "./transitions.ts";
import type { Clip, Project, Transition } from "./types.ts";

const clip = (id: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip => ({
  id, assetId: "a", trackId: MAIN_TRACK_ID, start, in: 0, out: duration, effects: defaultEffects(), ...extra,
});
const project = (...clips: Clip[]): Project => ({ ...createDefaultProject(), clips });
const dissolve = (duration = 1, alignment: Transition["alignment"] = "center"): Transition => ({
  ...createTransition("cross-dissolve", duration),
  alignment,
});
const windows = (p: Project) =>
  trackTransitions(p, MAIN_TRACK_ID).map((w) => ({
    ref: `${w.ref.clipId}.${w.ref.edge}`,
    from: w.from?.id ?? null,
    to: w.to?.id ?? null,
    start: +w.start.toFixed(6),
    end: +w.end.toFixed(6),
  }));

describe("transition library", () => {
  it("has unique types, known tags, sane defaults and parameter names the shader can use", () => {
    expect(new Set(TRANSITIONS.map((d) => d.type)).size).toBe(TRANSITIONS.length);
    for (const def of TRANSITIONS) {
      expect(def.tags.length, def.type).toBeGreaterThan(0);
      for (const tag of def.tags) expect(TRANSITION_TAGS).toContain(tag);
      expect(def.duration).toBeGreaterThan(0);
      expect(def.duration).toBeLessThanOrEqual(MAX_TRANSITION_DURATION);
      expect(def.glsl).toMatch(/vec4\s+transition\s*\(\s*vec2\s+\w+\s*\)/);
      for (const p of def.params) {
        expect(p.key, def.type).toMatch(/^[a-z][A-Za-z0-9]*$/);
        expect(RESERVED_UNIFORMS).not.toContain(p.key);
        if (p.kind === "number") expect(p.default).toBeGreaterThanOrEqual(p.min);
        if (p.kind === "number") expect(p.default).toBeLessThanOrEqual(p.max);
      }
      expect(transitionUniforms(def, {})).toHaveLength(def.params.length);
      expect(fragmentSource(def)).toContain(def.glsl);
    }
  });

  it("maps parameters to uniforms", () => {
    const wipe = TRANSITIONS.find((d) => d.params.some((p) => p.kind === "choice"))!;
    const choice = wipe.params.find((p) => p.kind === "choice")!;
    if (choice.kind !== "choice") throw new Error();
    const last = choice.options.at(-1)!.value;
    const u = transitionUniforms(wipe, { [choice.key]: last }).find((x) => x.name === choice.key);
    expect(u).toEqual({ name: choice.key, type: "int", value: choice.options.length - 1 });
  });

  it("sanitizes stored transitions", () => {
    expect(sanitizeTransition({ type: "nope", duration: 1 })).toBeUndefined();
    expect(sanitizeTransition(null)).toBeUndefined();
    expect(sanitizeTransition({ type: "cross-dissolve", duration: 99, alignment: "sideways", params: { x: 1 } })).toEqual({
      type: "cross-dissolve", duration: MAX_TRANSITION_DURATION, alignment: "center", params: {},
    });
    expect(sanitizeTransition({ type: "dip-to-black", duration: 0.5, alignment: "end", params: { hold: 7 } })).toEqual({
      type: "dip-to-black", duration: 0.5, alignment: "end", params: { hold: 0.8 },
    });
  });

  it("patches timing and parameters, and keeps what it can when replacing the type", () => {
    const t = createTransition("dip-to-black", 1);
    expect(patchTransition(t, { hold: 0.5, duration: 0.02, alignment: "start" })).toMatchObject({
      duration: 0.1, alignment: "start", params: { hold: 0.5 },
    });
    expect(patchTransition(t, { hold: 0 })).toBe(t);
    const replaced = replaceTransitionType({ ...t, alignment: "end" }, "cross-dissolve");
    expect(replaced).toEqual({ type: "cross-dissolve", duration: 1, alignment: "end", params: {} });
  });
});

describe("transition windows", () => {
  it("plays across a cut, aligned to it, and inside the clip at a free edge", () => {
    expect(windows(project(clip("a", 0, 4, { transitionOut: dissolve(1) }), clip("b", 4, 4)))).toEqual([
      { ref: "a.out", from: "a", to: "b", start: 3.5, end: 4.5 },
    ]);
    expect(windows(project(clip("a", 0, 4, { transitionOut: dissolve(1, "start") }), clip("b", 4, 4)))[0]).toMatchObject({ start: 4, end: 5 });
    expect(windows(project(clip("a", 0, 4, { transitionOut: dissolve(1, "end") }), clip("b", 4, 4)))[0]).toMatchObject({ start: 3, end: 4 });
    // Free edges: a gap after "a", nothing before "b".
    expect(windows(project(clip("a", 0, 4, { transitionOut: dissolve(1) }), clip("b", 5, 4, { transitionIn: dissolve(2) })))).toEqual([
      { ref: "a.out", from: "a", to: null, start: 3, end: 4 },
      { ref: "b.in", from: null, to: "b", start: 5, end: 7 },
    ]);
  });

  it("uses the incoming clip's in-transition at a cut only when the outgoing clip has none", () => {
    const both = project(clip("a", 0, 4, { transitionOut: dissolve(1) }), clip("b", 4, 4, { transitionIn: dissolve(2) }));
    expect(windows(both).map((w) => w.ref)).toEqual(["a.out"]);
    const onlyIn = project(clip("a", 0, 4), clip("b", 4, 4, { transitionIn: dissolve(2) }));
    expect(windows(onlyIn)).toEqual([{ ref: "b.in", from: "a", to: "b", start: 3, end: 5 }]);
  });

  it("shortens transitions to fit their clips and never overlaps them", () => {
    // Half of a centred 4 s transition would need 2 s of the 1 s clip.
    expect(windows(project(clip("a", 0, 1, { transitionOut: dissolve(4) }), clip("b", 1, 5)))[0]).toMatchObject({ start: 0, end: 2 });
    // A 1 s clip with a 1 s transition at each end: they meet in the middle.
    const p = project(
      clip("a", 0, 4, { transitionOut: dissolve(1) }),
      clip("b", 4, 1, { transitionOut: dissolve(1) }),
      clip("c", 5, 4),
    );
    expect(windows(p)).toEqual([
      { ref: "a.out", from: "a", to: "b", start: 3.5, end: 4.5 },
      { ref: "b.out", from: "b", to: "c", start: 4.5, end: 5.5 },
    ]);
  });

  it("has none on audio tracks", () => {
    const p = project({ ...clip("a", 0, 4, { transitionOut: dissolve() }), trackId: "audio_1" });
    expect(trackTransitions(p, "audio_1")).toEqual([]);
  });

  it("finds the window at a time and how far through it is", () => {
    const ws = trackTransitions(project(clip("a", 0, 4, { transitionOut: dissolve(1) }), clip("b", 4, 4)), MAIN_TRACK_ID);
    expect(transitionAt(ws, 3.4)).toBeNull();
    expect(transitionAt(ws, 3.5)).toBe(ws[0]);
    expect(transitionAt(ws, 4.5)).toBeNull();
    expect(windowProgress(ws[0], 4.25)).toBe(0.75);
  });
});

describe("transition edits", () => {
  const cut = () => project(clip("a", 0, 4), clip("b", 4, 4, { transitionIn: dissolve(2) }), clip("c", 9, 2));

  it("stores a transition at a cut on the outgoing clip, taking over what played there", () => {
    const { project: p, ref } = addTransition(cut(), { clipId: "b", edge: "in" }, "dip-to-black");
    expect(ref).toEqual({ clipId: "a", edge: "out" });
    expect(getClip(p, "a")!.transitionOut).toMatchObject({ type: "dip-to-black", duration: 2 });
    expect(getClip(p, "b")!.transitionIn).toBeUndefined();
  });

  it("puts a new transition on a free edge with its default length", () => {
    const { project: p, ref } = addTransition(cut(), { clipId: "c", edge: "in" }, "cross-dissolve");
    expect(ref).toEqual({ clipId: "c", edge: "in" });
    expect(findWindow(p, ref!)).toMatchObject({ start: 9, end: 9.5, from: null });
  });

  it("refuses unknown types and audio clips", () => {
    expect(addTransition(cut(), { clipId: "a", edge: "out" }, "nope").ref).toBeNull();
    const audio = project({ ...clip("x", 0, 2), trackId: "audio_1" });
    expect(addTransition(audio, { clipId: "x", edge: "out" }, "cross-dissolve").ref).toBeNull();
  });

  it("changes and removes transitions", () => {
    const ref = { clipId: "b", edge: "in" } as const;
    const p = setTransitionParams(cut(), ref, { duration: 1, alignment: "end" });
    expect(getClip(p, "b")!.transitionIn).toMatchObject({ duration: 1, alignment: "end" });
    expect(setTransitionParams(p, ref, { duration: 1 })).toBe(p);
    expect(getClip(removeTransition(p, ref), "b")!.transitionIn).toBeUndefined();
  });

  it("targets the nearest clip edge, and the edit point nearest the playhead", () => {
    const p = cut();
    expect(transitionTargetAt(p, MAIN_TRACK_ID, 3.8)).toEqual({ clipId: "a", edge: "out" });
    expect(transitionTargetAt(p, MAIN_TRACK_ID, 4.1)).toEqual({ clipId: "a", edge: "out" });
    expect(transitionTargetAt(p, MAIN_TRACK_ID, 8.5)).toBeNull();
    expect(transitionTargetAt(p, MAIN_TRACK_ID, 8.5, 1)).toEqual({ clipId: "b", edge: "out" });
    expect(nearestEdge(p, 8.8)).toEqual({ clipId: "c", edge: "in" });
    expect(canonicalRef(p, { clipId: "a", edge: "in" })).toEqual({ clipId: "a", edge: "in" });
  });

  it("turns a dragged window edge into a duration", () => {
    const p = project(clip("a", 0, 4, { transitionOut: dissolve(1) }), clip("b", 4, 4, { transitionOut: dissolve(1) }));
    const [centred, tail] = trackTransitions(p, MAIN_TRACK_ID);
    expect(durationForEdge(centred, "end", 5)).toBe(2);
    expect(durationForEdge(centred, "start", 3.75)).toBe(0.5);
    expect(durationForEdge(tail, "start", 6)).toBe(2);
  });

  it("keeps a split clip's transitions on its outer edges", () => {
    const p = project(clip("a", 0, 4, { transitionIn: dissolve(), transitionOut: dissolve() }));
    const { project: split, newClipId } = splitClip(p, "a", 2);
    expect(getClip(split, "a")).toMatchObject({ transitionIn: dissolve() });
    expect(getClip(split, "a")!.transitionOut).toBeUndefined();
    expect(getClip(split, newClipId!)).toMatchObject({ transitionOut: dissolve() });
    expect(getClip(split, newClipId!)!.transitionIn).toBeUndefined();
  });

  it("validates transitions when loading a project", () => {
    const raw = project(
      clip("a", 0, 4, { transitionOut: { type: "cross-dissolve", duration: -3 } as Transition, transitionIn: { type: "gone" } as Transition }),
      { ...clip("m", 0, 4, { transitionOut: dissolve() }), trackId: "audio_1" },
    );
    const p = normalizeProject(raw);
    expect(getClip(p, "a")!.transitionOut).toEqual({ type: "cross-dissolve", duration: 0.1, alignment: "center", params: {} });
    expect(getClip(p, "a")!.transitionIn).toBeUndefined();
    expect(getClip(p, "m")!.transitionOut).toBeUndefined();
  });
});
