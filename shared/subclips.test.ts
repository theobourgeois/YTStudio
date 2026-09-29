import { describe, expect, it } from "vitest";
import { normalizeProject } from "./normalize.ts";
import {
  addSubclips,
  nextSubclipName,
  normalizeSubclips,
  removeSubclips,
  subclipRange,
  subclipsByAsset,
  updateSubclip,
} from "./subclips.ts";
import { createDefaultProject, removeAssetClips } from "./timeline.ts";
import type { MediaAsset } from "./types.ts";

const video = { id: "m1", name: "Interview.final.mp4", kind: "video", duration: 540 } as const;
const still = { id: "m2", name: "logo.png", kind: "image", duration: 5 } as const;

describe("subclips", () => {
  it("makes numbered parts of a file, skipping ones too short to be a clip", () => {
    const { project, ids } = addSubclips(createDefaultProject(), video, [
      { in: 12, out: 45.5 },
      { in: 100, out: 100.01 },
      { in: 600, out: 500, name: "  The   ending " },
      { in: 50, out: 60 },
    ]);
    expect(ids).toHaveLength(3);
    expect(project.subclips!.map((s) => [s.name, s.in, s.out])).toEqual([
      ["Interview.final 1", 12, 45.5],
      ["The ending", 500, 540],
      ["Interview.final 2", 50, 60],
    ]);
    expect(subclipsByAsset(project).get("m1")!.map((s) => s.id)).toEqual(ids);
    // Numbers carry on from the names taken, and stills have none.
    expect(nextSubclipName(project, video)).toBe("Interview.final 3");
    expect(addSubclips(project, still, [{ in: 0, out: 1 }]).project).toBe(project);
  });

  it("renames, moves and removes them, returning the same project when nothing changes", () => {
    const { project, ids } = addSubclips(createDefaultProject(), video, [{ in: 10, out: 20 }]);
    const [id] = ids;
    expect(updateSubclip(project, id, { name: "   " }, 540)).toBe(project);
    expect(updateSubclip(project, id, { in: 10, out: 20 }, 540)).toBe(project);
    expect(updateSubclip(project, "nope", { name: "x" }, 540)).toBe(project);
    // A range too short to be a clip keeps the old one.
    expect(updateSubclip(project, id, { out: 10.02 }, 540)).toBe(project);
    const moved = updateSubclip(project, id, { name: "Hook", out: 900 }, 540);
    expect(moved.subclips).toEqual([{ id, assetId: "m1", name: "Hook", in: 10, out: 540 }]);
    expect(removeSubclips(moved, ["other"])).toBe(moved);
    expect(removeSubclips(moved, [id]).subclips).toBeUndefined();
  });

  it("goes when its file is deleted", () => {
    const { project } = addSubclips(createDefaultProject(), video, [{ in: 1, out: 2 }]);
    expect(removeAssetClips(project, "other")).toBe(project);
    expect(removeAssetClips(project, "m1").subclips).toBeUndefined();
  });

  it("orders a range and keeps it inside the file", () => {
    expect(subclipRange(8, 3, 5)).toEqual({ in: 3, out: 5 });
    expect(subclipRange(-2, 1, 5)).toEqual({ in: 0, out: 1 });
    expect(subclipRange(4.99, 6, 5)).toBeNull();
    expect(subclipRange(Number.NaN, 1, 5)).toBeNull();
  });

  it("is validated on load, against the media when it's known", () => {
    const saved = [
      { id: "s1", assetId: "m1", name: "Good", in: 1, out: 2 },
      { id: "s1", assetId: "m1", name: "Duplicate", in: 1, out: 2 },
      { id: "s2", assetId: "m1", name: "", in: 530, out: 999 },
      { id: "s3", assetId: "m2", name: "Still", in: 0, out: 1 },
      { id: "s4", assetId: "gone", name: "Gone", in: 0, out: 1 },
      { id: "s5", assetId: "m1", in: "x", out: 2 },
      null,
    ];
    const assets = { m1: video, m2: still } as unknown as Record<string, MediaAsset>;
    expect(normalizeSubclips(saved, assets)).toEqual([
      { id: "s1", assetId: "m1", name: "Good", in: 1, out: 2 },
      { id: "s2", assetId: "m1", name: "Subclip", in: 530, out: 540 },
    ]);
    // Without the media, anything shaped like one stays.
    expect(normalizeSubclips(saved).map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
    const project = normalizeProject({ ...createDefaultProject(), subclips: saved as never }, { ...assets });
    expect(project.subclips?.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(normalizeProject(createDefaultProject())).not.toHaveProperty("subclips");
  });
});
