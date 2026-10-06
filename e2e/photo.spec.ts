/**
 * The photo suite. Its tests make their own photos (through the API or the New tile), so they stand on their own;
 * like the other suites' they run in order and share a server. The canvas is drawn with WebGPU (the config turns
 * the GPU on); what's checked is the document saved, the files exported, and the canvas's own pixels.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import sharp from "sharp";
import { levelForScale } from "../shared/photo/geometry.ts";
import { hexToLinear, linearToSrgb, srgbToLinear } from "../shared/photo/colour.ts";
import { FILTER_ENTRIES } from "../shared/photo/effects/catalog.ts";
import { flarePreset, flareShape } from "../shared/photo/effects/flare.ts";
import type { GlowParams } from "../shared/photo/effects/glow.ts";
import { flareLight } from "../shared/photo/reference/flare.ts";
import { curvesFor, exposurePixel, type Pixel } from "../shared/photo/reference/adjustments.ts";
import { BLEND_MODES, SPECIAL_FILL, blendSeed } from "../shared/photo/blending.ts";
import { type BlendParams, type Rgba, compositePixel } from "../shared/photo/reference/blend.ts";
import { renderStyled } from "../shared/photo/reference/style.ts";
import { CONTOUR_PRESETS } from "../shared/photo/style/contours.ts";
import { type PatternImage, builtInPatternLevels, patternFromLinear, patternMips } from "../shared/photo/style/patterns.ts";
import { newStyleEffect } from "../shared/photo/style/style.ts";
import { glowReference } from "../shared/photo/reference/glow.ts";
import { boxReduce, sampleMitchell } from "../shared/photo/reference/reduce.ts";

test.describe.configure({ mode: "serial" });

const SAMPLES = path.resolve(import.meta.dirname, "..", "samples");
const PHOTO = path.join(SAMPLES, "photo-1600x1200.jpg");
const STICKER = path.join(SAMPLES, "sticker-800.png");

const savedPhoto = async (page: Page, id: string) => (await page.request.get(`/api/projects/${id}`)).json();

/** Opens an image as the empty photo's canvas (the canvas takes its size), as New's Open an image… does. */
async function openImage(page: Page, file: string) {
  await page.evaluate(() => {
    const input = Object.assign(document.createElement("input"), { type: "file", hidden: true });
    input.dataset.testOpenImage = "";
    input.onchange = () => {
      void (window as unknown as { photoDebug: { photo: { getState(): { placeFiles(files: File[], options: { asCanvas: boolean }): Promise<unknown> } } } }).photoDebug.photo
        .getState()
        .placeFiles([...input.files!], { asCanvas: true });
      input.remove();
    };
    document.body.append(input);
  });
  await page.locator("[data-test-open-image]").setInputFiles(file);
}

async function openNewPhoto(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/projects", { data: { suite: "photo", name } });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/p/${id}`);
  await expect(page.locator('[data-suite="photo"]')).toBeVisible();
  return id;
}

/**
 * The screen's pixel over document point (x, y) of a `width` × `height` photo fitted in the canvas (the fit the
 * canvas starts with: 24 px around it, centred; the tests' screens are 1 device pixel per CSS pixel).
 */
async function canvasPixel(page: Page, size: { width: number; height: number }, x: number, y: number): Promise<number[]> {
  const box = (await page.getByLabel("Photo canvas").boundingBox())!;
  const zoom = Math.min((box.width - 48) / size.width, (box.height - 48) / size.height);
  const left = box.x + box.width / 2 + (x - size.width / 2) * zoom;
  const top = box.y + box.height / 2 + (y - size.height / 2) * zoom;
  return screenPixel(page, left, top);
}

/** The screen's pixel at (x, y) in CSS pixels of the page. */
async function screenPixel(page: Page, x: number, y: number): Promise<number[]> {
  const shot = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 } });
  // A 1×1 PNG: decode it in the page.
  return page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const c = new OffscreenCanvas(1, 1).getContext("2d")!;
    c.drawImage(bitmap, 0, 0);
    return Array.from(c.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, [...shot]);
}

/** The mean colour of a file's pixels around (x, y): what the canvas should show there, give or take resampling. */
async function filePixel(file: string, x: number, y: number): Promise<number[]> {
  const { data } = await sharp(file).extract({ left: x - 4, top: y - 4, width: 9, height: 9 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 3) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  return sum.map((v) => v / 81);
}

const near = (a: number[], b: number[], tolerance: number) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);

interface ViewBox {
  zoom: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the page puts on `window` in development (src/suites/photo/live.ts): the renderer and the stores. */
type DebugWindow = {
  photoDebug: {
    renderer(): Promise<{
      stats: { imageDraws: number; adjustmentPasses: number; resumed: number };
      presented: { revision: number; key: string; current: string; refined: boolean }[];
      revision: number;
      renderView(doc: unknown, view: ViewBox, options?: { refine?: boolean }): Promise<{ texture: { destroy(): void } }>;
      readFloat(texture: unknown, width: number, height: number): Promise<Float32Array>;
      readScreen(): Promise<{ data: Float32Array; width: number; height: number; refined: boolean } | null>;
    }>;
    photo: { getState(): { history: { doc: { doc: { layers: { id: string; kind: string; effect?: { params: Record<string, unknown> } }[] } } }; commit(fn: (doc: unknown) => unknown): void } };
    ui: { getState(): { view: ViewBox } };
    renderState: { getState(): { refine: string } };
  };
};

const screenStats = (page: Page) => page.evaluate(async () => ({ ...(await (window as unknown as DebugWindow).photoDebug.renderer()).stats }));
const refineState = (page: Page) => page.evaluate(() => (window as unknown as DebugWindow).photoDebug.renderState.getState().refine);

/** The open photo rendered by the app's renderer at `view` (zoom 1: level 0), as RGBA floats; `hide` leaves layers out. */
async function renderRegion(page: Page, view: ViewBox, options: { hide?: string[]; refine?: boolean } = {}): Promise<number[]> {
  return page.evaluate(
    async ({ view, hide, refine }) => {
      const { photoDebug } = window as unknown as DebugWindow;
      const r = await photoDebug.renderer();
      const doc = photoDebug.photo.getState().history.doc.doc;
      const shown = { ...doc, layers: doc.layers.map((l) => (hide.includes(l.id) ? { ...l, visible: false } : l)) };
      const { texture } = await r.renderView(shown, view, { refine });
      const data = await r.readFloat(texture, view.width, view.height);
      texture.destroy();
      return Array.from(data);
    },
    { view, hide: options.hide ?? [], refine: options.refine ?? false },
  );
}

/** Pixels of what the screen last showed (floats, before the output transform), and whether it was refined. */
async function screenPixels(page: Page, points: [number, number][]) {
  return page.evaluate(async (points) => {
    const { photoDebug } = window as unknown as DebugWindow;
    const r = await photoDebug.renderer();
    const s = (await r.readScreen())!;
    return { refined: s.refined, view: photoDebug.ui.getState().view, pixels: points.map(([x, y]) => Array.from(s.data.slice((y * s.width + x) * 4, (y * s.width + x) * 4 + 4))) };
  }, points);
}

const pixelAt = (data: number[], width: number, x: number, y: number): Pixel => data.slice((y * width + x) * 4, (y * width + x) * 4 + 4) as Pixel;
const close = (a: readonly number[], b: readonly number[], tolerance: number) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance * Math.max(1, Math.abs(b[i])));

/** Exports the open photo from the export window (PNG, at `bits`) and compares it with the image `mediaId`. */
async function exportAndCompare(page: Page, projectId: string, mediaId: string, bits: 8 | 16 = 8) {
  await page.getByRole("button", { name: "Export" }).click();
  const window = page.locator("[data-window]").filter({ hasText: "Export photo" });
  if (bits === 16) await window.getByRole("radio", { name: "16-bit" }).click();
  const download = page.waitForEvent("download");
  await window.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  await expect(window.locator("[data-export-done]")).toBeVisible();
  await window.getByRole("button", { name: "Close", exact: true }).click();
  const exportId = /exports\/([0-9a-f]+)\/file/.exec(file.url())![1];
  return (await page.request.get(`/api/photo/exports/${exportId}/compare?projectId=${projectId}&mediaId=${mediaId}`)).json();
}

let photoId = "";

test("New asks for a size first, as Photoshop's New Document: a preset, one typed in, or an image; closing it makes nothing", async ({ page }) => {
  await page.goto("/");
  const projects = async () => ((await (await page.request.get("/api/projects")).json()) as unknown[]).length;
  const before = await projects();
  await page.getByRole("button", { name: "New photo" }).click();
  const window = page.locator('[data-window="new-project"]');
  await expect(window).toBeVisible();
  // Cancel (and Esc) make nothing.
  await window.getByRole("button", { name: "Cancel" }).click();
  await expect(window).toHaveCount(0);
  await page.getByRole("button", { name: "New photo" }).click();
  await page.keyboard.press("Escape");
  await expect(window).toHaveCount(0);
  expect(await projects()).toBe(before);

  // A preset fills the size in; a size typed in is Custom; Landscape turns it.
  await page.getByRole("button", { name: "New photo" }).click();
  await window.getByRole("radio", { name: "Square 1000" }).click();
  await expect(window.getByLabel("Width")).toHaveValue("1000");
  await expect(window.getByRole("radio", { name: "Square 1000" })).toHaveAttribute("aria-checked", "true");
  await window.getByLabel("Height").fill("640");
  await expect(window.getByRole("radio", { name: "Custom" })).toHaveAttribute("aria-checked", "true");
  await window.getByRole("radio", { name: "Portrait", exact: true }).click();
  await expect(window.getByLabel("Width")).toHaveValue("640");
  await expect(window.getByLabel("Height")).toHaveValue("1000");
  await window.getByLabel("Height").fill("0");
  await expect(window.getByRole("button", { name: "Create" })).toBeDisabled();
  await window.getByLabel("Height").fill("900");
  await window.getByRole("radio", { name: "Transparent" }).click();
  await window.getByRole("button", { name: "Create" }).click();
  await expect(window).toHaveCount(0);
  await expect(page.locator('[data-suite="photo"]')).toBeVisible();
  await expect(page.locator("[data-photo-status]")).toContainText("640 × 900 px");
  const id = /\/p\/([^/?#]+)/.exec(page.url())![1];
  expect((await savedPhoto(page, id)).canvas).toEqual({ width: 640, height: 900, background: null });

  // Open an image…: the canvas is the image, named after it.
  await page.goto("/");
  await page.getByRole("button", { name: "New photo" }).click();
  await window.locator("[data-new-photo-input]").setInputFiles(PHOTO);
  await expect(page.locator("[data-layer]")).toHaveCount(1);
  await expect(page.locator("[data-photo-status]")).toContainText("1600 × 1200 px");
  await expect(page.locator("[data-photo-header]")).toContainText("photo-1600x1200");
});

test("an image opens as the canvas, drawn by the GPU, and exports bit for bit", async ({ page }) => {
  photoId = await openNewPhoto(page, "Exact");
  await openImage(page, PHOTO);
  await expect(page.locator("[data-layer]")).toHaveCount(1);
  await expect(page.locator("[data-photo-status]")).toContainText("1600 × 1200 px");
  const saved = await expect.poll(async () => (await savedPhoto(page, photoId)).layers.length).toBe(1).then(() => savedPhoto(page, photoId));
  expect(saved.canvas).toEqual({ width: 1600, height: 1200, background: null });
  expect(saved.layers[0].transform).toEqual({ x: 800, y: 600, scaleX: 1, scaleY: 1, rotation: 0 });
  // Its image loaded onto the GPU, and the canvas shows it: the sample's grey-blue middle, not the checkerboard.
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const size = { width: 1600, height: 1200 };
  const expected = await filePixel(PHOTO, 300, 300);
  await expect.poll(async () => near(await canvasPixel(page, size, 300, 300), expected, 10)).toBe(true);

  // Export: a PNG of exactly the file's samples (the gate: an unedited photo round-trips bit for bit).
  await page.getByRole("button", { name: "Export" }).click();
  const window = page.locator("[data-window]").filter({ hasText: "Export photo" });
  const download = page.waitForEvent("download");
  await window.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Exact.png");
  await expect(window.locator("[data-export-done]")).toBeVisible();
  const exportId = /exports\/([0-9a-f]+)\/file/.exec(file.url())![1];
  const compared = await (await page.request.get(`/api/photo/exports/${exportId}/compare?projectId=${photoId}&mediaId=${saved.layers[0].mediaId}`)).json();
  expect(compared).toMatchObject({ width: 1600, height: 1200, differing: 0 });
});

test("a second image is placed, transformed by its handles, and undone in one step", async ({ page }) => {
  await page.goto(`/p/${photoId}`);
  await expect(page.locator("[data-layer]")).toHaveCount(1);
  await page.locator("[data-place-input]").setInputFiles(STICKER);
  await expect(page.locator("[data-layer]")).toHaveCount(2);
  const doc = await expect.poll(async () => (await savedPhoto(page, photoId)).layers.length).toBe(2).then(() => savedPhoto(page, photoId));
  const sticker = doc.layers[1];
  expect(sticker.transform).toMatchObject({ x: 800, y: 600, scaleX: 1, rotation: 0 });
  // Placed on top and selected: its handles show. Drag its bottom-right corner outwards.
  const corner = page.locator('[data-handle="1,1"]');
  await expect(corner).toBeVisible();
  const c = (await corner.boundingBox())!;
  await page.mouse.move(c.x + 4, c.y + 4);
  await page.mouse.down();
  await page.mouse.move(c.x + 40, c.y + 40, { steps: 6 });
  await page.mouse.up();
  const scaled = await expect
    .poll(async () => (await savedPhoto(page, photoId)).layers[1].transform.scaleX)
    .toBeGreaterThan(1.05)
    .then(() => savedPhoto(page, photoId));
  const t = scaled.layers[1].transform;
  expect(t.scaleX).toBeCloseTo(t.scaleY, 6);
  // Its top-left corner stayed where it was.
  expect(t.x - 400 * t.scaleX).toBeCloseTo(400, 3);
  // One undo step for the whole drag.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[1].transform.scaleX).toBe(1);

  // Numbers in Properties: 10% then 100% again is exactly where it was (the source is resampled, never the result).
  const width = page.getByRole("textbox", { name: "W" });
  await width.fill("10");
  await width.press("Enter");
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[1].transform.scaleX).toBe(0.1);
  await width.fill("100");
  await width.press("Enter");
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[1].transform).toEqual(sticker.transform);

  // Arrow keys nudge (on the canvas, not in a field); a burst of them is one undo step. (The canvas's middle is
  // the selected sticker: a click there keeps it selected.)
  await page.getByLabel("Photo canvas").click();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[1].transform).toMatchObject({ x: 803, y: 610 });
  await page.waitForTimeout(700);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[1].transform).toMatchObject({ x: 800, y: 600 });
});

test("layers hide, reorder, rename and delete; a reload keeps everything", async ({ page }) => {
  await page.goto(`/p/${photoId}`);
  const rows = page.locator("[data-layer]");
  await expect(rows).toHaveCount(2);
  const top = rows.first();
  await top.getByRole("button", { name: "Hide" }).click();
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[1].visible).toBe(false);
  await top.locator("[data-layer-name]").dblclick();
  await page.keyboard.type("Sticker!");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[1].name).toBe("Sticker!");
  await top.click();
  await page.getByRole("button", { name: "Move down" }).click();
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[0].name).toBe("Sticker!");
  await page.reload();
  await expect(page.locator("[data-layer]").last()).toContainText("Sticker!");
  await page.locator("[data-layer]").last().click();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers.length).toBe(1);
});

test("a renamed photo's package moves, and it still opens with its images", async ({ page }) => {
  await page.goto(`/p/${photoId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const before = (await (await page.request.get("/api/projects")).json()).find((p: { id: string }) => p.id === photoId).path;
  await page.locator("[data-photo-header]").getByTitle("Rename project").click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Moved");
  await page.keyboard.press("Enter");
  // Its package follows its name once it's closed.
  await page.getByRole("button", { name: "Home" }).click();
  await expect
    .poll(async () => (await (await page.request.get("/api/projects")).json()).find((p: { id: string }) => p.id === photoId).path)
    .toMatch(/Moved\.vaudio$/);
  expect(before).toMatch(/Exact\.vaudio$/);
  await page.goto(`/p/${photoId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
});

test("images dropped on Home start a photo the size of the first", async ({ page }) => {
  await page.goto("/");
  const bytes = [...(await import("node:fs/promises").then((fs) => fs.readFile(STICKER)))];
  const transfer = await page.evaluateHandle((data) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(data)], "sticker-800.png", { type: "image/png" }));
    return t;
  }, bytes);
  const home = page.locator("main[aria-label=Home]").locator("..");
  await home.dispatchEvent("dragenter", { dataTransfer: transfer });
  await home.dispatchEvent("dragover", { dataTransfer: transfer });
  await home.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator('[data-suite="photo"]')).toBeVisible();
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await expect(page.locator("[data-photo-status]")).toContainText("800 × 800 px");
  // Named after the image (Photoshop's document takes the file's name).
  await expect(page.locator("[data-photo-header]")).toContainText("sticker-800");
});

