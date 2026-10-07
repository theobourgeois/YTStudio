/**
 * The photo suite's Gradient tool (docs/photo/tools/gradient.md): a drag makes a live Gradient Fill (drawn as its CPU
 * reference, edited by its widget), Classic paints a layer's pixels or mask, and the assistant does both. Its photos
 * are its own, made through the API, so it runs alone (`pnpm test:e2e photo-gradient`).
 */
import { type Page, expect, test } from "@playwright/test";
import { GRADIENT_TYPES, gradientFillShape, gradientT } from "../shared/photo/effects/gradient.ts";
import { fillTable, gradientColourAt, gradientFillPixel, maskGrey } from "../shared/photo/reference/gradient.ts";
import { GRADIENT_PRESETS } from "../shared/photo/style/gradients.ts";

test.describe.configure({ mode: "serial" });

const MOD_KEY = process.platform === "darwin" ? "Meta" : "Control";

interface ViewBox {
  zoom: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

type Layer = { id: string; kind: string; name: string; surface?: string | null; mask?: { surface: string | null }; effect?: { type: string; params: Record<string, unknown> } };

/** What the page puts on `window` in development (src/suites/photo/live.ts): the renderer and the stores. */
type DebugWindow = {
  photoDebug: {
    renderer(): Promise<{
      renderView(doc: unknown, view: ViewBox, options?: { refine?: boolean }): Promise<{ texture: { destroy(): void } }>;
      readFloat(texture: unknown, width: number, height: number): Promise<Float32Array>;
    }>;
    photo: {
      getState(): {
        history: { doc: { doc: { canvas: { width: number; height: number }; layers: Layer[] } } };
        commit(fn: (doc: unknown) => unknown): void;
        select(selection: unknown): void;
        undo(): void;
      };
    };
    ui: { getState(): { view: ViewBox; selectedLayerId: string | null; select(id: string | null): void; setTarget(t: "content" | "mask"): void } };
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

/** Replaces the open photo's canvas and layers (one undo step), as the tests' starting point. */
const setPhoto = (page: Page, canvas: { width: number; height: number; background: string | null }, layers: unknown[]) =>
  page.evaluate(({ canvas, layers }) => (window as unknown as DebugWindow).photoDebug.photo.getState().commit((d) => ({ ...(d as object), canvas, layers })), { canvas, layers });

const layersOf = (page: Page) => page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().history.doc.doc.layers);

const pixelLayer = (id: string, width: number, height: number, transform = { x: width / 2, y: height / 2, scaleX: 1, scaleY: 1, rotation: 0 }) => ({ id, kind: "pixel", name: id, visible: true, opacity: 1, surface: null, size: { width, height }, transform });

const gradientLayer = (id: string, params: Record<string, unknown>) => ({
  id,
  kind: "generator",
  name: "Gradient Fill 1",
  visible: true,
  opacity: 1,
  effect: { id: `${id}_fx`, type: "gradient-fill", version: 1, enabled: true, params: { gradient: GRADIENT_PRESETS[0], style: "linear", start: [40, 150], end: [360, 150], reverse: false, dither: true, ...params } },
});

/** The open photo rendered at `view` (zoom 1: level 0), as RGBA floats. */
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

/** Where document point (x, y) is on the page (CSS pixels), from the canvas's view. */
async function screenOf(page: Page, x: number, y: number) {
  const box = (await page.getByLabel("Photo canvas").boundingBox())!;
  const { view, dpr } = await page.evaluate(() => ({ view: (window as unknown as DebugWindow).photoDebug.ui.getState().view, dpr: devicePixelRatio }));
  return { x: box.x + ((x - view.x) * view.zoom) / dpr, y: box.y + ((y - view.y) * view.zoom) / dpr };
}

/** A drag on the canvas between two document points (Shift held with `shift`). */
async function dragDoc(page: Page, from: [number, number], to: [number, number], options: { shift?: boolean; escape?: boolean } = {}) {
  const a = await screenOf(page, ...from);
  const b = await screenOf(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  if (options.shift) await page.keyboard.down("Shift");
  await page.mouse.move(a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  if (options.escape) await page.keyboard.press("Escape");
  await page.mouse.up();
  if (options.shift) await page.keyboard.up("Shift");
}

/** The centre of an element on the page. */
async function centreOf(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const pixelAt = (data: number[], width: number, x: number, y: number) => data.slice((y * width + x) * 4, (y * width + x) * 4 + 4);
const worst = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

const canvas = { width: 400, height: 300 };
const whole: ViewBox = { zoom: 1, x: 0, y: 0, ...canvas };

test("a drag makes a live Gradient Fill drawn as its reference, in every type and method; drawing again redraws it; one undo step each", async ({ page }) => {
  await openNewPhoto(page, "Gradient live");
  await setPhoto(page, { ...canvas, background: "#ffffff" }, []);
  await page.keyboard.press("g");
  await expect(page.locator('[data-tool-options="gradient"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /Gradient: Foreground to Background/ })).toBeVisible();

  await dragDoc(page, [40, 150], [360, 150]);
  await expect.poll(async () => (await layersOf(page)).length).toBe(1);
  let [layer] = await layersOf(page);
  expect(layer).toMatchObject({ kind: "generator", name: "Gradient Fill 1", effect: { type: "gradient-fill", params: { style: "linear", reverse: false, dither: true } } });
  const params = layer.effect!.params as { start: [number, number]; end: [number, number] };
  expect(Math.abs(params.start[0] - 40)).toBeLessThan(1.5);
  expect(Math.abs(params.end[0] - 360)).toBeLessThan(1.5);
  expect(await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.ui.getState().selectedLayerId)).toBe(layer.id);
  await expect(page.locator(`[data-gradient-widget="${layer.id}"] [data-gradient-end="end"]`)).toBeVisible();

  // One undo step, and back.
  await page.keyboard.press(`${MOD_KEY}+z`);
  await expect.poll(async () => (await layersOf(page)).length).toBe(0);
  await page.keyboard.press(`${MOD_KEY}+Shift+z`);
  await expect.poll(async () => (await layersOf(page)).length).toBe(1);
  await page.evaluate((id) => (window as unknown as DebugWindow).photoDebug.ui.getState().select(id), layer.id);

  // With it active, a new drag draws its line again (Shift: a multiple of 45°) instead of making another.
  await dragDoc(page, [200, 40], [215, 260], { shift: true });
  await expect.poll(async () => ((await layersOf(page))[0].effect!.params.end as number[])[0]).toBeCloseTo(200, 0);
  expect(await layersOf(page)).toHaveLength(1);
  [layer] = await layersOf(page);

  // Every type, and the methods, as the reference draws them (Normal over white: the gradient's own pixels).
  for (const style of GRADIENT_TYPES) {
    for (const method of ["perceptual", "stripes"] as const) {
      const p = { ...layer.effect!.params, style, start: [130.5, 120.25] as [number, number], end: [300, 210] as [number, number], gradient: { ...GRADIENT_PRESETS[4], method }, reverse: style === "diamond" };
      await setPhoto(page, { ...canvas, background: "#ffffff" }, [gradientLayer(layer.id, p)]);
      const data = await renderRegion(page, whole);
      const shape = gradientFillShape(p as Parameters<typeof gradientFillShape>[0]);
      const table = fillTable(shape);
      let far = 0;
      for (let y = 1; y < canvas.height; y += 5) {
        for (let x = 2; x < canvas.width; x += 5) {
          const t = gradientT(shape.style, shape.start, shape.end, x + 0.5, y + 0.5);
          // (Edges between stripes, and Angle's seam, fall a hair either way in f32.)
          if ((style === "angle" && (t < 0.003 || t > 0.997)) || (method === "stripes" && GRADIENT_PRESETS[4].colours.some((c) => Math.abs(c.at - (shape.reverse ? 1 - t : t)) < 0.003))) continue;
          far = Math.max(far, worst(pixelAt(data, canvas.width, x, y), gradientFillPixel(shape, table, x + 0.5, y + 0.5)));
        }
      }
      expect(far, `${style} ${method}`).toBeLessThan(2e-3);
    }
  }
});

test("the widget: ends drag, a click on the line adds a stop, a stop pulled off goes, Delete takes one, a double-click picks its colour, a midpoint moves", async ({ page }) => {
  await openNewPhoto(page, "Gradient widget");
  await setPhoto(page, { ...canvas, background: "#ffffff" }, [gradientLayer("g", {})]);
  await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.ui.getState().select("g"));
  await page.keyboard.press("g");
  const widget = '[data-gradient-widget="g"]';
  await expect(page.locator(`${widget} [data-gradient-end="end"]`)).toBeVisible();
  const params = async () => (await layersOf(page))[0].effect!.params as { start: number[]; end: number[]; gradient: { colours: { at: number; colour: string; mid?: number }[] } };

  // The end dragged, one undo step.
  const end = await centreOf(page, `${widget} [data-gradient-end="end"]`);
  const to = await screenOf(page, 360, 60);
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await params()).end[1]).toBeCloseTo(60, 0);
  await page.keyboard.press(`${MOD_KEY}+z`);
  await expect.poll(async () => (await params()).end).toEqual([360, 150]);

  // A click on the line adds a stop in the gradient's colour there.
  const mid = await screenOf(page, 120, 150);
  await page.mouse.click(mid.x, mid.y);
  await expect.poll(async () => (await params()).gradient.colours.length).toBe(3);
  expect((await params()).gradient.colours[1].at).toBeCloseTo(0.25, 1);
  await expect(page.locator(`${widget} [data-gradient-stop="1"]`)).toHaveAttribute("data-selected", "true");

  // Pulled away from the line, it comes off (in one undo step).
  const stop = await centreOf(page, `${widget} [data-gradient-stop="1"]`);
  await page.mouse.move(stop.x, stop.y);
  await page.mouse.down();
  await page.mouse.move(stop.x + 10, stop.y + 20, { steps: 3 });
  await page.mouse.move(stop.x + 10, stop.y + 70, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await params()).gradient.colours.length).toBe(2);

  // Added again and slid along; Delete takes the selected stop (not the layer).
  await page.mouse.click(mid.x, mid.y);
  await expect.poll(async () => (await params()).gradient.colours.length).toBe(3);
  const again = await centreOf(page, `${widget} [data-gradient-stop="1"]`);
  const along = await screenOf(page, 280, 150);
  await page.mouse.move(again.x, again.y);
  await page.mouse.down();
  await page.mouse.move(along.x, along.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await params()).gradient.colours[1].at).toBeCloseTo(0.75, 1);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await params()).gradient.colours.length).toBe(2);
  expect(await layersOf(page)).toHaveLength(1);

