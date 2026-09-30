import { describe, expect, it } from "vitest";
import {
  addChannels,
  addPattern,
  cloneChannel,
  clonePattern,
  drawSteps,
  fillSteps,
  moveChannel,
  removeChannel,
  removePattern,
  renamePattern,
  setPatternSteps,
  setStepNote,
  setSteps,
  setSwing,
  setTempo,
  stepNotes,
  stepString,
  toggleStep,
  updateChannel,
} from "./edits.ts";
import { FIRST_PATTERN_ID, createMusicProject, normalizeMusicProject } from "./project.ts";
import type { MusicProject } from "./types.ts";

const P = FIRST_PATTERN_ID;
const rack = (): MusicProject =>
  addChannels(createMusicProject("Beat"), [
    { id: "chan_kick", name: "Kick", sampleId: "media_kick" },
    { id: "chan_hat", name: " Hat ", sampleId: null },
  ]);
const steps = (song: MusicProject, channel: string, pattern = P) => stepString(song.patterns.find((p) => p.id === pattern)!, channel);

describe("song settings", () => {
  it("clamps the tempo and the swing, and leaves the song alone when nothing changes", () => {
    const song = rack();
    expect(setTempo(song, 140.004).settings.tempo).toBe(140);
    expect(setTempo(song, 5).settings.tempo).toBe(20);
    expect(setTempo(song, 120)).toBe(song);
    expect(setTempo(song, NaN)).toBe(song);
    expect(setSwing(song, 2).settings.swing).toBe(1);
    expect(setSwing(song, 0)).toBe(song);
  });
});

describe("channels", () => {
  it("are added at the end of the rack, as FL's defaults", () => {
    const song = rack();
    expect(song.channels.map((c) => c.name)).toEqual(["Kick", "Hat"]);
    expect(song.channels[0]).toMatchObject({ kind: "sampler", sampleId: "media_kick", volume: 0.78, pan: 0, muted: false });
    expect(addChannels(song, [])).toBe(song);
  });

  it("are changed within their limits, and not at all by a patch that changes nothing", () => {
    const song = rack();
    expect(updateChannel(song, "chan_kick", { volume: 2, pan: -3, pitch: 100, name: "  808  " }).channels[0]).toMatchObject({ volume: 1, pan: -1, pitch: 48, name: "808" });
    expect(updateChannel(song, "chan_kick", { envelope: { enabled: true, release: 99 } }).channels[0].envelope).toMatchObject({ enabled: true, release: 10, decay: 0.2 });
    expect(updateChannel(song, "chan_kick", { volume: 0.78, name: "", envelope: { enabled: false } })).toBe(song);
    expect(updateChannel(song, "chan_none", { volume: 0.1 })).toBe(song);
  });

  it("take their notes with them when removed or cloned, in every pattern", () => {
    let song = addPattern(rack(), { id: "pat_2" });
    song = setSteps(song, P, "chan_kick", [0, 4], true);
    song = setSteps(song, "pat_2", "chan_kick", [2], true);
    const cloned = cloneChannel(song, "chan_kick", "chan_copy");
    expect(cloned.channels.map((c) => c.id)).toEqual(["chan_kick", "chan_copy", "chan_hat"]);
    expect(steps(cloned, "chan_copy")).toBe("x---x-----------");
    expect(steps(cloned, "chan_copy", "pat_2")).toBe("--x-------------");
    const removed = removeChannel(cloned, "chan_kick");
    expect(removed.patterns.every((p) => !("chan_kick" in p.notes))).toBe(true);
    expect(steps(removed, "chan_copy")).toBe("x---x-----------");
    expect(removeChannel(song, "chan_none")).toBe(song);
    expect(normalizeMusicProject(removed)).toEqual(removed);
  });

  it("move within the rack", () => {
    const song = rack();
    expect(moveChannel(song, "chan_hat", 0).channels.map((c) => c.id)).toEqual(["chan_hat", "chan_kick"]);
    expect(moveChannel(song, "chan_hat", 9)).toBe(song);
  });
});

