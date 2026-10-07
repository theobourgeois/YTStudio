/**
 * The photo suite's Eyedropper (docs/photo/tools/eyedropper.md), and the colour pickers sampling the canvas as
 * Photoshop's Color Picker does. Its tests make their own photos, so the file stands on its own; they run in order and
 * share a server. What's checked is the colours kept (the tool strip's, in this browser) and the pickers' own fields.
 */
import os from "node:os";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import sharp from "sharp";

test.describe.configure({ mode: "serial" });

type EyedropperWindow = { photoDebug: { ui: { getState(): { view: { zoom: number; x: number; y: number } } } } };

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
  const { view, dpr } = await page.evaluate(() => ({ view: (window as unknown as EyedropperWindow).photoDebug.ui.getState().view, dpr: devicePixelRatio }));
  return { x: box.x + ((x - view.x) * view.zoom) / dpr, y: box.y + ((y - view.y) * view.zoom) / dpr };
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
  const file = path.join(os.tmpdir(), `vaudio-eyedropper-shapes-${process.pid}.png`);
  await sharp(data, { raw: { width, height, channels: 3 } }).png().toFile(file);
  return file;
}

const ORANGE = "#eb8c28";
const GREEN = "#28be50";
const BLUE = "#2846c8";

const colours = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("photo-colours") ?? "{}") as { foreground?: string; background?: string });

test("the Eyedropper (I) picks the foreground, Alt the background; a drag shows the ring and Escape puts it back; Alt with the Brush picks too", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("photo-colours", JSON.stringify({ foreground: "#000000", background: "#ffffff" }));
    localStorage.removeItem("photo-eyedropper");
  });
  await openNewPhoto(page, "Eyedropper");
  await openImage(page, await shapes());
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);

  await page.keyboard.press("i");
  const options = page.locator('[data-tool-options="eyedropper"]');
  await expect(options).toBeVisible();
  for (const name of ["Sample Size", "Sample", "Show Sampling Ring"]) await expect(options.locator(`[data-option="${name}"]`)).toBeVisible();
  await expect(page.locator('[data-tool-button="eyedropper"]')).toHaveAttribute("aria-pressed", "true");

  // A click: the foreground. Alt + a click: the background.
  const disc = await screenOf(page, 300, 300);
  await page.mouse.click(disc.x, disc.y);
  await expect.poll(async () => (await colours(page)).foreground).toBe(ORANGE);
  const sky = await screenOf(page, 50, 50);
  await page.keyboard.down("Alt");
  await page.mouse.click(sky.x, sky.y);
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await colours(page)).background).toBe(BLUE);
  await expect(page.getByRole("button", { name: "Foreground colour" })).toHaveCSS("background-color", "rgb(235, 140, 40)");

  // A drag follows the pointer with the ring: the new colour over the one it replaces. Escape puts it back.
  const square = await screenOf(page, 600, 300);
  await page.mouse.move(disc.x, disc.y);
  await page.mouse.down();
  const ring = page.locator("[data-sampling-ring]");
  await expect(ring).toHaveAttribute("data-before", ORANGE);
  await page.mouse.move(square.x, square.y, { steps: 4 });
  await expect(ring).toHaveAttribute("data-now", GREEN);
  await expect.poll(async () => (await colours(page)).foreground).toBe(GREEN);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(ring).toHaveCount(0);
  await expect.poll(async () => (await colours(page)).foreground).toBe(ORANGE);

  // Off the canvas there's nothing to pick: the colour stays.
  const off = await screenOf(page, -8, 300);
  await page.mouse.click(off.x, off.y);
  await page.waitForTimeout(200);
  expect((await colours(page)).foreground).toBe(ORANGE);

  // The Brush with Alt is the Eyedropper for the moment, as Photoshop's: nothing is painted.
  await page.keyboard.press("b");
  await page.keyboard.down("Alt");
  await page.mouse.click(square.x, square.y);
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await colours(page)).foreground).toBe(GREEN);
  await expect(page.locator("[data-paint-choice]")).toHaveCount(0);
});

test("an open colour picker samples the canvas as Photoshop's does, whatever the tool, and stays open", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("photo-colours", JSON.stringify({ foreground: "#000000", background: "#ffffff" })));
  await openNewPhoto(page, "Picker");
  await openImage(page, await shapes());
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await page.keyboard.press("v");

  // The foreground's picker: the canvas under the pointer is its eyedropper, and says so.
  await page.getByRole("button", { name: "Foreground colour" }).click();
  const hex = page.getByRole("textbox", { name: "Hex" });
  await expect(hex).toHaveValue("#000000");
  await expect(page.locator("[data-color-sampler-hint]")).toBeVisible();
  const canvas = page.locator("[data-photo-canvas] [data-tool]");
  expect(await canvas.evaluate((el) => (el as HTMLElement).style.cursor)).toContain("data:image/svg+xml");

  // A click on the photo picks the colour there into it: the picker stays open, and the Move tool moves nothing.
  const square = await screenOf(page, 600, 300);
  await page.mouse.click(square.x, square.y);
  await expect(hex).toHaveValue(GREEN.toUpperCase());
  await expect.poll(async () => (await colours(page)).foreground).toBe(GREEN);
  const disc = await screenOf(page, 300, 300);
  await page.mouse.click(disc.x, disc.y);
  await expect(hex).toHaveValue(ORANGE.toUpperCase());

  // Closed, the canvas is the tool's again.
  await page.keyboard.press("Escape");
  await expect(hex).toHaveCount(0);
  expect(await canvas.evaluate((el) => (el as HTMLElement).style.cursor)).toBe("");
  await page.mouse.click(square.x, square.y);
  await page.waitForTimeout(200);
  expect((await colours(page)).foreground).toBe(ORANGE);
});

test("the assistant picks a colour with sample_colour", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("photo-colours", JSON.stringify({ foreground: "#000000", background: "#ffffff" })));
  await openNewPhoto(page, "Assisted pick");
  await openImage(page, await shapes());
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(['call sample_colour {"x": 600, "y": 300, "sample_size": 11, "set": "background"}', 'call sample_colour {"x": 900, "y": 300}', "call get_photo"].join("\n"));
  await composer.press("Enter");
  await expect(panel).toContainText("get_photo: ok", { timeout: 30_000 });
  await expect(panel).toContainText("sample_colour: failed");
  await expect.poll(async () => (await colours(page)).background).toBe(GREEN);
});
