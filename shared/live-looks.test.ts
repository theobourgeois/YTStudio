import { describe, expect, it } from "vitest";
import { definitionOf } from "./effects.ts";
import {
  COVER_ASSET,
  FOREVER,
  LIVE_ASSET,
  LIVE_LOOKS,
  LOOK_KINDS,
  PADS_ASSET,
  PADS_TRACK,
  SLOW_MOTION,
  SWITCHES,
  NO_FX,
  endShow,
  frameAngle,
  fxAt,
  normalizeFx,
  liveProject,
  lookSequence,
  padSignals,
  performLayer,
  seededRandom,
  showClip,
  switchTransition,
} from "./live-looks.ts";
import { fx, inSlowMotion } from "./live-kit.ts";
import { MILKDROP_ASSET } from "./live-milkdrop.ts";
import { DEFAULT_PALETTE } from "./palette.ts";
import { isSequenceId } from "./sequences.ts";
import { transitionDefinition } from "./transitions.ts";

const RED = { background: "#1a0505", primary: "#ff3b30", secondary: "#ff9f0a", accent: "#ffd60a", light: "#fff4f0", mono: false };

describe("LIVE_LOOKS", () => {
  it("has unique ids, in groups the picker knows", () => {
    expect(new Set(LIVE_LOOKS.map((l) => l.id)).size).toBe(LIVE_LOOKS.length);
    for (const look of LIVE_LOOKS) expect(LOOK_KINDS.map((k) => k.id)).toContain(look.kind);
    for (const kind of LOOK_KINDS) expect(LIVE_LOOKS.some((l) => l.kind === kind.id)).toBe(true);
  });

  for (const look of LIVE_LOOKS) {
    it(`${look.name}: layers of known effects, in the song's colours (MilkDrop's in its own)`, () => {
      const seq = lookSequence(look, { palette: RED, random: seededRandom(`song:${look.id}`) }, "seq_test");
      expect(seq.tracks.length).toBe(seq.clips.length);
      expect(seq.clips.length).toBeGreaterThan(0);
      for (const clip of seq.clips) {
        expect(clip.out).toBe(FOREVER);
        expect([...new Set(clip.effects.map((e) => e.id))]).toHaveLength(clip.effects.length);
        for (const effect of clip.effects) expect(definitionOf(effect), effect.type).toBeDefined();
        // The cover, or MilkDrop's picture (drawn live).
        if (clip.assetId) expect(clip.assetId).toBe(look.kind === "milkdrop" ? MILKDROP_ASSET : COVER_ASSET);
      }
      // MilkDrop's presets keep their own colours.
      if (look.kind === "milkdrop") return;
      // Some colour of the song's is in it (a look follows the cover), and none of the default palette's.
      const text = JSON.stringify(seq.clips);
      expect(Object.values(RED).some((c) => typeof c === "string" && text.includes(c))).toBe(true);
      expect(text).not.toContain(DEFAULT_PALETTE.accent);
    });
  }

  it("goes off with the music: its punches and its energy follow the intensity", () => {
    for (const look of LIVE_LOOKS) {
      const seq = lookSequence(look, { palette: RED, random: seededRandom(look.id) }, "seq_e");
      // On top, its energy: shaking, strobing and brightening as the music gets intense.
      const top = seq.clips[0];
      expect(top.adjustment, look.id).toBe(true);
      const links = top.effects.flatMap((e) => Object.values(e.links ?? {}));
      expect(links.some((l) => "name" in l.signal && l.signal.name === "intensity")).toBe(true);
      // Every punch (a hit on the sound) is as big as the music is intense.
      for (const clip of seq.clips) {
        for (const e of clip.effects) {
          for (const link of Object.values(e.links ?? {})) {
            if (link.hit && "name" in link.signal && link.signal.name !== "downbeat") expect(link.depth?.signal, `${look.id} ${e.type}`).toEqual({ name: "intensity" });
          }
        }
      }
    }
  });

  it("plays a look in slow motion: what moves by the second at half speed, hits swelling, no shaking, strobing, splitting or flashing", () => {
    for (const look of LIVE_LOOKS) {
      const ctx = (pace: number) => ({ palette: RED, random: seededRandom(look.id), pace });
      const fast = lookSequence(look, ctx(1), "seq_f");
      const slow = lookSequence(look, ctx(SLOW_MOTION), "seq_s");
      // Its own layers (under its energy), the same effects, slower.
      const own = (seq: typeof fast) => seq.clips.slice(1).map((c) => c.effects.map((e) => e.type));
      expect(own(slow), look.id).toEqual(own(fast));
      slow.clips.slice(1).forEach((clip, k) => {
        const i = k + 1;
        clip.effects.forEach((e, j) => {
          const was = fast.clips[i].effects[j];
          if (typeof was.params.speed === "number") expect(e.params.speed, `${look.id} ${e.type}`).toBeCloseTo(was.params.speed * SLOW_MOTION);
          for (const [key, link] of Object.entries(e.links ?? {})) {
            const before = was.links![key];
            if (link.hit) expect(link.hit.attack, `${look.id} ${e.type}.${key}`).toBeGreaterThanOrEqual(0.12);
            if (link.hit) expect(link.hit.decay).toBeCloseTo(before.hit!.decay / SLOW_MOTION);
            expect(link.response.release).toBeCloseTo(before.response.release / SLOW_MOTION);
          }
        });
      });
      // Its energy only brightens (and punches in, softly): nothing shakes, strobes, splits or flashes.
      const energy = slow.clips[0].effects;
      for (const type of ["camera-shake", "audio-strobe", "rgb-split"]) {
        const e = energy.find((x) => x.type === type)!;
        expect(Object.values(e.links ?? {}).every((l) => l.amount === 0), `${look.id} ${type}`).toBe(true);
      }
      expect(energy.some((e) => e.type === "invert")).toBe(false);
    }
  });

  it("slows what moves by the second, eases a zoom a second towards none, and leaves the rest", () => {
    const [loop] = inSlowMotion([fx("world-loop", { speed: 1, orbit: 40, echoZoom: 1.44, warp: 0.5 })], 0.5);
    expect(loop.params).toMatchObject({ speed: 0.5, orbit: 20, warp: 0.5 });
    expect(loop.params.echoZoom).toBeCloseTo(1.2);
    // As made, at full speed.
    const same = [fx("world-loop", { speed: 1 })];
    expect(inSlowMotion(same, 1)).toBe(same);
  });

  it("varies a look by its seed, the same for the same seed", () => {
    const make = (seed: string) => JSON.stringify(lookSequence(LIVE_LOOKS.find((l) => l.id === "echo-tunnel")!, { palette: RED, random: seededRandom(seed) }, "seq_x").clips);
    expect(make("a")).toBe(make("a"));
    expect(make("a")).not.toBe(make("b"));
  });
});