test("a duplicated photo keeps its images", async ({ page }) => {
  const copy = await (await page.request.post(`/api/projects/${photoId}/duplicate`)).json();
  await page.goto(`/p/${copy.id}`);
  await expect(page.locator("[data-layer]")).toHaveCount(1);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
});

test("the assistant reads, arranges and looks at the photo", async ({ page }) => {
  const id = await openNewPhoto(page, "Assisted");
  await openImage(page, PHOTO);
  await expect(page.locator("[data-layer]")).toHaveCount(1);
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      "call get_photo",
      'call set_canvas {"width": 1280, "height": 720, "background": "#000000", "anchor": "centre"}',
      'call transform_layer {"layer": "photo 1600x1200", "fit": "cover"}',
      'call set_layer {"layer": "nope"}',
      'call view_photo {"width": 320}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("set_layer: failed, view_photo: ok", { timeout: 30_000 });
  const doc = await expect.poll(async () => (await savedPhoto(page, id)).canvas.width).toBe(1280).then(() => savedPhoto(page, id));
  expect(doc.canvas).toEqual({ width: 1280, height: 720, background: "#000000" });
  expect(doc.layers[0].transform).toMatchObject({ x: 640, y: 360, scaleX: 0.8, scaleY: 0.8 });
});

// --- F2: adjustment layers, the render plan and refinement ---

let adjustedId = "";

test("an Exposure layer brightens what's below: a slider drag is one undo step and re-renders only the adjustment", async ({ page }) => {
  adjustedId = await openNewPhoto(page, "Adjusted");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  // Its thumbnail is the layer as it's composited, rendered by the GPU.
  await expect(page.locator('[data-thumbnail="rendered"]')).toHaveCount(1);

  await page.getByRole("button", { name: "New adjustment layer" }).click();
  await page.getByRole("menuitem", { name: /Exposure/ }).click();
  await expect(page.locator("[data-layer]")).toHaveCount(2);
  await expect(page.locator('[data-layer][data-kind="adjustment"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-adjustment="exposure"]')).toBeVisible();
  const added = await expect.poll(async () => (await savedPhoto(page, adjustedId)).layers.length).toBe(2).then(() => savedPhoto(page, adjustedId));
  const adjustment = added.layers[1];
  expect(adjustment).toMatchObject({ kind: "adjustment", name: "Exposure", effect: { type: "exposure", params: { exposure: 0, offset: 0, gamma: 1 } } });

  // Drag the Exposure slider: frames come while it moves, and only the adjustment runs again.
  const before = await screenStats(page);
  const thumb = page.locator('[data-param="exposure"] [role="slider"]');
  const box = (await thumb.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(box.x + box.width / 2 + i * 3, box.y + box.height / 2);
    await page.waitForTimeout(40);
  }
  await page.mouse.up();
  const after = await screenStats(page);
  expect(after.adjustmentPasses - before.adjustmentPasses).toBeGreaterThanOrEqual(3);
  // The image below is drawn once (the drag's first frame keeps it), then resumed from.
  expect(after.imageDraws - before.imageDraws).toBeLessThanOrEqual(1);
  expect(after.resumed - before.resumed).toBeGreaterThanOrEqual(2);
  const dragged = await expect.poll(async () => (await savedPhoto(page, adjustedId)).layers[1].effect.params.exposure).toBeGreaterThan(0).then(() => savedPhoto(page, adjustedId));
  const params = dragged.layers[1].effect.params;

  // The GPU's result is the CPU reference's: × 2^stops in linear light.
  const region = { zoom: 1, x: 700, y: 500, width: 32, height: 32 };
  const below = await renderRegion(page, region, { hide: [adjustment.id] });
  const above = await renderRegion(page, region);
  for (let y = 0; y < 32; y += 3) {
    for (let x = 0; x < 32; x += 3) {
      const expected = exposurePixel(pixelAt(below, 32, x, y), params);
      expect(close(pixelAt(above, 32, x, y), expected, 2e-3)).toBe(true);
    }
  }

  // The whole drag is one undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, adjustedId)).layers[1].effect.params.exposure).toBe(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await savedPhoto(page, adjustedId)).layers[1].effect.params.exposure).toBe(params.exposure);
});

test("Exposure at a reduced level equals the full-resolution render reduced", async ({ page }) => {
  await page.goto(`/p/${adjustedId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  // Exposure (no gamma) commutes with reduction: the view's level is already the answer, at every level.
  for (const zoom of [0.5, 0.25, 0.125]) {
    const view = { zoom, x: 0, y: 0, width: Math.round(1600 * zoom), height: Math.round(1200 * zoom) };
    const direct = await renderRegion(page, view, { refine: false });
    const reduced = await renderRegion(page, view, { refine: true });
    let worst = 0;
    // Away from the canvas's edges (where the two treat the outside the same, but sample it differently).
    for (let y = 4; y < view.height - 4; y++) {
      for (let x = 4; x < view.width - 4; x++) {
        for (let c = 0; c < 4; c++) {
          const i = (y * view.width + x) * 4 + c;
          worst = Math.max(worst, Math.abs(direct[i] - reduced[i]) / Math.max(1, Math.abs(reduced[i])));
        }
      }
    }
    expect(worst, `zoom ${zoom}`).toBeLessThan(4e-3);
  }
});

let curvesLayer = "";

test("Curves drawn on the graph refine below 100% to the full-resolution result, and identity curves are exact", async ({ page }) => {
  await page.goto(`/p/${adjustedId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  // The exposure layer goes (deleted), Curves comes on top of the photo.
  await page.locator('[data-layer][data-kind="adjustment"]').click();
  await page.keyboard.press("Delete");
  await expect(page.locator("[data-layer]")).toHaveCount(1);
  await page.getByRole("button", { name: "New adjustment layer" }).click();
  await page.getByRole("menuitem", { name: /Curves/ }).click();
  const graph = page.locator("[data-curves-editor] svg");
  await expect(graph).toBeVisible();
  // A point added at input 64 and dragged up lifts the shadows.
  const g = (await graph.boundingBox())!;
  const at = (x: number, y: number) => ({ x: g.x + (x / 255) * g.width, y: g.y + (1 - y / 255) * g.height });
  await page.mouse.move(at(64, 64).x, at(64, 64).y);
  await page.mouse.down();
  await page.mouse.move(at(64, 100).x, at(64, 100).y, { steps: 5 });
  await page.mouse.up();
  const doc = await expect.poll(async () => (await savedPhoto(page, adjustedId)).layers[1]?.effect?.params.curves?.rgb.length).toBe(3).then(() => savedPhoto(page, adjustedId));
  curvesLayer = doc.layers[1].id;
  const [, middle] = doc.layers[1].effect.params.curves.rgb;
  expect(middle[0]).toBe(64);
  expect(middle[1]).toBeGreaterThan(90);
  // One undo step for the click and the drag.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, adjustedId)).layers[1].effect.params.curves.rgb.length).toBe(2);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await savedPhoto(page, adjustedId)).layers[1].effect.params.curves.rgb.length).toBe(3);

  // The GPU's curves are the CPU reference's (the encoded values through the spline).
  const region = { zoom: 1, x: 300, y: 300, width: 24, height: 24 };
  const below = await renderRegion(page, region, { hide: [curvesLayer] });
  const shaped = await renderRegion(page, region);
  const reference = curvesFor((await savedPhoto(page, adjustedId)).layers[1].effect.params.curves);
  for (let i = 0; i < 24 * 24; i += 7) expect(close(shaped.slice(i * 4, i * 4 + 4), reference(below.slice(i * 4, i * 4 + 4) as Pixel), 3e-3)).toBe(true);

  // Below 100% (the fit, then half that), the screen shows the full-resolution render reduced, once it's refined.
  for (const step of ["fit", "out"]) {
    if (step === "out") await page.keyboard.press("ControlOrMeta+-");
    await expect.poll(() => refineState(page), { timeout: 15_000 }).toBe("refined");
    await expect(page.locator('[data-refine="settled"]')).toHaveCount(1);
    const view = await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.ui.getState().view);
    expect(view.zoom).toBeLessThan(1);
    const level = levelForScale(view.zoom, 32);
    const s = 2 ** level;
    const stretch = Math.max(1, 1 / s / view.zoom);
    // Screen pixels over the photo, and each one's level-0 neighbourhood reduced on the CPU.
    const points: [number, number][] = [];
    for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.25, 0.6]) points.push([Math.round((1600 * fx - view.x) * view.zoom), Math.round((1200 * fy - view.y) * view.zoom)]);
    const shown = await screenPixels(page, points);
    expect(shown.refined).toBe(true);
    for (const [i, [px, py]] of points.entries()) {
      const p = { x: (view.x + (px + 0.5) / view.zoom) / s, y: (view.y + (py + 0.5) / view.zoom) / s };
      const lx0 = Math.floor(p.x - 0.5) - 6;
      const ly0 = Math.floor(p.y - 0.5) - 6;
      const side = 14;
      const full = await renderRegion(page, { zoom: 1, x: lx0 * s, y: ly0 * s, width: side * s, height: side * s });
      let image = { width: side * s, height: side * s, data: Float64Array.from(full) };
      for (let k = 0; k < level; k++) image = boxReduce(image) as typeof image;
      const expected = sampleMitchell(image, p.x - lx0, p.y - ly0, stretch);
      expect(close(shown.pixels[i], expected, 4e-3), `${step} point ${i}: ${shown.pixels[i]} vs ${expected}`).toBe(true);
    }
  }

  // Back to the identity: it's left out of the plan, so an unedited photo still exports bit for bit.
  await page.getByRole("button", { name: "Reset" }).click();
  await expect.poll(async () => (await savedPhoto(page, adjustedId)).layers[1].effect.params.curves.rgb.length).toBe(2);
  await expect.poll(() => refineState(page)).toBe("none");
  const compared = await exportAndCompare(page, adjustedId, doc.layers[0].mediaId);
  expect(compared).toMatchObject({ width: 1600, height: 1200, differing: 0 });
});

