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
/** A channel's row in the rack (its mute light, knobs, button and selector). */
const row = (page: Page, name: string) => page.locator(`[role=listitem][data-channel-name="${name}"]`);
const channelButton = (page: Page, name: string) => row(page, name).locator("button[aria-expanded]");
const step = (page: Page, name: string, n: number) => page.getByRole("button", { name: `${name} step ${n}`, exact: true });
/** A channel's steps as text, from the page. */
const drawn = (page: Page, name: string) =>
  page
    // By its label, not its role: while a menu closes, the rest of the page is hidden from roles for a moment.
    .locator(`[aria-label="${name} steps"]`)
    .locator("[data-step]")
    .evaluateAll((steps) => steps.map((s) => (s.getAttribute("aria-pressed") === "true" ? "x" : "-")).join(""));
/** The saved steps of the `index`th channel in the first pattern, as the starts of its notes in steps. */
async function savedSteps(page: Page, id: string, index: number): Promise<number[]> {
  const song = await savedSong(page, id);
  return (song.patterns[0].notes[song.channels[index].id] ?? []).map((n: { start: number }) => n.start / 24);
}
async function drag(page: Page, from: Locator, to: Locator, { dx = 0, dy = 0, button = "left" as "left" | "right" } = {}) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down({ button });
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 12 });
  await page.mouse.up({ button });
}
const muted = (page: Page) =>
  page.locator("[role=listitem][data-channel]").evaluateAll((rows) => rows.map((r) => (r.querySelector("button")!.getAttribute("aria-pressed") === "false" ? "M" : "-")).join(""));
const rackOrder = (page: Page) => page.locator("[role=listitem][data-channel]").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-channel-name")));

/** The rack's menu → Add starter kit: four drums. */
async function addStarterKit(page: Page) {
  await page.getByRole("button", { name: "Channel rack menu" }).click();
  await page.getByRole("menuitem", { name: "Add starter kit" }).click();
}

test("makes a beat in the channel rack as in FL Studio: left turns steps on, right turns them off", async ({ page }) => {
  const id = await openNewSong(page, "First beat");
  const rack = page.getByTestId("channel-rack");
  // A new song's rack isn't empty: it has a sampler, as FL Studio's does, which the first channels added replace.
  await expect(rack.getByRole("listitem")).toHaveCount(1);
  await expect(rack).toContainText("Sampler");

  // The starter kit is four drums, in FL Studio's order, each a sample in the project's media.
  await addStarterKit(page);
  await expect(rack.getByRole("listitem")).toHaveCount(4);
  await expect.poll(async () => (await savedSong(page, id)).channels.map((c: { name: string }) => c.name)).toEqual(["Kick", "Clap", "Hat", "Snare"]);
  expect((await savedSong(page, id)).channels.every((c: { sampleId: string | null }) => c.sampleId)).toBe(true);

  // A left-click turns a step on, and does nothing to one that's on already; a right-click turns it off.
  for (const n of [1, 5, 9, 13, 14]) await step(page, "Kick", n).click();
  await step(page, "Kick", 5).click();
  expect(await drawn(page, "Kick")).toBe("x---x---x---xx--");
  await step(page, "Kick", 14).click({ button: "right" });
  expect(await drawn(page, "Kick")).toBe("x---x---x---x---");
  await expect.poll(() => savedSteps(page, id, 0)).toEqual([0, 4, 8, 12]);

  // Dragging paints with the left button and erases with the right, each as one undo step.
  await drag(page, step(page, "Hat", 1), step(page, "Hat", 12));
  expect(await drawn(page, "Hat")).toBe("xxxxxxxxxxxx----");
  await drag(page, step(page, "Hat", 5), step(page, "Hat", 8), { button: "right" });
  expect(await drawn(page, "Hat")).toBe("xxxx----xxxx----");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await drawn(page, "Hat")).toBe("xxxxxxxxxxxx----");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await drawn(page, "Hat")).toBe("----------------");
  await page.locator("header").getByRole("button", { name: "Redo" }).click();
  expect(await drawn(page, "Hat")).toBe("xxxxxxxxxxxx----");

  // The channel's menu fills, rotates, copies and pastes its steps.
  await channelButton(page, "Clap").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fill each 4 steps" }).click();
  expect(await drawn(page, "Clap")).toBe("x---x---x---x---");
  await channelButton(page, "Clap").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rotate right" }).click();
  expect(await drawn(page, "Clap")).toBe("-x---x---x---x--");
  await channelButton(page, "Clap").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy", exact: true }).click();
  await channelButton(page, "Snare").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paste" }).click();
  expect(await drawn(page, "Snare")).toBe("-x---x---x---x--");

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
  await expect.poll(() => savedSteps(page, id, 3)).toEqual([1, 5, 9, 13]);
  await page.reload();
  await expect(rack.getByRole("listitem")).toHaveCount(4);
  expect(await drawn(page, "Kick")).toBe("x---x---x---x---");
  expect(await drawn(page, "Hat")).toBe("xxxxxxxxxxxx----");
});

