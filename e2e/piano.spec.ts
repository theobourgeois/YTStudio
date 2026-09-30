/**
 * The music suite's Piano roll (`docs/fl-studio/piano-roll.md`), against the stand-in engine. Like
 * `music.spec.ts`, each test makes its own song. The grid opens at a known view: 0.5 px a tick (a
 * step is 12 px, a bar 192), C7 (pitch 84) at the top, rows 16 px high.
 */
import { type Page, expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const PX_PER_TICK = 0.5;
const TOP_PITCH = 84;
const ROW = 16;
const STEP = 24;

interface SavedNote {
  id: number;
  start: number;
  length: number;
  pitch: number;
  velocity: number;
  pan: number;
  muted: boolean;
}

/** A song with one plugin channel ("Fake Synth"), open, with the Piano roll showing it. */
async function openPiano(page: Page, name: string, notes: Partial<SavedNote>[] = []): Promise<string> {
  const created = await (await page.request.post("/api/projects", { data: { suite: "music", name } })).json();
  const song = await (await page.request.get(`/api/projects/${created.id}`)).json();
  const channel = { id: "chan_synth", name: "Fake Synth", kind: "plugin", plugin: { id: "VST3-Fake Synth-1", name: "Fake Synth", format: "VST3" } };
  const drums = { id: "chan_drums", name: "Drums", kind: "sampler", sampleId: null };
  song.channels = [channel, drums];
  song.patterns[0].notes = notes.length ? { chan_synth: notes.map((n, i) => ({ id: i + 1, length: STEP * 4, pitch: 72, velocity: 0.78, ...n })) } : {};
  await page.request.put(`/api/projects/${created.id}`, { data: song });
  await page.goto(`/p/${created.id}`);
  await expect(page.locator('[role=listitem][data-channel-name="Fake Synth"]')).toBeVisible();
  await page.getByRole("button", { name: "Select Fake Synth" }).click();
  await page.keyboard.press("F7");
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-channel-name", "Fake Synth");
  return created.id;
}

/** Where a tick and a pitch are on the page (the middle of that row, a little into that tick). */
async function at(page: Page, tick: number, pitch: number) {
  const box = (await page.getByTestId("piano-grid").boundingBox())!;
  return { x: box.x + tick * PX_PER_TICK + 2, y: box.y + (TOP_PITCH - pitch) * ROW + ROW / 2 };
}
async function click(page: Page, tick: number, pitch: number, options: Parameters<Page["mouse"]["click"]>[2] = {}) {
  const p = await at(page, tick, pitch);
  await page.mouse.click(p.x, p.y, options);
}
async function drag(page: Page, from: [number, number], to: [number, number], button: "left" | "right" = "left") {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up({ button });
}
/** The channel's notes as saved, as [start, length, pitch]. */
async function saved(page: Page, id: string): Promise<SavedNote[]> {
  const song = await (await page.request.get(`/api/projects/${id}`)).json();
  return song.patterns[0].notes.chan_synth ?? [];
}
const shape = (notes: SavedNote[]) => notes.map((n) => [n.start, n.length, n.pitch]);
const expectNotes = async (page: Page, id: string, expected: number[][]) => expect.poll(async () => shape(await saved(page, id))).toEqual(expected);
const holding = async (page: Page, key: string, action: () => Promise<void>) => {
  await page.keyboard.down(key);
  await action();
  await page.keyboard.up(key);
};

test("draws, moves, copies, resizes and deletes notes with the mouse, as in FL Studio", async ({ page }) => {
  const id = await openPiano(page, "Drawing");

  // A click draws a note at the start of the cell, a beat long (the default).
  await click(page, 5, 72);
  await click(page, 100, 74);
  await expectNotes(page, id, [
    [0, 96, 72],
    [96, 96, 74],
  ]);

  // Drawing and dragging places it: it follows the pointer until it's let go (one edit).
  await drag(page, [200, 76], [290, 79]);
  await expectNotes(page, id, [
    [0, 96, 72],
    [96, 96, 74],
    [288, 96, 79],
  ]);

  // A note is moved by dragging it; its right edge resizes it (and new notes take that length).
  await drag(page, [10, 72], [34, 71]);
  await drag(page, [96 + 90, 74], [96 + 138, 74]);
  await expectNotes(page, id, [
    [24, 96, 71],
    [96, 144, 74],
    [288, 96, 79],
  ]);
  await click(page, 480, 72);
  await expect.poll(async () => (await saved(page, id)).find((n) => n.start === 480)?.length).toBe(144);

  // Shift+drag copies; the copy is selected.
  await holding(page, "Shift", () => drag(page, [300, 79], [300 + 192, 79 + 2]));
  await expect.poll(async () => shape(await saved(page, id)).filter(([, , pitch]) => pitch === 81)).toEqual([[480, 96, 81]]);
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-selected", "1");

  // The right button deletes: a click, or a sweep across several.
  await click(page, 30, 71, { button: "right" });
  await expect.poll(async () => (await saved(page, id)).some((n) => n.pitch === 71)).toBe(false);
  await drag(page, [300, 79], [500, 72], "right");
  await expect.poll(async () => (await saved(page, id)).length).toBeLessThan(4);

  // Each of those was one undo step: undoing brings them back one at a time.
  const before = (await saved(page, id)).length;
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await saved(page, id)).length).toBeGreaterThan(before);
});

