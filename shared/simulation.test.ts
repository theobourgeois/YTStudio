import { describe, expect, it } from "vitest";
import { addEffect, definitionOf } from "./effects.ts";
import { effectPasses } from "./effect-gl.ts";
import { normalizeProject } from "./normalize.ts";
import { demoScene, sceneSpec } from "./scenes/index.ts";
import { CHECKPOINT_EVERY, frameSourceTime, simulationFrame, simulationVersion, steppedState } from "./simulation.ts";
import { createDefaultProject, newLayerClip } from "./timeline.ts";
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
  const SCENES = ["tesseract", "singularity", "cathedral", "leviathan"];

  it("each has a definition with a scene, and a state stepped in TypeScript", () => {
    for (const type of SCENES) {
      const { clip } = solidWith(type);
      const def = definitionOf(clip.effects.find((e) => e.type === type)!)!;
      expect(def.shader?.scene, type).toBe(type);
      expect(sceneSpec(type), type).toBeDefined();
    }
  });

  it("a frame's state is the same reached in order or straight away, and plain JSON", () => {
    for (const type of SCENES) {
      const values = { detail: 0.5, speed: 1, reactivity: 0.8 };
      const straight = JSON.stringify(demoScene(type, values, `straight-${type}`, 90, 30));
      for (let f = 0; f <= 90; f++) demoScene(type, values, `ordered-${type}`, f, 30);
      const ordered = JSON.stringify(demoScene(type, values, `ordered-${type}`, 90, 30));
      expect(ordered.replace(`ordered-${type}`, ""), type).toBe(straight.replace(`straight-${type}`, ""));
      expect(JSON.parse(straight).state.time, type).toBeGreaterThan(0);
    }
  });

  it("a clip's scene reacts to hits: they step its state (the tesseract's shockwaves)", () => {
    const shockwaves = (f: number) => (demoScene("tesseract", { detail: 0.5 }, "hits", f, 30)!.state.shockwaves as number[]).length;
    // The made-up sound beats at 120 BPM: by two seconds in, waves have gone out.
    expect(Math.max(...[20, 40, 60].map(shockwaves))).toBeGreaterThan(0);
  });
});
