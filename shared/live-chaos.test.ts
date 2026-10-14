import { describe, expect, it } from "vitest";
import { definitionOf } from "./effects.ts";
import {
  CHAOS_LOOKS,
  CHAOS_RECIPES,
  type ChaosWorld,
  chaosLayers,
  chaosRoll,
  echoZoom,
  glareOf,
  mutateWorld,
  rollChaos,
  trailSeconds,
  worldParams,
} from "./live-chaos.ts";
import { lookSequence, seededRandom } from "./live-looks.ts";

const RED = { background: "#1a0505", primary: "#ff3b30", secondary: "#ff9f0a", accent: "#ffd60a", light: "#fff4f0", mono: false };
const FULL_FRAME = ["plasma", "lattice", "smoke"];
const ROLLS = 200;

describe("chaos recipes", () => {
  it("are vaudio's nine, each a look of kind chaos", () => {
    expect(CHAOS_RECIPES.map((r) => r.name)).toEqual(["Liquid", "Tunnel", "Fractal Bloom", "Datamosh", "Acid", "Rorschach", "Neon Skeleton", "Vortex", "Stargate"]);
    expect(CHAOS_LOOKS.map((l) => l.id)).toEqual(CHAOS_RECIPES.map((r) => `chaos-${r.id}`));
    for (const look of CHAOS_LOOKS) expect(look.kind).toBe("chaos");
  });

  for (const recipe of CHAOS_RECIPES) {
    it(`${recipe.name}: every roll keeps to the recipe and the guard rails`, () => {
      for (let i = 0; i < ROLLS; i++) {
        const roll = rollChaos(recipe, seededRandom(`${recipe.id}:${i}`));
        const w = roll.world;
        // vaudio's rails: the echo under 0.93, no strobe over a heavy echo; ours: a frame-filling source's held back.
        expect(w.feedback).toBeLessThanOrEqual(0.93);
        if (w.feedback > 0.6) expect(w.strobe).toBeLessThanOrEqual(0.1);
        if (roll.layers.some((l) => FULL_FRAME.includes(l.source))) expect(w.feedback).toBeLessThanOrEqual(0.6);
        expect(w.trails).toBeLessThanOrEqual(0.97);
        expect(recipe.backdrops).toContain(roll.backdrop);
        // A base and maybe one more, never the same source twice.
        expect(roll.layers.length).toBeGreaterThanOrEqual(1);
        expect(roll.layers.length).toBeLessThanOrEqual(2);
        const [base, upper] = roll.layers;
        expect(recipe.bases).toContain(base.source);
        expect(["normal", ...recipe.blends]).toContain(base.blend);
        if (upper) {
          expect(recipe.uppers).toContain(upper.source);
          expect(upper.source).not.toBe(base.source);
          expect(recipe.blends).toContain(upper.blend);
        }
        for (const layer of roll.layers) {
          // Added or dodged, a layer's held back; a frame-filling one is never inverted (it'd be a white frame).
          if (layer.blend === "add") expect(layer.opacity).toBeLessThanOrEqual(0.6);
          if (layer.blend === "color-dodge") expect(layer.opacity).toBeLessThanOrEqual(0.5);
          if (FULL_FRAME.includes(layer.source)) expect(layer.invert).toBe(0);
          expect(layer.distortions.length).toBeGreaterThanOrEqual(1);
          for (const d of layer.distortions) expect(recipe.distorts.map((x) => x.key)).toContain(d.key);
        }
      }
    });

    it(`${recipe.name}: a look of known effects in the song's colours, its headline growing with the intensity`, () => {
      const look = CHAOS_LOOKS.find((l) => l.id === `chaos-${recipe.id}`)!;
      for (let i = 0; i < 20; i++) {
        const seq = lookSequence(look, { palette: RED, random: seededRandom(`${recipe.id}:${i}`) }, "seq_chaos");
        for (const clip of seq.clips) for (const effect of clip.effects) expect(definitionOf(effect), effect.type).toBeDefined();
        const world = seq.clips.flatMap((c) => c.effects).find((e) => e.type === "world-loop")!;
        expect(world).toBeDefined();
        const headline = Object.values(world.links ?? {}).filter((l) => "name" in l.signal && l.signal.name === "intensity");
        const shown = recipe.headline.some((key) => (rollChaos(recipe, seededRandom(`${recipe.id}:${i}`)).world[key] ?? 0) > 0);
        if (shown) expect(headline.length).toBeGreaterThan(0);
      }
    });
  }

  it("places what's off the middle where its repeat shows it (a kaleido's wedge, a mirror's half), never cut away", () => {
    for (const recipe of CHAOS_RECIPES) {
      for (let i = 0; i < ROLLS; i++) {
        const roll = rollChaos(recipe, seededRandom(`place:${recipe.id}:${i}`));
        for (const layer of roll.layers) {
          const { x, y } = layer.place;
          if (x === 0.5 && y === 0.5) continue;
          // Its direction from the middle, y up, in heights.
          const angle = Math.atan2(0.5 - y, (x - 0.5) * 1.78);
          if (roll.world.kaleido > 0) {
            expect(angle).toBeGreaterThan(0);
            expect(angle).toBeLessThan(Math.PI / 17);
          } else if (roll.world.mirror > 0.5) {
            expect(x).toBeGreaterThan(0.5);
            expect(y).toBeLessThan(0.5);
          } else if (roll.world.mirror > 0) expect(x).toBeGreaterThan(0.5);
        }
      }
    }
  });

  it("rolls the same for the same seed, and differently for another", () => {
    const recipe = CHAOS_RECIPES[0];
    expect(rollChaos(recipe, seededRandom("a"))).toEqual(rollChaos(recipe, seededRandom("a")));
    expect(rollChaos(recipe, seededRandom("a"))).not.toEqual(rollChaos(recipe, seededRandom("b")));
  });
});

