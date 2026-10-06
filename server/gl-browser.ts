/**
 * A headless browser page running the compositor (`shared/compositor.ts`), so
 * the export draws every frame with the very same WebGL code and shaders as
 * the preview.
 *
 * Frames travel over a throwaway HTTP server on localhost that the page is
 * loaded from (much faster for big binary frames than going through the
 * DevTools protocol): while compositing, the page posts each finished frame
 * and gets the next one's layers and pictures in the response.
 *
 * The page is Chromium launched through Playwright, or in the desktop app a
 * hidden window of its own Chromium (`setGlPageOpener`).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser } from "playwright-core";
import { type Adjustment, type EffectPass, IDENTITY, type Placed, type SceneRenderer, type Shader, createCompositor } from "../shared/compositor.ts";
import { errorMessage } from "../shared/errors.ts";
import type { UniformValue } from "../shared/transition-gl.ts";
import { drawSampleScene } from "../shared/transition-samples.ts";
import { CHROMIUM } from "./config.ts";
import type { FrameLayer, PlacedRef } from "./render.ts";
import { sceneRuntime } from "./scene-runtime.ts";

// On a Mac, headless Chromium can draw with the GPU (Metal); elsewhere it falls back to SwiftShader.
const ARGS = [
  "--ignore-gpu-blocklist",
  "--enable-unsafe-swiftshader",
  ...(process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : []),
];

export const NO_BROWSER_MESSAGE =
  "Exporting needs Chromium: install Google Chrome, or run `pnpm exec playwright install chromium-headless-shell`.";

/** Playwright's own Chromium, else the installed Google Chrome (or `CHROMIUM_PATH`). */
async function launch(): Promise<Browser> {
  // Loaded when needed: the desktop app draws in its own Chromium and doesn't ship Playwright.
  const { chromium } = await import("playwright-core");
  if (CHROMIUM) return chromium.launch({ executablePath: CHROMIUM, args: ARGS });
  try {
    return await chromium.launch({ args: ARGS });
  } catch {
    try {
      return await chromium.launch({ channel: "chrome", args: ARGS });
    } catch {
      throw new Error(NO_BROWSER_MESSAGE);
    }
  }
}

/** A browser page with the compositor loaded: all `GlSession` needs of a browser. */
export interface GlPage {
  /** Run `fn(arg)` in the page (`fn` is sent as source, so it only reaches the page's globals). */
  evaluate<A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  close(): Promise<void>;
}

/** Load `url` in a new page; fails if the page threw while loading. */
export type GlPageOpener = (url: string) => Promise<GlPage>;

/** A page in a headless Chromium of its own (see `launch`). */
const openChromiumPage: GlPageOpener = async (url) => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(url);
    if (errors.length) throw new Error(errors[0]);
    return {
      // Playwright's types unbox the argument; ours are plain JSON.
      evaluate: <A, R>(fn: (arg: A) => R | Promise<R>, arg: A) => page.evaluate(fn as never, arg as never) as Promise<R>,
      close: () => browser.close().catch(() => {}),
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
};

let openPage: GlPageOpener = openChromiumPage;

/** Draw in pages from `opener` instead of launching Chromium (the desktop app uses its own). */
export function setGlPageOpener(opener: GlPageOpener) {
  openPage = opener;
}

/** What the page script exposes (see `pageScript`). */
interface PageApi {
  /** Draw frames until told to stop, exchanging them with `/exchange` (see `GlSession.composite`). */
  composite(job: { width: number; height: number; lanes: number; fonts: string[] }): Promise<void>;
  sheet(job: SheetJob): string;
  check(job: CheckJob): CheckResult[];
  effects(job: EffectJob): { sheet: string; results: EffectResult[] };
  layers(job: LayersJob): { sheet: string; results: LayersResult[] };
  /** Compile fragment shaders by key: the logs of those that don't. */
  compile(sources: Record<string, string>): Record<string, string>;
  /** Load the 3D scenes' runtime (`/scene-runtime.js`) and render scenes with it from now on. */
  loadScenes(): Promise<void>;
  /** Draw planned frames (`FramesJob`) on a compositor of its own, in `order`: each one's RGBA, top row first. */
  frames(job: FramesJob): number[][];
}

