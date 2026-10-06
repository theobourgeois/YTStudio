/**
 * The Online panel's server side against the stand-in internet (`online-stand-in.ts`) and the real helper: what
 * each source's answer becomes, a pasted page's pictures, and placing (an icon drawn at its size and colour, a
 * picture whose original won't come taken from the search engine's copy, a GIF made a PNG).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MediaAsset } from "../../shared/types.ts";
import { HttpError } from "../storage.ts";
import { PhotoHelper } from "./helper.ts";
import { bingResults, decodeEntities, iconResults, iconShapes, iconSvg, pagePictures, pageTitle, PhotoOnline, placeRequestOf } from "./online.ts";
import { standInFetch } from "./online-stand-in.ts";

const HELPER = path.join(import.meta.dirname, "helper-process.mjs");
let dir: string;
let helper: PhotoHelper;
let adopted: { file: string; name: string; origin: string; bytes: Buffer }[] = [];
let online: PhotoOnline;
let fetched: string[] = [];

const recording: typeof fetch = async (input, init) => {
  fetched.push(String(input));
  return standInFetch(input, init);
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-online-"));
  helper = new PhotoHelper(HELPER);
  let n = 0;
  online = new PhotoOnline(helper, {
    tmpFile: (suffix) => path.join(dir, `tmp-${n++}${suffix}`),
    adopt: async (_projectId, file, name, origin) => {
      adopted.push({ file, name, origin, bytes: await fs.readFile(file) });
      return { id: `media_${adopted.length}`, name } as MediaAsset;
    },
    fetch: recording,
  });
});
afterAll(async () => {
  helper.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const reset = () => {
  adopted = [];
  fetched = [];
};

describe("search", () => {
  it("finds icons, with each set's name and whether it has colours of its own", async () => {
    const found = await online.search("icons", "bell");
    expect(found.results.map((r) => r.id)).toEqual(["mdi:bell", "mdi:bell-outline", "tabler:bell", "twemoji:bell"]);
    expect(found.results[0]).toMatchObject({ source: "icons", title: "bell", set: "Material Design Icons" });
    expect(decodeURIComponent(found.results[0].thumb)).toMatch(/^data:image\/svg\+xml;utf8,<svg .*viewBox="0 0 24 24"><circle .*fill="currentColor"/);
    expect(found.results[0].palette).toBeUndefined();
    expect(found.results[3].palette).toBe(true);
    expect(found.next).toBeNull();
  });

  it("asks for each set's shapes once, and keeps them", async () => {
    reset();
    await online.search("icons", "star");
    expect(fetched.filter((u) => u.includes(".json")).sort()).toEqual([
      "https://api.iconify.design/mdi.json?icons=star,star-outline",
      "https://api.iconify.design/tabler.json?icons=star",
      "https://api.iconify.design/twemoji.json?icons=star",
    ]);
    reset();
    await online.search("icons", "star");
    expect(fetched.filter((u) => u.includes(".json"))).toEqual([]);
  });

  it("reads a set's shapes: offsets, flips, turns and aliases", () => {
    const shapes = iconShapes(
      { width: 24, height: 16, icons: { a: { body: "<path/>" }, b: { body: "<rect/>", width: 10, left: 2 } }, aliases: { c: { parent: "a", rotate: 1 }, d: { parent: "c", hFlip: true } } },
      ["a", "b", "c", "d", "missing"],
    );
    expect(shapes.get("a")).toEqual({ body: "<path/>", width: 24, height: 16 });
    expect(shapes.get("b")).toEqual({ body: '<g transform="translate(-2 0)"><rect/></g>', width: 10, height: 16 });
    expect(shapes.get("c")).toEqual({ body: '<g transform="translate(16 0) rotate(90)"><path/></g>', width: 16, height: 24 });
    expect(shapes.get("d")!.body).toBe('<g transform="translate(16 0) scale(-1 1)"><g transform="translate(16 0) rotate(90)"><path/></g></g>');
    expect(shapes.has("missing")).toBe(false);
    expect(iconSvg({ body: '<path fill="currentColor"/>', width: 24, height: 12 }, 300, "#ff0000")).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="300" height="150" viewBox="0 0 24 12"><path fill="#ff0000"/></svg>',
    );
  });

  it("says when a source is limiting requests", async () => {
    const limited = new PhotoOnline(helper, { tmpFile: (s) => path.join(dir, `l${s}`), adopt: async () => ({}) as MediaAsset, fetch: async () => new Response("", { status: 429, headers: { "retry-after": "243" } }) });
    await expect(limited.search("icons", "bell")).rejects.toThrow("api.iconify.design is limiting how often this computer asks it: try again in 5 minutes.");
  });

  it("pages icons while a page comes back full", () => {
    const icons = Array.from({ length: 120 }, (_, i) => `mdi:icon-${i}`);
    expect(iconResults({ icons, total: 120 }, 0).next).toBe(1);
    expect(iconResults({ icons: icons.slice(0, 7), total: 127 }, 120).next).toBeNull();
    expect(iconResults({ icons: ["bad name", "mdi:ok"] }, 0).results.map((r) => r.id)).toEqual(["mdi:ok"]);
  });

  it("reads the web's results, each with its search engine's copy to fall back on", async () => {
    reset();
    const found = await online.search("web", "bell icon", 0, "transparent");
    expect(fetched[0]).toContain("qft=%2Bfilterui%3Aphoto-transparent");
    expect(found.results).toHaveLength(3);
    expect(found.results[0]).toMatchObject({ source: "web", id: "https://images.stand-in/bell-icon-1.svg", title: "bell icon picture 1", page: "https://pages.stand-in/bell-icon-1" });
    expect(found.results[0].fallback).toMatch(/^https:\/\/thumbs\.stand-in\/th\?id=bell-icon-1&w=1600&h=1600/);
  });

  it("parses Bing's attributes: entities decoded, repeats and broken ones dropped", () => {
    const m = (o: object) => `m="${JSON.stringify(o).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
    const html = [
      m({ murl: "https://a.example/1.png", turl: "https://t.example/1", t: "Tom &amp; <b>Jerry</b>" }),
      m({ murl: "https://a.example/1.png", turl: "https://t.example/1b" }),
      m({ murl: "javascript:alert(1)", turl: "https://t.example/2" }),
      `m="{not json}"`,
    ].join(" ");
    const results = bingResults(html);
    expect(results.map((r) => r.id)).toEqual(["https://a.example/1.png"]);
    expect(results[0].title).toBe("Tom & Jerry");
    expect(decodeEntities("&#x41;&#66;&quot;&unknown;")).toBe('AB"&unknown;');
  });

  it("finds free photos with their licence and author", async () => {
    const found = await online.search("photos", "bell");
    expect(found.results[0]).toMatchObject({ source: "photos", width: 640, height: 640, license: "CC BY 4.0", credit: "Stand-in" });
  });

  it("reads a link's pictures, what the page is about first", async () => {
    const found = await online.search("web", "https://pages.stand-in/somewhere");
    expect(found.results.map((r) => r.id)).toEqual(["https://images.stand-in/og.svg", "https://pages.stand-in/one.svg", "https://images.stand-in/two.svg"]);
    expect(found.results[0]).toMatchObject({ source: "link", title: "Stand-in page 1" });
  });

  it("takes the largest of a srcset, skips spacers and data URLs, and resolves relative addresses", () => {
    const html = `<meta content="/og.png" property="og:image"><img src="data:image/png;base64,AAA"><img src="/spacer.gif" width="1"><img data-src="lazy.jpg"><img srcset="a.jpg 320w, b.jpg 1280w, c.jpg 640w"><link rel="image_src" href="https://x.example/i.png">`;
    expect(pagePictures(html, "https://site.example/dir/page")).toEqual([
      "https://site.example/og.png",
      "https://x.example/i.png",
      "https://site.example/dir/lazy.jpg",
      "https://site.example/dir/b.jpg",
    ]);
    expect(pageTitle("<title>A &amp; B</title>")).toBe("A & B");
  });

  it("says which source failed", async () => {
    const failing = new PhotoOnline(helper, { tmpFile: (s) => path.join(dir, `x${s}`), adopt: async () => ({}) as MediaAsset, fetch: async () => new Response("no", { status: 503 }) });
    await expect(failing.search("photos", "bell")).rejects.toThrow(/Couldn't search Openverse: api\.openverse\.org answered 503/);
    expect(await failing.search("icons", "   ")).toEqual({ results: [], next: null });
  });
});

describe("place", () => {
  it("draws an icon at its size, in its colour", async () => {
    reset();
    await online.place("p", { source: "icons", id: "mdi:ring", size: 300, colour: "#FF0000" });
    expect(fetched).toEqual(["https://api.iconify.design/mdi.json?icons=ring"]);
    const [{ name, origin, bytes }] = adopted;
    expect(name).toBe("ring.png");
    expect(origin).toBe("online:icon:mdi:ring:300:#ff0000");
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([300, 300, 4]);
    const centre = (150 * 300 + 150) * 4;
    expect([...data.subarray(centre, centre + 3)]).toEqual([255, 0, 0]);
    expect(data[3]).toBe(0);
  });

  it("falls back on the search engine's copy when the original won't come", async () => {
    reset();
    const [, missing] = (await online.search("web", "bell")).results;
    await online.place("p", missing);
    expect(fetched.slice(-2).map((u) => new URL(u).hostname)).toEqual(["images.stand-in", "thumbs.stand-in"]);
    expect(adopted[0].name).toBe("bell picture 2.png");
    expect((await sharp(adopted[0].bytes).metadata()).format).toBe("png");
  });

  it("keeps a PNG, JPEG or WebP as it came, and makes a GIF a PNG", async () => {
    reset();
    const gif = await sharp({ create: { width: 8, height: 4, channels: 3, background: "#00ff00" } }).gif().toBuffer();
    const jpeg = await sharp({ create: { width: 8, height: 4, channels: 3, background: "#00ff00" } }).jpeg().toBuffer();
    const serving = new PhotoOnline(helper, {
      tmpFile: (suffix) => path.join(dir, `serve-${Math.random()}${suffix}`),
      adopt: async (_p, file, name, origin) => {
        adopted.push({ file, name, origin, bytes: await fs.readFile(file) });
        return {} as MediaAsset;
      },
      fetch: async (input) => (String(input).endsWith(".gif") ? new Response(gif, { headers: { "content-type": "image/gif" } }) : new Response(jpeg, { headers: { "content-type": "image/jpeg" } })),
    });
    await serving.place("p", { source: "web", id: "https://a.example/anim.gif" });
    await serving.place("p", { source: "web", id: "https://a.example/photo.jpg", title: "A photo" });
    expect(adopted.map((a) => a.name)).toEqual(["anim.png", "A photo.jpg"]);
    expect((await sharp(adopted[0].bytes).metadata()).format).toBe("png");
    expect(adopted[1].bytes.equals(jpeg)).toBe(true);
  });

  it("refuses what isn't a picture", async () => {
    const page = new PhotoOnline(helper, { tmpFile: (s) => path.join(dir, `p${s}`), adopt: async () => ({}) as MediaAsset, fetch: async () => new Response("<html>", { headers: { "content-type": "text/html" } }) });
    await expect(page.place("p", { source: "web", id: "https://a.example/page" })).rejects.toThrow(/it's text\/html, not a picture/);
  });

  it("checks what it's asked", () => {
    expect(() => placeRequestOf({ source: "icons", id: "../etc/passwd" })).toThrow(HttpError);
    expect(() => placeRequestOf({ source: "icons", id: "mdi:bell", size: 10_000 })).toThrow(/size must be 16 to 4096/);
    expect(() => placeRequestOf({ source: "icons", id: "mdi:bell", colour: "red" })).toThrow(/#rrggbb/);
    expect(() => placeRequestOf({ source: "web", id: "file:///etc/passwd" })).toThrow(/Only http and https/);
    expect(() => placeRequestOf({ source: "nope", id: "x" })).toThrow(/source must be/);
    expect(placeRequestOf({ source: "icons", id: "mdi:bell", size: 64.4, colour: "#ABCDEF" })).toEqual({ source: "icons", id: "mdi:bell", size: 64, colour: "#abcdef" });
  });
});
