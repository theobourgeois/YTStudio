/**
 * The Online panel's server side (docs/photo/online.md): searches Iconify's open-source icons, Bing's image search
 * and Openverse's Creative Commons photos, reads a pasted link for its pictures (gallery-dl when it's installed,
 * else the page's own), and downloads a result into a project's media, made a picture the editor places (the
 * helper draws SVGs and takes the first frame of anything animated). Nothing here needs a key.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  ICON_NAME_RE,
  ICON_SIZES,
  type OnlinePlaceRequest,
  type OnlineResult,
  type OnlineSearch,
  type OnlineSource,
  type WebFilter,
  WEB_FILTERS,
  isLink,
  onlineLayerName,
} from "../../shared/photo/online.ts";
import type { MediaAsset } from "../../shared/types.ts";
import { errorMessage } from "../../shared/errors.ts";
import { run } from "../process.ts";
import { HttpError } from "../storage.ts";
import type { PhotoHelper } from "./helper.ts";

export const ICONIFY = "https://api.iconify.design";
const BING = "https://www.bing.com/images/async";
const OPENVERSE = "https://api.openverse.org/v1/images/";

const ICONS_PER_PAGE = 120;
/** Icons asked for in one request of a set's shapes (its address stays short). */
const ICONS_PER_REQUEST = 60;
const ICON_SET_CONCURRENCY = 4;
const ICON_CACHE_SIZE = 20_000;
const WEB_PER_PAGE = 35;
/** Openverse's most for a request without a key. */
const PHOTOS_PER_PAGE = 20;
const LINK_RESULTS = 60;
const SEARCH_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;
const MAX_QUERY = 200;
/** A browser's: image hosts and Bing answer one, and some refuse anything else. */
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const BING_FILTERS: Record<WebFilter, string> = {
  any: "",
  transparent: "+filterui:photo-transparent",
  clipart: "+filterui:photo-clipart",
  line: "+filterui:photo-linedrawing",
  photo: "+filterui:photo-photo",
};

type Fetch = typeof fetch;

export interface PhotoOnlineOptions {
  /** Where downloads wait before they're the project's (the data folder's tmp). */
  tmpFile(suffix: string): string;
  /**
   * Makes a downloaded file one of a project's images; `origin` says what it was downloaded from, so placing the
   * same result twice reuses the copy already there.
   */
  adopt(projectId: string, file: string, name: string, origin: string): Promise<MediaAsset>;
  /** gallery-dl's command, or null to read pasted links' pages ourselves only. */
  galleryDl?: string | null;
  /** Stands in for the network (tests and the e2e suite: `online-stand-in.ts`). */
  fetch?: Fetch;
  /** What the page is shown for a result's thumbnail (the stand-in's hosts aren't reachable from it). */
  thumb?: (url: string) => string;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export class PhotoOnline {
  private readonly fetch: Fetch;
  /** Icons' shapes by name (null: Iconify doesn't have it), kept: an icon never changes. */
  private readonly iconCache = new Map<string, IconData | null>();

  constructor(
    private readonly helper: Pick<PhotoHelper, "request">,
    private readonly options: PhotoOnlineOptions,
  ) {
    this.fetch = options.fetch ?? fetch;
  }

  /** One page of results for `query` from `source` (a link reads that page's pictures, whatever the source). */
  async search(rawSource: unknown, rawQuery: unknown, rawPage: unknown = 0, rawFilter: unknown = "any"): Promise<OnlineSearch> {
    const source = sourceOf(rawSource);
    const query = text(rawQuery).slice(0, MAX_QUERY);
    const page = Math.max(0, Math.min(50, Math.floor(Number(rawPage) || 0)));
    const filter: WebFilter = (WEB_FILTERS as readonly string[]).includes(text(rawFilter)) ? (text(rawFilter) as WebFilter) : "any";
    if (!query) return { results: [], next: null };
    try {
      const found = await this.find(source, query, page, filter);
      const thumb = this.options.thumb;
      return thumb ? { ...found, results: found.results.map((r) => ({ ...r, thumb: thumb(r.thumb) })) } : found;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, `Couldn't search ${SOURCE_NAMES[source]}: ${errorMessage(error)}`);
    }
  }