/** What the page needs for its next frame. */
export interface FramePacket {
  frame: number;
  /**
   * Pictures to store (replacing any under the same key): raw RGBA, or YUV
   * 4:2:0 with its matrix's luma weights of red and blue (see `YuvFrame`).
   */
  pictures: { key: string; width: number; height: number; luma: [number, number] | null; data: Buffer }[];
  /** Pictures no longer needed. */
  release: string[];
  /** Shaders used from now on, by key. */
  shaders: Record<string, string>;
  layers: FrameLayer[];
}

/** The JSON part of a packet on the wire (`pictures`' data follows it, in order). */
interface PacketHead {
  /** Which output frame this is; null when there are no more. */
  frame: number | null;
  pictures: { key: string; width: number; height: number; luma: [number, number] | null; length: number }[];
  release: string[];
  shaders: Record<string, string>;
  layers: FrameLayer[];
}

/** Compare each transition at progress 0 and 1 with the pictures it goes from and to. */
export interface CheckJob {
  rows: { label: string; shader: Shader; uniforms: UniformValue[] }[];
  /** Shaders that just show the outgoing / incoming picture. */
  from: Shader;
  to: Shader;
  cell: { width: number; height: number };
}

export interface CheckResult {
  label: string;
  /** Largest channel difference (0..255) from the outgoing picture at progress 0, and the incoming one at 1. */
  start: number;
  end: number;
  error?: string;
}

export interface SheetJob {
  rows: { label: string; shader: Shader; uniforms: UniformValue[] }[];
  progresses: number[];
  cell: { width: number; height: number };
}

/** Draw the sunset (without its letter) through each effect, one column per pass (e.g. per moment). */
export interface EffectJob {
  rows: { label: string; passes: EffectPass[] }[];
  cell: { width: number; height: number };
}

/**
 * Planned frames (`RenderPlan.frame`) drawn in `order` (indices into `frames`) on a compositor of its own.
 * With `catchUp`, the plan's warm-ups are left out and simulations are caught up as the preview does
 * after a seek (from their newest state or checkpoint, stepping the frames' own layers).
 */
export interface FramesJob {
  width: number;
  height: number;
  shaders: Record<string, string>;
  frames: FrameLayer[][];
  order: number[];
  catchUp?: boolean;
}

/** One thing drawn on a frame of a `LayersJob`: a sample picture ("a", "b", or "plain", the sunset without its letter) placed like a clip, or an adjustment layer. */
export type DrawOp = { kind: "picture"; picture: Placed } | { kind: "adjustment"; adjustment: Adjustment };

/**
 * Draw stacks of layers over the sample scenes, one row per item, one column per
 * frame (e.g. a preset over time). Each row's first and last frames are compared
 * with `first` and `last` when given.
 */
export interface LayersJob {
  rows: { label: string; frames: DrawOp[][]; first?: DrawOp[]; last?: DrawOp[] }[];
  cell: { width: number; height: number };
}

export interface LayersResult {
  label: string;
  /** Largest channel difference (0..255) of the first frame from `first`, and of the last from `last` (0 when not given). */
  start: number;
  end: number;
  error?: string;
}

export interface EffectResult {
  label: string;
  /** How far the picture moved from the plain one (0..255 per channel), across the row: the most, and on average. */
  max: number;
  mean: number;
  error?: string;
}

/** The page's globals: its API, and the functions inlined into it. */
interface PageGlobals {
  compositor: PageApi;
  /** The 3D scenes' runtime, once loaded (`src/scenes/page.ts`). */
  vaudioScenes?: { createSceneRenderer(): SceneRenderer };
  createCompositor: typeof createCompositor;
  drawSampleScene: typeof drawSampleScene;
  IDENTITY: typeof IDENTITY;
}

/**
 * The page: the renderer and the sample scenes, inlined from their source.
 * `main` runs in the page, so it only reaches them (and everything else) through
 * globals. (`__name` covers the helper tsx/esbuild add to named functions.)
 */