describe("glare", () => {
  const YELLOW = { background: "#1f1405", primary: "#ffb22e", secondary: "#ff7a1f", accent: "#ffe14a", light: "#fff6e0", mono: false };
  const BLUE = { background: "#050a1f", primary: "#3b5bff", secondary: "#7a3bff", accent: "#ff3bd0", light: "#eef0ff", mono: false };

  it("holds back a roll in bright colours: less echo, shorter trails, less exposed", () => {
    const recipe = CHAOS_RECIPES.find((r) => r.id === "tunnel")!;
    for (let i = 0; i < 50; i++) {
      const roll = rollChaos(recipe, seededRandom(`glare:${i}`));
      expect(glareOf(roll, YELLOW)).toBeGreaterThan(glareOf(roll, BLUE));
      const world = chaosLayers(roll, YELLOW)
        .flatMap((l) => l.effects)
        .find((e) => e.type === "world-loop")!;
      expect(world.params.amount).toBeLessThanOrEqual(0.93 - 0.33 * glareOf(roll, YELLOW) + 1e-9);
    }
  });

  it("never draws in the cover's light (near white)", () => {
    for (const recipe of CHAOS_RECIPES) {
      for (let i = 0; i < 50; i++) for (const layer of rollChaos(recipe, seededRandom(`${recipe.id}:${i}`)).layers) expect(layer.colours).not.toContain("light");
    }
  });
});

describe("mutate", () => {
  it("nudges every world value by at most 0.12, keeps the layers, and the same way for the same seed", () => {
    for (const recipe of CHAOS_RECIPES) {
      const roll = rollChaos(recipe, seededRandom(recipe.id));
      const mutated = mutateWorld(roll, seededRandom("m"));
      expect(mutated.layers).toEqual(roll.layers);
      expect(mutated).toEqual(mutateWorld(roll, seededRandom("m")));
      for (const key of Object.keys(roll.world) as (keyof ChaosWorld)[]) {
        expect(Math.abs(mutated.world[key] - roll.world[key]), `${recipe.id} ${key}`).toBeLessThanOrEqual(0.12 + 1e-9);
      }
      expect(mutated.world.feedback).toBeLessThanOrEqual(0.9);
    }
  });

  it("is what a look's mutations are: none is the roll, each one more nudged", () => {
    const recipe = CHAOS_RECIPES[1];
    const at = (mutations: number) => chaosRoll(recipe, { palette: RED, random: seededRandom("song"), mutations });
    expect(at(0).layers).toEqual(at(2).layers);
    expect(at(0).world).not.toEqual(at(1).world);
    expect(at(1).world).not.toEqual(at(2).world);
    expect(at(2)).toEqual(at(2));
  });
});

describe("vaudio's units", () => {
  it("become the World Loop's: trails in seconds, the echo's zoom and turn a second", () => {
    // vaudio fades its echo a frame at a time at 60 fps.
    expect(trailSeconds(0.95)).toBeCloseTo(1.03, 1);
    expect(trailSeconds(0.65)).toBeCloseTo(0.21, 1);
    expect(echoZoom(0)).toBe(1);
    expect(echoZoom(0.3)).toBeCloseTo(2.26, 1);
    expect(echoZoom(-0.12)).toBeLessThan(1);
    const recipe = CHAOS_RECIPES.find((r) => r.id === "vortex")!;
    const params = worldParams({ ...rollChaos(recipe, seededRandom("x")).world, fbRotate: 0.2, swirl: 0.8 }, recipe);
    expect(params.echoRotation).toBe(38);
    // The headline starts lower: the intensity grows it.
    expect(params.swirl).toBeCloseTo(0.52);
  });
});
