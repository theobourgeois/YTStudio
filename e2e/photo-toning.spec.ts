/**
 * Dodge, Burn and Sponge, and the Background Eraser (docs/photo/tools/toning.md, background-eraser.md): the GPU held to
 * the CPU references, strokes with the mouse (one undo step, Escape, Alt), the options and the keys, and the
 * assistant's tone_area and remove_colour. Its photos are its own; it runs alone (`pnpm test:e2e photo-toning`).
 */
import os from "node:os";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import sharp from "sharp";
import { type Rgba, type ToneEffect, tonePixel } from "../shared/photo/reference/toning.ts";

test.describe.configure({ mode: "serial" });

const SAMPLES = path.resolve(import.meta.dirname, "..", "samples");
const PHOTO = path.join(SAMPLES, "photo-1600x1200.jpg");

const savedPhoto = async (page: Page, id: string) => (await page.request.get(`/api/projects/${id}`)).json();

type Point = { x: number; y: number };
type Debug = {
  photoDebug: {
    renderer(): Promise<{
      beginEffectStroke(layerId: string, part: string, brush: unknown, effect: unknown, selection: unknown): boolean;
      strokeTo(points: Point[]): void;
      cancelStroke(): void;
      readSurfaceTile(layerId: string, part: "content" | "mask", tx: number, ty: number): Promise<{ shown: string | null; data: Float32Array | null }>;
    }>;
    photo: { getState(): { placeFiles(files: File[], options: { asCanvas: boolean }): Promise<unknown> } };
    ui: { getState(): { view: { zoom: number; x: number; y: number } } };
  };
};

async function openNewPhoto(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/projects", { data: { suite: "photo", name } });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/p/${id}`);
  await expect(page.locator('[data-suite="photo"]')).toBeVisible();
  return id;
}

/** Opens an image as the empty photo's canvas, as New's Open an image… does. */
async function openImage(page: Page, file: string) {
  await page.evaluate(() => {
    const input = Object.assign(document.createElement("input"), { type: "file", hidden: true });
    input.dataset.testOpenImage = "";
    input.onchange = () => {
      void (window as unknown as Debug).photoDebug.photo.getState().placeFiles([...input.files!], { asCanvas: true });
      input.remove();
    };
    document.body.append(input);
  });
  await page.locator("[data-test-open-image]").setInputFiles(file);
}

/** Document point (x, y) on the page, in CSS pixels. */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await page.getByLabel("Photo canvas").boundingBox())!;
  const { view, dpr } = await page.evaluate(() => ({ view: (window as unknown as Debug).photoDebug.ui.getState().view, dpr: devicePixelRatio }));
  return { x: box.x + ((x - view.x) * view.zoom) / dpr, y: box.y + ((y - view.y) * view.zoom) / dpr };
}

/** A layer's level-0 tile as the GPU holds it (RGBA floats, premultiplied linear). */
const tileOf = (page: Page, layerId: string, tx: number, ty: number) =>
  page.evaluate(
    async ({ layerId, tx, ty }) => {
      const r = await (window as unknown as Debug).photoDebug.renderer();
      const t = await r.readSurfaceTile(layerId, "content", tx, ty);
      return { shown: t.shown, data: t.data ? Array.from(t.data) : null };
    },
    { layerId, tx, ty },
  );

const pixelOf = (tile: number[], x: number, y: number): Rgba => tile.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 4) as Rgba;

/** A drag through document points, with the mouse. */
async function drag(page: Page, points: Point[], options: { alt?: boolean; release?: boolean } = {}) {
  const first = await screenOf(page, points[0].x, points[0].y);
  if (options.alt) await page.keyboard.down("Alt");
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const s = await screenOf(page, p.x, p.y);
    await page.mouse.move(s.x, s.y, { steps: 6 });
  }
  if (options.release !== false) await page.mouse.up();
  if (options.alt) await page.keyboard.up("Alt");
}