function pageScript(): string {
  const main = () => {
    const { createCompositor, drawSampleScene, IDENTITY } = globalThis as unknown as PageGlobals;
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL 2 isn't available in the headless browser.");
    const compositor = createCompositor(gl);
    let sceneRenderer: SceneRenderer | null = null;
    const whole = (key: string): Placed => ({ key, affine: IDENTITY, opacity: 1 });
    /** The two sample scenes as pictures "a" and "b", at the cell size. */
    const scenes = (cw: number, ch: number) => {
      compositor.resize(cw, ch);
      ["a", "b"].forEach((key, i) => {
        const c = document.createElement("canvas");
        c.width = cw;
        c.height = ch;
        drawSampleScene(c.getContext("2d")!, cw, ch, i as 0 | 1);
        compositor.setPicture(key, c);
      });
    };
    const plain = (cw: number, ch: number) => {
      const c = document.createElement("canvas");
      c.width = cw;
      c.height = ch;
      drawSampleScene(c.getContext("2d")!, cw, ch, 1, false);
      compositor.setPicture("plain", c);
    };
    const transition = (shader: Shader, uniforms: UniformValue[], progress: number, flipY = false) => {
      compositor.clear([0, 0, 0, 0]);
      compositor.drawTransition(shader, uniforms, progress, whole("a"), whole("b"));
      compositor.present({ flipY });
    };

    /** Draw a planned frame's layers (their shaders by key, the sources in `shaders`) over the frame begun. */
    const drawFrame = (target: typeof compositor, shaders: Record<string, string>, layers: FrameLayer[]) => {
      const shader = (key: string): Shader => ({
        key,
        source: shaders[key],
        ...(shaders[`${key}#vs`] && { vertex: shaders[`${key}#vs`] }),
        ...(shaders[`${key}#base`] && { base: shaders[`${key}#base`] }),
      });
      // Effects name their shaders by key; the sources came in earlier packets.
      const passes = (effects: EffectPass<string>[] | undefined) => effects?.map((fx) => ({ ...fx, shader: shader(fx.shader) }));
      const samples = (list: PlacedRef["samples"]) => list?.map((sample) => ({ ...sample, effects: passes(sample.effects) }));
      const toPlaced = (p: PlacedRef): Placed => ({
        ...p,
        effects: passes(p.effects),
        samples: samples(p.samples),
        matte: p.matte && { mode: p.matte.mode, layer: toPlaced(p.matte.layer) },
      });
      const toAdjustment = (a: Adjustment<string>): Adjustment => ({
        ...a,
        effects: passes(a.effects),
        samples: samples(a.samples),
        matte: a.matte && { mode: a.matte.mode, layer: toPlaced(a.matte.layer) },
      });
      const placed = (p: PlacedRef | null): Placed | null => p && toPlaced(p);
      const drawLayers = (list: FrameLayer[]) => {
        for (const layer of list) {
          if (layer.kind === "picture") target.drawPicture(placed(layer.picture)!);
          else if (layer.kind === "adjustment") target.drawAdjustment(toAdjustment(layer.adjustment));
          else if (layer.kind === "group") {
            // A nested sequence: its layers into a picture of its own, placed by a later layer.
            target.beginGroup(layer.width, layer.height);
            drawLayers(layer.layers);
            target.endGroup(layer.key);
          } else if (layer.kind === "advance") target.advance(placed(layer.picture)!);
          else target.drawTransition(shader(layer.shader), layer.uniforms, layer.progress, placed(layer.from), placed(layer.to));
        }
      };
      drawLayers(layers);
      return { toPlaced };
    };

    const api: PageApi = {
      frames(job) {
        // A compositor of its own, so no simulation's states carry over from another job.
        const own = document.createElement("canvas");
        const ctx = own.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })!;
        const fresh = createCompositor(ctx);
        fresh.setSceneRenderer(sceneRenderer);
        fresh.resize(job.width, job.height);
        const reads: number[][] = [];
        try {
          for (const f of job.order) {
            if (job.catchUp) {
              // As the preview does after a seek: each simulation stepped from the newest state it has.
              const pictures = (layers: FrameLayer[]) => layers.flatMap((l) => (l.kind === "picture" ? [l.picture] : []));
              for (const picture of pictures(job.frames[f])) {
                const sims = (picture.effects ?? []).flatMap((fx) => (fx.simulation ? [fx.simulation] : []));
                if (!sims.length) continue;
                const from = Math.min(...sims.map((sim) => fresh.simulationFrom(sim.id, sim.version, sim.frame, sim.memory)));
                for (let k = Math.max(0, from); k < f; k++) {
                  const earlier = pictures(job.frames[k]).find((p) => p.effects?.some((fx) => fx.simulation?.id === sims[0].id));
                  if (earlier) fresh.advance(drawFrame(fresh, job.shaders, []).toPlaced(earlier));
                }
              }
            }
            fresh.clear();
            drawFrame(fresh, job.shaders, job.frames[f].filter((l) => !job.catchUp || l.kind !== "advance"));
            fresh.present({ flipY: true });
            reads.push(Array.from(fresh.read()));
          }
        } finally {
          fresh.dispose();
        }
        return reads;
      },
      async loadScenes() {
        const globals = globalThis as unknown as PageGlobals;
        if (!globals.vaudioScenes) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "/scene-runtime.js";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("The 3D scenes' runtime didn't load."));
            document.head.append(script);
          });
        }
        sceneRenderer = globals.vaudioScenes!.createSceneRenderer();
        compositor.setSceneRenderer(sceneRenderer);
      },
      async composite(job) {
        compositor.resize(job.width, job.height);
        // Frames are drawn in order: a simulation always has its frame before, so keeps no checkpoints.
        compositor.setCheckpointBudget(0);
        // Texts are drawn here, in the user's fonts: have them ready before the first frame.
        await Promise.all(job.fonts.map((font) => document.fonts.load(font).catch(() => [])));
        const shaders: Record<string, string> = {};
        // Frames are drawn strictly in order: a lane whose packet arrives early waits for its turn.
        let turn = 0;
        const waiting = new Map<number, () => void>();
        const myTurn = (frame: number) =>
          frame === turn ? Promise.resolve() : new Promise<void>((resolve) => waiting.set(frame, resolve));
        const nextTurn = () => {
          turn++;
          waiting.get(turn)?.();
          waiting.delete(turn);
        };
        /** The packet's pictures. */
        const unpack = (head: PacketHead, buf: Uint8Array, offset: number) =>
          head.pictures.map((p) => {
            const bytes = buf.subarray(offset, (offset += p.length));
            const { width, height, luma } = p;
            return { key: p.key, source: luma ? { yuv: bytes, width, height, kr: luma[0], kb: luma[1] } : { data: bytes, width, height } };
          });
        /** Draw a frame and start reading it back. */
        const draw = (head: PacketHead, pictures: ReturnType<typeof unpack>) => {
          Object.assign(shaders, head.shaders);
          for (const { key, source } of pictures) compositor.setPicture(key, source);
          for (const key of head.release) compositor.deletePicture(key);
          compositor.clear();
          drawFrame(compositor, shaders, head.layers);
          return compositor.readYuv420Async();
        };
        const lane = async () => {
          let finished: { frame: number; data: Uint8Array<ArrayBuffer> } | null = null;
          for (;;) {
            // A Blob body is much faster to send than a typed array.
            const res: Response = await fetch(finished ? `/exchange?frame=${finished.frame}` : "/exchange", {
              method: "POST",
              body: finished ? new Blob([finished.data]) : null,
            });
            if (!res.ok) throw new Error((await res.text()) || "The export stopped.");
            const buf: Uint8Array = new Uint8Array(await res.arrayBuffer());
            const headLength = new DataView(buf.buffer, buf.byteOffset).getUint32(0, true);
            const head = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + headLength))) as PacketHead;
            if (head.frame === null) return;
            const pictures = unpack(head, buf, 4 + headLength);
            await myTurn(head.frame);
            let read: Promise<Uint8Array<ArrayBuffer>>;
            try {
              read = draw(head, pictures);
            } finally {
              // The next frame can be drawn while this one is read back.
              nextTurn();
            }
            finished = { frame: head.frame, data: await read };
          }
        };
        await Promise.all(Array.from({ length: job.lanes }, lane));
      },
      sheet(job) {
        const { width: cw, height: ch } = job.cell;
        const label = 150;
        const sheet = document.createElement("canvas");
        sheet.width = label + job.progresses.length * (cw + 4);
        sheet.height = job.rows.length * (ch + 4);
        const out = sheet.getContext("2d")!;
        out.fillStyle = "#16191d";
        out.fillRect(0, 0, sheet.width, sheet.height);
        scenes(cw, ch);
        job.rows.forEach((row, r) => {
          out.fillStyle = "#abb2bf";
          out.font = "13px system-ui, sans-serif";
          out.fillText(row.label, 8, r * (ch + 4) + ch / 2);
          try {
            job.progresses.forEach((p, i) => {
              transition(row.shader, row.uniforms, p);
              out.drawImage(canvas, label + i * (cw + 4), r * (ch + 4));
            });
          } catch (err) {
            out.fillStyle = "#e06c75";
            out.fillText(String(err).slice(0, 160), label, r * (ch + 4) + ch / 2);
          }
        });
        return sheet.toDataURL("image/png");
      },
      check(job) {
        scenes(job.cell.width, job.cell.height);
        const pixels = (shader: Shader, uniforms: UniformValue[], p: number) => {
          transition(shader, uniforms, p, true);
          return compositor.read();
        };
        const diff = (a: Uint8Array, b: Uint8Array) => {
          let max = 0;
          for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
          return max;
        };
        const from = pixels(job.from, [], 0);
        const to = pixels(job.to, [], 0);
        return job.rows.map((row) => {
          try {
            return {
              label: row.label,
              start: diff(pixels(row.shader, row.uniforms, 0), from),
              end: diff(pixels(row.shader, row.uniforms, 1), to),
            };
          } catch (err) {
            return { label: row.label, start: 255, end: 255, error: String(err) };
          }
        });
      },
      compile(sources) {
        const failed: Record<string, string> = {};
        for (const [key, source] of Object.entries(sources)) {
          const s = gl.createShader(gl.FRAGMENT_SHADER)!;
          gl.shaderSource(s, source);
          gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) failed[key] = gl.getShaderInfoLog(s) || "It doesn't compile.";
          gl.deleteShader(s);
        }
        return failed;
      },
      effects(job) {
        const { width: cw, height: ch } = job.cell;
        compositor.resize(cw, ch);
        plain(cw, ch);
        const label = 150;
        const columns = Math.max(1, ...job.rows.map((r) => r.passes.length));
        const sheet = document.createElement("canvas");
        sheet.width = label + (columns + 1) * (cw + 4);
        sheet.height = job.rows.length * (ch + 4);
        const out = sheet.getContext("2d")!;
        out.fillStyle = "#16191d";
        out.fillRect(0, 0, sheet.width, sheet.height);
        const drawn = (effects: EffectPass[]) => {
          compositor.clear();
          compositor.drawPicture({ key: "plain", affine: IDENTITY, opacity: 1, effects });
          compositor.present({ flipY: true });
          return compositor.read();
        };
        const before = drawn([]);
        const results = job.rows.map((row, r) => {
          const y = r * (ch + 4);
          out.fillStyle = "#abb2bf";
          out.font = "13px system-ui, sans-serif";
          out.fillText(row.label, 8, y + ch / 2);
          // The plain picture first, to compare.
          drawn([]);
          compositor.present();
          out.drawImage(canvas, label, y);
          let max = 0;
          let sum = 0;
          try {
            row.passes.forEach((pass, i) => {
              const pixels = drawn([pass]);
              let rowSum = 0;
              for (let j = 0; j < pixels.length; j++) {
                const d = Math.abs(pixels[j] - before[j]);
                max = Math.max(max, d);
                rowSum += d;
              }
              sum += rowSum / pixels.length;
              compositor.present();
              out.drawImage(canvas, label + (i + 1) * (cw + 4), y);
            });
            return { label: row.label, max, mean: sum / Math.max(1, row.passes.length) };
          } catch (err) {
            out.fillStyle = "#e06c75";
            out.fillText(String(err).slice(0, 160), label + cw + 8, y + ch / 2);
            return { label: row.label, max: 0, mean: 0, error: String(err) };
          }
        });
        return { sheet: sheet.toDataURL("image/png"), results };
      },
      layers(job) {
        const { width: cw, height: ch } = job.cell;
        scenes(cw, ch);
        plain(cw, ch);
        const label = 150;
        const columns = Math.max(1, ...job.rows.map((r) => r.frames.length));
        const sheet = document.createElement("canvas");
        sheet.width = label + columns * (cw + 4);
        sheet.height = job.rows.length * (ch + 4);
        const out = sheet.getContext("2d")!;
        out.fillStyle = "#16191d";
        out.fillRect(0, 0, sheet.width, sheet.height);
        const draw = (ops: DrawOp[]) => {
          compositor.clear();
          for (const op of ops) {
            if (op.kind === "picture") compositor.drawPicture(op.picture);
            else compositor.drawAdjustment(op.adjustment);
          }
        };
        const pixels = (ops: DrawOp[]) => {
          draw(ops);
          compositor.present({ flipY: true });
          return compositor.read();
        };
        const diff = (a: Uint8Array, b: Uint8Array) => {
          let max = 0;
          for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
          return max;
        };
        const results = job.rows.map((row, r) => {
          const y = r * (ch + 4);
          out.fillStyle = "#abb2bf";
          out.font = "13px system-ui, sans-serif";
          out.fillText(row.label, 8, y + ch / 2);
          try {
            row.frames.forEach((ops, i) => {
              draw(ops);
              compositor.present();
              out.drawImage(canvas, label + i * (cw + 4), y);
            });
            const start = row.first && row.frames.length ? diff(pixels(row.frames[0]), pixels(row.first)) : 0;
            const end = row.last && row.frames.length ? diff(pixels(row.frames[row.frames.length - 1]), pixels(row.last)) : 0;
            return { label: row.label, start, end };
          } catch (err) {
            out.fillStyle = "#e06c75";
            out.fillText(String(err).slice(0, 160), label + 8, y + ch / 2);
            return { label: row.label, start: 255, end: 255, error: String(err) };
          }
        });
        return { sheet: sheet.toDataURL("image/png"), results };
      },
    };
    (globalThis as unknown as PageGlobals).compositor = api;
  };
  return [
    "var __name = (f) => f;",
    `var createCompositor = ${createCompositor.toString()};`,
    `var drawSampleScene = ${drawSampleScene.toString()};`,
    `var IDENTITY = ${JSON.stringify(IDENTITY)};`,
    `(${main.toString()})();`,
  ].join("\n");
}

