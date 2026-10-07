/**
 * The photo suite's Content-Aware Fill (docs/photo/content-aware-fill.md). The server's models are stand-ins
 * (EDITOR_PHOTO_MODELS=stand-in): the fill is the mean of what's around the hole, so what's checked is the command
 * where the user meets it (the right-click menu, ⇧⌫, the assistant), the new layer it makes and its undo step.
 */
import os from "node:os";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import sharp from "sharp";

test.describe.configure({ mode: "serial" });

type Layer = { id: string; kind: string; name: string; surface?: string | null; size?: { width: number; height: number }; transform?: { x: number; y: number } };

type FillWindow = {
  photoDebug: {
    renderer(): Promise<{ readSurfaceTile(layerId: string, part: "content" | "mask", tx: number, ty: number): Promise<{ data: Float32Array | null }> }>;
    photo: { getState(): { select(s: unknown): void } };
    ui: { getState(): { view: { zoom: number; x: number; y: number } } };
  };
};

const savedPhoto = async (page: Page, id: string): Promise<{ layers: Layer[] }> => (await page.request.get(`/api/projects/${id}`)).json();
const layerCount = (page: Page, id: string) => async () => (await savedPhoto(page, id)).layers.length;

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
      void (window as unknown as { photoDebug: { photo: { getState(): { placeFiles(files: File[], options: { asCanvas: boolean }): Promise<unknown> } } } }).photoDebug.photo
        .getState()
        .placeFiles([...input.files!], { asCanvas: true });
      input.remove();
    };
    document.body.append(input);
  });
  await page.locator("[data-test-open-image]").setInputFiles(file);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
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
  const file = path.join(os.tmpdir(), `vaudio-caf-shapes-${process.pid}.png`);
  await sharp(data, { raw: { width, height, channels: 3 } }).png().toFile(file);
  return file;
}

const selectRect = (page: Page, x: number, y: number, width: number, height: number) =>
  page.evaluate((r) => (window as unknown as FillWindow).photoDebug.photo.getState().select({ kind: "rect", ...r }), { x, y, width, height });

/** A document point's place on the page. */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await page.getByLabel("Photo canvas").boundingBox())!;
  const { view, dpr } = await page.evaluate(() => ({ view: (window as unknown as FillWindow).photoDebug.ui.getState().view, dpr: devicePixelRatio }));
  return { x: box.x + ((x - view.x) * view.zoom) / dpr, y: box.y + ((y - view.y) * view.zoom) / dpr };
}

/** A layer's own texel (RGBA, premultiplied linear) at a document pixel. */
async function texelAt(page: Page, layer: Layer, x: number, y: number): Promise<number[] | null> {
  const left = layer.transform!.x - layer.size!.width / 2;
  const top = layer.transform!.y - layer.size!.height / 2;
  const lx = x - left;
  const ly = y - top;
  return page.evaluate(
    async ({ id, lx, ly }) => {
      const r = await (window as unknown as FillWindow).photoDebug.renderer();
      const t = await r.readSurfaceTile(id, "content", Math.floor(lx / 256), Math.floor(ly / 256));
      const i = ((ly % 256) * 256 + (lx % 256)) * 4;
      return t.data ? Array.from(t.data.slice(i, i + 4)) : null;
    },
    { id: layer.id, lx, ly },
  );
}

test("Content-Aware Fill fills the selection on a new layer from the right-click menu and ⇧⌫, in one undo step each", async ({ page }) => {
  const id = await openNewPhoto(page, "Remove");
  await openImage(page, await shapes());
  await expect.poll(layerCount(page, id)).toBe(1);

  // With no selection, ⇧⌫ says what to do and changes nothing.
  await page.getByLabel("Photo canvas").hover();
  await page.keyboard.press("Shift+Backspace");
  await expect(page.getByText("Select what to remove first")).toBeVisible();
  expect(await layerCount(page, id)()).toBe(1);
  await page.locator('[data-menu="edit"]').click();
  await expect(page.getByRole("menuitem", { name: /Content-Aware Fill/ })).toBeDisabled();
  await page.keyboard.press("Escape");

  // A box around the disc, then the canvas's right-click menu.
  await selectRect(page, 140, 140, 320, 320);
  const middle = await screenOf(page, 300, 300);
  await page.mouse.click(middle.x, middle.y, { button: "right" });
  const menu = page.locator('[data-selection-menu="selection"]');
  await expect(menu).toBeVisible();
  await menu.locator("[data-content-aware-fill]").click();
  await expect.poll(layerCount(page, id)).toBe(2);
  const layers = (await savedPhoto(page, id)).layers;
  const fill = layers[1];
  expect(fill.kind).toBe("pixel");
  expect(fill.name).toBe("Content-Aware Fill");
  // The selection's box grown by 4 pixels (an 800-pixel photo's), on its own layer above the photo.
  expect(fill.size).toEqual({ width: 328, height: 328 });
  expect(fill.transform).toMatchObject({ x: 300, y: 300 });
  expect(await page.locator("[data-layer]").count()).toBe(2);
  // The disc is gone under it: what's around it (the blue and some green), opaque.
  const centre = await expect.poll(() => texelAt(page, fill, 300, 300)).not.toBeNull().then(() => texelAt(page, fill, 300, 300));
  expect(centre![3]).toBeCloseTo(1, 2);
  expect(centre![0]).toBeLessThan(0.1);
  expect(centre![2]).toBeGreaterThan(0.2);

  // One undo step takes it back; redo brings it again.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(layerCount(page, id)).toBe(1);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(layerCount(page, id)).toBe(2);

  // The header's Edit menu has it too, there only with a selection.
  await page.locator('[data-menu="edit"]').click();
  await expect(page.getByRole("menuitem", { name: /Content-Aware Fill/ })).toBeEnabled();
  await page.keyboard.press("Escape");

  // ⇧⌫ does the same, with the selection kept: another layer, over the square this time.
  await selectRect(page, 490, 190, 220, 220);
  await page.getByLabel("Photo canvas").hover();
  await page.keyboard.press("Shift+Backspace");
  await expect.poll(layerCount(page, id)).toBe(3);
  expect((await savedPhoto(page, id)).layers[2].name).toBe("Content-Aware Fill");
});

test("the assistant fills the selection with content_aware_fill, and is told when there's none", async ({ page }) => {
  const id = await openNewPhoto(page, "Assisted removal");
  await openImage(page, await shapes());
  await expect.poll(layerCount(page, id)).toBe(1);
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(['call content_aware_fill {}', 'call select_rect {"x": 140, "y": 140, "width": 320, "height": 320}', "call content_aware_fill {}", "call get_photo"].join("\n"));
  await composer.press("Enter");
  await expect(panel).toContainText("get_photo: ok", { timeout: 30_000 });
  await expect(panel).toContainText("content_aware_fill: failed");
  await expect.poll(layerCount(page, id)).toBe(2);
  expect((await savedPhoto(page, id)).layers[1].name).toBe("Content-Aware Fill");
});
