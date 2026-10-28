import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleGlb } from "../shared/model-file.ts";
import { STARTER_MODELS } from "../shared/model-search.ts";
import { LibraryStore } from "./library.ts";
import { MediaLibrary } from "./media.ts";
import { ModelSearch } from "./model-search.ts";
import { DataPaths, HttpError } from "./storage.ts";
import { ApiKeyStore } from "./transcription/settings.ts";

/** A made-up internet: Poly Pizza's and Sketchfab's APIs as their answers look, and their files. */
function fakeInternet() {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const glb = sampleGlb(["CharacterArmature|Idle", "CharacterArmature|Dance"]);
  const fake: typeof fetch = async (input, init) => {
    const url = String(input);
    asked.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("https://api.poly.pizza/v1.1/search/")) {
      if ((init?.headers as Record<string, string>)["x-auth-token"] !== "pp-key") return json({ error: "no" }, 403);
      return json({
        total: 30,
        results: Array.from({ length: 24 }, (_, i) => ({
          ID: `robot${i}xyz`,
          Title: `Robot ${i}`,
          Creator: { Username: "Quaternius" },
          Licence: "CC0 1.0",
          Thumbnail: `https://static.poly.pizza/robot${i}.webp`,
          Download: `https://static.poly.pizza/robot${i}.glb`,
          "Tri Count": 1200,
          Animated: i % 2 === 0,
        })),
      });
    }
    if (url.startsWith("https://api.sketchfab.com/v3/search")) {
      return json({
        next: "https://api.sketchfab.com/v3/search?cursor=24&q=donut",
        results: [
          {
            uid: "0123456789abcdef0123456789abcdef",
            name: "Donut",
            user: { displayName: "Baker" },
            license: { label: "CC Attribution" },
            faceCount: 5000,
            animationCount: 0,
            viewerUrl: "https://sketchfab.com/3d-models/donut-0123456789abcdef0123456789abcdef",
            archives: { glb: { size: 1000 } },
            thumbnails: { images: [{ url: "https://media.sketchfab.com/big.jpeg", width: 1024 }, { url: "https://media.sketchfab.com/small.jpeg", width: 256 }] },
          },
          { uid: "fffff6789abcdef0123456789abcdef", name: "Huge", archives: { glb: { size: 900 * 2 ** 20 } } },
        ],
      });
    }
    if (url.includes("/download")) {
      if ((init?.headers as Record<string, string>).Authorization !== "Token sf-token") return json({ detail: "no" }, 401);
      return json({ glb: { url: "https://sketchfab-prod-media.s3.amazonaws.com/archives/donut.glb", size: glb.length } });
    }
    if (url.startsWith("https://static.poly.pizza/") || url.startsWith("https://sketchfab-prod-media.s3.amazonaws.com/")) {
      return new Response(url.endsWith(".webp") ? new Uint8Array([1, 2, 3]) : new Uint8Array(glb));
    }
    if (url.startsWith("https://media.sketchfab.com/")) return new Response(new Uint8Array([4, 5, 6]));
    return new Response("not here", { status: 404 });
  };
  return { fake, asked };
}