  private async find(source: OnlineSource, query: string, page: number, filter: WebFilter): Promise<OnlineSearch> {
    if (source === "link" || isLink(query)) return page === 0 ? { results: await this.readLink(query), next: null } : { results: [], next: null };
    if (source === "icons") return this.icons(query, page);
    if (source === "photos") return this.photos(query, page);
    return this.web(query, page, filter);
  }

  private async icons(query: string, page: number): Promise<OnlineSearch> {
    const start = page * ICONS_PER_PAGE;
    const url = `${ICONIFY}/search?query=${encodeURIComponent(query)}&limit=${ICONS_PER_PAGE}&start=${start}`;
    const found = iconResults((await this.json(url)) as IconifySearch, start);
    // Thumbnails are drawn here from each set's shapes (a request a set, kept), not fetched by the page an icon
    // at a time: Iconify limits how many requests a computer makes.
    const shapes = await this.iconData(found.results.map((r) => r.id));
    const results = found.results.flatMap((r) => {
      const shape = shapes.get(r.id);
      return shape ? [{ ...r, thumb: svgDataUrl(iconSvg(shape)) }] : [];
    });
    return { ...found, results };
  }

  /** Icons' shapes, by name: from the cache, else one request per set for the ones it hasn't. */
  private async iconData(ids: string[]): Promise<Map<string, IconData>> {
    const wanted = new Map<string, string[]>();
    for (const id of ids) {
      if (this.iconCache.has(id)) continue;
      const [prefix, name] = id.split(":");
      wanted.set(prefix, [...(wanted.get(prefix) ?? []), name]);
    }
    const requests = [...wanted].flatMap(([prefix, names]) => chunks(names, ICONS_PER_REQUEST).map((some) => [prefix, some] as const));
    await mapLimited(requests, ICON_SET_CONCURRENCY, async ([prefix, names]) => {
      const body = (await this.json(`${ICONIFY}/${prefix}.json?icons=${names.map(encodeURIComponent).join(",")}`)) as IconifySet;
      const shapes = iconShapes(body, names);
      for (const name of names) this.iconCache.set(`${prefix}:${name}`, shapes.get(name) ?? null);
    });
    if (this.iconCache.size > ICON_CACHE_SIZE) for (const key of [...this.iconCache.keys()].slice(0, this.iconCache.size - ICON_CACHE_SIZE)) this.iconCache.delete(key);
    const found = new Map<string, IconData>();
    for (const id of ids) {
      const shape = this.iconCache.get(id);
      if (shape) found.set(id, shape);
    }
    return found;
  }

  private async web(query: string, page: number, filter: WebFilter): Promise<OnlineSearch> {
    const qft = BING_FILTERS[filter];
    const url = `${BING}?q=${encodeURIComponent(query)}&first=${page * WEB_PER_PAGE + 1}&count=${WEB_PER_PAGE}&adlt=moderate${qft ? `&qft=${encodeURIComponent(qft)}` : ""}`;
    const results = bingResults(await this.text(url));
    return { results, next: results.length >= 10 ? page + 1 : null };
  }

  private async photos(query: string, page: number): Promise<OnlineSearch> {
    const url = `${OPENVERSE}?q=${encodeURIComponent(query)}&page_size=${PHOTOS_PER_PAGE}&page=${page + 1}&mature=false`;
    const body = (await this.json(url)) as OpenverseSearch;
    return openverseResults(body, page);
  }

  /** A pasted link: a picture itself, or the pictures on its page (gallery-dl's reading first, when it's here). */
  private async readLink(raw: string): Promise<OnlineResult[]> {
    const url = linkOf(raw);
    const response = await this.request(url, SEARCH_TIMEOUT_MS);
    const type = response.headers.get("content-type") ?? "";
    if (type.startsWith("image/")) {
      await response.body?.cancel();
      return [{ source: "link", id: url, title: onlineLayerName({ id: url, source: "link" }), thumb: url, page: url }];
    }
    const html = (await response.text()).slice(0, 5_000_000);
    const fromGalleryDl = await this.galleryDl(url);
    const found = fromGalleryDl.length ? fromGalleryDl : pagePictures(html, response.url || url);
    const title = pageTitle(html);
    return found.slice(0, LINK_RESULTS).map((picture, i) => ({
      source: "link",
      id: picture,
      title: title ? (found.length > 1 ? `${title} ${i + 1}` : title) : onlineLayerName({ id: picture, source: "link" }),
      thumb: picture,
      page: url,
    }));
  }

