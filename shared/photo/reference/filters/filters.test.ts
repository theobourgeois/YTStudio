import { describe, expect, it } from "vitest";
import { FILTER_ENTRIES, entryParams } from "../../effects/catalog.ts";
import { isKernelFilter, validateParams } from "../../effects/index.ts";
import type { FloatImage } from "../glow.ts";
import { applyKernel } from "../kernel.ts";
import { type SceneMaps, sceneGrid } from "../../scene.ts";
import { KERNEL_REFERENCES } from "./index.ts";

const CANVAS = { width: 96, height: 72 };

/** A test picture: gradients, hard edges, a few lights above white, and transparency (premultiplied linear). */
function picture(seed = 1): FloatImage {
  const { width, height } = CANVAS;
  const data = new Float64Array(width * height * 4);
  let s = seed;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      const a = x > 84 ? 0 : x > 76 ? (84 - x) / 8 : 1;
      let rgb = [x / width, y / height, ((x >> 3) + (y >> 3)) & 1 ? 0.8 : 0.1];
      if (next() < 0.02) rgb = [3, 2.5, 1.5];
      data.set([rgb[0] * a, rgb[1] * a, rgb[2] * a, a], k);
    }
  }
  return { width, height, data };
}

/**
 * The test picture's scene maps (docs/photo/effects/scene-maps.md): nearer lower down and on a soft ellipse, the
 * subject, a little right of the middle.
 */
function testMaps(): SceneMaps {
  const { width, height, spacing } = sceneGrid(CANVAS);
  const subject = new Float32Array(width * height);
  const depth = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = ((i + 0.5) * spacing) / CANVAS.width;
      const y = ((j + 0.5) * spacing) / CANVAS.height;
      const s = Math.min(1, Math.max(0, (1 - Math.hypot((x - 0.55) / 0.22, (y - 0.5) / 0.35)) * 4));
      subject[j * width + i] = s;
      depth[j * width + i] = Math.min(1, 0.15 + 0.5 * y + 0.35 * s);
    }
  }
  return { id: "test", width, height, spacing, depth, subject };
}
const MAPS = testMaps();

const KERNEL_ENTRIES = FILTER_ENTRIES.filter((e) => isKernelFilter(e.def.type));
/** The maps a filter gets with these settings: the test picture's when it reads any. */
const mapsFor = (e: (typeof KERNEL_ENTRIES)[number], params: Record<string, unknown>) => (e.def.scene?.(params as never) ? MAPS : null);
const full = (e: (typeof KERNEL_ENTRIES)[number], mix?: number) => validateParams(e.def, { ...entryParams(e, CANVAS), ...(mix === undefined ? {} : { mix }) }).params;

describe("the kernel filters' references", () => {
  it("has a reference for every kernel filter, and presets for each", () => {
    const types = [...new Set(KERNEL_ENTRIES.map((e) => e.def.type))];
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) expect(KERNEL_REFERENCES[t], t).toBeTypeOf("function");
  });

  it.each(KERNEL_ENTRIES.map((e) => [e.key, e] as const))("%s: Mix 0 changes nothing; every value is finite; it changes the picture", (_key, e) => {
    const image = picture();
    const reference = KERNEL_REFERENCES[e.def.type];
    const unchanged = applyKernel(reference, image, full(e, 0), CANVAS, undefined, mapsFor(e, full(e, 0)));
    expect(Array.from(unchanged.data)).toEqual(Array.from(image.data));
    const out = applyKernel(reference, image, full(e), CANVAS, undefined, mapsFor(e, full(e)));
    expect(Array.from(out.data).every(Number.isFinite)).toBe(true);
    // Coverage stays a coverage.
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBeGreaterThanOrEqual(-1e-9);
    let changed = 0;
    for (let i = 0; i < out.data.length; i++) changed = Math.max(changed, Math.abs(out.data[i] - image.data[i]));
    expect(changed).toBeGreaterThan(0.01);
  });

  it.each(KERNEL_ENTRIES.map((e) => [e.key, e] as const))("%s: a point reads nothing past the filter's reach, and the same picture gives the same result", (_key, e) => {
    const params = full(e);
    const reach = e.def.reach(params);
    const reference = KERNEL_REFERENCES[e.def.type];
    const image = picture();
    const maps = mapsFor(e, params);
    const out = applyKernel(reference, image, params, CANVAS, undefined, maps);
    // The same again: nothing random but what's seeded.
    expect(Array.from(applyKernel(reference, image, params, CANVAS, undefined, maps).data)).toEqual(Array.from(out.data));
    // Everything farther than its reach (in either axis) from a probe pixel changed: the probe isn't.
    const probe = { x: 40, y: 30 };
    const changed = picture(99);
    for (let y = 0; y < CANVAS.height; y++)
      for (let x = 0; x < CANVAS.width; x++) {
        const near = Math.abs(x + 0.5 - (probe.x + 0.5)) <= reach + 1 && Math.abs(y + 0.5 - (probe.y + 0.5)) <= reach + 1;
        if (near) continue;
        const k = (y * CANVAS.width + x) * 4;
        changed.data.set([0.3, 0.9, 0.1, 1], k);
      }
    for (let y = 0; y < CANVAS.height; y++)
      for (let x = 0; x < CANVAS.width; x++) {
        if (Math.abs(x - probe.x) > reach + 1 || Math.abs(y - probe.y) > reach + 1) continue;
        const k = (y * CANVAS.width + x) * 4;
        changed.data.set(image.data.subarray(k, k + 4), k);
      }
    const again = applyKernel(reference, changed, params, CANVAS, undefined, maps);
    const k = (probe.y * CANVAS.width + probe.x) * 4;
    expect(Array.from(again.data.subarray(k, k + 4))).toEqual(Array.from(out.data.subarray(k, k + 4)));
  });
});