test("the tools: paint, delete, mute and slice, by their keys", async ({ page }) => {
  const id = await openPiano(page, "Tools");
  // B: paint lays a note per beat along the stroke.
  await page.keyboard.press("b");
  await drag(page, [0, 72], [370, 72]);
  await expectNotes(page, id, [
    [0, 96, 72],
    [96, 96, 72],
    [192, 96, 72],
    [288, 96, 72],
  ]);
  // C: slice them straight down at a step past the third's start.
  await page.keyboard.press("c");
  await drag(page, [192 + 24, 74], [192 + 24, 70]);
  await expect.poll(async () => shape(await saved(page, id)).filter(([start]) => start >= 192 && start < 288)).toEqual([
    [192, 24, 72],
    [216, 72, 72],
  ]);
  // T: mute; D: delete.
  await page.keyboard.press("t");
  await click(page, 10, 72);
  await expect.poll(async () => (await saved(page, id))[0].muted).toBe(true);
  await page.keyboard.press("d");
  await click(page, 100, 72);
  await expect.poll(async () => (await saved(page, id)).length).toBe(4);
  // E: select, by dragging a rectangle.
  await page.keyboard.press("e");
  await drag(page, [190, 75], [400, 70]);
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-selected", "3");
  await page.keyboard.press("p");
});

test("selects and edits with FL Studio's keys: Ctrl+B repeats, arrows move, quantize, glue, chop", async ({ page }) => {
  const id = await openPiano(page, "Keys", [
    { start: 0, pitch: 72 },
    { start: 96, pitch: 76 },
    { start: 192, pitch: 79 },
  ]);
  const roll = page.getByTestId("piano-roll");

  // Ctrl+B with nothing selected: all of it, the bar it's in repeated after it; the copies are selected.
  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(async () => (await saved(page, id)).map((n) => n.start)).toEqual([0, 96, 192, 384, 480, 576]);
  await expect(roll).toHaveAttribute("data-selected", "3");
  // Again: the copies of the copies, a bar further.
  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(async () => (await saved(page, id)).length).toBe(9);
  await expect.poll(async () => Math.max(...(await saved(page, id)).map((n) => n.start))).toBe(768 + 192);

  // Ctrl+drag selects a rectangle; Shift+arrows move it a snap unit (a step at this zoom) and a semitone.
  await page.keyboard.press("ControlOrMeta+d");
  await holding(page, process.platform === "darwin" ? "Meta" : "Control", () => drag(page, [-4, 80], [200, 70]));
  await expect(roll).toHaveAttribute("data-selected", "3");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await expect.poll(async () => shape(await saved(page, id)).slice(0, 3)).toEqual([
    [24, 96, 61],
    [120, 96, 65],
    [216, 96, 68],
  ]);

  // Ctrl+A, Delete, and undo brings them all back.
  await page.keyboard.press("ControlOrMeta+a");
  await expect(roll).toHaveAttribute("data-selected", "9");
  await page.keyboard.press("Delete");
  await expectNotes(page, id, []);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await saved(page, id)).length).toBe(9);

  // Copy and paste: pasted at the first bar in view, and selected.
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("Shift+i");
  await expect(roll).toHaveAttribute("data-selected", "9");
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => (await saved(page, id)).length).toBe(18);
  await page.keyboard.press("ControlOrMeta+z");

  // Quantize: notes nudged off the grid by a tick (Alt+arrow) go back onto it.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Alt+ArrowRight");
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(async () => (await saved(page, id))[0].start).toBe(26);
  await page.keyboard.press("ControlOrMeta+q");
  await expect.poll(async () => (await saved(page, id))[0].start).toBe(24);

  // Chop (Ctrl+U) cuts every selected note into steps; glue (Ctrl+G) joins them back.
  await page.keyboard.press("ControlOrMeta+d");
  await holding(page, process.platform === "darwin" ? "Meta" : "Control", () => click(page, 30, 61));
  await expect(roll).toHaveAttribute("data-selected", "1");
  await page.keyboard.press("ControlOrMeta+u");
  await expect.poll(async () => (await saved(page, id)).filter((n) => n.pitch === 61).map((n) => n.length)).toEqual([24, 24, 24, 24]);
  await expect(roll).toHaveAttribute("data-selected", "4");
  await page.keyboard.press("ControlOrMeta+g");
  await expect.poll(async () => (await saved(page, id)).filter((n) => n.pitch === 61).map((n) => n.length)).toEqual([96]);

  // Alt+M mutes the selection; Alt+Shift+M unmutes it.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Alt+m");
  await expect.poll(async () => (await saved(page, id)).every((n) => n.muted)).toBe(true);
  await page.keyboard.press("Alt+Shift+m");
  await expect.poll(async () => (await saved(page, id)).some((n) => n.muted)).toBe(false);
});