  /** gallery-dl's addresses for a page's pictures (empty when it isn't installed or doesn't know the site). */
  private async galleryDl(url: string): Promise<string[]> {
    const command = this.options.galleryDl;
    if (!command) return [];
    try {
      const out = await run(command, ["--get-urls", "--range", `1-${LINK_RESULTS}`, "--no-colors", url], { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS * 2) });
      return out.split("\n").map((l) => l.trim().replace(/^\| /, "")).filter((l) => /^https?:\/\//.test(l));
    } catch {
      return [];
    }
  }

  /**
   * A result downloaded into the project's media, as a picture the editor places: an icon drawn at `size` in
   * `colour`, anything else as it is (its search engine's copy if the original won't come).
   */
  async place(projectId: string, raw: unknown): Promise<MediaAsset> {
    const request = placeRequestOf(raw);
    const name = onlineLayerName(request);
    let origin: string;
    let file: { path: string };
    if (request.source === "icons") {
      const size = request.size ?? ICON_SIZES.default;
      const shape = (await this.iconData([request.id])).get(request.id);
      if (!shape) throw new HttpError(404, `Iconify has no icon ${request.id}: search for one with the icons source.`);
      file = { path: this.options.tmpFile(".svg") };
      await fs.mkdir(path.dirname(file.path), { recursive: true });
      await fs.writeFile(file.path, iconSvg(shape, size, request.colour));
      origin = `online:icon:${request.id}:${size}:${request.colour ?? ""}`;
    } else {
      const download = [{ url: linkOf(request.id) }];
      if (request.fallback) download.push({ url: linkOf(request.fallback) });
      origin = `online:${request.id}`;
      file = await this.download(download);
    }
    const converted = this.options.tmpFile(".png");
    try {
      const prepared = await this.helper.request<{ format: string; kept: boolean }>("prepare", { file: file.path, out: converted, size: request.source === "icons" ? request.size ?? ICON_SIZES.default : undefined });
      const ext = prepared.format === "jpeg" ? ".jpg" : `.${prepared.format}`;
      const placed = prepared.kept ? file.path : converted;
      return await this.options.adopt(projectId, placed, `${name}${ext}`, origin);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(415, `That picture couldn't be read: ${errorMessage(error)}`);
    } finally {
      await Promise.all([fs.rm(file.path, { force: true }), fs.rm(converted, { force: true })]);
    }
  }

  /** The first of `candidates` that downloads as a picture, into a file of our tmp folder. */
  private async download(candidates: { url: string; referer?: string }[]): Promise<{ path: string }> {
    let failure = "";
    for (const { url } of candidates) {
      try {
        const response = await this.request(url, DOWNLOAD_TIMEOUT_MS, { Referer: new URL(url).origin + "/" });
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (type && !type.startsWith("image/") && type !== "application/octet-stream" && type !== "binary/octet-stream") {
          await response.body?.cancel();
          throw new Error(`it's ${type}, not a picture`);
        }
        const length = Number(response.headers.get("content-length") ?? 0);
        if (length > MAX_DOWNLOAD_BYTES) throw new Error("it's too big");
        const bytes = await readCapped(response, MAX_DOWNLOAD_BYTES);
        if (bytes.length === 0) throw new Error("it's empty");
        const file = this.options.tmpFile(extensionOf(type, url));
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, bytes);
        return { path: file };
      } catch (error) {
        failure = errorMessage(error);
      }
    }
    throw new HttpError(502, `Couldn't download that picture: ${failure}. Try another.`);
  }

  private async request(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<Response> {
    const response = await this.fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9", ...headers },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const host = new URL(url).hostname;
      if (response.status === 429) {
        const wait = Number(response.headers.get("retry-after"));
        throw new HttpError(429, `${host} is limiting how often this computer asks it: try again ${wait > 0 ? `in ${wait < 90 ? `${Math.ceil(wait)} seconds` : `${Math.ceil(wait / 60)} minutes`}` : "in a few minutes"}.`);
      }
      throw new Error(`${host} answered ${response.status}`);
    }
    return response;
  }

  private async json(url: string): Promise<unknown> {
    return (await this.request(url, SEARCH_TIMEOUT_MS, { Accept: "application/json" })).json();
  }

  private async text(url: string): Promise<string> {
    return (await this.request(url, SEARCH_TIMEOUT_MS, { Accept: "text/html,*/*" })).text();
  }
}

