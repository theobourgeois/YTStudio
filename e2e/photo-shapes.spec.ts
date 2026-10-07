/**
 * The photo suite's shape tools (docs/photo/tools/shapes.md): Rectangle, Ellipse, Line and Arrow (U). Its tests make
 * their own photos, as `photo.spec.ts`'s do (the helpers are copied from there, so this file runs alone); they run
 * in order and share a server. What's checked is the document saved, the canvas's pixels and the renderer's own.
 */
import { type Page, expect, test } from "@playwright/test";
import { placedShape } from "../shared/photo/shapes.ts";
import type { ShapeLayer } from "../shared/photo/types.ts";

test.describe.configure({ mode: "serial" });

const savedPhoto = async (page: Page, id: string) => (await page.request.get(`/api/projects/${id}`)).json();

const SIZE = { width: 1200, height: 800 };

async function openNewPhoto(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/projects", { data: { suite: "photo", name, options: SIZE } });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/p/${id}`);
  await expect(page.locator('[data-suite="photo"]')).toBeVisible();
  // The canvas is fitted once the renderer has started.
  await expect.poll(() => page.evaluate(() => !!(window as unknown as DebugWindow).photoDebug.ui.getState().view)).toBe(true);
  return id;
}

interface ViewBox {
  zoom: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

type DebugWindow = {
  photoDebug: {
    renderer(): Promise<{
      renderView(doc: unknown, view: ViewBox): Promise<{ texture: { destroy(): void } }>;
      readFloat(texture: unknown, width: number, height: number): Promise<Float32Array>;
    }>;
    photo: { getState(): { history: { doc: { doc: { layers: Record<string, unknown>[] } } }; undo(): void } };
    ui: { getState(): { view: ViewBox; selectedLayerId: string | null; setView(v: ViewBox): void } };
  };
};

/** Where document point (x, y) is on the page (CSS pixels), from the canvas's view. */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await page.getByLabel("Photo canvas").boundingBox())!;
  const { view, dpr } = await page.evaluate(() => ({ view: (window as unknown as DebugWindow).photoDebug.ui.getState().view, dpr: devicePixelRatio }));
  return { x: box.x + ((x - view.x) * view.zoom) / dpr, y: box.y + ((y - view.y) * view.zoom) / dpr };
}

/** A drag on the canvas between document points, in steps (modifier keys held throughout). */
async function drag(page: Page, from: [number, number], to: [number, number], modifiers: string[] = []) {
  const a = await screenOf(page, ...from);
  const b = await screenOf(page, ...to);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}

/** A handle's drag to a document point. */
async function dragHandle(page: Page, handle: string, to: [number, number], modifiers: string[] = []) {
  const box = (await page.locator(`[data-shape-handle="${handle}"]`).boundingBox())!;
  const b = await screenOf(page, ...to);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2 + ((b.x - box.x - box.width / 2) * i) / 6, box.y + box.height / 2 + ((b.y - box.y - box.height / 2) * i) / 6);
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}

/** A shape tool, by U and Shift+U (the group remembers the tool used last). */
async function pickTool(page: Page, tool: "rectangleShape" | "ellipseShape" | "lineShape" | "arrowShape") {
  await page.keyboard.press("u");
  for (let i = 0; i < 4 && (await page.locator("[data-tool]").getAttribute("data-tool")) !== tool; i++) await page.keyboard.press("Shift+u");
  await expect(page.locator("[data-tool]")).toHaveAttribute("data-tool", tool);
}

/** Opens a photo made earlier, once its layers are shown. */
async function reopen(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await expect(page.locator("[data-layer]").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as DebugWindow).photoDebug.ui.getState().view)).toBe(true);
}

const layersNow = (page: Page) => page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.doc.doc.layers) as unknown as Promise<ShapeLayer[]>;
const lastShape = async (page: Page) => (await layersNow(page)).at(-1)!;

/** The open photo rendered by the app's renderer over a region at 100% (RGBA floats). */
async function renderRegion(page: Page, view: ViewBox): Promise<number[]> {
  return page.evaluate(async (view) => {
    const { photoDebug } = window as unknown as DebugWindow;
    const r = await photoDebug.renderer();
    const doc = photoDebug.photo.getState().history.doc.doc;
    const { texture } = await r.renderView(doc, view);
    const data = await r.readFloat(texture, view.width, view.height);
    texture.destroy();
    return Array.from(data);
  }, view);
}

/** The rendered pixel at document point (x, y): RGBA floats. */
const pixelAt = async (page: Page, x: number, y: number) => (await renderRegion(page, { zoom: 1, x, y, width: 1, height: 1 })).slice(0, 4);

const dark = (p: number[]) => p[0] < 0.1 && p[1] < 0.1 && p[2] < 0.1;
const light = (p: number[]) => p[0] > 0.9 && p[1] > 0.9 && p[2] > 0.9;

let shapesId = "";

