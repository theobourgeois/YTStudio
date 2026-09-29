import { describe, expect, it } from "vitest";
import { defaultEffects, textEffects } from "./effects.ts";
import {
  canMoveFolder,
  flattenFolders,
  folderPath,
  folderSubtree,
  itemMediaIds,
  libraryItemCover,
  normalizeTemplate,
  placeTemplate,
  recentItems,
  remapTemplateAssets,
  searchItems,
  templateDuration,
  templateFromClips,
} from "./library.ts";
import { MAIN_TRACK_ID, addTrack, createDefaultProject, getTrack } from "./timeline.ts";
import type { Clip, ClipTemplate, LibraryFolder, LibraryItem, MediaAsset, Project, Track } from "./types.ts";

const folder = (id: string, parentId: string | null, name = id): LibraryFolder => ({ id, name, parentId, createdAt: 0 });

function clip(id: string, trackId: string, start: number, dur: number, extra: Partial<Clip> = {}): Clip {
  return { id, assetId: "v", trackId, start, in: 0, out: dur, effects: defaultEffects(), ...extra };
}

const asset = (id: string, kind: MediaAsset["kind"], duration = 10) =>
  ({
    id, kind, duration, hasVideo: kind !== "audio", hasAudio: kind !== "image", poster: `/${id}.jpg`,
  }) as MediaAsset;

const ASSETS = { v: asset("v", "video"), logo: asset("logo", "image"), sfx: asset("sfx", "audio", 2) };

const item = (id: string, extra: Partial<LibraryItem> = {}): LibraryItem =>
  ({ id, name: id, folderId: null, createdAt: 0, usedAt: null, favorite: false, kind: "media", mediaId: "v", ...extra }) as LibraryItem;

const video = (id: string): Track => ({ id, kind: "video", name: id, muted: false });
const audio = (id: string): Track => ({ id, kind: "audio", name: id, muted: false });