/** Clicks the canvas with the active tool on an image layer and converts it to pixels when asked. */
async function convertWithTool(page: Page, id: string, at: Point) {
  const s = await screenOf(page, at.x, at.y);
  await page.mouse.click(s.x, s.y);
  const ask = page.locator("[data-convert-choice]");
  await expect(ask).toBeVisible();
  await expect(ask).toContainText("Convert");
  await ask.getByRole("button", { name: "Convert to pixels" }).click();
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0].kind).toBe("pixel");
}

const luminance = (p: Rgba) => (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / Math.max(p[3], 1e-6);

let tonedId = "";
let layerId = "";

test("Dodge, Burn and Sponge on the GPU are their CPU reference", async ({ page }) => {
  tonedId = await openNewPhoto(page, "Toning");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  layerId = (await expect.poll(async () => (await savedPhoto(page, tonedId)).layers.length).toBe(1).then(() => savedPhoto(page, tonedId))).layers[0].id;
  await page.locator(`[data-layer="${layerId}"]`).click();

  // O is the toning group: Dodge first; a press on a placed image asks to convert it (never silently).
  await page.keyboard.press("o");
  await expect(page.locator("[data-tool]")).toHaveAttribute("data-tool", "dodge");
  await expect(page.locator('[data-tool-options="dodge"]')).toBeVisible();
  await convertWithTool(page, tonedId, { x: 800, y: 600 });

  const base = await expect.poll(async () => (await tileOf(page, layerId, 1, 1)).data !== null).toBe(true).then(() => tileOf(page, layerId, 1, 1));
  const effects: ToneEffect[] = [
    { tool: "dodge", range: "shadows", protect: true },
    { tool: "dodge", range: "midtones", protect: true },
    { tool: "dodge", range: "highlights", protect: true },
    { tool: "dodge", range: "highlights", protect: false },
    { tool: "burn", range: "shadows", protect: true },
    { tool: "burn", range: "shadows", protect: false },
    { tool: "burn", range: "midtones", protect: false },
    { tool: "burn", range: "highlights", protect: true },
    { tool: "sponge", mode: "desaturate", vibrance: true },
    { tool: "sponge", mode: "saturate", vibrance: true },
    { tool: "sponge", mode: "saturate", vibrance: false },
  ];
  for (const effect of effects) {
    // One hard dab covering the whole tile: its accumulation is 1, so every pixel is tone(base, cap).
    const toned = await page.evaluate(
      async ({ layerId, effect }) => {
        const r = await (window as unknown as Debug).photoDebug.renderer();
        if (!r.beginEffectStroke(layerId, "content", { radius: 400, hardness: 1, strength: 1, spacing: 0.1 }, { kind: "tone", effect, cap: 0.7, mask: false }, null)) throw new Error("not on the GPU");
        r.strokeTo([{ x: 384, y: 384 }]);
        const t = await r.readSurfaceTile(layerId, "content", 1, 1);
        r.cancelStroke();
        return Array.from(t.data!);
      },
      { layerId, effect },
    );
    let worst = 0;
    for (let y = 3; y < 256; y += 23) {
      for (let x = 5; x < 256; x += 19) {
        const want = tonePixel(effect, pixelOf(base.data!, x, y), 0.7);
        const got = pixelOf(toned, x, y);
        for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(got[c] - want[c]) / Math.max(1, Math.abs(want[c])));
      }
    }
    expect(worst, JSON.stringify(effect)).toBeLessThan(3e-3);
  }
  // Nothing was kept of those strokes.
  expect((await tileOf(page, layerId, 1, 1)).data).toEqual(base.data);
});