test("a pattern is as long as its notes: the rack is dragged wider to reach further steps", async ({ page }) => {
  const id = await openNewSong(page, "Length");
  await addStarterKit(page);
  await expect(page.getByRole("listitem")).toHaveCount(4);
  const length = page.getByRole("spinbutton", { name: /Pattern length/ });
  await expect(length).toHaveAttribute("aria-valuenow", "16");
  expect(await drawn(page, "Kick")).toHaveLength(16);

  // Dragging the rack's right edge shows more steps; the pattern is still a bar until one is used.
  const edge = page.getByRole("separator", { name: "Drag to show more steps" });
  await drag(page, edge, edge, { dx: 16 * 17 }); // 16 steps of 17 px (a step, its gap, a quarter of a beat's)
  expect(await drawn(page, "Kick")).toHaveLength(32);
  await expect(length).toHaveAttribute("aria-valuenow", "16");
  await step(page, "Kick", 1).click();
  await step(page, "Clap", 21).click();
  await expect(length).toHaveAttribute("aria-valuenow", "32");
  await expect.poll(async () => (await savedSong(page, id)).patterns[0]).toMatchObject({ length: null });

  // Its menu sets a length: longer than the notes, it's that; shorter, the notes past it still play
  // (as in FL Studio), so it reaches the end of their bar. Auto brings the length back.
  await length.click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "4 bars" }).click();
  await expect(length).toHaveAttribute("aria-valuenow", "64");
  await expect.poll(async () => (await savedSong(page, id)).patterns[0].length).toBe(64);
  await length.click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "1 bar" }).click();
  await expect.poll(async () => (await savedSong(page, id)).patterns[0].length).toBe(16);
  await expect(length).toHaveAttribute("aria-valuenow", "32");
  expect((await drawn(page, "Clap"))[20]).toBe("x");
  await length.click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Auto" }).click();
  await expect(length).toHaveAttribute("aria-valuenow", "32");

  // Patterns are apart: a new one (+, named) is empty, and a bar long.
  const pattern = page.getByRole("spinbutton", { name: "Pattern", exact: true });
  await page.getByRole("button", { name: "New pattern" }).click();
  await page.getByLabel("New pattern's name").fill("Fill");
  await page.getByLabel("New pattern's name").press("Enter");
  await expect(pattern).toContainText("Fill");
  await expect(length).toHaveAttribute("aria-valuenow", "16");
  expect((await drawn(page, "Kick")).includes("x")).toBe(false);
  await page.getByRole("button", { name: "Patterns", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.getByRole("option", { name: "Pattern 1" }).click();
  await page.keyboard.press("Escape");
  expect((await drawn(page, "Kick"))[0]).toBe("x");

  // Scrolled up past the last pattern: the next one, which joins the song only once it has a step.
  await pattern.hover();
  await page.mouse.wheel(0, -100);
  await expect(pattern).toContainText("Fill");
  await page.mouse.wheel(0, -100);
  await expect(pattern).toContainText("Pattern 3");
  expect((await drawn(page, "Kick")).includes("x")).toBe(false);
  await page.mouse.wheel(0, 100);
  await expect(pattern).toContainText("Fill");
  expect((await savedSong(page, id)).patterns).toHaveLength(2);
  await page.mouse.wheel(0, -100);
  await expect(pattern).toContainText("Pattern 3");
  await step(page, "Snare", 1).click();
  await expect.poll(async () => (await savedSong(page, id)).patterns.map((p: { name: string }) => p.name)).toEqual(["Pattern 1", "Fill", "Pattern 3"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedSong(page, id)).patterns).toHaveLength(2);
  await expect(pattern).toContainText("Pattern 3");
});