test("the ruler: a click sets where play starts; a double-click drag selects time, which is what loops and what Ctrl+B repeats by", async ({ page }) => {
  await openPiano(page, "Time", [
    { start: 0, pitch: 72 },
    { start: 96, pitch: 74 },
    { start: 480, pitch: 76 },
  ]);
  const roll = page.getByTestId("piano-roll");
  const ruler = (await page.getByLabel("Ruler").boundingBox())!;
  const x = (tick: number) => ruler.x + tick * PX_PER_TICK;
  const y = ruler.y + ruler.height / 2;
  // The whole pattern loops: two bars.
  await expect(roll).toHaveAttribute("data-loop", "0:768");

  await page.mouse.click(x(192), y);
  await expect(roll).toHaveAttribute("data-start", "192");

  // A double-click and drag along the ruler: the time from beat 1 to beat 2 (snapped), and the note in it.
  await page.mouse.move(x(0), y);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.move(x(190), y, { steps: 6 });
  await page.mouse.up();
  await expect(roll).toHaveAttribute("data-loop", "0:192");
  await expect(roll).toHaveAttribute("data-selected", "2");

  // Ctrl+B repeats by the time selection's length, and the time selection moves with the copies.
  await page.keyboard.press("ControlOrMeta+b");
  await expect(roll).toHaveAttribute("data-loop", "192:192");
  await expect(roll).toHaveAttribute("data-selected", "2");
  // Ctrl+→ moves it along by its own length, selecting what's there.
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await expect(roll).toHaveAttribute("data-loop", "384:192");
  await expect(roll).toHaveAttribute("data-selected", "1");
  // A right-click on the ruler clears it: the whole pattern loops again.
  await page.mouse.click(x(100), y, { button: "right" });
  await expect(roll).toHaveAttribute("data-loop", /^0:/);
});

