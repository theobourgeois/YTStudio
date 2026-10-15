import { describe, expect, it } from "vitest";
import { LIVE_LOOKS, seededRandom, switchTransition } from "@shared/live-looks";
import { DEFAULT_PALETTE } from "@shared/palette";
import { LiveDirector } from "./director";

const ctx = () => ({ palette: DEFAULT_PALETTE, random: seededRandom("x") });
const looksOn = (director: LiveDirector) => director.project.clips.filter((c) => c.trackId === "looks");

describe("LiveDirector", () => {
  it("shows a look, then switches to the next through a transition, the first ending there", () => {
    const director = new LiveDirector();
    director.show(LIVE_LOOKS[0], ctx(), 0.5, null);
    expect(director.look).toBe(LIVE_LOOKS[0].id);
    director.show(LIVE_LOOKS[1], ctx(), 8, switchTransition("flash", 1));
    const [first, second] = looksOn(director);
    expect(first.start + (first.out - first.in)).toBeCloseTo(8);
    expect(second).toMatchObject({ start: 8, transitionIn: { type: "flash" } });
    expect(director.look).toBe(LIVE_LOOKS[1].id);
    expect(director.project.sequences).toHaveLength(2);
  });

  it("replaces a switch still to come", () => {
    const director = new LiveDirector();
    director.show(LIVE_LOOKS[0], ctx(), 0, null);
    director.show(LIVE_LOOKS[1], ctx(), 10, switchTransition("flash", 1));
    director.show(LIVE_LOOKS[2], ctx(), 9, switchTransition("flash", 1));
    expect(looksOn(director).map((c) => c.start)).toEqual([0, 9]);
  });

  it("lets go of looks long past", () => {
    const director = new LiveDirector();
    director.show(LIVE_LOOKS[0], ctx(), 0, null);
    director.show(LIVE_LOOKS[1], ctx(), 5, switchTransition("flash", 1));
    director.prune(5.5);
    expect(looksOn(director)).toHaveLength(2);
    director.prune(7);
    expect(looksOn(director)).toHaveLength(1);
    expect(director.project.sequences).toHaveLength(1);
  });

  it("in slow motion, shows looks slowed and turns the frame on from where it is, slower", () => {
    const director = new LiveDirector();
    director.setFrame({ repeat: 1, mirror: false, spin: 20, zoom: 1 }, 0, 0.5);
    director.setPace(0.5, 10);
    director.show(LIVE_LOOKS[0], { ...ctx(), pace: 0.5 }, 10, null);
    expect(looksOn(director)[0].speed).toBe(0.5);
    // 200° by the change (20° a second for ten), then 10° a second.
    const rotation = director.project.clips.find((c) => c.id === "perform")!.effects.find((e) => e.type === "transform")!.expressions!.rotation;
    expect(rotation).toBe("200 + Math.max(0, time - 10) * 10");
  });

  it("keeps the same project until something changes", () => {
    const director = new LiveDirector();
    director.show(LIVE_LOOKS[0], ctx(), 0, null);
    const project = director.project;
    director.prune(1);
    director.hit("zoom", 1);
    expect(director.project).toBe(project);
    expect(director.pads.header.hits.onsetLow).toEqual([[1, 1]]);
    director.setHue(36);
    expect(director.project).not.toBe(project);
    expect(director.hue).toBe(36);
  });
});