test("mutes and solos, selects, reorders, clones and deletes channels, by mouse and by FL Studio's keys", async ({ page }) => {
  const id = await openNewSong(page, "Channels");
  await addStarterKit(page);
  await expect(page.getByRole("listitem")).toHaveCount(4);

  // The green light mutes; its right-click menu solos (again: everything back on).
  await row(page, "Clap").getByRole("button", { name: "Mute Clap" }).click();
  expect(await muted(page)).toBe("-M--");
  await row(page, "Hat").getByRole("button", { name: "Mute Hat" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Solo" }).click();
  expect(await muted(page)).toBe("MM-M");
  await row(page, "Hat").getByRole("button", { name: "Mute Hat" }).click({ modifiers: ["Alt"] });
  expect(await muted(page)).toBe("----");
  // 1…0 mute the first ten channels.
  await page.keyboard.press("2");
  await page.keyboard.press("4");
  expect(await muted(page)).toBe("-M-M");
  await page.keyboard.press("2");
  await page.keyboard.press("4");

  // The selector: a click selects one, a right-click adds, a double-click selects all.
  const selected = () => page.locator("[data-selector][aria-pressed=true]").count();
  await page.getByRole("button", { name: "Select Hat" }).click();
  expect(await selected()).toBe(1);
  await page.getByRole("button", { name: "Select Kick" }).click({ button: "right" });
  expect(await selected()).toBe(2);
  await page.getByRole("button", { name: "Select Snare" }).dblclick();
  expect(await selected()).toBe(4);
  await page.getByRole("button", { name: "Select Hat" }).click();
  expect(await selected()).toBe(1);

  // Shift+click selects everything from the last one clicked; so does dragging along the selectors.
  await page.getByRole("button", { name: "Select Kick" }).click();
  await page.getByRole("button", { name: "Select Hat" }).click({ modifiers: ["Shift"] });
  expect(await selected()).toBe(3);
  await page.getByRole("button", { name: "Select Snare" }).click();
  expect(await selected()).toBe(1);
  await drag(page, page.getByRole("button", { name: "Select Clap" }), page.getByRole("button", { name: "Select Snare" }));
  expect(await selected()).toBe(3);
  await expect(page.getByRole("button", { name: "Select Kick" })).toHaveAttribute("aria-pressed", "false");

  // Several at once are deleted together, and come back together with one undo.
  await page.keyboard.press("Alt+Backspace");
  expect(await rackOrder(page)).toEqual(["Kick"]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await rackOrder(page)).toEqual(["Kick", "Clap", "Hat", "Snare"]);

  // The rack's keys work whatever has the focus: here its menu's button, which would open on an arrow.
  await page.getByRole("button", { name: "Select Hat" }).click();
  await page.getByRole("button", { name: "Channel rack menu" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await rackOrder(page)).toEqual(["Kick", "Clap", "Snare", "Hat"]);
  await page.keyboard.press("Alt+ArrowUp");
  expect(await rackOrder(page)).toEqual(["Kick", "Clap", "Hat", "Snare"]);

  // Alt+arrows move the selected channel, the arrows move the selection, Alt+C clones, Alt+Del deletes.
  await page.keyboard.press("Alt+ArrowUp");
  expect(await rackOrder(page)).toEqual(["Kick", "Hat", "Clap", "Snare"]);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Select Clap" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Alt+ArrowDown");
  expect(await rackOrder(page)).toEqual(["Kick", "Hat", "Snare", "Clap"]);
  await page.keyboard.press("Alt+KeyC");
  expect(await rackOrder(page)).toEqual(["Kick", "Hat", "Snare", "Clap", "Clap"]);
  await page.keyboard.press("Alt+Backspace");
  expect(await rackOrder(page)).toEqual(["Kick", "Hat", "Snare", "Clap"]);
  await expect.poll(async () => (await savedSong(page, id)).channels.map((c: { name: string }) => c.name)).toEqual(["Kick", "Hat", "Snare", "Clap"]);

  // A file dropped on a channel's button replaces its sample; dropped elsewhere on the rack, it's a new channel.
  const drop = async (target: Locator, name: string) => {
    const data = await page.evaluateHandle(async (fileName) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([await (await fetch("/kit/hat.wav")).blob()], fileName, { type: "audio/wav" }));
      return transfer;
    }, name);
    await target.dispatchEvent("dragover", { dataTransfer: data });
    await target.dispatchEvent("drop", { dataTransfer: data });
  };
  await drop(channelButton(page, "Snare"), "Rim shot.wav");
  await expect(row(page, "Rim shot")).toBeVisible();
  expect(await rackOrder(page)).toEqual(["Kick", "Hat", "Rim shot", "Clap"]);
  await drop(page.getByTestId("channel-rack"), "Shaker.wav");
  await expect(page.getByRole("listitem")).toHaveCount(5);
  expect((await rackOrder(page))[4]).toBe("Shaker");
});

test("the rack's + adds an instrument: a plugin of this computer's, or a sampler", async ({ page }) => {
  const id = await openNewSong(page, "Plugins");
  const rack = page.getByTestId("channel-rack");

  // The picker lists the Sampler and the instrument plugins found (not the effects), and narrows as you type.
  await rack.getByRole("button", { name: "Add a channel" }).click();
  const picker = page.getByTestId("channel-picker");
  await expect(picker.getByRole("option")).toHaveText([/Sampler/, /Fake Synth/]);
  await picker.getByRole("textbox").fill("synth");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await picker.getByRole("option", { name: /Fake Synth/ }).click();
  await expect(row(page, "Fake Synth")).toBeVisible();
  await expect.poll(async () => (await savedSong(page, id)).channels[0]).toMatchObject({ kind: "plugin", name: "Fake Synth", plugin: { name: "Fake Synth", format: "VST3" } });

  // Its button shows and hides the plugin's own window (the engine's, not ours); its steps are notes.
  const synth = channelButton(page, "Fake Synth");
  await expect(synth).toHaveAttribute("aria-expanded", "false");
  await synth.click();
  await expect(synth).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("channel-settings")).toHaveCount(0);
  await synth.click();
  await expect(synth).toHaveAttribute("aria-expanded", "false");
  await step(page, "Fake Synth", 1).click();
  expect(await drawn(page, "Fake Synth")).toBe("x---------------");

  // A sampler starts empty, with its settings window open to give it a sample.
  await rack.getByRole("button", { name: "Add a channel" }).click();
  await picker.getByRole("option", { name: /Sampler/ }).click();
  await expect(page.getByTestId("channel-settings")).toHaveAttribute("data-channel-name", "Sampler");
  expect(await rackOrder(page)).toEqual(["Fake Synth", "Sampler"]);

  // Adding a channel is an edit like any other: undo takes it away, redo brings it back.
  await page.keyboard.press("ControlOrMeta+z");
  expect(await rackOrder(page)).toEqual(["Fake Synth"]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await rackOrder(page)).toEqual(["Fake Synth", "Sampler"]);
});