describe("steps", () => {
  it("toggle on and off, keeping the notes in order", () => {
    let song = toggleStep(rack(), P, "chan_kick", 8);
    song = toggleStep(song, P, "chan_kick", 0);
    expect(steps(song, "chan_kick")).toBe("x-------x-------");
    expect(song.patterns[0].notes.chan_kick.map((n) => n.start)).toEqual([0, 192]);
    song = toggleStep(song, P, "chan_kick", 8);
    song = toggleStep(song, P, "chan_kick", 0);
    // A channel with no notes isn't in the pattern at all.
    expect(song.patterns[0].notes).toEqual({});
  });

  it("are set several at once, ignoring the ones already that way or outside the pattern", () => {
    const song = setSteps(rack(), P, "chan_kick", [0, 4, 4, 99, -1, 1.5], true);
    expect(steps(song, "chan_kick")).toBe("x---x-----------");
    expect(setSteps(song, P, "chan_kick", [0, 4], true)).toBe(song);
    expect(setSteps(song, P, "chan_kick", [1, 2], false)).toBe(song);
    expect(setSteps(song, P, "chan_none", [1], true)).toBe(song);
    expect(setSteps(song, "pat_none", "chan_kick", [1], true)).toBe(song);
  });

  it("are drawn from text, repeating a short drawing and keeping what stays on", () => {
    let song = setSteps(rack(), P, "chan_hat", [2], true);
    song = setStepNote(song, P, "chan_hat", 2, { velocity: 0.3 });
    song = drawSteps(song, P, "chan_hat", "--x- x---");
    expect(steps(song, "chan_hat")).toBe("--x-x-----x-x---");
    expect(stepNotes(song.patterns[0], "chan_hat")[2]?.velocity).toBe(0.3);
    expect(drawSteps(song, P, "chan_hat", "--x-x-----x-x---")).toBe(song);
    expect(steps(fillSteps(song, P, "chan_hat", 4), "chan_hat")).toBe("x---x---x---x---");
    expect(steps(drawSteps(song, P, "chan_hat", "."), "chan_hat")).toBe("----------------");
  });

  it("have a velocity and a pitch (the graph editor)", () => {
    const song = setSteps(rack(), P, "chan_kick", [0], true);
    const edited = setStepNote(song, P, "chan_kick", 0, { velocity: 1.4, pitch: 72.4 });
    expect(edited.patterns[0].notes.chan_kick[0]).toMatchObject({ velocity: 1, pitch: 72 });
    expect(setStepNote(song, P, "chan_kick", 0, { velocity: 0.78 })).toBe(song);
    expect(setStepNote(song, P, "chan_kick", 3, { velocity: 0.2 })).toBe(song);
  });
});

describe("patterns", () => {
  it("are added a bar long, named after their number, cloned and renamed", () => {
    let song = addPattern(rack(), { id: "pat_2" });
    expect(song.patterns[1]).toEqual({ id: "pat_2", name: "Pattern 2", steps: 16, notes: {} });
    song = setSteps(song, "pat_2", "chan_kick", [0], true);
    song = clonePattern(song, "pat_2", "pat_3");
    expect(song.patterns.map((p) => p.name)).toEqual(["Pattern 1", "Pattern 2", "Pattern 3"]);
    expect(steps(song, "chan_kick", "pat_3")).toBe("x---------------");
    expect(renamePattern(song, "pat_3", " Drop ").patterns[2].name).toBe("Drop");
    expect(renamePattern(song, "pat_3", "Pattern 3")).toBe(song);
  });

  it("can't all be removed", () => {
    const song = addPattern(rack(), { id: "pat_2" });
    const one = removePattern(song, P);
    expect(one.patterns.map((p) => p.id)).toEqual(["pat_2"]);
    expect(removePattern(one, "pat_2")).toBe(one);
  });

  it("lose the notes past their end when shortened", () => {
    let song = setSteps(rack(), P, "chan_kick", [0, 12], true);
    song = setSteps(song, P, "chan_hat", [14], true);
    const short = setPatternSteps(song, P, 8);
    expect(short.patterns[0].steps).toBe(8);
    expect(steps(short, "chan_kick")).toBe("x-------");
    expect("chan_hat" in short.patterns[0].notes).toBe(false);
    expect(steps(setPatternSteps(song, P, 32), "chan_kick")).toBe("x-----------x-------------------");
    expect(setPatternSteps(song, P, 16)).toBe(song);
  });
});