test("the Rectangle tool draws shape layers: a drag, Shift for a square, Alt from the centre; the tool stays", async ({ page }) => {
  shapesId = await openNewPhoto(page, "Shapes");
  await pickTool(page, "rectangleShape");
  await expect(page.locator('[data-tool-options="shape"]')).toBeVisible();

  await drag(page, [100, 100], [400, 300]);
  await expect(page.locator('[data-layer][data-kind="shape"]')).toHaveCount(1);
  const rect = await lastShape(page);
  expect(rect).toMatchObject({ kind: "shape", name: "Rectangle", shape: { type: "rect", radius: 0 }, size: { width: 300, height: 200 }, transform: { x: 250, y: 200, scaleX: 1, scaleY: 1, rotation: 0 } });
  // Selected, its handles showing; the tool stays the Rectangle.
  await expect(page.locator(`[data-layer="${rect.id}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-shape-handle="radius"]')).toBeVisible();
  await expect(page.locator("[data-tool]")).toHaveAttribute("data-tool", "rectangleShape");

  await drag(page, [500, 100], [700, 180], ["Shift"]);
  expect((await lastShape(page)).size).toEqual({ width: 200, height: 200 });
  await drag(page, [300, 600], [400, 650], ["Alt"]);
  expect(await lastShape(page)).toMatchObject({ name: "Rectangle 3", size: { width: 200, height: 100 }, transform: { x: 300, y: 600 } });

  // Drawn in the foreground colour (black) on its edge, nothing inside.
  expect(dark(await pixelAt(page, 100, 200))).toBe(true);
  expect(light(await pixelAt(page, 250, 200))).toBe(true);

  // Each shape is one undo step; Escape mid-drag draws nothing.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(page.locator('[data-layer][data-kind="shape"]')).toHaveCount(2);
  const a = await screenOf(page, 800, 500);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 60, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator('[data-layer][data-kind="shape"]')).toHaveCount(2);

  const saved = await expect.poll(async () => (await savedPhoto(page, shapesId)).layers.length).toBe(2).then(() => savedPhoto(page, shapesId));
  expect(saved.version).toBe(7);
  expect(saved.layers[0]).toMatchObject({ kind: "shape", shape: { type: "rect" }, paint: { stroke: "#000000", fill: null } });
});

test("an arrow ends where it's drawn; its ends and middle are handles", async ({ page }) => {
  await reopen(page, shapesId);
  await expect(page.locator('[data-layer][data-kind="shape"]')).toHaveCount(2);
  // U, then Shift+U through the group to Arrow.
  await pickTool(page, "arrowShape");
  await drag(page, [100, 700], [600, 700]);
  const arrow = await lastShape(page);
  expect(arrow).toMatchObject({ name: "Arrow", shape: { type: "line", startHead: "none", endHead: "arrow" } });
  expect(placedShape(arrow)).toMatchObject({ from: { x: 100, y: 700 }, to: { x: 600, y: 700 } });
  // The head's point is on the end, not past it.
  expect(dark(await pixelAt(page, 596, 700))).toBe(true);
  expect(light(await pixelAt(page, 606, 700))).toBe(true);
  // Its wings, behind the tip.
  expect(dark(await pixelAt(page, 575, 690))).toBe(true);

  // The end, dragged with Shift, snaps to 45° from the start.
  await dragHandle(page, "to", [560, 260], ["Shift"]);
  const moved = placedShape(await lastShape(page));
  if (moved.type !== "line") throw new Error("a line");
  expect(moved.to.x - 100).toBeCloseTo(700 - moved.to.y, 0);
  // The middle bends it.
  const middle = { x: (moved.from.x + moved.to.x) / 2, y: (moved.from.y + moved.to.y) / 2 };
  await dragHandle(page, "bend", [middle.x - 50, middle.y - 50]);
  const bent = placedShape(await lastShape(page));
  expect(bent.type === "line" && Math.abs(bent.bend)).toBeGreaterThan(40);
});

test("a click makes a shape of a default size, or selects the shape under it", async ({ page }) => {
  await reopen(page, shapesId);
  await pickTool(page, "ellipseShape");
  const at = await screenOf(page, 900, 300);
  await page.mouse.click(at.x, at.y);
  const ellipse = await lastShape(page);
  // A fifth of the shorter side (800).
  expect(ellipse).toMatchObject({ name: "Ellipse", shape: { type: "ellipse" }, size: { width: 160, height: 160 }, transform: { x: 900, y: 300 } });
  // A click on the first rectangle's edge selects it rather than making another.
  const count = (await layersNow(page)).length;
  const edge = await screenOf(page, 100, 200);
  await page.mouse.click(edge.x, edge.y);
  expect((await layersNow(page)).length).toBe(count);
  const first = (await layersNow(page))[0];
  await expect(page.locator(`[data-layer="${first.id}"]`)).toHaveAttribute("aria-selected", "true");
});

test("the options bar restyles the selected shapes, one undo step each, and styles new ones", async ({ page }) => {
  await reopen(page, shapesId);
  await pickTool(page, "rectangleShape");
  const first = (await layersNow(page))[0];
  await page.locator(`[data-layer="${first.id}"]`).click();
  const bar = page.locator('[data-tool-options="shape"]');
  // The width, typed.
  await bar.getByRole("spinbutton", { name: "Width" }).click();
  await page.keyboard.type("20");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await layersNow(page))[0].paint.strokeWidth).toBe(20);
  // Filled with the foreground colour, dashed, drawn by hand.
  await bar.locator('[data-option="Fill"] button').click();
  await page.locator('[data-paint-choice="foreground"]').click();
  await page.keyboard.press("Escape");
  await bar.locator('[data-option="Stroke style"]').click();
  await page.getByRole("option", { name: "Dashed" }).click();
  await bar.locator('[data-option="Sloppiness"] [data-value="1"]').click();
  await expect.poll(async () => (await layersNow(page))[0].paint).toMatchObject({ strokeWidth: 20, fill: "#000000", dash: "dashed", sloppiness: 1 });
  // Undo takes back the last change only.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(async () => (await layersNow(page))[0].paint).toMatchObject({ dash: "dashed", sloppiness: 0 });
  // The next shape is drawn with what the bar says.
  const count = (await layersNow(page)).length;
  await drag(page, [800, 500], [1000, 700]);
  await expect.poll(async () => (await layersNow(page)).length).toBe(count + 1);
  // Above the layer that was active (the first rectangle), and selected.
  const drawn = (await layersNow(page))[1];
  await expect(page.locator(`[data-layer="${drawn.id}"]`)).toHaveAttribute("aria-selected", "true");
  expect(drawn.paint).toMatchObject({ strokeWidth: 20, fill: "#000000", dash: "dashed" });
});

test("Properties edits a shape in pixels; a rectangle's corners round from its widget; Rasterize makes it pixels that look the same", async ({ page }) => {
  await reopen(page, shapesId);
  await pickTool(page, "rectangleShape");
  await drag(page, [150, 450], [450, 650]);
  const rect = await lastShape(page);
  await expect(page.locator('[data-shape-properties="rectangle"]')).toBeVisible();
  const w = page.locator('[data-shape-properties] input[aria-label="W"]');
  await w.fill("320");
  await w.press("Enter");
  await expect.poll(async () => (await lastShape(page)).size.width).toBe(320);
  await dragHandle(page, "radius", [190, 490]);
  await expect.poll(async () => ((await lastShape(page)).shape as { radius: number }).radius).toBeGreaterThan(30);

  const region = { zoom: 1, x: 140, y: 440, width: 64, height: 64 };
  const before = await renderRegion(page, region);
  await page.locator('[data-shape-properties]').getByRole("button", { name: "Rasterize" }).click();
  await expect(page.locator(`[data-layer="${rect.id}"]`)).toHaveAttribute("data-kind", "pixel");
  // Once its pixels are on the GPU, they're what the shape showed.
  const worst = async () => {
    const after = await renderRegion(page, region);
    return before.reduce((w, v, i) => Math.max(w, Math.abs(v - after[i])), 0);
  };
  await expect.poll(worst, { timeout: 10_000 }).toBeLessThan(0.01);
});

test("shapes take blend modes and layer styles, and the assistant boxes and points at things", async ({ page }) => {
  const id = await openNewPhoto(page, "Annotated");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_shape {"kind": "rectangle", "x": 400, "y": 200, "width": 300, "height": 200, "stroke": "#ff0000", "stroke_width": 10, "radius": 16, "name": "Box"}',
      'call add_shape {"kind": "arrow", "from": [100, 700], "to": [390, 420], "stroke": "#ff0000", "stroke_width": 10, "bend": 40, "name": "Pointer"}',
      'call set_shape {"layer": "Pointer", "end_head": "triangle", "sloppiness": "artist"}',
      'call set_shape {"layer": "Box", "from": [0, 0]}',
      'call set_layer_blending {"layers": ["Box"], "mode": "multiply"}',
      'call set_layer_style {"layer": "Pointer", "add": "drop-shadow", "params": {"distance": 12, "size": 4, "opacity": 100}}',
      "call get_photo",
      'call view_photo {"width": 300}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("set_shape: failed, set_layer_blending: ok, set_layer_style: ok, get_photo: ok, view_photo: ok", { timeout: 30_000 });
  const doc = await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(2).then(() => savedPhoto(page, id));
  const [box, pointer] = doc.layers as ShapeLayer[];
  expect(box).toMatchObject({ name: "Box", blend: "multiply", shape: { type: "rect", radius: 16 }, paint: { stroke: "#ff0000", strokeWidth: 10, fill: null } });
  expect(placedShape(box)).toMatchObject({ cx: 550, cy: 300, width: 300, height: 200 });
  expect(pointer).toMatchObject({ name: "Pointer", shape: { endHead: "triangle" }, paint: { sloppiness: 1 }, style: { effects: [{ type: "drop-shadow" }] } });
  // Drawn red on the box's edge (multiplied over white: red).
  const edge = await pixelAt(page, 550, 200);
  expect(edge[0]).toBeGreaterThan(0.8);
  expect(edge[1]).toBeLessThan(0.1);
});