test("knobs work as in FL Studio, and a channel opens its settings window", async ({ page }) => {
  const id = await openNewSong(page, "Knobs");
  await addStarterKit(page);
  await expect(page.getByRole("listitem")).toHaveCount(4);

  const tempo = page.getByRole("textbox", { name: "Tempo" });
  await tempo.fill("140");
  await tempo.press("Enter");
  await expect(page.locator(`[data-project-id="${id}"]`)).toContainText("140 BPM");

  // A knob is dragged up and down (one undo step); Alt+click resets it; its menu resets, copies, pastes and takes a typed value.
  const volume = row(page, "Kick").getByRole("slider", { name: "Volume" });
  await expect(volume).toHaveAttribute("aria-valuetext", "78%");
  await drag(page, volume, volume, { dy: 60 });
  const lowered = Number(await volume.getAttribute("aria-valuenow"));
  expect(lowered).toBeLessThan(0.5);
  await expect.poll(async () => (await savedSong(page, id)).channels[0].volume).toBeCloseTo(lowered, 5);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(volume).toHaveAttribute("aria-valuetext", "78%");
  await volume.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Type in value…" }).click();
  await page.getByRole("textbox", { name: "Volume value" }).fill("40");
  await page.keyboard.press("Enter");
  await expect(volume).toHaveAttribute("aria-valuetext", "40%");
  await volume.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy value" }).click();
  const clap = row(page, "Clap").getByRole("slider", { name: "Volume" });
  await clap.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paste value" }).click();
  await expect(clap).toHaveAttribute("aria-valuetext", "40%");
  await volume.click({ modifiers: ["Alt"] });
  await expect(volume).toHaveAttribute("aria-valuetext", "78%");
  await clap.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Reset" }).click();
  await expect(clap).toHaveAttribute("aria-valuetext", "78%");

  // A channel's button opens its settings window; another channel's replaces it, unless Alt is held.
  const settings = page.getByTestId("channel-settings");
  await channelButton(page, "Snare").click();
  await expect(settings).toHaveAttribute("data-channel-name", "Snare");
  await channelButton(page, "Hat").click();
  await expect(settings).toHaveCount(1);
  await expect(settings).toHaveAttribute("data-channel-name", "Hat");
  await channelButton(page, "Snare").click({ modifiers: ["Alt"] });
  await expect(settings).toHaveCount(2);
  await channelButton(page, "Hat").click();
  await expect(settings).toHaveCount(1);

  // The window is dragged by its title bar, and has the channel's own knobs and its sample's tools.
  const snare = page.getByRole("region", { name: "Snare" });
  const before = (await snare.boundingBox())!;
  const title = snare.locator("[data-window-title]");
  await drag(page, title, title, { dx: 140, dy: 60 });
  const after = (await snare.boundingBox())!;
  expect(Math.round(after.x - before.x)).toBe(140);
  expect(Math.round(after.y - before.y)).toBe(60);
  await expect(snare.getByTestId("sample-waveform")).toHaveAttribute("data-loaded", "true");
  await snare.getByRole("switch", { name: "Reverse" }).click();
  await snare.getByRole("switch", { name: "Normalize" }).click();
  const fadeOut = snare.getByRole("slider", { name: "Fade out" });
  await fadeOut.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
  await snare.getByLabel("Channel name").fill("Rim");
  await snare.getByLabel("Channel name").press("Enter");
  await expect(row(page, "Rim")).toBeVisible();
  await page.getByRole("region", { name: "Rim" }).getByRole("tab", { name: "Envelope" }).click();
  await page.getByRole("region", { name: "Rim" }).getByRole("switch", { name: "Use the envelope" }).click();
  await expect
    .poll(async () => (await savedSong(page, id)).channels[3])
    .toMatchObject({ name: "Rim", envelope: { enabled: true }, precomputed: { reverse: true, normalize: true, fadeOut: expect.closeTo(0.2, 5) } });
  await page.getByRole("button", { name: "Close Rim" }).click();
  await expect(settings).toHaveCount(0);

  // The rack is a window too: F6 hides it and brings it back.
  await page.keyboard.press("F6");
  await expect(page.getByTestId("channel-rack")).toHaveCount(0);
  await page.keyboard.press("F6");
  await expect(page.getByTestId("channel-rack")).toBeVisible();
});

test("Transpose selected moves the selected channels' notes by the semitones typed, in a small window", async ({ page }) => {
  const id = await openNewSong(page, "Transpose");
  await addStarterKit(page);
  await expect(page.getByRole("listitem")).toHaveCount(4);
  await step(page, "Kick", 1).click();
  await step(page, "Hat", 3).click();
  await step(page, "Snare", 5).click();
  await page.getByRole("button", { name: "Select Kick" }).click();
  await page.getByRole("button", { name: "Select Hat" }).click({ button: "right" });
  await page.getByRole("button", { name: "Channel rack menu" }).click();
  await page.getByRole("menuitem", { name: "Transpose selected…" }).click();
  const transpose = page.locator('[data-window="transpose"]');
  await expect(transpose).toBeVisible();
  await transpose.getByLabel("Semitones").fill("-5");
  await transpose.getByLabel("Semitones").press("Enter");
  await expect(transpose).toHaveCount(0);
  const pitches = async () => {
    const song = await savedSong(page, id);
    return song.channels.map((c: { id: string }) => (song.patterns[0].notes[c.id] ?? []).map((n: { pitch: number }) => n.pitch));
  };
  await expect.poll(pitches).toEqual([[55], [], [55], [60]]);
});