describe("liveProject", () => {
  it("plays the looks over the sound heard, the pads on a muted track", () => {
    const seq = lookSequence(LIVE_LOOKS[0], { palette: RED, random: seededRandom("x") }, "seq_live1");
    const project = liveProject([{ look: LIVE_LOOKS[0].id, sequence: seq, clip: showClip(seq, 3, null) }], performLayer(0));
    expect(isSequenceId(seq.id)).toBe(true);
    expect(project.sequences).toEqual([seq]);
    expect(project.clips.find((c) => c.assetId === LIVE_ASSET)).toBeDefined();
    const pads = project.clips.find((c) => c.assetId === PADS_ASSET)!;
    expect(project.tracks.find((t) => t.id === pads.trackId)?.muted).toBe(true);
    // The perform layer is on top.
    expect(project.clips.find((c) => c.trackId === project.tracks[0].id)?.adjustment).toBe(true);
  });

  it("brings a look in through a transition with room for it, and ends the one before at the switch", () => {
    const seq = lookSequence(LIVE_LOOKS[1], { palette: RED, random: seededRandom("x") }, "seq_live2");
    const show = showClip(seq, 10, switchTransition("cross-zoom", 1.2));
    expect(show.transitionIn).toMatchObject({ type: "cross-zoom", duration: 1.2, alignment: "center" });
    expect(show.in).toBeGreaterThanOrEqual(0.6);
    const before = showClip(seq, 2, null);
    const ended = endShow(before, 10);
    expect(ended.start + (ended.out - ended.in)).toBeCloseTo(10);
  });

  it("switches only through transitions that exist", () => {
    for (const type of SWITCHES) expect(transitionDefinition(type), type).toBeDefined();
  });
});

