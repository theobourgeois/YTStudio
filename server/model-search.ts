import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { errorMessage } from "../shared/errors.ts";
import { sampleGlb } from "../shared/model-file.ts";
import { MODEL_SITES, MODEL_SOURCES, isModelSource, modelOrigin, modelPage, starterFile, STARTER_MODELS } from "../shared/model-search.ts";
import type { ModelCredit, ModelResult, ModelSearchPage, ModelSearchStatus, ModelSource } from "../shared/types.ts";
import { MAX_MODEL_BYTES } from "./media.ts";
import { type DataPaths, HttpError, isObject } from "./storage.ts";
import type { ApiKeyStore } from "./transcription/settings.ts";
import { log } from "./log.ts";

const logger = log("models");

const PAGE_SIZE = 24;
const SEARCH_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 3 * 60_000;
const MAX_POSTER_BYTES = 4 * 1024 * 1024;
const MAX_QUERY_LENGTH = 200;
const MAX_KEY_LENGTH = 200;
/** Results remembered (by origin) so adding one doesn't ask the site again. */
const MAX_KNOWN = 1000;
/** Both sites' ids: Poly Pizza's are 10 or 11 characters of base64url, Sketchfab's 32 hex digits. */
const ID_RE = /^[\w-]{4,64}$/;
/** Where model files may come from (a site's answer names the file; nothing else is fetched). */
const FILE_HOSTS = [/^static\.poly\.pizza$/, /\.sketchfab\.com$/, /^sketchfab-prod-media\.s3\.amazonaws\.com$/, /\.sketchfab-cdn\.com$/];

/** A model downloaded into the data folder's tmp, for the Library to take. */
export interface FetchedModel {
  file: string;
  /** Its picture, if the site has one. */
  poster: string | null;
  name: string;
  credit: ModelCredit;
  /** Delete whatever the Library didn't take. */
  done(): Promise<void>;
}

export interface ModelSearchOptions {
  /** Keys from the environment (`server/config.ts`), which win over saved ones. */
  environment?: Partial<Record<ModelSource, string | null>>;
  /** Made-up results and a tiny model, never the internet (the e2e tests). */
  standIn?: boolean;
  fetch?: typeof fetch;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/**
 * The visualizer's 3D model search (docs/now-playing.md, "Your media"): Poly Pizza (needs an API key for everything
 * but its files) and Sketchfab (searches without one, downloads with an API token). Keys are kept in the data
 * folder (`model-keys.json`) or come from the environment; they're never sent to the page.
 */
export class ModelSearch {
  private known = new Map<string, ModelResult>();
  private fetch: typeof fetch;

  constructor(
    private paths: DataPaths,
    private keys: ApiKeyStore,
    private options: ModelSearchOptions = {},
  ) {
    this.fetch = options.fetch ?? fetch;
  }

  status(): ModelSearchStatus {
    return {
      sources: MODEL_SOURCES.map((source) => {
        const key = this.standIn || Boolean(this.key(source));
        return {
          source,
          name: MODEL_SITES[source].name,
          searchable: source === "sketchfab" || key,
          downloadable: key,
          keySaved: Boolean(this.keys.get(source)),
          keyFromEnvironment: Boolean(this.options.environment?.[source]),
        };
      }),
      starter: !this.standIn,
    };
  }

  async setKey(rawSource: string, body: unknown): Promise<ModelSearchStatus> {
    if (!isModelSource(rawSource)) throw new HttpError(404, `There's no model site called "${rawSource}": ${MODEL_SOURCES.join(" or ")}.`);
    if (!isObject(body) || (body.key !== null && typeof body.key !== "string")) throw new HttpError(400, "Expected { key } (null to forget it).");
    const key = text(body.key);
    if (key.length > MAX_KEY_LENGTH || /\s/.test(key)) throw new HttpError(400, "That doesn't look like a key: paste it again, without spaces.");
    await this.keys.set(rawSource, key || null);
    return this.status();
  }

