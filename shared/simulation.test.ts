import { describe, expect, it } from "vitest";
import { addEffect, definitionOf } from "./effects.ts";
import { effectPasses } from "./effect-gl.ts";
import { normalizeProject } from "./normalize.ts";
import { demoScene, sceneSpec } from "./scenes/index.ts";
import { CHECKPOINT_EVERY, frameSourceTime, simulationFrame, simulationVersion, steppedState } from "./simulation.ts";
import { createDefaultProject, newLayerClip } from "./timeline.ts";
import { ridgeHeight } from "./scenes/ridgeline.ts";
import { CLEAR_OF_CLUSTERS, WEB_CELL, webNear } from "./scenes/cosmic-web.ts";
import type { UniformValue } from "./transition-gl.ts";
import type { Clip, Project } from "./types.ts";

function solidWith(type: string): { project: Project; clip: Clip } {
  const main = createDefaultProject();
  const clip = { ...newLayerClip("solid", 2, 6), trackId: main.tracks[0].id };
  const project = addEffect(normalizeProject({ ...main, clips: [clip] }, {}), [clip.id], type).project;
  return { project, clip: project.clips[0] };
}

describe("steppedState", () => {
  /** A state that remembers every frame it was stepped through. */
  const run = (owner: object, frame: number) =>
    steppedState(
      owner,
      "sum",
      "v1",
      frame,
      () => ({ sum: 0, steps: 0 }),
      (s, k) => {
        s.sum += k;
        s.steps += 1;
      },
      (s) => ({ ...s }),
    );

  it("is the steps from the start, whatever order frames are asked for", () => {
    const owner = {};
    const expected = (f: number) => ({ sum: (f * (f + 1)) / 2, steps: f + 1 });
    for (const f of [100, 3, 64, 64, 65, 0, 31]) expect({ ...run(owner, f) }).toEqual(expected(f));
  });

  it("goes back from the nearest checkpoint, not from the start", () => {
    const owner = {};
    let stepped = 0;
    const step = (frame: number) =>
      steppedState(owner, "count", "v", frame, () => ({ n: 0 }), (s) => {
        s.n++;
        stepped++;
      }, (s) => ({ ...s }));
    step(200);
    stepped = 0;
    expect(step(2 * CHECKPOINT_EVERY + 5).n).toBe(2 * CHECKPOINT_EVERY + 6);
    expect(stepped).toBe(5);
  });

  it("starts again when what it's made from changes", () => {
    const owner = {};
    const at = (version: string) => steppedState(owner, "k", version, 10, () => ({ v: version, n: 0 }), (s) => void s.n++, (s) => ({ ...s }));
    expect(at("a").v).toBe("a");
    expect(at("b")).toEqual({ v: "b", n: 11 });
  });
});

describe("a clip's frames", () => {
  it("count from its start at the sequence's rate, and back to source time", () => {
    const { clip } = solidWith("feedback");
    expect(simulationFrame(clip, frameSourceTime(clip, 0, 30), 30)).toBe(0);
    expect(simulationFrame(clip, frameSourceTime(clip, 47, 30), 30)).toBe(47);
    expect(simulationFrame(clip, frameSourceTime(clip, 47, 24), 24)).toBe(47);
  });

  it("a simulation's pass says its frame, its version and how far back it remembers", () => {
    const { clip } = solidWith("feedback");
    const feedback = effectPasses(clip, frameSourceTime(clip, 12, 30), 30).find((pass) => pass.simulation);
    expect(feedback!.simulation).toMatchObject({ id: `${clip.id}/feedback`, frame: 12, fps: 30, version: simulationVersion(clip, 30) });
    // Trail Length 0.5 s falls to 1/255 in log10(255) times as long: about 1.3 s, 39 frames at 30 fps.
    expect(feedback!.simulation!.memory).toBeGreaterThan(30);
    expect(feedback!.simulation!.memory).toBeLessThan(50);
  });

  it("a clip changed is a new version; the same clip again (or a copy) is the same", () => {
    const { clip } = solidWith("feedback");
    expect(simulationVersion({ ...clip }, 30)).toBe(simulationVersion(clip, 30));
    expect(simulationVersion({ ...clip, start: 3 }, 30)).not.toBe(simulationVersion(clip, 30));
    expect(simulationVersion(clip, 25)).not.toBe(simulationVersion(clip, 30));
  });
});

