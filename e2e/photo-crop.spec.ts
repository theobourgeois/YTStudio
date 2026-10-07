/**
 * The photo suite's Crop tool (docs/photo/tools/crop.md): the canvas cropped with nothing selected (everything placed
 * in document pixels moved with it, masks too, nothing resampled), one layer cropped when it's selected (its pixels
 * kept), and the assistant's crops. Its own photos, as `photo.spec.ts`'s; run alone with `pnpm test:e2e photo-crop`.
 */
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const SAMPLES = path.resolve(import.meta.dirname, "..", "samples");
const PHOTO = path.join(SAMPLES, "photo-1600x1200.jpg");
const STICKER = path.join(SAMPLES, "sticker-800.png");
const SHOTS = process.env.CROP_SHOTS;

const savedPhoto = async (page: Page, id: string) => (await page.request.get(`/api/projects/${id}`)).json();

async function openNewPhoto(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/projects", { data: { suite: "photo", name } });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/p/${id}`);
  await expect(page.locator('[data-suite="photo"]')).toBeVisible();
  return id;
}

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

interface ViewBox {
  zoom: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

type Layer = { id: string; kind: string; mask?: { surface: string | null }; effect?: { params: Record<string, unknown> } };

type DebugWindow = {
  photoDebug: {
    renderer(): Promise<{
      renderView(doc: unknown, view: ViewBox): Promise<{ texture: { destroy(): void } }>;
      readFloat(texture: unknown, width: number, height: number): Promise<Float32Array>;
    }>;
    photo: { getState(): { history: { doc: { doc: { layers: Layer[] } } }; commit(fn: (doc: { layers: Layer[] }) => unknown): void } };
    ui: { getState(): { view: ViewBox } };
    paint(layerId: string, part: "content" | "mask", points: { x: number; y: number }[], options?: { radius?: number }): Promise<{ id: string } | null>;
  };
};

/** The open photo rendered by the app's renderer at `view` (zoom 1: level 0), as RGBA floats; `hide` leaves layers out. */
async function renderRegion(page: Page, view: ViewBox, hide: string[] = []): Promise<number[]> {
  return page.evaluate(
    async ({ view, hide }) => {
      const { photoDebug } = window as unknown as DebugWindow;
      const r = await photoDebug.renderer();
      const doc = photoDebug.photo.getState().history.doc.doc;
      const shown = { ...doc, layers: doc.layers.map((l) => (hide.includes(l.id) ? { ...l, visible: false } : l)) };
      const { texture } = await r.renderView(shown, view);
      const data = await r.readFloat(texture, view.width, view.height);
      texture.destroy();
      return Array.from(data);
    },
    { view, hide },
  );
}

/** Where document point (x, y) is on the page (CSS pixels), as the canvas shows it now. */
async function onScreen(page: Page, x: number, y: number) {
  const box = (await page.getByLabel("Photo canvas").boundingBox())!;
  const view = await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.ui.getState().view);
  const dpr = await page.evaluate(() => devicePixelRatio);
  return { x: box.x + ((x - view.x) * view.zoom) / dpr, y: box.y + ((y - view.y) * view.zoom) / dpr };
}

