/**
 * The photo suite. Its tests make their own photos (through the API or the New tile), so they stand on their own;
 * like the other suites' they run in order and share a server. The canvas is drawn with WebGPU (the config turns
 * the GPU on); what's checked is the document saved, the files exported, and the canvas's own pixels.
 */
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import sharp from "sharp";

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
  await top.locator("span").dblclick();
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
      'call update_layer {"layer": "nope"}',
      'call view_photo {"width": 320}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("update_layer: failed, view_photo: ok", { timeout: 30_000 });
  const doc = await expect.poll(async () => (await savedPhoto(page, id)).canvas.width).toBe(1280).then(() => savedPhoto(page, id));
  expect(doc.canvas).toEqual({ width: 1280, height: 720, background: "#000000" });
  expect(doc.layers[0].transform).toMatchObject({ x: 640, y: 360, scaleX: 0.8, scaleY: 0.8 });
});