  // A midpoint dragged towards the start.
  const diamond = await centreOf(page, `${widget} [data-gradient-mid="0"]`);
  const nearer = await screenOf(page, 120, 150);
  await page.mouse.move(diamond.x, diamond.y);
  await page.mouse.down();
  await page.mouse.move(nearer.x, diamond.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await params()).gradient.colours[0].mid ?? 0.5).toBeLessThan(0.35);

  // A double-click on a stop opens the colour picker by it.
  await page.mouse.click(mid.x, mid.y);
  await expect.poll(async () => (await params()).gradient.colours.length).toBe(3);
  const picked = await centreOf(page, `${widget} [data-gradient-stop="1"]`);
  await page.mouse.dblclick(picked.x, picked.y);
  await expect(page.locator("[data-gradient-stop-colour]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-gradient-stop-colour]")).toHaveCount(0);

  // The line dragged moves the whole gradient.
  const before = await params();
  const lineAt = await screenOf(page, 300, 150);
  await page.mouse.move(lineAt.x, lineAt.y);
  await page.mouse.down();
  const below = await screenOf(page, 300, 190);
  await page.mouse.move(below.x, below.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await params()).start[1] - before.start[1]).toBeCloseTo(40, 0);
  expect((await params()).end[1] - (await params()).start[1]).toBeCloseTo(before.end[1] - before.start[1], 1);
});