/** Drags from one page point to another in steps (a real pointer's drag). */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) / 2, from.y + (to.y - from.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** A handle's centre on the page. */
async function handle(page: Page, which: string) {
  const b = (await page.locator(`[data-crop-handle="${which}"]`).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const cropBox = async (page: Page) => (await page.locator("[data-crop-overlay]").getAttribute("data-crop-box"))!.split(",").map(Number);

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

/** Samples along a line, every few pixels (as a pointer gives them). */
const line = (x0: number, y0: number, x1: number, y1: number, step = 3) => {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));
};

const differs = (a: number[], b: number[], tolerance = 1e-3) => a.some((v, i) => Math.abs(v - b[i]) > tolerance);

let photoId = "";

test("with no layer selected the Crop tool crops the canvas: everything moves with it, masks exactly, in one undo step", async ({ page }) => {
  photoId = await openNewPhoto(page, "Cropped");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  // An Exposure layer whose mask (document pixels) hides it along a stroke, across tile edges.
  await page.getByRole("button", { name: "New adjustment layer" }).click();
  await page.getByRole("menuitem", { name: /Exposure/ }).click();
  await page.getByRole("button", { name: /Add a mask/ }).click();
  const adjustment = await expect.poll(async () => (await savedPhoto(page, photoId)).layers[1]?.mask).toEqual({ surface: null }).then(async () => (await savedPhoto(page, photoId)).layers[1].id as string);
  await page.evaluate((id) => {
    const { photo } = (window as unknown as DebugWindow).photoDebug;
    photo.getState().commit((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, effect: { ...l.effect!, params: { ...l.effect!.params, exposure: 1 } } } : l)) }));
  }, adjustment);
  const stroke = await page.evaluate(({ id, points }) => (window as unknown as DebugWindow).photoDebug.paint(id, "mask", points, { radius: 60 }), { id: adjustment, points: line(300, 500, 1100, 500) });
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[1].mask.surface).toBe(stroke!.id);
  // What the photo shows across the stroke's edge, before.
  const region = { zoom: 1, x: 600, y: 520, width: 48, height: 64 };
  const before = await renderRegion(page, region);

  // C: with the adjustment selected (it has no place of its own), the canvas is cropped.
  await page.keyboard.press("c");
  await expect(page.locator('[data-tool-options="crop"]')).toBeVisible();
  await expect(page.locator('[data-crop-target="canvas"]')).toBeVisible();
  await expect(page.locator('[data-crop-overlay="canvas"]')).toHaveAttribute("data-crop-box", "0,0,1600,1200");
  await shot(page, "canvas-start");

  // The top-left handle dragged in: pending; Escape puts it back.
  await drag(page, await handle(page, "0,0"), await onScreen(page, 213, 171));
  await expect(page.locator("[data-crop-overlay]")).toHaveAttribute("data-crop-pending", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-crop-overlay]")).toHaveAttribute("data-crop-box", "0,0,1600,1200");
  await expect(page.locator("[data-crop-overlay]")).not.toHaveAttribute("data-crop-pending", "true");

  // Again, and the bottom-right too; the thirds show while it's dragged.
  await drag(page, await handle(page, "0,0"), await onScreen(page, 213, 171));
  const corner = await handle(page, "1,1");
  const target = await onScreen(page, 1350, 1000);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await expect(page.locator("[data-crop-grid]")).toHaveCount(4);
  await expect(page.locator("[data-crop-size]")).toBeVisible();
  await shot(page, "canvas-dragging");
  await page.mouse.up();
  const [x, y, width, height] = await cropBox(page);
  expect(x).toBeGreaterThan(150);
  expect(y).toBeGreaterThan(100);
  expect(width).toBeLessThan(1600 - x);
  await expect(page.locator("[data-crop-size-label]")).toHaveText(`${width} × ${height} px`);
  await shot(page, "canvas-pending");

  // Enter crops: the canvas is the box, the photo and the mask moved by its corner.
  await page.keyboard.press("Enter");
  const cropped = await expect.poll(async () => (await savedPhoto(page, photoId)).canvas.width).toBe(width).then(() => savedPhoto(page, photoId));
  expect(cropped.canvas).toMatchObject({ width, height });
  expect(cropped.layers[0].transform).toMatchObject({ x: 800 - x, y: 600 - y, scaleX: 1, rotation: 0 });
  expect(cropped.layers[1].mask.surface).not.toBe(stroke!.id);
  expect(cropped.layers[1].mask.surface).toMatch(/^[0-9a-f]{64}$/);
  // The same pixels where they've moved to (whole-pixel moves resample nothing).
  const after = await renderRegion(page, { ...region, x: region.x - x, y: region.y - y });
  expect(differs(after, before)).toBe(false);
  // The new box covers the new canvas.
  await expect(page.locator("[data-crop-overlay]")).toHaveAttribute("data-crop-box", `0,0,${width},${height}`);
  await shot(page, "canvas-cropped");

  // One undo step puts everything back; redo crops again.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, photoId)).canvas.width).toBe(1600);
  expect((await savedPhoto(page, photoId)).layers[1].mask.surface).toBe(stroke!.id);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await savedPhoto(page, photoId)).canvas.width).toBe(width);

  // Past the canvas grows it: the photo's pixels cropped away come back.
  const grow = await handle(page, "0,0");
  await drag(page, grow, { x: grow.x - 60, y: grow.y - 40 });
  const [gx, gy] = await cropBox(page);
  expect(gx).toBeLessThan(0);
  expect(gy).toBeLessThan(0);
  await page.locator("[data-crop-commit]").click();
  await expect.poll(async () => (await savedPhoto(page, photoId)).canvas.width).toBe(width - gx);
  const grown = await savedPhoto(page, photoId);
  expect(grown.layers[0].transform).toMatchObject({ x: 800 - x - gx, y: 600 - y - gy });
});