describe("ModelSearch", () => {
  let root: string;
  let paths: DataPaths;
  let keys: ApiKeyStore;
  let internet: ReturnType<typeof fakeInternet>;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "editor-models-"));
    paths = new DataPaths(root);
    await paths.init();
    keys = new ApiKeyStore(paths.modelKeysFile);
    await keys.load();
    internet = fakeInternet();
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const search = () => new ModelSearch(paths, keys, { fetch: internet.fake });

  it("says which sites need a key, and keeps a pasted one without ever saying it", async () => {
    const models = search();
    expect(models.status().sources).toEqual([
      expect.objectContaining({ source: "poly-pizza", searchable: false, downloadable: false, keySaved: false }),
      expect.objectContaining({ source: "sketchfab", searchable: true, downloadable: false }),
    ]);
    await expect(models.search({ q: "robot", source: "poly-pizza", animated: "", cursor: "" })).rejects.toMatchObject({ status: 412 });
    const status = await models.setKey("poly-pizza", { key: " pp-key " });
    expect(JSON.stringify(status)).not.toContain("pp-key");
    expect(status.sources[0]).toMatchObject({ searchable: true, downloadable: true, keySaved: true });
    // Saved in the data folder, for the next start.
    expect(JSON.parse(await fs.readFile(paths.modelKeysFile, "utf8")).apiKeys["poly-pizza"]).toBe("pp-key");
    await expect(models.setKey("poly-pizza", { key: "has spaces in it" })).rejects.toBeInstanceOf(HttpError);
    await expect(models.setKey("nowhere", { key: "x" })).rejects.toMatchObject({ status: 404 });
  });

  it("an environment's key wins and isn't saved", async () => {
    const models = new ModelSearch(paths, keys, { fetch: internet.fake, environment: { "poly-pizza": "pp-key" } });
    expect(models.status().sources[0]).toMatchObject({ searchable: true, keyFromEnvironment: true, keySaved: false });
  });

  it("searches Poly Pizza a page at a time", async () => {
    await keys.set("poly-pizza", "pp-key");
    const page = await search().search({ q: "dancing robot", source: "poly-pizza", animated: "1", cursor: "" });
    expect(page.results).toHaveLength(24);
    expect(page.results[0]).toMatchObject({ source: "poly-pizza", id: "robot0xyz", title: "Robot 0", author: "Quaternius", animated: true, url: "https://poly.pizza/m/robot0xyz" });
    expect(page.next).toBe("1");
    expect(internet.asked[0].url).toBe("https://api.poly.pizza/v1.1/search/dancing%20robot?Limit=24&Page=0&Animated=1");
    const last = await search().search({ q: "robot", source: "poly-pizza", animated: "", cursor: "1" });
    expect(last.next).toBeNull();
  });

  it("searches Sketchfab without a key, leaving out what's too big", async () => {
    const page = await search().search({ q: "donut", source: "sketchfab", animated: "", cursor: "" });
    expect(page.results.map((r) => r.title)).toEqual(["Donut"]);
    expect(page.results[0]).toMatchObject({ thumbnail: "https://media.sketchfab.com/small.jpeg", licence: "CC Attribution", author: "Baker" });
    expect(page.next).toBe("24");
    await expect(search().search({ q: "  ", source: "sketchfab", animated: "", cursor: "" })).rejects.toMatchObject({ status: 400 });
  });

  it("puts a model in a Library folder once, with its credit and picture", async () => {
    await keys.set("sketchfab", "sf-token");
    const models = search();
    const media = new MediaLibrary(paths, { dir: paths.libraryMedia, url: "/files/library" });
    const projectMedia = new MediaLibrary(paths);
    const library = new LibraryStore(paths, media, projectMedia, () => false);
    await library.load();
    const folder = await library.createFolder({ name: "Visualizer" });
    const [result] = (await models.search({ q: "donut", source: "sketchfab", animated: "", cursor: "" })).results;

    const entry = await library.addModel({ source: "sketchfab", id: result.id, folderId: folder.id }, models);
    const [asset] = entry.media;
    expect(asset).toMatchObject({ kind: "model", name: "Donut", status: "ready", src: `/files/library/${asset.id}/source.glb`, origin: `model:sketchfab:${result.id}` });
    expect(asset.poster).toBe(`/files/library/${asset.id}/poster.jpg`);
    expect(asset.model).toEqual({
      animations: ["CharacterArmature|Idle", "CharacterArmature|Dance"],
      triangles: 12,
      skinned: false,
      credit: { source: "sketchfab", title: "Donut", author: "Baker", licence: "CC Attribution", url: result.url },
    });
    // Asked again (the panel's twice, or the starter pack again): the same item.
    const again = await library.addModel({ source: "sketchfab", id: result.id, folderId: folder.id }, models);
    expect(again.item.id).toBe(entry.item.id);
    expect(media.list()).toHaveLength(1);
    // Nothing's left in tmp.
    expect(await fs.readdir(paths.tmp)).toEqual([]);
    // Never into a project.
    await expect(library.use(entry.item.id, { projectId: "nope" })).rejects.toBeInstanceOf(HttpError);
  });

  it("downloads a starter model with no key at all", async () => {
    const models = search();
    const fetched = await models.download("poly-pizza", STARTER_MODELS[0].id);
    expect(fetched.name).toBe(STARTER_MODELS[0].title);
    expect(internet.asked.map((a) => new URL(a.url).hostname)).toEqual(["static.poly.pizza", "static.poly.pizza"]);
    await fetched.done();
  });

  it("wants Sketchfab's token to download", async () => {
    await expect(search().download("sketchfab", "0123456789abcdef0123456789abcdef")).rejects.toMatchObject({ status: 412 });
  });
});

describe("MediaLibrary's models", () => {
  it("takes a .glb as it is and turns down what isn't one", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "editor-models-"));
    try {
      const paths = new DataPaths(root);
      await paths.init();
      const media = new MediaLibrary(paths, { dir: paths.libraryMedia, url: "/files/library" });
      const file = paths.tmpFile(".bin");
      await fs.writeFile(file, sampleGlb(["Spin"]));
      // Known by its bytes, whatever it's called.
      const asset = await media.add(file, "spinner.bin", null, () => true);
      expect(asset).toMatchObject({ kind: "model", name: "spinner.bin", hasVideo: false, status: "ready", model: { animations: ["Spin"] } });
      expect((await fs.stat(path.join(paths.libraryMedia, asset.id, "source.glb"))).size).toBe(sampleGlb(["Spin"]).length);

      const gltf = paths.tmpFile(".gltf");
      await fs.writeFile(gltf, "{}");
      await expect(media.add(gltf, "scene.gltf", null, () => true)).rejects.toThrow(/save it as one \.glb/);
      const broken = paths.tmpFile(".glb");
      await fs.writeFile(broken, sampleGlb().slice(0, 30));
      await expect(media.add(broken, "broken.glb", null, () => true)).rejects.toMatchObject({ status: 415 });
      const intoProject = paths.tmpFile(".glb");
      await fs.writeFile(intoProject, sampleGlb());
      await expect(media.add(intoProject, "m.glb", "project", () => true)).rejects.toThrow(/for the visualizer/);
      // Compressed in a way the visualizer has no decoder for: said so, not added to fail later.
      const draco = paths.tmpFile(".glb");
      await fs.writeFile(draco, sampleGlb([], ["KHR_draco_mesh_compression"]));
      await expect(media.add(draco, "draco.glb", null, () => true)).rejects.toThrow(/without Draco/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
