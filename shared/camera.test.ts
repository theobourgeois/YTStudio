import { describe, expect, it } from "vitest";
import { cameraAt, cameraFrom, defaultCamera, defocus, projectLayer } from "./camera.ts";
import { placePoint } from "./compositor.ts";
import { cameraEffects, defaultEffects, motionAt, setParams } from "./effects.ts";
import { sortByDepth } from "./layers.ts";
import { MAIN_TRACK_ID, createDefaultProject } from "./timeline.ts";
import { type Placement, placeClip, placementAffine } from "./transform.ts";
import type { Clip, Project } from "./types.ts";

const canvas = { width: 1080, height: 1920 };
const motion = (extra: Partial<ReturnType<typeof motionAt>> = {}) => ({
  fit: "contain" as const,
  position: [0.5, 0.5] as [number, number],
  scaleX: 0.5,
  scaleY: 0.5,
  rotation: 10,
  anchor: [0.5, 0.5] as [number, number],
  threeD: true,
  z: 0,
  rotationX: 0,
  rotationY: 0,
  ...extra,
});
const place = (m: ReturnType<typeof motion>): Placement => placeClip(canvas, { width: 1920, height: 1080 }, m);
const corners = (t: Parameters<typeof placePoint>[0]) => ([[0, 0], [1, 0], [0, 1], [1, 1]] as const).map(([u, v]) => placePoint(t, u, v));

describe("3D layers", () => {
  it("show at depth 0 through the default camera exactly as in 2D", () => {
    const m = motion();
    const { matrix, depth } = projectLayer(place(m), m, canvas, defaultCamera(canvas));
    const flat = placementAffine(place(m), canvas);
    corners(matrix).forEach((c, i) => {
      const f = corners(flat as never)[i]!;
      expect(c![0]).toBeCloseTo(f[0], 6);
      expect(c![1]).toBeCloseTo(f[1], 6);
    });
    expect(depth).toBeGreaterThan(0);
  });

  it("get smaller further away, and bigger nearer", () => {
    const width = (z: number) => {
      const m = motion({ rotation: 0, z });
      const [a, b] = corners(projectLayer(place(m), m, canvas, defaultCamera(canvas)).matrix);
      return b![0] - a![0];
    };
    expect(width(1000)).toBeLessThan(width(0) * 0.8);
    expect(width(-500)).toBeGreaterThan(width(0) * 1.2);
  });

  it("turn about Y in perspective: the near edge grows, the far edge shrinks", () => {
    const m = motion({ rotation: 0, rotationY: 50 });
    const [tl, tr, bl, br] = corners(projectLayer(place(m), m, canvas, defaultCamera(canvas)).matrix);
    const left = bl![1] - tl![1];
    const right = br![1] - tr![1];
    expect(Math.abs(left - right)).toBeGreaterThan(0.01);
    // Narrower than flat.
    expect(tr![0] - tl![0]).toBeLessThan(0.5 * (1920 / 1080) * (1080 / 1080) * 0.99);
  });

  it("are seen through the topmost camera clip under the playhead, orbiting its point of interest", () => {
    const cam = (id: string, trackId: string, params = {}): Clip => ({
      id, assetId: "", trackId, start: 0, in: 0, out: 5, effects: cameraEffects(params),
    });
    const base = createDefaultProject();
    const project: Project = {
      ...base,
      tracks: [{ id: "top", kind: "video", name: "Video 2", muted: false }, ...base.tracks],
      clips: [cam("low", MAIN_TRACK_ID, { orbitY: 90 }), cam("high", "top", { distance: 2 })],
    };
    const c = cameraAt(project, 1, canvas);
    expect(c.position[2]).toBeCloseTo(defaultCamera(canvas).position[2] * 2);
    expect(cameraAt(project, 6, canvas)).toEqual(defaultCamera(canvas));
    const orbit = cameraFrom(
      { angleOfView: 40, pointOfInterest: [0.5, 0.5], interestZ: 0, distance: 1, orbitX: 0, orbitY: 90, roll: 0, depthOfField: false, focusDistance: 1, aperture: 0 },
      canvas,
    );
    // Swung a quarter turn about Y: looking along +x or -x at the same height.
    expect(orbit.position[1]).toBeCloseTo(960);
    expect(Math.abs(orbit.position[0] - 540)).toBeGreaterThan(1000);
    expect(orbit.position[2]).toBeCloseTo(0, 3);
  });

  it("blur away from the focus with depth of field", () => {
    const c = { ...defaultCamera(canvas), aperture: 40 };
    expect(defocus(c, c.focus, canvas)).toBeCloseTo(0);
    expect(defocus(c, c.focus * 2, canvas)).toBeGreaterThan(0);
    expect(defocus(defaultCamera(canvas), 5000, canvas)).toBe(0);
  });

  it("are drawn far first when on neighbouring tracks; 2D layers keep their place", () => {
    const layers = [{ id: "a", d: 100 }, { id: "b", d: 900 }, { id: "flat" }, { id: "c", d: 5 }, { id: "e", d: 50 }];
    expect(sortByDepth(layers, (l) => ("d" in l ? l.d : undefined)).map((l) => l.id)).toEqual(["b", "a", "flat", "e", "c"]);
  });

  it("switch on from Motion's 3D Layer", () => {
    const clip: Clip = { id: "c", assetId: "a", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 1, effects: defaultEffects() };
    const p = setParams({ ...createDefaultProject(), clips: [clip] }, "c", "motion", { threeD: true, positionZ: 300, rotationY: 30 });
    expect(motionAt(p.clips[0], 0)).toMatchObject({ threeD: true, z: 300, rotationY: 30 });
  });
});
