import { describe, expect, it } from "vitest";
import { setParams } from "./effects.ts";
import { normalizeProject } from "./normalize.ts";
import { applyMatrix, canParent, carryAffine, parentDelta, setParent, uncarryMotion } from "./parenting.ts";
import { MAIN_TRACK_ID, addTrack, createDefaultProject, getClip, newLayerClip, pasteClips, copyClips, removeClips } from "./timeline.ts";
import { placeClip, placementAffine } from "./transform.ts";
import type { Clip, Project, Vec2 } from "./types.ts";

const canvas = { width: 1080, height: 1920 };

/** A null on the top track and a solid below it, both 0..5 s. */
function scene(): { project: Project; nullId: string; childId: string } {
  let p = createDefaultProject();
  const top = addTrack(p, "video", 0);
  p = top.project;
  const nul = { ...newLayerClip("null", 0, 5), trackId: top.trackId } as Clip;
  const child = { ...newLayerClip("solid", 0, 5), trackId: MAIN_TRACK_ID } as Clip;
  return { project: { ...p, clips: [nul, child] }, nullId: nul.id, childId: child.id };
}

const close = (a: Vec2, b: Vec2) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe("parenting", () => {
  it("carries a child by its parent's move from rest", () => {
    const { project, nullId, childId } = scene();
    let p = setParent(project, [childId], nullId, 0, canvas);
    expect(getClip(p, childId)!.parent).toEqual({ id: nullId });
    // A fresh null at rest does nothing.
    expect(parentDelta(p, getClip(p, childId)!, 1, canvas)).toEqual([1, 0, 0, 1, 0, 0]);
    // Moved right by 10% and turned 90° about its anchor (the centre).
    p = setParams(p, nullId, "motion", { position: [0.6, 0.5], rotation: 90 });
    const delta = parentDelta(p, getClip(p, childId)!, 1, canvas)!;
    // The canvas centre goes where the null went; a point right of it swings below.
    close(applyMatrix(delta, [540, 960]), [648, 960]);
    close(applyMatrix(delta, [640, 960]), [648, 1060]);
  });

  it("doesn't move anything when linking to a parent away from rest", () => {
    const { project, nullId, childId } = scene();
    const moved = setParams(project, nullId, "motion", { position: [0.25, 0.25], scale: 2 });
    const p = setParent(moved, [childId], nullId, 0, canvas);
    expect(getClip(p, childId)!.parent?.rest).toEqual({ position: [0.25, 0.25], scale: [2, 2], rotation: 0 });
    const delta = parentDelta(p, getClip(p, childId)!, 0, canvas)!;
    close(applyMatrix(delta, [100, 200]), [100, 200]);
  });

  it("chains parents and refuses loops", () => {
    const { project, nullId, childId } = scene();
    const p = setParent(project, [childId], nullId, 0, canvas);
    expect(canParent(p, nullId, childId)).toBe(false);
    expect(canParent(p, childId, childId)).toBe(false);
    expect(setParent(p, [nullId], childId, 0, canvas)).toBe(p);
    // Grandparent: a second null the first one follows.
    const top = addTrack(p, "video", 0);
    const gp = { ...newLayerClip("null", 0, 5), trackId: top.trackId } as Clip;
    let q = setParent({ ...top.project, clips: [...top.project.clips, gp] }, [nullId], gp.id, 0, canvas);
    q = setParams(q, gp.id, "motion", { position: [0.5, 0.6] });
    close(applyMatrix(parentDelta(q, getClip(q, childId)!, 0, canvas)!, [0, 0]), [0, 192]);
  });

  it("puts a 2D child's picture where the parent carries it", () => {
    const { project, nullId, childId } = scene();
    let p = setParent(project, [childId], nullId, 0, canvas);
    p = setParams(p, nullId, "motion", { scale: 0.5 });
    const child = getClip(p, childId)!;
    const affine = placementAffine(placeClip(canvas, canvas, { fit: "contain", position: [0.5, 0.5], scaleX: 1, scaleY: 1, rotation: 0, anchor: [0.5, 0.5] }), canvas);
    const carried = carryAffine(parentDelta(p, child, 0, canvas)!, affine, canvas);
    // Half the size, still centred.
    expect(carried.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0.5, 0, 0, 0.5, 0.25, 0.25]);
  });

  it("turns a canvas drag back into the child's own values", () => {
    const delta: [number, number, number, number, number, number] = [0, 2, -2, 0, 100, 0]; // turned 90°, doubled, moved
    const local = uncarryMotion({ position: [0.5, 0.5], scale: 3, rotation: 100 }, delta, canvas);
    expect(local.scale).toBeCloseTo(1.5);
    expect(local.rotation).toBeCloseTo(10);
    const [x, y] = local.position as Vec2;
    close(applyMatrix(delta, [x * 1080, y * 1920]), [540, 960]);
  });

  it("keeps a static child where it's seen when unparented", () => {
    const { project, nullId, childId } = scene();
    let p = setParent(project, [childId], nullId, 0, canvas);
    p = setParams(p, nullId, "motion", { position: [0.75, 0.5] });
    p = setParent(p, [childId], null, 0, canvas);
    const child = getClip(p, childId)!;
    expect(child.parent).toBeUndefined();
    expect(child.effects.find((e) => e.type === "motion")!.params.position).toEqual([0.75, 0.5]);
  });

  it("drops links to deleted clips, follows copies, and survives normalising", () => {
    const { project, nullId, childId } = scene();
    const p = setParent(project, [childId], nullId, 0, canvas);
    expect(getClip(removeClips(p, [nullId]), childId)!.parent).toBeUndefined();
    const pasted = pasteClips(p, copyClips(p, [nullId, childId]), 10);
    const [newNull, newChild] = pasted.clipIds.map((id) => getClip(pasted.project, id)!);
    expect(newChild.parent?.id).toBe(newNull.id);
    const normal = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(getClip(normal, childId)!.parent).toEqual({ id: nullId });
    expect(getClip(normal, nullId)!.nullObject).toBe(true);
    const broken = normalizeProject({ ...p, clips: p.clips.map((c) => (c.id === childId ? { ...c, parent: { id: "gone" } } : c)) });
    expect(getClip(broken, childId)!.parent).toBeUndefined();
  });
});
