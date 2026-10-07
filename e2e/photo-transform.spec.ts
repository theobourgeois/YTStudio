/**
 * The photo suite's flips and turns: Edit › Transform on the selected layers (⌘H, ⌥⌘H, the menu, Properties'
 * buttons), Image › Image Rotation on the whole canvas (masks in document pixels moved pixel for pixel), and the
 * assistant's. Its own photos, as `photo.spec.ts`'s; run alone with `pnpm test:e2e photo-transform`.
 */
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const SAMPLES = path.resolve(import.meta.dirname, "..", "samples");
const PHOTO = path.join(SAMPLES, "photo-1600x1200.jpg");

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
    paint(layerId: string, part: "content" | "mask", points: { x: number; y: number }[], options?: { radius?: number }): Promise<{ id: string } | null>;
  };
};

/** The open photo rendered by the app's renderer at `view` (zoom 1: level 0), as RGBA floats. */
async function renderRegion(page: Page, view: ViewBox): Promise<number[]> {
  return page.evaluate(async (view) => {
    const { photoDebug } = window as unknown as DebugWindow;
    const r = await photoDebug.renderer();
    const { texture } = await r.renderView(photoDebug.photo.getState().history.doc.doc, view);
    const data = await r.readFloat(texture, view.width, view.height);
    texture.destroy();
    return Array.from(data);
  }, view);
}

/** Samples along a line, every few pixels (as a pointer gives them). */
const line = (x0: number, y0: number, x1: number, y1: number, step = 3) => {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }));
};

test("the selected layer flips with ⌘H and ⌥⌘H, turns from Edit › Transform and Properties, each one undo step", async ({ page }) => {
  const id = await openNewPhoto(page, "Flipped");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const place = async () => (await savedPhoto(page, id)).layers[0]?.transform;
  await expect.poll(place).toEqual({ x: 800, y: 600, scaleX: 1, scaleY: 1, rotation: 0 });
  await page.locator("[data-layer]").first().click();

  await page.keyboard.press("ControlOrMeta+h");
  await expect.poll(place).toEqual({ x: 800, y: 600, scaleX: -1, scaleY: 1, rotation: 0 });
  await page.keyboard.press("ControlOrMeta+Alt+h");
  await expect.poll(place).toEqual({ x: 800, y: 600, scaleX: -1, scaleY: -1, rotation: 0 });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(place).toEqual({ x: 800, y: 600, scaleX: -1, scaleY: 1, rotation: 0 });

  // Edit › Transform: its items say their keys.
  await page.locator("[data-edit-menu]").click();
  await page.locator("[data-transform-menu]").click();
  await expect(page.locator('[data-orient-layers="flip-horizontal"]')).toContainText(/⌘H|Ctrl\+H/);
  await page.locator('[data-orient-layers="rotate-90-cw"]').click();
  await expect.poll(place).toEqual({ x: 800, y: 600, scaleX: -1, scaleY: 1, rotation: 90 });

  // Properties' buttons beside the angle.
  // A turned layer flipped: turned the other way, unmirrored (Mirror · R(θ) = R(−θ) · Mirror).
  await page.locator('[data-orient-button="flip-horizontal"]').click();
  await expect.poll(place).toEqual({ x: 800, y: 600, scaleX: 1, scaleY: 1, rotation: -90 });
  await page.locator('[data-orient-button="rotate-90-cw"]').click();
  await expect.poll(place).toEqual({ x: 800, y: 600, scaleX: 1, scaleY: 1, rotation: 0 });
});

test("Image › Image Rotation turns the whole canvas: the picture and a mask in document pixels move pixel for pixel, in one undo step", async ({ page }) => {
  const id = await openNewPhoto(page, "Turned");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  // An Exposure layer whose mask (document pixels) hides it along a stroke, across tile edges.
  await page.getByRole("button", { name: "New adjustment layer" }).click();
  await page.getByRole("menuitem", { name: /Exposure/ }).click();
  await page.getByRole("button", { name: /Add a mask/ }).click();
  const adjustment = await expect.poll(async () => (await savedPhoto(page, id)).layers[1]?.mask).toEqual({ surface: null }).then(async () => (await savedPhoto(page, id)).layers[1].id as string);
  await page.evaluate((layerId) => {
    const { photo } = (window as unknown as DebugWindow).photoDebug;
    photo.getState().commit((d) => ({ ...d, layers: d.layers.map((l) => (l.id === layerId ? { ...l, effect: { ...l.effect!, params: { ...l.effect!.params, exposure: 1 } } } : l)) }));
  }, adjustment);
  const stroke = await page.evaluate(({ layerId, points }) => (window as unknown as DebugWindow).photoDebug.paint(layerId, "mask", points, { radius: 60 }), { layerId: adjustment, points: line(300, 500, 1100, 500) });
  await expect.poll(async () => (await savedPhoto(page, id)).layers[1].mask.surface).toBe(stroke!.id);
  // Across the stroke's edge and a tile edge.
  const region = { zoom: 1, x: 600, y: 500, width: 40, height: 64 };
  const before = await renderRegion(page, region);

  await page.locator("[data-image-menu]").click();
  await page.locator("[data-image-rotation-menu]").click();
  await page.locator('[data-orient-canvas="rotate-90-cw"]').click();
  const turned = await expect.poll(async () => (await savedPhoto(page, id)).canvas.width).toBe(1200).then(() => savedPhoto(page, id));
  expect(turned.canvas).toMatchObject({ width: 1200, height: 1600 });
  expect(turned.layers[0].transform).toEqual({ x: 600, y: 800, scaleX: 1, scaleY: 1, rotation: 90 });
  expect(turned.layers[1].mask.surface).toMatch(/^[0-9a-f]{64}$/);
  expect(turned.layers[1].mask.surface).not.toBe(stroke!.id);

  // Old (x, y) is now at (1200 − 1 − y, x): the region turned, read back pixel for pixel.
  const after = await renderRegion(page, { zoom: 1, x: 1200 - region.y - region.height, y: region.x, width: region.height, height: region.width });
  let worst = 0;
  for (let b = 0; b < region.width; b++) {
    for (let a = 0; a < region.height; a++) {
      const was = (b + (region.height - 1 - a) * region.width) * 4;
      const now = (a + b * region.height) * 4;
      for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(after[now + c] - before[was + c]));
    }
  }
  // Turned a quarter at 100%, the picture is still read texel for texel: nothing is resampled.
  expect(worst).toBe(0);

  // One undo step puts it back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, id)).canvas.width).toBe(1600);
  expect((await savedPhoto(page, id)).layers[1].mask.surface).toBe(stroke!.id);
});

test("the assistant flips layers and turns the canvas", async ({ page }) => {
  const id = await openNewPhoto(page, "Assisted turn");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const layer = (await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(1).then(() => savedPhoto(page, id))).layers[0];
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill([`call flip_rotate_layers {"layers": ["${layer.id}"], "operation": "flip-vertical"}`, 'call flip_rotate_canvas {"operation": "rotate-90-ccw"}', "call get_photo"].join("\n"));
  await composer.press("Enter");
  await expect(panel).toContainText("get_photo: ok", { timeout: 30_000 });
  const doc = await expect.poll(async () => (await savedPhoto(page, id)).canvas.width).toBe(1200).then(() => savedPhoto(page, id));
  expect(doc.canvas).toMatchObject({ width: 1200, height: 1600 });
  // Flipped upside down, then the canvas turned anticlockwise.
  expect(doc.layers[0].transform).toEqual({ x: 600, y: 800, scaleX: 1, scaleY: -1, rotation: -90 });
});
