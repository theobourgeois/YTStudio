/**
 * The photo suite's flips and turns: Edit › Transform on the selected layers (⌘H, ⌥⌘H, the menu, Properties'
 * buttons), Image › Image Rotation on the whole canvas (masks in document pixels moved pixel for pixel), and the
 * assistant's. Then Free Transform (⌘T): Skew, Distort and Perspective, drawn by the GPU in perspective, and Warp. Its own photos, as `photo.spec.ts`'s; run alone with `pnpm test:e2e photo-transform`.
 */
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { invertHomography, layerProjection, project, quadOf } from "../shared/photo/projective.ts";
import { unwarp, warpPoint } from "../shared/photo/warp.ts";

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
  await page.locator('[data-menu="edit"]').click();
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

  await page.locator('[data-menu="image"]').click();
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

type Placed = { x: number; y: number; scaleX: number; scaleY: number; rotation: number; skew?: number; perspective?: [number, number]; warp?: { points: [number, number][]; style: { style: string } | null } };

/** The open photo's first layer's place as the editor has it now (a Free Transform session isn't saved until it ends). */
const livePlace = (page: Page) =>
  page.evaluate(() => (window as unknown as { photoDebug: { photo: { getState(): { history: { doc: { doc: { layers: { transform: unknown }[] } } } } } } }).photoDebug.photo.getState().history.doc.doc.layers[0].transform as Placed);

/** A handle's centre on the page. */
async function handleAt(page: Page, which: string) {
  const b = (await page.locator(`[data-handle="${which}"]`).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Drags from a page point by (dx, dy) in steps, with keys held. */
async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number, keys: string[] = []) {
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
  for (const k of keys.reverse()) await page.keyboard.up(k);
}

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test("Free Transform (⌘T): ⌘-drag distorts a corner, Escape puts it back; Perspective, committed by Enter in one step, is drawn in perspective", async ({ page }) => {
  const id = await openNewPhoto(page, "Distorted");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0]?.transform).toBeTruthy();
  const half: Placed = { x: 800, y: 600, scaleX: 0.5, scaleY: 0.5, rotation: 0 };
  await page.evaluate((t) => {
    const { photo } = (window as unknown as DebugWindow).photoDebug;
    photo.getState().commit((d) => ({ ...d, layers: d.layers.map((l) => ({ ...l, transform: t })) }));
  }, half);
  await page.locator("[data-layer]").first().click();
  // The picture upright at 50% around its centre: what perspective must show, point for point.
  const around = { zoom: 1, x: 650, y: 450, width: 300, height: 300 };
  const upright = await renderRegion(page, around);

  await page.keyboard.press("ControlOrMeta+t");
  await expect(page.locator('[data-tool-options="move"]')).toHaveAttribute("data-free-transform", "scale");
  await dragBy(page, await handleAt(page, "1,0"), 60, -40, [MOD]);
  expect((await livePlace(page)).perspective).toBeDefined();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-tool-options="move"]')).not.toHaveAttribute("data-free-transform", /.*/);
  expect(await livePlace(page)).toEqual(half);

  // Perspective from the options bar: the top-right corner pulled up pulls the bottom-right down; Enter commits.
  await page.locator('[data-transform-mode="perspective"]').click();
  await expect(page.locator('[data-tool-options="move"]')).toHaveAttribute("data-free-transform", "perspective");
  await dragBy(page, await handleAt(page, "1,0"), 0, -50);
  await page.keyboard.press("Enter");
  const t = await expect.poll(async () => (await savedPhoto(page, id)).layers[0].transform.perspective).toBeDefined().then(async () => (await savedPhoto(page, id)).layers[0].transform as Placed);
  const [tl, tr, br, bl] = quadOf(t, { width: 1600, height: 1200 });
  expect(tl.x).toBeCloseTo(400, 3);
  expect(tl.y).toBeCloseTo(300, 3);
  expect(bl.y).toBeCloseTo(900, 3);
  expect(tr.y).toBeLessThan(290);
  expect(tr.y + br.y).toBeCloseTo(1200, 3);

  // Drawn in perspective: just above the new top edge is empty, just under it is the picture (at both ends); and
  // each point near the middle shows the picture's pixel the layer's map takes there.
  const topEdgeAt = (x: number) => tl.y + ((tr.y - tl.y) * (x - tl.x)) / (tr.x - tl.x);
  const alphaAt = async (x: number, y: number) => (await renderRegion(page, { zoom: 1, x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 }))[3];
  expect(await alphaAt(1150, topEdgeAt(1150) + 4)).toBeGreaterThan(0.99);
  expect(await alphaAt(1150, topEdgeAt(1150) - 4)).toBeLessThan(0.01);
  expect(await alphaAt(500, topEdgeAt(500) - 4)).toBeLessThan(0.01);
  expect(await alphaAt(500, topEdgeAt(500) + 4)).toBeGreaterThan(0.99);
  const inv = invertHomography(layerProjection(t, { width: 1600, height: 1200 }));
  const shown = await renderRegion(page, { zoom: 1, x: 760, y: 560, width: 80, height: 80 });
  let total = 0;
  let count = 0;
  for (let y = 0; y < 80; y += 8) {
    for (let x = 0; x < 80; x += 8) {
      const u = project(inv, 760 + x + 0.5, 560 + y + 0.5)!;
      // Where that source pixel was drawn upright (the layer at 50% centred on 800, 600), in `around`.
      const ux = Math.round(400 + u.x / 2 - 0.5 - around.x);
      const uy = Math.round(300 + u.y / 2 - 0.5 - around.y);
      for (let c = 0; c < 3; c++) total += Math.abs(shown[(y * 80 + x) * 4 + c] - upright[(uy * around.width + ux) * 4 + c]);
      count += 3;
    }
  }
  expect(total / count).toBeLessThan(0.03);

  // One undo step for the whole session.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0].transform).toEqual(half);
});