test("Classic paints a pixel layer within the selection through its transform, and a mask as greys; one undo step; Escape drops it", async ({ page }) => {
  await openNewPhoto(page, "Gradient classic");
  // A pixel layer of half the canvas's size, scaled up to cover it: the gradient goes where the layer shows.
  await setPhoto(page, { ...canvas, background: null }, [pixelLayer("px", 200, 150, { x: 200, y: 150, scaleX: 2, scaleY: 2, rotation: 0 })]);
  await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.ui.getState().select("px"));
  await page.keyboard.press("g");
  await page.getByRole("combobox", { name: "Gradient mode" }).click();
  await page.getByRole("option", { name: "Classic gradient" }).click();
  await expect(page.locator('[data-option="Transparency"]')).toBeVisible();
  await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().select({ kind: "rect", x: 100, y: 0, width: 200, height: 300 }));

  // Escape mid-drag changes nothing.
  await dragDoc(page, [100, 150], [300, 150], { escape: true });
  await page.waitForTimeout(300);
  expect((await layersOf(page))[0].surface).toBeNull();

  await dragDoc(page, [100, 150], [300, 150]);
  await expect.poll(async () => (await layersOf(page))[0].surface ?? null, { timeout: 10_000 }).not.toBeNull();
  const data = await renderRegion(page, whole);
  const shape = { style: "linear" as const, start: [100, 150] as [number, number], end: [300, 150] as [number, number], gradient: { ...GRADIENT_PRESETS[0], name: "Foreground to Background", method: "perceptual" as const }, reverse: false, dither: true };
  // The drag's ends land within a screen pixel of these: compare the colour, not the dither, away from the edges.
  const table = fillTable({ ...shape, dither: false });
  let far = 0;
  for (let x = 110; x < 290; x += 7) {
    const got = pixelAt(data, canvas.width, x, 150);
    const want = gradientFillPixel({ ...shape, dither: false }, table, x + 0.5, 150.5);
    far = Math.max(far, Math.abs(got[0] - want[0]));
    expect(got[3]).toBeCloseTo(1, 2);
  }
  expect(far).toBeLessThan(0.03);
  // Outside the selection, nothing.
  expect(pixelAt(data, canvas.width, 50, 150)[3]).toBe(0);
  expect(pixelAt(data, canvas.width, 350, 150)[3]).toBe(0);
  // One undo step.
  await page.keyboard.press(`${MOD_KEY}+z`);
  await expect.poll(async () => (await layersOf(page))[0].surface ?? null).toBeNull();
  await page.keyboard.press(`${MOD_KEY}+Shift+z`);
  await expect.poll(async () => (await layersOf(page))[0].surface ?? null).not.toBeNull();

  // A mask: Foreground to Background (black to white) fades the layer in from the left.
  await page.evaluate(() => {
    const { photoDebug } = window as unknown as DebugWindow;
    photoDebug.photo.getState().select(null);
    photoDebug.photo.getState().commit((d) => ({ ...(d as object), layers: (d as { layers: Layer[] }).layers.map((l) => ({ ...l, mask: { surface: null } })) }));
    photoDebug.ui.getState().setTarget("mask");
  });
  await dragDoc(page, [100, 150], [300, 150]);
  await expect.poll(async () => (await layersOf(page))[0].mask?.surface ?? null, { timeout: 10_000 }).not.toBeNull();
  const masked = await renderRegion(page, whole);
  for (const x of [150, 200, 250]) {
    const grey = maskGrey(gradientColourAt({ ...shape, dither: false }, table, x + 0.5, 150.5));
    expect(pixelAt(masked, canvas.width, x, 150)[3]).toBeCloseTo(grey, 1);
  }
  // A Gradient Fill can't take Classic: it says so.
  await setPhoto(page, { ...canvas, background: null }, [gradientLayer("g", {})]);
  await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.ui.getState().select("g"));
  await dragDoc(page, [50, 50], [300, 50]);
  await expect(page.getByText(/made by its gradient/)).toBeVisible();
});

