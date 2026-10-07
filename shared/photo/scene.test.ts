import { describe, expect, it } from "vitest";
import { addFilter, addImageLayer, moveLayersBy, setCompositing } from "./edits.ts";
import { createPhotoProject } from "./project.ts";
import { applyKernel } from "./reference/kernel.ts";
import { KERNEL_REFERENCES } from "./reference/filters/index.ts";
import { type SceneNeed, type SourceFacts, compileRender, isContentNode } from "./render-plan.ts";
import { type Affine, DEPTH_SIDE, IDENTITY, type SceneMaps, composeAffine, invertAffine, SCENE_HEADER, SCENE_PARAM, depthInput, depthInputSize, depthMap, guidedFilter, packScene, sceneAt, sceneGrid, sceneOf, sceneSpacing, standInDepth } from "./scene.ts";

const maps = (width: number, height: number, spacing: number, depth: (i: number, j: number) => number, subject: ((i: number, j: number) => number) | null = null): SceneMaps => ({
  id: "m",
  width,
  height,
  spacing,
  depth: Float32Array.from({ length: width * height }, (_, k) => depth(k % width, Math.floor(k / width))),
  subject: subject && Float32Array.from({ length: width * height }, (_, k) => subject(k % width, Math.floor(k / width))),
});

describe("the scene maps' grid", () => {
  it("is at most 1024 cells long, in power-of-two document pixels", () => {
    expect(sceneSpacing({ width: 800, height: 600 })).toBe(1);
    expect(sceneSpacing({ width: 6000, height: 4000 })).toBe(8);
    expect(sceneGrid({ width: 6000, height: 4000 })).toEqual({ width: 750, height: 500, spacing: 8 });
    expect(sceneGrid({ width: 1025, height: 10 })).toEqual({ width: 513, height: 5, spacing: 2 });
  });

  it("reads bilinear between cell centres, held at the edges, and 0 for a map it hasn't", () => {
    const m = maps(4, 2, 10, (i) => i / 3);
    expect(sceneAt(m, 5, 5)[0]).toBeCloseTo(0);
    expect(sceneAt(m, 10, 5)[0]).toBeCloseTo(0.5 / 3);
    expect(sceneAt(m, 15, 5)[0]).toBeCloseTo(1 / 3);
    expect(sceneAt(m, 35, 15)[0]).toBeCloseTo(1);
    expect(sceneAt(m, -100, -100)[0]).toBeCloseTo(0);
    expect(sceneAt(m, 1000, 1000)[0]).toBeCloseTo(1);
    expect(sceneAt(m, 15, 5)[1]).toBe(0);
    expect(sceneAt(null, 1, 1)).toEqual([0, 0]);
  });

  it("packs a header and each cell's depth and subject for the GPU", () => {
    const packed = packScene(maps(2, 1, 4, (i) => i, (i) => 1 - i));
    expect(Array.from(packed.subarray(0, SCENE_HEADER))).toEqual([2, 1, 4, 3]);
    expect(Array.from(packed.subarray(SCENE_HEADER))).toEqual([0, 1, 1, 0]);
  });
});

