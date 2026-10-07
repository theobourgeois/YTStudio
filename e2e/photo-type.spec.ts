/**
 * The photo suite's Type tool and text layers (docs/photo/tools/type.md). Its tests make their own photos; they run in
 * order and share a server. What's checked is the document (words, place, undo steps) and the renderer's own pixels.
 */
import { type Page, expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

interface View {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

interface TextLayerShape {
  id: string;
  kind: string;
  name: string;
  text: string;
  box: { width: number; height: number } | null;
  align: string;
  colour: string;
  font: { family: string; size: number; weight: number; style: string };
  size: { width: number; height: number };
  origin: { x: number; y: number };
  transform: { x: number; y: number; scaleX: number; scaleY: number; rotation: number };
  style?: unknown;
  mask?: unknown;
}

type DebugWindow = {
  photoDebug: {
    renderer(): Promise<{
      renderView(doc: unknown, view: View): Promise<{ texture: { destroy(): void } }>;
      readFloat(texture: unknown, width: number, height: number): Promise<Float32Array>;
    }>;
    photo: { getState(): { history: { doc: { doc: { layers: TextLayerShape[]; canvas: { width: number; height: number } } }; past: unknown[] }; commit(fn: (doc: unknown) => unknown): void; undo(): void; redo(): void } };
    ui: { getState(): { view: View; selectedLayerIds: string[]; tool: string } };
  };
};

async function openNewPhoto(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/projects", { data: { suite: "photo", name } });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/p/${id}`);
  await expect(page.locator('[data-suite="photo"]')).toBeVisible();
  // The view is there once the canvas has its size.
  await expect.poll(() => page.evaluate(() => !!(window as unknown as DebugWindow).photoDebug.ui.getState().view)).toBe(true);
  return id;
}

const layers = (page: Page) => page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.doc.doc.layers);
const undoSteps = (page: Page) => page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.past.length);

/** Where document point (x, y) is on the page (CSS pixels). */
async function screenAt(page: Page, x: number, y: number) {
  const box = (await page.getByLabel("Photo canvas").boundingBox())!;
  const { view, dpr } = await page.evaluate(() => ({ view: (window as unknown as DebugWindow).photoDebug.ui.getState().view, dpr: devicePixelRatio }));
  return { x: box.x + ((x - view.x) * view.zoom) / dpr, y: box.y + ((y - view.y) * view.zoom) / dpr };
}

async function clickDoc(page: Page, x: number, y: number, options: { shift?: boolean } = {}) {
  const p = await screenAt(page, x, y);
  if (options.shift) await page.keyboard.down("Shift");
  await page.mouse.click(p.x, p.y);
  if (options.shift) await page.keyboard.up("Shift");
}

/** Where a text layer's origin is on the canvas (its first baseline, or its box's top-left). */
function originOf(l: TextLayerShape) {
  const r = (l.transform.rotation * Math.PI) / 180;
  const u = (l.origin.x - l.size.width / 2) * l.transform.scaleX;
  const v = (l.origin.y - l.size.height / 2) * l.transform.scaleY;
  return { x: l.transform.x + Math.cos(r) * u - Math.sin(r) * v, y: l.transform.y + Math.sin(r) * u + Math.cos(r) * v };
}

/** The open photo rendered at 100% over a region, as RGBA floats (linear light), `hide`: layers left out. */
async function renderRegion(page: Page, region: { x: number; y: number; width: number; height: number }, hide: string[] = []): Promise<number[]> {
  return page.evaluate(
    async ({ region, hide }) => {
      const { photoDebug } = window as unknown as DebugWindow;
      const r = await photoDebug.renderer();
      const doc = photoDebug.photo.getState().history.doc.doc;
      const shown = { ...doc, layers: doc.layers.map((l) => (hide.includes(l.id) ? { ...l, visible: false } : l)) };
      const { texture } = await r.renderView(shown, { ...region, zoom: 1 });
      const data = await r.readFloat(texture, region.width, region.height);
      texture.destroy();
      return Array.from(data);
    },
    { region, hide },
  );
}

/** How many of a region's pixels are darker than mid-grey (the words drawn over white). */
const darkPixels = (data: number[]) => {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] < 0.2 && data[i + 1] < 0.2 && data[i + 2] < 0.2) n++;
  return n;
};

