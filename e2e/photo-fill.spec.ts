/**
 * The photo suite's Paint Bucket and Magic Eraser (docs/photo/tools/paint-bucket.md, magic-eraser.md). Its tests
 * make their own photos, so the file stands on its own; they run in order and share a server. What's checked is the
 * document saved, the surfaces' own pixels (as the GPU holds them), and the canvas.
 */
import os from "node:os";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import sharp from "sharp";
import { srgbToLinear } from "../shared/photo/colour.ts";

test.describe.configure({ mode: "serial" });

const savedPhoto = async (page: Page, id: string) => (await page.request.get(`/api/projects/${id}`)).json();

/** The saved photo once it has `count` layers (saving follows an edit by a moment). */
const savedWith = (page: Page, id: string, count: number) => expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(count).then(() => savedPhoto(page, id));

type Layer = { id: string; kind: string; name: string; surface?: string | null; mask?: { surface: string | null } };

type FillWindow = {
  photoDebug: {
    renderer(): Promise<{ readSurfaceTile(layerId: string, part: "content" | "mask", tx: number, ty: number): Promise<{ shown: string | null; data: Float32Array | null }> }>;
    photo: { getState(): { select(s: unknown): void } };
    ui: { getState(): { view: { zoom: number; x: number; y: number }; target: string } };
  };
};

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

/** A document point's place on the page. */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await page.getByLabel("Photo canvas").boundingBox())!;
  const { view, dpr } = await page.evaluate(() => ({ view: (window as unknown as FillWindow).photoDebug.ui.getState().view, dpr: devicePixelRatio }));
  return { x: box.x + ((x - view.x) * view.zoom) / dpr, y: box.y + ((y - view.y) * view.zoom) / dpr };
}

const clickAt = async (page: Page, x: number, y: number) => {
  const p = await screenOf(page, x, y);
  await page.mouse.click(p.x, p.y);
};

/** A surface's texels as the GPU holds them (RGBA; a mask's value in every channel), by document-aligned pixel. */
const texels = (page: Page, layerId: string, part: "content" | "mask", at: [number, number][]) =>
  page.evaluate(
    async ({ layerId, part, at }) => {
      const r = await (window as unknown as FillWindow).photoDebug.renderer();
      const out: (number[] | null)[] = [];
      for (const [x, y] of at) {
        const t = await r.readSurfaceTile(layerId, part, Math.floor(x / 256), Math.floor(y / 256));
        const i = ((y % 256) * 256 + (x % 256)) * 4;
        out.push(t.data ? Array.from(t.data.slice(i, i + 4)) : null);
      }
      return out;
    },
    { layerId, part, at },
  );

/**
 * A subject on white, as people's pictures are: an 800 × 800 white square with a red disc (centre 400, 400; radius
 * 249.5: pixel 150 of the middle row is half on it) whose edge is anti-aliased, mixed in encoded values as image
 * editors do.
 */
async function stickerOnWhite(): Promise<string> {
  const size = 800;
  const data = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let inside = 0;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) inside += Math.hypot(x + (i + 0.5) / 4 - 400, y + (j + 0.5) / 4 - 400) < 249.5 ? 1 : 0;
      const k = inside / 16;
      data.set([255, Math.round(255 * (1 - k)), Math.round(255 * (1 - k))], (y * size + x) * 3);
    }
  const file = path.join(os.tmpdir(), `vaudio-sticker-on-white-${process.pid}.png`);
  await sharp(data, { raw: { width: size, height: size, channels: 3 } }).png().toFile(file);
  return file;
}

/** 800 × 600 of blue with an orange disc (centre 300, 300; radius 150) and a green square (x 500..700, y 200..400). */
async function shapes(): Promise<string> {
  const width = 800;
  const height = 600;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const disc = Math.hypot(x + 0.5 - 300, y + 0.5 - 300) < 150;
      const square = x >= 500 && x < 700 && y >= 200 && y < 400;
      data.set(disc ? [235, 140, 40] : square ? [40, 190, 80] : [40, 70, 200], (y * width + x) * 3);
    }
  const file = path.join(os.tmpdir(), `vaudio-fill-shapes-${process.pid}.png`);
  await sharp(data, { raw: { width, height, channels: 3 } }).png().toFile(file);
  return file;
}