test("a stroke with the mouse: one undo step, capped at its Exposure, Escape drops it, Alt burns", async ({ page }) => {
  await page.goto(`/p/${tonedId}`);
  await expect(page.locator(`[data-layer="${layerId}"]`)).toBeVisible();
  await page.locator(`[data-layer="${layerId}"]`).click();
  await page.keyboard.press("o");
  await expect(page.locator("[data-tool]")).toHaveAttribute("data-tool", "dodge");
  const before = await expect.poll(async () => (await tileOf(page, layerId, 1, 1)).data !== null).toBe(true).then(() => tileOf(page, layerId, 1, 1));
  const surface = (await savedPhoto(page, tonedId)).layers[0].surface;

  // The brush's circle follows the pointer; [ and ] change Dodge's own size.
  const centre = await screenOf(page, 384, 384);
  await page.mouse.move(centre.x, centre.y);
  await expect(page.locator('[data-brush-tool="dodge"]')).toBeVisible();
  const size = page.locator('[data-tool-options="dodge"] [data-option="Size"]');
  await expect(size).toContainText("100");
  await page.keyboard.press("]");
  await expect(size).toContainText("125");
  await page.keyboard.press("[");
  await expect(size).toContainText("100");

  // Escape mid-stroke: nothing changes.
  await drag(page, [{ x: 300, y: 384 }, { x: 460, y: 384 }], { release: false });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await tileOf(page, layerId, 1, 1)).data).toEqual(before.data);

  // A stroke scrubbed back and forth lightens, but no more than one pass at its Exposure would.
  await drag(page, [{ x: 300, y: 384 }, { x: 460, y: 384 }, { x: 300, y: 384 }, { x: 460, y: 384 }]);
  await expect.poll(async () => (await savedPhoto(page, tonedId)).layers[0].surface).not.toBe(surface);
  const dodged = (await tileOf(page, layerId, 1, 1)).data!;
  const at = (tile: number[]) => pixelOf(tile, 384 - 256, 384 - 256);
  expect(luminance(at(dodged))).toBeGreaterThan(luminance(at(before.data!)) + 1e-4);
  const ceiling = tonePixel({ tool: "dodge", range: "midtones", protect: true }, at(before.data!), 0.5);
  for (let c = 0; c < 3; c++) expect(at(dodged)[c]).toBeLessThanOrEqual(ceiling[c] * 1.003 + 1e-4);

  // One undo step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, tonedId)).layers[0].surface).toBe(surface);

  // Alt held: Burn.
  await drag(page, [{ x: 300, y: 384 }, { x: 460, y: 384 }], { alt: true });
  await expect.poll(async () => (await savedPhoto(page, tonedId)).layers[0].surface).not.toBe(surface);
  expect(luminance(at((await tileOf(page, layerId, 1, 1)).data!))).toBeLessThan(luminance(at(before.data!)));

  // ⇧O steps through the group: Burn, then Sponge, each with its options.
  await page.keyboard.press("Shift+o");
  await expect(page.locator("[data-tool]")).toHaveAttribute("data-tool", "burn");
  await page.keyboard.press("Shift+o");
  await expect(page.locator("[data-tool]")).toHaveAttribute("data-tool", "sponge");
  await expect(page.locator('[data-tool-options="sponge"] [data-option="Mode"]')).toContainText("Desaturate");
  await page.screenshot({ path: test.info().outputPath("sponge.png") });
});

