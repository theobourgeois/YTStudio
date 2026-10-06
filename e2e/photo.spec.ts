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
import { curvesFor, exposurePixel, type Pixel } from "../shared/photo/reference/adjustments.ts";
import { boxReduce, sampleMitchell } from "../shared/photo/reference/reduce.ts";

test.describe.configure({ mode: "serial" });

const SAMPLES = path.resolve(import.meta.dirname, "..", "samples");
const PHOTO = path.join(SAMPLES, "photo-1600x1200.jpg");
const STICKER = path.join(SAMPLES, "sticker-800.png");

const savedPhoto = async (page: Page, id: string) => (await page.request.get(`/api/projects/${id}`)).json();

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
  const shot = await page.screenshot({ clip: { x: Math.floor(left), y: Math.floor(top), width: 1, height: 1 } });
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
    photo: { getState(): { history: { doc: { layers: { id: string; kind: string; effect?: { params: Record<string, unknown> } }[] } }; commit(fn: (doc: unknown) => unknown): void } };
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
      const doc = photoDebug.photo.getState().history.doc;
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

test("a new photo from the New tile starts at a size, ready for an image", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New photo" }).click();
  await expect(page.locator('[data-suite="photo"]')).toBeVisible();
  await expect(page.locator("[data-start-card]")).toBeVisible();
  await expect(page.locator("[data-photo-status]")).toContainText("1080 × 1920 px");
  // A preset changes the canvas (undoably).
  await page.locator("[data-start-card]").getByRole("button", { name: /Thumbnail/ }).click();
  await expect(page.locator("[data-photo-status]")).toContainText("1280 × 720 px");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-photo-status]")).toContainText("1080 × 1920 px");
});

test("an image opens as the canvas, drawn by the GPU, and exports bit for bit", async ({ page }) => {
  photoId = await openNewPhoto(page, "Exact");
  await page.locator("[data-start-input]").setInputFiles(PHOTO);
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

  // Arrow keys nudge (on the canvas, not in a field); a burst of them is one undo step.
  await page.getByLabel("Photo canvas").click({ position: { x: 5, y: 5 } });
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
  await page.locator("[data-start-input]").setInputFiles(PHOTO);
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
  await page.locator("[data-start-input]").setInputFiles(PHOTO);
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
    const { texture } = await r.renderView(photoDebug.photo.getState().history.doc, { ...view, width: screen.width, height: screen.height }, { refine: true });
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
  await page.locator("[data-start-input]").setInputFiles(file);
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

test("clicking the canvas picks the layer under the pointer, outlined while it's hovered (Auto-Select)", async ({ page }) => {
  pickingId = await openNewPhoto(page, "Picking");
  await page.locator("[data-start-input]").setInputFiles(PHOTO);
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
  // Where there's no layer (the pasteboard), the selection stays.
  const outside = await screenOf(page, -60, -60);
  await page.mouse.click(outside.x, outside.y);
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
  expect(await page.locator('[data-rotate-zone="1,1"]').evaluate((e) => (e as SVGElement).style.cursor)).toMatch(/^url\(/);
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