test("the graph editor draws, scales, ramps and resets the selected channel's steps", async ({ page }) => {
  const id = await openNewSong(page, "Graph");
  await addStarterKit(page);
  await expect(page.getByRole("listitem")).toHaveCount(4);
  await drag(page, step(page, "Hat", 1), step(page, "Hat", 8));
  await page.getByRole("button", { name: "Select Hat" }).click();
  await page.keyboard.press("ControlOrMeta+k");
  const graph = page.getByTestId("graph-editor");
  await expect(graph).toHaveAttribute("data-channel-name", "Hat");
  const bar = (n: number) => graph.locator(`[data-step="${n - 1}"]`);
  const levels = () => graph.locator("[data-level]").evaluateAll((bars) => bars.map((b) => Number(b.getAttribute("data-level"))));
  expect(await levels()).toEqual(Array(8).fill(78));
  const at = async (n: number, level: number) => {
    const box = (await bar(n).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height * (1 - level) };
  };

  // A click sets one step's velocity.
  let p = await at(3, 0.25);
  await page.mouse.click(p.x, p.y);
  expect((await levels())[2]).toBeLessThan(30);

  // The right button ramps from where it's pressed to where it's dragged.
  const from = await at(1, 0.2);
  const to = await at(8, 0.9);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up({ button: "right" });
  const ramp = await levels();
  expect(ramp[0]).toBeLessThan(25);
  expect(ramp[7]).toBeGreaterThan(85);
  for (let i = 1; i < 8; i++) expect(ramp[i]).toBeGreaterThan(ramp[i - 1]);

  // Ctrl scales them all together; Alt resets.
  p = await at(8, 0.45);
  const grab = await at(8, 0.9);
  await page.mouse.move(grab.x, grab.y);
  await page.keyboard.down("Control");
  await page.mouse.down();
  await page.mouse.move(p.x, p.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  const scaled = await levels();
  expect(scaled[7]).toBeLessThan(50);
  expect(scaled[0]).toBeLessThan(ramp[0]);
  p = await at(8, 0.5);
  await page.keyboard.down("Alt");
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up("Alt");
  expect((await levels())[7]).toBe(78);

  // The Note tab is the step's pitch.
  await graph.getByRole("tab", { name: "Note" }).click();
  expect((await levels())[0]).toBe(50);
  p = await at(1, 1);
  await page.mouse.click(p.x, p.y);
  await expect
    .poll(async () => {
      const song = await savedSong(page, id);
      return song.patterns[0].notes[song.channels[2]?.id]?.[0].pitch;
    })
    .toBe(72);
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
      'call update_channel {"channel": "Kick", "cutSelf": true, "sample": {"reverse": true}}',
      'call solo_channel {"channel": "Hats"}',
      'call set_steps {"channel": "Snare", "steps": "x"}',
      "call get_song",
    ].join("\n"),
  );
  await composer.press("Enter");
  // (The fake assistant ends by saying how each call went.)
  await expect(panel).toContainText("solo_channel: ok, set_steps: failed, get_song: ok", { timeout: 30_000 });
  // The rack shows what it did, live; the one it got wrong says which channels exist.
  expect(await drawn(page, "Kick")).toBe("x---x---x---x---");
  expect(await drawn(page, "Hats")).toBe("--x---x---x---x-");
  await expect(page.getByRole("textbox", { name: "Tempo" })).toHaveValue("128");
  await panel.getByRole("button", { name: /10 steps/ }).click();
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
  expect(song.channels[0]).toMatchObject({ cutSelf: true, muted: true, precomputed: { reverse: true } });
  // Its edits are undo steps like any other.
  expect(await muted(page)).toBe("M-");
  await page.locator("header").getByRole("button", { name: "Undo" }).click();
  expect(await muted(page)).toBe("--");
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

test("the toolbar, as FL Studio's: the tempo LCD drags, + makes a pattern, the position slider moves where play starts, the hint bar names what's under the pointer", async ({ page }) => {
  const id = await openNewSong(page, "Toolbar");
  const tempo = page.getByRole("textbox", { name: "Tempo" });
  await expect(tempo).toHaveValue("120");
  // Dragged up 40 px, 4 px a BPM: one undo step.
  await drag(page, tempo, tempo, { dy: -40 });
  await expect(tempo).toHaveValue("130");
  await expect.poll(async () => (await savedSong(page, id)).settings.tempo).toBe(130);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(tempo).toHaveValue("120");

  await page.getByRole("button", { name: "New pattern" }).click();
  await page.getByLabel("New pattern's name").press("Enter");
  await expect(page.getByRole("spinbutton", { name: "Pattern", exact: true })).toContainText("Pattern 2");
  await expect.poll(async () => (await savedSong(page, id)).patterns.length).toBe(2);

  // Halfway along a bar's pattern is its 9th step.
  const position = page.getByLabel("Position", { exact: true });
  await expect(position).toHaveText("1:01:00");
  const slider = page.getByRole("slider", { name: "Song position" });
  const box = (await slider.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.52, box.y + box.height / 2);
  await expect(position).toHaveText("1:09:00");

  await page.getByRole("button", { name: "Metronome" }).hover();
  await expect(page.getByTestId("hint-bar")).toHaveText("Metronome");
});

test("a double-click on the rack's title sends it to the desktop's corner, and another brings it back", async ({ page }) => {
  await openNewSong(page, "Corner");
  const rack = page.locator('[data-window="rack"]');
  const desktop = (await page.locator("[data-desktop]").boundingBox())!;
  const before = (await rack.boundingBox())!;
  expect(before.x - desktop.x).toBeGreaterThan(0);
  await rack.locator("[data-window-title]").dblclick({ position: { x: 150, y: 10 } });
  await expect.poll(async () => (await rack.boundingBox())!.x - desktop.x).toBeCloseTo(0, 0);
  expect((await rack.boundingBox())!.y - desktop.y).toBeCloseTo(0, 0);
  await rack.locator("[data-window-title]").dblclick({ position: { x: 150, y: 10 } });
  await expect.poll(async () => (await rack.boundingBox())!.x).toBeCloseTo(before.x, 0);
});

test("the mixer, as FL Studio's: channels routed to tracks, faders, mute and solo, sends that never loop, meters", async ({ page }) => {
  const id = await openNewSong(page, "Mixing");
  await addStarterKit(page);
  await expect(page.getByRole("listitem")).toHaveCount(4);
  const mixer = page.getByTestId("mixer");
  const strip = (name: string) => mixer.locator(`[data-track-name="${name}"]`);
  const mixerOf = async () => (await savedSong(page, id)).mixer.tracks as { id: string; name: string | null; volume: number; muted: boolean; sends: { to: string; level: number }[] }[];

  // Every channel starts on the master ("---"); Ctrl+L in the rack gives the selected ones free tracks named after them.
  await expect(row(page, "Kick").getByRole("spinbutton")).toHaveText("---");
  await page.getByRole("button", { name: "Select Kick" }).click();
  await page.keyboard.press("ControlOrMeta+l");
  await expect(row(page, "Kick").getByRole("spinbutton")).toHaveText("1");
  await expect.poll(async () => (await savedSong(page, id)).channels[0].mixerTrack).toBe("insert_1");

  // The insert number's menu types one in: a number, or M for the master.
  const typeTrack = async (value: string) => {
    // The rack in front (the mixer fills the desktop once it's open).
    await page.getByRole("button", { name: "Channel rack", exact: true }).click();
    await row(page, "Hat").getByRole("spinbutton").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Type in value…" }).click();
    await page.getByRole("textbox", { name: /Hat's mixer track.*type a value/ }).fill(value);
    await page.keyboard.press("Enter");
  };
  await typeTrack("5");
  await expect(row(page, "Hat").getByRole("spinbutton")).toHaveText("5");
  await typeTrack("M");
  await expect(row(page, "Hat").getByRole("spinbutton")).toHaveText("---");

  // F9 shows the mixer: the master, then 16 inserts, the first now called Kick.
  await page.keyboard.press("F9");
  await expect(mixer).toBeVisible();
  await expect(mixer.locator("[data-track]")).toHaveCount(17);
  await expect(strip("Kick")).toBeVisible();
  // Changing a channel's insert number selects that insert in the mixer.
  await typeTrack("7");
  await expect(strip("Insert 7")).toHaveAttribute("aria-selected", "true");
  await typeTrack("M");
  await expect(strip("Master")).toHaveAttribute("aria-selected", "true");

  // A fader drags down, and Alt+click puts it back at 0 dB.
  const fader = strip("Kick").getByRole("slider", { name: "Kick volume" });
  await drag(page, fader, fader, { dy: 40 });
  await expect.poll(async () => (await mixerOf())[1].volume).toBeLessThan(0.7);
  await fader.click({ modifiers: ["Alt"] });
  await expect.poll(async () => (await mixerOf())[1].volume).toBe(0.8);
  // Its menu's Type in value takes a level in dB (the field stays open while it's typed in).
  await fader.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Type in value…" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("textbox", { name: "Kick volume in dB" }).fill("-6");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await mixerOf())[1].volume).toBeCloseTo(0.635, 2);
  await fader.click({ modifiers: ["Alt"] });

  // With Kick selected, insert 3's arrow sends Kick there too; then insert 3 can't send back (a loop).
  await strip("Kick").locator("canvas").click();
  await strip("Insert 3").getByRole("button", { name: "Send to Insert 3" }).click();
  await expect.poll(async () => (await mixerOf())[1].sends.map((s) => s.to)).toEqual(["master", "insert_3"]);
  await strip("Insert 3").locator("canvas").click();
  await expect(strip("Kick").getByRole("button", { name: "Send to Kick" })).toBeDisabled();

  // The mute light mutes; a right-click solos (the other inserts muted, never the master); again, all back on.
  await strip("Insert 2").getByRole("button", { name: "Mute Insert 2" }).click();
  await expect.poll(async () => (await mixerOf())[2].muted).toBe(true);
  await strip("Insert 2").getByRole("button", { name: "Unmute Insert 2" }).click({ button: "right" });
  await expect.poll(async () => (await mixerOf()).slice(0, 4).map((t) => t.muted)).toEqual([false, true, false, true]);
  await strip("Insert 2").getByRole("button", { name: "Mute Insert 2" }).click({ button: "right" });
  await expect.poll(async () => (await mixerOf()).some((t) => t.muted)).toBe(false);

  // A double-click on a name renames the track; + adds a track after the selected one.
  await strip("Insert 3").locator("span").first().dblclick();
  await page.getByRole("textbox", { name: "Track name" }).fill("Verb");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await mixerOf())[3].name).toBe("Verb");
  await mixer.page().getByRole("button", { name: "Add a mixer track" }).click();
  await expect(mixer.locator("[data-track]")).toHaveCount(18);
  expect((await mixerOf())[4].name).toBeNull();

  // Playing, the meters move (the stand-in engine reports the master's level).
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      strip("Master")
        .locator("canvas")
        .evaluate((canvas: HTMLCanvasElement) => {
          const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
          let lit = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
          return lit;
        }),
    )
    .toBeGreaterThan(100);
  // And the selection meter, at the left: the selected tracks' sound together.
  const lit = () =>
    page.getByTestId("selection-meter").evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext("2d")!.getImageData(0, canvas.height - 20, canvas.width, 20).data;
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 1] > 120) bright++;
      return bright;
    });
  await expect.poll(lit).toBeGreaterThan(10);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("an effect goes in a mixer track's slot: chosen from the effect plugins, its window opened by its name, bypassed, moved", async ({ page }) => {
  const id = await openNewSong(page, "Effects");
  await page.keyboard.press("F9");
  const inspector = page.getByTestId("mixer-inspector");
  await expect(inspector).toContainText("Master");
  const slots = async () => ((await savedSong(page, id)).mixer.tracks[0].effects as ({ plugin: { name: string }; enabled: boolean } | null)[]).map((e) => e && `${e.plugin.name}${e.enabled ? "" : " (off)"}`);

  // A slot's menu lists the effect plugins (not the instruments).
  await inspector.getByRole("button", { name: "Slot 2 menu" }).click();
  await expect(page.getByRole("menuitem", { name: /Fake Synth/ })).toHaveCount(0);
  await page.getByRole("menuitem", { name: /Fake Delay/ }).click();
  await expect.poll(async () => (await slots()).slice(0, 3)).toEqual([null, "Fake Delay", null]);

  // Its name opens its window (the engine's), and closes it again.
  const name = inspector.getByRole("button", { name: /Fake Delay: open its window/ });
  await name.click();
  await expect(inspector.getByRole("button", { name: /Fake Delay: close its window/ })).toHaveAttribute("aria-pressed", "true");
  await inspector.getByRole("button", { name: /Fake Delay: close its window/ }).click();
  await expect(name).toHaveAttribute("aria-pressed", "false");

  // It delays its track (the stand-in says 10 ms): the inspector says so, and the strip has a clock. A manual offset is typed in ms.
  const compensation = page.getByTestId("delay-compensation");
  await expect(compensation.getByTestId("plugin-delay")).toHaveText("10.0 ms (480 samples)");
  await expect(page.getByTestId("mixer").locator('[data-track-name="Master"]').getByTestId("delay-mark")).toBeVisible();
  await compensation.getByRole("textbox", { name: "Manual delay offset in ms" }).fill("-2.5");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[0].latencyOffset).toBe(-2.5);
  await compensation.getByRole("button", { name: "Reset" }).click();
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[0].latencyOffset).toBe(0);

  // Its light bypasses it (and with it, its delay); its menu moves it up, and deletes it.
  await inspector.getByRole("button", { name: "Bypass Fake Delay" }).click();
  await expect.poll(async () => (await slots())[1]).toBe("Fake Delay (off)");
  await expect(compensation.getByTestId("plugin-delay")).toHaveText("none");
  await inspector.getByRole("button", { name: "Slot 2 menu" }).click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect.poll(async () => (await slots()).slice(0, 2)).toEqual(["Fake Delay (off)", null]);
  await inspector.getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect.poll(async () => (await slots()).every((s) => s === null)).toBe(true);
});

