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
const at = (x: number): SceneNeed => ({ inputKey: "content", layerId: "a", filterId: "f", reads: { depth: true, subject: false }, placement: [1, 0, 0, 1, x, 0], size: null });

describe("SceneMapStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const store = (disk = new Map<string, Uint8Array>()) => {
    const renders: number[] = [];
    const maps = new SceneMapStore({
      settled: async () => {},
      renderFloats: async (_doc, view) => {
        renders.push(view.width);
        return new Float32Array(view.width * view.height * 4).fill(0.5);
      },
      built: () => {},
      loadMap: async (key) => {
        const bytes = disk.get(key);
        return bytes ? (bytes.slice().buffer as ArrayBuffer) : null;
      },
      saveMap: async (key, data) => void disk.set(key, data),
    });
    return { maps, renders, disk };
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

  /** An image layer's need: its maps made of its own 40 × 20 pixels, the layer moved to `x`. */
  const own = (x: number): SceneNeed => ({ ...at(x), size: { width: 40, height: 20 } });

  it("makes an image layer's maps of its own pixels once: moved, it reads them through the move and never makes them again", async () => {
    const { maps, renders } = store();
    const first = await maps.build(own(0), doc);
    // Its grid is the layer's.
    expect([first?.width, first?.height]).toEqual([40, 20]);
    expect(renders).toEqual([40]);
    for (let x = 1; x <= 20; x++) {
      const missing: SceneNeed[] = [];
      const shown = maps.resolver(doc, { build: true, missing })(own(x));
      // A document point to the layer's pixels: where it is now, undone.
      expect(shown?.place).toEqual([1, 0, 0, 1, -x, 0]);
      // Exact wherever it is: nothing waits for other maps, nothing is made.
      expect(missing).toEqual([]);
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect(renders).toEqual([40]);
  });

  it("keeps the maps it makes in the package, and reads them back rather than running the models again", async () => {
    // The stand-in models' maps aren't kept: here the "model" is real but never runs, the maps come from disk.
    const disk = new Map<string, Uint8Array>();
    const { maps: first } = store(disk);
    await first.build(own(0), doc);
    expect(disk.size).toBe(0);
    // A session with the real model keeps them: put one there as it would, then open the photo again.
    const { encodeSceneMap, sceneGrid } = await import("@shared/photo/scene.ts");
    const grid = sceneGrid({ width: 40, height: 20 });
    const values = Float32Array.from({ length: grid.width * grid.height }, (_, i) => (i % 40) / 40);
    const probe = store(new Map());
    const keyOf = (probe.maps as unknown as { cacheKey: (p: string, a: number[], m: string) => string }).cacheKey.bind(probe.maps);
    const reopened = store(new Map([[keyOf("content@layer 40x20", [1, 0, 0, 1, 0, 0], "depth"), encodeSceneMap(grid, values)]]));
    const read = await reopened.maps.build(own(0), doc);
    expect(reopened.renders).toEqual([]);
    expect(read?.depth?.[39]).toBeCloseTo(39 / 40, 4);
  });
});