/** A white picture with a red disc, its edge anti-aliased (centre 300, 200; radius 120). */
async function discPicture(): Promise<string> {
  const file = path.join(os.tmpdir(), `vaudio-disc-${process.pid}.png`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#ffffff"/><circle cx="300" cy="200" r="120" fill="#ff0000"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

test("the Background Eraser erases the white around a disc and takes it out of the edge", async ({ page }) => {
  const id = await openNewPhoto(page, "Disc");
  await openImage(page, await discPicture());
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const layer = (await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(1).then(() => savedPhoto(page, id))).layers[0].id;
  await page.locator(`[data-layer="${layer}"]`).click();

  // E is the Erasers' group; ⇧E steps to the Background Eraser.
  await page.keyboard.press("e");
  await page.keyboard.press("Shift+e");
  await expect(page.locator("[data-tool]")).toHaveAttribute("data-tool", "backgroundEraser");
  await expect(page.locator('[data-tool-options="backgroundEraser"] [data-option="Limits"]')).toContainText("Contiguous");
  await convertWithTool(page, id, { x: 40, y: 40 });
  const surface = await expect.poll(async () => (await savedPhoto(page, id)).layers[0].surface).not.toBeNull().then(async () => (await savedPhoto(page, id)).layers[0].surface);
  // The click itself erased nothing (the convert question took it).
  const t0 = await expect.poll(async () => (await tileOf(page, layer, 1, 0)).data !== null).toBe(true).then(() => tileOf(page, layer, 1, 0));
  expect(pixelOf(t0.data!, 300 - 256, 40)[3]).toBeCloseTo(1, 3);

  const cursor = await screenOf(page, 300, 40);
  await page.mouse.move(cursor.x, cursor.y);
  await expect(page.locator('[data-brush-tool="backgroundEraser"] path')).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath("background-eraser.png") });

  // Along the disc's top left, outside it: the white goes, the red stays, the soft edge keeps the disc's red without
  // the white.
  await drag(page, [{ x: 124, y: 164 }, { x: 264, y: 24 }]);
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0].surface).not.toBe(surface);
  const tile = (await tileOf(page, layer, 0, 0)).data!;
  const px = (x: number, y: number) => pixelOf(tile, x, y);
  expect(px(194, 94)[3]).toBeLessThan(0.01);
  expect(px(230, 130)[3]).toBeCloseTo(1, 3);
  expect(px(230, 130)[1]).toBeLessThan(0.01);
  const edges: Rgba[] = [];
  for (let y = 100; y < 130; y++) for (let x = 200; x < 230; x++) if (px(x, y)[3] > 0.05 && px(x, y)[3] < 0.95) edges.push(px(x, y));
  expect(edges.length, "soft edge pixels along the disc").toBeGreaterThan(2);
  // Straight colour: red, not pink (the white was taken out with it).
  for (const edge of edges) {
    expect(edge[0] / edge[3]).toBeGreaterThan(0.8);
    expect(edge[1] / edge[3]).toBeLessThan(0.15);
  }
  await page.screenshot({ path: test.info().outputPath("background-erased.png") });

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0].surface).toBe(surface);
});

test("the assistant dodges, burns and removes a background colour", async ({ page }) => {
  const id = await openNewPhoto(page, "Assistant tones");
  await openImage(page, await discPicture());
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const placed = (await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(1).then(() => savedPhoto(page, id))).layers[0].id;
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      `call tone_area {"layer": "${placed}", "tool": "burn"}`,
      `call remove_colour {"layer": "${placed}", "point": [10, 10], "tolerance": 30, "convert": true}`,
      `call tone_area {"layer": "${placed}", "tool": "burn", "range": "highlights", "exposure": 60, "box": {"x": 250, "y": 150, "width": 100, "height": 100}}`,
      "call get_photo",
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("get_photo: ok", { timeout: 30_000 });
  const chat = JSON.stringify(await (await page.request.get(`/api/assistant/chats/${id}`)).json());
  // The first refused (a placed image, kept whole), saying what to do; the others ran.
  expect(chat).toContain("tone_area: failed, remove_colour: ok, tone_area: ok");
  expect(chat).toContain("pass convert: true to make it pixels first");
  const doc = await expect.poll(async () => (await savedPhoto(page, id)).layers[0].kind).toBe("pixel").then(() => savedPhoto(page, id));
  const layer = doc.layers[0].id;
  const tile = await expect.poll(async () => (await tileOf(page, layer, 1, 0)).data !== null).toBe(true).then(async () => (await tileOf(page, layer, 1, 0)).data!);
  // The white is gone (joined to the corner), the disc burnt where the box was.
  expect(pixelOf(tile, 300 - 256, 40)[3]).toBeLessThan(0.01);
  const burnt = pixelOf(tile, 300 - 256, 200);
  expect(burnt[3]).toBeCloseTo(1, 3);
  expect(burnt[0]).toBeLessThan(0.95);
  expect(burnt[0]).toBeGreaterThan(0.2);
});