  /** A page of a site's models for these words; `animated` only those that move. */
  async search(query: { q: unknown; source: unknown; animated: unknown; cursor: unknown }): Promise<ModelSearchPage> {
    const words = text(query.q).slice(0, MAX_QUERY_LENGTH);
    if (!words) throw new HttpError(400, "Search for something: a word or two, like \"dancing robot\".");
    const source = isModelSource(query.source) ? query.source : "poly-pizza";
    const animated = query.animated === "1" || query.animated === "true" || query.animated === true;
    const cursor = text(query.cursor);
    const page = this.standIn
      ? standInPage(source, words, animated)
      : source === "poly-pizza"
        ? await this.searchPolyPizza(words, animated, cursor)
        : await this.searchSketchfab(words, animated, cursor);
    for (const result of page.results) this.remember(result);
    return page;
  }

  /** Download a model (a search's result or a starter model's) and its picture into tmp. */
  async download(source: ModelSource, id: string): Promise<FetchedModel> {
    if (!ID_RE.test(id)) throw new HttpError(400, "That isn't a model's id.");
    if (this.standIn) return this.standInModel(source, id);
    // Sketchfab gives files only with a token: say so before asking it anything.
    if (source === "sketchfab") this.needKey(source, "download");
    const result = this.known.get(modelOrigin(source, id)) ?? (await this.lookup(source, id));
    const fileUrl = source === "poly-pizza" ? await this.polyPizzaFile(id) : await this.sketchfabFile(id);
    const file = this.paths.tmpFile(".glb");
    let poster: string | null = null;
    const done = async () => {
      await fs.rm(file, { force: true });
      if (poster) await fs.rm(poster, { force: true });
    };
    try {
      await this.save(fileUrl, file, MAX_MODEL_BYTES, `${result.title} is too big for the visualizer (over ${MAX_MODEL_BYTES / 2 ** 20} MB).`);
      if (result.thumbnail) {
        const ext = /\.(webp|png|jpe?g)(\?|$)/i.exec(result.thumbnail)?.[1]?.toLowerCase().replace("jpeg", "jpg") ?? "jpg";
        const target = this.paths.tmpFile(`.${ext}`);
        try {
          await this.save(result.thumbnail, target, MAX_POSTER_BYTES, "Its picture is too big.");
          poster = target;
        } catch (err) {
          await fs.rm(target, { force: true });
          logger.warn(`couldn't download the picture of ${source} ${id}: ${errorMessage(err)}`);
        }
      }
    } catch (err) {
      await done();
      throw err;
    }
    const credit: ModelCredit = { source, title: result.title, author: result.author, licence: result.licence, url: result.url };
    return { file, poster, name: result.title, credit, done };
  }

  // -------------------------------------------------------------------------

  private get standIn() {
    return this.options.standIn === true;
  }

  private key(source: ModelSource): string | null {
    return this.options.environment?.[source] || this.keys.get(source);
  }

  private needKey(source: ModelSource, what: string): string {
    const key = this.key(source);
    const site = MODEL_SITES[source];
    if (!key) throw new HttpError(412, `${site.name} needs an ${site.keyName} to ${what}: make one at ${site.keyPage} and paste it in.`);
    return key;
  }

  private remember(result: ModelResult) {
    const origin = modelOrigin(result.source, result.id);
    this.known.delete(origin);
    this.known.set(origin, result);
    if (this.known.size > MAX_KNOWN) this.known.delete(this.known.keys().next().value!);
  }

