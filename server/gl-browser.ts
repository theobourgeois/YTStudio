/**
 * A headless browser page running the compositor (`shared/compositor.ts`), so
 * the export draws every frame with the very same WebGL code and shaders as
 * the preview.
 *
 * Frames travel over a throwaway HTTP server on localhost that the page is
 * loaded from (much faster for big binary frames than going through the
 * DevTools protocol): while compositing, the page posts each finished frame
 * and gets the next one's layers and pictures in the response.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, type Page, chromium } from "playwright-core";
import { IDENTITY, type Placed, type Shader, createCompositor } from "../shared/compositor.ts";
import { errorMessage } from "../shared/errors.ts";
import type { UniformValue } from "../shared/transition-gl.ts";
import { drawSampleScene } from "../shared/transition-samples.ts";
import { CHROMIUM } from "./config.ts";
import type { FrameLayer } from "./render.ts";

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

/** What the page script exposes (see `pageScript`). */
interface PageApi {
  /** Draw frames until told to stop, exchanging them with `/exchange` (see `GlSession.composite`). */
  composite(job: { width: number; height: number; lanes: number }): Promise<void>;
  sheet(job: SheetJob): string;
  check(job: CheckJob): CheckResult[];
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

/** The page's globals: its API, and the functions inlined into it. */
interface PageGlobals {
  compositor: PageApi;
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
    const transition = (shader: Shader, uniforms: UniformValue[], progress: number, flipY = false) => {
      compositor.clear([0, 0, 0, 0]);
      compositor.drawTransition(shader, uniforms, progress, whole("a"), whole("b"));
      compositor.present({ flipY });
    };

    const api: PageApi = {
      async composite(job) {
        compositor.resize(job.width, job.height);
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
        /** Draw a frame and start reading it back. */
        const draw = (head: PacketHead, buf: Uint8Array, offset: number) => {
          Object.assign(shaders, head.shaders);
          for (const p of head.pictures) {
            const bytes = buf.subarray(offset, offset + p.length);
            const { width, height, luma } = p;
            compositor.setPicture(p.key, luma ? { yuv: bytes, width, height, kr: luma[0], kb: luma[1] } : { data: bytes, width, height });
            offset += p.length;
          }
          for (const key of head.release) compositor.deletePicture(key);
          compositor.clear();
          for (const layer of head.layers) {
            if (layer.kind === "picture") compositor.drawPicture(layer.picture);
            else {
              const shader = { key: layer.shader, source: shaders[layer.shader] };
              compositor.drawTransition(shader, layer.uniforms, layer.progress, layer.from, layer.to);
            }
          }
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
            await myTurn(head.frame);
            let read: Promise<Uint8Array<ArrayBuffer>>;
            try {
              read = draw(head, buf, 4 + headLength);
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

/** One headless page with the compositor. Close it when done. */
export class GlSession {
  private exchange: FrameExchange | null = null;
  /** Why compositing stopped (the page only sees a message). */
  private failure: unknown = null;

  private constructor(
    private readonly server: http.Server,
    private readonly browser: Browser,
    private readonly page: Page,
  ) {}

  static async open(): Promise<GlSession> {
    let session: GlSession | null = null;
    const script = pageScript();
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(`<!doctype html><meta charset="utf-8"><script>${script}</script>`);
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
    let browser: Browser | null = null;
    try {
      browser = await launch();
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      if (errors.length) throw new Error(errors[0]);
      session = new GlSession(server, browser, page);
      return session;
    } catch (err) {
      await browser?.close().catch(() => {});
      server.close();
      throw err;
    }
  }

  /**
   * Draw frames of `size` (as YUV 4:2:0, see `readYuv420`) until `exchange`
   * says there are no more. They're drawn in order, but finished frames may
   * come back out of order.
   */
  async composite(size: { width: number; height: number }, exchange: FrameExchange): Promise<void> {
    this.exchange = exchange;
    this.failure = null;
    try {
      const job = { ...size, lanes: LANES };
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

  async close() {
    await this.browser.close().catch(() => {});
    this.server.close();
  }
}
