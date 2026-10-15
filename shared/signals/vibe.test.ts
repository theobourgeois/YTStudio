import { describe, expect, it } from "vitest";
import { VIBE_DATA } from "./vibe-data.ts";
import { VIBE_AXES, VIBE_AXIS_NAMES, VIBE_GENRES, VIBE_MODEL, type Vibe, blendVibes, hearVibe, vibeCharacters } from "./vibe.ts";

/** A vibe with these axes (the rest in the middle). */
const vibe = (axes: Partial<Vibe["axes"]>): Vibe => ({ axes: { energy: 0, mood: 0, force: 0, pace: 0, space: 0, dance: 0, ...axes }, genres: [] });
const top = (scores: Record<string, number>) => Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];

describe("the vibe's vocabulary (vibe.json)", () => {
  it("is the text side's for these axes and genres, from this model (scripts/clap-vibe.ts makes it again)", () => {
    expect(VIBE_DATA.model).toBe(`${VIBE_MODEL.repo}@${VIBE_MODEL.revision}`);
    expect(Object.keys(VIBE_DATA.axes)).toEqual(Object.keys(VIBE_AXES));
    expect(VIBE_DATA.genres.map((g) => g.name)).toEqual(VIBE_GENRES.map((g) => g.name));
    for (const a of VIBE_AXIS_NAMES) {
      expect(VIBE_DATA.axes[a].low).toHaveLength(512);
      expect(Math.hypot(...VIBE_DATA.axes[a].high)).toBeCloseTo(1, 3);
      expect(VIBE_DATA.axes[a].spread).toBeGreaterThan(0);
    }
    expect(VIBE_DATA.calibration.length).toBeGreaterThanOrEqual(10);
  });
});

describe("hearVibe", () => {
  it("places a sound on each axis by which end it's nearer, and among the genres by which it's nearest", () => {
    // A sound just like "intense, loud, energetic music" is at the energy axis's high end, and the reverse.
    expect(hearVibe(VIBE_DATA.axes.energy.high, VIBE_DATA).axes.energy).toBeGreaterThan(0.5);
    expect(hearVibe(VIBE_DATA.axes.energy.low, VIBE_DATA).axes.energy).toBeLessThan(-0.5);
    expect(hearVibe(VIBE_DATA.axes.force.high, VIBE_DATA).axes.force).toBeGreaterThan(0.5);
    const techno = VIBE_DATA.genres.find((g) => g.name === "techno")!.embedding;
    expect(hearVibe(techno, VIBE_DATA).genres[0].name).toBe("techno");
    expect(hearVibe(techno, VIBE_DATA).genres).toHaveLength(3);
    // Any length: it's the direction that counts.
    expect(hearVibe(techno.map((v) => v * 7), VIBE_DATA).genres[0].name).toBe("techno");
  });
});

describe("vibeCharacters", () => {
  it("hears calm, soft and slow as chill; intense, bright and fast as hype; aggressive, intense and dark as heavy; the middle as groove", () => {
    expect(top(vibeCharacters(vibe({ energy: -0.8, force: -0.6, pace: -0.6 })))).toBe("chill");
    expect(top(vibeCharacters(vibe({ energy: 0.8, mood: 0.6, pace: 0.6 })))).toBe("hype");
    expect(top(vibeCharacters(vibe({ energy: 0.7, force: 0.9, mood: -0.7 })))).toBe("heavy");
    expect(top(vibeCharacters(vibe({ dance: 0.6 })))).toBe("groove");
  });
});

describe("blendVibes", () => {
  it("averages the axes and counts the genres, as weighted", () => {
    const a: Vibe = { axes: vibe({ energy: 1 }).axes, genres: [{ name: "trap", likeness: 0.5 }, { name: "pop", likeness: 0.4 }, { name: "rap", likeness: 0.3 }] };
    const b: Vibe = { axes: vibe({ energy: -0.5 }).axes, genres: [{ name: "pop", likeness: 0.5 }, { name: "trap", likeness: 0.45 }, { name: "house", likeness: 0.3 }] };
    expect(blendVibes([a, b])!.axes.energy).toBe(0.25);
    expect(blendVibes([a, b], [3, 1])!.axes.energy).toBe(0.63);
    expect(blendVibes([a, b])!.genres.map((g) => g.name).slice(0, 2).sort()).toEqual(["pop", "trap"]);
    expect(blendVibes([])).toBeNull();
  });
});