test("a click makes point text typed on the canvas: one undo step, Escape commits, an empty one is dropped", async ({ page }) => {
  await openNewPhoto(page, "Type point");
  await page.keyboard.press("t");
  await expect(page.locator('[data-tool-options="type"]')).toBeVisible();
  await clickDoc(page, 200, 500);
  const field = page.locator("[data-type-field]");
  await expect(field).toBeFocused();
  // The photo's keys are the text's while typing: V, Delete and Space type.
  await page.keyboard.type("Hello V");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await page.keyboard.type("World");
  await expect.poll(async () => (await layers(page))[0]?.text).toBe("Hello \nWorld");
  expect(await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.ui.getState().tool)).toBe("type");
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  const [layer] = await layers(page);
  expect(layer).toMatchObject({ kind: "text", name: "Hello", box: null, align: "left", colour: "#000000" });
  // The click is on the first baseline (a document pixel, give or take the screen's).
  const o = originOf(layer);
  expect(Math.abs(o.x - 200)).toBeLessThan(3);
  expect(Math.abs(o.y - 500)).toBeLessThan(3);
  expect(await undoSteps(page)).toBe(1);
  // The words are drawn: dark pixels under them, none without the layer.
  const region = { x: Math.floor(o.x), y: Math.floor(o.y - 80), width: 300, height: 180 };
  expect(darkPixels(await renderRegion(page, region))).toBeGreaterThan(500);
  expect(darkPixels(await renderRegion(page, region, [layer.id]))).toBe(0);
  // Undo takes the whole session back; redo brings it.
  await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().undo());
  expect(await layers(page)).toHaveLength(0);
  await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().redo());
  expect(await layers(page)).toHaveLength(1);
  // New text left empty is dropped: no layer, no undo step.
  await clickDoc(page, 600, 1500);
  await expect(field).toBeFocused();
  await page.keyboard.press("Escape");
  expect(await layers(page)).toHaveLength(1);
  expect(await undoSteps(page)).toBe(1);
  // Layers shows it as a T and its words.
  await expect(page.locator(`[data-layer="${layer.id}"] [data-thumbnail="text"]`)).toBeVisible();
  await expect(page.locator(`[data-layer="${layer.id}"] [data-layer-name]`)).toHaveText("Hello");
});

test("a drag makes paragraph text that wraps; a click on words edits them where it lands; Shift-click makes new text", async ({ page }) => {
  await openNewPhoto(page, "Type paragraph");
  await page.keyboard.press("t");
  const a = await screenAt(page, 100, 300);
  const b = await screenAt(page, 600, 900);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await expect(page.locator("[data-type-draft]")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator("[data-type-field]")).toBeFocused();
  await expect(page.locator("[data-box-handle]")).toHaveCount(8);
  await page.keyboard.type("Several words that will not fit on one line of this box");
  await page.keyboard.press("Meta+Enter");
  await expect(page.locator("[data-type-field]")).toHaveCount(0);
  let [layer] = await layers(page);
  expect(layer.box).not.toBeNull();
  expect(Math.abs(layer.box!.width - 500)).toBeLessThan(4);
  expect(Math.abs(originOf(layer).x - 100)).toBeLessThan(3);
  // Its words wrap: dark pixels on several lines inside the box, none right of it.
  const inside = await renderRegion(page, { x: 100, y: 300, width: 500, height: 400 });
  expect(darkPixels(inside)).toBeGreaterThan(2000);
  expect(darkPixels(await renderRegion(page, { x: 620, y: 300, width: 200, height: 400 }))).toBe(0);

  // A click on its first word puts the caret there: what's typed goes in front of "words".
  const steps = await undoSteps(page);
  await clickDoc(page, originOf(layer).x + 2, originOf(layer).y + 40);
  await expect(page.locator("[data-type-field]")).toBeFocused();
  await page.keyboard.type("X");
  await page.keyboard.press("Escape");
  [layer] = await layers(page);
  expect(layer.text.startsWith("XSeveral") || layer.text.startsWith("SXeveral")).toBe(true);
  expect(await undoSteps(page)).toBe(steps + 1);
  expect(await layers(page)).toHaveLength(1);

  // Shift-click over it makes new text instead.
  await clickDoc(page, originOf(layer).x + 40, originOf(layer).y + 40, { shift: true });
  await page.keyboard.type("New");
  await page.keyboard.press("Escape");
  expect(await layers(page)).toHaveLength(2);
  expect((await layers(page))[1].text).toBe("New");
});

