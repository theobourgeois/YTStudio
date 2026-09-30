/**
 * The music suite. Its tests make their own songs (through the API, then open them), so they don't
 * depend on what the video editor's tests left behind; like those, they run in order and share a
 * server. The audio engine is a stand-in (`server/music/fake-engine.mjs`): nothing is heard, but it
 * keeps time, so what plays can be watched.
 */
import { type Locator, type Page, expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

/** A new song, open in the page. */
async function openNewSong(page: Page, name: string): Promise<string> {
  const response = await page.request.post("/api/projects", { data: { suite: "music", name } });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/p/${id}`);
  await expect(page.locator('[data-suite="music"]')).toBeVisible();
  return id;
}

const savedSong = async (page: Page, id: string) => (await page.request.get(`/api/projects/${id}`)).json();
const row = (page: Page, name: string) => page.locator(`[data-channel-name="${name}"]`);
const step = (page: Page, name: string, n: number) => page.getByRole("button", { name: `${name} step ${n}`, exact: true });
/** A channel's steps as text, from the page. */
const drawn = (page: Page, name: string) =>
  row(page, name)
    .locator("[data-step]")
    .evaluateAll((steps) => steps.map((s) => (s.getAttribute("aria-pressed") === "true" ? "x" : "-")).join(""));
/** The saved steps of the `index`th channel in the first pattern, as the starts of its notes in steps. */
async function savedSteps(page: Page, id: string, index: number): Promise<number[]> {
  const song = await savedSong(page, id);
  return (song.patterns[0].notes[song.channels[index].id] ?? []).map((n: { start: number }) => n.start / 24);
}
async function drag(page: Page, from: Locator, to: Locator, dy = 0) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + dy, { steps: 12 });
  await page.mouse.up();
}

test("makes a beat in the channel rack: the starter kit, steps, undo, and it plays", async ({ page }) => {
  const id = await openNewSong(page, "First beat");
  const rack = page.getByTestId("channel-rack");
  await expect(rack).toContainText("No channels yet");

  // The starter kit is four drums, in FL Studio's order, each a sample in the project's media.
  await rack.getByRole("button", { name: "Add starter kit" }).click();
  await expect(rack.getByRole("listitem")).toHaveCount(4);
  await expect.poll(async () => (await savedSong(page, id)).channels.map((c: { name: string }) => c.name)).toEqual(["Kick", "Clap", "Hat", "Snare"]);
  expect((await savedSong(page, id)).channels.every((c: { sampleId: string | null }) => c.sampleId)).toBe(true);

  // Click steps on; click one again to take it off.
  for (const n of [1, 5, 9, 13, 14]) await step(page, "Kick", n).click();
  await step(page, "Kick", 14).click();
  expect(await drawn(page, "Kick")).toBe("x---x---x---x---");
  await expect.poll(() => savedSteps(page, id, 0)).toEqual([0, 4, 8, 12]);

  // A drag paints a run of steps, as one undo step; a right-click clears one.
  await drag(page, step(page, "Hat", 1), step(page, "Hat", 8));
  expect(await drawn(page, "Hat")).toBe("xxxxxxxx--------");
  await step(page, "Hat", 2).click({ button: "right" });
  expect(await drawn(page, "Hat")).toBe("x-xxxxxx--------");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await drawn(page, "Hat")).toBe("----------------");
  await page.getByRole("button", { name: "Redo" }).click();
  expect(await drawn(page, "Hat")).toBe("xxxxxxxx--------");

  // The channel's menu fills and clears steps.
  await row(page, "Clap").getByTitle("Clap: settings").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fill each 4 steps" }).click();
  expect(await drawn(page, "Clap")).toBe("x---x---x---x---");

  // It plays: the light runs along the steps, and Space stops it.
  const lights = page.locator("[data-playing-step]");
  await page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "Play" }).click();
  await expect(lights).toHaveCount(1);
  const first = Number(await lights.getAttribute("data-playing-step"));
  await expect.poll(async () => Number(await lights.getAttribute("data-playing-step"))).not.toBe(first);
  await page.keyboard.press("Space");
  await expect(lights).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "Play" })).toBeVisible();

  // Everything is saved: the song comes back as it was.
  await expect.poll(() => savedSteps(page, id, 1)).toEqual([0, 4, 8, 12]);
  await page.reload();
  await expect(rack.getByRole("listitem")).toHaveCount(4);
  expect(await drawn(page, "Kick")).toBe("x---x---x---x---");
  expect(await drawn(page, "Hat")).toBe("xxxxxxxx--------");
});

test("sets the tempo, swing, a channel's knobs and settings, and the graph editor's velocities", async ({ page }) => {
  const id = await openNewSong(page, "Knobs");
  await page.getByRole("button", { name: "Add starter kit" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(4);

  const tempo = page.getByRole("textbox", { name: "Tempo" });
  await tempo.fill("140");
  await tempo.press("Enter");
  await expect(page.locator(`[data-project-id="${id}"]`)).toContainText("140 BPM");
  await tempo.press("ArrowUp");
  await expect.poll(async () => (await savedSong(page, id)).settings.tempo).toBe(141);

  // A knob is dragged up and down; a double-click puts it back. One drag is one undo step.
  const volume = row(page, "Kick").getByRole("slider", { name: "Volume" });
  await expect(volume).toHaveAttribute("aria-valuetext", "78%");
  await drag(page, volume, volume, 60);
  const lowered = Number(await volume.getAttribute("aria-valuenow"));
  expect(lowered).toBeLessThan(0.5);
  await expect.poll(async () => (await savedSong(page, id)).channels[0].volume).toBeCloseTo(lowered, 5);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(volume).toHaveAttribute("aria-valuetext", "78%");
  await row(page, "Kick").getByRole("slider", { name: "Pan" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await savedSong(page, id)).channels[0].pan).toBeLessThan(0);
  const swing = page.getByRole("slider", { name: "Swing" });
  await swing.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await savedSong(page, id)).settings.swing).toBeCloseTo(0.1, 5);

  // Mute is the green light.
  await row(page, "Clap").getByRole("button", { name: "Mute Clap" }).click();
  await expect(row(page, "Clap").getByRole("button", { name: "Unmute Clap" })).toBeVisible();

  // The channel's button opens its settings: name, pitch, envelope.
  await row(page, "Snare").getByTitle("Snare: settings").click();
  const settings = page.getByTestId("channel-settings");
  await settings.getByLabel("Name").fill("Rim");
  await settings.getByLabel("Name").press("Enter");
  await expect(row(page, "Rim")).toBeVisible();
  await settings.getByRole("switch").click();
  await expect(settings).toContainText("A note sounds for its own length");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await savedSong(page, id)).channels[3]).toMatchObject({ name: "Rim", envelope: { enabled: true } });

  // The graph editor: a bar per step of the selected channel, dragged to set its velocity.
  await step(page, "Hat", 1).click();
  await step(page, "Hat", 3).click();
  await page.getByRole("button", { name: "Graph editor" }).click();
  const graph = page.getByTestId("graph-editor");
  await expect(graph).toContainText("Hat");
  const bar = graph.locator('[data-step="2"]');
  await expect(bar).toHaveAttribute("data-level", "78");
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.75);
  await expect.poll(async () => Number(await bar.getAttribute("data-level"))).toBeLessThan(35);
  await expect
    .poll(async () => {
      const song = await savedSong(page, id);
      return (song.patterns[0].notes[song.channels[2].id] ?? []).map((n: { velocity: number }) => n.velocity < 0.5);
    })
    .toEqual([false, true]);
});

test("keeps patterns apart, and a pattern's length", async ({ page }) => {
  const id = await openNewSong(page, "Patterns");
  await page.getByRole("button", { name: "Add starter kit" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(4);
  await step(page, "Kick", 1).click();

  // A new pattern is empty and shown; the first keeps its steps.
  await page.getByRole("button", { name: "Pattern", exact: true }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByLabel("Pattern name").fill("Fill");
  await page.getByLabel("Pattern name").press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Pattern", exact: true })).toContainText("Fill");
  expect(await drawn(page, "Kick")).toBe("----------------");
  await step(page, "Kick", 16).click();

  // Two bars: twice the steps.
  await page.getByRole("combobox", { name: "Pattern length" }).click();
  await page.getByRole("option", { name: "2 bars" }).click();
  await expect(row(page, "Kick").locator("[data-step]")).toHaveCount(32);
  await expect
    .poll(async () => (await savedSong(page, id)).patterns.map((p: { name: string; steps: number }) => [p.name, p.steps]))
    .toEqual([
      ["Pattern 1", 16],
      ["Fill", 32],
    ]);

  await page.getByRole("button", { name: "Pattern", exact: true }).click();
  await page.getByRole("option", { name: "Pattern 1" }).click();
  await page.keyboard.press("Escape");
  expect(await drawn(page, "Kick")).toBe("x---------------");
});

test("the assistant programs the drums with the music editor's tools", async ({ page }) => {
  const id = await openNewSong(page, "Assisted");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_channel {"kit": "kick"}',
      'call add_channel {"kit": "hat", "name": "Hats"}',
      'call set_steps {"channel": "Kick", "steps": "x--- x--- x--- x---"}',
      'call set_steps {"channel": "Hats", "steps": "--x-"}',
      'call edit_step {"channel": "Hats", "step": 3, "velocity": 0.4}',
      'call update_song {"tempo": 128, "swing": 0.2}',
      'call set_steps {"channel": "Snare", "steps": "x"}',
      "call get_song",
    ].join("\n"),
  );
  await composer.press("Enter");
  // (The fake assistant ends by saying how each call went.)
  await expect(panel).toContainText("update_song: ok, set_steps: failed, get_song: ok", { timeout: 30_000 });
  // The rack shows what it did, live; the one it got wrong says which channels exist.
  expect(await drawn(page, "Kick")).toBe("x---x---x---x---");
  expect(await drawn(page, "Hats")).toBe("--x---x---x---x-");
  await expect(page.getByRole("textbox", { name: "Tempo" })).toHaveValue("128");
  await panel.getByRole("button", { name: /8 steps/ }).click();
  await expect(panel.locator('[data-tool="set_steps"][data-status="error"]')).toHaveCount(1);
  const song = await expect
    .poll(async () => {
      const saved = await savedSong(page, id);
      return saved.settings.tempo === 128 ? saved : null;
    })
    .not.toBeNull()
    .then(() => savedSong(page, id));
  expect(song.settings).toMatchObject({ tempo: 128, swing: 0.2 });
  expect(song.patterns[0].notes[song.channels[1].id][0]).toMatchObject({ start: 48, velocity: 0.4 });
  // Its edits are undo steps like any other.
  await page.locator("header").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("textbox", { name: "Tempo" })).toHaveValue("120");
});

test("audio settings: the device, and the plugin bench", async ({ page }) => {
  await openNewSong(page, "Engine bench");
  await page.getByRole("button", { name: "Audio settings" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Audio engine" })).toBeVisible();

  // The output device and its buffer.
  const device = dialog.getByTestId("device-settings");
  await expect(device).toContainText("5.3 ms of buffer");
  await device.getByRole("combobox", { name: "Buffer size" }).click();
  await page.getByRole("option", { name: "128 samples" }).click();
  await expect(device).toContainText("2.7 ms of buffer");
  await expect(dialog.getByTestId("engine-device")).toContainText("128 samples");

  // No instrument yet: nothing to play.
  const keys = dialog.getByRole("group", { name: "Keys" }).getByRole("button");
  await expect(keys.first()).toBeDisabled();

  // Each slot offers the plugins of its kind.
  await dialog.getByRole("combobox", { name: "Instrument plugin" }).click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option", { name: /Fake Synth/ }).click();
  const instrument = dialog.locator('[data-slot-name="instrument"]');
  await instrument.getByRole("button", { name: "Open window" }).click();
  await expect(instrument.getByRole("button", { name: "Close window" })).toBeVisible();
  await expect(keys.first()).toBeEnabled();

  await expect(instrument.getByRole("button", { name: "Restore" })).toBeDisabled();
  await instrument.getByRole("button", { name: "Save state" }).click();
  await expect(instrument.getByRole("button", { name: "Restore" })).toBeEnabled();

  await instrument.getByRole("button", { name: "Remove" }).click();
  await expect(keys.first()).toBeDisabled();
});