describe("the depth model's input and answer", () => {
  it("keeps the picture's shape, its short side 518, both sides multiples of 14", () => {
    expect(depthInputSize(1600, 900)).toEqual({ width: 924, height: DEPTH_SIDE });
    expect(depthInputSize(600, 1200)).toEqual({ width: DEPTH_SIDE, height: 1036 });
    expect(depthInputSize(500, 500)).toEqual({ width: DEPTH_SIDE, height: DEPTH_SIDE });
    const input = depthInput({ width: 40, height: 20, scale: 1, data: new Uint8ClampedArray(40 * 20 * 4).fill(255) });
    expect(input.width % 14).toBe(0);
    // White normalised as ImageNet's.
    expect(input.data[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
  });

  it("makes its range 0..1, nearest 1, and follows the picture's edges", () => {
    const grid = { width: 64, height: 32 };
    // A picture split down the middle; a depth that changes softly across it.
    const picture = { width: 64, height: 32, scale: 1, data: new Uint8ClampedArray(64 * 32 * 4) };
    for (let k = 0; k < 64 * 32; k++) picture.data.set(k % 64 < 32 ? [20, 20, 20, 255] : [230, 230, 230, 255], k * 4);
    const values = Float32Array.from({ length: 64 * 32 }, (_, k) => 1 / (1 + Math.exp(-((k % 64) - 32) / 6)));
    const depth = depthMap(values, 64, 32, picture, grid);
    expect(Math.min(...depth)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...depth)).toBeLessThanOrEqual(1);
    // Sharper at the picture's edge than the model's answer was.
    const step = (d: ArrayLike<number>) => d[16 * 64 + 33] - d[16 * 64 + 30];
    expect(step(depth)).toBeGreaterThan(step(values) * 1.2);
  });

  it("the guided filter leaves a flat map flat", () => {
    const guide = Float64Array.from({ length: 100 }, (_, k) => (k * 37) % 11);
    const flat = new Float64Array(100).fill(0.4);
    for (const v of guidedFilter(guide, flat, 10, 10, 2, 1e-3)) expect(v).toBeCloseTo(0.4, 6);
  });

  it("the stand-in is nearer lower down and on the subject", () => {
    const grid = { width: 4, height: 4 };
    const { values } = standInDepth(grid, Float32Array.from({ length: 16 }, (_, k) => (k === 5 ? 1 : 0)));
    expect(values[12]).toBeGreaterThan(values[0]);
    expect(values[5]).toBeGreaterThan(values[4]);
  });
});

describe("scene maps in the plan", () => {
  const sources = new Map<string, SourceFacts>([["m_a", { width: 400, height: 200, bits: 8 }]]);
  const base = () => addImageLayer(setCompositing(createPhotoProject("P", { width: 800, height: 600 }), "linear"), { id: "a", mediaId: "m_a", name: "a", size: { width: 400, height: 200 } });
  const withFilter = (applyTo: string) => addFilter(base(), "a", { id: "f", type: "posterize", params: { applyTo } });
  const filtersOf = (plan: ReturnType<typeof compileRender>) => plan.nodes.filter(isContentNode).flatMap((n) => n.filters);

  it("leaves a filter that reads them out until they're made, then hands them in by its key", () => {
    const asked: SceneNeed[] = [];
    const none = compileRender(withFilter("background"), sources, { scene: (need) => (asked.push(need), null) });
    expect(filtersOf(none)).toEqual([]);
    expect(asked).toMatchObject([{ layerId: "a", filterId: "f", reads: { depth: false, subject: true } }]);
    const m = maps(800, 600, 1, () => 0.5, () => 1);
    const drawn = compileRender(withFilter("background"), sources, { scene: () => m });
    expect(sceneOf(filtersOf(drawn)[0].params)).toBe(m);
    expect(drawn.key).not.toBe(compileRender(withFilter("background"), sources, { scene: () => ({ ...m, id: "other" }) }).key);
    // Everything: no maps asked for.
    const plain: SceneNeed[] = [];
    expect(filtersOf(compileRender(withFilter("all"), sources, { scene: (need) => (plain.push(need), null) }))).toHaveLength(1);
    expect(plain).toEqual([]);
  });

  it("Apply To changes the subject or the background alone", () => {
    const canvas = { width: 8, height: 2 };
    const image = { width: 8, height: 2, data: Float64Array.from({ length: 64 }, (_, k) => (k % 4 === 3 ? 1 : ((k * 7) % 10) / 10)) };
    // The subject is the right half.
    const m = maps(8, 2, 1, () => 0, (i) => (i >= 4 ? 1 : 0));
    const params = { levels: 2, smooth: 0, mix: 100 };
    const all = applyKernel(KERNEL_REFERENCES.posterize, image, { ...params, applyTo: "all" }, canvas, undefined, m);
    const subject = applyKernel(KERNEL_REFERENCES.posterize, image, { ...params, applyTo: "subject" }, canvas, undefined, m);
    const background = applyKernel(KERNEL_REFERENCES.posterize, image, { ...params, applyTo: "background" }, canvas, undefined, m);
    for (let k = 0; k < 64; k++) {
      const right = Math.floor(k / 4) % 8 >= 4;
      expect(subject.data[k]).toBeCloseTo(right ? all.data[k] : image.data[k]);
      expect(background.data[k]).toBeCloseTo(right ? image.data[k] : all.data[k]);
    }
    expect(SCENE_PARAM).toBe("__scene");
  });
});

describe("scene maps read through a move", () => {
  it("reads where a point was when they were made", () => {
    const m = maps(4, 2, 10, (i) => i / 3);
    // The layer moved 10 px right since: the point 10 px right of where something was reads what was there.
    const moved = { ...m, place: [1, 0, 0, 1, -10, 0] as const };
    expect(sceneAt(moved, 25, 5)[0]).toBeCloseTo(sceneAt(m, 15, 5)[0]);
    const turned: Affine = [0, 1, -1, 0, 3, 7];
    const back = composeAffine(turned, invertAffine(turned));
    back.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i]));
  });

  it("a moved layer keeps its picture's key; only its placement changes", () => {
    const sources = new Map<string, SourceFacts>([["m_a", { width: 400, height: 200, bits: 8 }]]);
    const base = addFilter(
      addImageLayer(setCompositing(createPhotoProject("P", { width: 800, height: 600 }), "linear"), { id: "a", mediaId: "m_a", name: "a", size: { width: 400, height: 200 } }),
      "a",
      { id: "f", type: "fog", params: {} },
    );
    const needs: SceneNeed[] = [];
    compileRender(base, sources, { scene: (n) => (needs.push(n), null) });
    compileRender(moveLayersBy(base, ["a"], 30, 10), sources, { scene: (n) => (needs.push(n), null) });
    expect(needs[1].inputKey).toBe(needs[0].inputKey);
    expect(needs[1].placement[4] - needs[0].placement[4]).toBeCloseTo(30);
    expect(needs[1].placement[5] - needs[0].placement[5]).toBeCloseTo(10);
  });
});

describe("scene maps kept on disk", () => {
  it("round-trips a map to 16 bits, and refuses one of another grid", async () => {
    const { encodeSceneMap, decodeSceneMap } = await import("./scene.ts");
    const grid = { width: 3, height: 2, spacing: 4 };
    const values = Float32Array.from([0, 0.25, 0.5, 0.75, 1, 0.123]);
    const bytes = encodeSceneMap(grid, values);
    const back = decodeSceneMap(bytes.slice().buffer, grid)!;
    back.forEach((v, i) => expect(v).toBeCloseTo(values[i], 4));
    expect(decodeSceneMap(bytes.slice().buffer, { ...grid, spacing: 8 })).toBeNull();
    expect(decodeSceneMap(new ArrayBuffer(8), grid)).toBeNull();
  });
});