const SOURCE_NAMES: Record<OnlineSource, string> = { icons: "Iconify", web: "the web", photos: "Openverse", link: "that link" };

function sourceOf(raw: unknown): OnlineSource {
  const source = text(raw) || "icons";
  if (source === "icons" || source === "web" || source === "photos" || source === "link") return source;
  throw new HttpError(400, "source must be icons, web, photos or link.");
}

/** An http(s) address, or a 400. */
function linkOf(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, `${raw.slice(0, 80)} isn't a link.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "Only http and https links can be read.");
  if (url.href.length > 4096) throw new HttpError(400, "That link is too long.");
  return url.href;
}

/** A place request's fields, checked (bodies are `unknown`). */
export function placeRequestOf(raw: unknown): OnlinePlaceRequest {
  const body = (raw ?? {}) as Record<string, unknown>;
  const source = sourceOf(body.source);
  const id = text(body.id);
  if (!id) throw new HttpError(400, "id is required: a result's id from the search.");
  const request: OnlinePlaceRequest = { source, id, title: text(body.title).slice(0, 200) || undefined };
  if (source === "icons") {
    if (!ICON_NAME_RE.test(id)) throw new HttpError(400, `${id} isn't an icon's name ("mdi:bell").`);
    if (body.size !== undefined) {
      const size = Math.round(Number(body.size));
      if (!Number.isFinite(size) || size < ICON_SIZES.min || size > ICON_SIZES.max) throw new HttpError(400, `size must be ${ICON_SIZES.min} to ${ICON_SIZES.max} pixels.`);
      request.size = size;
    }
    const colour = text(body.colour);
    if (colour) {
      if (!/^#[0-9a-f]{6}$/i.test(colour)) throw new HttpError(400, 'colour must be "#rrggbb".');
      request.colour = colour.toLowerCase();
    }
  } else {
    linkOf(id);
    const fallback = text(body.fallback);
    if (fallback) request.fallback = linkOf(fallback);
  }
  return request;
}

interface IconifySearch {
  icons?: unknown;
  total?: unknown;
  collections?: Record<string, { name?: string; palette?: boolean; license?: { title?: string }; author?: { name?: string } }>;
}

/** Iconify's search answer as results (a page from `start`). */
export function iconResults(body: IconifySearch, start: number): OnlineSearch {
  const icons = Array.isArray(body.icons) ? body.icons.filter((i): i is string => typeof i === "string" && ICON_NAME_RE.test(i)) : [];
  const results = icons.map((id): OnlineResult => {
    const [prefix, name] = id.split(":");
    const set = body.collections?.[prefix];
    return {
      source: "icons",
      id,
      title: name.replace(/[-_]+/g, " "),
      thumb: `${ICONIFY}/${prefix}/${name}.svg`,
      ...(set?.palette ? { palette: true } : {}),
      ...(set?.name ? { set: set.name } : {}),
      ...(set?.license?.title ? { license: set.license.title } : {}),
      ...(set?.author?.name ? { credit: set.author.name } : {}),
    };
  });
  // Iconify's total counts no further than the page asked for: a full page may have more after it.
  return { results, next: icons.length >= ICONS_PER_PAGE ? start / ICONS_PER_PAGE + 1 : null };
}

const ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " " };

/** HTML's character references decoded (what's in an attribute's value). */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1].toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** Bing's image results page: each picture's `m` attribute is JSON (its address, thumbnail, title, page). */
export function bingResults(html: string): OnlineResult[] {
  const results: OnlineResult[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/\bm="(\{[^"]*\})"/g)) {
    let data: { murl?: unknown; turl?: unknown; t?: unknown; purl?: unknown };
    try {
      data = JSON.parse(decodeEntities(match[1]));
    } catch {
      continue;
    }
    const url = text(data.murl);
    const thumb = text(data.turl);
    if (!/^https?:\/\//.test(url) || !/^https?:\/\//.test(thumb) || seen.has(url)) continue;
    seen.add(url);
    const page = text(data.purl);
    results.push({
      source: "web",
      id: url,
      title: decodeEntities(text(data.t)).replace(/<[^>]+>/g, "").slice(0, 120) || onlineLayerName({ id: url, source: "web" }),
      thumb,
      fallback: bingCopy(thumb),
      ...(page ? { page } : {}),
    });
  }
  return results;
}

/** Bing's own copy of a picture, as large as it keeps (for an original whose host won't hand it over). */
function bingCopy(thumb: string): string {
  try {
    const url = new URL(thumb);
    url.searchParams.set("w", "1600");
    url.searchParams.set("h", "1600");
    url.searchParams.set("c", "7");
    return url.href;
  } catch {
    return thumb;
  }
}

interface OpenverseSearch {
  results?: { url?: unknown; thumbnail?: unknown; title?: unknown; width?: unknown; height?: unknown; creator?: unknown; license?: unknown; license_version?: unknown; foreign_landing_url?: unknown }[];
  page_count?: unknown;
}

/** Openverse's answer as results. */
export function openverseResults(body: OpenverseSearch, page: number): OnlineSearch {
  const results: OnlineResult[] = (body.results ?? []).flatMap((r): OnlineResult[] => {
    const url = text(r.url);
    if (!/^https?:\/\//.test(url)) return [];
    const thumb = text(r.thumbnail) || url;
    const license = text(r.license);
    return [
      {
        source: "photos",
        id: url,
        title: text(r.title).slice(0, 120) || onlineLayerName({ id: url, source: "photos" }),
        thumb,
        fallback: thumb !== url ? thumb : undefined,
        ...(typeof r.width === "number" ? { width: r.width } : {}),
        ...(typeof r.height === "number" ? { height: r.height } : {}),
        ...(text(r.creator) ? { credit: text(r.creator) } : {}),
        ...(license ? { license: `CC ${license.toUpperCase()}${text(r.license_version) ? ` ${text(r.license_version)}` : ""}` } : {}),
        ...(text(r.foreign_landing_url) ? { page: text(r.foreign_landing_url) } : {}),
      },
    ];
  });
  const pages = typeof body.page_count === "number" ? body.page_count : 0;
  return { results, next: page + 1 < pages && results.length > 0 ? page + 1 : null };
}

/** A tag's attributes, names lower-cased, values decoded. */
function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

/** The largest candidate of a srcset. */
function largestOfSrcset(srcset: string): string | null {
  let best: { url: string; size: number } | null = null;
  for (const part of srcset.split(/,\s+/)) {
    const [url, descriptor = "1x"] = part.trim().split(/\s+/);
    const size = parseFloat(descriptor) || 1;
    if (url && (!best || size > best.size)) best = { url, size };
  }
  return best?.url ?? null;
}

/**
 * The pictures a page shows, best first: what it says it's about (og:image, twitter:image, image_src), then its
 * images (their largest source), absolute, without data URLs or the same one twice.
 */
export function pagePictures(html: string, base: string): string[] {
  const found: string[] = [];
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    try {
      const url = new URL(raw.trim(), base);
      if ((url.protocol === "http:" || url.protocol === "https:") && !found.includes(url.href)) found.push(url.href);
    } catch {
      // Not an address.
    }
  };
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(tag);
    const key = (a.property ?? a.name ?? "").toLowerCase();
    if (["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"].includes(key)) add(a.content);
  }
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(tag);
    if ((a.rel ?? "").toLowerCase() === "image_src") add(a.href);
  }
  for (const [tag] of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const a = attributes(tag);
    const srcset = a.srcset ?? a["data-srcset"];
    const src = (srcset && largestOfSrcset(srcset)) || a["data-src"] || a["data-original"] || a.src;
    // Spacers and tracking pixels say so.
    if (a.width && Number(a.width) > 0 && Number(a.width) < 48) continue;
    add(src);
  }
  return found;
}

/** A page's title (og:title, else <title>). */
export function pageTitle(html: string): string {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(tag);
    if ((a.property ?? a.name) === "og:title" && a.content?.trim()) return a.content.trim().slice(0, 100);
  }
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  return title ? decodeEntities(title).trim().slice(0, 100) : "";
}

const TYPE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
  "image/tiff": ".tif",
  "image/heic": ".heic",
};

function extensionOf(type: string, url: string): string {
  if (TYPE_EXTENSIONS[type]) return TYPE_EXTENSIONS[type];
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return /^\.(png|jpe?g|webp|gif|svg|avif|tiff?)$/.test(ext) ? ext : ".img";
}

/** A response's body, refusing past `max` bytes. */
async function readCapped(response: Response, max: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new Error("it's too big");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** An icon's shape: its SVG body and the box it's drawn in. */
export interface IconData {
  body: string;
  width: number;
  height: number;
}

interface IconifyIcon {
  body?: unknown;
  width?: unknown;
  height?: unknown;
  left?: unknown;
  top?: unknown;
  rotate?: unknown;
  hFlip?: unknown;
  vFlip?: unknown;
  parent?: unknown;
}

interface IconifySet {
  icons?: Record<string, IconifyIcon>;
  aliases?: Record<string, IconifyIcon>;
  width?: unknown;
  height?: unknown;
  left?: unknown;
  top?: unknown;
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * A set's answer (Iconify's JSON: icons, and aliases of them, turned or flipped) as each named icon's shape, its
 * box moved to the origin.
 */
export function iconShapes(set: IconifySet, names: string[]): Map<string, IconData> {
  const shapes = new Map<string, IconData>();
  const resolve = (name: string, depth = 0): IconData | null => {
    const alias = set.aliases?.[name];
    if (alias && typeof alias.parent === "string" && depth < 5) {
      const parent = resolve(alias.parent, depth + 1);
      return parent && transformed(parent, alias);
    }
    const icon = set.icons?.[name];
    if (!icon || typeof icon.body !== "string") return null;
    const width = num(icon.width, num(set.width, 16));
    const height = num(icon.height, num(set.height, 16));
    const left = num(icon.left, num(set.left, 0));
    const top = num(icon.top, num(set.top, 0));
    const body = left || top ? `<g transform="translate(${-left} ${-top})">${icon.body}</g>` : icon.body;
    return transformed({ body, width, height }, icon);
  };
  for (const name of names) {
    const shape = resolve(name);
    if (shape) shapes.set(name, shape);
  }
  return shapes;
}

/** A shape flipped and turned in quarter turns, as an icon or alias says. */
function transformed(shape: IconData, by: IconifyIcon): IconData {
  let { body, width, height } = shape;
  if (by.hFlip === true || by.vFlip === true) {
    const sx = by.hFlip === true ? -1 : 1;
    const sy = by.vFlip === true ? -1 : 1;
    body = `<g transform="translate(${sx < 0 ? width : 0} ${sy < 0 ? height : 0}) scale(${sx} ${sy})">${body}</g>`;
  }
  const turns = ((Math.round(num(by.rotate, 0)) % 4) + 4) % 4;
  if (turns === 1) body = `<g transform="translate(${height} 0) rotate(90)">${body}</g>`;
  else if (turns === 2) body = `<g transform="translate(${width} ${height}) rotate(180)">${body}</g>`;
  else if (turns === 3) body = `<g transform="translate(0 ${width}) rotate(270)">${body}</g>`;
  if (turns % 2) [width, height] = [height, width];
  return { body, width, height };
}

/** An icon as an SVG file: its longer side `size` (else its own box), one-colour icons in `colour`. */
export function iconSvg(shape: IconData, size?: number, colour?: string): string {
  const scale = size ? size / Math.max(shape.width, shape.height) : 1;
  const w = Math.round(shape.width * scale * 1000) / 1000;
  const h = Math.round(shape.height * scale * 1000) / 1000;
  const body = colour ? shape.body.replaceAll("currentColor", colour) : shape.body;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${shape.width} ${shape.height}">${body}</svg>`;
}

const svgDataUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `task` over `items`, `limit` at a time; the first failure fails it. */
async function mapLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  }));
}