test("rapid edits never show a stale refinement", async ({ page }) => {
  await page.goto(`/p/${adjustedId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+0");
  // Scripted edits of the curve, some quicker than a refinement, some slower.
  const gaps = [20, 30, 260, 15, 40, 400, 25, 180, 10, 60, 320, 35, 15, 220, 50];
  for (const [i, gap] of gaps.entries()) {
    await page.evaluate(
      ({ id, lift }) => {
        const { photo } = (window as unknown as DebugWindow).photoDebug;
        photo.getState().commit((doc) => {
          const d = doc as { layers: { id: string; effect?: { params: Record<string, unknown> } }[] };
          return {
            ...d,
            layers: d.layers.map((l) => (l.id === id ? { ...l, effect: { ...l.effect, params: { curves: { rgb: [[0, 0], [96, lift], [255, 255]], red: [[0, 0], [255, 255]], green: [[0, 0], [255, 255]], blue: [[0, 0], [255, 255]] } } } } : l)),
          };
        });
      },
      { id: curvesLayer, lift: 100 + i * 7 },
    );
    await page.waitForTimeout(gap);
  }
  await expect.poll(() => refineState(page), { timeout: 15_000 }).toBe("refined");
  const result = await page.evaluate(async () => {
    const { photoDebug } = window as unknown as DebugWindow;
    const r = await photoDebug.renderer();
    const log = r.presented.slice();
    // What's shown now against a fresh refinement of the document as it is.
    const view = photoDebug.ui.getState().view;
    const screen = (await r.readScreen())!;
    const { texture } = await r.renderView(photoDebug.photo.getState().history.doc.doc, { ...view, width: screen.width, height: screen.height }, { refine: true });
    const fresh = await r.readFloat(texture, screen.width, screen.height);
    texture.destroy();
    let worst = 0;
    for (let i = 0; i < fresh.length; i++) worst = Math.max(worst, Math.abs(fresh[i] - screen.data[i]));
    return { log, revision: r.revision, worst, refined: screen.refined };
  });
  // Every frame showed what was current when it was drawn; the last is the refinement of the last edit.
  for (const frame of result.log) expect(frame.key).toBe(frame.current);
  const last = result.log.at(-1)!;
  expect(last).toMatchObject({ refined: true, revision: result.revision });
  expect(result.refined).toBe(true);
  expect(result.worst).toBeLessThan(1e-6);
});

test("layers reorder by dragging, as one undo step", async ({ page }) => {
  await page.goto(`/p/${adjustedId}`);
  await expect(page.locator("[data-layer]")).toHaveCount(2);
  const rows = page.locator("[data-layer]");
  // Top row (Curves) dragged below the photo.
  const top = (await rows.first().boundingBox())!;
  const bottom = (await rows.last().boundingBox())!;
  await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
  await page.mouse.down();
  await page.mouse.move(top.x + top.width / 2, bottom.y + bottom.height - 2, { steps: 8 });
  await expect(page.locator("[data-drop-line]")).toHaveCount(1);
  await page.mouse.up();
  await expect.poll(async () => (await savedPhoto(page, adjustedId)).layers.map((l: { kind: string }) => l.kind)).toEqual(["adjustment", "image"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, adjustedId)).layers.map((l: { kind: string }) => l.kind)).toEqual(["image", "adjustment"]);
});

test("a 16-bit photo keeps its precision through the composite and a 16-bit export", async ({ page }) => {
  // A 16-bit ramp no 8-bit (or f16) path could keep: a different value every column, in steps of 37.
  const width = 1024;
  const height = 48;
  const samples = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      samples[i] = x * 37 + y;
      samples[i + 1] = 65535 - x * 41;
      samples[i + 2] = (x * 61 + y * 13) % 65536;
    }
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-16-"));
  const file = path.join(dir, "ramp-16bit.png");
  // sharp reads a Uint16Array's raw samples as 16-bit.
  await sharp(samples, { raw: { width, height, channels: 3 } }).toColourspace("rgb16").png().toFile(file);
  const id = await openNewPhoto(page, "Deep");
  await openImage(page, file);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const doc = await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(1).then(() => savedPhoto(page, id));
  const compared = await exportAndCompare(page, id, doc.layers[0].mediaId, 16);
  expect(compared.width).toBe(width);
  // Within one 16-bit step everywhere (an f16 composite would be several steps off).
  expect(compared.maxDifference).toBeLessThanOrEqual(1);
  await fs.rm(dir, { recursive: true, force: true });
});

test("the assistant adds and changes adjustment layers", async ({ page }) => {
  await page.goto(`/p/${adjustedId}`);
  await expect(page.locator("[data-layer]")).toHaveCount(2);
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_adjustment {"type": "exposure", "params": {"exposure": 0.5}, "name": "Brighter"}',
      'call set_effect_params {"layer": "Brighter", "params": {"gamma": 1.2}}',
      'call set_effect_params {"layer": "Brighter", "params": {"exposure": 99}}',
      'call set_layer {"layer": "Brighter", "opacity": 0.5, "order": 0}',
      "call get_photo",
      'call view_photo {"width": 256}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("set_effect_params: failed, set_layer: ok, get_photo: ok, view_photo: ok", { timeout: 30_000 });
  const doc = await expect.poll(async () => (await savedPhoto(page, adjustedId)).layers.length).toBe(3).then(() => savedPhoto(page, adjustedId));
  expect(doc.layers[0]).toMatchObject({ kind: "adjustment", name: "Brighter", opacity: 0.5, effect: { params: { exposure: 0.5, offset: 0, gamma: 1.2 } } });
});

// --- Picking, cursors, smart guides and the tabs ---

let pickingId = "";

/** Where document point (x, y) is on the page (CSS pixels), from the canvas's view. */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await page.getByLabel("Photo canvas").boundingBox())!;
  const { view, dpr } = await page.evaluate(() => ({ view: (window as unknown as DebugWindow).photoDebug.ui.getState().view, dpr: devicePixelRatio }));
  return { x: box.x + ((x - view.x) * view.zoom) / dpr, y: box.y + ((y - view.y) * view.zoom) / dpr };
}

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

/** A point of the canvas panel off the photo (the pasteboard, inside the fit's margin), in page pixels. */
async function pasteboardPoint(page: Page) {
  const box = (await page.getByLabel("Photo canvas").boundingBox())!;
  return { x: box.x + 8, y: box.y + 8 };
}

test("clicking the canvas picks the layer under the pointer, outlined while it's hovered (Auto-Select); a click on nothing selects nothing", async ({ page }) => {
  pickingId = await openNewPhoto(page, "Picking");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await page.locator("[data-place-input]").setInputFiles(STICKER);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(2);
  const doc = await expect.poll(async () => (await savedPhoto(page, pickingId)).layers.length).toBe(2).then(() => savedPhoto(page, pickingId));
  const [photo, sticker] = doc.layers.map((l: { id: string }) => l.id);
  const row = (id: string) => page.locator(`[data-layer="${id}"]`);

  // The photo selected by its row; the sticker (in the middle) clicked on the canvas: picked.
  await row(photo).click();
  await expect(row(photo)).toHaveAttribute("aria-selected", "true");
  const middle = await screenOf(page, 800, 600);
  await page.mouse.move(middle.x, middle.y);
  await expect(page.locator(`[data-hover-outline="${sticker}"]`)).toBeVisible();
  await page.mouse.click(middle.x, middle.y);
  await expect(row(sticker)).toHaveAttribute("aria-selected", "true");
  // Over the photo alone (near a corner): it's outlined, and a click picks it.
  const corner = await screenOf(page, 100, 100);
  await page.mouse.move(corner.x, corner.y);
  await expect(page.locator(`[data-hover-outline="${photo}"]`)).toBeVisible();
  await page.mouse.click(corner.x, corner.y);
  await expect(row(photo)).toHaveAttribute("aria-selected", "true");
  // Where there's no layer (the pasteboard), a click selects nothing (Photoshop's); the pasteboard is the theme's
  // stage colour, not black.
  const outside = await pasteboardPoint(page);
  await page.mouse.click(outside.x, outside.y);
  await expect(row(photo)).toHaveAttribute("aria-selected", "false");
  await expect(page.locator("[data-transform-overlay]")).toHaveCount(0);
  const stage = await page.locator("[data-photo-canvas]").evaluate((e) => {
    const c = document.createElement("canvas").getContext("2d")!;
    c.fillStyle = getComputedStyle(e).backgroundColor;
    c.fillRect(0, 0, 1, 1);
    return Array.from(c.getImageData(0, 0, 1, 1).data.slice(0, 3));
  });
  expect(near(await screenPixel(page, outside.x + 2, outside.y + 2), stage, 2)).toBe(true);
  await page.mouse.click(corner.x, corner.y);
  await expect(row(photo)).toHaveAttribute("aria-selected", "true");
  // ⌘ held does the opposite: the click doesn't pick.
  await page.keyboard.down(MOD_KEY);
  await page.mouse.click(middle.x, middle.y);
  await page.keyboard.up(MOD_KEY);
  await expect(row(photo)).toHaveAttribute("aria-selected", "true");

  // Auto-Select is a setting (on unless turned off): off, a click doesn't pick.
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = page.getByRole("region", { name: "Settings" });
  const toggle = settings.getByRole("switch", { name: "Auto-select" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await settings.getByRole("button", { name: "Close Settings" }).click();
  await page.mouse.click(middle.x, middle.y);
  await expect(row(photo)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+Comma");
  await settings.getByRole("switch", { name: "Auto-select" }).click();
  await settings.getByRole("button", { name: "Close Settings" }).click();
});

test("handles' pointers show the way they pull, turned with the layer, and a rotate pointer outside the corners", async ({ page }) => {
  await page.goto(`/p/${pickingId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(2);
  await page.locator("[data-layer]").first().click();
  const handle = (h: string) => page.locator(`[data-handle="${h}"]`);
  await expect(handle("1,1")).toHaveAttribute("data-cursor", "nwse-resize");
  await expect(handle("0,1")).toHaveAttribute("data-cursor", "nesw-resize");
  await expect(handle("0.5,0")).toHaveAttribute("data-cursor", "ns-resize");
  await expect(handle("1,0.5")).toHaveAttribute("data-cursor", "ew-resize");
  const rotateCursor = (h: string) => page.locator(`[data-rotate-zone="${h}"]`).evaluate((e) => (e as SVGElement).style.cursor);
  expect(await rotateCursor("1,1")).toMatch(/^url\(/);
  // Each corner's curved arrow bows around that corner.
  expect(new Set(await Promise.all(["0,0", "1,0", "1,1", "0,1"].map(rotateCursor))).size).toBe(4);
  // Turned a right angle: the bottom-right corner now pulls down-left, the top edge sideways.
  const angle = page.getByRole("textbox", { name: "Angle" });
  await angle.fill("90");
  await angle.press("Enter");
  await expect(handle("1,1")).toHaveAttribute("data-cursor", "nesw-resize");
  await expect(handle("0.5,0")).toHaveAttribute("data-cursor", "ew-resize");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(handle("1,1")).toHaveAttribute("data-cursor", "nwse-resize");
});

test("moving and resizing snap to the canvas and other layers with guides; Control held or Snap off doesn't", async ({ page }) => {
  await page.goto(`/p/${pickingId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(2);
  await page.locator("[data-layer]").first().click();
  const sticker = async () => (await savedPhoto(page, pickingId)).layers[1].transform;
  // The 800 × 800 sticker is centred on the 1600 × 1200 canvas. Away from everything first.
  const drag = async (fromDoc: { x: number; y: number }, toDoc: { x: number; y: number }, during?: () => Promise<void>) => {
    const a = await screenOf(page, fromDoc.x, fromDoc.y);
    const b = await screenOf(page, toDoc.x, toDoc.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await during?.();
    await page.mouse.up();
  };
  await drag({ x: 800, y: 600 }, { x: 910, y: 600 });
  await expect.poll(async () => (await sticker()).x).toBeGreaterThan(890);
  // Back to 4 px from the canvas's centre: it snaps there, with a guide on the centre line while it's held.
  const from = (await sticker()).x;
  await drag({ x: from, y: 600 }, { x: 804, y: 600 }, async () => {
    await expect(page.locator('[data-guide="x:800"]')).toHaveCount(1);
  });
  await expect.poll(async () => (await sticker()).x).toBe(800);
  await expect(page.locator("[data-snap-guides]")).toHaveCount(0);
  // Control held: no snapping.
  await drag({ x: 800, y: 600 }, { x: 905, y: 600 });
  await expect.poll(async () => (await sticker()).x).toBeGreaterThan(890);
  const away = (await sticker()).x;
  const a = await screenOf(page, away, 600);
  const b = await screenOf(page, 804, 600);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.keyboard.down("Control");
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  await expect.poll(async () => Math.abs((await sticker()).x - 804)).toBeLessThan(2);
  // Snap off (the magnet over the canvas): no snapping either.
  const snap = page.getByRole("button", { name: "Snap" });
  await expect(snap).toHaveAttribute("aria-pressed", "true");
  await snap.click();
  await expect(snap).toHaveAttribute("aria-pressed", "false");
  const now = (await sticker()).x;
  await drag({ x: now, y: 600 }, { x: 798, y: 600 });
  await expect.poll(async () => Math.abs((await sticker()).x - 798)).toBeLessThan(2);
  await snap.click();
  await expect(snap).toHaveAttribute("aria-pressed", "true");

  // Resizing: the right edge dragged 3 px short of the canvas's right edge lands on it.
  const t = await sticker();
  const right = t.x + 400 * t.scaleX;
  await drag({ x: right, y: 600 }, { x: 1597, y: 600 }, async () => {
    await expect(page.locator('[data-guide="x:1600"]')).toHaveCount(1);
  });
  await expect.poll(async () => {
    const r = await sticker();
    return Math.round((r.x + 400 * r.scaleX) * 1e6) / 1e6;
  }).toBe(1600);
});

test("several layers are selected (Layers, Shift on the canvas, a marquee), moved together, arranged and merged", async ({ page }) => {
  await page.goto(`/p/${pickingId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(2);
  const before = await savedPhoto(page, pickingId);
  const [photo, sticker] = before.layers.map((l: { id: string }) => l.id);
  const row = (id: string) => page.locator(`[data-layer="${id}"]`);
  const selected = async (...ids: string[]) => {
    for (const id of [photo, sticker]) await expect(row(id)).toHaveAttribute("aria-selected", String(ids.includes(id)));
  };
  // Dragging over rows never selects their text.
  await expect(page.locator("[data-layers-panel]")).toHaveCSS("user-select", "none");

  // In Layers: a click, ⌘-click adds; Properties says how many; a click below the rows selects nothing.
  await row(photo).click();
  await row(sticker).click({ modifiers: ["ControlOrMeta"] });
  await selected(photo, sticker);
  await expect(page.locator("[data-several-layers]")).toHaveAttribute("data-several-layers", "2");
  await expect(page.locator('[data-transform-overlay][data-layers="2"]')).toBeVisible();
  await expect(page.locator("[data-selected-outline]")).toHaveCount(2);
  const list = (await page.locator('ul[aria-label="Layers"]').boundingBox())!;
  await page.mouse.click(list.x + list.width / 2, list.y + list.height - 8);
  await selected();
  // Shift-click selects the run from the active row.
  await row(sticker).click();
  await row(photo).click({ modifiers: ["Shift"] });
  await selected(photo, sticker);

  // On the canvas: Shift-click adds the layer under the pointer, or takes it out.
  const nothing = await pasteboardPoint(page);
  await page.mouse.click(nothing.x, nothing.y);
  await selected();
  const corner = await screenOf(page, 100, 100);
  const t = before.layers[1].transform;
  const middle = await screenOf(page, t.x, t.y);
  await page.mouse.click(corner.x, corner.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(middle.x, middle.y);
  await selected(photo, sticker);
  await page.mouse.click(middle.x, middle.y);
  await selected(photo);
  await page.keyboard.up("Shift");
  // A marquee from the pasteboard selects what it touches.
  await page.mouse.click(nothing.x, nothing.y);
  const marquee = async (to: { x: number; y: number }) => {
    await page.mouse.move(nothing.x, nothing.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await expect(page.locator("[data-marquee]")).toBeVisible();
    await page.mouse.up();
    await expect(page.locator("[data-marquee]")).toHaveCount(0);
  };
  await marquee(await screenOf(page, 20, 20));
  await selected(photo);
  await marquee(middle);
  await selected(photo, sticker);

  // Both move together, as one undo step.
  const target = await screenOf(page, t.x + 40, t.y + 30);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  const moved = await expect.poll(async () => (await savedPhoto(page, pickingId)).layers[0].transform.x).toBeGreaterThan(820).then(() => savedPhoto(page, pickingId));
  const dx = moved.layers[0].transform.x - before.layers[0].transform.x;
  expect(moved.layers[1].transform.x - t.x).toBeCloseTo(dx, 6);
  expect(moved.layers[1].transform.y - t.y).toBeCloseTo(moved.layers[0].transform.y - before.layers[0].transform.y, 6);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, pickingId)).layers.map((l: { transform: unknown }) => l.transform)).toEqual(before.layers.map((l: { transform: unknown }) => l.transform));

  // Photoshop's Layers keys: ⌥⌘A selects every layer, ⌥[ the one below, ⌘] brings it forward.
  await page.mouse.click(nothing.x, nothing.y);
  await page.keyboard.press("Alt+ControlOrMeta+KeyA");
  await selected(photo, sticker);
  await page.mouse.click(middle.x, middle.y);
  await page.keyboard.press("Alt+BracketLeft");
  await selected(photo);
  await page.keyboard.press("ControlOrMeta+BracketRight");
  await expect.poll(async () => (await savedPhoto(page, pickingId)).layers.map((l: { id: string }) => l.id)).toEqual([sticker, photo]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, pickingId)).layers.map((l: { id: string }) => l.id)).toEqual([photo, sticker]);

  // ⌘E merges them into one image layer that looks the same, named after the top one, as one undo step.
  const points: [number, number][] = [[100, 100], [t.x, t.y], [t.x + 300, t.y - 200]];
  const shown = async () => Promise.all(points.map(([x, y]) => canvasPixel(page, { width: 1600, height: 1200 }, x, y)));
  const look = await shown();
  await page.keyboard.press("Alt+ControlOrMeta+KeyA");
  await page.keyboard.press("ControlOrMeta+e");
  await expect(page.locator("[data-layer]")).toHaveCount(1);
  const merged = await expect.poll(async () => (await savedPhoto(page, pickingId)).layers.length).toBe(1).then(() => savedPhoto(page, pickingId));
  expect(merged.layers[0]).toMatchObject({ kind: "image", name: before.layers[1].name, transform: { x: 800, y: 600, scaleX: 1, scaleY: 1, rotation: 0 } });
  expect([photo, sticker]).not.toContain(merged.layers[0].id);
  await expect(page.locator(`[data-layer="${merged.layers[0].id}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await expect.poll(async () => (await shown()).every((p, i) => near(p, look[i], 3))).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-layer]")).toHaveCount(2);

  // The Layers menu: a right-click on a row; Merge Down takes the layer below's name.
  await row(sticker).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Merge Down" }).click();
  await expect.poll(async () => (await savedPhoto(page, pickingId)).layers.map((l: { name: string }) => l.name)).toEqual([before.layers[0].name]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, pickingId)).layers.map((l: { id: string }) => l.id)).toEqual([photo, sticker]);
});

test("files dropped on the tabs start a new project, named after the image", async ({ page }) => {
  await page.goto(`/p/${pickingId}`);
  await expect(page.locator("[data-layer]")).toHaveCount(2);
  // A second tab, so the strip shows.
  await openNewPhoto(page, "Another");
  const tabs = page.getByRole("tablist", { name: "Open projects" });
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  const bytes = [...(await fs.readFile(STICKER))];
  const transfer = await page.evaluateHandle((data) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(data)], "sticker-800.png", { type: "image/png" }));
    return t;
  }, bytes);
  await tabs.dispatchEvent("dragenter", { dataTransfer: transfer });
  await tabs.dispatchEvent("dragover", { dataTransfer: transfer });
  await expect(tabs.locator("[data-drop-tab]")).toBeVisible();
  await tabs.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(tabs.getByRole("tab", { name: "sticker-800" })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await expect(page.locator("[data-photo-header]")).toContainText("sticker-800");
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await expect(page.locator("[data-photo-status]")).toContainText("800 × 800 px");
  // Saved under that name.
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect.poll(async () => (await savedPhoto(page, id)).name).toBe("sticker-800");
});

test("images dragged into a photo are placed as layers where they're dropped, and selected", async ({ page }) => {
  const id = await openNewPhoto(page, "Dropped");
  await expect(page.locator("[data-photo-status]")).toContainText("1080 × 1920 px");
  const transferOf = (name: string, type: string, data: number[]) =>
    page.evaluateHandle(({ name, type, data }) => {
      const t = new DataTransfer();
      t.items.add(new File([new Uint8Array(data)], name, { type }));
      return t;
    }, { name, type, data });
  const canvas = page.getByLabel("Photo canvas");
  const point = await screenOf(page, 300, 500);
  const sticker = await transferOf("sticker-800.png", "image/png", [...(await fs.readFile(STICKER))]);
  await canvas.dispatchEvent("dragenter", { dataTransfer: sticker });
  await canvas.dispatchEvent("dragover", { dataTransfer: sticker, clientX: point.x, clientY: point.y });
  await expect(page.locator("[data-image-drop]")).toContainText("Drop to place as layers");
  await canvas.dispatchEvent("drop", { dataTransfer: sticker, clientX: point.x, clientY: point.y });
  await expect(page.locator("[data-image-drop]")).toHaveCount(0);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await expect(page.locator("[data-layer]")).toHaveAttribute("aria-selected", "true");
  // The canvas keeps its size (it's placed, not opened); the image is centred on the drop, fitted in the canvas.
  await expect(page.locator("[data-photo-status]")).toContainText("1080 × 1920 px");
  const doc = await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(1).then(() => savedPhoto(page, id));
  expect(doc.canvas).toMatchObject({ width: 1080, height: 1920 });
  // (Within a screen pixel: at this zoom one is about two of the photo's.)
  const { x, y, scaleX, scaleY } = doc.layers[0].transform;
  expect([Math.abs(x - 300) <= 3, Math.abs(y - 500) <= 3, scaleX, scaleY]).toEqual([true, true, 1, 1]);

  // Something that isn't an image is turned away.
  const text = await transferOf("notes.txt", "text/plain", [...Buffer.from("hello")]);
  await canvas.dispatchEvent("dragenter", { dataTransfer: text });
  await canvas.dispatchEvent("drop", { dataTransfer: text, clientX: point.x, clientY: point.y });
  await expect(page.getByText("notes.txt isn't an image")).toBeVisible();
  await expect(page.locator("[data-layer]")).toHaveCount(1);
});

// --- F3: resources, selections, masks and the brush ---

type PaintWindow = {
  photoDebug: {
    paint(layerId: string, part: "content" | "mask", points: { x: number; y: number }[], options?: { radius?: number; hardness?: number; strength?: number; colour?: number[]; cancel?: boolean }): Promise<{ id: string; tiles: number; commitMs: number } | null>;
    renderer(): Promise<{
      readSurfaceTile(layerId: string, part: "content" | "mask", tx: number, ty: number): Promise<{ shown: string | null; data: Float32Array | null }>;
      readScreen(): Promise<{ data: Float32Array } | null>;
    }>;
    ui: { getState(): { setView(view: ViewBox): void; view: ViewBox } };
  };
};

/** Samples along a line, every few pixels (as a pointer gives them). */
const line = (x0: number, y0: number, x1: number, y1: number, step = 3) => {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));
};

const paint = (page: Page, layerId: string, part: "content" | "mask", points: { x: number; y: number }[], options: { radius?: number; hardness?: number; colour?: number[]; cancel?: boolean } = {}) =>
  page.evaluate(({ layerId, part, points, options }) => (window as unknown as PaintWindow).photoDebug.paint(layerId, part, points, options), { layerId, part, points, options });

/**
 * A surface's level-0 tiles as the GPU holds them: a SHA-256 of each one's floats (null where it shows its fill),
 * and, optionally, the value of some of its texels (`at`: [tx, ty, x, y, channel]).
 */
const surfaceTiles = (page: Page, layerId: string, part: "content" | "mask", tiles: [number, number][], at: [number, number, number, number, number][] = []) =>
  page.evaluate(
    async ({ layerId, part, tiles, at }) => {
      const r = await (window as unknown as PaintWindow).photoDebug.renderer();
      const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
      const digests: (string | null)[] = [];
      let shown: string | null = null;
      for (const [tx, ty] of tiles) {
        const t = await r.readSurfaceTile(layerId, part, tx, ty);
        shown = t.shown;
        digests.push(t.data ? hex(await crypto.subtle.digest("SHA-256", new Float32Array(t.data))) : null);
      }
      const values: (number | null)[] = [];
      for (const [tx, ty, x, y, c] of at) {
        const t = await r.readSurfaceTile(layerId, part, tx, ty);
        values.push(t.data ? t.data[(y * 256 + x) * 4 + c] : null);
      }
      return { shown, digests, values };
    },
    { layerId, part, tiles, at },
  );

const screenDigest = (page: Page) =>
  page.evaluate(async () => {
    const s = (await (await (window as unknown as PaintWindow).photoDebug.renderer()).readScreen())!;
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Float32Array(s.data)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  });

let paintingId = "";
let paintPhoto = "";

test("a mask stroke across tiles is undone and redone exactly; a cancelled one changes nothing; a small one shares every other tile", async ({ page }) => {
  paintingId = await openNewPhoto(page, "Painting");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  paintPhoto = (await expect.poll(async () => (await savedPhoto(page, paintingId)).layers.length).toBe(1).then(() => savedPhoto(page, paintingId))).layers[0].id;
  // A mask from the Layers panel's button (no selection: it reveals everything), targeted at once.
  await page.locator(`[data-layer="${paintPhoto}"]`).click();
  await page.getByRole("button", { name: /Add a mask/ }).click();
  await expect(page.locator('[data-thumb="mask"][data-targeted]')).toBeVisible();
  await expect.poll(async () => (await savedPhoto(page, paintingId)).layers[0].mask).toEqual({ surface: null });

  // Across the tile edges at x = 256 and 512 (tile row 1).
  const crossed: [number, number][] = [[0, 1], [1, 1], [2, 1]];
  const first = (await paint(page, paintPhoto, "mask", line(150, 300, 650, 300), { radius: 40 }))!;
  expect(first.tiles).toBeGreaterThanOrEqual(3);
  // The F3 target: a stroke's end is committed within 30 ms (the bench measures it properly).
  expect(first.commitMs).toBeLessThan(500);
  await expect.poll(async () => (await savedPhoto(page, paintingId)).layers[0].mask.surface).toBe(first.id);
  const painted = await surfaceTiles(page, paintPhoto, "mask", crossed, [[1, 1, 44, 44, 0], [1, 1, 44, 200, 0]]);
  expect(painted.shown).toBe(first.id);
  expect(painted.digests.every((d) => d !== null)).toBe(true);
  // Black hides: under the stroke the mask is 0, away from it 1.
  expect(painted.values[0]).toBe(0);
  expect(painted.values[1]).toBe(1);
  const screen = await screenDigest(page);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, paintingId)).layers[0].mask.surface).toBeNull();
  await expect.poll(async () => (await surfaceTiles(page, paintPhoto, "mask", crossed)).digests).toEqual([null, null, null]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await savedPhoto(page, paintingId)).layers[0].mask.surface).toBe(first.id);
  await expect.poll(async () => (await surfaceTiles(page, paintPhoto, "mask", crossed)).digests).toEqual(painted.digests);
  await expect.poll(() => screenDigest(page)).toBe(screen);

  // A cancelled stroke: nothing in the document, nothing on the screen.
  await paint(page, paintPhoto, "mask", line(100, 900, 1500, 900), { radius: 60, cancel: true });
  await page.waitForTimeout(300);
  expect((await savedPhoto(page, paintingId)).layers[0].mask.surface).toBe(first.id);
  await expect.poll(() => screenDigest(page)).toBe(screen);

  // A small dab in another tile: every tile the first stroke made keeps its hash.
  const small = (await paint(page, paintPhoto, "mask", [{ x: 900, y: 900 }], { radius: 8 }))!;
  expect(small.tiles).toBe(1);
  const manifest = async (id: string) => (await page.request.get(`/api/photo/projects/${paintingId}/manifests/${id}`)).json();
  await expect.poll(async () => (await page.request.get(`/api/photo/projects/${paintingId}/manifests/${small.id}`)).status()).toBe(200);
  const [a, b] = [await manifest(first.id), await manifest(small.id)];
  const others = (b.tiles as [number, number, string][]).filter(([x, y]) => !(x === 3 && y === 3));
  expect(others).toEqual(a.tiles);
  expect(b.tiles).toHaveLength(a.tiles.length + 1);
});

test("the server keeps every tile once, refuses a photo naming pixels it hasn't got, and collects what only history named", async ({ page }) => {
  await page.goto(`/p/${paintingId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const saved = await savedPhoto(page, paintingId);
  const base = `/api/photo/projects/${paintingId}`;
  // A duplicate upload is a no-op that succeeds.
  const manifest = await (await page.request.get(`${base}/manifests/${saved.layers[0].mask.surface}`)).json();
  const hash = (manifest.tiles as [number, number, string][]).find(([, , ref]) => !ref.startsWith("c:"))![2];
  const bytes = await (await page.request.get(`${base}/blobs/${hash}`)).body();
  const again = await page.request.put(`${base}/blobs/${hash}`, { data: bytes, headers: { "Content-Type": "application/octet-stream" } });
  expect(again.status()).toBe(200);
  expect(await again.json()).toEqual({ stored: false });
  // A document naming a surface the server hasn't got is refused, and the saved one stays.
  const refused = await page.request.put(`/api/projects/${paintingId}`, { data: { ...saved, layers: [{ ...saved.layers[0], mask: { surface: "f".repeat(64) } }] } });
  expect(refused.status()).toBe(409);
  expect((await savedPhoto(page, paintingId)).layers[0].mask.surface).toBe(saved.layers[0].mask.surface);

  // Two strokes: the first's manifest only history names once the second is saved.
  const one = (await paint(page, paintPhoto, "mask", line(1100, 200, 1300, 200), { radius: 20 }))!;
  const two = (await paint(page, paintPhoto, "mask", line(1100, 260, 1300, 260), { radius: 20 }))!;
  await expect.poll(async () => (await savedPhoto(page, paintingId)).layers[0].mask.surface).toBe(two.id);
  expect((await page.request.get(`${base}/manifests/${one.id}`)).status()).toBe(200);
  // Closed (Home), then opened again: collected, the saved one kept.
  const closed = page.waitForResponse((r) => r.url().endsWith(`/api/projects/${paintingId}/closed`));
  await page.keyboard.press("ControlOrMeta+Shift+h");
  await expect(page.getByRole("main", { name: "Home" })).toBeVisible();
  await closed;
  await page.goto(`/p/${paintingId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await expect.poll(async () => (await page.request.get(`${base}/manifests/${one.id}`)).status()).toBe(404);
  expect((await page.request.get(`${base}/manifests/${two.id}`)).status()).toBe(200);
  // And the photo still shows its mask: the tiles it needs are there.
  await expect.poll(async () => (await surfaceTiles(page, paintPhoto, "mask", [[4, 0]])).shown).toBe(two.id);
});

test("the same samples paint the same pixels at every zoom and pixel density", async ({ page, browser }) => {
  await page.goto(`/p/${paintingId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const strokeOn = async (p: Page) => {
    const before = (await savedPhoto(p, paintingId)).layers.length;
    await p.keyboard.press("ControlOrMeta+Shift+n");
    const id = await expect.poll(async () => (await savedPhoto(p, paintingId)).layers.length).toBe(before + 1).then(async () => (await savedPhoto(p, paintingId)).layers.at(-1).id);
    return (await paint(p, id, "content", line(220, 240, 700, 610, 2.5), { radius: 23.5, hardness: 0.35, colour: [0.2, 0.05, 0.6, 1] }))!.id;
  };
  const atFit = await strokeOn(page);
  await page.evaluate(() => {
    const ui = (window as unknown as PaintWindow).photoDebug.ui.getState();
    ui.setView({ ...ui.view, zoom: 2, x: 300, y: 300 });
  });
  const zoomed = await strokeOn(page);
  expect(zoomed).toBe(atFit);
  // Another page at twice the pixel density.
  const dense = await browser.newContext({ deviceScaleFactor: 2, baseURL: new URL(page.url()).origin });
  const other = await dense.newPage();
  await other.goto(`/p/${paintingId}`);
  await expect(other.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  expect(await strokeOn(other)).toBe(atFit);
  await dense.close();
});

test("a marquee limits the brush fractionally and makes a mask; an image asks before it's painted", async ({ page }) => {
  const id = await openNewPhoto(page, "Masked");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const photo = (await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(1).then(() => savedPhoto(page, id))).layers[0].id;

  // The Rectangular Marquee: a drag selects whole pixels, one undo step; the ants show it.
  await page.keyboard.press("m");
  const a = await screenOf(page, 200, 150);
  const b = await screenOf(page, 800, 600);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  const ants = page.locator("[data-selection]");
  await expect(ants).toBeVisible();
  const [sx, sy, sw, sh] = (await ants.getAttribute("data-selection"))!.split(",").map(Number);
  expect([sx, sy, sw, sh].every(Number.isInteger)).toBe(true);
  expect(Math.abs(sx - 200) + Math.abs(sy - 150) + Math.abs(sx + sw - 800) + Math.abs(sy + sh - 600)).toBeLessThan(12);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(ants).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(ants).toBeVisible();

  // The brush on a placed image asks first: a new paint layer, not pixels silently.
  await page.locator(`[data-layer="${photo}"]`).click();
  await page.keyboard.press("b");
  const centre = await screenOf(page, 500, 400);
  await page.mouse.click(centre.x, centre.y);
  const choice = page.locator("[data-paint-choice]");
  await expect(choice).toBeVisible();
  await choice.getByRole("button", { name: "New paint layer" }).click();
  const withLayer = await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(2).then(() => savedPhoto(page, id));
  expect(withLayer.layers[0].kind).toBe("image");
  const layer = withLayer.layers[1];
  expect(layer).toMatchObject({ kind: "pixel", name: "Layer 1", surface: null });

  // The selection limits paint by how much of each pixel it covers: a fractional edge (x = 300.5) paints half.
  await page.evaluate(() => {
    const photo = (window as unknown as { photoDebug: { photo: { getState(): { select(s: unknown): void } } } }).photoDebug.photo;
    photo.getState().select({ kind: "rect", x: 300.5, y: 0, width: 400, height: 1200 });
  });
  await paint(page, layer.id, "content", line(200, 120, 800, 120), { radius: 30, colour: [1, 0, 0, 1] });
  // Tile (1, 0): x 256..511. Pixel 299 is outside, 300 half inside, 301 inside; alpha is channel 3.
  const at = await surfaceTiles(page, layer.id, "content", [], [[1, 0, 43, 120, 3], [1, 0, 44, 120, 3], [1, 0, 45, 120, 3]]);
  expect(at.values[0]).toBe(0);
  expect(at.values[1]).toBeCloseTo(0.5, 3);
  expect(at.values[2]).toBe(1);

  // A mask from the selection (the Layers panel's button): the photo shows only inside it.
  await page.locator(`[data-layer="${photo}"]`).click();
  await page.getByRole("button", { name: /Add a mask/ }).click();
  const masked = await expect.poll(async () => (await savedPhoto(page, id)).layers[0].mask?.surface ?? null).not.toBeNull().then(() => savedPhoto(page, id));
  const mask = masked.layers[0].mask.surface;
  // The selection is x 300.5..700.5 now: tile (2, 1) straddles its edge, tile (0, 1) is wholly outside (the mask's
  // fill, 0: nothing stored).
  const values = await surfaceTiles(page, photo, "mask", [], [[2, 1, 100, 100, 0], [2, 1, 200, 100, 0], [1, 1, 44, 100, 0]]);
  expect(values.values).toEqual([1, 0, 0.5]);
  const manifest = await (await page.request.get(`/api/photo/projects/${id}/manifests/${mask}`)).json();
  expect(manifest.fill).toEqual([0]);
  expect((manifest.tiles as [number, number, string][]).some(([x, y]) => x === 0 && y === 1)).toBe(false);
  // The canvas shows the photo inside it, and the checkerboard (transparency's light greys) outside.
  const inside = await canvasPixel(page, { width: 1600, height: 1200 }, 500, 400);
  const outside = await canvasPixel(page, { width: 1600, height: 1200 }, 1300, 1000);
  expect(near(inside, await filePixel(PHOTO, 500, 400), 16)).toBe(true);
  expect(Math.max(...outside) - Math.min(...outside)).toBeLessThanOrEqual(3);
  expect([184, 231].some((grey) => Math.abs(outside[0] - grey) <= 4)).toBe(true);

  // Painting the mask with the mouse (white reveals): one undo step.
  await page.keyboard.press("x");
  await page.keyboard.press("ControlOrMeta+d");
  const p0 = await screenOf(page, 1200, 900);
  const p1 = await screenOf(page, 1400, 900);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.mouse.move(p1.x, p1.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0].mask.surface).not.toBe(mask);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0].mask.surface).toBe(mask);
});

test("the assistant selects, masks and adds a pixel layer", async ({ page }) => {
  await page.goto(`/p/${paintingId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_pixel_layer {"name": "Glaze"}',
      'call select_rect {"x": 100, "y": 100, "width": 300, "height": 200}',
      'call add_mask {"layer": "Glaze", "from": "selection"}',
      'call add_mask {"layer": "Glaze", "from": "selection"}',
      'call select_rect {"none": true}',
      'call add_mask {"layer": "photo 1600x1200", "remove": true}',
      "call get_photo",
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("get_photo: ok", { timeout: 30_000 });
  const doc = await expect.poll(async () => (await savedPhoto(page, paintingId)).layers.find((l: { name: string }) => l.name === "Glaze")?.mask?.surface ?? null).not.toBeNull().then(() => savedPhoto(page, paintingId));
  const glaze = doc.layers.find((l: { name: string }) => l.name === "Glaze");
  expect(glaze.kind).toBe("pixel");
  expect(doc.layers[0].mask).toBeUndefined();
  await expect(page.locator("[data-selection]")).toHaveCount(0);
  const values = await surfaceTiles(page, glaze.id, "mask", [], [[0, 0, 150, 150, 0], [0, 0, 50, 50, 0]]);
  expect(values.values).toEqual([1, 0]);
});

// --- Edit commands, the eraser, options and colours ---

test("copy, cut and paste make layers; fills, Delete and the eraser change pixels; options drag; the header keeps still", async ({ page }) => {
  const id = await openNewPhoto(page, "Edits");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const photo = (await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(1).then(() => savedPhoto(page, id))).layers[0].id;
  const layers = async () => (await savedPhoto(page, id)).layers as { id: string; kind: string; surface?: string | null; size?: { width: number; height: number }; transform: { x: number; y: number } }[];
  const select = (x: number, y: number, width: number, height: number) =>
    page.evaluate((s) => (window as unknown as { photoDebug: { photo: { getState(): { select(s: unknown): void } } } }).photoDebug.photo.getState().select({ kind: "rect", ...s }), { x, y, width, height });
  const paste = () => page.evaluate(() => window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: new DataTransfer() })));
  const alphaAt = async (layerId: string, x: number, y: number) =>
    (await surfaceTiles(page, layerId, "content", [], [[Math.floor(x / 256), Math.floor(y / 256), x % 256, y % 256, 3]])).values[0] ?? 0;

  // The header doesn't move when the photo saves.
  const undo = page.getByRole("button", { name: "Undo" });
  const undoX = (await undo.boundingBox())!.x;

  // ⌘C then ⌘V: the selection of the photo, as a new layer where it was.
  await page.locator(`[data-layer="${photo}"]`).click();
  await select(100, 100, 200, 150);
  await page.keyboard.press("ControlOrMeta+c");
  await page.waitForTimeout(300);
  await paste();
  const pasted = await expect.poll(async () => (await layers()).length).toBe(2).then(async () => (await layers())[1]);
  expect(pasted).toMatchObject({ kind: "pixel", size: { width: 200, height: 150 }, transform: { x: 200, y: 175 } });
  expect(pasted.surface).toMatch(/^[0-9a-f]{64}$/);
  expect((await undo.boundingBox())!.x).toBe(undoX);

  // ⌘J with a selection: Layer via Copy, right above.
  await page.locator(`[data-layer="${photo}"]`).click();
  await page.keyboard.press("ControlOrMeta+j");
  await expect.poll(async () => (await layers()).map((l) => l.kind)).toEqual(["image", "pixel", "pixel"]);

  // ⇧⌘J on painted pixels: Layer via Cut takes the selection out of them.
  await page.locator(`[data-layer="${pasted.id}"]`).click();
  await select(120, 120, 50, 50);
  await page.keyboard.press("ControlOrMeta+Shift+j");
  await expect.poll(async () => (await layers()).length).toBe(4);
  // The pasted layer's own pixels: (40, 40) is inside the cut, (150, 100) isn't.
  await expect.poll(() => alphaAt(pasted.id, 40, 40)).toBe(0);
  expect(await alphaAt(pasted.id, 150, 100)).toBe(1);

  // ⌥⌫ fills the selection with the foreground colour on a new layer; Delete clears it again.
  await page.keyboard.press("ControlOrMeta+Shift+n");
  const blank = await expect.poll(async () => (await layers()).length).toBe(5).then(async () => (await layers()).at(-1)!);
  await select(600, 300, 400, 300);
  await page.keyboard.press("d");
  await page.keyboard.press("Alt+Backspace");
  await expect.poll(() => alphaAt(blank.id, 800, 400)).toBe(1);
  expect(await alphaAt(blank.id, 500, 400)).toBe(0);
  await page.keyboard.press("Delete");
  await expect.poll(() => alphaAt(blank.id, 800, 400)).toBe(0);
  expect((await layers()).length).toBe(5);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => alphaAt(blank.id, 800, 400)).toBe(1);

  // The Eraser (E) takes painted pixels away.
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("e");
  const a = await screenOf(page, 650, 450);
  const b = await screenOf(page, 950, 450);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => alphaAt(blank.id, 800, 450)).toBe(0);
  expect(await alphaAt(blank.id, 800, 350)).toBe(1);

  // The options are dragged sideways: the brush grows.
  const size = page.getByRole("spinbutton", { name: "Size" });
  const before = Number(await size.getAttribute("aria-valuenow"));
  const box = (await size.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Number(await size.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(before + 30);

  // The colours are the tool strip's, every tool's: X swaps them.
  const tools = page.getByRole("navigation", { name: "Tools" });
  const foreground = tools.getByRole("button", { name: "Foreground colour" });
  await expect(foreground).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await page.keyboard.press("x");
  await expect(foreground).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("d");
  expect((await undo.boundingBox())!.x).toBe(undoX);
});

test("blend modes, Fill, channels and Blend If draw as the reference composites them; the mode menu previews while hovered; Blending Options is one undo step", async ({ page }) => {
  const id = await openNewPhoto(page, "Blending");
  await openImage(page, PHOTO);
  await expect(page.locator("[data-layer]")).toHaveCount(1);
  await page.locator("[data-place-input]").setInputFiles(STICKER);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(2);
  const doc = await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(2).then(() => savedPhoto(page, id));
  expect(doc.compositing).toBe("photoshop");
  const [photo, sticker] = doc.layers.map((l: { id: string }) => l.id);
  // Over transparency, so the sticker alone is its own pixels.
  await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().commit((d: unknown) => ({ ...(d as object), canvas: { ...(d as { canvas: object }).canvas, background: null } })));
  // Half the sticker and half nothing, at 100%: every pixel read texel for texel (partial coverage is Opacity's cases).
  const view = { zoom: 1, x: 980, y: 260, width: 48, height: 40 };
  const below = await renderRegion(page, view, { hide: [sticker] });
  const alone = await renderRegion(page, view, { hide: [photo] });
  expect(alone.filter((v, i) => i % 4 === 3 && v === 0).length).toBeGreaterThan(200);
  expect(alone.filter((v, i) => i % 4 === 3 && v === 1).length).toBeGreaterThan(200);
  const setBlending = (blending: Record<string, unknown>) =>
    page.evaluate(
      ({ sticker, blending }) =>
        (window as unknown as DebugWindow).photoDebug.photo.getState().commit((d: unknown) => {
          const doc = d as { layers: Record<string, unknown>[] };
          return { ...doc, layers: doc.layers.map((l) => (l.id === sticker ? { ...l, ...blending } : l)) };
        }),
      { sticker, blending },
    );
  const check = async (label: string, blending: { blend?: string; fill?: number; opacity?: number; blending?: { channels?: BlendParams["channels"]; blendIf?: BlendParams["blendIf"] } }, compositing: "photoshop" | "linear" = "photoshop") => {
    await setBlending({ blend: blending.blend ?? "normal", fill: blending.fill ?? 1, opacity: blending.opacity ?? 1, blending: blending.blending ?? undefined });
    const got = await renderRegion(page, view);
    const params: BlendParams = {
      mode: (blending.blend ?? "normal") as BlendParams["mode"],
      opacity: blending.opacity ?? 1,
      fill: blending.fill ?? 1,
      channels: blending.blending?.channels ?? { r: true, g: true, b: true },
      blendIf: blending.blending?.blendIf ?? {},
      compositing,
    };
    let worst = 0;
    for (let y = 0; y < view.height; y++)
      for (let x = 0; x < view.width; x++) {
        const i = (y * view.width + x) * 4;
        const want = compositePixel(below.slice(i, i + 4) as Rgba, alone.slice(i, i + 4) as Rgba, { ...params, dissolveAt: { x: view.x + x, y: view.y + y, seed: blendSeed(sticker) } });
        for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(got[i + c] - want[c]) / Math.max(1, Math.abs(want[c])));
      }
    expect(worst, label).toBeLessThan(2e-3);
  };
  for (const m of BLEND_MODES) await check(m.id, { blend: m.id });
  for (const m of SPECIAL_FILL) await check(`${m} at Fill 40%`, { blend: m, fill: 0.4 });
  await check("multiply at 60% opacity, Fill 50%", { blend: "multiply", opacity: 0.6, fill: 0.5 });
  await check("normal, Fill 50%", { fill: 0.5 });
  await check("Blend If", { blending: { blendIf: { gray: { layer: [0, 0, 180, 230], underlying: [30, 90, 255, 255] } } } });
  await check("green excluded, screen", { blend: "screen", blending: { channels: { r: true, g: false, b: true } } });
  await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().commit((d: unknown) => ({ ...(d as object), compositing: "linear" })));
  await check("multiply in linear light", { blend: "multiply", opacity: 0.7 }, "linear");
  await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().commit((d: unknown) => ({ ...(d as object), compositing: "photoshop" })));
  await setBlending({ blend: "normal", fill: 1, opacity: 1, blending: undefined });
  const mode = async () => ((await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.doc.doc.layers[1])) as { blend?: string }).blend ?? "normal";

  // The Layers panel's menu: hovering previews, Escape puts it back, a click keeps one (one undo step).
  await page.locator("[data-layer]").first().click();
  const menu = page.locator("[data-blend-bar]").getByRole("button", { name: "Blend mode" });
  await menu.click();
  await page.locator('[data-blend-menu] [data-mode="screen"]').hover();
  await expect.poll(mode).toBe("screen");
  await page.locator('[data-blend-menu] [data-mode="difference"]').hover();
  await expect.poll(mode).toBe("difference");
  await page.keyboard.press("Escape");
  await expect.poll(mode).toBe("normal");
  // (The menu's closing animation ends before it's opened again.)
  await expect(page.locator("[data-blend-menu]")).toHaveCount(0);
  await menu.click();
  await page.locator('[data-blend-menu] [data-mode="overlay"]').click();
  await expect.poll(async () => (await savedPhoto(page, id)).layers[1].blend).toBe("overlay");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(mode).toBe("normal");
  // Photoshop's keys: ⇧⌥M is Multiply, ⇧+ the next mode.
  await page.getByLabel("Photo canvas").click();
  await page.keyboard.press("Shift+Alt+KeyM");
  await expect.poll(mode).toBe("multiply");
  await page.keyboard.press("Shift+Equal");
  await expect.poll(mode).toBe("color-burn");
  // Fill in the panel: typed, one undo step.
  await page.locator("[data-blend-bar]").getByLabel("Fill").click();
  await page.keyboard.type("35");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedPhoto(page, id)).layers[1].fill).toBe(0.35);

  // Blending Options: a double-click on the row past its name, or the Layers menu. Everything previews, Cancel
  // puts it all back, OK makes it one undo step.
  const row = page.locator("[data-layer]").first();
  const box = (await row.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width - 8, box.y + box.height / 2);
  const dialog = page.locator("[data-layer-style]");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: "G", exact: true }).uncheck();
  await expect.poll(async () => ((await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.doc.doc.layers[1])) as { blending?: { channels?: { g: boolean } } }).blending?.channels?.g).toBe(false);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => ((await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.doc.doc.layers[1])) as { blending?: unknown }).blending).toBeUndefined();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Blending Options…" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Blend mode" }).click();
  await page.locator('[data-blend-menu] [data-mode="luminosity"]').click();
  await dialog.getByRole("checkbox", { name: "B", exact: true }).uncheck();
  const black = dialog.locator('[data-blend-if="Underlying Layer"] [data-handle="black"]');
  const handle = (await black.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2, { steps: 4 });
  await page.mouse.up();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = await expect.poll(async () => (await savedPhoto(page, id)).layers[1].blend).toBe("luminosity").then(() => savedPhoto(page, id));
  expect(saved.layers[1].blending.channels).toEqual({ r: true, g: true, b: false });
  const under = saved.layers[1].blending.blendIf.gray.underlying;
  expect(under[0]).toBeGreaterThan(20);
  expect(under[0]).toBe(under[1]);
  // One undo step for the whole dialog.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(mode).toBe("color-burn");

  // The assistant at parity.
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(['call set_layer_blending {"layers": ["sticker 800"], "mode": "screen", "fill": 0.5}', 'call set_layer_blending {"layers": ["sticker 800"], "mode": "glow"}'].join("\n"));
  await composer.press("Enter");
  await expect(panel).toContainText("set_layer_blending: ok, set_layer_blending: failed", { timeout: 30_000 });
  await expect.poll(mode).toBe("screen");
});

/**
 * A photo of one soft-edged disc (160 × 160, opened as the canvas, so the layer is at 100%) over a blue-grey canvas,
 * and `check`, which gives the layer a style and compares the GPU's picture with the CPU reference's.
 */
async function styleBench(page: Page, name: string) {
  // A soft-edged disc in a 160 × 160 image with room around it: opened as the canvas, the layer is at 100%.
  const file = path.join(os.tmpdir(), "photo-style-disc.png");
  const disc = Buffer.alloc(160 * 160 * 4);
  for (let y = 0; y < 160; y++)
    for (let x = 0; x < 160; x++) {
      const a = Math.min(1, Math.max(0, 42 - Math.hypot(x + 0.5 - 80, y + 0.5 - 76) + 0.5));
      disc.set([230, 120, 40, Math.round(a * 255)], (y * 160 + x) * 4);
    }
  await sharp(disc, { raw: { width: 160, height: 160, channels: 4 } }).png().toFile(file);
  const id = await openNewPhoto(page, name);
  await openImage(page, file);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  // Every shader compiles.
  const errors = await page.evaluate(async () => {
    const r = await (window as unknown as DebugWindow).photoDebug.renderer();
    // The app's own module, as the dev server serves it.
    const url = "/src/suites/photo/render/compositor.ts";
    const { Compositor } = (await import(/* @vite-ignore */ url)) as { Compositor: { compileErrors(device: unknown): Promise<string[]> } };
    return Compositor.compileErrors((r as unknown as { device: unknown }).device);
  });
  expect(errors).toEqual([]);
  const layerId = await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(1).then(async () => (await savedPhoto(page, id)).layers[0].id as string);
  const set = (patch: Record<string, unknown>) =>
    page.evaluate(
      ({ layerId, patch }) =>
        (window as unknown as DebugWindow).photoDebug.photo.getState().commit((d: unknown) => {
          const doc = d as { layers: Record<string, unknown>[] };
          return { ...doc, ...(patch.doc as object), layers: doc.layers.map((l) => (l.id === layerId ? { ...l, ...(patch.layer as object) } : l)) };
        }),
      { layerId, patch },
    );
  const view = { zoom: 1, x: 0, y: 0, width: 160, height: 160 };
  // The layer alone, over nothing: its own pixels.
  await set({ doc: { canvas: { width: 160, height: 160, background: null } } });
  const content = await renderRegion(page, view);
  await set({ doc: { canvas: { width: 160, height: 160, background: "#5a7896" } } });
  const backdrop = new Float32Array(160 * 160 * 4);
  const bg = [0x5a, 0x78, 0x96].map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  for (let i = 0; i < 160 * 160; i++) backdrop.set([...bg, 1], i * 4);
  // Patterns of the photo's the reference reads (built-in ones it makes itself).
  const patterns = new Map<string, PatternImage[]>();
  const fx = (type: string, params: Record<string, unknown> = {}) => newStyleEffect(type, `${type}_${Math.random().toString(36).slice(2, 8)}`, params)!;
  const check = async (label: string, effects: ReturnType<typeof fx>[], layer: Record<string, unknown> = {}, compositing: "photoshop" | "linear" = "photoshop") => {
    const style = { enabled: true, effects };
    await set({ layer: { style, ...layer }, doc: { compositing } });
    const got = await renderRegion(page, view);
    const doc = (await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.doc.doc)) as unknown as { layers: Parameters<typeof renderStyled>[0][] };
    const want = renderStyled(doc.layers[0], { compositing }, { width: 160, height: 160, pixels: backdrop }, { width: 160, height: 160, pixels: new Float32Array(content) }, (e) => (e.params.globalLight === true ? 120 : (e.params.angle as number)), { x0: 0, y0: 0, x1: 160, y1: 160 }, (e) => (e.params.globalLight === true ? 30 : (e.params.altitude as number)), (id) => builtInPatternLevels(id) ?? patterns.get(id));
    let worst = 0;
    let at = 0;
    for (let i = 0; i < want.length; i++) {
      const d = Math.abs(got[i] - want[i]);
      if (d > worst) [worst, at] = [d, i];
    }
    expect(worst, `${label}: worst at pixel ${Math.floor(at / 4) % 160}, ${Math.floor(at / 640)} (${got[at]} vs ${want[at]})`).toBeLessThan(1e-3);
    return got;
  };
  return { id, layerId, set, fx, check, content, patterns };
}

test("layer effects draw as the reference does: shadows, glows, overlays and strokes, Precise and Softer, in either compositing", async ({ page }) => {
  const { id, set, fx, check } = await styleBench(page, "Effects");
  await check("a drop shadow", [fx("drop-shadow", { distance: 12, size: 18, spread: 20, opacity: 75 })]);
  await check("a drop shadow at its own angle, not knocking out, under a 30% Fill", [fx("drop-shadow", { distance: 9, size: 6, angle: 30, globalLight: false, knocksOut: false })], { fill: 0.3 });
  await check("an outer glow, Softer, a Cone contour, Range 60", [fx("outer-glow", { size: 20, opacity: 80, colour: "#ffe066", contour: { name: "Cone", points: [{ x: 0, y: 0 }, { x: 129, y: 255 }, { x: 255, y: 0 }] }, range: 60 })]);
  await check("an outer glow, Precise, spread", [fx("outer-glow", { size: 16, technique: "precise", spread: 30, opacity: 100, mode: "normal" })]);
  await check("a gradient outer glow", [fx("outer-glow", { size: 24, fill: "gradient", opacity: 100, gradient: { name: "t", method: "classic", colours: [{ at: 0, colour: "#ff0000" }, { at: 1, colour: "#0000ff" }], opacities: [{ at: 0, opacity: 1 }, { at: 1, opacity: 0.2 }] } })]);
  await check("an inner glow from the centre, and an inner shadow", [fx("inner-glow", { size: 14, source: "center", choke: 20, opacity: 70 }), fx("inner-shadow", { distance: 6, size: 8, opacity: 60 })]);
  await check("overlays: a multiplied colour, a radial gradient", [fx("gradient-overlay", { style: "radial", opacity: 60, angle: 45 }), fx("color-overlay", { colour: "#3366ff", mode: "multiply", opacity: 50 })]);
  await check("strokes: outside, inside, centre and a shape burst", [fx("stroke", { size: 6, colour: "#ffffff" }), fx("stroke", { size: 4, position: "inside", colour: "#000000", opacity: 70 }), fx("stroke", { size: 5, position: "center", fill: "gradient", style: "shape-burst" })]);
  await check("everything, the interior as a group, in Multiply at 60% opacity", [fx("drop-shadow", { distance: 8, size: 10 }), fx("outer-glow", { size: 12 }), fx("color-overlay", { mode: "screen", opacity: 40 }), fx("inner-glow", { size: 10 }), fx("stroke", { size: 3 })], { blend: "multiply", opacity: 0.6, blending: { interiorAsGroup: true } });
  await check("in linear light", [fx("drop-shadow", { distance: 12, size: 18 }), fx("stroke", { size: 4, opacity: 60 })], {}, "linear");
  // Changing an effect's colour makes no fields again; its size does.
  const made = () => page.evaluate(async () => ((await (window as unknown as DebugWindow).photoDebug.renderer()) as unknown as { compositor: { styleFields: { made: number } } }).compositor.styleFields.made);
  const shadow = fx("drop-shadow", { distance: 12, size: 18 });
  await check("before", [shadow]);
  const before = await made();
  await check("its colour changed", [{ ...shadow, params: { ...shadow.params, colour: "#ff0000" } }]);
  expect(await made()).toBe(before);
  await check("its size changed", [{ ...shadow, params: { ...shadow.params, size: 30 } }]);
  expect(await made()).toBe(before + 1);

  // The window: the fx menu's Drop Shadow adds one and shows its page; the canvas shows it while the window is open.
  await set({ layer: { style: null, blend: "normal", opacity: 1, fill: 1, blending: null }, doc: { compositing: "photoshop" } });
  const layerNow = () => page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.doc.doc.layers[0]) as Promise<{ style?: { enabled: boolean; effects: { id: string; type: string; enabled: boolean; params: Record<string, unknown> }[] } | null }>;
  await page.locator("[data-layer]").first().click();
  await page.getByRole("button", { name: "Add a layer style" }).click();
  await page.locator("[data-fx-menu]").getByRole("menuitem", { name: "Drop Shadow…" }).click();
  const dialog = page.locator("[data-layer-style]");
  await expect(dialog.locator('[data-page="drop-shadow"]')).toBeVisible();
  await expect.poll(async () => (await layerNow()).style?.effects.map((e) => e.type)).toEqual(["drop-shadow"]);
  // A drag on the canvas moves the shadow (Distance follows).
  const canvas = (await page.getByLabel("Photo canvas").boundingBox())!;
  // (By the canvas's corner: the window is over its middle.)
  await page.mouse.move(canvas.x + 12, canvas.y + 12);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 72, canvas.y + 42, { steps: 5 });
  await page.mouse.up();
  // (The canvas is zoomed to 462%: 60 screen pixels are about 13 of the photo's.)
  await expect.poll(async () => (await layerNow()).style?.effects[0]?.params.distance as number).toBeGreaterThan(10);
  // Cancel puts it all back.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await layerNow()).style ?? null).toBeNull();

  // Blending Options from the Layers menu, then Stroke from the list (ticked by clicking it), its Size typed, OK: one
  // undo step.
  await page.locator("[data-layer]").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Blending Options…" }).click();
  await dialog.locator('[data-style-row="stroke"]').getByRole("button", { name: "Stroke" }).click();
  await expect(dialog.locator('[data-page="stroke"]')).toBeVisible();
  await dialog.getByRole("spinbutton", { name: "Size" }).click();
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = await expect.poll(async () => (await savedPhoto(page, id)).layers[0].style?.effects?.[0]?.params?.size).toBe(12).then(() => savedPhoto(page, id));
  expect(saved.layers[0].style.effects.map((e: { type: string }) => e.type)).toEqual(["stroke"]);
  // The Layers panel lists it under the layer: its eye hides it.
  await expect(page.locator("[data-fx]")).toBeVisible();
  await page.locator("[data-effect]").getByRole("button", { name: "Hide Stroke" }).click();
  await expect.poll(async () => (await layerNow()).style?.effects[0]?.enabled).toBe(false);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await layerNow()).style?.effects[0]?.enabled).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await layerNow()).style ?? null).toBeNull();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await layerNow()).style?.effects.length).toBe(1);

  // Copy Layer Style, then Paste onto a copy of the layer that has none.
  await page.locator("[data-layer]").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy Layer Style" }).click();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.locator("[data-layer]")).toHaveCount(2);
  await page.locator("[data-layer]").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Clear Layer Style" }).click();
  await expect.poll(async () => ((await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.doc.doc.layers[1])) as { style?: unknown }).style ?? null).toBeNull();
  await page.locator("[data-layer]").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paste Layer Style" }).click();
  await expect.poll(async () => ((await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.doc.doc.layers[1])) as { style?: { effects: { type: string }[] } }).style?.effects[0]?.type).toBe("stroke");
});

test("bevels and satin draw as the reference does: every style and technique, Soften, the contours; Bevel's Contour page", async ({ page }) => {
  const { id, set, fx, check } = await styleBench(page, "Bevels");
  const preset = (name: string) => CONTOUR_PRESETS.find((c) => c.name === name)!;
  for (const style of ["inner-bevel", "outer-bevel", "emboss", "pillow-emboss"])
    for (const technique of ["smooth", "chisel-hard", "chisel-soft"]) await check(`${style}, ${technique}`, [fx("bevel-emboss", { style, technique, size: 12, depth: 150 })]);
  await check("down, softened, a Ring gloss, its own light at 60°, an Overlay highlight", [fx("bevel-emboss", { direction: "down", soften: 4, size: 10, globalLight: false, angle: 45, altitude: 60, gloss: preset("Ring"), highlightMode: "overlay", highlightColour: "#ffcc00" })]);
  await check("a chisel softened, a Cove - Deep contour at Range 70", [fx("bevel-emboss", { technique: "chisel-hard", soften: 3, useContour: true, contour: preset("Cove - Deep"), range: 70, size: 14 })]);
  await check("Stroke Emboss on an outside and an inside stroke, chiselled", [fx("stroke", { size: 8 }), fx("stroke", { size: 3, position: "inside", colour: "#ffffff" }), fx("bevel-emboss", { style: "stroke-emboss", technique: "chisel-hard", size: 6 })]);
  await check("Stroke Emboss, Smooth", [fx("stroke", { size: 6, position: "center" }), fx("bevel-emboss", { style: "stroke-emboss", size: 5 })]);
  await check("Stroke Emboss without a stroke draws nothing", [fx("bevel-emboss", { style: "stroke-emboss" })]);
  await check("satin under a bevel", [fx("satin", { size: 10, distance: 7, angle: 30, colour: "#3355ff", mode: "normal", opacity: 80 }), fx("bevel-emboss", {})]);
  // (They draw something: a bevel and a satin change the layer.)
  const plain = await check("no effects", []);
  for (const effect of [fx("bevel-emboss", { size: 12 }), fx("satin", {})]) {
    const lit = await check(effect.type, [effect]);
    expect(Math.max(...lit.map((v, i) => Math.abs(v - plain[i])))).toBeGreaterThan(0.1);
  }
  await check("satin, a Gaussian contour, not inverted, in linear light", [fx("satin", { invert: false, contour: preset("Gaussian"), size: 20, distance: 12 })], {}, "linear");

  // The window: Bevel & Emboss from the fx menu, then its Contour row: ticked, Range typed, OK.
  await set({ layer: { style: null }, doc: { compositing: "photoshop" } });
  await page.locator("[data-layer]").first().click();
  await page.getByRole("button", { name: "Add a layer style" }).click();
  await page.locator("[data-fx-menu]").getByRole("menuitem", { name: "Bevel & Emboss…" }).click();
  const dialog = page.locator("[data-layer-style]");
  await expect(dialog.locator('[data-page="bevel-emboss"]')).toBeVisible();
  await expect(dialog.getByRole("slider", { name: "Altitude slider" })).toBeVisible();
  const contourRow = dialog.locator('[data-style-row$=":Contour"]');
  await contourRow.getByRole("button", { name: "Contour" }).click();
  await expect(dialog.locator('[data-page="bevel-emboss-contour"]')).toBeVisible();
  await contourRow.getByRole("checkbox", { name: "Contour on" }).check();
  await dialog.getByRole("spinbutton", { name: "Range" }).click();
  await page.keyboard.type("30");
  await page.keyboard.press("Enter");
  // Satin's row adds one.
  await dialog.locator('[data-style-row="satin"]').getByRole("button", { name: "Satin" }).click();
  await expect(dialog.locator('[data-page="satin"]')).toBeVisible();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = await expect.poll(async () => (await savedPhoto(page, id)).layers[0].style?.effects?.length).toBe(2).then(() => savedPhoto(page, id));
  expect(saved.layers[0].style.effects.map((e: { type: string }) => e.type)).toEqual(["satin", "bevel-emboss"]);
  expect(saved.layers[0].style.effects[1].params).toMatchObject({ useContour: true, range: 30, style: "inner-bevel" });
  await expect(page.locator("[data-effect]")).toHaveCount(2);
});

type SelectWindow = { photoDebug: { photo: { getState(): { select(selection: unknown): void } } } };

test("patterns draw as the reference does (Pattern Overlay, pattern strokes, Bevel's Texture), Define Pattern makes one; styles apply, add and save; Scale Effects", async ({ page }) => {
  const { id, layerId, set, fx, check, content, patterns } = await styleBench(page, "Patterns");
  await check("Pattern Overlay: bricks", [fx("pattern-overlay", { pattern: "builtin:bricks" })]);
  await check("Pattern Overlay: noise at 50% (a mip level), multiplied", [fx("pattern-overlay", { pattern: "builtin:noise", scale: 50, mode: "multiply", opacity: 80 })]);
  await check("Pattern Overlay: dots at 250%, turned a quarter, moved, not linked", [fx("pattern-overlay", { pattern: "builtin:dots", scale: 250, angle: 90, phaseX: 7, phaseY: -3, link: false })]);
  await check("a pattern stroke", [fx("stroke", { size: 9, fill: "pattern", pattern: "builtin:checkerboard", patternScale: 150 })]);
  await check("Bevel's Texture", [fx("bevel-emboss", { size: 10, useTexture: true, texture: "builtin:canvas", textureDepth: 150 })]);
  await check("Bevel's Texture inverted, scaled", [fx("bevel-emboss", { technique: "chisel-hard", size: 8, useTexture: true, texture: "builtin:clouds", textureDepth: -200, textureScale: 60 })]);
  // (They draw something: a pattern changes the layer.)
  const plain = await check("no effects", []);
  const overlaid = await check("bricks again", [fx("pattern-overlay", { pattern: "builtin:bricks" })]);
  expect(Math.max(...overlaid.map((v, i) => Math.abs(v - plain[i])))).toBeGreaterThan(0.1);

  // Define Pattern (the Layers menu) from the selection on the disc's edge: a pattern of the photo's, with transparency.
  await set({ layer: { style: null } });
  await page.evaluate(() => (window as unknown as SelectWindow).photoDebug.photo.getState().select({ kind: "rect", x: 100, y: 40, width: 32, height: 32 }));
  await page.locator("[data-layer]").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Define Pattern" }).click();
  const defined = await expect.poll(async () => (await savedPhoto(page, id)).patterns?.length ?? 0).toBe(1).then(() => savedPhoto(page, id).then((d) => d.patterns[0] as { id: string; size: { width: number; height: number } }));
  expect(defined.size).toEqual({ width: 32, height: 32 });
  const crop = new Float32Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) crop.set(content.slice(((40 + y) * 160 + 100 + x) * 4, ((40 + y) * 160 + 100 + x) * 4 + 4), (y * 32 + x) * 4);
  patterns.set(defined.id, patternMips(patternFromLinear(32, 32, crop)));
  await page.evaluate(() => (window as unknown as SelectWindow).photoDebug.photo.getState().select(null));
  await check("Pattern Overlay: the photo's own pattern", [fx("pattern-overlay", { pattern: defined.id, scale: 100 })]);
  await check("…and as a texture", [fx("bevel-emboss", { size: 6, useTexture: true, texture: defined.id })]);

  // The Layer Style window: Pattern Overlay's page has the pattern picker (the photo's pattern in it) and Snap to Origin.
  await set({ layer: { style: { enabled: true, effects: [fx("pattern-overlay", { pattern: "builtin:grid", phaseX: 12 })] } } });
  const layerNow = () => page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.doc.doc.layers[0]) as Promise<{ style?: { effects: { type: string; params: Record<string, unknown> }[] } | null; fill?: number }>;
  await page.locator("[data-layer]").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Blending Options…" }).click();
  const dialog = page.locator("[data-layer-style]");
  await dialog.locator('[data-style-row^="pattern-overlay"]').getByRole("button", { name: "Pattern Overlay" }).click();
  await expect(dialog.locator('[data-page="pattern-overlay"]')).toBeVisible();
  await dialog.getByRole("button", { name: "Snap to Origin" }).click();
  await dialog.getByRole("button", { name: /^Pattern: Grid/ }).click();
  await page.getByRole("listbox", { name: "Patterns" }).getByRole("option", { name: "Pattern 1" }).click();
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await layerNow()).style?.effects[0].params).toMatchObject({ pattern: defined.id, phaseX: 0 });

  // Styles: a click replaces the layer's style, ⇧-click adds a style's effects; New Style keeps one.
  await page.getByRole("tab", { name: "Styles" }).click();
  await page.locator("[data-layer]").first().click();
  await page.locator('[data-style-preset="builtin:neon"]').click();
  await expect.poll(async () => (await layerNow()).style?.effects.map((e) => e.type)).toEqual(["outer-glow", "color-overlay", "inner-glow"]);
  await page.keyboard.down("Shift");
  await page.locator('[data-style-preset="builtin:outline"]').click();
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await layerNow()).style?.effects.map((e) => e.type)).toEqual(["outer-glow", "color-overlay", "inner-glow", "stroke"]);
  await page.locator('[data-style-preset="builtin:glass"]').click();
  await expect.poll(async () => (await layerNow()).fill).toBe(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await layerNow()).style?.effects.length).toBe(4);
  await page.getByRole("button", { name: "New Style" }).click();
  await page.getByLabel("Style name").fill("Neon Outline");
  await page.locator("[data-new-style]").getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("button", { name: "Neon Outline" })).toBeVisible();
  await set({ layer: { style: null } });
  await page.getByRole("button", { name: "Neon Outline" }).click();
  await expect.poll(async () => (await layerNow()).style?.effects.map((e) => e.type)).toEqual(["outer-glow", "color-overlay", "inner-glow", "stroke"]);

  // Scale Effects: every size doubled, one undo step.
  const sizes = async () => (await layerNow()).style!.effects.map((e) => e.params.size);
  const before = await sizes();
  await page.locator("[data-layer]").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Scale Effects…" }).click();
  const scaling = page.locator("[data-scale-effects]");
  await scaling.getByRole("spinbutton", { name: "Scale" }).click();
  await page.keyboard.type("200");
  await page.keyboard.press("Enter");
  await scaling.getByRole("button", { name: "OK" }).click();
  await expect.poll(sizes).toEqual(before.map((v) => (v === undefined ? undefined : Math.min(250, (v as number) * 2))));
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(sizes).toEqual(before);
  void layerId;
});

// --- F4: light ---

type LightWindow = {
  photoDebug: {
    photo: { getState(): { history: { doc: { doc: { canvas: { width: number; height: number }; layers: { id: string }[] } } }; commit(fn: (doc: unknown) => unknown): void } };
  };
};

/** Replaces the open photo's canvas and layers (one undo step), as the tests' starting point. */
const setPhoto = (page: Page, canvas: { width: number; height: number; background: string | null }, layers: unknown[]) =>
  page.evaluate(
    ({ canvas, layers }) => (window as unknown as LightWindow).photoDebug.photo.getState().commit((d) => ({ ...(d as object), canvas, layers })),
    { canvas, layers },
  );

/** A layer's fields replaced (one undo step). */
const patchLayer = (page: Page, id: string, patch: Record<string, unknown>) =>
  page.evaluate(
    ({ id, patch }) =>
      (window as unknown as LightWindow).photoDebug.photo
        .getState()
        .commit((d) => ({ ...(d as object), layers: (d as { layers: { id: string }[] }).layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
    { id, patch },
  );

const pixelLayer = (id: string, width: number, height: number) => ({ id, kind: "pixel", name: id, visible: true, opacity: 1, surface: null, size: { width, height }, transform: { x: width / 2, y: height / 2, scaleX: 1, scaleY: 1, rotation: 0 } });

const GLOW: GlowParams = { radius: 100, intensity: 0, threshold: 75, knee: 25, tint: "#ffb070", tintAmount: 30, mix: 100 };
const glowFilter = (id: string, params: Partial<GlowParams> = {}) => ({ id, type: "glow", version: 1, enabled: true, params: { ...GLOW, ...params } });

const maxOf = (a: ArrayLike<number>) => {
  let m = -Infinity;
  for (let i = 0; i < a.length; i++) m = Math.max(m, a[i]);
  return m;
};

/** The largest difference between two float images, relative to the larger value (and at least 1). */
function worstDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(b[i])));
  return worst;
}

test("a glow is its CPU reference, the same tiled as whole, and keeps light above white", async ({ page }) => {
  await openNewPhoto(page, "Glow");
  const W = 320;
  const H = 224;
  await setPhoto(page, { width: W, height: H, background: null }, [pixelLayer("lit", W, H)]);
  // Light above white in two spots, and a dim line that stays under the threshold.
  await paint(page, "lit", "content", [{ x: 80, y: 60 }], { radius: 5, hardness: 1, colour: [3, 2, 0.5, 1] });
  await paint(page, "lit", "content", [{ x: 230, y: 150 }], { radius: 3, hardness: 1, colour: [1.5, 1.5, 4, 1] });
  await paint(page, "lit", "content", line(20, 200, 300, 190), { radius: 4, hardness: 1, colour: [0.3, 0.3, 0.3, 1] });
  const whole: ViewBox = { zoom: 1, x: 0, y: 0, width: W, height: H };
  const content = await renderRegion(page, whole);
  // A new photo mixes as Photoshop does, in encoded values: light above white survives its Normal, and its Linear
  // Dodge (Add) too (F4's gate, in "photoshop" compositing).
  expect(await page.evaluate(() => (window as unknown as LightWindow).photoDebug.photo.getState().history.doc.doc)).toMatchObject({ compositing: "photoshop" });
  expect(maxOf(content)).toBeGreaterThan(2);
  await patchLayer(page, "lit", { blend: "linear-dodge" });
  expect(maxOf(await renderRegion(page, whole))).toBeGreaterThan(2);
  await patchLayer(page, "lit", { blend: undefined });

  await patchLayer(page, "lit", { filters: [glowFilter("g1")] });
  const glowing = await renderRegion(page, whole);
  const reference = glowReference({ width: W, height: H, data: Float64Array.from(content) }, GLOW).out;
  expect(worstDifference(glowing, reference)).toBeLessThan(4e-3);
  // Light above white survives to the output transform.
  expect(maxOf(glowing.filter((_, i) => i % 4 !== 3))).toBeGreaterThan(1);
  // The glow spills past the layer's pixels: coverage where there was none.
  expect(pixelAt(glowing, W, 80, 30)[3]).toBeGreaterThan(0);
  expect(pixelAt(content, W, 80, 30)[3]).toBe(0);

  // Regions far smaller than the radius (as an export's) give the very same pixels: no seams.
  let seams = 0;
  for (let y = 0; y < H; y += 64) {
    for (let x = 0; x < W; x += 64) {
      const tile = await renderRegion(page, { zoom: 1, x, y, width: 64, height: 64 });
      for (let j = 0; j < Math.min(64, H - y); j++) for (let i = 0; i < Math.min(64, W - x); i++) for (let c = 0; c < 4; c++) seams = Math.max(seams, Math.abs(tile[(j * 64 + i) * 4 + c] - glowing[((y + j) * W + x + i) * 4 + c]));
    }
  }
  expect(seams).toBeLessThan(1e-5);
});

/** A Lens Flare layer as the document holds it: the preset's elements for this canvas, adding in linear light. */
const flareLayer = (id: string, canvas: { width: number; height: number }, source: [number, number], extra: Record<string, unknown> = {}) => ({
  id,
  kind: "generator",
  name: "Lens Flare",
  visible: true,
  opacity: 1,
  blend: "linear-dodge",
  blendSpace: "linear",
  effect: { id: `${id}_fx`, type: "lens-flare", version: 1, enabled: true, params: { source, centre: null, intensity: 0, colour: "#ffffff", elements: flarePreset("classic", canvas.width, canvas.height), ...extra } },
});

test("a lens flare is its CPU reference added in linear light, and a reduced view of it is level 0 reduced", async ({ page }) => {
  // (A new photo mixes as Photoshop's does; the flare's Add in linear light still adds exactly: blendSpace.)
  await openNewPhoto(page, "Flare");
  const canvas = { width: 400, height: 300 };
  await setPhoto(page, { ...canvas, background: "#203040" }, [flareLayer("fl", canvas, [120, 90])]);
  const whole: ViewBox = { zoom: 1, ...{ x: 0, y: 0 }, ...canvas };
  const pixels = await renderRegion(page, whole);
  const shape = flareShape({ source: [120, 90], centre: null, intensity: 0, colour: "#ffffff", elements: flarePreset("classic", canvas.width, canvas.height) }, canvas, hexToLinear);
  const background = hexToLinear("#203040");
  let worst = 0;
  for (let y = 1; y < canvas.height; y += 7) {
    for (let x = 2; x < canvas.width; x += 7) {
      const light = flareLight(shape, x + 0.5, y + 0.5, 1, hexToLinear);
      const expected = [0, 1, 2].map((c) => background[c] + light[c]);
      const got = pixelAt(pixels, canvas.width, x, y);
      worst = Math.max(worst, worstDifference(got.slice(0, 3), expected));
      expect(got[3]).toBeCloseTo(1, 3);
    }
  }
  // Linear Add in linear light: the background plus the light, to f16's rounding.
  expect(worst).toBeLessThan(2e-3);
  // Its source is brighter than white: the output transform rolls it off.
  expect(maxOf(pixels)).toBeGreaterThan(1);

  // A quarter-size view, evaluated at its own level (it needs no refining), against level 0 box-reduced twice.
  const level2 = boxReduce(boxReduce({ ...canvas, data: Float64Array.from(pixels) }));
  const quarter = await renderRegion(page, { zoom: 0.25, x: 0, y: 0, width: 100, height: 75 });
  let reduced = 0;
  // (Not the canvas's edge, where the reference's Mitchell reads transparency past it.) Measured: 0.031, at the
  // ghosts' rims: their edges, widened by the footprint, aren't exactly a box.
  for (let y = 1; y < 74; y++) for (let x = 1; x < 99; x++) reduced = Math.max(reduced, worstDifference(pixelAt(quarter, 100, x, y), sampleMitchell(level2, x + 0.5, y + 0.5, 1)));
  expect(reduced).toBeLessThan(0.05);
});

/**
 * The photo with `background` as RGBA on 0..1, through the export's own path at `bits` (undithered, so files
 * compare exactly).
 */
const exportedPixels = (page: Page, background: string | null, bits: 8 | 16 = 8) =>
  page.evaluate(
    async ({ background, bits }) => {
      const { photoDebug } = window as unknown as LightWindow & { photoDebug: { renderer(): Promise<{ renderBands(doc: unknown, options: unknown, onBand: (from: number, rows: Uint8Array, width: number) => void): Promise<unknown> }> } };
      const doc = photoDebug.photo.getState().history.doc.doc as { canvas: object };
      const r = await photoDebug.renderer();
      const out: number[] = [];
      await r.renderBands({ ...doc, canvas: { ...doc.canvas, background } }, { bits, under: "none", dither: false }, (_from, rows) => {
        if (bits === 8) for (const v of rows) out.push(v / 255);
        else for (const v of new Uint16Array(rows.buffer, rows.byteOffset, rows.length / 2)) out.push(v / 65535);
      });
      return out;
    },
    { background, bits },
  );

test("a glowing object on transparency exports correctly over black, white and saturated backdrops", async ({ page }) => {
  await openNewPhoto(page, "Glow cut-out");
  const W = 200;
  const H = 160;
  await setPhoto(page, { width: W, height: H, background: null }, [pixelLayer("obj", W, H)]);
  await paint(page, "obj", "content", [{ x: 100, y: 80 }], { radius: 22, hardness: 0.6, colour: [2, 1.6, 0.8, 1] });
  await patchLayer(page, "obj", { filters: [glowFilter("g", { radius: 40, threshold: 50 })] });
  // A 16-bit PNG: 8 bits can't carry faint light (alpha under about 1%, which rounds by a whole step: up to ~7
  // levels over black, measured), a limit of the format, not of the light.
  const png = await exportedPixels(page, null, 16);
  // Colour is never without alpha; light spills past the object with coverage of its own.
  let spill = 0;
  for (let i = 0; i < W * H; i++) {
    if (png[i * 4 + 3] === 0) expect([png[i * 4], png[i * 4 + 1], png[i * 4 + 2]]).toEqual([0, 0, 0]);
    else if (png[i * 4 + 3] < 1) spill++;
  }
  expect(spill).toBeGreaterThan(1000);
  for (const compositing of ["linear", "photoshop"] as const) {
    await page.evaluate((compositing) => (window as unknown as LightWindow).photoDebug.photo.getState().commit((d) => ({ ...(d as object), compositing })), compositing);
    for (const backdrop of ["#000000", "#ffffff", "#e01030"]) {
      const app = await exportedPixels(page, backdrop);
      const b = hexToLinear(backdrop);
      let worst = 0;
      for (let i = 0; i < W * H; i++) {
        const a = png[i * 4 + 3];
        for (let c = 0; c < 3; c++) {
          // The file composited as a straight-alpha PNG is in linear light: a glowing layer blends in linear light
          // in either compositing (light adds physically).
          const over = linearToSrgb(srgbToLinear(png[i * 4 + c]) * a + b[c] * (1 - a)) * 255;
          worst = Math.max(worst, Math.abs(over - app[i * 4 + c] * 255));
        }
      }
      expect(worst, `${backdrop}, ${compositing}`).toBeLessThanOrEqual(1);
    }
  }
});

test("a glow viewed from its cached levels is level 0 reduced, and refines between them and 100%", async ({ page }) => {
  await openNewPhoto(page, "Glow levels");
  // Big enough that its pixels have a level 2 (a pyramid stops at a level that fits in one tile).
  const W = 1024;
  const H = 768;
  await setPhoto(page, { width: W, height: H, background: "#101418" }, [pixelLayer("lit", W, H)]);
  // (A new photo mixes as Photoshop's does; a glowing layer blends in linear light whatever the compositing.)
  await paint(page, "lit", "content", [{ x: 300, y: 240 }], { radius: 8, hardness: 1, colour: [4, 3, 1, 1] });
  await paint(page, "lit", "content", line(520, 500, 840, 600), { radius: 6, hardness: 0.8, colour: [1.2, 1.5, 2, 1] });
  await patchLayer(page, "lit", { filters: [glowFilter("g", { radius: 120, threshold: 60 })] });
  const full = await renderRegion(page, { zoom: 1, x: 0, y: 0, width: W, height: H });
  const compare = (view: number[], level: number, width: number, height: number) => {
    let image: { width: number; height: number; data: Float64Array | Float32Array } = { width: W, height: H, data: Float64Array.from(full) };
    for (let k = 0; k < level; k++) image = boxReduce(image);
    let worst = 0;
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) worst = Math.max(worst, worstDifference(pixelAt(view, width, x, y), sampleMitchell(image, x + 0.5, y + 0.5, 1)));
    return worst;
  };
  // A quarter: level 2, the glow's cached levels. Drawn at its own level, without refining.
  const quarter = await renderRegion(page, { zoom: 0.25, x: 0, y: 0, width: W / 4, height: H / 4 });
  const atQuarter = compare(quarter, 2, W / 4, H / 4);
  // A half: level 1, finer than the cache: drawn at its level it's a preview, and refined it's level 0 reduced.
  const half = await renderRegion(page, { zoom: 0.5, x: 0, y: 0, width: W / 2, height: H / 2 }, { refine: true });
  const atHalf = compare(half, 1, W / 2, H / 2);
  // Measured: 0.0008 refined at a half; 0.022 at a quarter, where octaves finer than the view are read at its level.
  expect(atHalf).toBeLessThan(4e-3);
  expect(atQuarter).toBeLessThan(0.05);
});

type DocWindow = { photoDebug: { photo: { getState(): { history: { doc: { doc: { layers: { id: string; kind: string; filters?: { id: string; type: string; enabled: boolean; params: Record<string, unknown> }[]; effect?: { params: Record<string, unknown> }; mask?: unknown }[] } } } } } } };
const docLayers = (page: Page) => page.evaluate(() => (window as unknown as DocWindow).photoDebug.photo.getState().history.doc.doc.layers);
const SHOTS = process.env.PHOTO_SHOTS;

let lightId = "";

test("glow and Lens Flare are added from Layers and edited in Properties; the flare's handle lands on the same document point at every zoom", async ({ page }) => {
  lightId = await openNewPhoto(page, "Light");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const [photo] = await docLayers(page);
  await page.locator(`[data-layer="${photo.id}"]`).click();

  // Glow: a filter on the selected layer, listed under it, shown in Properties.
  await page.getByRole("button", { name: "New adjustment layer" }).click();
  await page.getByRole("menuitem", { name: /Glow/ }).click();
  await expect(page.locator("[data-filter]")).toHaveCount(1);
  await expect(page.locator('[data-filter-properties="glow"]')).toBeVisible();
  const radius = page.locator('[data-filter-properties="glow"] [data-param="radius"]').getByRole("textbox");
  await radius.fill("240");
  await radius.press("Enter");
  await expect.poll(async () => (await docLayers(page))[0].filters?.[0].params.radius).toBe(240);
  // Its eye bypasses it, keeping its settings.
  await page.locator("[data-filter]").getByRole("button", { name: /Bypass/ }).click();
  await expect.poll(async () => (await docLayers(page))[0].filters?.[0]).toMatchObject({ enabled: false, params: { radius: 240 } });
  await page.locator("[data-filter]").getByRole("button", { name: /Turn .* on/ }).click();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "glow.png") });

  // Lens Flare: a layer above, its handles on the canvas.
  await page.getByRole("button", { name: "New adjustment layer" }).click();
  await page.getByRole("menuitem", { name: "Lens Flare" }).click();
  await expect(page.locator('[data-kind="generator"]')).toHaveCount(1);
  await expect(page.locator('[data-generator-properties="lens-flare"]')).toBeVisible();
  await expect(page.locator('[data-handle="source"]')).toBeVisible();
  const flareId = (await docLayers(page))[1].id;
  // An element added from the list's menu is shown, selected, in Properties.
  const before = Number(await page.locator("[data-elements]").getAttribute("data-elements"));
  await page.getByRole("button", { name: "Add an element" }).click();
  await page.getByRole("menuitem", { name: "Anamorphic streak" }).click();
  await expect(page.locator("[data-elements]")).toHaveAttribute("data-elements", String(before + 1));
  await expect(page.locator('[data-element-properties="streak"]')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "flare.png") });

  // The source handle dragged to document point (430, 310) at a third, at 100% and at 250%: the same point each time.
  const sourceOf = async () => (await docLayers(page)).find((l) => l.id === flareId)!.effect!.params.source as number[];
  for (const zoom of [1 / 3, 1, 2.5]) {
    await page.evaluate(
      ({ zoom }) => {
        const ui = (window as unknown as PaintWindow).photoDebug.ui.getState();
        const view = ui.view;
        // Centred on the point, so it's on screen.
        ui.setView({ ...view, zoom, x: 430 - view.width / zoom / 2, y: 310 - view.height / zoom / 2 });
      },
      { zoom },
    );
    // Away first, so each drag moves it.
    const handle = page.locator('[data-handle="source"]');
    const from = (await handle.boundingBox())!;
    const to = await screenOf(page, 430, 310);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 40, to.y + 30, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
    const [x, y] = await sourceOf();
    expect(Math.abs(x - 430), `x at ${zoom}`).toBeLessThan(0.75 / zoom + 0.01);
    expect(Math.abs(y - 310), `y at ${zoom}`).toBeLessThan(0.75 / zoom + 0.01);
  }
  // A drag is one undo step, and Escape cancels one.
  const at = await sourceOf();
  const handle = (await page.locator('[data-handle="source"]').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 80, handle.y + 60, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await sourceOf()).toEqual(at);
  // Saved as it is (the next test reopens it).
  await expect.poll(async () => (await savedPhoto(page, lightId)).layers.find((l: { id: string }) => l.id === flareId)?.effect.params.source).toEqual(at);
});

/** A SHA-256 of the open photo rendered at a fixed view: whether two states look the same, to the bit. */
const renderDigest = (page: Page, view: ViewBox) =>
  page.evaluate(async (view) => {
    const { photoDebug } = window as unknown as DebugWindow;
    const r = await photoDebug.renderer();
    const { texture } = await r.renderView(photoDebug.photo.getState().history.doc.doc, view, { refine: true });
    const data = await r.readFloat(texture, view.width, view.height);
    texture.destroy();
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Float32Array(data)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  }, view);

test("reordering, bypassing, masking, undoing and reopening keep every setting of the light", async ({ page }) => {
  await page.goto(`/p/${lightId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const photo = (await docLayers(page)).find((l) => l.kind === "image")!;
  // A second glow, from the Layers menu, tinted.
  await page.locator(`[data-layer="${photo.id}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add Glow Filter" }).click();
  await expect(page.locator(`[data-filter-of="${photo.id}"]`)).toHaveCount(2);
  const amount = page.locator('[data-filter-properties="glow"] [data-param="tintAmount"]').getByRole("textbox");
  await amount.fill("60");
  await amount.press("Enter");
  const filters = async () => (await docLayers(page)).find((l) => l.id === photo.id)!.filters!;
  await expect.poll(async () => (await filters())[1].params.tintAmount).toBe(60);
  const [first, second] = (await filters()).map((f) => f.id);

  // Dragged below the first (the list shows the last applied on top): it applies first now.
  const top = (await page.locator(`[data-filter="${second}"]`).boundingBox())!;
  const below = (await page.locator(`[data-filter="${first}"]`).boundingBox())!;
  // (By its name: its eye is at its left.)
  await page.mouse.move(top.x + 150, top.y + top.height / 2);
  await page.mouse.down();
  await page.mouse.move(below.x + 150, below.y + below.height - 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await filters()).map((f) => f.id)).toEqual([second, first]);

  // The Filters row's eye bypasses both, each keeping its own; a mask from the footer, painted.
  await page.locator(`[data-filters="${photo.id}"]`).getByRole("button", { name: "Bypass every filter" }).click();
  await expect.poll(async () => (await docLayers(page)).find((l) => l.id === photo.id)).toMatchObject({ filtersEnabled: false });
  await page.locator(`[data-filters="${photo.id}"]`).getByRole("button", { name: "Turn the filters on" }).click();
  await page.locator(`[data-layer="${photo.id}"]`).click();
  await page.getByRole("button", { name: /Add a mask/ }).click();
  await paint(page, photo.id, "mask", line(200, 200, 900, 700), { radius: 60, colour: [0, 0, 0, 1] });
  await expect.poll(async () => typeof (await docLayers(page)).find((l) => l.id === photo.id)!.mask).toBe("object");

  // Undone and redone: the same.
  const view: ViewBox = { zoom: 0.25, x: 0, y: 0, width: 400, height: 300 };
  const doc = await docLayers(page);
  const look = await renderDigest(page, view);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => await docLayers(page)).not.toEqual(doc);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => await docLayers(page)).toEqual(doc);
  expect(await renderDigest(page, view)).toBe(look);

  // Reopened: every setting, and the same pixels.
  await expect.poll(async () => (await savedPhoto(page, lightId)).layers).toEqual(doc);
  await page.reload();
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  expect(await docLayers(page)).toEqual(doc);
  expect(await renderDigest(page, view)).toBe(look);
});

test("the Filter menu applies a look; the Filter Gallery previews one on the photo and applies it; Last Filter adds the last one again", async ({ page }) => {
  await openNewPhoto(page, "Filters");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const [photo] = await docLayers(page);
  await page.locator(`[data-layer="${photo.id}"]`).click();
  const filtersOf = async () => (await docLayers(page)).find((l) => l.id === photo.id)!.filters ?? [];

  // Filter › Light › Glow › Neon: the look's settings, its radius sized for this canvas.
  await page.locator("[data-filter-menu]").click();
  await page.getByRole("menuitem", { name: "Glow" }).hover();
  await page.locator('[data-filter-item="glow/neon"]').click();
  await expect.poll(async () => (await filtersOf())[0]?.params).toMatchObject({ radius: Math.round(0.015 * Math.hypot(1600, 1200)), threshold: 60, knee: 15, intensity: 0.8 });
  await expect(page.locator('[data-filter-properties="glow"]')).toBeVisible();

  // Changed in Properties, then Last Filter: the same filter again, as it is now.
  const radius = page.locator('[data-filter-properties="glow"] [data-param="radius"]').getByRole("textbox");
  await radius.fill("77");
  await radius.press("Enter");
  await expect.poll(async () => (await filtersOf())[0].params.radius).toBe(77);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.locator("[data-filter-menu]").click();
  await page.getByRole("menuitem", { name: /^Last Filter: Glow/ }).click();
  await expect.poll(async () => (await filtersOf()).map((f) => f.params.radius)).toEqual([77, 77]);

  // The gallery: a card for every look, each a picture of it on the sample scene (once the last menu has gone).
  await expect(page.getByRole("menu")).toHaveCount(0);
  const openGallery = async () => {
    await page.locator("[data-filter-menu]").click();
    await page.getByRole("menuitem", { name: "Filter Gallery…" }).click();
    await expect(page.locator("[data-filter-gallery]")).toBeVisible();
  };
  await openGallery();
  const cards = page.locator("[data-filter-card]");
  await expect(cards).toHaveCount(FILTER_ENTRIES.length);
  // Every card's picture is there (the lazy ones loaded as they're scrolled to).
  for (const entry of FILTER_ENTRIES) {
    const ok = await page.request.get(`/photo-filters/${entry.key.replace("/", "--")}.jpg`);
    expect(ok.ok(), entry.key).toBe(true);
    expect(ok.headers()["content-type"], entry.key).toContain("image/jpeg");
  }
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "filter-gallery.png") });

  // A click previews a look on the canvas: the renderer shows it, the document doesn't have it.
  const shownFilters = () =>
    page.evaluate(async (id) => ((await (window as unknown as DebugWindow).photoDebug.renderer()) as unknown as { doc: { layers: { id: string; filters?: { type: string; params: Record<string, unknown> }[] }[] } }).doc.layers.find((l) => l.id === id)?.filters ?? [], photo.id);
  // What the canvas shows, settled (its refinement and glow caches done), as a digest.
  const screenNow = () =>
    page.evaluate(async () => {
      const r = await (window as unknown as DebugWindow).photoDebug.renderer();
      const s = (await (r as unknown as { readScreen(): Promise<{ data: Float32Array } | null> }).readScreen())!;
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Float32Array(s.data)))].map((x) => x.toString(16).padStart(2, "0")).join("");
    });
  const settled = async () => {
    await expect.poll(() => refineState(page), { timeout: 20_000 }).toMatch(/none|refined/);
    return screenNow();
  };
  const plain = await settled();
  const before = (await filtersOf()).length;
  await page.locator('[data-filter-card="glow/bloom"]').click();
  await expect(page.locator('[data-filter-card="glow/bloom"]')).toHaveAttribute("data-picked", "true");
  // The canvas shows it, without anything else happening (no edit, no pan).
  await expect.poll(screenNow, { timeout: 10_000 }).not.toBe(plain);
  const bloom = await settled();
  // Another look replaces it on the canvas.
  await page.locator('[data-filter-card="gradient-map/purple-haze"]').click();
  await expect.poll(screenNow, { timeout: 10_000 }).not.toBe(bloom);
  expect(await settled()).not.toBe(plain);
  // Cancel: the canvas as it was.
  await page.locator("[data-filter-cancel]").click();
  await expect.poll(screenNow, { timeout: 10_000 }).toBe(plain);
  await page.locator('[data-filter-card="glow/bloom"]').click();
  await expect(page.locator('[data-filter-settings="glow/bloom"]')).toBeVisible();
  await expect.poll(async () => (await shownFilters()).length).toBe(before + 1);
  expect((await filtersOf()).length).toBe(before);
  // Its settings change the preview, not the document.
  const previewRadius = page.locator('[data-filter-settings="glow/bloom"] [data-param="radius"]').getByRole("textbox");
  await previewRadius.fill("33");
  await previewRadius.press("Enter");
  await expect.poll(async () => (await shownFilters()).at(-1)?.params.radius).toBe(33);
  expect((await filtersOf()).length).toBe(before);
  // Cancel: as it was.
  await page.locator("[data-filter-cancel]").click();
  await expect.poll(async () => (await shownFilters()).length).toBe(before);
  await expect(page.locator("[data-filter-card][data-picked]")).toHaveCount(0);
  // Picked again and changed, then Apply: one undo step with those settings, and the gallery closes.
  await page.locator('[data-filter-card="glow/neon"]').click();
  const neonRadius = page.locator('[data-filter-settings="glow/neon"] [data-param="radius"]').getByRole("textbox");
  await neonRadius.fill("41");
  await neonRadius.press("Enter");
  await page.locator("[data-filter-apply]").click();
  await expect(page.locator("[data-filter-gallery]")).toHaveCount(0);
  await expect.poll(async () => (await filtersOf()).length).toBe(before + 1);
  expect((await filtersOf()).at(-1)!.params).toMatchObject({ radius: 41, threshold: 60, knee: 15 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(async () => (await filtersOf()).length).toBe(before);

  // Searched, picked, then Enter: Lens Flare's Anamorphic, a new layer with its streak.
  await openGallery();
  await page.getByRole("textbox", { name: "Search filters" }).fill("streak");
  await expect(cards).toHaveCount(1);
  await page.locator('[data-filter-card="lens-flare/anamorphic"]').click();
  expect((await docLayers(page)).filter((l) => l.kind === "generator").length).toBe(0);
  await page.locator('[data-filter-card="lens-flare/anamorphic"]').press("Enter");
  await expect.poll(async () => (await docLayers(page)).filter((l) => l.kind === "generator").length).toBe(1);
  const flare = (await docLayers(page)).find((l) => l.kind === "generator")!;
  expect((flare.effect!.params.elements as { type: string }[]).some((e) => e.type === "streak")).toBe(true);

  // A double-click applies a kernel filter straight away (a gradient map on the photo).
  await page.locator(`[data-layer="${photo.id}"]`).click();
  await openGallery();
  await page.locator('[data-filter-card="gradient-map/purple-haze"]').dblclick();
  await expect(page.locator("[data-filter-gallery]")).toHaveCount(0);
  await expect.poll(async () => (await filtersOf()).at(-1)?.type).toBe("gradient-map");
  await expect(page.locator('[data-filter-properties="gradient-map"] [data-gradient-picker]')).toBeVisible();

  // On an adjustment layer, filters can't go (said so on their cards); generators still can.
  await page.getByRole("button", { name: "New adjustment layer" }).click();
  await page.getByRole("menuitem", { name: /Exposure/ }).click();
  await openGallery();
  await expect(page.locator('[data-filter-card="glow/bloom"]')).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator('[data-filter-card="lens-flare/classic"]')).not.toHaveAttribute("aria-disabled", "true");
  await page.locator('[data-filter-card="glow/bloom"]').click({ force: true });
  await expect(page.locator("[data-filter-card][data-picked]")).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "filter-gallery-adjustment.png") });
  // Escape with nothing picked closes it.
  await page.getByRole("textbox", { name: "Search filters" }).press("Escape");
  await expect(page.locator("[data-filter-gallery]")).toHaveCount(0);
});

test("an export cancelled while it renders writes nothing and lets go of what the server was sent", async ({ page }) => {
  await openNewPhoto(page, "Cancelled export");
  // 48 MP: long enough to render that Cancel lands mid-way.
  await setPhoto(page, { width: 8000, height: 6000, background: "#334455" }, []);
  const work = path.join("e2e", ".data", "exports", "photo");
  const leftovers = async () => (await fs.readdir(work).catch(() => [] as string[])).filter((n) => n.startsWith("samples-"));
  let downloaded = false;
  page.on("download", () => (downloaded = true));
  await page.locator("[data-photo-header]").getByRole("button", { name: "Export", exact: true }).click();
  const window = page.locator("[data-window]").filter({ hasText: "Export photo" });
  await window.getByRole("button", { name: "Export", exact: true }).click();
  await expect(window.locator("[data-export-progress]")).toBeVisible();
  await window.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(window.locator("[data-export-cancelled]")).toBeVisible();
  await expect.poll(leftovers).toEqual([]);
  expect(downloaded).toBe(false);
  // Exported again, it goes through.
  await setPhoto(page, { width: 400, height: 300, background: "#334455" }, []);
  const download = page.waitForEvent("download");
  await window.getByRole("button", { name: "Export", exact: true }).click();
  await download;
  await expect(window.locator("[data-export-done]")).toBeVisible();
  expect(downloaded).toBe(true);
  await window.getByRole("button", { name: "Close", exact: true }).click();
});

test("the GPU lost mid-stroke: that stroke isn't kept and the user is told; the photo is drawn again and painting goes on", async ({ page }) => {
  await openNewPhoto(page, "Device loss");
  await setPhoto(page, { width: 600, height: 400, background: "#ffffff" }, [pixelLayer("paint", 600, 400)]);
  await page.evaluate(() => (window as unknown as { photoDebug: { ui: { getState(): { select(id: string): void } } } }).photoDebug.ui.getState().select("paint"));
  await page.keyboard.press("b");
  const surface = async () => ((await docLayers(page)).find((l) => l.id === "paint") as unknown as { surface: string | null }).surface;
  const view: ViewBox = { zoom: 0.5, x: 0, y: 0, width: 300, height: 200 };
  const before = await renderDigest(page, view);
  const recoveries = () => page.evaluate(async () => ((await (window as unknown as DebugWindow).photoDebug.renderer()) as unknown as { recoveries: number }).recoveries);
  const recovered = await recoveries();

  // A stroke begun, the device lost halfway, then finished.
  const from = await screenOf(page, 100, 200);
  const to = await screenOf(page, 500, 200);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, from.y, { steps: 6 });
  await page.evaluate(async () => {
    const r = (await (window as unknown as DebugWindow).photoDebug.renderer()) as unknown as { simulateLoss(): Promise<void> };
    await r.simulateLoss();
  });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText("The GPU stopped mid-stroke")).toBeVisible();
  expect(await surface()).toBeNull();
  expect(await recoveries()).toBe(recovered + 1);
  // Drawn again, as it was.
  expect(await renderDigest(page, view)).toBe(before);

  // The next stroke paints and is kept.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(surface).not.toBeNull();
  expect(await renderDigest(page, view)).not.toBe(before);
});

test("effects from a newer app (or of a type this one doesn't know) are kept as they are, said to be unavailable, and draw nothing", async ({ page }) => {
  const id = await openNewPhoto(page, "From the future");
  const future = (type: string, version: number, extra: Record<string, unknown> = {}) => ({ id: `${type}_future`, type, version, enabled: true, params: { tomorrow: [1, 2, 3], ...extra } });
  const lit = { ...pixelLayer("lit", 300, 200), filters: [future("glow", 99, { radius: 40 }), future("sparkle", 1)], style: { enabled: true, effects: [future("drop-shadow", 42)] } };
  const adjustment = { id: "adj", kind: "adjustment", name: "Future exposure", visible: true, opacity: 1, effect: future("exposure", 9, { exposure: 2 }) };
  const generator = { id: "gen", kind: "generator", name: "Future flare", visible: true, opacity: 1, effect: future("lens-flare", 7), blend: "linear-dodge", blendSpace: "linear" };
  await setPhoto(page, { width: 300, height: 200, background: "#406080" }, [lit, adjustment, generator]);
  await paint(page, "lit", "content", line(40, 100, 260, 100), { radius: 12, hardness: 1, colour: [1, 0.6, 0.2, 1] });
  const layers = await docLayers(page);

  // Each is said to be unavailable where it's shown.
  await expect(page.getByLabel("Filter unavailable")).toHaveCount(2);
  await expect(page.getByLabel("Adjustment unavailable")).toHaveCount(1);
  await page.locator('[data-layer="lit"]').click();
  await expect(page.locator('[data-effect="drop-shadow_future"] [data-unavailable]')).toHaveText("Drop Shadow (unavailable)");

  // It draws exactly what it would without them.
  const view: ViewBox = { zoom: 1, x: 0, y: 0, width: 300, height: 200 };
  const shown = await renderDigest(page, view);
  await patchLayer(page, "lit", { filters: [], style: null });
  await page.evaluate(() =>
    (window as unknown as LightWindow).photoDebug.photo.getState().commit((d) => ({ ...(d as object), layers: (d as { layers: { id: string }[] }).layers.filter((l) => l.id === "lit") })),
  );
  expect(await renderDigest(page, view)).toBe(shown);
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => docLayers(page)).toEqual(layers);

  // Saved and reopened byte for byte: an older app never drops or repairs what a newer one wrote.
  await expect.poll(async () => (await savedPhoto(page, id)).layers).toEqual(layers);
  await page.reload();
  await expect(page.getByLabel("Filter unavailable")).toHaveCount(2);
  expect(await docLayers(page)).toEqual(layers);
});

/** A SHA-256 of the photo rendered at full size through the export's own path (16 bits, undithered). */
const exportDigest = (page: Page) =>
  page.evaluate(async () => {
    const { photoDebug } = window as unknown as LightWindow & { photoDebug: { renderer(): Promise<{ renderBands(doc: unknown, options: unknown, onBand: (from: number, rows: Uint8Array) => void): Promise<unknown> }> } };
    const r = await photoDebug.renderer();
    const bands: Uint8Array[] = [];
    await r.renderBands(photoDebug.photo.getState().history.doc.doc, { bits: 16, under: "none", dither: false }, (_from, rows) => void bands.push(rows.slice()));
    const all = new Uint8Array(bands.reduce((n, b) => n + b.length, 0));
    bands.reduce((at, b) => (all.set(b, at), at + b.length), 0);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", all))].map((b) => b.toString(16).padStart(2, "0")).join("");
  });

/** Opens the photo again with a GPU budget of `mb` (the bench's hook). */
const reopenWithBudget = (page: Page, mb: number) =>
  page.evaluate(async (mb) => {
    const bench = (await (window as unknown as { photoBench: { load(): Promise<{ setBudget(mb: number): Promise<unknown> }> } }).photoBench.load());
    await bench.setBudget(mb);
  }, mb);

test("a tight GPU budget draws and exports exactly what a generous one does, evicting tiles as it goes", async ({ page }) => {
  await openNewPhoto(page, "Budget");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const [image] = await docLayers(page);
  // An image with a mask and a wide glow, under a painted layer: every kind of tile the atlas holds.
  await page.evaluate(
    (layer) => (window as unknown as LightWindow).photoDebug.photo.getState().commit((d) => ({ ...(d as object), layers: [...(d as { layers: unknown[] }).layers, layer] })),
    pixelLayer("paint", 1600, 1200),
  );
  await paint(page, "paint", "content", line(100, 100, 1500, 1100), { radius: 80, hardness: 0.7, colour: [1, 0.2, 0.1, 1] });
  await patchLayer(page, image.id, { filters: [glowFilter("g1", { radius: 300 })], mask: { surface: null } });
  await paint(page, image.id, "mask", line(1500, 100, 100, 1100), { radius: 120, colour: [0, 0, 0, 1] });
  const view: ViewBox = { zoom: 1, x: 500, y: 300, width: 600, height: 500 };
  const generous = { exported: await exportDigest(page), shown: await renderDigest(page, view) };

  // 48 MB holds 96 tiles of half floats: a region's tiles, but far fewer than the photo's layers have, so tiles
  // come and go (the image's, its mask's, the painted layer's). A smaller budget can't hold one region: that's an
  // error saying so (below), never wrong pixels.
  await reopenWithBudget(page, 48);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  expect(await exportDigest(page)).toBe(generous.exported);
  expect(await renderDigest(page, view)).toBe(generous.shown);
  const evictions = await page.evaluate(async () => ((await (window as unknown as DebugWindow).photoDebug.renderer()) as unknown as { evictions: number }).evictions);
  expect(evictions).toBeGreaterThan(0);

  // Too small for one region: the export says so.
  await reopenWithBudget(page, 24);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await expect(exportDigest(page)).rejects.toThrow(/needs more GPU memory for one region than Settings › Photo allows \(24 MB\)/);
  await reopenWithBudget(page, 2048);
});