test("a mixer track's own controls, as FL Studio's: phase, swap, stereo separation, colour, cables, its state copied to another track", async ({ page }) => {
  const id = await openNewSong(page, "Strips");
  await page.keyboard.press("F9");
  const mixer = page.getByTestId("mixer");
  const strip = (name: string) => mixer.locator(`[data-track-name="${name}"]`);
  const track = async (n: number) => (await savedSong(page, id)).mixer.tracks[n];

  // Invert phase and swap sides are switches; stereo separation is a knob (Alt+click resets it).
  await strip("Insert 1").getByRole("button", { name: "Invert Insert 1's phase" }).click();
  await strip("Insert 1").getByRole("button", { name: "Swap Insert 1's left and right" }).click();
  await expect.poll(async () => [(await track(1)).invert, (await track(1)).swap]).toEqual([true, true]);
  const separation = strip("Insert 1").getByRole("slider", { name: "Insert 1 stereo separation" });
  await drag(page, separation, separation, { dy: -40 });
  await expect.poll(async () => (await track(1)).stereo).toBeGreaterThan(0.2);

  // A colour from its menu tints its number.
  await strip("Insert 1").locator("span").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Colour" }).click();
  await page.getByRole("menuitem", { name: "Blue" }).click();
  await expect.poll(async () => (await track(1)).color).toBe("#4a89dc");

  // Dragging across the strips' meters moves the selection along, one at a time; with Cmd, each one passed joins it.
  const selectedNames = () => mixer.locator('[data-track][aria-selected="true"]').evaluateAll((strips) => strips.map((s) => s.getAttribute("data-track-name")));
  await drag(page, strip("Insert 2").locator("canvas"), strip("Insert 4").locator("canvas"));
  expect(await selectedNames()).toEqual(["Insert 4"]);
  await page.keyboard.down("ControlOrMeta");
  await drag(page, strip("Insert 7").locator("canvas"), strip("Insert 9").locator("canvas"));
  await page.keyboard.up("ControlOrMeta");
  expect(await selectedNames()).toEqual(["Insert 4", "Insert 7", "Insert 8", "Insert 9"]);

  // With several selected, a right-click keeps them selected, and Colour and Rename give them all the same.
  await strip("Insert 5").locator("canvas").click();
  await strip("Insert 6").locator("canvas").click({ modifiers: ["ControlOrMeta", "Shift"] });
  await strip("Insert 6").locator("span").first().click({ button: "right" });
  await expect(strip("Insert 5")).toHaveAttribute("aria-selected", "true");
  await page.getByRole("menuitem", { name: "Colour" }).click();
  await page.getByRole("menuitem", { name: "Green", exact: true }).click();
  await expect.poll(async () => [(await track(5)).color, (await track(6)).color]).toEqual(["#3fb27f", "#3fb27f"]);
  await strip("Insert 6").locator("span").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  await page.getByRole("textbox", { name: "Track name" }).fill("Pads");
  await page.keyboard.press("Enter");
  await expect.poll(async () => [(await track(5)).name, (await track(6)).name]).toEqual(["Pads", "Pads"]);

  // Sending to insert 3 draws a cable from it.
  await strip("Insert 1").locator("canvas").click();
  await expect(page.getByTestId("cables").locator("path")).toHaveCount(1);
  await strip("Insert 3").getByRole("button", { name: "Send to Insert 3" }).click();
  await expect(page.getByTestId("cables").locator("path")).toHaveCount(2);

  // Its state (an effect, its controls) copied onto insert 2: a copy of the effect, with an id of its own; not its colour or sends.
  await page.getByTestId("mixer-inspector").getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByRole("menuitem", { name: /Fake Delay/ }).click();
  await expect.poll(async () => (await track(1)).effects[0]?.plugin.name).toBe("Fake Delay");
  await strip("Insert 1").locator("span").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy track state" }).click();
  await strip("Insert 2").locator("span").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paste track state" }).click();
  await expect.poll(async () => (await track(2)).effects[0]?.plugin.name).toBe("Fake Delay");
  const [one, two] = [await track(1), await track(2)];
  expect(two).toMatchObject({ invert: true, swap: true, stereo: one.stereo, color: null, sends: [{ to: "master", level: 1 }] });
  expect(two.effects[0].id).not.toBe(one.effects[0].id);
});

