import { createPhotoProject } from "@shared/photo/project.ts";
import type { PhotoProject } from "@shared/photo/types.ts";
import { describe, expect, it } from "vitest";
import { CameraRawAnalyses } from "./camera-raw-analysis.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A photo with a Camera Raw adjustment layer (all an analysis's input needs is the layer to find). */
const doc: PhotoProject = {
  ...createPhotoProject("Test", { width: 64, height: 32 }),
  layers: [{ kind: "adjustment", id: "a" } as unknown as PhotoProject["layers"][number]],
};
const need = { inputKey: "below", layerId: "a", filterId: null };

describe("CameraRawAnalyses", () => {
  it("renders nothing to analyse until the picture is all in, and keeps what it made then", async () => {
    let arrive!: () => void;
    const renders: string[] = [];
    const analyses = new CameraRawAnalyses({
      settled: () => new Promise<void>((resolve) => (arrive = resolve)),
      renderFloats: async (_doc, view) => {
        renders.push(`${view.width}x${view.height}`);
        return new Float32Array(view.width * view.height * 4).fill(0.5);
      },
      built: () => {},
    });
    const built = analyses.build(need, doc);
    await tick();
    // Still loading: an analysis now would be of an empty picture, kept for good.
    expect(renders).toEqual([]);
    expect(analyses.resolver(doc)(need)).toBeNull();
    arrive();
    const analysis = await built;
    expect(renders).toEqual(["64x32"]);
    expect(analysis?.meanTone).toBeGreaterThan(0);
    expect(analyses.resolver(doc)(need)).toBe(analysis);
  });
});