test("the options bar restyles the selected text (one undo step), and sets what new text is made with", async ({ page }) => {
  await openNewPhoto(page, "Type options");
  await page.keyboard.press("t");
  await clickDoc(page, 300, 600);
  await page.keyboard.type("Style me");
  // While typing, an option restyles what's typed, within the same step.
  await page.locator('[data-tool-options="type"] [data-text-align="center"]').click();
  await expect(page.locator("[data-type-field]")).toBeFocused();
  await page.locator("[data-type-commit]").click();
  let [layer] = await layers(page);
  expect(layer.align).toBe("center");
  expect(Math.abs(originOf(layer).x - 300)).toBeLessThan(3);
  expect(await undoSteps(page)).toBe(1);

  // Selected but not typed: the size restyles the whole layer, one undo step, its origin kept.
  const sizeField = page.getByLabel("Font size");
  await sizeField.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("120");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await layers(page))[0].font.size).toBe(120);
  expect(await undoSteps(page)).toBe(2);
  [layer] = await layers(page);
  expect(Math.abs(originOf(layer).x - 300)).toBeLessThan(3);
  expect(Math.abs(originOf(layer).y - 600)).toBeLessThan(3);

  // Properties' Character: the style restyles it too.
  await expect(page.locator("[data-character-properties]")).toBeVisible();
  await expect(page.locator("[data-paragraph-properties]")).toBeVisible();

  // With nothing selected, the options are what new text is made with.
  await page.locator(`[data-layer="${layer.id}"]`).click({ modifiers: ["Meta"] });
  await expect.poll(() => page.evaluate(() => (window as unknown as DebugWindow).photoDebug.ui.getState().selectedLayerIds.length)).toBe(0);
  await page.locator('[data-tool-options="type"] [data-text-align="right"]').click();
  await clickDoc(page, 900, 1200);
  await page.keyboard.type("Right");
  await page.keyboard.press("Escape");
  const made = (await layers(page))[1];
  expect(made.align).toBe("right");
  expect(made.font.size).toBe(120);

  // The Cancel button puts back what was there.
  await clickDoc(page, originOf(made).x - 20, originOf(made).y - 20);
  await expect(page.locator("[data-type-field]")).toBeFocused();
  await page.keyboard.type("zzz");
  await page.locator("[data-type-cancel]").click();
  expect((await layers(page))[1].text).toBe("Right");
});