test("the assistant mixes with the mixer's tools: routes, levels, sends, effects, a track's state copied", async ({ page }) => {
  const id = await openNewSong(page, "Assisted mix");
  await addStarterKit(page);
  await expect(page.getByRole("listitem")).toHaveCount(4);
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call route_channels {"channels": ["Kick", "Snare"], "track": "free"}',
      'call update_mixer_track {"track": "Kick", "level": -6, "color": "red", "stereo": 1}',
      'call add_mixer_track {"name": "Verb"}',
      'call set_send {"from": "Snare", "to": "Verb", "level": 0.3}',
      'call set_send {"from": "Verb", "to": "Snare"}',
      'call list_plugins {"kind": "effect"}',
      'call add_mixer_effect {"track": "Verb", "plugin": "Fake Delay"}',
      'call update_mixer_effect {"track": "Verb", "slot": 1, "mix": 0.5}',
      'call copy_track_state {"from": "Verb", "to": 3}',
      "call get_mixer",
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("copy_track_state: ok, get_mixer: ok", { timeout: 30_000 });
  // The send back from the reverb to the snare would loop: refused, saying why.
  await expect(panel).toContainText("set_send: failed");
  const mixer = (await expect
    .poll(async () => (await savedSong(page, id)).mixer.tracks[3]?.effects[0]?.plugin.name)
    .toBe("Fake Delay")
    .then(() => savedSong(page, id))).mixer.tracks as { id: string; name: string | null; color: string | null; volume: number; stereo: number; effects: ({ id: string; mix: number } | null)[]; sends: { to: string; level: number }[] }[];
  const song = await savedSong(page, id);
  expect(song.channels.slice(0, 4).map((c: { mixerTrack: string }) => c.mixerTrack)).toEqual(["insert_1", "master", "master", "insert_2"]);
  expect(mixer[1]).toMatchObject({ name: "Kick", color: "#d9534f", stereo: 1 });
  expect(mixer[1].volume).toBeCloseTo(0.635, 2);
  const verb = mixer.find((t) => t.name === "Verb")!;
  expect(mixer[2].sends).toEqual([{ to: "master", level: 1 }, { to: verb.id, level: 0.3 }]);
  expect(verb.effects[0]).toMatchObject({ mix: 0.5 });
  // Insert 3 got a copy of the reverb's effect (an id of its own).
  expect(mixer[3].effects[0]).toMatchObject({ mix: 0.5 });
  expect(mixer[3].effects[0]!.id).not.toBe(verb.effects[0]!.id);
});