const lin = (v: number) => srgbToLinear(v / 255);

/** G gives the Gradient's group (the Gradient, at first); Shift+G steps to the Paint Bucket. */
async function pickBucket(page: Page) {
  await page.keyboard.press("g");
  await page.keyboard.press("Shift+g");
  await expect(page.locator('[data-tool-options="paint-bucket"]')).toBeVisible();
}

test("the Paint Bucket fills the shape clicked on a new layer (All Layers), in one undo step; the selection limits it; a mode and a pattern", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("photo-colours", JSON.stringify({ foreground: "#ff0000", background: "#ffffff" })));
  const id = await openNewPhoto(page, "Bucket");
  await openImage(page, await shapes());
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);

  // G is the Gradient's group; Shift+G steps to the Paint Bucket. Its options are Photoshop's.
  await pickBucket(page);
  const options = page.locator('[data-tool-options="paint-bucket"]');
  await expect(options).toBeVisible();
  for (const name of ["Fill", "Mode", "Opacity", "Tolerance", "Anti-alias", "Contiguous", "All Layers"]) await expect(options.locator(`[data-option="${name}"]`)).toBeVisible();
  await expect(page.locator('[data-flood-cursor="paint-bucket"]')).toHaveCount(0);

  // On the placed image it asks first, as the brush does: never rasterised silently.
  const image = (await savedWith(page, id, 1)).layers[0].id as string;
  await page.locator(`[data-layer="${image}"]`).click();
  const disc = await screenOf(page, 300, 300);
  await page.mouse.move(disc.x, disc.y);
  await expect(page.locator('[data-flood-cursor="paint-bucket"]')).toBeVisible();
  await page.mouse.click(disc.x, disc.y);
  const choice = page.locator("[data-paint-choice]");
  await expect(choice).toBeVisible();
  await choice.getByRole("button", { name: "New paint layer" }).click();
  const layer = (await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(2).then(() => savedPhoto(page, id))).layers[1] as Layer;
  expect(layer).toMatchObject({ kind: "pixel", surface: null });

  // All Layers: the disc as it shows, filled on the new layer. One click, one undo step.
  await options.locator('[data-option="All Layers"]').click();
  await clickAt(page, 300, 300);
  const filled = await expect.poll(async () => ((await savedPhoto(page, id)).layers[1] as Layer).surface ?? null).not.toBeNull().then(async () => ((await savedPhoto(page, id)).layers[1] as Layer).surface);
  const [inside, outside, square] = await texels(page, layer.id, "content", [[300, 300], [100, 100], [600, 300]]);
  expect(inside).toEqual([1, 0, 0, 1]);
  expect(outside?.[3] ?? 0).toBe(0);
  expect(square?.[3] ?? 0).toBe(0);
  // The disc's edge is hard in the picture, and so is the fill: its last pixel filled, the next not.
  const [last, next] = await texels(page, layer.id, "content", [[150, 300], [149, 300]]);
  expect(last).toEqual([1, 0, 0, 1]);
  expect(next?.[3] ?? 0).toBe(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => ((await savedPhoto(page, id)).layers[1] as Layer).surface ?? null).toBeNull();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => ((await savedPhoto(page, id)).layers[1] as Layer).surface).toBe(filled);

  // The selection limits it: the background, but only the left half.
  await page.evaluate(() => (window as unknown as FillWindow).photoDebug.photo.getState().select({ kind: "rect", x: 0, y: 0, width: 400, height: 600 }));
  await clickAt(page, 50, 550);
  await expect.poll(async () => ((await savedPhoto(page, id)).layers[1] as Layer).surface).not.toBe(filled);
  const [left, right] = await texels(page, layer.id, "content", [[50, 50], [750, 50]]);
  expect(left).toEqual([1, 0, 0, 1]);
  expect(right?.[3] ?? 0).toBe(0);
  await page.keyboard.press("ControlOrMeta+d");

  // Multiply, grey on the layer's own red (All Layers off: the red it has there), in encoded values as Photoshop.
  await page.evaluate(() => {
    localStorage.setItem("photo-colours", JSON.stringify({ foreground: "#808080", background: "#ffffff" }));
    localStorage.setItem("photo-bucket", JSON.stringify({ mode: "multiply", allLayers: false }));
  });
  await page.reload();
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await pickBucket(page);
  await page.locator(`[data-layer="${layer.id}"]`).click();
  await expect(page.locator('[data-tool-options="paint-bucket"] [data-option="Mode"]')).toContainText("Multiply");
  const before = ((await savedPhoto(page, id)).layers[1] as Layer).surface;
  await clickAt(page, 50, 50);
  await expect.poll(async () => ((await savedPhoto(page, id)).layers[1] as Layer).surface).not.toBe(before);
  const [multiplied, untouched] = await texels(page, layer.id, "content", [[50, 50], [600, 300]]);
  expect(multiplied![0]).toBeCloseTo(lin(128), 2);
  expect(multiplied![1]).toBe(0);
  expect(multiplied![3]).toBe(1);
  expect(untouched?.[3] ?? 0).toBe(0);

  // A pattern: Normal, the built-in Checkerboard on the square's transparency (contiguous with the rest, so a
  // selection keeps it to the square).
  await page.evaluate(() => localStorage.setItem("photo-bucket", JSON.stringify({ mode: "normal", source: "pattern", pattern: "builtin:checkerboard", allLayers: false })));
  await page.reload();
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await pickBucket(page);
  await page.locator(`[data-layer="${layer.id}"]`).click();
  await expect(page.locator('[data-tool-options="paint-bucket"] [data-pattern-picker]')).toBeVisible();
  await page.evaluate(() => (window as unknown as FillWindow).photoDebug.photo.getState().select({ kind: "rect", x: 500, y: 200, width: 200, height: 200 }));
  await clickAt(page, 600, 300);
  await expect.poll(async () => (await texels(page, layer.id, "content", [[600, 300]]))[0]?.[3] ?? 0).toBe(1);
  // The checkerboard's 8-pixel cells from the canvas's corner: (600, 296) and (608, 296) differ.
  const [a, b] = await texels(page, layer.id, "content", [[600, 296], [608, 296]]);
  expect(Math.abs(a![0] - b![0])).toBeGreaterThan(0.1);
  expect(a![0]).toBeCloseTo(a![1], 4);
});