  /** A site's JSON, saying what went wrong in words the panel can show. */
  private async json(source: ModelSource, url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const site = MODEL_SITES[source].name;
    let response: Response;
    try {
      response = await this.fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
    } catch (err) {
      logger.warn(`${site} didn't answer: ${errorMessage(err)}`);
      throw new HttpError(502, `${site} didn't answer: check the internet connection and try again.`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(401, `${site} turned the ${MODEL_SITES[source].keyName} down: check it (${MODEL_SITES[source].keyPage}) and paste it again.`);
    }
    if (response.status === 404) throw new HttpError(404, `${site} has no such model (or it can't be downloaded).`);
    if (response.status === 429) throw new HttpError(429, `${site} says too many searches: wait a minute and try again.`);
    if (!response.ok) {
      logger.warn(`${site} answered ${response.status} for ${new URL(url).pathname}`);
      throw new HttpError(502, `${site} had a problem (${response.status}): try again in a moment.`);
    }
    try {
      return await response.json();
    } catch {
      throw new HttpError(502, `${site}'s answer wasn't readable: try again in a moment.`);
    }
  }

  private async searchPolyPizza(words: string, animated: boolean, cursor: string): Promise<ModelSearchPage> {
    const key = this.needKey("poly-pizza", "search");
    const page = Math.max(0, Math.min(50, Number.parseInt(cursor, 10) || 0));
    const params = new URLSearchParams({ Limit: String(PAGE_SIZE), Page: String(page) });
    if (animated) params.set("Animated", "1");
    const body = await this.json("poly-pizza", `https://api.poly.pizza/v1.1/search/${encodeURIComponent(words)}?${params}`, { "x-auth-token": key });
    const raw = isObject(body) && Array.isArray(body.results) ? body.results : [];
    const results = raw.map(polyPizzaResult).filter((r): r is ModelResult => r !== null);
    const total = isObject(body) ? count(body.total) : null;
    const more = raw.length === PAGE_SIZE && (total === null || (page + 1) * PAGE_SIZE < total);
    return { results, next: more ? String(page + 1) : null };
  }

  private async searchSketchfab(words: string, animated: boolean, cursor: string): Promise<ModelSearchPage> {
    const params = new URLSearchParams({
      type: "models",
      q: words,
      downloadable: "true",
      count: String(PAGE_SIZE),
      archives_max_size: String(MAX_MODEL_BYTES),
      max_face_count: "300000",
    });
    if (animated) params.set("animated", "true");
    if (/^[\w-]{1,64}$/.test(cursor)) params.set("cursor", cursor);
    const key = this.key("sketchfab");
    const body = await this.json("sketchfab", `https://api.sketchfab.com/v3/search?${params}`, key ? { Authorization: `Token ${key}` } : {});
    const raw = isObject(body) && Array.isArray(body.results) ? body.results : [];
    const results = raw.map(sketchfabResult).filter((r): r is ModelResult => r !== null);
    let next: string | null = null;
    if (isObject(body) && typeof body.next === "string") {
      try {
        next = new URL(body.next).searchParams.get("cursor");
      } catch {
        next = null;
      }
    }
    return { results, next };
  }

  /** A model that isn't in a search's results any more (or never was: an assistant's id). */
  private async lookup(source: ModelSource, id: string): Promise<ModelResult> {
    const starter = STARTER_MODELS.find((m) => m.source === source && m.id === id);
    if (starter) return starter;
    const result =
      source === "poly-pizza"
        ? polyPizzaResult(await this.json(source, `https://api.poly.pizza/v1.1/model/${id}`, { "x-auth-token": this.needKey(source, "download") }))
        : sketchfabResult(await this.json(source, `https://api.sketchfab.com/v3/models/${id}`));
    if (!result) throw new HttpError(502, `${MODEL_SITES[source].name}'s answer about that model wasn't readable.`);
    this.remember(result);
    return result;
  }

  private async polyPizzaFile(id: string): Promise<string> {
    const starter = starterFile(id);
    if (starter) return starter;
    const body = await this.json("poly-pizza", `https://api.poly.pizza/v1.1/model/${id}`, { "x-auth-token": this.needKey("poly-pizza", "download") });
    const url = isObject(body) ? text(body.Download) : "";
    if (!url) throw new HttpError(404, "Poly Pizza has no file for that model.");
    return url;
  }

  private async sketchfabFile(id: string): Promise<string> {
    const key = this.needKey("sketchfab", "download");
    const body = await this.json("sketchfab", `https://api.sketchfab.com/v3/models/${id}/download`, { Authorization: `Token ${key}` });
    const glb = isObject(body) && isObject(body.glb) ? body.glb : null;
    if (!glb || !text(glb.url)) throw new HttpError(404, "Sketchfab has no .glb of that model: pick another.");
    const size = count(glb.size);
    if (size !== null && size > MAX_MODEL_BYTES) {
      throw new HttpError(413, `That model is ${Math.round(size / 2 ** 20)} MB: the visualizer takes models up to ${MAX_MODEL_BYTES / 2 ** 20} MB.`);
    }
    return text(glb.url);
  }

  /** Stream a file from a model site to `target`, refusing more than `most` bytes. */
  private async save(url: string, target: string, most: number, tooBig: string): Promise<void> {
    let host: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new Error("not https");
      host = parsed.hostname;
    } catch {
      throw new HttpError(502, "The model site named a file that isn't a web link.");
    }
    if (!FILE_HOSTS.some((re) => re.test(host))) throw new HttpError(502, `The model site named a file elsewhere (${host}): it isn't downloaded.`);
    let response: Response;
    try {
      response = await this.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (err) {
      throw new HttpError(502, `The download didn't start: ${errorMessage(err)}`);
    }
    if (!response.ok || !response.body) throw new HttpError(502, `The download failed (${response.status}): try again in a moment.`);
    const length = Number(response.headers.get("content-length"));
    if (length > most) throw new HttpError(413, tooBig);
    let received = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > most) callback(new HttpError(413, tooBig));
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(response.body as WebReadableStream), limit, createWriteStream(target));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `The download was cut off: ${errorMessage(err)}`);
    }
  }

  private async standInModel(source: ModelSource, id: string): Promise<FetchedModel> {
    const result = this.known.get(modelOrigin(source, id)) ?? standInPage(source, id, false).results[0];
    const file = this.paths.tmpFile(".glb");
    await fs.writeFile(file, sampleGlb(result.animated ? ["Idle", "Dance"] : []));
    const credit: ModelCredit = { source, title: result.title, author: result.author, licence: result.licence, url: result.url };
    return { file, poster: null, name: result.title, credit, done: () => fs.rm(file, { force: true }) };
  }
}