describe("3D scenes", () => {
  const SCENES = ["ridgeline", "infinite-dive", "aurora", "storm-sea", "ferrofluid", "event-horizon", "neon-city", "nebula", "abyss", "monoliths", "cyberspace", "wormhole", "galaxy", "cosmic-web", "collider"];
  const uniform = (u: UniformValue[] | null, name: string) => u?.find((v) => v.name === name)?.value;

  it("each has a definition with a scene, and a state stepped in TypeScript", () => {
    for (const type of SCENES) {
      const { clip } = solidWith(type);
      const def = definitionOf(clip.effects.find((e) => e.type === type)!)!;
      expect(def.shader?.scene, type).toBe(type);
      expect(sceneSpec(type), type).toBeDefined();
    }
  });

  it("a frame's uniforms are the same reached in order or straight away", () => {
    for (const type of SCENES) {
      const values = { speed: 1, reactivity: 1 };
      const straight = demoScene(type, values, `straight-${type}`, 150, 30);
      for (let f = 0; f <= 150; f++) demoScene(type, values, `ordered-${type}`, f, 30);
      const ordered = demoScene(type, values, `ordered-${type}`, 150, 30);
      expect(ordered, type).toEqual(straight);
      // Every scene places its camera, and has moved it.
      expect(uniform(straight, "camPos"), type).not.toEqual(uniform(demoScene(type, values, `start-${type}`, 0, 30), "camPos"));
    }
  });

  it("the camera never goes into the mountains (Ridgeline mirrors its terrain in float32)", () => {
    for (let f = 0; f <= 1800; f += 15) {
      const [x, y, z] = uniform(demoScene("ridgeline", { speed: 1, reactivity: 1 }, "terrain", f, 30), "camPos") as number[];
      expect(y, `frame ${f}`).toBeGreaterThan(ridgeHeight(x, z, 9) + 15);
    }
  });

  it("Infinite Dive's camera stays within one level as it falls, so the fall never runs out of precision", () => {
    for (let f = 0; f <= 3600; f += 37) {
      const pos = uniform(demoScene("infinite-dive", { speed: 1, reactivity: 1 }, "dive", f, 30), "camPos") as number[];
      const r = Math.hypot(pos[0], pos[1], pos[2]);
      expect(r).toBeGreaterThan(0.9 / 2.4 - 1e-6);
      expect(r).toBeLessThanOrEqual(2.4);
    }
    // ...while its level keeps counting down.
    expect(uniform(demoScene("infinite-dive", { speed: 1, reactivity: 1 }, "dive", 3600, 30), "idLevel") as number).toBeGreaterThan(10);
  });

  it("Cosmic Web's camera flies beside its filaments and never through a cluster (TypeScript mirrors the web)", () => {
    for (let f = 0; f <= 3600; f += 23) {
      const pos = uniform(demoScene("cosmic-web", { speed: 1, reactivity: 1 }, "web", f, 30), "camPos") as number[];
      const cell = pos.map((v) => Math.floor(v / WEB_CELL)) as [number, number, number];
      const nearest = Math.min(...webNear(cell, 1).nodes.map((n) => Math.hypot(n[0] - pos[0], n[1] - pos[1], n[2] - pos[2])));
      expect(nearest, `frame ${f}`).toBeGreaterThan(CLEAR_OF_CLUSTERS - 1e-3);
    }
  });

  it("each hit starts a collision in Collider", () => {
    const live = (f: number) =>
      [0, 1, 2, 3].filter((k) => (uniform(demoScene("collider", { speed: 1, reactivity: 1 }, "collisions", f, 30), `coEv${k}`) as number[])[2] > 0).length;
    // The made-up sound beats at 120 BPM from its first frame, so one starts at once and soon several overlap.
    expect(live(0)).toBeGreaterThan(0);
    expect(live(60)).toBeGreaterThan(1);
  });

  it("hits set things off in the state (Storm Sea's lightning)", () => {
    const lit = (f: number) => (uniform(demoScene("storm-sea", { weather: "storm" }, "hits", f, 30), "ssFlash0") as number[])[3];
    // The made-up sound beats at 120 BPM: within a second a flash has struck.
    expect(Math.max(...Array.from({ length: 30 }, (_, f) => lit(f + 1)))).toBeGreaterThan(0.2);
  });
});