test("the Magic Eraser takes a white background off a placed image through its mask, never rasterising it; on pixels it defringes the edge", async ({ page }) => {
  const id = await openNewPhoto(page, "Sticker");
  await openImage(page, await stickerOnWhite());
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const image = (await savedWith(page, id, 1)).layers[0].id as string;
  await page.locator(`[data-layer="${image}"]`).click();

  // E is the Erasers' group: Shift+E steps through the Background Eraser to the Magic Eraser.
  await page.keyboard.press("e");
  await page.keyboard.press("Shift+e");
  await page.keyboard.press("Shift+e");
  const options = page.locator('[data-tool-options="magic-eraser"]');
  await expect(options).toBeVisible();
  for (const name of ["Tolerance", "Anti-alias", "Contiguous", "All Layers", "Opacity", "Defringe"]) await expect(options.locator(`[data-option="${name}"]`)).toBeVisible();

  // One click in a corner: the image keeps whole, its new mask hides the white. One undo step.
  await clickAt(page, 10, 10);
  const erased = await expect.poll(async () => ((await savedPhoto(page, id)).layers[0] as Layer).mask?.surface ?? null).not.toBeNull().then(async () => (await savedPhoto(page, id)).layers[0] as Layer);
  expect(erased.kind).toBe("image");
  const [corner, centre, otherCorner, edge] = await texels(page, image, "mask", [[10, 10], [400, 400], [790, 790], [150, 400]]);
  expect(corner![0]).toBe(0);
  expect(otherCorner![0]).toBe(0);
  expect(centre?.[0] ?? 1).toBe(1);
  // The edge pixel, half white: Defringe hides the white half of it.
  expect(edge![0]).toBeGreaterThan(0.35);
  expect(edge![0]).toBeLessThan(0.65);
  // The mask is targeted, so the brush refines it.
  expect(await page.evaluate(() => (window as unknown as FillWindow).photoDebug.ui.getState().target)).toBe("mask");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => ((await savedPhoto(page, id)).layers[0] as Layer).mask).toBeUndefined();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => ((await savedPhoto(page, id)).layers[0] as Layer).mask?.surface ?? null).toBe(erased.mask!.surface);

  // On pixels: the image converted, then erased. The edge is unmixed from white: red, half transparent, no pink.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => ((await savedPhoto(page, id)).layers[0] as Layer).mask).toBeUndefined();
  await page.locator(`[data-layer="${image}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Convert to Pixels" }).click();
  const pixels = (await expect.poll(async () => (await savedPhoto(page, id)).layers[0].kind).toBe("pixel").then(() => savedPhoto(page, id))).layers[0] as Layer;
  const converted = pixels.surface;
  await page.locator(`[data-layer="${pixels.id}"]`).click();
  await clickAt(page, 10, 10);
  await expect.poll(async () => ((await savedPhoto(page, id)).layers[0] as Layer).surface).not.toBe(converted);
  const [gone, kept, rim] = await texels(page, pixels.id, "content", [[10, 10], [400, 400], [150, 400]]);
  expect(gone?.[3] ?? 0).toBe(0);
  expect(kept).toEqual([1, 0, 0, 1]);
  expect(rim![3]).toBeGreaterThan(0.35);
  expect(rim![3]).toBeLessThan(0.65);
  expect(rim![0] / rim![3]).toBeGreaterThan(0.97);
  expect(rim![1] / rim![3]).toBeLessThan(0.02);

  // Defringe off (Photoshop's own): the rim keeps its white half, pink.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => ((await savedPhoto(page, id)).layers[0] as Layer).surface).toBe(converted);
  await options.locator('[data-option="Defringe"]').click();
  await clickAt(page, 10, 10);
  await expect.poll(async () => ((await savedPhoto(page, id)).layers[0] as Layer).surface).not.toBe(converted);
  const [pink] = await texels(page, pixels.id, "content", [[150, 400]]);
  expect(pink![3]).toBe(1);
  expect(pink![1]).toBeGreaterThan(lin(100));
  await options.locator('[data-option="Defringe"]').click();
});

test("the assistant fills with bucket_fill and erases with magic_erase", async ({ page }) => {
  const id = await openNewPhoto(page, "Assisted");
  await openImage(page, await stickerOnWhite());
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const image = (await savedWith(page, id, 1)).layers[0] as Layer;
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      `call magic_erase {"x": 5, "y": 5, "layer": "${image.id}"}`,
      'call add_pixel_layer {"name": "Paint"}',
      'call bucket_fill {"x": 400, "y": 400, "layer": "Paint", "with": "#00ff00", "all_layers": true}',
      'call bucket_fill {"x": 400, "y": 400, "layer": "Paint", "with": "#0000ff", "opacity": 0.5, "mode": "normal"}',
      `call bucket_fill {"x": 400, "y": 400, "layer": "${image.id}"}`,
      "call get_photo",
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("get_photo: ok", { timeout: 30_000 });
  await expect(panel).toContainText("bucket_fill: failed");
  const done = (d: { layers: Layer[] }) => !!d.layers[0].mask?.surface && !!d.layers.find((l) => l.name === "Paint")?.surface;
  const doc = await expect.poll(async () => done(await savedPhoto(page, id))).toBe(true).then(() => savedPhoto(page, id));
  const paint = doc.layers.find((l: Layer) => l.name === "Paint") as Layer;
  expect(doc.layers[0].kind).toBe("image");
  expect(doc.layers[0].mask.surface).not.toBeNull();
  const [disc, outside] = await texels(page, paint.id, "content", [[400, 400], [5, 5]]);
  // Green, then half blue over it.
  expect(disc![3]).toBe(1);
  expect(disc![1]).toBeGreaterThan(0.1);
  expect(disc![2]).toBeGreaterThan(0.1);
  expect(outside?.[3] ?? 0).toBe(0);
  const [hidden] = await texels(page, image.id, "mask", [[5, 5]]);
  expect(hidden![0]).toBe(0);
});