function polyPizzaResult(raw: unknown): ModelResult | null {
  if (!isObject(raw)) return null;
  const id = text(raw.ID);
  if (!ID_RE.test(id)) return null;
  return {
    source: "poly-pizza",
    id,
    title: text(raw.Title) || "Untitled",
    author: (isObject(raw.Creator) && text(raw.Creator.Username)) || "Unknown",
    licence: text(raw.Licence) || "CC-BY 3.0",
    thumbnail: text(raw.Thumbnail) || null,
    animated: raw.Animated === true,
    triangles: count(raw["Tri Count"]),
    size: null,
    url: modelPage("poly-pizza", id),
  };
}

function sketchfabResult(raw: unknown): ModelResult | null {
  if (!isObject(raw)) return null;
  const id = text(raw.uid);
  if (!ID_RE.test(id)) return null;
  const glb = isObject(raw.archives) && isObject(raw.archives.glb) ? raw.archives.glb : null;
  const size = glb ? count(glb.size) : null;
  if (size !== null && size > MAX_MODEL_BYTES) return null;
  const images = isObject(raw.thumbnails) && Array.isArray(raw.thumbnails.images) ? raw.thumbnails.images.filter(isObject) : [];
  // The smallest picture that's still sharp in the panel's grid.
  const sized = images
    .map((i) => ({ url: text(i.url), width: count(i.width) ?? 0 }))
    .filter((i) => i.url)
    .sort((a, b) => a.width - b.width);
  const thumbnail = (sized.find((i) => i.width >= 256) ?? sized.at(-1))?.url ?? null;
  return {
    source: "sketchfab",
    id,
    title: text(raw.name) || "Untitled",
    author: (isObject(raw.user) && (text(raw.user.displayName) || text(raw.user.username))) || "Unknown",
    licence: (isObject(raw.license) && text(raw.license.label)) || "See its page",
    thumbnail,
    animated: (count(raw.animationCount) ?? 0) > 0,
    triangles: count(raw.faceCount),
    size,
    url: text(raw.viewerUrl) || modelPage("sketchfab", id),
  };
}

/** The stand-in's results: a few boxes named after the words, the first half of them moving. */
function standInPage(source: ModelSource, words: string, animated: boolean): ModelSearchPage {
  const slug = words.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "model";
  const results: ModelResult[] = [0, 1, 2, 3].map((i) => ({
    source,
    id: `${slug}-${i}`.padEnd(4, "x"),
    title: `${words} ${i + 1}`,
    author: "Stand-in",
    licence: "CC0 1.0",
    thumbnail: null,
    animated: i < 2,
    triangles: 12,
    size: 1024,
    url: modelPage(source, `${slug}-${i}`),
  }));
  return { results: animated ? results.filter((r) => r.animated) : results, next: null };
}