test("a selection starts the box at its bounds", async ({ page }) => {
  await page.goto(`/p/${photoId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await page.evaluate(() => {
    const { photo } = (window as unknown as { photoDebug: { photo: { getState(): { select(s: unknown): void } } } }).photoDebug;
    photo.getState().select({ kind: "rect", x: 100.5, y: 50, width: 300, height: 200 });
  });
  await page.keyboard.press("c");
  await expect(page.locator("[data-crop-overlay]")).toHaveAttribute("data-crop-box", "100,50,301,200");
  await expect(page.locator("[data-crop-overlay]")).toHaveAttribute("data-crop-pending", "true");
  // A ratio holds the box to it: the largest of it inside the canvas.
  await page.locator("[data-crop-ratio]").click();
  await page.getByRole("option", { name: /1 : 1/ }).click();
  const [, , w, h] = await cropBox(page);
  expect(w).toBe(h);
  await page.keyboard.press("Escape");
  await page.locator("[data-crop-ratio]").click();
  await page.getByRole("option", { name: "Free" }).click();
});

test("with a layer selected it crops that layer alone, kept whole underneath, and the Move tool handles what shows", async ({ page }) => {
  await page.goto(`/p/${photoId}`);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await page.keyboard.press("v");
  await page.locator("[data-place-input]").setInputFiles(STICKER);
  await expect(page.locator("[data-layer]")).toHaveCount(3);
  const sticker = await expect.poll(async () => (await savedPhoto(page, photoId)).layers.length).toBe(3).then(async () => (await savedPhoto(page, photoId)).layers[2]);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(2);

  await page.keyboard.press("c");
  await expect(page.locator('[data-crop-target="layer"]')).toBeVisible();
  await expect(page.locator("[data-tool-options=crop]")).toContainText(sticker.name);
  await expect(page.locator('[data-crop-overlay="layer"]')).toHaveAttribute("data-crop-box", "0,0,800,800");
  // The right edge pulled in to the sticker's middle.
  const t = sticker.transform;
  await drag(page, await handle(page, "1,0.5"), await onScreen(page, t.x + 20 * t.scaleX, t.y));
  const [cx, cy, cw, ch] = await cropBox(page);
  expect([cx, cy, ch]).toEqual([0, 0, 800]);
  expect(cw).toBeGreaterThan(400);
  expect(cw).toBeLessThan(470);
  await shot(page, "layer-pending");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[2].crop).toEqual({ x: 0, y: 0, width: cw, height: 800 });
  // Still cropping it: the box is its crop, the layer shown whole under the shield.
  await expect(page.locator('[data-crop-overlay="layer"]')).toHaveAttribute("data-crop-box", `0,0,${cw},800`);
  await shot(page, "layer-cropped-recrop");

  // What's outside the crop is hidden from everything that draws; what's inside shows.
  const s = t.scaleX;
  const right = { zoom: 1, x: Math.round(t.x + 200 * s), y: Math.round(t.y - 16), width: 32, height: 32 };
  const left = { ...right, x: Math.round(t.x - 300 * s) };
  expect(differs(await renderRegion(page, right), await renderRegion(page, right, [sticker.id]))).toBe(false);
  expect(differs(await renderRegion(page, left), await renderRegion(page, left, [sticker.id]))).toBe(true);

  // The Move tool's box is what shows of it.
  await page.keyboard.press("v");
  await expect(page.locator("[data-transform-overlay]")).toBeVisible();
  await shot(page, "layer-move");
  const br = (await page.locator('[data-handle="1,1"]').boundingBox())!;
  const edge = await onScreen(page, t.x + (cw - 400) * s, t.y + 400 * s);
  expect(Math.abs(br.x + br.width / 2 - edge.x)).toBeLessThan(2);
  expect(Math.abs(br.y + br.height / 2 - edge.y)).toBeLessThan(2);

  // Back to Crop: Escape with nothing pending deselects (the canvas again); Clear and Enter take the crop off.
  await page.keyboard.press("c");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-crop-target="canvas"]')).toBeVisible();
  await page.locator(`[data-layer="${sticker.id}"]`).click();
  await expect(page.locator('[data-crop-target="layer"]')).toBeVisible();
  // Canvas | Layer: the canvas chosen with the layer still selected.
  await page.locator('[data-crop-choice="canvas"]').click();
  await expect(page.locator('[data-crop-overlay="canvas"]')).toBeVisible();
  await page.locator('[data-crop-choice="layer"]').click();
  await expect(page.locator('[data-crop-overlay="layer"]')).toBeVisible();
  // A click where no layer shows (the pasteboard) deselects too.
  const canvas = (await page.getByLabel("Photo canvas").boundingBox())!;
  await page.mouse.click(canvas.x + 6, canvas.y + canvas.height / 2);
  await expect(page.locator('[data-crop-overlay="canvas"]')).toBeVisible();
  await page.locator(`[data-layer="${sticker.id}"]`).click();
  await expect(page.locator('[data-crop-overlay="layer"]')).toBeVisible();
  await page.locator("[data-crop-clear]").click();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[2].crop).toBeUndefined();

  // Leaving the tool with a crop pending applies it (with Undo offered).
  await drag(page, await handle(page, "0.5,1"), await onScreen(page, t.x, t.y));
  await page.keyboard.press("v");
  await expect(page.getByText("Leaving the Crop tool applied its crop.")).toBeVisible();
  await expect.poll(async () => (await savedPhoto(page, photoId)).layers[2].crop?.height).toBeLessThan(800);
});

test("the assistant crops the canvas and a layer, and reads a layer's crop", async ({ page }) => {
  const id = await openNewPhoto(page, "Assisted crop");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const layer = (await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(1).then(() => savedPhoto(page, id))).layers[0];
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill([`call crop_layer {"layer": "${layer.id}", "x": 0, "y": 0, "width": 800, "height": 1200}`, 'call crop_canvas {"ratio": "4:5"}', "call get_photo"].join("\n"));
  await composer.press("Enter");
  await expect(panel).toContainText("get_photo: ok", { timeout: 30_000 });
  const doc = await expect.poll(async () => (await savedPhoto(page, id)).canvas.width).toBe(960).then(() => savedPhoto(page, id));
  expect(doc.canvas).toMatchObject({ width: 960, height: 1200 });
  expect(doc.layers[0].crop).toEqual({ x: 0, y: 0, width: 800, height: 1200 });
  expect(doc.layers[0].transform).toMatchObject({ x: 800 - 320, y: 600 });
});