/**
 * Supplies the page's frames while compositing: gets a frame the page has
 * finished (null for a lane's first request) and returns what the next one
 * needs, or null when there are no more. Calls overlap (one per lane).
 */
export type FrameExchange = (finished: { frame: number; data: Buffer } | null) => Promise<FramePacket | null>;

/**
 * Frames being worked on at once: while the page draws one, the next one's
 * pictures are already on their way.
 */
const LANES = 3;

/** Whether a job draws a 3D scene (an effect pass with a `scene`). */
const drawsScenes = (job: unknown) => JSON.stringify(job).includes('"scene":{');

/** One headless page with the compositor. Close it when done. */
export class GlSession {
  private exchange: FrameExchange | null = null;
  private scenes = false;
  /** Why compositing stopped (the page only sees a message). */
  private failure: unknown = null;

  private constructor(
    private readonly server: http.Server,
    private readonly page: GlPage,
  ) {}

  static async open(): Promise<GlSession> {
    let session: GlSession | null = null;
    const script = pageScript();
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(`<!doctype html><meta charset="utf-8"><script>${script}</script>`);
      } else if (req.method === "GET" && req.url === "/scene-runtime.js") {
        sceneRuntime().then(
          (code) => res.writeHead(200, { "Content-Type": "text/javascript" }).end(code),
          (err) => res.writeHead(500, { "Content-Type": "text/plain" }).end(errorMessage(err)),
        );
      } else if (req.method === "POST" && req.url?.startsWith("/exchange")) {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const frame = Number(new URL(req.url!, "http://page").searchParams.get("frame") ?? NaN);
          const finished = Number.isInteger(frame) ? { frame, data: Buffer.concat(chunks) } : null;
          if (session) void session.respond(finished, res);
          else res.writeHead(503).end();
        });
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const page = await openPage(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      session = new GlSession(server, page);
      return session;
    } catch (err) {
      server.close();
      throw err;
    }
  }

  /**
   * Draw frames of `size` (as YUV 4:2:0, see `readYuv420`) until `exchange`
   * says there are no more. They're drawn in order, but finished frames may
   * come back out of order.
   */
  async composite(size: { width: number; height: number }, exchange: FrameExchange, fonts: string[] = [], scenes = false): Promise<void> {
    this.exchange = exchange;
    this.failure = null;
    try {
      if (scenes) await this.loadScenes();
      const job = { ...size, lanes: LANES, fonts };
      await this.page.evaluate((j) => (globalThis as unknown as PageGlobals).compositor.composite(j), job);
    } catch (err) {
      throw this.failure ?? err;
    } finally {
      this.exchange = null;
    }
  }

  private async respond(finished: { frame: number; data: Buffer } | null, res: http.ServerResponse) {
    try {
      if (!this.exchange) throw new Error("Nothing is being drawn.");
      const packet = await this.exchange(finished);
      const head: PacketHead = packet
        ? { ...packet, pictures: packet.pictures.map(({ data, ...p }) => ({ ...p, length: data.length })) }
        : { frame: null, pictures: [], release: [], shaders: {}, layers: [] };
      const json = Buffer.from(JSON.stringify(head));
      const length = Buffer.alloc(4);
      length.writeUInt32LE(json.length);
      const data = packet?.pictures.map((p) => p.data) ?? [];
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": 4 + json.length + data.reduce((n, d) => n + d.length, 0),
      });
      res.write(length);
      res.write(json);
      for (const d of data) res.write(d);
      res.end();
    } catch (err) {
      this.failure ??= err;
      res.writeHead(500, { "Content-Type": "text/plain" }).end(errorMessage(err));
    }
  }

  /** A PNG contact sheet: one row per transition, one column per progress. */
  async sheet(job: SheetJob): Promise<Buffer> {
    const url = await this.page.evaluate((j) => (globalThis as unknown as PageGlobals).compositor.sheet(j), job);
    return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  }

  async check(job: CheckJob): Promise<CheckResult[]> {
    return this.page.evaluate((j) => (globalThis as unknown as PageGlobals).compositor.check(j), job);
  }

  /** Draw stacks of layers over the sample scenes (see `LayersJob`): a PNG contact sheet, and the first/last frame checks. */
  async layers(job: LayersJob): Promise<{ sheet: Buffer; results: LayersResult[] }> {
    if (drawsScenes(job)) await this.loadScenes();
    const { sheet, results } = await this.page.evaluate((j) => (globalThis as unknown as PageGlobals).compositor.layers(j), job);
    return { sheet: Buffer.from(sheet.slice(sheet.indexOf(",") + 1), "base64"), results };
  }

  /** Run effects over the plain sample picture: a PNG contact sheet, and how much each changed it. */
  async effects(job: EffectJob): Promise<{ sheet: Buffer; results: EffectResult[] }> {
    if (drawsScenes(job)) await this.loadScenes();
    const { sheet, results } = await this.page.evaluate((j) => (globalThis as unknown as PageGlobals).compositor.effects(j), job);
    return { sheet: Buffer.from(sheet.slice(sheet.indexOf(",") + 1), "base64"), results };
  }

  /** Draw planned frames in an order (see `FramesJob`): each one's RGBA, top row first. */
  async frames(job: FramesJob): Promise<Uint8Array[]> {
    if (drawsScenes(job)) await this.loadScenes();
    const reads = await this.page.evaluate((j) => (globalThis as unknown as PageGlobals).compositor.frames(j), job);
    return reads.map((r) => Uint8Array.from(r));
  }

  /** Have the page render 3D scenes (loading three.js and the scenes: a second or so the first time). */
  async loadScenes(): Promise<void> {
    if (this.scenes) return;
    await this.page.evaluate(() => (globalThis as unknown as PageGlobals).compositor.loadScenes(), null);
    this.scenes = true;
  }

  /** Compile fragment shaders (by key) as the export's page does: the logs of those that don't. */
  async compile(sources: Record<string, string>): Promise<Record<string, string>> {
    return this.page.evaluate((s) => (globalThis as unknown as PageGlobals).compositor.compile(s), sources);
  }

  async close() {
    await this.page.close();
    this.server.close();
  }
}
