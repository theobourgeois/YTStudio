import { createPhotoProject } from "@shared/photo/project.ts";
import type { SceneNeed } from "@shared/photo/render-plan.ts";
import type { PhotoProject } from "@shared/photo/types.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The models' stand-ins: ready at once, nothing run.
vi.mock("../models", () => ({
  modelApi: { status: async () => ({ status: "ready", progress: null, size: 1, error: null, standIn: true }) },
  runModel: async () => {
    throw new Error("the stand-ins run no model");
  },
  useModels: { setState: () => {} },
}));

const { SceneMapStore } = await import("./scene-maps.ts");

/** A photo with a layer whose filter reads the scene (all a build's input needs is the layer and its filter to find). */
const doc: PhotoProject = {
  ...createPhotoProject("Test", { width: 64, height: 32 }),
  layers: [{ kind: "pixel", id: "a", filters: [{ id: "f", type: "fog", enabled: true, params: {} }] } as unknown as PhotoProject["layers"][number]],
};
const at = (x: number): SceneNeed => ({ inputKey: "content", layerId: "a", filterId: "f", reads: { depth: true, subject: false }, placement: [1, 0, 0, 1, x, 0] });

describe("SceneMapStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const store = () => {
    const renders: number[] = [];
    const maps = new SceneMapStore({
      settled: async () => {},
      renderFloats: async (_doc, view) => {
        renders.push(view.width);
        return new Float32Array(view.width * view.height * 4).fill(0.5);
      },
      built: () => {},
    });
    return { maps, renders };
  };

  it("reads a moved layer's maps through the move at once, and makes them again once, after it has stopped", async () => {
    const { maps, renders } = store();
    const first = await maps.build(at(0), doc);
    expect(first?.depth).toBeTruthy();
    expect(renders).toHaveLength(1);
    // A drag: every step is given the maps it had, read through the move; nothing is made meanwhile.
    for (let x = 1; x <= 20; x++) {
      const missing: SceneNeed[] = [];
      const shown = maps.resolver(doc, { build: true, missing })(at(x));
      expect(shown?.place).toEqual([1, 0, 0, 1, -x, 0]);
      expect(shown?.data).toBe(first!.id);
      // Not exact: what's drawn for keeps waits for the maps made where it is.
      expect(missing).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(renders).toHaveLength(1);
    // Stopped: made once, where it is now.
    await vi.advanceTimersByTimeAsync(1000);
    expect(renders).toHaveLength(2);
    const now = maps.resolver(doc)(at(20));
    expect(now?.place).toBeUndefined();
    expect(now?.id).not.toBe(first!.id);
  });

  it("shows a filter its last maps while its changed picture's are made", async () => {
    const { maps, renders } = store();
    const first = await maps.build(at(0), doc);
    const painted = { ...at(0), inputKey: "content painted" };
    const missing: SceneNeed[] = [];
    expect(maps.resolver(doc, { build: true, missing })(painted)?.id).toBe(first!.id);
    expect(missing).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(renders).toHaveLength(2);
    expect(maps.resolver(doc)(painted)?.id).not.toBe(first!.id);
  });
});