test("the window fills the desktop, resizes and snaps; the ruler moves a playing song; a click away deselects; each tool has its pointer", async ({ page }) => {
  const id = await openPiano(page, "Window", [{ start: 0, pitch: 72 }]);
  const roll = page.getByTestId("piano-roll");
  const win = page.locator('[data-window="piano"]');
  const desktop = (await page.locator("[data-desktop]").boundingBox())!;

  // It opens filling the desktop; a double-click on its title makes it a window, and another fills again.
  await expect(win).toHaveAttribute("data-snap", "full");
  expect((await win.boundingBox())!.width).toBeCloseTo(desktop.width, 0);
  const title = win.locator("[data-window-title]");
  await title.dblclick({ position: { x: 200, y: 10 } });
  await expect(win).not.toHaveAttribute("data-snap");
  const floating = (await win.boundingBox())!;
  expect(floating.width).toBeLessThan(desktop.width - 100);

  // Its right edge resizes it.
  const edge = (await win.locator('[data-resize="e"]').boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 - 120, edge.y + edge.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await win.boundingBox())!.width - floating.width)).toBe(-120);

  // Dragged to the desktop's top, it fills it again; to its left side, half of it.
  const grab = (await title.boundingBox())!;
  await page.mouse.move(grab.x + 200, grab.y + 10);
  await page.mouse.down();
  await page.mouse.move(desktop.x + 400, desktop.y + 150, { steps: 4 });
  await page.mouse.move(desktop.x + 1, desktop.y + 300, { steps: 4 });
  await expect(page.getByTestId("snap-preview")).toBeVisible();
  await page.mouse.up();
  await expect(win).toHaveAttribute("data-snap", "left");
  await win.getByRole("button", { name: /^Maximise/ }).click();
  await expect(win).toHaveAttribute("data-snap", "full");

  // Each tool has its pointer; the right button's is the eraser while it sweeps.
  const grid = page.getByTestId("piano-grid").locator("canvas");
  const cursor = () => grid.evaluate((el) => (el as HTMLElement).style.cursor);
  const empty = await at(page, 600, 60);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.move(empty.x + 3, empty.y);
  const pencil = await cursor();
  expect(pencil).toContain("svg");
  await page.keyboard.press("c");
  await expect.poll(cursor).not.toBe(pencil);
  const knife = await cursor();
  await page.keyboard.press("y");
  await expect.poll(cursor).not.toBe(knife);
  await page.keyboard.press("p");
  await expect.poll(cursor).toBe(pencil);
  await page.mouse.down({ button: "right" });
  expect(await cursor()).not.toBe(pencil);
  await page.mouse.up({ button: "right" });
  const onNote = await at(page, 40, 72);
  await page.mouse.move(onNote.x, onNote.y);
  await expect.poll(cursor).toBe("grab");

  // A note past the pattern's end takes the pattern to the end of that note's bar.
  await expect(roll).toHaveAttribute("data-loop", "0:384");
  await click(page, 900, 70);
  await expect(roll).toHaveAttribute("data-loop", "0:1152");

  // With notes selected, a click on nothing deselects them, and adds nothing.
  await page.keyboard.press("ControlOrMeta+a");
  await expect(roll).toHaveAttribute("data-selected", "2");
  await click(page, 600, 60);
  await expect(roll).toHaveAttribute("data-selected", "0");
  await expect.poll(async () => (await saved(page, id)).length).toBe(2);

  // A double-click on the ruler, without dragging, clears the time selection.
  const ruler = (await page.getByLabel("Ruler").boundingBox())!;
  const rx = (tick: number) => ruler.x + tick * PX_PER_TICK;
  const ry = ruler.y + ruler.height / 2;
  await holding(page, "ControlOrMeta", async () => {
    await page.mouse.move(rx(0), ry);
    await page.mouse.down();
    await page.mouse.move(rx(380), ry, { steps: 5 });
    await page.mouse.up();
  });
  await expect(roll).toHaveAttribute("data-loop", "0:384");
  await page.mouse.dblclick(rx(100), ry);
  await expect(roll).toHaveAttribute("data-loop", "0:1152");

  // While it plays, a click on the ruler takes it there at once.
  await page.getByRole("button", { name: "Play", exact: true }).click();
  // Lit once the engine plays (Stop is always there, as in FL Studio).
  await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(rx(768), ry);
  await expect(roll).toHaveAttribute("data-start", "768");
  const status = await (await page.request.post("/api/engine/status", { data: {} })).json();
  expect(status.transport.tick).toBeGreaterThanOrEqual(768);
  expect(status.transport.tick).toBeLessThan(900);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("the event editor, note properties, ghost notes and the target channel", async ({ page }) => {
  const id = await openPiano(page, "Lane", [
    { start: 0, pitch: 72 },
    { start: 96, pitch: 74 },
    { start: 192, pitch: 76 },
  ]);
  const lane = (await page.getByLabel("Event editor").boundingBox())!;
  // Drawn across the velocity lane from high to low.
  await page.mouse.move(lane.x + 2, lane.y + 8);
  await page.mouse.down();
  await page.mouse.move(lane.x + 96 * PX_PER_TICK + 2, lane.y + lane.height / 2, { steps: 4 });
  await page.mouse.move(lane.x + 192 * PX_PER_TICK + 2, lane.y + lane.height - 10, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const [a, b, c] = (await saved(page, id)).map((n) => n.velocity);
      return a > 0.85 && b > 0.35 && b < 0.6 && c < 0.15;
    })
    .toBe(true);

  // A double-click on a note: its properties.
  await click(page, 100, 74, { clickCount: 2 });
  const dialog = page.locator('[data-window="note"]');
  await expect(dialog.getByRole("heading")).toContainText("D6");
  await dialog.getByLabel("Start time").fill("2:01:00");
  await dialog.getByLabel("Duration").fill("0:02:00");
  await dialog.getByRole("button", { name: "Accept" }).click();
  await expect.poll(async () => shape(await saved(page, id))).toContainEqual([384, 48, 74]);

  // The other channels' notes show behind (Alt+V); K and G move between channels.
  await page.keyboard.press("k");
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-channel-name", "Drums");
  await page.keyboard.press("g");
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-channel-name", "Fake Synth");
  await page.getByRole("button", { name: "Target channel" }).click();
  await page.getByRole("menuitemradio", { name: "Drums" }).click();
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-channel-name", "Drums");

  // A channel with notes that aren't steps shows them as a picture in the rack; a click opens them.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("piano-roll")).toHaveCount(0);
  await page.locator('[data-notes-preview="chan_synth"]').click();
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-channel-name", "Fake Synth");
});

