/**
 * A headless browser page running the transition renderer
 * (`shared/transition-gl.ts`), so the export draws transitions with the very
 * same WebGL shaders as the preview.
 *
 * Frames travel over a throwaway HTTP server on localhost that the page is
 * loaded from: the page fetches the two layers and posts the result back as a
 * Blob (much faster for big binary frames than going through the DevTools
 * protocol).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, type Page, chromium } from "playwright-core";
import { type UniformValue, createTransitionRenderer } from "../shared/transition-gl.ts";
import { drawSampleScene } from "../shared/transition-samples.ts";
import { CHROMIUM } from "./config.ts";

const ARGS = ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"];

export const NO_BROWSER_MESSAGE =
  "Rendering transitions needs Chromium: install Google Chrome, or run `pnpm exec playwright install chromium-headless-shell`.";

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

export interface Shader {
  key: string;
  source: string;
}

/** What the page script exposes (see `pageScript`). */
interface PageApi {
  setup(width: number, height: number): void;
  renderFrame(job: { width: number; height: number; shader: Shader; uniforms: UniformValue[]; progress: number }): Promise<void>;
  sheet(job: SheetJob): string;
  check(job: CheckJob): CheckResult[];
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
  transitions: PageApi;
  createTransitionRenderer: typeof createTransitionRenderer;
  drawSampleScene: typeof drawSampleScene;
}

/**
 * The page: the renderer and the sample scenes, inlined from their source.
 * `main` runs in the page, so it only reaches them (and everything else) through
 * globals. (`__name` covers the helper tsx/esbuild add to named functions.)
 */
function pageScript(): string {
  const main = () => {
    const { createTransitionRenderer, drawSampleScene } = globalThis as unknown as PageGlobals;
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("WebGL 2 isn't available in the headless browser.");
    const renderer = createTransitionRenderer(gl);
    const api: PageApi = {
      setup(width, height) {
        renderer.resize(width, height);
      },
      async renderFrame(job) {
        const layer = async (i: number) => {
          const buf = await (await fetch(`/layer/${i}`)).arrayBuffer();
          return buf.byteLength ? { data: new Uint8Array(buf), width: job.width, height: job.height } : null;
        };
        const [from, to] = await Promise.all([layer(0), layer(1)]);
        renderer.layer(0, from);
        renderer.layer(1, to);
        renderer.draw(job.shader, job.uniforms, job.progress, { flipY: true, straight: true });
        await fetch("/out", { method: "POST", body: new Blob([renderer.read()]) });
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
        const scenes = [0, 1].map((i) => {
          const c = document.createElement("canvas");
          c.width = cw;
          c.height = ch;
          drawSampleScene(c.getContext("2d")!, cw, ch, i as 0 | 1);
          return c;
        });
        renderer.resize(cw, ch);
        renderer.layer(0, scenes[0]);
        renderer.layer(1, scenes[1]);
        job.rows.forEach((row, r) => {
          out.fillStyle = "#abb2bf";
          out.font = "13px system-ui, sans-serif";
          out.fillText(row.label, 8, r * (ch + 4) + ch / 2);
          try {
            job.progresses.forEach((p, i) => {
              renderer.draw(row.shader, row.uniforms, p);
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
        const { width: cw, height: ch } = job.cell;
        const scenes = [0, 1].map((i) => {
          const c = document.createElement("canvas");
          c.width = cw;
          c.height = ch;
          drawSampleScene(c.getContext("2d")!, cw, ch, i as 0 | 1);
          return c;
        });
        renderer.resize(cw, ch);
        renderer.layer(0, scenes[0]);
        renderer.layer(1, scenes[1]);
        const pixels = (shader: typeof job.from, uniforms: UniformValue[], p: number) => {
          renderer.draw(shader, uniforms, p);
          return renderer.read();
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
    (globalThis as unknown as PageGlobals).transitions = api;
  };
  return [
    "var __name = (f) => f;",
    `var createTransitionRenderer = ${createTransitionRenderer.toString()};`,
    `var drawSampleScene = ${drawSampleScene.toString()};`,
    `(${main.toString()})();`,
  ].join("\n");
}

/** One headless page rendering transition frames. Close it when done. */
export class GlSession {
  private layers: [Buffer | null, Buffer | null] = [null, null];
  private output: Buffer | null = null;
  private size = { width: 0, height: 0 };

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
      } else if (req.method === "GET" && req.url?.startsWith("/layer/")) {
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(session?.layers[req.url.endsWith("1") ? 1 : 0] ?? Buffer.alloc(0));
      } else if (req.method === "POST" && req.url === "/out") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          if (session) session.output = Buffer.concat(chunks);
          res.end();
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

  async setup(width: number, height: number) {
    this.size = { width, height };
    await this.page.evaluate(([w, h]) => (globalThis as unknown as PageGlobals).transitions.setup(w, h), [width, height]);
  }

  /**
   * One transition frame from two canvas-sized layers (raw RGBA, straight
   * alpha, top row first; null = transparent), in the same format.
   */
  async frame(shader: Shader, uniforms: UniformValue[], progress: number, from: Buffer | null, to: Buffer | null): Promise<Buffer> {
    this.layers = [from, to];
    this.output = null;
    const job = { ...this.size, shader, uniforms, progress };
    await this.page.evaluate((j) => (globalThis as unknown as PageGlobals).transitions.renderFrame(j), job);
    const out = this.output as Buffer | null;
    if (!out || out.length !== this.size.width * this.size.height * 4) throw new Error("The transition renderer returned no frame.");
    return out;
  }

  /** A PNG contact sheet: one row per transition, one column per progress. */
  async sheet(job: SheetJob): Promise<Buffer> {
    const url = await this.page.evaluate((j) => (globalThis as unknown as PageGlobals).transitions.sheet(j), job);
    return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  }

  async check(job: CheckJob): Promise<CheckResult[]> {
    return this.page.evaluate((j) => (globalThis as unknown as PageGlobals).transitions.check(j), job);
  }

  async close() {
    await this.browser.close().catch(() => {});
    this.server.close();
  }
}