test("a selection becomes a new Gradient Fill's mask, in the same undo step", async ({ page }) => {
  await openNewPhoto(page, "Gradient selection");
  await setPhoto(page, { ...canvas, background: "#ffffff" }, []);
  await page.keyboard.press("g");
  await page.evaluate(() => (window as unknown as DebugWindow).photoDebug.photo.getState().select({ kind: "rect", x: 0, y: 0, width: 200, height: 300 }));
  await dragDoc(page, [20, 150], [380, 150]);
  await expect.poll(async () => (await layersOf(page))[0]?.mask?.surface ?? null, { timeout: 10_000 }).not.toBeNull();
  const data = await renderRegion(page, whole);
  // Inside, the gradient (dark near its start); outside, the white background.
  expect(pixelAt(data, canvas.width, 40, 150)[0]).toBeLessThan(0.2);
  expect(pixelAt(data, canvas.width, 300, 150)[0]).toBeCloseTo(1, 2);
  await page.keyboard.press(`${MOD_KEY}+z`);
  await expect.poll(async () => (await layersOf(page)).length).toBe(0);
});

test("the assistant adds a Gradient Fill and paints a gradient onto a mask", async ({ page }) => {
  const id = await openNewPhoto(page, "Gradient helper");
  await setPhoto(page, { ...canvas, background: "#ffffff" }, [{ ...pixelLayer("px", 400, 300), name: "Paint", mask: { surface: null } }]);
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_generator {"type": "gradient-fill", "name": "Sky", "params": {"style": "radial", "start": [200, 150], "end": [380, 150], "gradient": "Copper"}}',
      'call paint_gradient {"layer": "Paint", "target": "mask", "start": [0, 0], "end": [400, 0], "gradient": {"colours": [{"at": 0, "colour": "#000000"}, {"at": 1, "colour": "#ffffff"}]}}',
      'call paint_gradient {"layer": "Sky", "start": [0, 0], "end": [1, 1]}',
      "call get_photo",
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("paint_gradient: failed, get_photo: ok", { timeout: 30_000 });
  const layers = await layersOf(page);
  expect(layers.find((l) => l.name === "Sky")).toMatchObject({ kind: "generator", effect: { type: "gradient-fill", params: { style: "radial", gradient: { name: "Copper" } } } });
  await expect.poll(async () => (await layersOf(page)).find((l) => l.name === "Paint")?.mask?.surface ?? null).not.toBeNull();
  // The saved photo has them.
  await expect.poll(async () => ((await (await page.request.get(`/api/projects/${id}`)).json()) as { layers: Layer[] }).layers.length).toBe(2);
});