test("the assistant puts a layer on four corners and skews one", async ({ page }) => {
  const id = await openNewPhoto(page, "Assisted distort");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const layer = (await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(1).then(() => savedPhoto(page, id))).layers[0];
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill([`call transform_layer {"layer": "${layer.id}", "corners": [[200, 150], [1400, 300], [1350, 1000], [250, 1100]]}`, "call get_photo"].join("\n"));
  await composer.press("Enter");
  await expect(panel).toContainText("get_photo: ok", { timeout: 30_000 });
  const t = await expect.poll(async () => (await savedPhoto(page, id)).layers[0].transform.perspective).toBeDefined().then(async () => (await savedPhoto(page, id)).layers[0].transform as Placed);
  const q = quadOf(t, { width: 1600, height: 1200 });
  [[200, 150], [1400, 300], [1350, 1000], [250, 1100]].forEach(([x, y], i) => {
    expect(q[i].x).toBeCloseTo(x, 3);
    expect(q[i].y).toBeCloseTo(y, 3);
  });
});

test("Warp: a Warp Style from the options bar, drawn point for point as the patch says; a dragged point makes it custom; one undo step each", async ({ page }) => {
  const id = await openNewPhoto(page, "Warped");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0]?.transform).toBeTruthy();
  const half: Placed = { x: 800, y: 600, scaleX: 0.5, scaleY: 0.5, rotation: 0 };
  await page.evaluate((t) => {
    const { photo } = (window as unknown as DebugWindow).photoDebug;
    photo.getState().commit((d) => ({ ...d, layers: d.layers.map((l) => ({ ...l, transform: t })) }));
  }, half);
  await page.locator("[data-layer]").first().click();
  // The picture upright at 50%: what the warp must show, point for point.
  const upright = await renderRegion(page, { zoom: 1, x: 400, y: 300, width: 800, height: 600 });

  // Edit › Transform › Warp, then Arc from the Warp Style menu; Enter commits.
  await page.locator("[data-edit-menu]").click();
  await page.locator("[data-transform-menu]").click();
  await page.locator('[data-transform-mode-item="warp"]').click();
  await expect(page.locator('[data-tool-options="move"]')).toHaveAttribute("data-free-transform", "warp");
  await expect(page.locator("[data-warp-overlay]")).toBeVisible();
  await page.locator("[data-warp-style]").click();
  await page.getByRole("option", { name: "Arc", exact: true }).click();
  await expect(page.locator("[data-warp-point]")).toHaveCount(16);
  await page.keyboard.press("Enter");
  const t = await expect.poll(async () => (await savedPhoto(page, id)).layers[0].transform.warp?.style?.style).toBe("arc").then(async () => (await savedPhoto(page, id)).layers[0].transform as Placed);
  const points = t.warp!.points;

  // Each shown pixel is the picture's pixel the patch takes there; past the bent top edge there's nothing.
  const box = { zoom: 1, x: 500, y: 250, width: 600, height: 500 };
  const shown = await renderRegion(page, box);
  let total = 0;
  let count = 0;
  let outside = 0;
  for (let y = 0; y < box.height; y += 10) {
    for (let x = 0; x < box.width; x += 10) {
      const dx = box.x + x + 0.5;
      const dy = box.y + y + 0.5;
      // Document → its warped own pixels (at 50%, centred on 800, 600) → the source.
      const own = (ex: number, ey: number) => unwarp(points, (ex - 400) / 800, (ey - 300) / 600);
      const n = own(dx, dy);
      const at = (y * box.width + x) * 4;
      if (!n) {
        // Clearly outside (not within the few pixels its edge is resampled over): nothing drawn.
        if ([[-4, -4], [4, -4], [-4, 4], [4, 4]].some(([ox, oy]) => own(dx + ox, dy + oy))) continue;
        outside++;
        expect(shown[at + 3]).toBeLessThan(0.01);
        continue;
      }
      if (n[0] < 0.02 || n[0] > 0.98 || n[1] < 0.02 || n[1] > 0.98) continue;
      const ux = Math.min(799, Math.round(n[0] * 800 - 0.5));
      const uy = Math.min(599, Math.round(n[1] * 600 - 0.5));
      for (let c = 0; c < 3; c++) total += Math.abs(shown[at + c] - upright[(uy * 800 + ux) * 4 + c]);
      count += 3;
    }
  }
  expect(outside).toBeGreaterThan(20);
  expect(count).toBeGreaterThan(1000);
  expect(total / count).toBeLessThan(0.04);

  // A point dragged: a custom warp (its corner's tangents along), committed in one step.
  await page.keyboard.press("ControlOrMeta+t");
  await page.locator('[data-transform-mode="warp"]').click();
  const p = (await page.locator('[data-warp-point="5"]').boundingBox())!;
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  await page.mouse.down();
  await page.mouse.move(p.x + 40, p.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0].transform.warp?.style).toBeNull();
  const custom = (await savedPhoto(page, id)).layers[0].transform as Placed;
  expect(custom.warp!.points[5]).not.toEqual(points[5]);
  expect(custom.warp!.points[0]).toEqual(points[0]);
  // Where the patch takes its middle moved with it.
  expect(warpPoint(custom.warp!.points, 0.33, 0.33)).not.toEqual(warpPoint(points, 0.33, 0.33));

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0].transform.warp?.style?.style).toBe("arc");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0].transform).toEqual(half);
});

test("the assistant warps a layer by a style", async ({ page }) => {
  const id = await openNewPhoto(page, "Assisted warp");
  await openImage(page, PHOTO);
  await expect(page.locator('[data-layer][data-source="ready"]')).toHaveCount(1);
  const layer = (await expect.poll(async () => (await savedPhoto(page, id)).layers.length).toBe(1).then(() => savedPhoto(page, id))).layers[0];
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill([`call transform_layer {"layer": "${layer.id}", "warp": {"style": "flag", "bend": 30}}`, "call get_photo"].join("\n"));
  await composer.press("Enter");
  await expect(panel).toContainText("get_photo: ok", { timeout: 30_000 });
  await expect.poll(async () => (await savedPhoto(page, id)).layers[0].transform.warp?.style).toMatchObject({ style: "flag", bend: 30 });
});