test("text goes through layer styles, masks and Rasterize Type; Move scales it sharp", async ({ page }) => {
  await openNewPhoto(page, "Type styled");
  await page.keyboard.press("t");
  await clickDoc(page, 150, 500);
  await page.keyboard.type("Stroke");
  await page.keyboard.press("Escape");
  let [layer] = await layers(page);
  const o = originOf(layer);
  const region = { x: Math.floor(o.x - 20), y: Math.floor(o.y - 90), width: 360, height: 130 };
  const plain = await renderRegion(page, region);

  // A red Stroke: red pixels appear around the words (Layer Style on text, the main use).
  await page.evaluate(async (id) => {
    const { newStyleEffect } = await import(/* @vite-ignore */ String("/shared/photo/style/style.ts"));
    const stroke = newStyleEffect("stroke", "fx_stroke");
    const { photo } = (window as unknown as DebugWindow).photoDebug;
    photo.getState().commit((d) => {
      const doc = d as { layers: { id: string }[] };
      return { ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, style: { enabled: true, effects: [{ ...stroke, params: { ...stroke.params, size: 6, colour: "#ff0000" } }] } } : l)) };
    });
  }, layer.id);
  const red = (data: number[]) => {
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 0.6 && data[i + 1] < 0.1 && data[i + 2] < 0.1) n++;
    return n;
  };
  expect(red(plain)).toBe(0);
  const stroked = await renderRegion(page, region);
  expect(red(stroked)).toBeGreaterThan(1000);

  // Scaled up with the Move tool's numbers, it's drawn again at its size: its letters' area grows four times.
  const before = darkPixels(stroked);
  await page.evaluate(async (id) => {
    const { setTransform } = await import(/* @vite-ignore */ String("/shared/photo/edits.ts"));
    (window as unknown as DebugWindow).photoDebug.photo.getState().commit((d) => setTransform(d as never, id, { scaleX: 2, scaleY: 2 }));
  }, layer.id);
  [layer] = await layers(page);
  const big = originOf(layer);
  const bigRegion = { x: Math.floor(big.x - 40), y: Math.floor(big.y - 180), width: 720, height: 260 };
  const scaled = await renderRegion(page, bigRegion);
  expect(darkPixels(scaled)).toBeGreaterThan(before * 3.5);
  // Drawn at its size, not magnified: its edges are as thin as at 100% (few pixels between ink and paper).
  const between = (data: number[]) => {
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i + 1] > 0.15 && data[i + 1] < 0.6) n++;
    return n;
  };
  expect(between(scaled)).toBeLessThan(darkPixels(scaled) * 0.25);

  // A mask (in document pixels) painted black over its left end hides it, and nothing else.
  const left = { ...bigRegion, x: bigRegion.x + 10, width: 100 };
  const right = { ...bigRegion, x: bigRegion.x + 300, width: 100 };
  const [leftBefore, rightBefore] = [darkPixels(await renderRegion(page, left)), darkPixels(await renderRegion(page, right))];
  expect(leftBefore).toBeGreaterThan(500);
  await page.evaluate(async (id) => {
    const { setMask } = await import(/* @vite-ignore */ String("/shared/photo/edits.ts"));
    (window as unknown as DebugWindow).photoDebug.photo.getState().commit((d) => setMask(d as never, id, null));
  }, layer.id);
  await page.evaluate(
    async ({ id, points }) =>
      (window as unknown as { photoDebug: { paint(id: string, part: string, points: { x: number; y: number }[], o: object): Promise<unknown> } }).photoDebug.paint(id, "mask", points, { radius: 60, hardness: 1, colour: [0, 0, 0, 1] }),
    { id: layer.id, points: Array.from({ length: 30 }, (_, i) => ({ x: bigRegion.x + 60, y: bigRegion.y + i * 10 })) },
  );
  await expect.poll(async () => !!(await layers(page))[0].mask).toBe(true);
  await expect.poll(async () => darkPixels(await renderRegion(page, left))).toBeLessThan(leftBefore * 0.05);
  expect(darkPixels(await renderRegion(page, right))).toBe(rightBefore);
  await page.evaluate(async (id) => {
    const { removeMask } = await import(/* @vite-ignore */ String("/shared/photo/edits.ts"));
    (window as unknown as DebugWindow).photoDebug.photo.getState().commit((d) => removeMask(d as never, id));
  }, layer.id);

  // Rasterize Type (the Layers menu): a pixel layer in its place, its style kept as a style.
  await page.locator(`[data-layer="${layer.id}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rasterize Type" }).click();
  await expect.poll(async () => (await layers(page))[0].kind).toBe("pixel");
  const pixels = (await layers(page))[0];
  expect(pixels.style).toBeTruthy();
  // Drawn the same (once its pixels are on the GPU), but for resampling at the edges.
  await expect.poll(async () => red(await renderRegion(page, bigRegion)) / red(scaled)).toBeGreaterThan(0.95);
  expect(red(await renderRegion(page, bigRegion)) / red(scaled)).toBeLessThan(1.05);
  expect(await undoSteps(page)).toBeGreaterThan(1);
});

test("the assistant adds text, restyles it and reads it", async ({ page }) => {
  await openNewPhoto(page, "Type assistant");
  const run = (name: string, input: Record<string, unknown>) =>
    page.evaluate(
      async ({ name, input }) => {
        const { runPhotoTool } = await import(/* @vite-ignore */ String("/src/suites/photo/tools.ts"));
        const result = await runPhotoTool(name, input, { chat: null, turn: null, signal: new AbortController().signal, progress: () => {} });
        return result.content.map((c: { text?: string }) => c.text ?? "").join("\n");
      },
      { name, input },
    );
  const added = await run("add_text_layer", { text: "SALE", x: 540, y: 400, size: 160, align: "center", colour: "#ffffff", style: "Bold" });
  expect(added).toMatch(/Added text layer/);
  let [layer] = await layers(page);
  expect(layer).toMatchObject({ text: "SALE", align: "center", colour: "#ffffff" });
  expect(layer.font.weight).toBe(700);
  await run("set_text", { layer: "SALE", text: "BIG SALE", colour: "#112233" });
  [layer] = await layers(page);
  expect(layer).toMatchObject({ text: "BIG SALE", colour: "#112233", name: "BIG SALE" });
  expect(await run("get_photo", {})).toMatch(/text layer \(point text\): "BIG SALE"/);
  // And sees it: the picture has the words.
  const o = originOf(layer);
  expect(darkPixels(await renderRegion(page, { x: Math.floor(o.x - 400), y: Math.floor(o.y - 140), width: 800, height: 180 }))).toBeGreaterThan(2000);
});

test("Move drags text by whole pixels and a double-click edits it; the font list previews; the Character panel", async ({ page }) => {
  await openNewPhoto(page, "Type character");
  await page.keyboard.press("t");
  await clickDoc(page, 200, 500);
  await page.keyboard.type("Hello");
  await page.keyboard.press("Escape");
  await page.keyboard.press("v");
  const before = (await layers(page))[0];

  // Dragged by the Move tool, it moves by whole document pixels (its raster is placed again, not drawn again).
  const from = await screenAt(page, 260, 480);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 37.3, from.y + 21.7, { steps: 6 });
  await page.mouse.up();
  const moved = (await layers(page))[0];
  const dx = moved.transform.x - before.transform.x;
  const dy = moved.transform.y - before.transform.y;
  expect(Math.abs(dx)).toBeGreaterThan(1);
  expect(Math.abs(dx - Math.round(dx))).toBeLessThan(1e-9);
  expect(Math.abs(dy - Math.round(dy))).toBeLessThan(1e-9);

  // A double-click on its words with the Move tool edits them.
  const o = originOf(moved);
  await page.mouse.dblclick((await screenAt(page, o.x + 60, o.y - 20)).x, (await screenAt(page, o.x + 60, o.y - 20)).y);
  const field = page.locator("[data-type-field]");
  await expect(field).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.ui.getState().tool)).toBe("type");
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await layers(page))[0].text).toBe("Hello!");

  // The family list shows the family hovered on the selected text, without changing it; closed, it's gone.
  const textPreview = () => page.evaluate(() => ((window as unknown as DebugWindow).photoDebug.ui.getState() as unknown as { textPreview: { layerIds: string[]; patch: { font: { family: string } } } | null }).textPreview);
  await page.locator('[data-tool-options="type"] [aria-label="Font family"]').click();
  const options = page.locator('[data-font-list] [role="option"][aria-selected="false"]');
  await expect(options.first()).toBeVisible();
  const other = options.nth(1);
  const family = (await other.textContent())!.replace(/\d+$/, "").trim();
  await other.hover();
  await expect.poll(async () => (await textPreview())?.patch.font.family).toBe(family);
  expect((await textPreview())!.layerIds).toEqual([moved.id]);
  expect((await layers(page))[0].font.family).toBe(before.font.family);
  await page.keyboard.press("Escape");
  await expect.poll(textPreview).toBeNull();
  expect((await layers(page))[0].font.family).toBe(before.font.family);

  // The Character panel: underline draws a bar under the baseline; horizontal scale widens the words.
  const steps = await undoSteps(page);
  const strip = { x: Math.floor(o.x), y: Math.floor(o.y + 3), width: 200, height: 14 };
  expect(darkPixels(await renderRegion(page, strip))).toBeLessThan(20);
  await page.locator('[data-tool-options="type"] [data-option="Character"]').click();
  await page.locator('[data-character-popover] [data-text-style="underline"]').click();
  await expect.poll(async () => (await layers(page))[0] as unknown as { underline?: boolean }).toMatchObject({ underline: true });
  await expect.poll(async () => darkPixels(await renderRegion(page, strip))).toBeGreaterThan(300);
  const narrow = (await layers(page))[0].size.width;
  const horizontal = page.locator("[data-character-popover]").getByLabel("Horizontal");
  await horizontal.fill("150");
  await horizontal.press("Enter");
  await expect.poll(async () => ((await layers(page))[0] as unknown as { horizontalScale?: number }).horizontalScale).toBe(1.5);
  expect((await layers(page))[0].size.width).toBeGreaterThan(narrow * 1.3);
  expect(await undoSteps(page)).toBe(steps + 2);
});