test("stays quick with thousands of notes: drawing, selecting, dragging and duplicating", async ({ page }) => {
  // 4000 notes over 32 bars, on the keys in view.
  const notes = Array.from({ length: 4000 }, (_, i) => ({ start: (i % 1000) * 12, length: 24 + (i % 3) * 24, pitch: 62 + ((i * 7) % 20) }));
  const id = await openPiano(page, "Dense", notes);
  const grid = page.getByTestId("piano-grid");
  await expect(grid).toHaveAttribute("data-notes", "4000");
  const drawMs = async () => Number(await grid.getAttribute("data-draw-ms"));
  const started = Date.now();

  // Select all, then drag the lot: every frame of the drag redraws 4000 moved notes.
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-selected", "4000");
  const first = (await saved(page, id))[0];
  const p = await at(page, first.start + 4, first.pitch);
  const frames: number[] = [];
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(p.x + i * 3, p.y - i, { steps: 1 });
    frames.push(await drawMs());
  }
  await page.mouse.up();
  expect(Math.max(...frames)).toBeLessThan(40);
  await expect.poll(async () => (await saved(page, id))[0].pitch).not.toBe(first.pitch);

  // Duplicate all 4000, and undo it.
  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(async () => (await saved(page, id)).length, { timeout: 10_000 }).toBe(8000);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await saved(page, id)).length, { timeout: 10_000 }).toBe(4000);

  // Zoomed all the way out, every note in view at once.
  await page.keyboard.press("Shift+4");
  await page.waitForTimeout(150);
  expect(await drawMs()).toBeLessThan(40);
  expect(Date.now() - started).toBeLessThan(15_000);
});

test("Ctrl (⌘) + middle-button drag zooms the keys, as does a middle-button drag on the keyboard", async ({ page }) => {
  await openPiano(page, "Zoom", [{ start: 0, pitch: 72 }]);
  const roll = page.getByTestId("piano-roll");
  await expect(roll).toHaveAttribute("data-row-height", String(ROW));
  const middleDrag = async (box: { x: number; y: number; width: number; height: number }, dy: number, modifier?: string) => {
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dy, { steps: 6 });
    await page.mouse.up({ button: "middle" });
    if (modifier) await page.keyboard.up(modifier);
  };
  const grid = (await page.getByTestId("piano-grid").boundingBox())!;
  // Up: taller keys; down: shorter.
  await middleDrag(grid, -120, "ControlOrMeta");
  await expect(roll).toHaveAttribute("data-row-height", String(ROW * 2));
  await middleDrag(grid, 120, "ControlOrMeta");
  await expect(roll).toHaveAttribute("data-row-height", String(ROW));
  // Without the key, the middle button pans rather than zooms.
  await middleDrag(grid, -60);
  await expect(roll).toHaveAttribute("data-row-height", String(ROW));
  const keys = (await page.getByRole("img", { name: "Keyboard" }).or(page.locator('canvas[aria-label="Keyboard"]')).first().boundingBox())!;
  await middleDrag(keys, 120);
  await expect(roll).toHaveAttribute("data-row-height", String(ROW / 2));
});
