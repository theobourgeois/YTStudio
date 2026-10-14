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
  SWITCHES,
  endShow,
  liveProject,
  lookSequence,
  padSignals,
  performLayer,
  seededRandom,
  showClip,
  switchTransition,
} from "./live-looks.ts";
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
    it(`${look.name}: layers of known effects, in the song's colours`, () => {
      const seq = lookSequence(look, { palette: RED, random: seededRandom(`song:${look.id}`) }, "seq_test");
      expect(seq.tracks.length).toBe(seq.clips.length);
      expect(seq.clips.length).toBeGreaterThan(0);
      for (const clip of seq.clips) {
        expect(clip.out).toBe(FOREVER);
        expect([...new Set(clip.effects.map((e) => e.id))]).toHaveLength(clip.effects.length);
        for (const effect of clip.effects) expect(definitionOf(effect), effect.type).toBeDefined();
        if (clip.assetId) expect(clip.assetId).toBe(COVER_ASSET);
      }
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