describe("folders", () => {
  const folders = [folder("a", null), folder("b", "a"), folder("c", "b"), folder("d", null)];

  it("finds a folder's path and subtree", () => {
    expect(folderPath(folders, "c").map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(folderPath(folders, null)).toEqual([]);
    expect(folderPath(folders, "nope")).toEqual([]);
    expect([...folderSubtree(folders, "a")].sort()).toEqual(["a", "b", "c"]);
    expect([...folderSubtree(folders, "d")]).toEqual(["d"]);
  });

  it("survives a loop in the tree", () => {
    const looped = [folder("x", "y"), folder("y", "x")];
    expect(folderPath(looped, "x").map((f) => f.id)).toEqual(["y", "x"]);
  });

  it("won't move a folder into itself", () => {
    expect(canMoveFolder(folders, "a", "c")).toBe(false);
    expect(canMoveFolder(folders, "a", "a")).toBe(false);
    expect(canMoveFolder(folders, "c", "d")).toBe(true);
    expect(canMoveFolder(folders, "c", null)).toBe(true);
  });

  it("flattens the tree in order, A to Z", () => {
    const tree = [folder("z", null, "Zed"), folder("s", "z", "Sub"), folder("a", null, "Alpha")];
    expect(flattenFolders(tree).map(({ folder, depth }) => `${depth}${folder.name}`)).toEqual(["0Alpha", "0Zed", "1Sub"]);
  });
});

describe("saved clips", () => {
  /** A logo over a video with a whoosh under it, from 4s. */
  function source(): Project {
    const p = addTrack(createDefaultProject(), "video").project;
    const top = p.tracks[0].id;
    return {
      ...p,
      clips: [
        clip("vid", MAIN_TRACK_ID, 4, 3, { transitionIn: { type: "cross-dissolve", duration: 0.5, alignment: "center", params: {} } }),
        clip("logo", top, 5, 1, { assetId: "logo" }),
        clip("sfx", "audio_1", 4.5, 1, { assetId: "sfx" }),
        clip("other", MAIN_TRACK_ID, 0, 2),
      ],
    };
  }

  it("takes the selected clips and their tracks, then starts them at 0", () => {
    const p = source();
    const raw = templateFromClips(p, ["vid", "logo", "sfx"]);
    expect(raw.tracks.map((t) => t.id)).toEqual([p.tracks[0].id, MAIN_TRACK_ID, "audio_1"]);
    const t = normalizeTemplate(raw, ASSETS)!;
    expect(t.clips.map((c) => [c.id, c.start])).toEqual([["vid", 0], ["sfx", 0.5], ["logo", 1]]);
    expect(t.clips[0].transitionIn?.type).toBe("cross-dissolve");
    expect(templateDuration(t)).toBe(3);
  });

  it("drops clips whose media is unknown, and returns null when none is left", () => {
    const p = source();
    const t = normalizeTemplate(templateFromClips(p, ["vid", "logo"]), { v: ASSETS.v })!;
    expect(t.clips.map((c) => c.id)).toEqual(["vid"]);
    expect(t.tracks.map((tr) => tr.id)).toEqual([MAIN_TRACK_ID]);
    expect(normalizeTemplate(templateFromClips(p, ["logo"]), {})).toBeNull();
    expect(normalizeTemplate({ tracks: "x", clips: null } as unknown as ClipTemplate, ASSETS)).toBeNull();
  });

  it("keeps text clips, which have no media", () => {
    const text = clip("t", MAIN_TRACK_ID, 2, 2, { assetId: "", effects: [...defaultEffects(), ...textEffects({ text: "Hi" })] });
    const t = normalizeTemplate({ tracks: [video(MAIN_TRACK_ID)], clips: [text] }, {})!;
    expect(t.clips).toHaveLength(1);
    expect(t.clips[0].start).toBe(0);
  });

  it("lists and remaps the media it uses", () => {
    const t = normalizeTemplate(templateFromClips(source(), ["vid", "logo", "sfx"]), ASSETS)!;
    const it = item("i", { kind: "clips", template: t } as Partial<LibraryItem>);
    expect(itemMediaIds(it).sort()).toEqual(["logo", "sfx", "v"]);
    const remapped = remapTemplateAssets(t, new Map([["v", "v2"], ["sfx", "s2"]]));
    expect(remapped.clips.map((c) => c.assetId).sort()).toEqual(["logo", "s2", "v2"]);
  });

  it("shows the bottom picture as the cover", () => {
    const t = normalizeTemplate(templateFromClips(source(), ["vid", "logo", "sfx"]), ASSETS)!;
    const media = new Map(Object.entries(ASSETS));
    expect(libraryItemCover(item("i", { kind: "clips", template: t } as Partial<LibraryItem>), media)?.id).toBe("v");
    expect(libraryItemCover(item("j", { mediaId: "sfx" }), media)?.id).toBe("sfx");
  });
});

describe("placeTemplate", () => {
  const template: ClipTemplate = {
    tracks: [video("T1"), video("T2"), audio("TA")],
    clips: [clip("logo", "T1", 1, 1, { assetId: "logo" }), clip("vid", "T2", 0, 3), clip("sfx", "TA", 0.5, 1, { assetId: "sfx" })],
  };

  const placed = (p: Project, ids: string[]) =>
    ids.map((id) => {
      const c = p.clips.find((x) => x.id === id)!;
      return [c.assetId, p.tracks.findIndex((t) => t.id === c.trackId), c.start];
    });

  it("keeps the timing and the track order, on existing tracks when they're free", () => {
    const p = addTrack(createDefaultProject(), "video").project; // [V2, V1(main), A1]
    const res = placeTemplate(p, template, { at: 10 });
    expect(res.project.tracks).toHaveLength(3);
    expect(placed(res.project, res.clipIds)).toEqual([
      ["logo", 0, 11],
      ["v", 1, 10],
      ["sfx", 2, 10.5],
    ]);
    expect(new Set(res.clipIds).size).toBe(3);
    expect(res.clipIds).not.toContain("logo");
  });

  it("adds tracks on top when the top ones are busy", () => {
    let p = createDefaultProject(); // [V1, A1]
    p = { ...p, clips: [clip("busy", MAIN_TRACK_ID, 0, 20)] };
    const res = placeTemplate(p, template, { at: 2 });
    // Two new video tracks on top, in the template's order; the audio track is free.
    expect(res.project.tracks.map((t) => t.kind)).toEqual(["video", "video", "video", "audio"]);
    expect(placed(res.project, res.clipIds)).toEqual([
      ["logo", 0, 3],
      ["v", 1, 2],
      ["sfx", 3, 2.5],
    ]);
  });

  it("uses the track it's dropped on, or new tracks above it", () => {
    const p = addTrack(createDefaultProject(), "video").project; // [V2, V1(main), A1]
    const single: ClipTemplate = { tracks: [video("T")], clips: [clip("vid", "T", 0, 2)] };
    let res = placeTemplate(p, single, { at: 0, trackId: MAIN_TRACK_ID });
    expect(getTrack(res.project, res.project.clips[0].trackId)?.id).toBe(MAIN_TRACK_ID);

    const busy = { ...p, clips: [clip("busy", MAIN_TRACK_ID, 0, 5)] };
    res = placeTemplate(busy, single, { at: 1, trackId: MAIN_TRACK_ID });
    const index = res.project.tracks.findIndex((t) => t.id === res.project.clips.at(-1)!.trackId);
    expect(res.project.tracks).toHaveLength(4);
    expect(res.project.tracks[index + 1].id).toBe(MAIN_TRACK_ID);

    res = placeTemplate(p, single, { at: 0, newTrack: "above" });
    expect(res.project.tracks).toHaveLength(4);
    expect(res.project.tracks.findIndex((t) => t.id === res.project.clips.at(-1)!.trackId)).toBe(0);
  });

  it("puts sound on the first free audio track, else a new one at the bottom", () => {
    let p = addTrack(createDefaultProject(), "audio").project; // [V1, A1, A2]
    const sfx: ClipTemplate = { tracks: [audio("TA")], clips: [clip("sfx", "TA", 0, 1, { assetId: "sfx" })] };
    p = { ...p, clips: [clip("music", "audio_1", 0, 10, { assetId: "sfx" })] };
    let res = placeTemplate(p, sfx, { at: 3 });
    expect(res.project.tracks.findIndex((t) => t.id === res.project.clips.at(-1)!.trackId)).toBe(2);

    p = { ...p, clips: [...p.clips, clip("music2", p.tracks[2].id, 0, 10, { assetId: "sfx" })] };
    res = placeTemplate(p, sfx, { at: 3 });
    expect(res.project.tracks).toHaveLength(4);
    expect(res.project.tracks.findIndex((t) => t.id === res.project.clips.at(-1)!.trackId)).toBe(3);
  });
});

describe("browsing", () => {
  it("searches names by every word, prefix matches first", () => {
    const items = [item("Big whoosh"), item("whoosh_short"), item("Logo white"), item("swoosh")];
    expect(searchItems(items, "whoosh").map((i) => i.name)).toEqual(["whoosh_short", "Big whoosh"]);
    expect(searchItems(items, "white logo").map((i) => i.name)).toEqual(["Logo white"]);
    expect(searchItems(items, "  ")).toBe(items);
  });

  it("lists recently used items, newest first", () => {
    const items = [item("a", { usedAt: 5 }), item("b"), item("c", { usedAt: 9 })];
    expect(recentItems(items).map((i) => i.id)).toEqual(["c", "a"]);
  });
});