describe("the frame", () => {
  const plain = { repeat: 1, mirror: false, spin: 0, zoom: 1 } as const;
  const effect = (clip: ReturnType<typeof performLayer>, type: string) => clip.effects.find((e) => e.type === type);

  it("leaves the picture as it is unless it's reframed", () => {
    expect(effect(performLayer(0), "transform")).toBeUndefined();
    const move = { from: plain, to: plain, at: 0, seconds: 0.5, angle: 0 };
    expect(effect(performLayer(0, move), "transform")?.params.edges).toBe("none");
  });

  it("repeats the picture in tiles (or mirrored), easing there over the move", () => {
    const tiled = effect(performLayer(0, { from: plain, to: { ...plain, repeat: 3 }, at: 10, seconds: 0.5, angle: 0 }), "transform")!;
    expect(tiled.params.edges).toBe("tile");
    expect(tiled.expressions?.scale).toBe("ease(time, 10, 10.5, 1, 0.333)");
    const mirrored = effect(performLayer(0, { from: plain, to: { ...plain, repeat: 2, mirror: true }, at: 0, seconds: 1, angle: 0 }), "transform")!;
    expect(mirrored.params.edges).toBe("mirror");
    // Mirrored without copies: down the middle.
    expect(effect(performLayer(0, { from: plain, to: { ...plain, mirror: true }, at: 0, seconds: 1, angle: 0 }), "mirror")).toBeDefined();
  });

  it("turns on from where it was, and back upright to the nearest whole turn", () => {
    const spinning = { from: plain, to: { ...plain, spin: 20 }, at: 10, seconds: 0.5, angle: 30 };
    expect(frameAngle(spinning, 10)).toBe(30);
    expect(frameAngle(spinning, 13)).toBe(90);
    expect(effect(performLayer(0, spinning), "transform")?.expressions?.rotation).toBe("30 + Math.max(0, time - 10) * 20");
    const upright = { from: spinning.to, to: plain, at: 20, seconds: 1, angle: 350, upright: true };
    expect(frameAngle(upright, 20)).toBe(350);
    expect(frameAngle(upright, 21)).toBeCloseTo(360);
  });

  it("plays the player's distortions and feedback over every look, in vaudio's units", () => {
    expect(performLayer(0, null, null, null).effects.some((e) => ["world-loop", "bulge"].includes(e.type))).toBe(false);
    const set = { ...NO_FX, warp: 0.4, kaleido: 0.5, fold: 0.3, feedback: 0.87, trails: 0.76, echoZoom: 0.33, echoFlow: 0.5, lens: -0.18 };
    const played = performLayer(0, null, null, { from: set, to: set, at: 0, seconds: 0 });
    const world = effect(played, "world-loop")!;
    expect(world.params).toMatchObject({ warp: 0.4, kaleido: 0.5, mirror: 0.3, amount: 0.87, echoRotation: 0, echoHue: 0 });
    expect(world.params.echoZoom).toBeGreaterThan(1);
    expect(world.params.flowWarp).toBeCloseTo(0.3);
    expect(world.links?.warp).toBeDefined();
    expect(effect(played, "bulge")?.params.amount).toBeLessThan(0);
  });

  it("eases the player's values from where they were, its loop's state kept by role", () => {
    const to = { ...NO_FX, kaleido: 0.6, feedback: 0.7 };
    const layer = performLayer(0, null, null, { from: NO_FX, to, at: 10, seconds: 2 });
    const world = effect(layer, "world-loop")!;
    expect(world.id).toBe("fx-loop");
    expect(world.expressions?.kaleido).toBe("ease(time, 10, 12, 0, 0.6)");
    expect(world.expressions?.warp).toBeUndefined();
    const halfway = fxAt({ from: NO_FX, to, at: 10, seconds: 2 }, 11);
    expect(halfway.kaleido).toBeCloseTo(0.3);
    expect(effect(performLayer(0, null, { at: 5, seconds: 2 }, null), "world-loop")?.id).toBe("morph-loop");
  });

  it("keeps what's stored or given of the player's values within vaudio's ranges", () => {
    expect(normalizeFx(null)).toEqual(NO_FX);
    expect(normalizeFx({ feedback: 2, lens: -5, warp: "x", swirl: 0.5 })).toEqual({ ...NO_FX, feedback: 0.93, lens: -1, swirl: 0.5 });
  });

  it("melts one look into the next with a feedback morph about a calm switch", () => {
    const morph = effect(performLayer(0, null, { at: 30, seconds: 3 }), "world-loop")!;
    expect(morph.expressions?.amount).toContain("ease(time");
    expect(effect(performLayer(0), "world-loop")).toBeUndefined();
  });
});

describe("pads", () => {
  it("are hits of a sound of their own, one onset signal a pad", () => {
    const data = padSignals([
      { pad: "zoom", time: 2, velocity: 1 },
      { pad: "zoom", time: 1, velocity: 0.5 },
      { pad: "flash", time: 1.5, velocity: 1 },
    ]);
    expect(data.header.hits.onsetLow).toEqual([
      [1, 0.5],
      [2, 1],
    ]);
    expect(data.header.hits.onset).toEqual([[1.5, 1]]);
  });

  it("drive the perform layer's punches, and its hue turns the colours", () => {
    const layer = performLayer(90);
    const links = layer.effects.flatMap((e) => Object.values(e.links ?? {}));
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) expect(link.signal).toMatchObject({ source: { kind: "track", trackId: PADS_TRACK } });
    expect(layer.effects.find((e) => e.type === "hue-saturation")?.params.hue).toBe(90);
    expect(performLayer(270).effects.find((e) => e.type === "hue-saturation")?.params.hue).toBe(-90);
  });
});
