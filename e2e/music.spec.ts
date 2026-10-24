/**
 * The music suite. Its tests make their own songs (through the API, then open them), so they don't
 * depend on what the video editor's tests left behind; like those, they run in order and share a
 * server. The audio engine is a stand-in (`server/music/fake-engine.mjs`): nothing is heard, but it
 * keeps time, so what plays can be watched.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { type Locator, type Page, expect, test } from "@playwright/test";
import { writeWav } from "../server/music/wav.ts";

test.describe.configure({ mode: "serial" });

/** A new song, open in the page. The Browser starts closed (it takes room from the desktop) unless `browser`. */
/** A new song, open. It opens on the Playlist (the rack over it): closed unless `playlist`, so the tests see the desktop. */
async function openNewSong(page: Page, name: string, { browser = false, playlist = false } = {}): Promise<string> {
  await page.addInitScript((open) => {
    if (!sessionStorage.getItem("e2e-browser-set")) {
      localStorage.setItem("vaudio.music.browser", JSON.stringify({ open, width: 280, volume: 0.8, expanded: [] }));
      sessionStorage.setItem("e2e-browser-set", "1");
    }
  }, browser);
  // The stand-in's plugins starred, as the pickers list only the starred (the Plugin manager's test unstars them).
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-plugins-set")) {
      localStorage.setItem("vaudio.music.favouritePlugins", JSON.stringify(["VST3-Fake Synth-1", "VST3-Fake Delay-2"]));
      sessionStorage.setItem("e2e-plugins-set", "1");
    }
  });
  const response = await page.request.post("/api/projects", { data: { suite: "music", name } });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/p/${id}`);
  await expect(page.locator('[data-suite="music"]')).toBeVisible();
  await expect(page.getByTestId("playlist")).toBeVisible();
  if (!playlist) {
    await page.getByRole("button", { name: "Close Playlist" }).click();
    await expect(page.getByTestId("playlist")).toHaveCount(0);
  }
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

test("a song opens on the Playlist, filling the desktop, with the channel rack over it", async ({ page }) => {
  await openNewSong(page, "Opening", { playlist: true });
  const z = (id: string) => page.locator(`[data-window="${id}"]`).evaluate((e) => Number(getComputedStyle(e).zIndex));
  await expect(page.locator('[data-window="playlist"]')).toHaveAttribute("data-snap", "full");
  await expect(page.getByTestId("channel-rack")).toBeVisible();
  expect(await z("rack")).toBeGreaterThan(await z("playlist"));
});

test("activating music windows returns focus without stealing control focus", async ({ page }) => {
  const projectId = await openNewSong(page, "Window focus");
  await page.getByTestId("channel-rack").getByRole("button", { name: "Add a channel" }).click();
  await page.getByTestId("channel-picker").getByRole("option", { name: "Fake Synth" }).click();
  await expect(channelButton(page, "Fake Synth")).toHaveAttribute("aria-expanded", "true");
  void projectId;

  for (const [id, label] of [["rack", "Channel rack"], ["playlist", "Playlist"], ["piano", "Piano roll"], ["mixer", "Mixer"]]) {
    const surface = page.locator(`[data-window="${id}"]`);
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(surface).toBeFocused();

    await page.getByRole("textbox", { name: "Tempo" }).focus();
    // Click the title bar's gap, rather than its channel/clip-source menu button.
    const title = (await surface.locator("header h2").boundingBox())!;
    const header = surface.locator("header").first();
    const bar = (await header.boundingBox())!;
    await header.click({ position: { x: title.x + title.width + 2 - bar.x, y: 14 } });
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest<HTMLElement>("[data-window]")?.dataset.window)).toBe(id);
  }

  await page.getByRole("button", { name: "Channel rack", exact: true }).click();
  await channelButton(page, "Fake Synth").click({ button: "right" });
  await page.getByTestId("channel-menu").getByRole("menuitem", { name: "Rename and color…" }).click();
  const name = page.getByRole("textbox", { name: "Channel name" });
  await name.click();
  await expect(name).toBeFocused();
  await name.fill("Focused synth");
  await page.keyboard.press("Enter");
  await expect(channelButton(page, "Focused synth")).toBeVisible();
});

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
  await page.locator("[data-suite=music]").getByRole("button", { name: "Redo", exact: true }).click();
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
  await drag(page, edge, edge, { dx: 16 * 21.75 }); // 16 steps of 21.75 px (a step, its gap, a quarter of a beat's)
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
  // Past the rack's width, the steps scroll; the middle button drags them along, anywhere on the rack.
  const steps = page.getByTestId("rack-steps");
  const scrolled = () => steps.evaluate((e) => e.scrollLeft);
  const lead = (await page.getByTestId("channel-rack").getByRole("listitem").first().boundingBox())!;
  await page.mouse.move(lead.x + 10, lead.y + lead.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(lead.x - 110, lead.y + lead.height / 2, { steps: 5 });
  await page.mouse.up({ button: "middle" });
  expect(await scrolled()).toBe(120);
  await steps.evaluate((e) => (e.scrollLeft = 0));
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

  // The selector: a click selects one, a right-click adds, a double-click opens its Piano roll (Théo's).
  const selected = () => page.locator("[data-selector][aria-pressed=true]").count();
  await page.getByRole("button", { name: "Select Hat" }).click();
  expect(await selected()).toBe(1);
  await page.getByRole("button", { name: "Select Kick" }).click({ button: "right" });
  expect(await selected()).toBe(2);
  await page.getByRole("button", { name: "Select Snare" }).dblclick();
  const piano = page.locator('[data-window="piano"]');
  await expect(piano).toBeVisible();
  await expect(piano.locator("[data-window-title]")).toContainText("Snare");
  await page.getByRole("button", { name: /^Close Piano roll/ }).click();
  await expect(piano).toHaveCount(0);
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
  /** A file dropped on `target`, at the height `y` (the page's) if it's given. */
  const drop = async (target: Locator, name: string, y?: number) => {
    const data = await page.evaluateHandle(async (fileName) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([await (await fetch("/kit/hat.wav")).blob()], fileName, { type: "audio/wav" }));
      return transfer;
    }, name);
    await target.dispatchEvent("dragover", { dataTransfer: data, ...(y !== undefined && { clientY: y }) });
    await target.dispatchEvent("drop", { dataTransfer: data, ...(y !== undefined && { clientY: y }) });
  };
  await drop(channelButton(page, "Snare"), "Rim shot.wav");
  await expect(row(page, "Rim shot")).toBeVisible();
  expect(await rackOrder(page)).toEqual(["Kick", "Hat", "Rim shot", "Clap"]);
  // Dropped on the rack, a file goes between the channels it's dropped between: here, below the last.
  const last = (await row(page, "Clap").boundingBox())!;
  await drop(page.getByTestId("channel-rack"), "Shaker.wav", last.y + last.height + 2);
  await expect(page.getByRole("listitem")).toHaveCount(5);
  expect((await rackOrder(page))[4]).toBe("Shaker");
  // And between Kick and Hat.
  const hat = (await row(page, "Hat").boundingBox())!;
  await drop(page.getByTestId("channel-rack"), "Tom.wav", hat.y + 2);
  await expect(page.getByRole("listitem")).toHaveCount(6);
  expect(await rackOrder(page)).toEqual(["Kick", "Tom", "Hat", "Rim shot", "Clap", "Shaker"]);
  // A right-click on a channel's button selects it (its menu acts on it).
  await channelButton(page, "Clap").click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Select Clap" })).toHaveAttribute("aria-pressed", "true");
});

test("the rack's + adds an instrument: a plugin of this computer's, or a sampler", async ({ page }) => {
  const id = await openNewSong(page, "Plugins");
  const rack = page.getByTestId("channel-rack");

  // The picker lists the Sampler and the instrument plugins found (not the effects), and narrows as you type.
  await rack.getByRole("button", { name: "Add a channel" }).click();
  const picker = page.getByTestId("channel-picker");
  await expect(picker.getByRole("option")).toHaveText([/Sampler/, /Fake Synth/]);
  // The arrows move the highlight through the list, and Enter would choose it.
  await expect(picker.getByRole("textbox")).toBeFocused();
  await expect(picker.getByRole("option", { name: "Sampler" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(picker.getByRole("option", { name: "Fake Synth" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(picker.getByRole("option", { name: "Sampler" })).toHaveAttribute("aria-selected", "true");
  await picker.getByRole("textbox").fill("synth");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await picker.getByRole("option", { name: /Fake Synth/ }).click();
  await expect(row(page, "Fake Synth")).toBeVisible();
  await expect.poll(async () => (await savedSong(page, id)).channels[0]).toMatchObject({ kind: "plugin", name: "Fake Synth", plugin: { name: "Fake Synth", format: "VST3" } });

  // Added, its plugin's own window (the engine's, not ours) opens once it's loaded; its button hides and shows it; its steps are notes.
  const synth = channelButton(page, "Fake Synth");
  await expect(synth).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("channel-settings")).toHaveCount(0);
  await synth.click();
  await expect(synth).toHaveAttribute("aria-expanded", "false");
  await synth.click();
  await expect(synth).toHaveAttribute("aria-expanded", "true");
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

  // Replace (FL's): another instrument in the channel's place, playing its notes; one undo step.
  const settings = page.getByRole("button", { name: "Close Sampler" });
  if (await settings.count()) await settings.click();
  await step(page, "Sampler", 3).click();
  await channelButton(page, "Sampler").click({ button: "right" });
  await page.getByTestId("channel-menu").getByRole("menuitem", { name: "Replace…" }).click();
  await page.getByTestId("replace-picker").getByRole("option", { name: /Fake Synth/ }).click();
  expect(await rackOrder(page)).toEqual(["Fake Synth", "Fake Synth"]);
  await expect
    .poll(async () => {
      const song = await savedSong(page, id);
      return [song.channels[1].kind, song.patterns[0].notes[song.channels[1].id]?.map((n: { start: number }) => n.start)];
    })
    .toEqual(["plugin", [48]]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await rackOrder(page)).toEqual(["Fake Synth", "Sampler"]);
});

test("the Plugin manager stars the plugins the pickers list, as FL Studio's favourites", async ({ page }) => {
  await openNewSong(page, "Plugin manager");
  const rack = page.getByTestId("channel-rack");
  await rack.getByRole("button", { name: "Add a channel" }).click();
  const picker = page.getByTestId("channel-picker");
  await expect(picker.getByRole("option")).toHaveText([/Sampler/, /Fake Synth/]);

  // More plugins… closes the picker and opens the manager on the instruments.
  await picker.getByRole("button", { name: "More plugins…" }).click();
  await expect(picker).toHaveCount(0);
  const manager = page.getByTestId("plugin-manager");
  await expect(manager.getByRole("button", { name: "Instruments" })).toHaveAttribute("aria-pressed", "true");
  await expect(manager.getByRole("listitem")).toHaveText([/Fake Synth/, /Serum 2/]);
  await manager.getByRole("button", { name: "All" }).click();
  await expect(manager.getByRole("listitem")).toHaveCount(3);

  // Unstarred, it's no longer in the picker (only the Sampler, ours, always is).
  await manager.getByRole("button", { name: "Unstar Fake Synth" }).click();
  await expect(manager.getByRole("button", { name: "Star Fake Synth" })).toHaveAttribute("aria-pressed", "false");
  await rack.getByRole("button", { name: "Add a channel" }).click();
  await expect(picker.getByRole("option")).toHaveText([/Sampler/]);
  await expect(picker).toContainText("2 not starred");
  await page.keyboard.press("Escape");

  // The effect slots likewise: the built-in effects, and the starred.
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  await page.getByTestId("mixer-inspector").getByRole("button", { name: "Slot 1 menu" }).click();
  const effects = page.getByTestId("effect-picker");
  await expect(effects.getByRole("option", { name: /Fake Delay/ })).toHaveCount(1);
  // Its More plugins… brings the manager (behind the mixer now) to the front, on the effects.
  await effects.getByRole("button", { name: "More plugins…" }).click();
  await expect(effects).toHaveCount(0);
  await expect(manager.getByRole("button", { name: "Effects" })).toHaveAttribute("aria-pressed", "true");
  await manager.getByRole("button", { name: "Starred" }).click();
  await expect(manager.getByRole("listitem")).toHaveText([/Fake Delay/]);
  // A click on its row unstars it too.
  await manager.getByRole("listitem", { name: "Fake Delay" }).click();
  await expect(manager).toContainText("None starred yet");
  await page.getByTestId("mixer-inspector").getByRole("button", { name: "Slot 1 menu" }).click();
  await expect(effects.getByRole("option", { name: /YT-Time/ })).toHaveCount(1);
  await expect(effects.getByRole("option", { name: /Fake Delay/ })).toHaveCount(0);
  await effects.getByRole("button", { name: "More plugins…" }).click();

  // Starred again (it's kept in this browser, for every song).
  await manager.getByRole("button", { name: "All" }).click();
  await manager.getByRole("button", { name: "Star Fake Synth" }).click();
  await manager.getByRole("button", { name: "Star Fake Delay" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("vaudio.music.favouritePlugins") ?? "[]"))).toEqual(["VST3-Fake Synth-1", "VST3-Fake Delay-2"]);
  await page.getByRole("button", { name: "Channel rack", exact: true }).click();
  await rack.getByRole("button", { name: "Add a channel" }).click();
  await expect(picker.getByRole("option")).toHaveText([/Sampler/, /Fake Synth/]);
});

test("a Serum 2 channel's window is the Serum player: Serum's presets in one list, found, stepped through, rated, and its macros", async ({ page }) => {
  // Serum 2 starred too, so the picker lists it (before openNewSong's own stars, which then leave these be).
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-plugins-set")) {
      localStorage.setItem("vaudio.music.favouritePlugins", JSON.stringify(["VST3-Fake Synth-1", "VST3-Fake Delay-2", "VST3-Serum 2-3"]));
      sessionStorage.setItem("e2e-plugins-set", "1");
    }
  });
  const id = await openNewSong(page, "Serum player");
  await page.getByTestId("channel-rack").getByRole("button", { name: "Add a channel" }).click();
  await page.getByTestId("channel-picker").getByRole("option", { name: /Serum 2/ }).click();

  // Added, it opens its player (not Serum's own window), which lists the library: Serum 2 presets and a Serum 1 one.
  const player = page.getByTestId("serum-player");
  await expect(player).toBeVisible();
  const serum = channelButton(page, "Serum 2");
  await expect(serum).toHaveAttribute("aria-expanded", "true");
  const presets = player.getByRole("listbox", { name: "Presets" }).getByRole("option");
  await expect(presets).toHaveText([/BA - Stand-in Reese/, /LD - Stand-in Lead/, /PD - Stand-in Pad/, /pl - stand-in pluck.*S1/]);
  await expect(player.getByTestId("serum-macros").locator("[data-macro]")).toHaveCount(8);
  // It opens inside the desktop, however small the screen (smaller than it likes, rather than under the Dock).
  const desk = (await page.locator("[data-desktop='music']").boundingBox())!;
  const box = (await player.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(desk.y + desk.height + 1);
  expect(box.x + box.width).toBeLessThanOrEqual(desk.x + desk.width + 1);
  // Its display, and the engine told to measure the channel for it.
  await expect(player.getByTestId("serum-scope")).toBeVisible();

  // Found by its maker or its kind, loaded by a click.
  const find = player.getByRole("textbox", { name: "Find a preset" });
  await find.fill("somebody");
  await expect(presets).toHaveText([/PD - Stand-in Pad/]);
  await find.fill("reese");
  await presets.first().click();
  await expect(player.getByTestId("serum-preset-name")).toHaveText("BA - Stand-in Reese");
  await expect(presets.first()).toHaveAttribute("aria-selected", "true");

  // ↓ steps through the list, from the search field and from the window.
  await find.fill("");
  await find.press("ArrowDown");
  await expect(player.getByTestId("serum-preset-name")).toHaveText("LD - Stand-in Lead");
  await player.getByTestId("serum-preset-name").click();
  await page.keyboard.press("ArrowDown");
  await expect(player.getByTestId("serum-preset-name")).toHaveText("PD - Stand-in Pad");
  await player.getByRole("button", { name: "Previous preset" }).click();
  await expect(player.getByTestId("serum-preset-name")).toHaveText("LD - Stand-in Lead");

  // Shuffle: a random preset of the list as it's filtered, never the one on.
  await find.fill("stand-in");
  await player.getByRole("button", { name: "Random preset" }).click();
  await expect(player.getByTestId("serum-preset-name")).not.toHaveText("LD - Stand-in Lead");
  await expect(player.getByTestId("serum-preset-name")).toHaveText(/Stand-in|stand-in/);
  await find.fill("");
  await player.getByRole("listbox", { name: "Presets" }).getByRole("option", { name: "LD - Stand-in Lead" }).click();
  await expect(player.getByTestId("serum-preset-name")).toHaveText("LD - Stand-in Lead");

  // Serum 1 alone; rated, it's starred, in Serum's own index.
  await player.getByRole("group", { name: "Serum version" }).getByRole("button", { name: "Serum 1" }).click();
  await expect(presets).toHaveText([/pl - stand-in pluck/]);
  await presets.first().getByRole("button", { name: "4 stars" }).click();
  await player.getByRole("group", { name: "Serum version" }).getByRole("button", { name: "Both" }).click();
  await player.getByRole("button", { name: "Starred" }).click();
  await expect(presets).toHaveText([/pl - stand-in pluck/]);
  await expect
    .poll(async () => ((await (await page.request.get("/api/music/serum/presets")).json()).presets as { name: string; rating: number }[]).find((p) => p.name === "pl - stand-in pluck")?.rating)
    .toBe(4);
  await presets.first().getByRole("button", { name: "4 stars" }).click();
  await expect(presets).toHaveCount(0);
  await player.getByRole("button", { name: "Starred" }).click();

  // A macro turned is Serum's own control turned. It's named as the preset names it (Serum's controls say "Macro 1"), and
  // the macros the preset leaves unnamed and unrouted are hidden.
  const channelId = (await savedSong(page, id)).channels.find((c: { name: string }) => c.name === "Serum 2").id;
  await expect(player.getByTestId("serum-macros").locator("[data-macro]")).toHaveCount(1);
  await player.getByRole("slider", { name: "SPACE" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(async () => ((await (await page.request.get(`/api/engine/parameters?owner=channel&id=${channelId}`)).json()) as { id: string; value: number }[]).find((p) => p.id === "7000000")?.value)
    .not.toBe(0.5);
  // (The knob kept its arrow: the preset didn't change.)
  await expect(player.getByTestId("serum-preset-name")).toHaveText("LD - Stand-in Lead");

  // Serum's own window is a click away; the rack's button closes the player.
  await player.getByRole("button", { name: "Open Serum" }).click();
  await expect(player.getByRole("button", { name: "Hide Serum" })).toBeVisible();
  await player.getByRole("button", { name: "Hide Serum" }).click();
  await serum.click();
  await expect(player).toHaveCount(0);
  await expect(serum).toHaveAttribute("aria-expanded", "false");
});

test("the Serum player edits the sound: routes added, turned, changed and removed, envelopes and LFOs, each a step of its own undo", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-plugins-set")) {
      localStorage.setItem("vaudio.music.favouritePlugins", JSON.stringify(["VST3-Fake Synth-1", "VST3-Fake Delay-2", "VST3-Serum 2-3"]));
      sessionStorage.setItem("e2e-plugins-set", "1");
    }
  });
  const id = await openNewSong(page, "Serum sound");
  await page.getByTestId("channel-rack").getByRole("button", { name: "Add a channel" }).click();
  await page.getByTestId("channel-picker").getByRole("option", { name: /Serum 2/ }).click();
  const player = page.getByTestId("serum-player");
  await player.getByRole("listbox", { name: "Presets" }).getByRole("option", { name: "BA - Stand-in Reese" }).click();
  await expect(player.getByTestId("serum-preset-name")).toHaveText("BA - Stand-in Reese");
  let channelId = "";
  await expect.poll(async () => (channelId = (await savedSong(page, id)).channels.find((c: { name: string }) => c.name === "Serum 2")?.id ?? "")).not.toBe("");
  const engineValue = async (param: string) =>
    ((await (await page.request.get(`/api/engine/parameters?owner=channel&id=${channelId}`)).json()) as { id: string; value: number }[]).find((p) => p.id === param)?.value;

  // The sound's parts are tabs under the display, the oscillators first.
  const tab = (name: string) => player.getByRole("tab", { name, exact: true });
  await expect(tab("Oscillators")).toHaveAttribute("aria-selected", "true");
  await tab("Modulation").click();
  const modulation = player.getByTestId("serum-modulation");
  await expect(modulation).toContainText("Nothing is modulated");
  const undo = player.getByRole("button", { name: "Undo in the player" });
  const redo = player.getByRole("button", { name: "Redo in the player" });
  // The load is a step only when there was a sound before it (the stand-in's Serum had none).
  await expect(undo).toBeDisabled();

  // The oscillators, each muted and soloed live by Serum's own switch: a solo turns the others off, and back.
  await tab("Oscillators").click();
  const oscillators = player.getByTestId("serum-oscillators");
  await expect(oscillators.locator("[data-oscillator]")).toHaveCount(5);
  await expect(oscillators.locator("[data-oscillator='A']")).toHaveAttribute("data-on", "true");
  await oscillators.getByRole("button", { name: "Solo Osc B" }).click();
  await expect.poll(() => engineValue("1000000")).toBe(0);
  await expect.poll(() => engineValue("1001000")).toBe(1);
  await expect(oscillators.locator("[data-oscillator='A']")).toHaveAttribute("data-on", "false");
  await oscillators.getByRole("button", { name: "Solo Osc B" }).click();
  await expect.poll(() => engineValue("1000000")).toBe(1);
  await expect.poll(() => engineValue("1001000")).toBe(0);
  await oscillators.getByRole("button", { name: "Mute Osc A" }).click();
  await expect.poll(() => engineValue("1000000")).toBe(0);
  await expect(undo).toHaveAttribute("title", /Undo Mute Osc A/);
  await undo.click();
  await expect.poll(() => engineValue("1000000")).toBe(1);

  // A route added: a source, then a destination from Serum's list, found by typing.
  async function addRoute(source: string, destination: string) {
    await tab("Modulation").click();
    await modulation.getByRole("button", { name: "Add" }).click();
    await page.getByRole("textbox", { name: "Find: Source" }).fill(source);
    await page.getByRole("listbox", { name: "Source" }).getByRole("option", { name: source, exact: true }).click();
    await modulation.getByRole("button", { name: "Pick a destination" }).click();
    await page.getByRole("textbox", { name: "Find: Destination" }).fill(destination);
    await page.getByRole("listbox", { name: "Destination" }).getByRole("option", { name: destination, exact: true }).click();
  }
  await addRoute("Macro 1", "Filter 1 Freq");
  const route = modulation.locator("[data-slot='1']");
  await expect(route).toContainText("Macro 1");
  await expect(route).toContainText("Filter 1 Freq");
  await expect(route).toContainText("50%");
  await expect(tab("Modulation")).toHaveAttribute("title", "Modulation: 1 route");
  await expect(player.getByTestId("serum-edited")).toBeVisible();
  // The macro shows what it drives.
  await expect(player.getByTestId("serum-macros").locator("[data-macro='1']")).toContainText("Filter 1 Freq");
  await expect(undo).toHaveAttribute("title", /Undo Add Macro 1 → Filter 1 Freq/);

  // Its amount turns live, Serum's own control, and that's a step of its own.
  const amount = route.getByRole("slider", { name: "Macro 1 → Filter 1 Freq amount" });
  await amount.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => engineValue("6000000")).toBeGreaterThan(0.75);
  await expect(undo).toHaveAttribute("title", /Undo Macro 1 → Filter 1 Freq amount/);
  await undo.click();
  await expect.poll(() => engineValue("6000000")).toBe(0.75);
  await expect(redo).toHaveAttribute("title", /Redo Macro 1 → Filter 1 Freq amount/);

  // Bipolar, a new destination: reloads, each a step.
  await route.getByRole("button", { name: "±" }).click();
  await expect(route.getByRole("button", { name: "±" })).toHaveAttribute("aria-pressed", "true");
  await route.getByRole("button", { name: "Filter 1 Freq", exact: true }).click();
  await page.getByRole("textbox", { name: "Find: Destination" }).fill("a wt pos");
  await page.getByRole("listbox", { name: "Destination" }).getByRole("option", { name: "A WT Pos", exact: true }).click();
  await expect(route).toContainText("A WT Pos");
  await expect(route.getByRole("button", { name: "±" })).toHaveAttribute("aria-pressed", "true");

  // Removed, and back with ⌘Z while the player is in front; ⇧⌘Z takes it away again.
  await route.getByRole("button", { name: "Remove Macro 1 → A WT Pos" }).click();
  await expect(modulation).toContainText("Nothing is modulated");
  await player.getByTestId("serum-preset-name").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(route).toContainText("A WT Pos");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(modulation).toContainText("Nothing is modulated");
  await undo.click();
  await expect(route).toContainText("A WT Pos");

  // The envelopes and LFOs have a tab of their own, which this computer remembers.
  await expect(player.getByTestId("serum-envelopes")).toHaveCount(0);
  await tab("Envelopes and LFOs").click();
  const envelopes = player.getByTestId("serum-envelopes");
  await expect(envelopes.getByTestId("serum-env-1")).toHaveAttribute("data-used", "true");
  // Only what's in use: no LFO is routed yet, so none shows.
  await expect(envelopes.getByTestId("serum-lfo-1")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("vaudio.music.serum.tab"))).toBe("shapes");

  // Env 1's attack, dragged on its shape: live, one step.
  const attack = envelopes.getByTestId("serum-env-1").getByRole("slider", { name: "Env 1 attack point" });
  await attack.scrollIntoViewIfNeeded();
  const box = (await attack.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => engineValue("3000000")).toBeGreaterThan(0.2);
  await expect(undo).toHaveAttribute("title", /Undo Env 1 attack/);

  // An LFO routed opens; its shape takes a point by a double-click, and its mode is a reload.
  await addRoute("LFO 1", "A Level");
  await tab("Envelopes and LFOs").click();
  const lfo = envelopes.getByTestId("serum-lfo-1");
  await expect(lfo).toHaveAttribute("data-used", "true");
  const shape = lfo.getByRole("img", { name: "LFO 1's shape" });
  await expect(shape).toHaveAttribute("data-points", "[[0,1],[0.5,0],[1,1]]");
  await shape.scrollIntoViewIfNeeded();
  const area = (await shape.boundingBox())!;
  await page.mouse.dblclick(area.x + area.width * 0.25, area.y + area.height * 0.5);
  await expect.poll(async () => JSON.parse((await shape.getAttribute("data-points"))!).length).toBe(4);
  await lfo.getByRole("radiogroup", { name: "LFO 1 mode" }).getByRole("radio", { name: /Free/ }).click();
  await expect(lfo.getByRole("radiogroup", { name: "LFO 1 mode" }).getByRole("radio", { name: /Free/ })).toHaveAttribute("aria-checked", "true");
  await expect(undo).toHaveAttribute("title", /Undo LFO 1: free/);
});

test("the Serum player's effects: racks as tabs, cards turned live, added, set, moved and removed, Serum's saved ones put in, each an undo step", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-plugins-set")) {
      localStorage.setItem("vaudio.music.favouritePlugins", JSON.stringify(["VST3-Fake Synth-1", "VST3-Fake Delay-2", "VST3-Serum 2-3"]));
      sessionStorage.setItem("e2e-plugins-set", "1");
    }
  });
  const id = await openNewSong(page, "Serum effects");
  await page.getByTestId("channel-rack").getByRole("button", { name: "Add a channel" }).click();
  await page.getByTestId("channel-picker").getByRole("option", { name: /Serum 2/ }).click();
  const player = page.getByTestId("serum-player");
  await player.getByRole("listbox", { name: "Presets" }).getByRole("option", { name: "BA - Stand-in Reese" }).click();
  await expect(player.getByTestId("serum-preset-name")).toHaveText("BA - Stand-in Reese");
  let channelId = "";
  await expect.poll(async () => (channelId = (await savedSong(page, id)).channels.find((c: { name: string }) => c.name === "Serum 2")?.id ?? "")).not.toBe("");
  const engineValue = async (param: string) =>
    ((await (await page.request.get(`/api/engine/parameters?owner=channel&id=${channelId}`)).json()) as { id: string; value: number }[]).find((p) => p.id === param)?.value;
  const undo = player.getByRole("button", { name: "Undo in the player" });
  await player.getByRole("tab", { name: "Effects", exact: true }).click();
  const effects = player.getByTestId("serum-effects");
  await expect(effects).toContainText("No effects");
  const add = async (rack: string, item: string) => {
    await effects.getByRole("button", { name: `Add an effect to ${rack}` }).click();
    await page.getByRole("menuitem", { name: item, exact: true }).click();
  };

  // A reverb added: a card, its knobs linked to the rack's slots.
  await add("Main", "Reverb");
  const reverb = effects.locator("[data-effect='reverb']");
  await expect(reverb).toHaveAttribute("data-on", "true");
  await expect(undo).toHaveAttribute("title", /Undo Add Reverb/);
  const mix = reverb.locator("[data-param='wet']");
  const slot = (await mix.getAttribute("data-slot"))!;
  expect(slot).toMatch(/^17000\d{3}$/);

  // Its mix turns live, Serum's own slot, a step of its own.
  await mix.getByRole("slider", { name: "Reverb mix" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => engineValue(slot)).toBeCloseTo(0.21, 5);
  await expect(undo).toHaveAttribute("title", /Undo Reverb mix/);

  // Its switch and its type are live too.
  await reverb.getByRole("button", { name: "Bypass Reverb" }).click();
  await expect(reverb).toHaveAttribute("data-on", "false");
  await expect(undo).toHaveAttribute("title", /Undo Bypass Reverb/);
  await reverb.getByRole("button", { name: "Type" }).click();
  await page.getByRole("menuitem", { name: "Hall" }).click();
  await expect(reverb.getByRole("button", { name: "Type" })).toHaveText("Hall");

  // The rest is under its expand: not on a slot, Serum takes it as a new state when it's let go.
  await reverb.getByRole("button", { name: "All Reverb settings" }).click();
  const lowCut = reverb.locator("[data-param='freq']");
  await expect(lowCut).not.toHaveAttribute("data-slot");
  await lowCut.getByRole("slider", { name: "Reverb low cut" }).focus();
  await page.keyboard.press("ArrowUp");
  await expect(undo).toHaveAttribute("title", /Undo Reverb low cut/);
  await expect(lowCut).toContainText("1%");

  // Another effect, moved before the reverb; the order is Serum's.
  await add("Main", "Distortion");
  const cards = effects.getByRole("listitem");
  await expect(cards).toHaveCount(2);
  await effects.locator("[data-effect='distortion']").getByRole("button", { name: "Distortion menu" }).click();
  await page.getByRole("menuitem", { name: "Move earlier" }).click();
  await expect(cards.first()).toHaveAttribute("data-effect", "distortion");
  await expect(undo).toHaveAttribute("title", /Undo Move Distortion/);

  // A saved rack of Serum's onto Bus 1, in place of what it had.
  await effects.getByRole("tab", { name: /Bus 1/ }).click();
  await expect(effects).toContainText("Nothing on Bus 1");
  await effects.getByRole("button", { name: "Add an effect to Bus 1" }).click();
  await page.getByRole("menuitem", { name: "Saved racks (replace Bus 1)" }).hover();
  await page.getByRole("menuitem", { name: "FX Rack" }).hover();
  await page.getByRole("menuitem", { name: "Stand-in Grit" }).click();
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveAttribute("data-effect", "distortion");
  await expect(cards.nth(1)).toHaveAttribute("data-effect", "delay");
  await expect(cards.first().getByRole("button", { name: "Mode" })).toHaveText("Overdrive");

  // Removed, and back with the player's undo.
  await cards.nth(1).getByRole("button", { name: "Delay menu" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect(cards).toHaveCount(1);
  await undo.click();
  await expect(cards).toHaveCount(2);
  await effects.getByRole("tab", { name: /Main/ }).click();
  await expect(cards).toHaveCount(2);
});

test("the Serum player saves the sound as a preset in Serum's User folder, and lists more folders added in Settings", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-plugins-set")) {
      localStorage.setItem("vaudio.music.favouritePlugins", JSON.stringify(["VST3-Fake Synth-1", "VST3-Fake Delay-2", "VST3-Serum 2-3"]));
      sessionStorage.setItem("e2e-plugins-set", "1");
    }
  });
  await openNewSong(page, "Serum saving");
  await page.getByTestId("channel-rack").getByRole("button", { name: "Add a channel" }).click();
  await page.getByTestId("channel-picker").getByRole("option", { name: /Serum 2/ }).click();
  const player = page.getByTestId("serum-player");
  const list = player.getByRole("listbox", { name: "Presets" });
  const name = player.getByTestId("serum-preset-name");
  await list.getByRole("option", { name: "BA - Stand-in Reese" }).click();
  await expect(name).toHaveText("BA - Stand-in Reese");

  // A factory preset isn't saved over: Save asks for a name, its own to start with.
  await player.getByRole("button", { name: "Save", exact: true }).click();
  const saveAs = page.getByTestId("serum-save-as");
  const field = saveAs.getByRole("textbox", { name: "The preset's name" });
  await expect(field).toHaveValue("BA - Stand-in Reese");
  await field.fill("BA/bad");
  await expect(saveAs.getByRole("button", { name: "Save" })).toBeDisabled();
  await field.fill("BA - My Reese");
  await saveAs.getByRole("button", { name: "Save" }).click();
  await expect(saveAs).toHaveCount(0);
  // It's on now, listed with the rest, in Serum's User folder.
  await expect(name).toHaveText("BA - My Reese");
  await expect(list.getByRole("option", { name: "BA - My Reese" })).toHaveAttribute("aria-selected", "true");
  const listed = async () => ((await (await page.request.get("/api/music/serum/presets")).json()).presets as { name: string; folder: string }[]).find((p) => p.name === "BA - My Reese");
  expect(await listed()).toMatchObject({ folder: "User" });

  // Edited, ⌘S saves over it now that it's the user's own: no name asked.
  await player.getByRole("tab", { name: "Oscillators", exact: true }).click();
  await player.getByTestId("serum-oscillators").getByRole("button", { name: "Mute Osc A" }).click();
  await expect(player.getByTestId("serum-edited")).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/music/serum/save") && r.ok());
  await page.keyboard.press("ControlOrMeta+s");
  expect(await (await saved).json()).toMatchObject({ replaced: true, sound: { edited: false } });
  await expect(player.getByTestId("serum-edited")).toHaveCount(0);
  await expect(saveAs).toHaveCount(0);
  // ⇧⌘S is Save as: a name that's taken in User says so, and saving replaces it only then.
  await page.keyboard.press("ControlOrMeta+Shift+s");
  await expect(field).toHaveValue("BA - My Reese");
  await expect(saveAs).toContainText("saving replaces it");
  await expect(saveAs.getByRole("button", { name: "Replace" })).toBeVisible();
  await saveAs.getByRole("button", { name: "Cancel" }).click();
  await expect(saveAs).toHaveCount(0);

  // Settings › Music: Serum's own folder, and Serum 1's library found in iCloud Drive (which Serum 2 doesn't see), added with a click.
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = page.getByRole("region", { name: "Settings" });
  const folders = settings.getByTestId("serum-library-folder");
  await expect(folders).toHaveCount(1);
  await expect(folders.first()).toContainText("5 presets");
  await settings.getByRole("button", { name: "Add", exact: true }).click();
  await expect(folders).toHaveCount(2);
  await expect(folders.nth(1)).toContainText("2 presets");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  // Its presets are in the player's list at once, Serum 1's, and load as any other.
  await expect(list.getByRole("option", { name: "LD - Stand-in Cloud Lead" })).toContainText("S1");
  await list.getByRole("option", { name: "BS - Stand-in Cloud Bass" }).click();
  await expect(name).toHaveText("BS - Stand-in Cloud Bass");

  // Removed again, they're gone from the list (the files stay where they are).
  await page.keyboard.press("ControlOrMeta+Comma");
  await settings.getByRole("button", { name: "Remove" }).click();
  await expect(folders).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(list.getByRole("option", { name: "LD - Stand-in Cloud Lead" })).toHaveCount(0);
});

test("a plugin channel's settings are FL's wrapper: its knobs, the plugin, its programs and the user's presets for it", async ({ page }) => {
  const id = await openNewSong(page, "Wrapper");
  await page.getByTestId("channel-rack").getByRole("button", { name: "Add a channel" }).click();
  await page.getByTestId("channel-picker").getByRole("option", { name: /Fake Synth/ }).click();
  const synth = channelButton(page, "Fake Synth");
  await expect(synth).toHaveAttribute("aria-expanded", "true");

  // Channel settings… on its menu: the plugin, shown or hidden from there.
  await synth.click({ button: "right" });
  await page.getByTestId("channel-menu").getByRole("menuitem", { name: "Channel settings…" }).click();
  const settings = page.getByTestId("channel-settings");
  await expect(settings).toHaveAttribute("data-channel-name", "Fake Synth");
  const tab = settings.getByTestId("plugin-tab");
  await tab.getByRole("button", { name: "Hide plugin" }).click();
  await expect(synth).toHaveAttribute("aria-expanded", "false");
  await expect(tab.getByRole("button", { name: "Show plugin" })).toBeVisible();

  // Its own programs, stepped through or picked.
  const program = tab.getByRole("combobox", { name: "Program" });
  await expect(program).toContainText("Init");
  await tab.getByRole("button", { name: "Next program" }).click();
  await expect(program).toContainText("Bass");
  await tab.getByRole("button", { name: "Previous program" }).click();
  await tab.getByRole("button", { name: "Previous program" }).click();
  await expect(program).toContainText("Pad");

  // The user's presets: saved under a name, loaded, deleted.
  const name = tab.getByRole("textbox", { name: "Preset name" });
  await name.fill("Fat bass");
  await name.press("Enter");
  const mine = tab.getByRole("list", { name: "Your presets" });
  await expect(mine.getByRole("button", { name: "Fat bass", exact: true })).toHaveAttribute("aria-current", "true");
  await name.fill("Soft");
  await tab.getByRole("button", { name: "Save preset" }).click();
  await expect(mine.getByRole("button", { name: "Soft", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(mine.getByRole("button", { name: "Fat bass", exact: true })).not.toHaveAttribute("aria-current");
  await mine.getByRole("button", { name: "Fat bass", exact: true }).click();
  await expect(mine.getByRole("button", { name: "Fat bass", exact: true })).toHaveAttribute("aria-current", "true");
  await mine.getByRole("button", { name: "Delete Soft" }).click();
  await expect(mine.getByRole("button", { name: "Soft", exact: true })).toHaveCount(0);

  // Its PITCH moves its keys in whole semitones: typed in, it's kept whole.
  await settings.getByRole("slider", { name: "Pitch" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Type in value…" }).click();
  await page.getByRole("textbox", { name: "Pitch value" }).fill("7.4");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedSong(page, id)).channels[0].pitch).toBe(7);

  // The assistant: the plugin's presets, through the same browser.
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call plugin_presets {"channel": "Fake Synth", "action": "list"}',
      'call plugin_presets {"channel": "Fake Synth", "action": "program", "program": "Lead"}',
      'call plugin_presets {"channel": "Fake Synth", "action": "save", "name": "Assistant lead"}',
      'call plugin_presets {"channel": "Fake Synth", "action": "program", "program": "99"}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("plugin_presets: ok, plugin_presets: ok, plugin_presets: ok, plugin_presets: failed", { timeout: 30_000 });
  await expect(program).toContainText("Lead");
  await expect(mine.getByRole("button", { name: "Assistant lead", exact: true })).toHaveAttribute("aria-current", "true");

  // Cloned, the copy's plugin starts as the original is: its settings file is copied to the copy first.
  const synthId = (await savedSong(page, id)).channels[0].id;
  const copied = page.waitForRequest((r) => r.url().endsWith("/api/engine/states/copy"));
  await synth.click({ button: "right" });
  await page.getByTestId("channel-menu").getByRole("menuitem", { name: "Clone", exact: true }).click();
  const request = (await copied).postDataJSON();
  await expect.poll(async () => (await savedSong(page, id)).channels.length).toBe(2);
  const [original, clone] = (await savedSong(page, id)).channels;
  expect(request.copies).toEqual([{ from: synthId, to: clone.id }]);
  expect(clone).toMatchObject({ kind: "plugin", plugin: original.plugin, pitch: 7 });
});

test("knobs work as in FL Studio, and a channel opens its settings window", async ({ page }) => {
  const id = await openNewSong(page, "Knobs");
  await addStarterKit(page);
  await expect(page.getByRole("listitem")).toHaveCount(4);

  const tempo = page.getByRole("textbox", { name: "Tempo" });
  await tempo.fill("128");
  await tempo.press("Enter");
  // What the Home screen's card says.
  await expect
    .poll(async () => ((await (await page.request.get("/api/projects")).json()) as { id: string; tempo?: number }[]).find((p) => p.id === id)?.tempo)
    .toBe(128);

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

  // The window is dragged by its title bar, and has the channel's own knobs and its sample's tools. (The rack,
  // pressed last, is in front of it, maybe over its title when the desktop is short: a click brings it forward.)
  const snare = page.getByRole("region", { name: "Snare" });
  await snare.getByRole("tab", { name: "Sample" }).click();
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
  await page.getByRole("region", { name: "Rim" }).getByRole("switch", { name: "Envelope", exact: true }).click();
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

test("a channel is renamed and coloured from its menu; a sampler's loop, filter, envelopes, LFOs and swing mix are in its settings", async ({ page }) => {
  const id = await openNewSong(page, "Channel settings");
  await addStarterKit(page);
  type Saved = { channels: { name: string; color: string | null; swingMix?: number; loop?: { enabled: boolean }; filter?: { type: string }; mods?: Record<string, { envelope?: { enabled: boolean }; lfo?: { enabled: boolean } }> }[] };
  const kick = async () => ((await savedSong(page, id)) as Saved).channels.find((c) => c.name === "Big kick")!;

  // Its menu: Rename… makes its button a box to type in; Color tints it.
  await channelButton(page, "Kick").click({ button: "right" });
  await page.getByTestId("channel-menu").getByRole("menuitem", { name: "Rename and color…" }).click();
  const box = page.getByRole("textbox", { name: "Channel name" });
  await box.fill("Big kick");
  await page.getByRole("radio", { name: "#3f5ea8" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(row(page, "Big kick")).toBeVisible();
  await expect.poll(async () => (await kick())?.color).toBe("#3f5ea8");
  await expect(channelButton(page, "Big kick")).toHaveAttribute("data-color", "#3f5ea8");

  // Its settings: the loop, on the Sample tab, drawn on its waveform.
  await channelButton(page, "Big kick").click();
  const settings = page.locator('[data-testid="channel-settings"][data-channel-name="Big kick"]');
  await settings.getByRole("switch", { name: "Loop while held" }).click();
  await expect.poll(async () => (await kick()).loop?.enabled).toBe(true);
  await expect(settings.getByTestId("loop-region")).toHaveCount(1);
  // Its swing mix, beside its pitch.
  await settings.getByRole("slider", { name: "Swing mix" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Type in value…" }).click();
  await page.getByRole("textbox", { name: "Swing mix value" }).fill("50");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await kick()).swingMix).toBe(0.5);

  // The Envelope tab: a target, its envelope and LFO, and the filter they move.
  await settings.getByRole("tab", { name: "Envelope" }).click();
  const instrument = settings.getByTestId("instrument-tab");
  await instrument.getByRole("radio", { name: "Filter cutoff" }).click();
  await instrument.getByRole("radio", { name: "Low pass" }).click();
  await instrument.getByRole("switch", { name: "Envelope" }).click();
  await instrument.getByRole("switch", { name: "LFO" }).click();
  await instrument.getByRole("radio", { name: "Square" }).click();
  await expect.poll(async () => (await kick()).filter?.type).toBe("lowpass");
  await expect.poll(async () => (await kick()).mods?.cutoff).toMatchObject({ envelope: { enabled: true }, lfo: { enabled: true, shape: "square" } });
  // The volume's own envelope is the same switch on its target.
  await instrument.getByRole("radio", { name: "Volume" }).click();
  await instrument.getByRole("switch", { name: "Envelope" }).click();
  await expect.poll(async () => ((await savedSong(page, id)) as { channels: { name: string; envelope: { enabled: boolean } }[] }).channels.find((c) => c.name === "Big kick")!.envelope.enabled).toBe(true);
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
  await page.locator("[data-suite=music]").getByRole("button", { name: "Undo", exact: true }).click();
  expect(await muted(page)).toBe("--");
  // And the whole answer waits for review over the composer: Undo all puts the song back as it was, as one undo step.
  const review = panel.locator('[data-slot="assistant-review"]');
  await expect(review).toContainText(/\d+ changes to review/);
  await review.getByRole("button", { name: "Undo all" }).click();
  await expect(review).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Tempo" })).not.toHaveValue("128");
  await page.locator("[data-suite=music]").getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Tempo" })).toHaveValue("128");
});

test("settings: ⌘, opens on the music tab, with the device and the plugin bench", async ({ page }) => {
  await openNewSong(page, "Engine bench");
  await page.keyboard.press("ControlOrMeta+Comma");
  const dialog = page.getByRole("region", { name: "Settings" });
  await expect(dialog.getByRole("tab", { selected: true })).toHaveText("Music");
  // Keys pressed in it are its own: Space doesn't play the song.
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await expect(page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "Play" })).not.toHaveAttribute("aria-pressed", "true");
  // The gear in the toolbar opens the same window.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.locator("[data-suite=music]").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(dialog.getByRole("tab", { selected: true })).toHaveText("Music");

  // The output device and its buffer.
  const device = dialog.getByTestId("device-settings");
  await expect(device).toContainText("5.3 ms of buffer");
  await device.getByRole("combobox", { name: "Buffer size" }).click();
  await page.getByRole("option", { name: "128 samples" }).click();
  await expect(device).toContainText("2.7 ms of buffer");
  await expect(dialog.getByTestId("engine-device")).toContainText("128 samples");

  // The driver (ASIO, on Windows): one device both ways, with its own settings panel; and the recording offset.
  const driver = device.getByRole("combobox", { name: "Audio driver" });
  await driver.click();
  await page.getByRole("option", { name: "Fake ASIO" }).click();
  await expect(device).toContainText("Device");
  const panel = page.waitForRequest((r) => r.url().endsWith("/api/engine/devices/panel"));
  await device.getByRole("button", { name: "Device panel" }).click();
  await panel;
  const offset = device.getByRole("spinbutton", { name: "Recording offset in milliseconds" });
  const offsetSent = page.waitForRequest((r) => r.url().endsWith("/api/engine/devices") && r.method() === "POST" && r.postDataJSON().recordOffsetMs === 12);
  await offset.fill("12");
  await offset.press("Enter");
  await offsetSent;
  await expect(offset).toHaveValue("12");
  await offset.fill("0");
  await offset.press("Enter");
  await driver.click();
  await page.getByRole("option", { name: "Fake Audio" }).click();
  await expect(device.getByRole("button", { name: "Device panel" })).toBeHidden();

  // Resampling: Hermite while playing and sinc in exports, until changed; the engine gets the song again with it.
  const playing = dialog.getByRole("combobox", { name: "Resampling while playing" });
  await expect(playing).toHaveText("Hermite (4-point)");
  await expect(dialog.getByRole("combobox", { name: "Resampling in exports" })).toHaveText("Sinc (32-point)");
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/engine/song") && r.postDataJSON().resampling === "sinc");
  await playing.click();
  await page.getByRole("option", { name: "Sinc (32-point)" }).click();
  await sent;
  await playing.click();
  await page.getByRole("option", { name: "Hermite (4-point)" }).click();

  // No instrument yet: nothing to play.
  const keys = dialog.getByRole("group", { name: "Keys" }).getByRole("button");
  await expect(keys.first()).toBeDisabled();

  // Each slot offers the plugins of its kind.
  await dialog.getByRole("combobox", { name: "Instrument plugin" }).click();
  await expect(page.getByRole("option")).toHaveText([/Fake Synth/, /Serum 2/]);
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
  await expect(tempo).toHaveValue("140");
  // Dragged up 40 px, 4 px a BPM: one undo step.
  await drag(page, tempo, tempo, { dy: -40 });
  await expect(tempo).toHaveValue("150");
  await expect.poll(async () => (await savedSong(page, id)).settings.tempo).toBe(150);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(tempo).toHaveValue("140");

  // Its menu taps the tempo: a key every half second is 120 BPM.
  await tempo.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Tap tempo…" }).click();
  const tapped = page.getByTestId("tapped-tempo");
  await expect(page.getByRole("button", { name: "Tap" })).toBeFocused();
  for (let i = 0; i < 5; i++) {
    if (i) await page.waitForTimeout(500);
    await page.keyboard.press("t");
  }
  await expect.poll(async () => Number(await tapped.textContent())).toBeGreaterThan(110);
  expect(Number(await tapped.textContent())).toBeLessThan(130);
  const bpm = (await tapped.textContent())!;
  await page.getByRole("button", { name: "Set tempo" }).click();
  await expect(tempo).toHaveValue(bpm);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(tempo).toHaveValue("140");

  // ...and makes the tempo the one new songs start at (from the New project picker), until it's reset.
  await tempo.fill("128");
  await tempo.press("Enter");
  await tempo.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Make 128 BPM the default" }).click();
  await page.keyboard.press("ControlOrMeta+Shift+KeyO");
  await page.getByRole("dialog").getByRole("textbox").fill("song");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.url()).not.toContain(id);
  await expect(tempo).toHaveValue("128");
  await tempo.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Reset the default (140 BPM)" }).click();
  await page.goto(`/p/${id}`);
  await expect(tempo).toHaveValue("128");

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

  // A click on the position switches it to minutes:seconds:hundredths (8 steps at 128 BPM) and back.
  await position.click();
  await expect(position).toHaveText("0:00:93");
  await position.click();
  await expect(position).toHaveText("1:09:00");

  // Playing, Play is Pause: it stops where it is, and Stop goes back to where play starts.
  const transport = page.getByRole("toolbar", { name: "Transport" });
  await transport.getByRole("button", { name: "Play" }).click();
  await expect(transport.getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => position.textContent()).not.toBe("1:09:00");
  await transport.getByRole("button", { name: "Play" }).click();
  await expect(transport.getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "false");
  const paused = await position.textContent();
  expect(paused).not.toBe("1:09:00");
  await page.waitForTimeout(200);
  await expect(position).toHaveText(paused!);
  await transport.getByRole("button", { name: "Stop" }).click();
  await expect(position).toHaveText("1:09:00");

  // The metronome's menu picks its sound, kept in the browser.
  await page.getByRole("button", { name: "Metronome" }).click({ button: "right" });
  await expect(page.getByRole("menuitemradio", { name: "Beep" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "Hi-hat" }).click();
  expect(await page.evaluate(() => localStorage.getItem("music-metronome-sound"))).toBe("hihat");

  // The main volume knob is the song's.
  const volume = page.getByRole("slider", { name: "Main volume" });
  await expect(volume).toHaveAttribute("aria-valuetext", "78%");
  await drag(page, volume, volume, { dy: 40 });
  await expect.poll(async () => (await savedSong(page, id)).settings.volume).toBeLessThan(0.6);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(volume).toHaveAttribute("aria-valuetext", "78%");
});

test("a double-click on the rack's title sends it to the desktop's corner, and another brings it back", async ({ page }) => {
  await openNewSong(page, "Corner");
  const rack = page.locator('[data-window="rack"]');
  const desktop = (await page.locator("[data-desktop=music]").boundingBox())!;
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
  const mixerOf = async () => (await savedSong(page, id)).mixer.tracks as { id: string; name: string | null; volume: number; muted: boolean; solo: boolean; sends: { to: string; level: number }[] }[];

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
    // Gone, and the keyboard with it (F9 next would be typed into it).
    await expect(page.getByRole("textbox", { name: /Hat's mixer track.*type a value/ })).toHaveCount(0);
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

  // The mute light mutes. A right-click solos the track alone (FL's): the others are silenced, their mutes left as they are.
  await strip("Insert 2").getByRole("button", { name: "Mute Insert 2" }).click();
  await expect.poll(async () => (await mixerOf())[2].muted).toBe(true);
  await strip("Insert 2").getByRole("button", { name: "Unmute Insert 2" }).click();
  await strip("Insert 2").getByRole("button", { name: "Mute Insert 2" }).click({ button: "right" });
  await expect.poll(async () => (await mixerOf()).slice(0, 5).map((t) => t.solo)).toEqual([false, false, true, false, false]);
  expect((await mixerOf()).some((t) => t.muted)).toBe(false);
  await expect(strip("Insert 4")).toHaveAttribute("data-soloed-out", "true");
  await expect(strip("Insert 2")).not.toHaveAttribute("data-soloed-out");
  // S adds a track to the solo; Alt+click solos it alone; clicked again, nothing is soloed.
  await strip("Insert 4").getByRole("button", { name: "Solo Insert 4" }).click();
  await expect.poll(async () => (await mixerOf()).slice(0, 5).map((t) => t.solo)).toEqual([false, false, true, false, true]);
  await expect(strip("Insert 4")).not.toHaveAttribute("data-soloed-out");
  await strip("Insert 4").getByRole("button", { name: "Unsolo Insert 4" }).click({ modifiers: ["Alt"] });
  await expect.poll(async () => (await mixerOf()).slice(0, 5).map((t) => t.solo)).toEqual([false, false, false, false, true]);
  await strip("Insert 4").getByRole("button", { name: "Unsolo Insert 4" }).click();
  await expect.poll(async () => (await mixerOf()).some((t) => t.solo)).toBe(false);
  // The title bar's SOLO light is lit while anything is soloed, and clears every solo.
  await expect(page.getByTestId("solo-indicator")).toBeDisabled();
  await strip("Insert 4").getByRole("button", { name: "Solo Insert 4" }).click();
  await strip("Insert 5").getByRole("button", { name: "Solo Insert 5" }).click();
  await expect(page.getByTestId("solo-indicator")).toHaveText("SOLO 2");
  // Mono and Dim, for listening: switched on the title bar, never in the song.
  await page.getByRole("button", { name: "Listen in mono" }).click();
  await expect(page.getByRole("button", { name: "Listen in mono" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Listen in mono" }).click();
  await expect(page.getByRole("button", { name: "Listen in mono" })).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("solo-indicator").click();
  await expect.poll(async () => (await mixerOf()).some((t) => t.solo)).toBe(false);
  // A mute light dragged across the strips paints them all (one undo step); the same with S.
  await drag(page, strip("Insert 2").getByRole("button", { name: "Mute Insert 2" }), strip("Insert 4").getByRole("button", { name: "Mute Insert 4" }));
  await expect.poll(async () => (await mixerOf()).slice(1, 6).map((t) => t.muted)).toEqual([false, true, true, true, false]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await mixerOf()).some((t) => t.muted)).toBe(false);
  await drag(page, strip("Insert 5").getByRole("button", { name: "Solo Insert 5" }), strip("Insert 3").getByRole("button", { name: "Solo Insert 3" }));
  await expect.poll(async () => (await mixerOf()).slice(1, 6).map((t) => t.solo)).toEqual([false, false, true, true, true]);
  await page.getByTestId("solo-indicator").click();

  // A double-click on a name renames the track; + adds a track after the selected one.
  await strip("Insert 3").locator("span").first().dblclick();
  await page.getByRole("textbox", { name: "Track name" }).fill("Verb");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await mixerOf())[3].name).toBe("Verb");
  await mixer.page().getByRole("button", { name: "Add a mixer track", exact: true }).click();
  await expect(mixer.locator("[data-track]")).toHaveCount(18);
  // The + after the last track adds one at the end, selected.
  await mixer.getByRole("button", { name: "Add a mixer track at the end" }).click();
  await expect(mixer.locator("[data-track]")).toHaveCount(19);
  await expect(strip("Insert 18")).toHaveAttribute("aria-selected", "true");
  // Alt+Delete deletes the selected track.
  await page.keyboard.press("Alt+Backspace");
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

  // ⌘G routes the selected tracks to a new bus right after them, named at once.
  await strip("Insert 5").locator("canvas").click();
  await strip("Insert 6").locator("canvas").click({ modifiers: ["Shift"] });
  await page.keyboard.press("ControlOrMeta+g");
  await page.getByRole("textbox", { name: "Track name" }).fill("Pads bus");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await mixerOf())[7]?.name).toBe("Pads bus");
  const bus = (await mixerOf())[7];
  expect((await mixerOf()).slice(5, 7).map((t) => t.sends)).toEqual([[{ to: bus.id, level: 1 }], [{ to: bus.id, level: 1 }]]);
  expect(bus.sends).toEqual([{ to: "master", level: 1 }]);
  await expect(strip("Pads bus")).toHaveAttribute("aria-selected", "true");
  // Every strip says where it goes; its output label's menu routes it (and the selected tracks with it) elsewhere.
  await expect(strip("Insert 5").getByTestId("output-label")).toHaveText("→ 7");
  await strip("Insert 5").getByTestId("output-label").click();
  await page.getByRole("menuitemcheckbox", { name: /Master/ }).click();
  await expect.poll(async () => (await mixerOf())[5].sends).toEqual([{ to: "master", level: 1 }]);
  await expect(strip("Insert 5").getByTestId("output-label")).toHaveText("→ M");
  // A bus selected shows what feeds it: a dashed cable from each track sending to it.
  await strip("Pads bus").locator("canvas").click();
  await expect(page.getByTestId("cables").locator("[data-incoming]")).toHaveCount(1);
  await expect(page.getByTestId("cables").locator(`[data-incoming][data-cable-from="${(await mixerOf())[6].id}"]`)).toHaveCount(1);
  // A selected track's down-arrow dragged onto another strip plugs its cable in there: it goes there alone.
  await strip("Insert 9").locator("canvas").click();
  await drag(page, strip("Insert 9").locator("[data-plug]"), strip("Insert 10").locator("canvas"));
  await expect.poll(async () => (await mixerOf())[9].sends).toEqual([{ to: (await mixerOf())[10].id, level: 1 }]);
  // A strip dragged by its number moves there (a line shows where): insert 11 before insert 13.
  const moving = (await mixerOf())[11].id;
  await drag(page, strip("Insert 11").locator("[data-reorder]"), strip("Insert 13").locator("canvas"), { dx: -10 });
  await expect.poll(async () => (await mixerOf())[12].id).toBe(moving);
  // The track menu's Route to the master only undoes any routing (of the selected tracks, if it's one of them).
  await strip("Insert 9").locator("span").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Track routing" }).click();
  await page.getByRole("menuitem", { name: "Route to the master only" }).click();
  await expect.poll(async () => (await mixerOf())[9].sends).toEqual([{ to: "master", level: 1 }]);
  // A bus folds away the tracks going into it (its chip says how many), and unfolds them.
  await strip("Pads bus").getByRole("button", { name: "Fold Pads bus" }).click();
  await expect(strip("Insert 6")).toHaveCount(0);
  await expect(strip("Pads bus").getByTestId("fold")).toHaveText("1");
  await strip("Pads bus").getByRole("button", { name: "Unfold Pads bus" }).click();
  await expect(strip("Insert 6")).toHaveCount(1);
  await expect(page.getByTestId("reorder-line")).toHaveCount(0);
});

test("an effect goes in a mixer track's slot: chosen from the effect plugins, its window opened by its name, bypassed, moved", async ({ page }) => {
  const id = await openNewSong(page, "Effects");
  await page.keyboard.press("F9");
  const inspector = page.getByTestId("mixer-inspector");
  await expect(inspector).toContainText("Master");
  const slots = async () => ((await savedSong(page, id)).mixer.tracks[0].effects as ({ plugin: { name: string }; enabled: boolean } | null)[]).map((e) => e && `${e.plugin.name}${e.enabled ? "" : " (off)"}`);

  // A slot's menu lists the effect plugins (not the instruments).
  await inspector.getByRole("button", { name: "Slot 2 menu" }).click();
  const effectPicker = page.getByTestId("effect-picker");
  await expect(effectPicker.getByRole("option", { name: /Fake Synth/ })).toHaveCount(0);
  // A pin puts it in a Pinned column first, and only there; Enter chooses the one highlighted.
  await effectPicker.getByRole("option", { name: /Fake Delay/ }).hover();
  await effectPicker.getByRole("button", { name: "Pin Fake Delay" }).click();
  await expect(effectPicker.getByRole("region", { name: "Pinned" }).getByRole("option")).toHaveCount(1);
  await expect(effectPicker.getByRole("option", { name: /Fake Delay/ })).toHaveCount(1);
  await expect(effectPicker.getByRole("textbox", { name: "Find an effect" })).toBeFocused();
  // (The columns moved under the pointer: it's put back on the pinned one, which Enter then chooses.)
  await effectPicker.getByRole("region", { name: "Pinned" }).getByRole("option").hover();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await slots()).slice(0, 3)).toEqual([null, "Fake Delay", null]);

  // Its window (the engine's) opens once it's loaded, as FL's does; its name closes it, and opens it again.
  const closer = inspector.getByRole("button", { name: /Fake Delay: close its window/ });
  await expect(closer).toHaveAttribute("aria-pressed", "true");
  await closer.click();
  const name = inspector.getByRole("button", { name: /Fake Delay: open its window/ });
  await expect(name).toHaveAttribute("aria-pressed", "false");
  await name.click();
  await expect(closer).toHaveAttribute("aria-pressed", "true");
  await closer.click();
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

  // An empty slot is chosen by a click anywhere on it.
  await inspector.locator('[data-slot="4"]').click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /Fake Delay/ }).first().click();
  await expect.poll(async () => (await slots()).slice(0, 6)).toEqual([null, "Fake Delay", null, null, "Fake Delay", null]);
  // Dragged onto slot 7 it swaps places with what's there; its right-click menu deletes it.
  await drag(page, inspector.locator('[data-slot="4"]'), inspector.locator('[data-slot="6"]'));
  await expect.poll(async () => (await slots()).slice(4, 7)).toEqual([null, null, "Fake Delay"]);
  await inspector.locator('[data-slot="6"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect.poll(async () => (await slots())[6]).toBeNull();

  // Dragged onto another track's strip it moves there (its first empty slot), and the inspector follows it;
  // with ⌘ a copy goes there (its own id), the effect staying.
  const mixer = page.getByTestId("mixer");
  type Effect = { id: string; plugin: { name: string } };
  const effectsOf = async (n: number) => ((await savedSong(page, id)).mixer.tracks[n].effects as (Effect | null)[]).filter((e): e is Effect => e !== null);
  const from = (await inspector.locator('[data-slot="1"]').boundingBox())!;
  const to = (await mixer.locator('[data-track-name="Insert 2"]').boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(page.getByTestId("carried-state")).toHaveText("Fake Delay → drop to copy");
  await page.mouse.up();
  await page.keyboard.up("ControlOrMeta");
  await expect.poll(async () => (await effectsOf(2)).map((e) => e.plugin.name)).toEqual(["Fake Delay"]);
  const [original] = await effectsOf(0);
  const [copy] = await effectsOf(2);
  expect(copy.id).not.toBe(original.id);
  await expect(inspector).toContainText("Insert 2");
  await drag(page, inspector.locator('[data-slot="0"]'), mixer.locator('[data-track-name="Insert 3"]'));
  await expect.poll(async () => [(await effectsOf(2)).length, (await effectsOf(3)).map((e) => e.id)]).toEqual([0, [copy.id]]);
  await expect(inspector).toContainText("Insert 3");
  await mixer.locator('[data-track-name="Master"]').click({ position: { x: 8, y: 6 } });
  await expect(inspector).toContainText("Master");

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
  // As wide as the desktop was beside the sidebar, so the Wide view's strips overflow (and scroll) further on.
  await page.setViewportSize({ width: 1136, height: 900 });
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
  await expect.poll(async () => (await track(1)).color).toBe("#3f5ea8");

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
  await expect.poll(async () => [(await track(5)).color, (await track(6)).color]).toEqual(["#3f8a4c", "#3f8a4c"]);
  await strip("Insert 6").locator("span").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  await page.getByRole("textbox", { name: "Track name" }).fill("Pads");
  await page.keyboard.press("Enter");
  await expect.poll(async () => [(await track(5)).name, (await track(6)).name]).toEqual(["Pads", "Pads"]);
  // Their controls act on both: a click on one's mute light, phase switch or S; a drag of one's pan moves both by as much.
  await strip("Pads").nth(1).getByRole("button", { name: "Mute Pads" }).click();
  await expect.poll(async () => [(await track(5)).muted, (await track(6)).muted]).toEqual([true, true]);
  await strip("Pads").nth(0).getByRole("button", { name: "Unmute Pads" }).click();
  await strip("Pads").nth(0).getByRole("button", { name: "Invert Pads's phase" }).click();
  await strip("Pads").nth(1).getByRole("button", { name: "Solo Pads" }).click();
  await expect.poll(async () => [(await track(5)).invert, (await track(6)).invert, (await track(5)).solo, (await track(6)).solo, (await track(5)).muted]).toEqual([true, true, true, true, false]);
  await strip("Pads").nth(1).getByRole("button", { name: "Unsolo Pads" }).click();
  const pan = strip("Pads").nth(1).getByRole("slider", { name: "Pads pan" });
  await drag(page, pan, pan, { dy: -30 });
  await expect.poll(async () => (await track(6)).pan).toBeGreaterThan(0.1);
  expect((await track(5)).pan).toBe((await track(6)).pan);
  await expect(strip("Pads").nth(0)).toHaveAttribute("aria-selected", "true");
  // A control of a track that isn't selected acts on it alone.
  await strip("Insert 4").getByRole("button", { name: "Mute Insert 4" }).click();
  await expect.poll(async () => [(await track(4)).muted, (await track(5)).muted]).toEqual([true, false]);
  await strip("Insert 4").getByRole("button", { name: "Unmute Insert 4" }).click();

  // The views: Compact, Wide, Extra large (its strips list their effects), from the title bar; kept for next time.
  const width = async () => (await strip("Insert 1").boundingBox())!.width;
  const compact = await width();
  await page.getByRole("button", { name: "Mixer view: Compact" }).click();
  expect(await width()).toBeGreaterThan(compact);
  await page.getByRole("button", { name: "Mixer view: Wide" }).click();
  await expect(strip("Insert 1").getByTestId("strip-effects")).toBeVisible();
  await page.getByRole("button", { name: "Mixer view: Extra large" }).click();
  await expect(page.getByRole("button", { name: "Mixer view: Compact" })).toBeVisible();

  // Docked to the right, a track stays at the mixer's right edge (keeping its number); and back to the middle.
  await strip("Insert 8").locator("span").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Dock to" }).click();
  await page.getByRole("menuitem", { name: "Right", exact: true }).click();
  await expect(mixer.locator('[data-dock="right"] [data-track-name="Insert 8"]')).toBeVisible();
  await expect.poll(async () => (await track(8)).dock).toBe("right");

  // A separator before a track; a group of the selected ones, its name typed at once into its band.
  await strip("Insert 10").locator("span").first().click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Separator before" }).click();
  await expect.poll(async () => (await track(10)).separator).toBe(true);
  await strip("Insert 11").locator("canvas").click();
  await strip("Insert 12").locator("canvas").click({ modifiers: ["ControlOrMeta", "Shift"] });
  await strip("Insert 12").locator("span").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Create group…" }).click();
  await page.getByRole("textbox", { name: "Group name" }).fill("Drums");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedSong(page, id)).mixer.groups.map((g: { name: string }) => g.name)).toEqual(["Drums"]);
  await expect(mixer.locator("[data-group]").first()).toContainText("Drums");
  expect([(await track(11)).group, (await track(12)).group]).toEqual([(await savedSong(page, id)).mixer.groups[0].id, (await savedSong(page, id)).mixer.groups[0].id]);
  // Shift+click selects every track from the current one; Escape leaves the current one; a click on a group's band selects its tracks.
  await strip("Insert 9").locator("canvas").click();
  await strip("Insert 12").locator("canvas").click({ modifiers: ["Shift"] });
  expect(await selectedNames()).toEqual(["Insert 9", "Insert 10", "Insert 11", "Insert 12"]);
  await page.keyboard.press("Escape");
  expect(await selectedNames()).toEqual(["Insert 9"]);
  await mixer.locator('[data-group]').first().click();
  expect(await selectedNames()).toEqual(["Insert 11", "Insert 12"]);
  // Its controls linked (the track menu), a mute light pressed on one of its tracks mutes both, though only one is selected.
  await strip("Insert 11").getByTitle("Insert 11 (double-click to rename)").click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Link the group's controls" }).click();
  await expect(mixer.getByTestId("group-linked")).toBeVisible();
  await strip("Insert 9").locator("canvas").click();
  await strip("Insert 11").getByRole("button", { name: "Mute Insert 11" }).click();
  await expect.poll(async () => [(await track(11)).muted, (await track(12)).muted, (await track(9)).muted]).toEqual([true, true, false]);
  await strip("Insert 12").getByRole("button", { name: "Unmute Insert 12" }).click();
  await expect.poll(async () => [(await track(11)).muted, (await track(12)).muted]).toEqual([false, false]);
  // A VCA fader for the group: a strip after the master whose fader turns its tracks down together, theirs untouched.
  await strip("Insert 11").getByTitle("Insert 11 (double-click to rename)").click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "VCA fader for the group" }).click();
  const vca = mixer.getByRole("slider", { name: "Drums VCA" });
  await expect(vca).toBeVisible();
  await drag(page, vca, vca, { dy: 40 });
  await expect.poll(async () => (await savedSong(page, id)).mixer.groups[0].vca).toBeLessThan(0.75);
  expect((await track(11)).volume).toBe(0.8);

  // Sending to insert 3 draws a cable from it.
  await strip("Insert 1").locator("canvas").click();
  await expect(page.getByTestId("cables").locator("path")).toHaveCount(1);
  await strip("Insert 3").getByRole("button", { name: "Send to Insert 3" }).click();
  await expect(page.getByTestId("cables").locator("path")).toHaveCount(2);
  // With insert 2 selected too, both are sources: insert 3's switch is half lit (only insert 1 sends there), and a
  // click sends both there, a cable from each; clicked again, neither does.
  await strip("Insert 2").locator("canvas").click({ modifiers: ["ControlOrMeta", "Shift"] });
  await expect(strip("Insert 3").getByRole("button", { name: "Send to Insert 3" })).toHaveAttribute("data-partial", "true");
  await expect(page.getByTestId("cables").locator("path")).toHaveCount(3);
  await strip("Insert 3").getByRole("button", { name: "Send to Insert 3" }).click();
  await expect.poll(async () => (await track(2)).sends.map((s: { to: string }) => s.to)).toEqual(["master", "insert_3"]);
  await expect(page.getByTestId("cables").locator("path")).toHaveCount(4);
  await strip("Insert 3").getByRole("button", { name: "Stop sending to Insert 3" }).click();
  await expect.poll(async () => [(await track(1)).sends.length, (await track(2)).sends.length]).toEqual([1, 1]);
  await strip("Insert 1").locator("canvas").click();
  await strip("Insert 3").getByRole("button", { name: "Send to Insert 3" }).click();
  await expect(page.getByTestId("cables").locator("path")).toHaveCount(2);
  // Its menu takes the send before the fader.
  await strip("Insert 3").getByRole("button", { name: "Stop sending to Insert 3" }).click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Pre-fader" }).click();
  await expect.poll(async () => (await track(1)).sends[1]).toEqual({ to: "insert_3", level: 1, preFader: true });
  await expect(strip("Insert 3").getByTestId("pre-fader")).toBeVisible();
  // Scrolled (Wide, so the strips overflow), a cable's end is on its track's send knob as soon as the scroll is (it doesn't lag a frame behind the strips).
  await page.getByRole("button", { name: "Mixer view: Compact" }).click();
  const offBy = () =>
    page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="mixer-strips"]') as HTMLElement;
      const before = scroller.scrollLeft;
      scroller.scrollLeft += 37;
      if (scroller.scrollLeft === before) return "didn't scroll";
      scroller.dispatchEvent(new Event("scroll"));
      const area = document.querySelector('[data-testid="mixer"] [role="list"]')!.getBoundingClientRect();
      const d = document.querySelector('[data-cable="insert_3"]')!.getAttribute("d")!;
      const [x] = d.trim().split(/[ ,]+/).slice(-2).map(Number);
      const knob = document.querySelector('[data-track="insert_3"] [data-send-point]')!.getBoundingClientRect();
      return Math.abs(x - (knob.left + knob.width / 2 - area.left));
    });
  expect(await offBy()).toBeLessThan(1);
  expect(await offBy()).toBeLessThan(1);
  await page.getByRole("button", { name: "Mixer view: Wide" }).click();
  await page.getByRole("button", { name: "Mixer view: Extra large" }).click();

  // Its state (an effect, its controls) copied onto insert 2: a copy of the effect, with an id of its own; not its colour or sends.
  await page.getByTestId("mixer-inspector").getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /Fake Delay/ }).first().click();
  await expect.poll(async () => (await track(1)).effects[0]?.plugin.name).toBe("Fake Delay");
  await strip("Insert 1").locator("span").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy track state" }).click();
  await strip("Insert 2").locator("span").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paste track state" }).click();
  await expect.poll(async () => (await track(2)).effects[0]?.plugin.name).toBe("Fake Delay");
  const [one, two] = [await track(1), await track(2)];
  expect(two).toMatchObject({ invert: true, swap: true, stereo: one.stereo, color: null, sends: [{ to: "master", level: 1 }] });
  expect(two.effects[0].id).not.toBe(one.effects[0].id);

  // Dragged from the menu onto another track, FL's way: its state is copied there.
  await strip("Insert 1").locator("span").first().click({ button: "right" });
  const item = page.getByRole("menuitem", { name: "Copy track state" });
  const from = (await item.boundingBox())!;
  const to = (await strip("Insert 7").locator("canvas").boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 5, to.y + 40, { steps: 10 });
  await expect(page.getByTestId("carried-state")).toContainText("drop to copy");
  await page.mouse.up();
  await expect.poll(async () => (await track(7)).effects[0]?.plugin.name).toBe("Fake Delay");
  await expect(page.getByTestId("carried-state")).toHaveCount(0);
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
  expect(mixer[1]).toMatchObject({ name: "Kick", color: "#a8403c", stereo: 1 });
  expect(mixer[1].volume).toBeCloseTo(0.635, 2);
  const verb = mixer.find((t) => t.name === "Verb")!;
  expect(mixer[2].sends).toEqual([{ to: "master", level: 1 }, { to: verb.id, level: 0.3 }]);
  expect(verb.effects[0]).toMatchObject({ mix: 0.5 });
  // Insert 3 got a copy of the reverb's effect (an id of its own).
  expect(mixer[3].effects[0]).toMatchObject({ mix: 0.5 });
  expect(mixer[3].effects[0]!.id).not.toBe(verb.effects[0]!.id);
});

test("records as FL Studio does: an input device, a track's input arms it, Record and Play record, the takes land on the Playlist", async ({ page }) => {
  const id = await openNewSong(page, "Recording");
  type Saved = { channels: { id: string; kind: string; name: string; mixerTrack: string }[]; playlist: { tracks: { name: string | null; mixerTrack: string | null }[]; clips: { kind: string; ref: string; track: number; start: number; offset: number; muted: boolean }[] } };
  const saved = async (): Promise<Saved> => savedSong(page, id);

  // Settings: the input device (the stand-in engine's interface has two inputs).
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = page.getByRole("region", { name: "Settings" });
  const device = settings.getByTestId("device-settings");
  await device.getByRole("combobox", { name: "Input device" }).click();
  await page.getByRole("option", { name: "Fake Interface" }).click();
  await expect(device).toContainText("2 inputs");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // F9: insert 1's inspector takes In 1, which arms it (its light lit, its fader orange); the engine gets it armed.
  await page.keyboard.press("F9");
  const mixer = page.getByTestId("mixer");
  const strip = mixer.locator('[data-track-name="Insert 1"]');
  await strip.locator("canvas").click();
  const input = page.getByTestId("track-input");
  const armedSent = page.waitForRequest((r) => r.url().endsWith("/api/engine/song") && (r.postDataJSON().armed ?? []).includes("insert_1"));
  await input.getByRole("combobox", { name: "Input", exact: true }).click();
  await expect(page.getByRole("option", { name: "In 1 - In 2" })).toBeVisible();
  await page.getByRole("option", { name: "In 1", exact: true }).click();
  await armedSent;
  await expect(strip.getByRole("button", { name: "Disarm Insert 1" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[1].input).toEqual({ channel: 0, stereo: false });
  // A track that takes an input is marked (FL's purple), armed or not: it's found again in a reopened song.
  await expect(strip.locator("[data-input]")).toHaveCount(1);
  await expect(mixer.locator('[data-track-name="Insert 2"] [data-input]')).toHaveCount(0);
  // Its light disarms it, and arms it again.
  await strip.getByRole("button", { name: "Disarm Insert 1" }).click();
  await strip.getByRole("button", { name: "Arm Insert 1 to record" }).click();

  // Record (R), the count-in switched off (it's on until then); Space records (the song's: song mode),
  // the button glows; Space again stops.
  const record = page.getByRole("button", { name: "Record", exact: true });
  const countIn = page.getByRole("button", { name: "Count-in", exact: true });
  await expect(countIn).toHaveAttribute("aria-pressed", "true");
  await countIn.click();
  await expect(countIn).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("r");
  await expect(record).toHaveAttribute("aria-pressed", "true");
  // (Nothing focused: Space on a focused button would press it.)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const started = page.waitForRequest((r) => r.url().endsWith("/api/engine/record"));
  await page.keyboard.press("Space");
  expect((await started).postDataJSON()).toMatchObject({ projectId: id, countIn: 0, loop: false, names: { insert_1: "Insert 1" } });
  await expect(record).toHaveAttribute("data-recording", "true");
  await page.waitForTimeout(800);
  await page.keyboard.press("Space");
  await expect(record).not.toHaveAttribute("data-recording");

  // The take: an audio clip where it began, on the first free track, on a channel of its own routed back
  // into the track that recorded it; its first 10 ms (the stand-in's latency) left out.
  await expect.poll(async () => (await saved()).playlist.clips.length).toBe(1);
  let song = await saved();
  const take = song.channels.find((c) => c.kind === "audio")!;
  expect(take).toMatchObject({ name: "Insert 1", mixerTrack: "insert_1" });
  expect(song.playlist.clips[0]).toMatchObject({ kind: "audio", ref: take.id, track: 0, start: 0, offset: 0.01, muted: false });
  // One undo step takes it away.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await saved()).playlist.clips.length).toBe(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await saved()).playlist.clips.length).toBe(1);

  // Assign to new audio track: a Playlist track for insert 1, named after it, below what's in use.
  await strip.locator("canvas").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Assign to new audio track" }).click();
  await expect.poll(async () => (await saved()).playlist.tracks[1]).toMatchObject({ name: "Insert 1", mixerTrack: "insert_1" });
  await page.keyboard.press("F5");
  const header = page.getByTestId("track-headers").locator('[data-track="1"]');
  await expect(header.getByRole("button", { name: "Disarm Insert 1" })).toBeVisible();

  // Loop record: a take each pass round the song (a bar), on the audio track and below it, all but the last muted.
  await record.click({ button: "right" });
  // (Choosing it closes the menu; Escape now would close the Playlist, the window in front.)
  await page.getByRole("menuitemcheckbox", { name: "Loop record" }).click();
  await expect(page.getByTestId("playlist-grid")).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Space");
  // The take is drawn as it records (after the count-in, which is off here), where it'll land: the audio track.
  await expect(page.getByTestId("playlist-grid")).toHaveAttribute("data-live-takes", "1");
  // At 140 BPM a bar is 1.7 s: two passes and part of a third.
  await page.waitForTimeout(4200);
  await page.keyboard.press("Space");
  await expect.poll(async () => (await saved()).playlist.clips.length, { timeout: 10_000 }).toBe(4);
  // Their files in, the clips take the place of what was drawn.
  await expect(page.getByTestId("playlist-grid")).toHaveAttribute("data-live-takes", "");
  song = await saved();
  const takes = song.playlist.clips.filter((c) => c.track > 0).sort((a, b) => a.track - b.track);
  expect(takes.map((c) => [c.track, c.start, c.muted])).toEqual([
    [1, 0, true],
    [2, 0, true],
    [3, 0, false],
  ]);
  expect(song.channels.filter((c) => c.kind === "audio").map((c) => c.name)).toEqual(["Insert 1", "Insert 1", "Insert 1 take 2", "Insert 1 take 3"]);
  await record.click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Loop record" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
});

test("Record during playback punches in at the current position without a count-in", async ({ page }) => {
  const id = await openNewSong(page, "Punch in");
  await addStarterKit(page);
  await channelButton(page, "Kick").click();
  await page.getByRole("radio", { name: "Song mode", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(500);
  const request = page.waitForRequest((r) => r.url().endsWith("/api/engine/record"));
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body).toMatchObject({ projectId: id, continuePlayback: true, countIn: 0 });
  expect(body.from).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Record", exact: true })).toHaveAttribute("data-recording", "true");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("the assistant records: an input given and armed, a take recorded and placed", async ({ page }) => {
  const id = await openNewSong(page, "Assisted recording");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      "call list_audio_inputs",
      'call update_mixer_track {"track": 2, "name": "Vox", "input": "2", "monitor": "on", "inputOffset": 5}',
      'call update_playlist_track {"track": 2, "audioTrack": "Vox"}',
      'call arm_tracks {"tracks": ["Vox"]}',
      'call arm_tracks {"tracks": [3]}',
      'call record_audio {"action": "start", "countIn": 0}',
      "call get_mixer",
      'call record_audio {"action": "stop"}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("record_audio: ok, get_mixer: ok, record_audio: ok", { timeout: 30_000 });
  // Insert 3 has no input: it can't be armed.
  await expect(panel).toContainText("arm_tracks: failed");
  const song = await expect
    .poll(async () => (await savedSong(page, id)).playlist.clips.length)
    .toBe(1)
    .then(() => savedSong(page, id));
  expect(song.mixer.tracks[2]).toMatchObject({ name: "Vox", input: { channel: 1, stereo: false }, monitor: "on", inputOffset: 5 });
  // On the audio track, its offset the latency and the input offset (10 + 5 ms).
  expect(song.playlist.clips[0]).toMatchObject({ kind: "audio", track: 1, start: 0 });
  expect(song.playlist.clips[0].offset).toBeCloseTo(0.015, 5);
});

test("MIDI keyboards play the selected channel, the typing keyboard (Ctrl+T) too, and Record keeps what's played in a pattern on the Playlist", async ({ page }) => {
  const id = await openNewSong(page, "MIDI");
  await addStarterKit(page);
  const kick = page.getByRole("button", { name: "Select Kick" });
  if ((await kick.getAttribute("aria-pressed")) !== "true") await kick.click();
  await expect(kick).toHaveAttribute("aria-pressed", "true");

  // Settings: the stand-in's keyboard is used as soon as it's there; it can be turned off and on.
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = page.getByRole("region", { name: "Settings" });
  const keyboard = settings.getByTestId("midi-settings").getByRole("switch", { name: "Use Fake Keys" });
  await expect(keyboard).toHaveAttribute("aria-checked", "true");
  await keyboard.click();
  await expect(keyboard).toHaveAttribute("aria-checked", "false");
  await keyboard.click();
  await expect(keyboard).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // Record on (R) and the count-in off, before the typing keyboard takes the letters.
  const record = page.getByRole("button", { name: "Record", exact: true });
  await page.getByRole("button", { name: "Count-in", exact: true }).click();
  await page.keyboard.press("r");
  await expect(record).toHaveAttribute("aria-pressed", "true");

  // Ctrl+T: Z plays a C on the selected channel, as a keyboard's note would (and its light blinks when the engine plays it).
  const typing = page.getByRole("button", { name: "Typing keyboard" });
  await page.keyboard.press("Control+t");
  await expect(typing).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const played = page.waitForRequest((r) => r.url().endsWith("/api/engine/midiIn"));
  await page.keyboard.down("z");
  expect((await played).postDataJSON()).toEqual({ messages: [[0x90, 60, 100]] });
  await expect(typing.locator("[data-midi-activity]")).toHaveCount(1);
  await page.keyboard.up("z");

  // What the kit's Kick has already (its steps), saved.
  type Saved = { channels: { id: string; name: string }[]; patterns: { id: string; notes: Record<string, { id: number; pitch: number; start: number }[]> }[]; playlist: { clips: { kind: string; ref: string; track: number; start: number }[] } };
  await expect.poll(async () => (await savedSong(page, id)).channels.length).toBe(4);
  const kickId = ((await savedSong(page, id)) as Saved).channels.find((c) => c.name === "Kick")!.id;
  const before = new Set((((await savedSong(page, id)) as Saved).patterns[0].notes[kickId] ?? []).map((n) => n.id));

  // Space records (no track armed: notes alone); two notes played, then Space stops.
  const started = page.waitForRequest((r) => r.url().endsWith("/api/engine/record"));
  await page.keyboard.press("Space");
  expect((await started).postDataJSON()).toMatchObject({ projectId: id, countIn: 0, notes: true, names: {} });
  await expect(record).toHaveAttribute("data-recording", "true");
  await page.waitForTimeout(300);
  await page.keyboard.down("z");
  await page.waitForTimeout(250);
  await page.keyboard.up("z");
  await page.keyboard.down("x");
  await page.waitForTimeout(250);
  await page.keyboard.up("x");
  await page.keyboard.press("Space");
  await expect(record).not.toHaveAttribute("data-recording");

  // The notes are the pattern's (it wasn't on the Playlist), a clip of it placed where recording started: one undo step.
  await expect.poll(async () => (await savedSong(page, id)).playlist.clips.length).toBe(1);
  const song: Saved = await savedSong(page, id);
  const notes = song.patterns[0].notes[kickId].filter((n) => !before.has(n.id));
  expect(notes.map((n) => n.pitch)).toEqual([60, 62]);
  expect(notes[1].start).toBeGreaterThan(notes[0].start);
  expect(song.playlist.clips[0]).toMatchObject({ kind: "pattern", ref: song.patterns[0].id, track: 0, start: 0 });
  await page.keyboard.press("Control+t");
  await expect(typing).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedSong(page, id)).playlist.clips.length).toBe(0);
  await page.keyboard.press("r");

  // The assistant: the keyboards, and the channel they play, which it selects.
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(["call list_midi_inputs", 'call select_channel {"channel": "Clap"}', 'call select_channel {"channel": "Nope"}'].join("\n"));
  await composer.press("Enter");
  await expect(panel).toContainText("list_midi_inputs: ok, select_channel: ok, select_channel: failed", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Select Clap" })).toHaveAttribute("aria-pressed", "true");
  await expect(kick).toHaveAttribute("aria-pressed", "false");
});

test("the Browser: a folder added once for every song, opened, previewed, searched, starred, by mouse and by FL's keys", async ({ page }) => {
  // A sample folder of the user's: a kit with two kicks and a snare, and a loop.
  const folder = path.resolve("e2e/.data/My Samples");
  const tone = Array.from({ length: 4800 }, (_, i) => Math.sin(i / 8) * 0.5);
  await fs.mkdir(path.join(folder, "808 Kit"), { recursive: true });
  await fs.mkdir(path.join(folder, "Loops"), { recursive: true });
  for (const name of ["808 Kit/Kick 1.wav", "808 Kit/Kick 2.wav", "808 Kit/Snare.wav", "Loops/Break.wav"]) await writeWav(path.join(folder, name), tone, 48000);
  await fs.writeFile(path.join(folder, "808 Kit/readme.txt"), "not audio");

  await openNewSong(page, "Browsing", { browser: true });
  const browser = page.getByRole("complementary", { name: "Browser" });
  const list = browser.getByTestId("browser-list");
  const item = (name: string) => list.getByRole("treeitem", { name, exact: true });
  await expect(browser).toBeVisible();

  // Added by its path from the menu (in the desktop app, dropped from Finder): it opens, folders first, audio only.
  await browser.getByRole("button", { name: "Browser menu" }).click();
  await page.getByRole("menuitem", { name: "Add a folder by its path…" }).click();
  await page.getByRole("textbox", { name: "Folder path" }).fill(folder);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(item("My Samples")).toHaveAttribute("aria-expanded", "true");
  await expect(list.getByRole("treeitem")).toHaveText(["My Samples", "808 Kit", "Loops"]);

  // A click opens a folder; a click on a file plays it (the engine says how far along), and shows its waveform.
  await item("808 Kit").click();
  await expect(list.getByRole("treeitem")).toHaveText(["My Samples", "808 Kit", "Kick 1.wav", "Kick 2.wav", "Snare.wav", "Loops"]);
  await item("Kick 1.wav").click();
  await expect(item("Kick 1.wav")).toHaveAttribute("data-playing", "true");
  await expect(browser.getByTestId("browser-waveform")).toHaveAttribute("data-loaded", "true");
  await expect(browser.getByTestId("browser-preview")).toContainText("Kick 1.wav");
  // The stand-in engine's previews last 4 s.
  await expect(item("Kick 1.wav")).not.toHaveAttribute("data-playing", "true", { timeout: 10_000 });

  // FL's keys: the arrows go from file to file, playing each; ← goes out to the folder and closes it.
  await list.focus();
  await page.keyboard.press("ArrowDown");
  await expect(item("Kick 2.wav")).toHaveAttribute("aria-selected", "true");
  await expect(item("Kick 2.wav")).toHaveAttribute("data-playing", "true");
  await page.keyboard.press("Escape");
  await expect(item("Kick 2.wav")).not.toHaveAttribute("data-playing", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(item("808 Kit")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(item("808 Kit")).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(item("808 Kit")).toHaveAttribute("aria-expanded", "true");
  // Space is still play, from the Browser too.
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.keyboard.press("Space");

  // Stars: a file, and a folder, which opens in place at the top, apart from the tree.
  await item("Snare.wav").hover();
  await item("Snare.wav").getByRole("button", { name: "Star Snare.wav" }).click();
  await item("Loops").getByRole("button", { name: "Star Loops" }).click();
  await expect(list.getByRole("treeitem").first()).toHaveText("Snare.wav");
  await item("My Samples").click();
  await expect(list.getByRole("treeitem")).toHaveText(["Snare.wav", "Loops", "My Samples"]);
  const starredLoops = list.getByRole("treeitem", { name: "Loops" }).first();
  await starredLoops.click();
  await expect(starredLoops).toHaveAttribute("aria-expanded", "true");
  await expect(list.getByRole("treeitem")).toHaveText(["Snare.wav", "Loops", "Break.wav", "My Samples"]);
  await starredLoops.click();
  await expect(list.getByRole("treeitem")).toHaveText(["Snare.wav", "Loops", "My Samples"]);
  // Settings makes it a shortcut instead: clicked, it shows the folder where it is in the tree.
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = page.getByRole("region", { name: "Settings" });
  const inPlace = settings.getByRole("switch", { name: "Open favourite folders in place" });
  await expect(inPlace).toHaveAttribute("aria-checked", "true");
  await inPlace.click();
  await expect(inPlace).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(starredLoops).not.toHaveAttribute("aria-expanded");
  await starredLoops.click();
  // (808 Kit was left open inside: it shows open again.)
  await expect(list.getByRole("treeitem")).toHaveText(["Snare.wav", "Loops", "My Samples", "808 Kit", "Kick 1.wav", "Kick 2.wav", "Snare.wav", "Loops", "Break.wav"]);
  await expect(list.getByRole("treeitem", { name: "Loops" }).last()).toHaveAttribute("aria-selected", "true");

  // Typing searches every folder, typos and all; the results are a list with each file's folder.
  await list.focus();
  await page.keyboard.type("snre");
  await expect(browser.getByRole("searchbox", { name: "Search the Browser" })).toHaveValue("snre");
  await expect(list.getByRole("treeitem")).toHaveText(["Snare.wavMy Samples/808 Kit"]);
  await page.keyboard.press("Enter");
  await expect(list.getByRole("treeitem", { name: "Snare.wav" })).toHaveAttribute("data-playing", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(browser.getByRole("searchbox", { name: "Search the Browser" })).toHaveValue("");

  // It's the same in every song, and Alt+F8 shows and hides it.
  await openNewSong(page, "Browsing again");
  await expect(item("Loops").first()).toBeVisible();
  await page.keyboard.press("Alt+F8");
  await expect(browser).toBeHidden();
  await page.keyboard.press("Alt+F8");
  await expect(browser).toBeVisible();
});

test("the Browser's files go into the song: dragged onto the rack or a channel, sent to the selected channel, tried one after another", async ({ page }) => {
  // The folder the last test added is still in the Browser: it's the same in every song.
  const id = await openNewSong(page, "From the Browser", { browser: true });
  const browser = page.getByRole("complementary", { name: "Browser" });
  const list = browser.getByTestId("browser-list");
  const item = (name: string) => list.getByRole("treeitem", { name, exact: true }).last();
  const rack = page.getByTestId("channel-rack");
  const names = async () => (await savedSong(page, id)).channels.map((c: { name: string }) => c.name);
  const sampleOf = async (index: number) => {
    const song = await savedSong(page, id);
    const media = await (await page.request.get(`/api/media?projectId=${id}`)).json();
    return media.find((m: { id: string }) => m.id === song.channels[index].sampleId)?.name;
  };
  for (const folder of ["My Samples", "808 Kit", "Loops"]) await item(folder).click();
  await expect(item("Kick 1.wav")).toBeVisible();

  // Dragged onto the rack: a new channel (the new song's empty sampler makes way for it).
  await item("Kick 1.wav").dragTo(rack);
  await expect.poll(names).toEqual(["Kick 1"]);
  // Several selected, dragged together: a channel each.
  await item("Kick 2.wav").click();
  await item("Snare.wav").click({ modifiers: ["ControlOrMeta"] });
  await item("Snare.wav").dragTo(rack);
  await expect.poll(names).toEqual(["Kick 1", "Kick 2", "Snare"]);
  // Onto a channel's button: that channel's sample.
  await item("Break.wav").dragTo(channelButton(page, "Kick 2"));
  await expect.poll(names).toEqual(["Kick 1", "Break", "Snare"]);
  await expect.poll(() => sampleOf(1)).toBe("Break.wav");

  // Enter sends the file to the selected channel; Shift+↓ tries the next ones in it, one undo step for them all.
  await page.getByRole("button", { name: "Select Snare" }).click();
  await item("Kick 1.wav").click();
  await page.keyboard.press("Enter");
  await expect.poll(() => sampleOf(2)).toBe("Kick 1.wav");
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(() => sampleOf(2)).toBe("Kick 2.wav");
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(() => sampleOf(2)).toBe("Snare.wav");
  await expect(item("Snare.wav")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => sampleOf(2)).toBe("Kick 1.wav");
  // Trying the same file again doesn't copy it again.
  const media = await (await page.request.get(`/api/media?projectId=${id}`)).json();
  expect(media.map((m: { name: string }) => m.name).sort()).toEqual(["Break.wav", "Kick 1.wav", "Kick 2.wav", "Snare.wav"]);

  // The menu: Open in new channel.
  await item("Break.wav").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in new channel" }).click();
  await expect.poll(names).toEqual(["Kick 1", "Break", "Kick 1", "Break"]);

  // Dropped on the desktop, away from the windows: a new channel, as in FL Studio.
  const desktop = page.locator("[data-desktop=music]");
  const box = (await desktop.boundingBox())!;
  await item("Kick 2.wav").dragTo(desktop, { targetPosition: { x: box.width - 40, y: box.height - 40 } });
  await expect.poll(names).toEqual(["Kick 1", "Break", "Kick 1", "Break", "Kick 2"]);
  // On the Piano roll: the sample of the channel it shows.
  await page.getByRole("button", { name: "Select Kick 2" }).click();
  await page.keyboard.press("F7");
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-channel-name", "Kick 2");
  await item("Snare.wav").dragTo(page.getByTestId("piano-roll"));
  await expect.poll(() => sampleOf(4)).toBe("Snare.wav");
  // Another channel selected, the toolbar's Piano roll button goes to it.
  await page.keyboard.press("F7");
  await expect(page.getByTestId("piano-roll")).toHaveCount(0);
  await page.getByRole("button", { name: "Select Break" }).first().click();
  await page.getByRole("button", { name: "Piano roll", exact: true }).click();
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-channel-name", "Break");
});

test("the Browser's Online tab: YouTube searched, a result heard and dragged into the song, a pasted link sent to the selected channel", async ({ page }) => {
  const id = await openNewSong(page, "From online", { browser: true });
  const browser = page.getByRole("complementary", { name: "Browser" });
  const names = async () => (await savedSong(page, id)).channels.map((c: { name: string }) => c.name);
  await browser.getByRole("tab", { name: "Online" }).click();
  const search = browser.getByRole("searchbox", { name: "Search YouTube or paste a link" });
  const results = browser.getByRole("listbox", { name: "Online results" });
  const result = (name: string) => results.getByRole("option", { name, exact: true });
  await search.fill("amen");
  await expect(result("Amen Break")).toBeVisible();
  await expect(result("Vocal Chop")).toBeVisible();

  // Pressed, it plays (its sound downloaded first), and its waveform shows below.
  await result("Amen Break").click();
  await expect(result("Amen Break")).toHaveAttribute("data-playing", "true");
  // Space pauses it (rather than playing the song); the preview bar's button goes on; pressed again, it pauses.
  // (The stand-in engine's previews last 4 s from where they start.)
  const toggle = browser.getByTestId("browser-preview-toggle");
  // (The stand-in engine is every test's: an earlier one may have left the song playing. Space mustn't change it.)
  const play = page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "Play" });
  const songPlaying = await play.getAttribute("aria-pressed");
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAccessibleName("Play the preview");
  await expect(result("Amen Break")).not.toHaveAttribute("data-playing", "true");
  await page.waitForTimeout(300);
  expect(await play.getAttribute("aria-pressed")).toBe(songPlaying);
  await toggle.click();
  await expect(result("Amen Break")).toHaveAttribute("data-playing", "true");
  await result("Amen Break").click();
  await expect(result("Amen Break")).not.toHaveAttribute("data-playing", "true");
  await expect(toggle).toHaveAccessibleName("Play the preview");
  await toggle.click();
  await expect(result("Amen Break")).toHaveAttribute("data-playing", "true");
  await expect(browser.getByTestId("browser-preview")).toContainText("Amen Break");
  await expect(browser.getByTestId("browser-waveform")).toHaveAttribute("data-loaded", "true");

  // Dragged onto the rack: a channel named after it (the new song's empty sampler makes way for it).
  await result("Vocal Chop").dragTo(page.getByTestId("channel-rack"));
  await expect.poll(names).toEqual(["Vocal Chop"]);
  // Its + opens it in another channel; the project keeps one copy of its sound.
  await result("Vocal Chop").hover();
  await browser.getByRole("button", { name: "Open Vocal Chop in a new channel" }).click();
  await expect.poll(names).toEqual(["Vocal Chop", "Vocal Chop"]);
  const media = await (await page.request.get(`/api/media?projectId=${id}`)).json();
  expect(media.map((m: { name: string }) => m.name)).toEqual(["Vocal Chop.wav"]);

  // A pasted link is looked up; Enter sends it to the selected channel, as a file's does.
  await page.getByRole("button", { name: "Select Vocal Chop" }).first().click();
  await search.fill("https://soundcloud.com/someone/pasted-sound");
  await expect(result("Pasted Sound")).toBeVisible();
  await search.press("ArrowDown");
  await expect(result("Pasted Sound")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect.poll(names).toEqual(["Pasted Sound", "Vocal Chop"]);

  // A search's results come 15 at a time: scrolled to the end, the list loads the next page, until there are no more.
  await search.fill("many results");
  await expect(result("Result 15")).toBeAttached();
  await expect
    .poll(async () => {
      await results.evaluate((e) => (e.scrollTop = e.scrollHeight));
      return results.getByRole("option").count();
    })
    .toBe(40);
  await expect(browser.getByTestId("online-more")).toHaveCount(0);
  await search.fill("https://soundcloud.com/someone/pasted-sound");
  await expect(result("Pasted Sound")).toBeVisible();

  // The Files tab is as it was; the Online tab keeps its results meanwhile.
  await browser.getByRole("tab", { name: "Files" }).click();
  await expect(browser.getByTestId("browser-list")).toBeVisible();
  await browser.getByRole("tab", { name: "Online" }).click();
  await expect(result("Pasted Sound")).toBeVisible();
});

test("the assistant searches online and samples a result: heard, then a channel and an audio clip", async ({ page }) => {
  const id = await openNewSong(page, "Assisted online", { browser: true });
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  const amen = "https://www.youtube.com/watch?v=amenbreak01";
  await composer.fill(
    [
      'call search_online_audio {"query": "amen break"}',
      `call preview_sample {"url": "${amen}"}`,
      `call load_sample {"urls": ["${amen}"]}`,
      `call add_audio_clip {"urls": ["${amen}"], "track": 1, "bar": 1}`,
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("add_audio_clip: ok", { timeout: 30_000 });
  for (const tool of ["search_online_audio", "preview_sample", "load_sample"]) await expect(panel).toContainText(`${tool}: ok`);
  // Saved a moment later, by the autosave.
  await expect.poll(async () => (await savedSong(page, id)).channels.map((c: { name: string }) => c.name)).toEqual(["Amen Break", "Amen Break"]);
  expect((await savedSong(page, id)).playlist.clips).toHaveLength(1);
  const media = await (await page.request.get(`/api/media?projectId=${id}`)).json();
  expect(media.map((m: { name: string }) => m.name)).toEqual(["Amen Break.wav"]);
});

test("the assistant finds the user's samples, plays one to them and puts them in the song", async ({ page }) => {
  const id = await openNewSong(page, "Assisted samples", { browser: true });
  const folder = path.resolve("e2e/.data/My Samples");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      "call list_samples",
      'call search_samples {"query": "kik 808"}',
      `call list_samples {"folder": ${JSON.stringify(path.join(folder, "808 Kit"))}}`,
      `call load_sample {"paths": [${JSON.stringify(path.join(folder, "808 Kit", "Kick 1.wav"))}, ${JSON.stringify(path.join(folder, "808 Kit", "Snare.wav"))}]}`,
      `call load_sample {"paths": [${JSON.stringify(path.join(folder, "808 Kit", "Kick 2.wav"))}], "channel": "Kick 1"}`,
      `call star_sample {"path": ${JSON.stringify(path.join(folder, "808 Kit", "Kick 2.wav"))}}`,
      `call load_sample {"paths": ["/etc/hosts"]}`,
      `call preview_sample {"path": ${JSON.stringify(path.join(folder, "808 Kit", "Kick 2.wav"))}}`,
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("preview_sample: ok", { timeout: 30_000 });
  await expect(panel).toContainText("star_sample: ok");
  await expect(panel).toContainText("load_sample: failed");
  await expect(panel).not.toContainText("list_samples: failed");
  await expect(panel).not.toContainText("search_samples: failed");
  await expect(panel).not.toContainText("preview_sample: failed");
  await expect.poll(async () => (await savedSong(page, id)).channels.map((c: { name: string }) => c.name)).toEqual(["Kick 2", "Snare"]);
  // The Browser shows what it did: the file it played, the one it starred.
  const list = page.getByTestId("browser-list");
  await expect(list.getByRole("treeitem", { name: "Kick 2.wav" }).first()).toHaveAttribute("data-playing", "true");
  // (Favourites come in the order they were starred: the last test starred Snare and Loops.)
  await expect(list.locator('[data-row^="f:"]')).toHaveText(["Snare.wav", "Loops", "Kick 2.wav"]);
});

/** Where a tick and a track are on the Playlist's grid, in the page (the view as it opens: 0.15 px a tick, tracks 48 px tall). */
async function playlistPoint(page: Page, tick: number, track: number) {
  const box = (await page.getByTestId("playlist-grid").boundingBox())!;
  return { x: box.x + tick * 0.15 + 2, y: box.y + track * 48 + 28 };
}
const BAR_TICKS = 384;
type SavedClip = { id: number; kind: string; ref: string; track: number; start: number; length: number | null; offset: number; muted: boolean; consolidated?: { id: string } };
const savedClips = async (page: Page, id: string): Promise<SavedClip[]> => (await savedSong(page, id)).playlist.clips;
const clipsAt = async (page: Page, id: string) => (await savedClips(page, id)).map((c) => [c.track, c.start, c.length]);

test("the Playlist, as FL Studio's: patterns drawn, painted, moved, cloned, resized, sliced, muted and deleted on tracks", async ({ page }) => {
  const id = await openNewSong(page, "Arranged");
  await addStarterKit(page);
  await expect(page.getByRole("listitem")).toHaveCount(4);
  for (const n of [1, 5, 9, 13]) await step(page, "Kick", n).click();
  // F5 opens it, filling the desktop; the Picker lists the patterns.
  await page.keyboard.press("F5");
  const playlist = page.getByTestId("playlist");
  await expect(playlist).toBeVisible();
  await expect(page.getByTestId("picker")).toContainText("Pattern 1");
  // A new song plays its pattern; the toolbar says so.
  await expect(page.getByRole("radio", { name: "Pattern mode" })).toHaveAttribute("aria-checked", "true");

  // Draw: a click on an empty track adds the pattern shown, as long as it is.
  let at = await playlistPoint(page, 0, 0);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => clipsAt(page, id)).toEqual([[0, 0, null]]);
  // Paint (B): a drag lays one after another along the track.
  await page.keyboard.press("b");
  at = await playlistPoint(page, 0, 1);
  const to = await playlistPoint(page, 3 * BAR_TICKS + 100, 1);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await savedClips(page, id)).filter((c) => c.track === 1).map((c) => c.start)).toEqual([0, 384, 768, 1152]);
  // The right button deletes, sweeping.
  at = await playlistPoint(page, 2 * BAR_TICKS + 100, 1);
  const end = await playlistPoint(page, 3 * BAR_TICKS + 100, 1);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await expect.poll(async () => (await savedClips(page, id)).filter((c) => c.track === 1).map((c) => c.start)).toEqual([0, 384]);

  // Draw (P): a clip dragged moves along the grid and to another track; with Shift, a copy moves.
  await page.keyboard.press("p");
  at = await playlistPoint(page, 150, 0);
  let target = await playlistPoint(page, 150 + 2 * BAR_TICKS, 2);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await savedClips(page, id)).find((c) => c.id === 1)).toMatchObject({ track: 2, start: 768 });
  at = await playlistPoint(page, 768 + 150, 2);
  target = await playlistPoint(page, 4 * BAR_TICKS + 150, 2);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await savedClips(page, id)).filter((c) => c.track === 2).map((c) => c.start)).toEqual([768, 1536]);

  // Its right edge resizes it: two bars long (it plays nothing past its pattern).
  at = await playlistPoint(page, 1536 + BAR_TICKS - 20, 2);
  target = await playlistPoint(page, 1536 + 2 * BAR_TICKS - 20, 2);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await savedClips(page, id)).find((c) => c.track === 2 && c.start === 1536)?.length).toBe(2 * BAR_TICKS);

  // Slice (C): a line dragged down through it cuts it in two, on the grid.
  await page.keyboard.press("c");
  at = await playlistPoint(page, 1536 + BAR_TICKS, 2);
  await page.mouse.move(at.x, at.y - 10);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y + 5, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await savedClips(page, id)).filter((c) => c.track === 2).map((c) => [c.start, c.length, c.offset])).toEqual([
    [768, null, 0],
    [1536, 384, 0],
    [1920, 384, 384],
  ]);

  // Mute (T): a click mutes a clip; it stays.
  await page.keyboard.press("t");
  at = await playlistPoint(page, 100, 1);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await savedClips(page, id)).find((c) => c.track === 1 && c.start === 0)?.muted).toBe(true);

  // Ctrl+A and Ctrl+B: everything duplicated to the right, one undo step.
  await page.keyboard.press("p");
  const before = (await savedClips(page, id)).length;
  await page.keyboard.press("ControlOrMeta+a");
  await expect(playlist).toHaveAttribute("data-selected", String(before));
  await page.keyboard.press("ControlOrMeta+b");
  await expect.poll(async () => (await savedClips(page, id)).length).toBe(before * 2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedClips(page, id)).length).toBe(before);
  // Delete with nothing selected... is everything (FL's); undone.
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await savedClips(page, id)).length).toBe(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedClips(page, id)).length).toBe(before);

  // The overview along the top (FL's mini playlist): its window's right end dragged out zooms out, the
  // left staying put; the window dragged along scrolls. (The rack, over it, closed first.)
  await page.keyboard.press("F6");
  await expect(page.getByTestId("channel-rack")).toBeHidden();
  const overview = page.getByTestId("playlist-overview-window");
  const ruler = page.getByTestId("playlist").getByLabel("Ruler");
  const shown = (await overview.boundingBox())!;
  const rulerShot = await ruler.screenshot();
  await page.mouse.move(shown.x + shown.width - 2, shown.y + shown.height / 2);
  await page.mouse.down();
  await page.mouse.move(shown.x + shown.width + 120, shown.y + shown.height / 2, { steps: 5 });
  await page.mouse.up();
  const zoomed = (await overview.boundingBox())!;
  expect(zoomed.x).toBeCloseTo(shown.x, 0);
  expect(zoomed.width).toBeGreaterThan(shown.width + 100);
  expect(await ruler.screenshot()).not.toEqual(rulerShot);
  await page.mouse.move(zoomed.x + zoomed.width / 2, zoomed.y + zoomed.height / 2);
  await page.mouse.down();
  await page.mouse.move(zoomed.x + zoomed.width / 2 + 60, zoomed.y + zoomed.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await overview.boundingBox())!.x).toBeGreaterThan(zoomed.x + 50);
  // The vertical scrollbar's bottom end pulled up: taller tracks, so its window is shorter.
  const vertical = page.getByTestId("playlist-vertical-window");
  const tall = (await vertical.boundingBox())!;
  const trackY = async (name: string) => (await playlist.getByRole("button", { name, exact: true }).boundingBox())!.y;
  const spacing = (await trackY("Track 2")) - (await trackY("Track 1"));
  await page.mouse.move(tall.x + tall.width / 2, tall.y + tall.height - 2);
  await page.mouse.down();
  await page.mouse.move(tall.x + tall.width / 2, tall.y + tall.height - 120, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await trackY("Track 2")) - (await trackY("Track 1"))).toBeGreaterThan(spacing + 15);
});

test("song mode plays the playlist: PAT / SONG, the ruler sets where it plays from, a time selection loops", async ({ page }) => {
  const id = await openNewSong(page, "Song mode");
  await addStarterKit(page);
  for (const n of [1, 5, 9, 13]) await step(page, "Kick", n).click();
  await page.keyboard.press("F5");
  for (const bar of [0, 1, 2, 3]) {
    const at = await playlistPoint(page, bar * BAR_TICKS, 0);
    await page.mouse.click(at.x + 4, at.y);
  }
  await expect.poll(async () => (await savedClips(page, id)).length).toBe(4);
  // L switches to song mode; the playlist's playhead runs while it plays.
  await page.keyboard.press("l");
  await expect(page.getByRole("radio", { name: "Song mode" })).toHaveAttribute("aria-checked", "true");
  const playlist = page.getByTestId("playlist");
  await expect(playlist).toHaveAttribute("data-loop", `0:${4 * BAR_TICKS}`);
  // (Stopped first: the stand-in engine is shared, and a test before may have left it playing.)
  const transport = page.getByRole("toolbar", { name: "Transport" });
  await transport.getByRole("button", { name: "Stop" }).click();
  await expect(transport.getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Space");
  const playhead = page.getByTestId("playlist-playhead");
  await expect(playhead).toHaveCSS("opacity", "1");
  const x0 = await playhead.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  await expect.poll(() => playhead.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41)).toBeGreaterThan(x0);
  await page.keyboard.press("Space");
  await expect(playhead).toHaveCSS("opacity", "0");

  // A click on the ruler: where the song plays from.
  const ruler = page.getByTestId("playlist").getByLabel("Ruler");
  const box = (await ruler.boundingBox())!;
  await page.mouse.click(box.x + 2 * BAR_TICKS * 0.15 + 2, box.y + 10);
  await expect(playlist).toHaveAttribute("data-start", String(2 * BAR_TICKS));
  await expect(page.getByLabel("Position", { exact: true })).toHaveText("3:01:00");
  // Ctrl+drag along it: a time selection, which is what loops.
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.move(box.x + BAR_TICKS * 0.15 + 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 3 * BAR_TICKS * 0.15 + 2, box.y + 10, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("ControlOrMeta");
  await expect(playlist).toHaveAttribute("data-loop", `${BAR_TICKS}:${2 * BAR_TICKS}`);
  // Back to pattern mode: the pattern loops.
  await page.getByRole("radio", { name: "Pattern mode" }).click();
  await expect(playlist).toHaveAttribute("data-loop", `0:${BAR_TICKS}`);
  // A song with clips opens in song mode.
  await page.reload();
  await expect(page.getByRole("radio", { name: "Song mode" })).toHaveAttribute("aria-checked", "true");
});

test("split by channel turns a beat into a pattern per channel, each on its own track; undo brings the beat back", async ({ page }) => {
  const id = await openNewSong(page, "Split");
  await addStarterKit(page);
  for (const n of [1, 5, 9, 13]) await step(page, "Kick", n).click();
  for (const n of [3, 7, 11, 15]) await step(page, "Hat", n).click();
  await step(page, "Snare", 5).click();
  await page.keyboard.press("F5");
  const at = await playlistPoint(page, 0, 0);
  await page.mouse.click(at.x + 4, at.y);
  await expect.poll(async () => (await savedClips(page, id)).length).toBe(1);
  // The Picker's menu (as FL's pattern menu): Split by channel.
  await page.getByTestId("picker").getByRole("button", { name: "Pattern 1" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Split by channel" }).click();
  await expect.poll(async () => (await savedSong(page, id)).patterns.map((p: { name: string }) => p.name)).toEqual(["Kick", "Hat", "Snare"]);
  const song = await savedSong(page, id);
  expect(song.playlist.clips.map((c: SavedClip) => [c.track, c.start])).toEqual([
    [0, 0],
    [1, 0],
    [2, 0],
  ]);
  expect(Object.keys(song.patterns[1].notes)).toEqual([song.channels[2].id]);
  await expect(page.getByTestId("picker")).toContainText("Snare");
  const picker = page.getByTestId("picker");
  // Several selected and dragged onto a track: each starts there, a track under the one before.
  await picker.getByRole("button", { name: "Kick" }).click();
  await picker.getByRole("button", { name: "Snare" }).click({ modifiers: ["Shift"] });
  await expect(picker.locator("[data-picker-item][aria-pressed=true]")).toHaveCount(3);
  await picker.getByRole("button", { name: "Kick" }).dragTo(page.getByTestId("playlist-grid"), { targetPosition: { x: 4 * BAR_TICKS * 0.15 + 2, y: 48 + 28 } });
  await expect
    .poll(async () => (await savedClips(page, id)).filter((c) => c.start === 4 * BAR_TICKS).map((c) => [c.track, (song.patterns as { id: string; name: string }[]).find((p) => p.id === c.ref)?.name]))
    .toEqual([
      [1, "Kick"],
      [2, "Hat"],
      [3, "Snare"],
    ]);
  // Dropped in, they're selected.
  await expect(page.getByTestId("playlist")).toHaveAttribute("data-selected", "3");
  // ⌘+click on a clip selects it alone; ⌘+drag starting on a clip is still a rectangle.
  const first = await playlistPoint(page, 4 * BAR_TICKS + 40, 1);
  const last = await playlistPoint(page, 4 * BAR_TICKS + 80, 3);
  const middle = await playlistPoint(page, 4 * BAR_TICKS + 40, 2);
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.click(middle.x, middle.y);
  await expect(page.getByTestId("playlist")).toHaveAttribute("data-selected", "1");
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(last.x, last.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("ControlOrMeta");
  await expect(page.getByTestId("playlist")).toHaveAttribute("data-selected", "3");
  // A press away from the Picker's items lets go of them (the clip source alone stays marked).
  await picker.getByRole("tab", { name: /Patterns/ }).click();
  await expect(picker.locator("[data-picker-item][aria-pressed=true]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedClips(page, id)).length).toBe(3);
  // All three selected (Shift+click) and deleted: an empty Pattern 1 is left, as a new song has.
  await picker.getByRole("button", { name: "Kick" }).click();
  await picker.getByRole("button", { name: "Snare" }).click({ modifiers: ["Shift"] });
  await picker.getByRole("button", { name: "Hat" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete 3 patterns" }).click();
  await expect.poll(async () => (await savedSong(page, id)).patterns.map((p: { name: string }) => p.name)).toEqual(["Pattern 1"]);
  expect(await savedClips(page, id)).toEqual([]);
  // The Picker's other tab: the audio clips (none yet).
  await picker.getByRole("tab", { name: /Audio clips/ }).click();
  await expect(picker).toContainText("No audio clips yet");
  await picker.getByRole("tab", { name: /Patterns/ }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedSong(page, id)).patterns.map((p: { name: string }) => p.name)).toEqual(["Kick", "Hat", "Snare"]);
  // One undo step: the beat, and its one clip, are back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedSong(page, id)).patterns.map((p: { name: string }) => p.name)).toEqual(["Pattern 1"]);
  expect((await savedClips(page, id)).length).toBe(1);
});

test("a clip's menu, from the arrow at the start of its title: make unique, rename and color, chop, mute, delete", async ({ page }) => {
  const id = await openNewSong(page, "Clip menu");
  await addStarterKit(page);
  for (const n of [1, 5, 9, 13]) await step(page, "Kick", n).click();
  await page.keyboard.press("F5");
  for (const bar of [0, 1]) {
    const at = await playlistPoint(page, bar * BAR_TICKS, 0);
    await page.mouse.click(at.x + 4, at.y);
  }
  await expect.poll(async () => (await savedClips(page, id)).length).toBe(2);
  const box = (await page.getByTestId("playlist-grid").boundingBox())!;
  const arrow = { x: box.x + BAR_TICKS * 0.15 + 10, y: box.y + 6 };
  const menu = page.getByTestId("clip-menu");
  // Make unique: the second clip plays a copy of the pattern of its own.
  await page.mouse.click(arrow.x, arrow.y);
  await menu.getByRole("menuitem", { name: "Make unique" }).click();
  await expect.poll(async () => (await savedSong(page, id)).patterns.map((p: { name: string }) => p.name)).toEqual(["Pattern 1", "Pattern 1 #2"]);
  const [first, second] = await savedClips(page, id);
  expect(first.ref).not.toBe(second.ref);
  // Rename and color: its pattern's name and colour, which its clips and its Picker item take.
  await page.mouse.click(arrow.x, arrow.y);
  await menu.getByRole("menuitem", { name: "Rename and color…" }).click();
  const box2 = page.getByTestId("rename-and-color");
  await box2.getByRole("textbox", { name: "Pattern name" }).fill("Chorus");
  await box2.getByRole("radio", { name: "#3f8a4c" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await savedSong(page, id)).patterns[1]).toMatchObject({ name: "Chorus", color: "#3f8a4c" });
  await expect(page.getByTestId("picker").getByRole("button", { name: "Chorus" })).toBeVisible();
  // Chop into beats: four clips where the bar's one was.
  await page.mouse.click(arrow.x, arrow.y);
  await menu.getByRole("menuitem", { name: "Chop" }).hover();
  await page.getByRole("menuitem", { name: "Every beat" }).click();
  await expect.poll(async () => (await savedClips(page, id)).map((c) => [c.start, c.length])).toEqual([
    [0, null],
    [BAR_TICKS, BAR_TICKS / 4],
    [BAR_TICKS * 1.25, BAR_TICKS / 4],
    [BAR_TICKS * 1.5, BAR_TICKS / 4],
    [BAR_TICKS * 1.75, BAR_TICKS / 4],
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedClips(page, id)).length).toBe(2);
  // Mute, then delete.
  await page.mouse.click(arrow.x, arrow.y);
  await menu.getByRole("menuitem", { name: "Mute" }).click();
  await expect.poll(async () => (await savedClips(page, id))[1].muted).toBe(true);
  await page.mouse.click(arrow.x, arrow.y);
  await menu.getByRole("menuitem", { name: "Delete" }).click();
  await expect.poll(async () => (await savedClips(page, id)).length).toBe(1);
});

test("tracks are named, coloured, muted and soloed; audio files dropped on the playlist are audio clips, in the rack's Audio group", async ({ page }) => {
  const id = await openNewSong(page, "Tracks and audio", { browser: true });
  await page.keyboard.press("F5");
  const headers = page.getByTestId("track-headers");
  const header = (n: number) => headers.locator(`[data-track="${n - 1}"]`);
  // Double-click a header's name: rename it.
  await header(1).getByRole("button", { name: "Track 1", exact: true }).dblclick();
  await page.getByRole("textbox", { name: "Track name" }).fill("Drums");
  await page.keyboard.press("Enter");
  await expect(header(1)).toHaveAttribute("data-track-name", "Drums");
  // The mute light; a right-click on it solos.
  await header(2).getByRole("button", { name: "Mute Track 2" }).click();
  await expect(header(2)).toHaveAttribute("data-muted", "true");
  await header(3).getByRole("button", { name: "Mute Track 3" }).click({ button: "right" });
  await expect(header(2)).toHaveAttribute("data-muted", "true");
  await expect(header(1)).toHaveAttribute("data-muted", "true");
  await expect(header(3)).not.toHaveAttribute("data-muted");
  // Its menu: a colour.
  await header(1).click({ button: "right", position: { x: 40, y: 30 } });
  await page.getByRole("menuitem", { name: "Change color" }).hover();
  await page.getByRole("menuitem", { name: "#3f5ea8" }).click();
  await expect.poll(async () => (await savedSong(page, id)).playlist.tracks[0]).toMatchObject({ name: "Drums", color: "#3f5ea8", muted: true });

  // A file of the Browser dropped on track 3 at bar 2: an audio clip, with a channel of its own.
  const list = page.getByRole("complementary", { name: "Browser" }).getByTestId("browser-list");
  const item = (name: string) => list.getByRole("treeitem", { name, exact: true }).last();
  for (const folder of ["My Samples", "Loops"]) if (!(await item("Break.wav").isVisible())) await item(folder).click();
  await expect(item("Break.wav")).toBeVisible();
  const grid = page.getByTestId("playlist-grid");
  await item("Break.wav").dragTo(grid, { targetPosition: { x: BAR_TICKS * 0.15 + 4, y: 2 * 48 + 24 } });
  await expect.poll(async () => (await savedClips(page, id)).map((c) => [c.kind, c.track, c.start])).toEqual([["audio", 2, BAR_TICKS]]);
  const song = await savedSong(page, id);
  expect(song.channels.find((c: { kind: string }) => c.kind === "audio")).toMatchObject({ name: "Break" });
  // The rack keeps it in its Audio group: Unsorted (the default) shows the rest, All shows everything.
  await page.getByRole("button", { name: "Channel rack", exact: true }).click();
  const rack = page.getByTestId("channel-rack");
  await expect(rack.locator('[data-channel-name="Break"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Channel group" }).click();
  await page.getByRole("menuitemradio", { name: "Audio" }).click();
  await expect(rack.locator('[role=listitem][data-channel-name="Break"]')).toHaveCount(1);
  await expect(rack.locator('[role=listitem][data-channel-name="Sampler"]')).toHaveCount(0);
  // It has steps, as FL's audio clip channels do: one put on plays its file from the pattern.
  await step(page, "Break", 1).click();
  await expect.poll(async () => Object.values((await savedSong(page, id)).patterns[0].notes as Record<string, unknown[]>).map((n) => n.length)).toEqual([1]);
  await page.getByRole("button", { name: "Channel group" }).click();
  await page.getByRole("menuitemradio", { name: "All" }).click();
  await expect(rack.locator("[role=listitem][data-channel]")).toHaveCount(2);
  // A double-click on the clip opens its channel's settings: pitch, but no envelope.
  await page.getByRole("button", { name: "Close Channel rack" }).click();
  // (Break.wav is a tenth of a second: a clip three pixels wide.)
  await grid.dblclick({ position: { x: BAR_TICKS * 0.15 + 1.5, y: 2 * 48 + 30 } });
  const settings = page.locator('[data-testid="channel-settings"][data-channel-name="Break"]');
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("slider", { name: "Pitch" })).toBeVisible();
  await expect(settings.getByRole("tab", { name: "Envelope" })).toHaveCount(0);
});

test("an audio clip's own fades and gain are dragged on it, and reset from its menu", async ({ page }) => {
  // A four-second loop in the user's samples.
  const folder = path.resolve("e2e/.data/My Samples/Loops");
  await fs.mkdir(folder, { recursive: true });
  await writeWav(path.join(folder, "Pad 90bpm.wav"), Array.from({ length: 4 * 48000 }, (_, i) => Math.sin(i / 8) * 0.5), 48000);
  const id = await openNewSong(page, "Clip shapes", { browser: true });
  await page.keyboard.press("F5");
  const list = page.getByRole("complementary", { name: "Browser" }).getByTestId("browser-list");
  const item = (name: string) => list.getByRole("treeitem", { name, exact: true }).last();
  for (const name of ["My Samples", "Loops"]) if (!(await item("Pad 90bpm.wav").isVisible())) await item(name).click();
  const grid = page.getByTestId("playlist-grid");
  await item("Pad 90bpm.wav").dragTo(grid, { targetPosition: { x: 2, y: 24 } });
  await expect.poll(async () => (await savedClips(page, id)).map((c) => [c.kind, c.track, c.start])).toEqual([["audio", 0, 0]]);
  type Shaped = SavedClip & { fadeIn?: number; gain?: number; length: number };
  const clip = async () => (await savedClips(page, id))[0] as Shaped;
  const box = (await grid.boundingBox())!;
  const length = (await clip()).length;
  const width = length * 0.15;
  const drag = async (fromX: number, fromY: number, dx: number, dy: number) => {
    await page.mouse.move(box.x + fromX, box.y + fromY);
    await page.mouse.down();
    await page.mouse.move(box.x + fromX + dx, box.y + fromY + dy, { steps: 8 });
    await page.mouse.up();
  };

  // The fade in's corner, at the top of its body (just inside its start), dragged along it.
  await drag(8, 16, 40, 0);
  await expect.poll(async () => (await clip()).fadeIn ?? 0).toBeGreaterThan(0);
  // Its gain's half-circle, in the middle of its bottom edge, dragged up: louder, in dB.
  await drag(width / 2, 43, 0, -30);
  await expect.poll(async () => (await clip()).gain ?? 1).toBeGreaterThan(1.5);
  // One undo step each.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await clip()).gain).toBeUndefined();

  // Its menu: Reset fades and gain.
  await page.mouse.click(box.x + 10, box.y + 6);
  await page.getByTestId("clip-menu").getByRole("menuitem", { name: "Reset fades and gain" }).click();
  await expect.poll(async () => (await clip()).fadeIn).toBeUndefined();
});

test("time markers on the ruler (Alt+T): named, dragged, made a Start recording marker; clips rendered as an audio clip, a track consolidated and unconsolidated", async ({ page }) => {
  const id = await openNewSong(page, "Markers and bounces");
  await addStarterKit(page);
  for (const n of [1, 5, 9, 13]) await step(page, "Kick", n).click();
  await page.keyboard.press("F5");
  const at = await playlistPoint(page, 0, 0);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => clipsAt(page, id)).toEqual([[0, 0, null]]);
  type SavedMarker = { tick: number; name: string; kind: string };
  const markers = async (): Promise<SavedMarker[]> => (await savedSong(page, id)).playlist.markers ?? [];

  // Alt+T: a marker where the song plays from, named as it's added.
  await page.keyboard.press("Alt+t");
  await page.getByRole("textbox", { name: "Marker name" }).fill("Chorus");
  await page.keyboard.press("Enter");
  await expect.poll(markers).toEqual([{ id: expect.any(Number), tick: 0, name: "Chorus", kind: "marker" }]);
  // Dragged along the band at the ruler's bottom.
  const ruler = (await page.getByTestId("playlist").getByLabel("Ruler").boundingBox())!;
  const band = ruler.y + ruler.height - 4;
  await page.mouse.move(ruler.x + 6, band);
  await page.mouse.down();
  await page.mouse.move(ruler.x + 6 + BAR_TICKS * 0.15, band, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await markers())[0].tick).toBe(BAR_TICKS);
  // Its right-click menu: a Start recording marker (punch in).
  await page.mouse.click(ruler.x + BAR_TICKS * 0.15 + 6, band, { button: "right" });
  await page.getByTestId("marker-menu").getByRole("menuitemradio", { name: "Start recording" }).click();
  await expect.poll(async () => (await markers())[0].kind).toBe("punchIn");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await markers())[0].kind).toBe("marker");

  // The clip menu's Render as audio clip: an audio clip of it on the track below, the pattern left as it was.
  const grid = (await page.getByTestId("playlist-grid").boundingBox())!;
  await page.mouse.click(grid.x + 10, grid.y + 6);
  await page.getByTestId("clip-menu").getByRole("menuitem", { name: "Render as audio clip" }).click();
  await expect.poll(async () => (await savedClips(page, id)).map((c) => [c.kind, c.track, c.start, c.muted])).toEqual([
    ["pattern", 0, 0, false],
    ["audio", 1, 0, false],
  ]);
  // Consolidate this track (its header's menu): rendered into an audio clip in the pattern's place, the pattern inside it.
  const firstTrack = async () => {
    const song = await savedSong(page, id);
    return (song.playlist.clips as SavedClip[]).filter((c) => c.track === 0).map((c) => [c.kind, c.start, c.consolidated ? song.playlist.consolidations[c.consolidated.id].length : 0]);
  };
  await page.getByTestId("track-headers").locator('[data-track="0"]').click({ button: "right", position: { x: 40, y: 30 } });
  await page.getByRole("menuitem", { name: "Consolidate this track" }).click();
  await expect.poll(firstTrack).toEqual([["audio", 0, 1]]);
  // Its menu's Unconsolidate: the pattern back where it was.
  await page.mouse.click(grid.x + 10, grid.y + 6);
  await page.getByTestId("clip-menu").getByRole("menuitem", { name: "Unconsolidate" }).click();
  await expect.poll(firstTrack).toEqual([["pattern", 0, 0]]);
  // Ctrl+Alt+C consolidates the selection (the pattern, selected as it came back); one undo step brings it back.
  await page.keyboard.press("ControlOrMeta+Alt+c");
  await expect.poll(firstTrack).toEqual([["audio", 0, 1]]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(firstTrack).toEqual([["pattern", 0, 0]]);
});

test("audio clips stretch as FL Studio's: with Stretch on (Shift+M) an edge stretches the sound, the clip menu's and the channel's Time stretching", async ({ page }) => {
  // A song at 120 BPM with a four-second loop on track 1: two bars.
  const { id } = await (await page.request.post("/api/projects", { data: { suite: "music", name: "Stretched" } })).json();
  const file = path.resolve("e2e/.data/stretch-loop.wav");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeWav(file, Array.from({ length: 4 * 48000 }, (_, i) => Math.sin(i / 8) * 0.5), 48000);
  const asset = await (await page.request.post("/api/media/import-file", { data: { projectId: id, path: file } })).json();
  const song = await savedSong(page, id);
  song.settings.tempo = 120;
  song.channels.push({ id: "chan_loop", name: "Loop", kind: "audio", sampleId: asset.id });
  song.playlist.clips = [{ id: 1, kind: "audio", ref: "chan_loop", track: 0, start: 0, length: 2 * BAR_TICKS, offset: 0, muted: false }];
  expect((await page.request.put(`/api/projects/${id}`, { data: song })).ok()).toBe(true);
  await page.goto(`/p/${id}`);
  await expect(page.getByTestId("playlist")).toBeVisible();
  await page.getByRole("button", { name: "Close Channel rack" }).click();
  const clip = async () => (await savedClips(page, id))[0] as SavedClip & { stretch?: { mode: string; tempo: number | null } };

  // The toolbar's Stretch button turns it on (Shift+M too).
  const stretchButton = page.getByRole("button", { name: "Stretch", exact: true });
  await stretchButton.click();
  await expect(stretchButton).toHaveAttribute("aria-pressed", "true");
  // Its end dragged from bar 3 to bar 5: the same four seconds over four bars, its pitch kept (Settings' Stretch mode).
  const end = await playlistPoint(page, 2 * BAR_TICKS, 0);
  const to = await playlistPoint(page, 4 * BAR_TICKS, 0);
  await page.mouse.move(end.x - 4, end.y);
  await page.mouse.down();
  await page.mouse.move(to.x - 10, to.y, { steps: 5 });
  await page.mouse.move(to.x - 2, to.y, { steps: 2 });
  await page.mouse.up();
  await expect.poll(clip).toMatchObject({ length: 4 * BAR_TICKS, offset: 0, stretch: { mode: "stretch", tempo: 240 } });
  // One undo step takes it back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await clip()).stretch).toBeUndefined();
  await expect.poll(async () => (await clip()).length).toBe(2 * BAR_TICKS);
  // Shift+M turns it off again.
  await page.keyboard.press("Shift+M");
  await expect(stretchButton).toHaveAttribute("aria-pressed", "false");

  // The clip menu's Stretch: the file in one bar, twice as fast.
  const box = (await page.getByTestId("playlist-grid").boundingBox())!;
  await page.mouse.click(box.x + 10, box.y + 6);
  const menu = page.getByTestId("clip-menu");
  await menu.getByRole("menuitem", { name: "Stretch", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Beats / bars" }).hover();
  await page.getByRole("menuitem", { name: "1 bar", exact: true }).click();
  await expect.poll(clip).toMatchObject({ length: BAR_TICKS, stretch: { mode: "stretch", tempo: 60 } });

  // Its channel's Time stretching (a double-click on the clip): Resample, which the clip, with its own, doesn't follow.
  // Selecting the clip through its menu can reveal the source channel's rack over this spot.
  const closeRack = page.getByRole("button", { name: "Close Channel rack" });
  if (await closeRack.isVisible()) await closeRack.click();
  await page.getByTestId("playlist-grid").dblclick({ position: { x: 30, y: 30 } });
  const settings = page.locator('[data-testid="channel-settings"][data-channel-name="Loop"]');
  // Its waveform pressed plays the file as its clips sound: through its channel's mixer track.
  const heard = page.waitForRequest((r) => r.url().endsWith("/api/engine/previewSample"));
  await settings.getByRole("button", { name: "Hear the sample" }).click();
  expect((await heard).postDataJSON()).toMatchObject({ sampleId: expect.any(String), channel: "chan_loop" });
  await settings.getByRole("switch", { name: "Resample" }).click();
  await expect.poll(async () => (await savedSong(page, id)).channels.find((c: { id: string }) => c.id === "chan_loop")?.stretch).toEqual({ mode: "resample", tempo: null });
  await settings.getByRole("button", { name: "Time" }).click();
  await page.getByRole("menuitem", { name: "Project tempo" }).click();
  await expect.poll(async () => (await savedSong(page, id)).channels.find((c: { id: string }) => c.id === "chan_loop")?.stretch).toEqual({ mode: "resample", tempo: 120 });
  await expect.poll(clip).toMatchObject({ length: BAR_TICKS, stretch: { tempo: 60 } });

  // The assistant hears its tempo and stretches it (a 90 BPM loop in a 120 BPM song).
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(['call detect_tempo {"audio": "Loop"}', 'call stretch_audio {"ids": [1], "tempo": 90}', 'call stretch_audio {"audio": "Loop", "length": 2}'].join("\n"));
  await composer.press("Enter");
  await expect(panel).toContainText("detect_tempo: ok, stretch_audio: ok, stretch_audio: failed", { timeout: 30_000 });
  await expect.poll(clip).toMatchObject({ stretch: { mode: "stretch", tempo: 90 } });
});

test("the assistant arranges the song with the playlist's tools", async ({ page }) => {
  const id = await openNewSong(page, "Assisted arrangement");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_channel {"kit": "kick"}',
      'call add_channel {"kit": "hat"}',
      'call set_steps {"channel": "Kick", "steps": "x---x---x---x---"}',
      'call set_steps {"channel": "Hat", "steps": "--x-"}',
      'call place_clips {"clips": [{"pattern": "Pattern 1", "track": 1, "bar": 1, "repeat": 4}]}',
      'call split_by_channel {"pattern": "Pattern 1"}',
      'call update_playlist_track {"track": 2, "name": "Hats", "muted": true}',
      'call update_clips {"ids": [999]}',
      'call play_song {"action": "play", "mode": "song", "bar": 2}',
      "call get_playlist",
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("update_clips: failed, play_song: ok, get_playlist: ok", { timeout: 30_000 });
  await expect.poll(async () => (await savedSong(page, id)).patterns.map((p: { name: string }) => p.name)).toEqual(["Kick", "Hat"]);
  const song = await savedSong(page, id);
  expect(song.playlist.clips.map((c: SavedClip) => [c.track, c.start])).toEqual([
    [0, 0],
    [1, 0],
    [0, 384],
    [1, 384],
    [0, 768],
    [1, 768],
    [0, 1152],
    [1, 1152],
  ]);
  expect(song.playlist.tracks[1]).toMatchObject({ name: "Hats", muted: true });
  // It plays the song, from bar 2.
  await expect(page.getByRole("radio", { name: "Song mode" })).toHaveAttribute("aria-checked", "true");
  const transport = page.getByRole("toolbar", { name: "Transport" });
  await expect(transport.getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "true");
  // Stopped by the button (the chat's box has the keys), so the next tests find the engine quiet.
  await transport.getByRole("button", { name: "Stop" }).click();
  await expect(transport.getByRole("button", { name: "Play" })).toHaveAttribute("aria-pressed", "false");
});

test("exports the song as FL Studio does: ⌘R opens the export window, it renders while the song is edited, the files download", async ({ page }) => {
  const id = await openNewSong(page, "Export me");
  await addStarterKit(page);
  for (const n of [1, 5, 9, 13]) await step(page, "Kick", n).click();

  // ⌘R: the export window, with WAV ticked (a browser has no save dialog: the files are downloaded).
  await page.keyboard.press("ControlOrMeta+r");
  const win = page.getByRole("region", { name: "Export" });
  await expect(win).toBeVisible();
  const formats = win.getByRole("toolbar", { name: "Formats" });
  await expect(formats.getByRole("button", { name: "WAV" })).toHaveAttribute("aria-pressed", "true");
  await win.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: "Pattern" }).click();
  // One bar at 140 BPM.
  await expect(win.getByTestId("export-estimate")).toContainText("1 bar");
  // A mix over full scale is turned down rather than clipped, unless that's turned off.
  await expect(win.getByRole("switch", { name: "Keep it from clipping" })).toBeChecked();
  await expect(win.getByTestId("export-estimate")).toContainText("0:01");

  // Start: it renders (the stand-in takes a second and a half), playing waits, editing doesn't.
  const downloaded = page.waitForEvent("download");
  await win.getByRole("button", { name: "Start" }).click();
  await expect(win.getByTestId("export-progress")).toContainText(/Rendering|Encoding/);
  await page.keyboard.press("Escape");
  await expect(win).toBeVisible();
  await page.getByTestId("channel-rack").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Space");
  await expect(page.getByText("Playback comes back as soon as the export is done.")).toBeVisible();
  await step(page, "Kick", 3).click();
  const kicks = async () => {
    const song = await savedSong(page, id);
    return song.patterns[0].notes[song.channels.find((c: { name: string }) => c.name === "Kick")?.id]?.length ?? 0;
  };
  await expect.poll(kicks).toBe(5);

  // Done: the one file downloads by itself, named after the song.
  expect((await downloaded).suggestedFilename()).toBe("Export me.wav");
  await expect(win.getByTestId("export-progress")).toContainText("Exported");
  await expect(win.getByRole("list", { name: "Exported files" })).toContainText("Export me.wav");

  // Again, as an MP3 and the notes: several files, each downloaded from the list.
  await win.getByRole("button", { name: "Export again" }).click();
  for (const name of ["WAV", "MP3", "MIDI"]) await formats.getByRole("button", { name }).click();
  await expect(win.getByRole("combobox", { name: "MP3 bitrate" })).toHaveText("320 kb/s");
  await win.getByRole("button", { name: "Start" }).click();
  const files = win.getByRole("list", { name: "Exported files" });
  await expect(files).toContainText("Export me.mp3");
  await expect(files).toContainText("Export me.mid");
  const mp3 = page.waitForEvent("download");
  await win.getByRole("button", { name: "Download Export me.mp3" }).click();
  expect((await mp3).suggestedFilename()).toBe("Export me.mp3");
  await win.getByRole("button", { name: "Done" }).click();
  await expect(win).toBeHidden();

  // The settings are remembered for the next export.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("region", { name: "Export" }).getByRole("combobox", { name: "MP3 bitrate" })).toBeVisible();
});

test("the assistant exports the song: the export window opens and lists what it made", async ({ page }) => {
  await openNewSong(page, "Assisted export");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(['call add_channel {"kit": "kick"}', 'call set_steps {"channel": "Kick", "steps": "x---x---x---x---"}', 'call export_song {"formats": ["mp3", "mid"], "mode": "pattern", "mp3Bitrate": 192}', 'call export_song {"formats": ["aiff"]}'].join("\n"));
  await composer.press("Enter");
  await expect(panel).toContainText("export_song: ok, export_song: failed", { timeout: 30_000 });
  const files = page.getByRole("region", { name: "Export" }).getByRole("list", { name: "Exported files" });
  await expect(files).toContainText("Assisted export.mp3");
  await expect(files).toContainText("Assisted export.mid");
});

test("Make visualizer: File › Make Visualizer… makes a video of the song, which opens in a tab: the mix, the notes as hits, the exact beat, a look", async ({ page }) => {
  const songId = await openNewSong(page, "Visualize me");
  await addStarterKit(page);
  for (const n of [1, 5, 9, 13]) await step(page, "Kick", n).click();
  await page.locator('[data-menu="file"]').click();
  await page.getByRole("menuitem", { name: "Make Visualizer…" }).click();
  const win = page.getByRole("region", { name: "Make visualizer" });
  await expect(win).toBeVisible();
  // Everything plays straight into the master: no stems, said why; the kick's notes, its role guessed.
  await expect(win.getByRole("region", { name: "Stems" })).toContainText("No mixer track has a sound of its own");
  await expect(win).toContainText("straight into the master");
  await expect(win.getByTestId(/visualizer-choice-/)).toHaveCount(1);
  await expect(win.getByRole("combobox", { name: "What Kick is" })).toContainText("Kick");
  await win.getByRole("radio", { name: /^Bars/ }).click();
  await win.getByRole("radio", { name: "1:1" }).click();
  await win.getByRole("button", { name: "Make visualizer", exact: true }).click();

  // The video opens in a tab of its own.
  await expect(page.getByRole("button", { name: "Video settings", exact: true })).toHaveText("1:1 · 30 fps", { timeout: 30_000 });
  await expect(page).not.toHaveURL(new RegExp(songId));
  await expect(page.getByRole("tablist", { name: "Open projects" }).getByRole("tab", { name: "Visualize me" })).toHaveCount(2);
  const videoId = new URL(page.url()).pathname.split("/").pop()!;
  const video = await savedSong(page, videoId);
  expect(video.name).toBe("Visualize me");
  expect(video.settings.aspectRatio).toBe("1:1");
  expect(video.tracks.filter((t: { kind: string }) => t.kind === "audio").map((t: { name: string }) => t.name)).toEqual(["Mix"]);
  // A kick on every beat: its hits fall on the song's beat, exactly.
  const beat = 60 / (await savedSong(page, songId)).settings.tempo;
  expect(video.signals).toEqual([expect.objectContaining({ name: "Kick", role: "kick", kind: "events" })]);
  expect(video.signals[0].events.map((e: { time: number }) => e.time)).toEqual([0, 1, 2, 3].map((k) => Math.round(k * beat * 1e4) / 1e4));
  expect(video.tempo.beats[1]).toBeCloseTo(beat, 4);
  expect(video.clips.some((c: { effects: { type: string }[] }) => c.effects.some((e) => e.type === "audio-bars"))).toBe(true);
  // The song is still where it was, a tab away.
  await page.goto(`/p/${songId}`);
  await expect(page.locator('[data-suite="music"]')).toBeVisible();
});

test("the assistant makes a visualizer: a stem of the kick's insert, a channel's role given, the video among the user's projects", async ({ page }) => {
  await openNewSong(page, "Assisted video");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_channel {"kit": "kick"}',
      'call add_channel {"kit": "snare", "name": "Thing"}',
      'call set_steps {"channel": "Kick", "steps": "x---x---x---x---"}',
      'call set_steps {"channel": "Thing", "steps": "----x-------x---"}',
      'call route_channels {"channels": ["Kick"], "track": 1}',
      'call make_visualizer {"look": "wave", "roles": [{"ref": "Thing", "role": "snare"}]}',
      'call make_visualizer {"look": "disco"}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("make_visualizer: ok, make_visualizer: failed", { timeout: 30_000 });
  // It stays on the song; the video is on Home.
  await expect(page.locator('[data-suite="music"]')).toBeVisible();
  const projects: { id: string; suite: string; name: string }[] = await (await page.request.get("/api/projects")).json();
  const made = projects.find((p) => p.suite === "video" && p.name === "Assisted video")!;
  const video = await savedSong(page, made.id);
  expect(video.tracks.filter((t: { kind: string }) => t.kind === "audio").map((t: { name: string; muted: boolean }) => [t.name, t.muted])).toEqual([
    ["Mix", false],
    ["Insert 1", true],
  ]);
  expect(video.signals.map((s: { name: string; role?: string }) => [s.name, s.role])).toEqual([
    ["Kick", "kick"],
    ["Thing", "snare"],
  ]);
});

/** Where a value is on an automation clip's curve, on a playlist track (the Playlist's usual zoom, scrolled to its start). */
async function curvePoint(page: Page, tick: number, value: number, track: number) {
  const box = (await page.getByTestId("playlist-grid").boundingBox())!;
  // Under the clip's 13 px title: the curve keeps 3 px top and bottom of the 33 px left.
  return { x: box.x + tick * 0.15, y: box.y + track * 48 + 13 + 3 + (1 - value) * 27 };
}
type SavedAutomation = { id: string; name: string; target: Record<string, unknown>; length: number; points: { tick: number; value: number; curve: string }[]; lfo: { enabled: boolean } };
const savedAutomations = async (page: Page, id: string): Promise<SavedAutomation[]> => (await savedSong(page, id)).automations;

test("automation, as FL Studio's: a knob makes a clip, its curve is shaped on the Playlist, the knob follows it in song mode and the hand wins while it's held", async ({ page }) => {
  const id = await openNewSong(page, "Automated");
  await addStarterKit(page);
  await expect(page.getByRole("listitem")).toHaveCount(4);
  await expect.poll(async () => (await savedSong(page, id)).channels.map((c: { name: string }) => c.name)).toEqual(["Kick", "Clap", "Hat", "Snare"]);
  const kickId = (await savedSong(page, id)).channels[0].id;

  // A knob's menu: Create automation clip. A clip of it covers the song (four bars, at least), flat at the knob's value, below the other clips; the Playlist shows it.
  const volume = row(page, "Kick").getByRole("slider", { name: "Volume" });
  await volume.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Create automation clip" }).click();
  await expect.poll(async () => (await savedAutomations(page, id)).map((a) => a.name)).toEqual(["Volume (Kick)"]);
  const [automation] = await savedAutomations(page, id);
  expect(automation).toMatchObject({ target: { kind: "channel", channel: kickId, control: "volume" }, length: 4 * BAR_TICKS, points: [{ tick: 0, value: 0.78 }, { tick: 4 * BAR_TICKS, value: 0.78 }] });
  expect(await savedClips(page, id)).toEqual([{ id: 1, kind: "automation", ref: automation.id, track: 0, start: 0, length: null, offset: 0, muted: false }]);
  await expect(page.getByTestId("playlist")).toBeVisible();
  await expect(page.getByTestId("picker").getByRole("button", { name: "Volume (Kick)" })).toBeVisible();
  // The knob says it's automated.
  await expect(volume).toHaveAttribute("data-automated", "true");

  // A right-click on its line adds a point there; drag a point to move it.
  let at = await curvePoint(page, 2 * BAR_TICKS, 0.3, 0);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await expect.poll(async () => (await savedAutomations(page, id))[0].points.length).toBe(3);
  let point = (await savedAutomations(page, id))[0].points[1];
  expect(point.tick).toBe(2 * BAR_TICKS);
  expect(point.value).toBeCloseTo(0.3, 1);
  at = await curvePoint(page, 2 * BAR_TICKS, point.value, 0);
  const to = await curvePoint(page, 3 * BAR_TICKS, 0.9, 0);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await savedAutomations(page, id))[0].points[1].tick).toBe(3 * BAR_TICKS);
  point = (await savedAutomations(page, id))[0].points[1];
  expect(point.value).toBeCloseTo(0.9, 1);

  // The first point, on the clip's left edge, is the curve's (not the edge's): dragged up and down, and
  // right-clicked for its menu rather than deleting the clip.
  at = await curvePoint(page, 0, 0.78, 0);
  const lower = await curvePoint(page, 0, 0.4, 0);
  await page.mouse.move(at.x + 1, at.y);
  await page.mouse.down();
  await page.mouse.move(lower.x + 1, lower.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await savedAutomations(page, id))[0].points[0].value).toBeCloseTo(0.4, 1);
  expect((await savedAutomations(page, id))[0].points[0].tick).toBe(0);
  at = await curvePoint(page, 0, (await savedAutomations(page, id))[0].points[0].value, 0);
  await page.mouse.click(at.x + 1, at.y, { button: "right" });
  await expect(page.getByTestId("point-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await savedClips(page, id)).toHaveLength(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedAutomations(page, id))[0].points[0].value).toBeCloseTo(0.78, 2);

  // A double-click on a point: its value typed in.
  at = await curvePoint(page, point.tick, point.value, 0);
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByTestId("point-value")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("point-value")).toHaveCount(0);

  // A right-click on a point: its menu, FL's curve types.
  at = await curvePoint(page, point.tick, point.value, 0);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.getByTestId("point-menu").getByRole("menuitemradio", { name: "Hold" }).click();
  await expect.poll(async () => (await savedAutomations(page, id))[0].points[1].curve).toBe("hold");

  // In song mode the knob follows the curve where the song is: the ruler clicked at bar 4 (where the point is, after the hold).
  const rulerBox = (await page.getByTestId("playlist").getByLabel("Ruler").boundingBox())!;
  await page.mouse.click(rulerBox.x + 3 * BAR_TICKS * 0.15 + 1, rulerBox.y + rulerBox.height / 2);
  await expect(page.getByRole("radio", { name: "Song mode" })).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => Number(await volume.getAttribute("aria-valuenow"))).toBeCloseTo(point.value, 2);

  // Held, the hand wins: the engine is told to leave its automation out until the knob's let go. (F6 closes the rack behind the Playlist, and brings it back in front.)
  await page.keyboard.press("F6");
  await expect(page.getByTestId("channel-rack")).toHaveCount(0);
  await page.keyboard.press("F6");
  const held = page.waitForRequest((r) => r.url().endsWith("/api/engine/song") && (r.postDataJSON().held ?? []).includes(`channel:${kickId}:volume`));
  const knob = (await volume.boundingBox())!;
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.mouse.move(knob.x + knob.width / 2, knob.y - 30, { steps: 6 });
  await held;
  const released = page.waitForRequest((r) => r.url().endsWith("/api/engine/song") && !(r.postDataJSON().held ?? []).length);
  await page.mouse.up();
  await released;

  // Alt+click deletes a point. (F5 twice: the Playlist closed, then back in front.)
  await page.keyboard.press("F5");
  await expect(page.getByTestId("playlist")).toHaveCount(0);
  await page.keyboard.press("F5");
  at = await curvePoint(page, point.tick, point.value, 0);
  await page.keyboard.down("Alt");
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await savedAutomations(page, id))[0].points.length).toBe(2);

  // Slide mode: a point dragged takes every later one with it.
  // (Bar 3 would be the tension handle half-way along the line from bar 2.)
  for (const bar of [2, 2.5]) {
    at = await curvePoint(page, bar * BAR_TICKS, 0.5, 0);
    await page.mouse.click(at.x, at.y, { button: "right" });
  }
  await expect.poll(async () => (await savedAutomations(page, id))[0].points.map((p) => p.tick)).toEqual([0, 768, 960, 1536]);
  await page.getByRole("button", { name: "Slide mode" }).click();
  at = await curvePoint(page, 2 * BAR_TICKS, (await savedAutomations(page, id))[0].points[1].value, 0);
  const back = await curvePoint(page, 1.5 * BAR_TICKS, (await savedAutomations(page, id))[0].points[1].value, 0);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(back.x, back.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await savedAutomations(page, id))[0].points.map((p) => p.tick)).toEqual([0, 576, 768, 1344]);
  await page.getByRole("button", { name: "Slide mode" }).click();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedAutomations(page, id))[0].points.length).toBe(2);

  // Step mode: a drag paints held steps along the grid, at the pointer's height; one undo step.
  await page.getByRole("button", { name: "Step mode" }).click();
  const paintFrom = await curvePoint(page, 0.5 * BAR_TICKS + 4, 0.2, 0);
  const paintTo = await curvePoint(page, 1.5 * BAR_TICKS - 4, 0.2, 0);
  await page.mouse.move(paintFrom.x, paintFrom.y);
  await page.mouse.down();
  await page.mouse.move(paintTo.x, paintTo.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await savedAutomations(page, id))[0].points.some((p) => p.curve === "hold" && Math.abs(p.value - 0.2) < 0.05)).toBe(true);
  const stepped = (await savedAutomations(page, id))[0].points;
  expect(stepped.filter((p) => p.curve === "hold" && p.tick >= 0.5 * BAR_TICKS && p.tick < 1.5 * BAR_TICKS).length).toBeGreaterThanOrEqual(4);
  await page.getByRole("button", { name: "Step mode" }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedAutomations(page, id))[0].points.length).toBe(2);

  // A double-click on the clip: its window, with Min / Max and the LFO.
  at = await curvePoint(page, BAR_TICKS, 0.05, 0);
  await page.mouse.dblclick(at.x, at.y);
  const window = page.getByTestId("automation-window");
  await expect(window).toContainText("Drives Volume of Kick");
  await window.getByRole("button", { name: "LFO" }).click();
  await expect.poll(async () => (await savedAutomations(page, id))[0].lfo.enabled).toBe(true);
  // Its Tools: flip vertically.
  await window.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("menuitem", { name: "Flip vertically" }).click();
  await expect.poll(async () => (await savedAutomations(page, id))[0].points[0].value).toBeCloseTo(0.22, 2);

  // Undo takes the edits back one at a time; deleting it from the Picker takes its clips.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedAutomations(page, id))[0].points[0].value).toBeCloseTo(0.78, 2);
  await page.getByTestId("picker").getByRole("button", { name: "Volume (Kick)" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete (and its clips)" }).click();
  await expect.poll(async () => (await savedSong(page, id)).automations).toEqual([]);
  expect(await savedClips(page, id)).toEqual([]);
  await expect(volume).not.toHaveAttribute("data-automated");
});

test("the tempo automates from its LCD's menu: a tempo clip on the Playlist, the LCD showing the curve's tempo in song mode", async ({ page }) => {
  const id = await openNewSong(page, "Tempo ride");
  const own = (await savedSong(page, id)).settings.tempo;
  const tempo = page.getByRole("textbox", { name: "Tempo" });
  const display = tempo.locator("..");
  await tempo.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Create automation clip" }).click();
  await expect.poll(async () => (await savedAutomations(page, id)).map((a) => [a.name, a.target])).toEqual([["Tempo (Song)", { kind: "tempo" }]]);
  await expect(tempo).toHaveAttribute("data-automated", "true");
  await expect(page.getByTestId("playlist")).toBeVisible();

  // A point at the top of the clip (FL's range: 180 BPM) at bar 2, then play from there.
  const top = await curvePoint(page, BAR_TICKS, 1, 0);
  await page.mouse.click(top.x, top.y, { button: "right" });
  await expect.poll(async () => (await savedAutomations(page, id))[0].points.map((p) => [p.tick, Math.round(p.value * 100) / 100])).toContainEqual([BAR_TICKS, 1]);
  const rulerBox = (await page.getByTestId("playlist").getByLabel("Ruler").boundingBox())!;
  await page.mouse.click(rulerBox.x + BAR_TICKS * 0.15 + 1, rulerBox.y + rulerBox.height / 2);
  await expect(page.getByRole("radio", { name: "Song mode" })).toHaveAttribute("aria-checked", "true");
  await expect(display).toContainText("180");
  // Its own tempo is still the song's, what pattern mode plays.
  expect((await savedSong(page, id)).settings.tempo).toBe(own);
  await page.getByRole("radio", { name: "Pattern mode" }).click();
  await expect(display).toContainText(String(Math.round(own)));
});

test("Automate… lists every control of the song, a plugin's own parameters too; picking one makes its clip", async ({ page }) => {
  const id = await openNewSong(page, "Automate a plugin");
  await page.getByTestId("channel-rack").getByRole("button", { name: "Add a channel" }).click();
  await page.getByTestId("channel-picker").getByRole("option", { name: /Fake Synth/ }).click();
  await expect(row(page, "Fake Synth")).toBeVisible();
  await page.keyboard.press("F5");
  await page.getByRole("tab", { name: /Automation clips/ }).click();
  await page.getByRole("button", { name: "Automate…" }).click();
  const chooser = page.getByTestId("automate-window");
  await expect(chooser).toContainText("Main volume");
  await expect(chooser).toContainText("Volume");
  // A plugin's parameters, asked of the engine when its section opens, or found by typing.
  await chooser.getByRole("textbox", { name: "Find a control" }).fill("cut");
  await chooser.getByRole("button", { name: /Cutoff.*Fake Synth/ }).click();
  await expect(chooser).toHaveCount(0);
  await expect
    .poll(async () => {
      const song = await savedSong(page, id);
      const synth = song.channels.find((c: { kind: string }) => c.kind === "plugin")?.id;
      return song.automations.map((a: SavedAutomation) => [a.name, { ...a.target, id: a.target.id === synth ? "the synth" : a.target.id }]);
    })
    .toEqual([["Cutoff (Fake Synth)", { kind: "plugin", owner: "channel", id: "the synth", param: "cutoff", index: 0, name: "Cutoff" }]]);
  // Its window says what it drives.
  await page.getByTestId("picker").getByRole("button", { name: "Cutoff (Fake Synth)" }).dblclick();
  await expect(page.getByTestId("automation-window")).toContainText("Drives Cutoff of Fake Synth");
});

test("the assistant automates: a filter sweep on a plugin's parameter, a volume ride reshaped", async ({ page }) => {
  const id = await openNewSong(page, "Assisted automation");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_channel {"plugin": "Fake Synth"}',
      'call list_controls {"channel": "Fake Synth", "query": "cut"}',
      'call add_automation {"control": "parameter", "channel": "Fake Synth", "parameter": "cutoff", "bar": 1, "length": 8, "points": [{"at": 0, "value": 0.1}, {"at": 8, "value": 0.9, "tension": 0.4}]}',
      'call add_automation {"control": "volume", "channel": "Fake Synth", "bar": 5, "length": 4}',
      'call update_automation {"automation": "Volume (Fake Synth)", "points": [{"at": 0, "value": 0.78}, {"at": 4, "value": 0, "curve": "smooth"}]}',
      'call update_automation {"automation": "nothing"}',
      "call get_automation",
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("update_automation: failed, get_automation: ok", { timeout: 30_000 });
  await expect.poll(async () => (await savedAutomations(page, id)).map((a) => a.name)).toEqual(["Cutoff (Fake Synth)", "Volume (Fake Synth)"]);
  const [sweep, ride] = await savedAutomations(page, id);
  expect(sweep).toMatchObject({ target: { kind: "plugin", param: "cutoff" }, length: 8 * BAR_TICKS, points: [{ tick: 0, value: 0.1 }, { tick: 8 * BAR_TICKS, value: 0.9 }] });
  expect(ride.points.map((p) => [p.tick, p.value, p.curve])).toEqual([
    [0, 0.78, "single"],
    [4 * BAR_TICKS, 0, "smooth"],
  ]);
  const clips = await savedClips(page, id);
  expect(clips.map((c) => [c.kind, c.track, c.start])).toEqual([
    ["automation", 0, 0],
    ["automation", 1, 4 * BAR_TICKS],
  ]);
});

/** The song's YT-Time (the effect `effectId`) as saved; until it's saved, an empty one (a poll waits for it). */
type SavedGross = { timeSlot: number; volumeSlot: number; hold: string; trigSync: number; time: ({ name: string; points: { tick: number; value: number }[] } | null)[]; volume: unknown[] };
async function savedGross(page: Page, id: string, effectId: string): Promise<SavedGross> {
  const song = await savedSong(page, id);
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect.grossBeat;
  return { timeSlot: -1, volumeSlot: -1, hold: "", trigSync: -1, time: [], volume: [] };
}
/** A point of the mapping panel, by its tick across the bar and its value (1 at the top), in the page's px. */
async function panelPoint(panel: Locator, tick: number, value: number) {
  const box = (await panel.boundingBox())!;
  return { x: box.x + 5 + (tick * (box.width - 10)) / 384, y: box.y + 3 + (1 - value) * (box.height - 6) };
}

test("YT-Time: chosen for a slot, its slots picked, its envelopes edited FL's way, its sync and HOLD", async ({ page }) => {
  const id = await openNewSong(page, "Chops");
  await page.keyboard.press("F9");
  const inspector = page.getByTestId("mixer-inspector");
  // Ours, first in the effect picker (Built in); its window opens at once.
  await inspector.getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /YT-Time/ }).click();
  const window = page.getByTestId("gross-beat");
  await expect(window).toBeVisible();
  const effectId = (await window.getAttribute("data-effect"))!;
  await expect.poll(async () => (await savedGross(page, id, effectId)).timeSlot).toBe(0);
  // Its name in the slot closes and opens its window.
  await inspector.getByRole("button", { name: "YT-Time: close its window" }).click();
  await expect(window).toHaveCount(0);
  await inspector.getByRole("button", { name: "YT-Time: open its window" }).click();
  await expect(window).toBeVisible();

  // A slot is picked by a click: it plays, and the panel shows it.
  const panel = window.getByTestId("gross-panel");
  await window.getByRole("radio", { name: "Time slot 31: 1/2 Speed" }).click();
  await expect.poll(async () => (await savedGross(page, id, effectId)).timeSlot).toBe(30);
  await expect(panel).toHaveAttribute("data-slot", "30");
  await window.getByRole("radio", { name: "Volume slot 29: Sidechain" }).click();
  await expect(panel).toHaveAttribute("data-kind", "volume");
  await expect.poll(async () => (await savedGross(page, id, effectId)).volumeSlot).toBe(28);
  await window.getByRole("button", { name: "The time envelope" }).click();
  await expect(panel).toHaveAttribute("data-kind", "time");

  // Right-click adds a point (on the 1/8 grid), dragged while held; its menu pitches the segment arriving at it.
  let at = await panelPoint(panel, 190, 0.85);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await expect.poll(async () => (await savedGross(page, id, effectId)).time[30]?.points.map((p) => p.tick)).toEqual([0, 192, 384]);
  const added = (await savedGross(page, id, effectId)).time[30]!.points[1];
  // The value snapped too: a whole eighth of a beat back.
  expect(Math.round((1 - added.value) * 8 * 8)).toBeCloseTo((1 - added.value) * 64, 6);
  at = await panelPoint(panel, 192, added.value);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.getByTestId("gross-point-menu").getByRole("menuitem", { name: "1 semitone up" }).click();
  await expect.poll(async () => (await savedGross(page, id, effectId)).time[30]!.points[1].value).toBeGreaterThan(added.value);
  // Alt+click deletes it; undo brings it back.
  const pitched = (await savedGross(page, id, effectId)).time[30]!.points[1].value;
  at = await panelPoint(panel, 192, pitched);
  await page.keyboard.down("Alt");
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await savedGross(page, id, effectId)).time[30]!.points).toHaveLength(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedGross(page, id, effectId)).time[30]!.points).toHaveLength(3);

  // Step editing paints a step in each grid cell dragged across.
  await window.getByRole("button", { name: /Step editing/ }).click();
  const from = await panelPoint(panel, 290, 0.5);
  const to = await panelPoint(panel, 330, 0.5);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await savedGross(page, id, effectId)).time[30]!.points.some((p) => p.tick === 288 && Math.abs(p.value - 0.5) < 0.07)).toBe(true);
  await window.getByRole("button", { name: /Step editing/ }).click();
  // Frozen, nothing changes.
  await window.getByRole("button", { name: /Freeze/ }).click();
  const before = (await savedGross(page, id, effectId)).time[30]!.points.length;
  at = await panelPoint(panel, 100, 0.95);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await page.waitForTimeout(200);
  expect((await savedGross(page, id, effectId)).time[30]!.points).toHaveLength(before);
  await window.getByRole("button", { name: /Freeze/ }).click();

  // The slot is renamed from the bar under the panel; its menu gives it back its preset.
  await window.getByTestId("gross-slot-name").click();
  await window.getByRole("textbox", { name: "Slot name" }).fill("My half");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedGross(page, id, effectId)).time[30]?.name).toBe("My half");
  await expect(window.getByRole("radio", { name: "Time slot 31: My half" })).toBeVisible();
  await window.getByRole("radio", { name: "Time slot 31: My half" }).click({ button: "right" });
  await page.getByTestId("gross-slot-menu").getByRole("menuitem", { name: "Reset to its preset" }).click();
  await expect.poll(async () => (await savedGross(page, id, effectId)).time[30]).toBeNull();

  // HOLD and TRIG SYNC from the bar.
  await window.getByRole("button", { name: /^HOLD: Last/ }).click();
  await page.getByRole("menuitemradio", { name: "Next" }).click();
  await window.getByRole("button", { name: /^TRIG SYNC: 1\/4 beat/ }).click();
  await page.getByRole("menuitemradio", { name: "1 beat", exact: true }).click();
  await expect.poll(async () => (await savedGross(page, id, effectId))).toMatchObject({ hold: "next", trigSync: 1 });

  // Playing, the slot playing is lit as the engine says; HOLD, held, goes to the engine (not the song).
  await page.getByRole("toolbar", { name: "Transport" }).getByRole("button", { name: "Play" }).click();
  await expect(window.getByRole("radio", { name: "Time slot 31: 1/2 Speed" })).toHaveAttribute("data-playing", "true");
  const held = page.waitForRequest((r) => r.url().endsWith("/api/engine/grossBeat") && r.postDataJSON().hold === true);
  const hold = window.getByRole("button", { name: "HOLD", exact: true });
  const box = (await hold.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  expect((await held).postDataJSON()).toEqual({ effect: effectId, hold: true });
  const released = page.waitForRequest((r) => r.url().endsWith("/api/engine/grossBeat") && r.postDataJSON().hold === false);
  await page.mouse.up();
  await released;
  await page.keyboard.press("Space");

  // Its slots can be automated, from a slot's menu.
  await window.getByRole("radio", { name: "Time slot 4: 1 Beat Rpt" }).click({ button: "right" });
  await page.getByTestId("gross-slot-menu").getByRole("menuitem", { name: /Create automation clip/ }).click();
  await expect.poll(async () => (await savedAutomations(page, id)).map((a) => a.target)).toEqual([{ kind: "grossBeat", effect: effectId, control: "timeSlot" }]);
});

test("the assistant chops with YT-Time: puts one on a track, draws a slot, arranges slots by automation", async ({ page }) => {
  const id = await openNewSong(page, "Assisted chops");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_mixer_effect {"track": 1, "plugin": "YT-Time"}',
      'call set_gross_beat_slot {"track": 1, "kind": "time", "slot": 36, "name": "Stutter", "points": [{"beat": 0, "back": 0}, {"beat": 3, "back": 0}, {"beat": 3, "back": 0.25, "curve": "hold"}, {"beat": 3.5, "back": 0.75, "curve": "hold"}, {"beat": 4, "back": 0.75, "curve": "hold"}]}',
      'call update_gross_beat {"track": 1, "volumeSlot": "Sidechain", "trigSync": 3}',
      'call add_automation {"control": "time slot", "track": 1, "slot": 1, "bar": 1, "length": 2, "points": [{"at": 0, "value": 1}, {"at": 1, "value": 36, "curve": "hold"}]}',
      'call get_gross_beat {"track": 1}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("add_automation: ok, get_gross_beat: ok", { timeout: 30_000 });
  // trigSync 3 isn't one of the choices: refused, saying which are.
  await expect(panel).toContainText("update_gross_beat: failed");
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(1);
  const song = await savedSong(page, id);
  const effect = song.mixer.tracks[1].effects[0];
  expect(effect.plugin.name).toBe("YT-Time");
  expect(effect.grossBeat.timeSlot).toBe(35);
  expect(effect.grossBeat.time[35]).toMatchObject({ name: "Stutter" });
  const [automation] = await savedAutomations(page, id);
  expect(automation.target).toEqual({ kind: "grossBeat", effect: effect.id, control: "timeSlot" });
  expect(automation.points.map((p) => Math.round(p.value * 35) + 1)).toEqual([1, 36]);
});

/** The song's YT-Delay (the effect `effectId`) as saved; until it's saved, null (a poll waits for it). */
async function savedEcho(page: Page, id: string, effectId: string) {
  const song = await savedSong(page, id);
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect.echoBoy;
  return null;
}

test("YT-Delay: chosen for a slot, its knobs, times, modes and styles set as Soundtoys' are, Tweak and the Style Editor, Rhythm Echo's taps", async ({ page }) => {
  const id = await openNewSong(page, "Echoes");
  await page.keyboard.press("F9");
  const inspector = page.getByTestId("mixer-inspector");
  // Ours, in the effect picker's Built in; its window opens at once.
  await inspector.getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /YT-Delay/ }).click();
  const window = page.getByTestId("echo-boy");
  await expect(window).toBeVisible();
  const effectId = (await window.getAttribute("data-effect"))!;
  await expect.poll(async () => (await savedEcho(page, id, effectId))?.style).toBe("Studio Tape");
  // Its name in the slot closes and opens its window.
  await inspector.getByRole("button", { name: "YT-Delay: close its window" }).click();
  await expect(window).toHaveCount(0);
  await inspector.getByRole("button", { name: "YT-Delay: open its window" }).click();
  await expect(window).toBeVisible();

  // Single Echo: an eighth note; Dot makes it dotted; Time goes to ms and the LCD takes a typed time.
  const echoTime = window.getByTestId("echo-time-echo1");
  await expect(window.getByTestId("echo-lcd-echo1")).toContainText("1/8");
  await echoTime.getByRole("button", { name: "Dot", exact: true }).click();
  await expect(window.getByTestId("echo-lcd-echo1")).toContainText("1/8 dot");
  await echoTime.getByRole("button", { name: "Time", exact: true }).click();
  await echoTime.getByRole("button", { name: "Echo Time: up" }).click();
  await expect.poll(async () => (await savedEcho(page, id, effectId))?.echo1).toEqual({ sync: "time", ms: 251, note: 8 });
  await window.getByTestId("echo-lcd-echo1").getByRole("spinbutton").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Type in value…" }).click();
  await page.getByRole("textbox", { name: "Echo Time: type a value" }).fill("126.2");
  await page.keyboard.press("Enter");
  await expect(window.getByTestId("echo-lcd-echo1")).toContainText("126.2 ms");

  // A knob dragged up: Feedback.
  const feedback = window.getByRole("slider", { name: "Feedback" });
  const before = (await savedEcho(page, id, effectId))!.feedback;
  await drag(page, feedback, feedback, { dy: -40 });
  await expect.poll(async () => (await savedEcho(page, id, effectId))!.feedback).toBeGreaterThan(before);

  // The Mode dial: Dual Echo shows Echo 1 and Echo 2; Tweak opens its drawer with FB Mix.
  await window.getByRole("radio", { name: "Dual Echo" }).click();
  await expect(window).toHaveAttribute("data-mode", "dual");
  await expect(window.getByTestId("echo-time-echo2")).toBeVisible();
  await window.getByRole("button", { name: "Tweak" }).click();
  await expect(window.getByTestId("echo-tweak")).toContainText("FB Mix");
  await window.getByRole("button", { name: "Tweak" }).click();
  await expect(window.getByTestId("echo-tweak")).toHaveCount(0);

  // A style from its menu; the Style Editor's knobs make it Custom.
  await window.getByTestId("echo-style").click();
  await page.getByRole("menuitemradio", { name: /Space Echo/ }).click();
  await expect(window.getByTestId("echo-style")).toContainText("Space Echo");
  await window.getByRole("button", { name: "Style Edit" }).click();
  const editor = window.getByTestId("echo-style-editor");
  await expect(editor).toBeVisible();
  const decay = editor.getByRole("slider", { name: "Decay", exact: true }).last();
  await drag(page, decay, decay, { dy: -20 });
  await expect(window.getByTestId("echo-style")).toContainText("Custom");
  await expect.poll(async () => (await savedEcho(page, id, effectId))?.custom?.high.decay).toBeGreaterThan(-16);

  // A preset from the bar: everything as it makes it.
  await window.getByTestId("echo-preset").click();
  await page.getByRole("menuitem", { name: "Classic" }).click();
  await page.getByRole("menuitem", { name: "AnaLogged" }).click();
  await expect(window.getByTestId("echo-preset")).toContainText("AnaLogged");
  await expect(window.getByTestId("echo-style")).toContainText("DM-2");
  await expect.poll(async () => (await savedEcho(page, id, effectId))?.primeNumbers).toBe(true);

  // Tap Tempo: two taps half a second apart, YT-Delay on 120 BPM of its own (MIDI off).
  await window.getByTestId("echo-tap").click();
  await page.waitForTimeout(500);
  await window.getByTestId("echo-tap").click();
  await expect.poll(async () => (await savedEcho(page, id, effectId))?.followTempo).toBe(false);
  await expect(window.getByRole("switch", { name: "MIDI" })).toHaveAttribute("aria-checked", "false");

  // Rhythm Echo: the editor's grid; a click adds a tap on the grid, ⌥-click deletes it.
  await window.getByRole("radio", { name: "Rhythm Echo" }).click();
  const grid = window.getByTestId("echo-rhythm-grid");
  await expect(grid).toBeVisible();
  const taps = async () => (await savedEcho(page, id, effectId))!.rhythm.taps.map((t: { beat: number }) => t.beat);
  const box = (await grid.boundingBox())!;
  await expect.poll(taps).toEqual([0, 0.5, 1, 1.5]);
  await page.mouse.click(box.x + box.width * (1.25 / 2), box.y + box.height * 0.3);
  await expect.poll(taps).toEqual([0, 0.5, 1, 1.25, 1.5]);
  await expect(window.getByTestId("echo-pattern-name")).toContainText("Custom");
  await page.keyboard.down("Alt");
  await page.mouse.click(box.x + box.width * (1.25 / 2), box.y + box.height * 0.5);
  await page.keyboard.up("Alt");
  await expect.poll(taps).toEqual([0, 0.5, 1, 1.5]);
  // Patt: a factory pattern.
  await window.getByTestId("echo-patt").click();
  await page.getByRole("menuitem", { name: "Presets" }).click();
  await page.getByRole("menuitem", { name: "Gallop" }).click();
  await expect(window.getByTestId("echo-pattern-name")).toContainText("Gallop");

  // Undo takes back the pattern; deleting the effect closes its window.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(window.getByTestId("echo-pattern-name")).toContainText("Custom");
  // (Its window moved down by its title, off the mixer's slots.)
  const title = page.getByText("YT-Delay (Master)", { exact: true });
  const slotButton = inspector.getByRole("button", { name: "Slot 1 menu" });
  const lift = (await slotButton.boundingBox())!.y + 40 - (await title.boundingBox())!.y;
  await drag(page, title, title, { dy: lift });
  await slotButton.click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(window).toHaveCount(0);
});

test("the assistant sets up YT-Delay: puts one on a track, loads a preset, sets its rhythm and style, automates it", async ({ page }) => {
  const id = await openNewSong(page, "Assisted echoes");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_mixer_effect {"track": 1, "plugin": "YT-Delay"}',
      'call update_echo_boy {"track": 1, "preset": "Space Echo Dub", "echo1": "1/4 dot", "styleEdit": {"wobble": {"depth": 9}}}',
      'call update_echo_boy {"track": 1, "mode": "rhythm", "rhythm": {"pattern": "Clave"}}',
      'call update_echo_boy {"track": 1, "style": "Nope"}',
      'call add_automation {"control": "echo feedback", "track": 1, "slot": 1, "bar": 1, "length": 2, "points": [{"at": 0, "value": 0.2}, {"at": 2, "value": 0.9}]}',
      'call get_echo_boy {"track": 1}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("add_automation: ok, get_echo_boy: ok", { timeout: 30_000 });
  // A style that isn't one is refused, saying which are.
  await expect(panel).toContainText("update_echo_boy: failed");
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(1);
  const song = await savedSong(page, id);
  const effect = song.mixer.tracks[1].effects[0];
  expect(effect.plugin.name).toBe("YT-Delay");
  expect(effect.echoBoy).toMatchObject({ mode: "rhythm", echo1: { sync: "dot", note: 4 }, custom: { wobble: { depth: 9 } }, rhythm: { pattern: "Clave" } });
  const [automation] = await savedAutomations(page, id);
  expect(automation.target).toEqual({ kind: "echoBoy", effect: effect.id, control: "feedback" });
  expect(automation.points.map((p) => Math.round(p.value * 10) / 10)).toEqual([0.2, 0.9]);
});

/** The song's YT-Tune (the effect `effectId`) as saved; until it's saved, nothing (a poll waits for it). */
type SavedTune = { key: number; scale: string; notes: string[]; retuneSpeed: number; humanize: number; formant: boolean; vibrato: { shape: string } };
async function savedTune(page: Page, id: string, effectId: string): Promise<SavedTune | null> {
  const song = await savedSong(page, id);
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect.autoTune;
  return null;
}

test("YT-Tune: chosen for a slot, hard-tuned, its key and scale set, notes edited, presets, its graph and meter while it plays", async ({ page }) => {
  const id = await openNewSong(page, "Vocals");
  await page.keyboard.press("F9");
  const inspector = page.getByTestId("mixer-inspector");
  // Ours, in the effect picker's Built in; its window opens at once, hard-tuned.
  await inspector.getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /YT-Tune/ }).click();
  const window = page.getByTestId("auto-tune");
  await expect(window).toBeVisible();
  const effectId = (await window.getAttribute("data-effect"))!;
  await expect.poll(async () => (await savedTune(page, id, effectId))?.retuneSpeed).toBe(0);
  await expect(window.getByTestId("tune-retune")).toContainText("0");
  await expect(window.getByTestId("tune-key-text")).toHaveText("C Chromatic");
  // Closed (it covers the mixer here), its name in the slot opens it again.
  await page.getByRole("button", { name: /^Close YT-Tune/ }).click();
  await expect(window).toHaveCount(0);
  await inspector.getByRole("button", { name: "YT-Tune: open its window" }).click();
  await expect(window).toBeVisible();

  // The key and scale: A minor; its notes are the scale's.
  await window.getByTestId("tune-key").click();
  await page.getByRole("menuitemradio", { name: "A", exact: true }).click();
  await window.getByTestId("tune-scale").click();
  await page.getByRole("menuitemradio", { name: "Minor", exact: true }).click();
  await expect(window.getByTestId("tune-key-text")).toHaveText("A Minor");
  await expect.poll(async () => (await savedTune(page, id, effectId))?.notes.join(" ")).toBe("tune remove tune remove tune tune remove tune remove tune remove tune");
  // Edit Scale: G# turned on, E bypassed.
  const notes = window.getByTestId("tune-scale-notes");
  await notes.getByRole("button", { name: "G#: Remove" }).click();
  await notes.locator('[data-note="E"]').getByRole("button", { name: "B" }).click();
  await expect.poll(async () => (await savedTune(page, id, effectId))?.notes[8]).toBe("tune");
  await expect.poll(async () => (await savedTune(page, id, effectId))?.notes[4]).toBe("bypass");
  await expect(window.getByTestId("tune-key-text")).toContainText("(edited)");

  // A preset sets its sound and leaves the key; Retune Speed's knob turns by its keys.
  await window.getByTestId("tune-preset").click();
  await page.getByRole("menuitem", { name: /Natural Vocal/ }).click();
  await expect.poll(async () => (await savedTune(page, id, effectId))?.retuneSpeed).toBe(30);
  expect((await savedTune(page, id, effectId))?.key).toBe(9);
  await window.getByRole("slider", { name: "Retune Speed" }).press("ArrowUp");
  await expect.poll(async () => (await savedTune(page, id, effectId))?.retuneSpeed).toBe(40);
  await expect(window.getByTestId("tune-preset")).toContainText("Custom");
  await window.getByRole("button", { name: /Formant/ }).click();
  await expect.poll(async () => (await savedTune(page, id, effectId))?.formant).toBe(false);
  await window.getByRole("tab", { name: /Create vibrato/ }).click();
  await window.getByRole("radio", { name: "Sine" }).click();
  await expect.poll(async () => (await savedTune(page, id, effectId))?.vibrato.shape).toBe("sine");

  // Detect key with no notes in the song: it says so.
  await window.getByRole("button", { name: "Detect key from the song" }).click();
  await expect(page.getByText("No key to hear")).toBeVisible();

  // While it plays, the engine says what it hears: the note it tunes to, the correction on the meter.
  await page.keyboard.press("Space");
  await expect(window.getByTestId("tune-note")).toHaveText("A3");
  await expect(window.getByTestId("tune-correction")).toContainText("cents");
  await page.keyboard.press("Space");
});

test("the assistant tunes a vocal: puts YT-Tune on its track, sets the key and sound, automates its retune speed", async ({ page }) => {
  const id = await openNewSong(page, "Assisted vocals");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_mixer_effect {"track": 1, "plugin": "YT-Tune"}',
      'call update_auto_tune {"track": 1, "preset": "Modern Pop", "key": "F#", "scale": "minor", "notes": {"E": "bypass"}, "input": "soprano"}',
      'call update_auto_tune {"track": 1, "retuneSpeed": 900}',
      'call add_automation {"control": "retune speed", "track": 1, "slot": 1, "bar": 1, "length": 2, "points": [{"at": 0, "value": 0}, {"at": 1, "value": 50, "curve": "hold"}]}',
      'call get_auto_tune {"track": 1}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("add_automation: ok, get_auto_tune: ok", { timeout: 30_000 });
  // 900 ms is past its range: refused, saying what is.
  await expect(panel).toContainText("update_auto_tune: failed");
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(1);
  const song = await savedSong(page, id);
  const effect = song.mixer.tracks[1].effects[0];
  expect(effect.plugin.name).toBe("YT-Tune");
  expect(effect.autoTune).toMatchObject({ key: 6, scale: "minor", input: "soprano", retuneSpeed: 12, humanize: 0.25 });
  expect(effect.autoTune.notes[4]).toBe("bypass");
  const [automation] = await savedAutomations(page, id);
  expect(automation.target).toEqual({ kind: "autoTune", effect: effect.id, control: "retuneSpeed" });
  expect(automation.points.map((p) => Math.round(p.value * 400))).toEqual([0, 50]);
});

/** The song's YT-EQ (the effect `effectId`) as saved; until it's saved, none (a poll waits for it). */
type SavedBand = { id: number; shape: string; frequency: number; gain: number; q: number; range: number; slope: number | string; enabled: boolean };
type SavedProQ = { bands: SavedBand[]; mode: string; output: number };
async function savedProQ(page: Page, id: string, effectId: string): Promise<SavedProQ | null> {
  const song = await savedSong(page, id);
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect.proQ;
  return null;
}
const bandsOf = async (page: Page, id: string, effectId: string) => (await savedProQ(page, id, effectId))?.bands ?? [];

test("YT-EQ: chosen for a slot, bands made where they're double-clicked, dragged, made dynamic, reshaped, inverted, deleted; its mode; undone", async ({ page }) => {
  const id = await openNewSong(page, "EQ");
  await page.keyboard.press("F9");
  const inspector = page.getByTestId("mixer-inspector");
  // Ours, first in the effect picker (Built in); its window opens at once.
  await inspector.getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /YT-EQ/ }).click();
  const window = page.getByTestId("pro-q");
  await expect(window).toBeVisible();
  const effectId = (await window.getAttribute("data-effect"))!;
  await expect.poll(async () => (await savedProQ(page, id, effectId))?.mode).toBe("zeroLatency");
  // Closed, its name in the slot opens it again.
  await page.getByRole("button", { name: "Close YT-EQ (Master)" }).click();
  await expect(window).toHaveCount(0);
  await inspector.getByRole("button", { name: "YT-EQ: open its window" }).click();
  await expect(window).toBeVisible();

  const display = page.getByTestId("pro-q-display");
  const box = (await display.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  // A Bell where it's double-clicked (over 0 dB: a boost), a Low Cut at the far left, a Notch along the bottom.
  const bell = at(0.4, 0.3);
  await page.mouse.dblclick(bell.x, bell.y);
  await page.mouse.dblclick(at(0.02, 0.5).x, at(0.02, 0.5).y);
  await page.mouse.dblclick(at(0.6, 0.955).x, at(0.6, 0.955).y);
  await expect.poll(async () => (await bandsOf(page, id, effectId)).map((b) => b.shape)).toEqual(["bell", "lowCut", "notch"]);
  let bands = await bandsOf(page, id, effectId);
  expect(bands[0].gain).toBeGreaterThan(3);
  expect(bands[1].frequency).toBeLessThan(25);
  // The band controls float under the one just made.
  await expect(page.getByTestId("pro-q-band-controls")).toBeVisible();

  // Drag the Bell: up and to the right, higher and louder.
  const was = bands[0];
  await page.mouse.move(bell.x, bell.y);
  await page.mouse.down();
  await page.mouse.move(bell.x + 60, bell.y - 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await bandsOf(page, id, effectId))[0].frequency).toBeGreaterThan(was.frequency * 1.2);
  bands = await bandsOf(page, id, effectId);
  expect(bands[0].gain).toBeGreaterThan(was.gain);
  const dot = { x: bell.x + 60, y: bell.y - 30 };

  // Alt+wheel over it: a dynamic band, cutting when loud. The wheel alone narrows it.
  await page.mouse.move(dot.x, dot.y);
  await page.keyboard.down("Alt");
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 100);
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await bandsOf(page, id, effectId))[0].range).toBeLessThan(-1);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await bandsOf(page, id, effectId))[0].q).toBeGreaterThan(1.2);

  // Its menu: Invert Gain flips its gain and range.
  const before = (await bandsOf(page, id, effectId))[0];
  await page.mouse.click(dot.x, dot.y, { button: "right" });
  await page.getByTestId("pro-q-band-menu").getByRole("menuitem", { name: "Invert Gain" }).click();
  await expect.poll(async () => (await bandsOf(page, id, effectId))[0].gain).toBeCloseTo(-before.gain, 1);
  expect((await bandsOf(page, id, effectId))[0].range).toBeCloseTo(-before.range, 1);

  // Selected (a click on its dot, now as far under 0 dB as it was over), the band controls reshape it: a High Shelf.
  const zero = box.y + 6 + (box.height - 6 - 18) / 2;
  await page.mouse.click(dot.x, 2 * zero - dot.y);
  const controls = page.getByTestId("pro-q-band-controls");
  await controls.getByRole("button", { name: "Shape" }).click();
  await page.getByRole("menuitemradio", { name: "High Shelf" }).click();
  await expect.poll(async () => (await bandsOf(page, id, effectId))[0].shape).toBe("highShelf");

  // Delete takes the selected band away.
  await display.focus();
  await page.mouse.move(at(0.5, 0.5).x, at(0.5, 0.5).y);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await bandsOf(page, id, effectId)).map((b) => b.shape)).toEqual(["lowCut", "notch"]);

  // Linear Phase from the bottom bar; undone with the top bar's arrow.
  await window.getByRole("button", { name: "Processing mode" }).click();
  await page.getByRole("menuitemradio", { name: "Linear Phase" }).click();
  await expect.poll(async () => (await savedProQ(page, id, effectId))?.mode).toBe("linearPhase");
  await expect(window.getByRole("button", { name: "Processing mode" })).toContainText("Linear Phase – Medium");
  await window.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await savedProQ(page, id, effectId))?.mode).toBe("zeroLatency");

  // A preset replaces the bands; the analyzer's panel opens from the bottom bar.
  await window.getByRole("button", { name: "Presets" }).click();
  await page.getByTestId("pro-q-presets").getByRole("menuitem", { name: "Flat 7 Bands" }).click();
  await expect.poll(async () => (await bandsOf(page, id, effectId)).length).toBe(7);
  await window.getByRole("button", { name: "Analyzer" }).click();
  await expect(page.getByTestId("pro-q-analyzer")).toBeVisible();
});

test("the assistant shapes a YT-EQ: puts one on a track, adds bands, sets its mode, sweeps a band by automation", async ({ page }) => {
  const id = await openNewSong(page, "Assisted EQ");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_mixer_effect {"track": 1, "plugin": "YT-EQ"}',
      'call set_pro_q_bands {"track": 1, "bands": [{"shape": "lowCut", "frequency": 40, "slope": 24}, {"frequency": 300, "gain": -3, "q": 1.5, "range": -4}, {"shape": "highShelf", "frequency": 9000, "gain": 2}]}',
      'call update_pro_q {"track": 1, "mode": "naturalPhase", "autoGain": true}',
      'call set_pro_q_bands {"track": 1, "bands": [{"shape": "notch", "frequency": 100, "range": -6}]}',
      'call add_automation {"control": "eq frequency", "track": 1, "slot": 1, "band": 2, "bar": 1, "length": 2, "points": [{"at": 0, "value": 300}, {"at": 2, "value": 3000}]}',
      'call get_pro_q {"track": 1}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("add_automation: ok, get_pro_q: ok", { timeout: 30_000 });
  // A Notch can't be dynamic: refused, saying which shapes can.
  await expect(panel).toContainText("set_pro_q_bands: failed");
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(1);
  const song = await savedSong(page, id);
  const effect = song.mixer.tracks[1].effects[0];
  expect(effect.plugin.name).toBe("YT-EQ");
  expect(effect.proQ.mode).toBe("naturalPhase");
  expect(effect.proQ.autoGain).toBe(true);
  expect(effect.proQ.bands.map((b: SavedBand) => [b.id, b.shape, b.frequency])).toEqual([
    [1, "lowCut", 40],
    [2, "bell", 300],
    [3, "highShelf", 9000],
  ]);
  const [automation] = await savedAutomations(page, id);
  expect(automation.target).toEqual({ kind: "proQ", effect: effect.id, band: 2, control: "frequency" });
});

/** The song's YT-Pan (the effect `effectId`) as saved; until it's saved, null (a poll waits for it). */
type SavedPan = { preset: string; mode: string; style: string; custom: boolean; rhythm: string; stepPattern: { points: { tick: number; value: number }[] } };
async function savedPan(page: Page, id: string, effectId: string): Promise<SavedPan | null> {
  const song = await savedSong(page, id);
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect.panMan;
  return null;
}

test("YT-Pan: chosen for a slot, its presets, modes and style, its step editor, the Manual Trigger and automation", async ({ page }) => {
  const id = await openNewSong(page, "Pans");
  await page.keyboard.press("F9");
  const inspector = page.getByTestId("mixer-inspector");
  // Ours, under Built in; its window opens at once, panning slowly.
  await inspector.getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /YT-Pan/ }).click();
  const window = page.getByTestId("panman");
  await expect(window).toBeVisible();
  const effectId = (await window.getAttribute("data-effect"))!;
  await expect.poll(async () => (await savedPan(page, id, effectId))?.preset).toBe("Slow Pan");
  await inspector.getByRole("button", { name: "YT-Pan: close its window" }).click();
  await expect(window).toHaveCount(0);
  await inspector.getByRole("button", { name: "YT-Pan: open its window" }).click();
  await expect(window).toBeVisible();

  // A preset from the preset bar; a change lights Revert, which goes back to it.
  await window.getByTestId("panman-preset").click();
  await page.getByRole("menuitem", { name: "Tooo Dang Fast" }).click();
  await expect.poll(async () => await savedPan(page, id, effectId)).toMatchObject({ preset: "Tooo Dang Fast", mode: "rhythmStep", style: "fat" });
  await expect(window.getByRole("button", { name: "Revert to Tooo Dang Fast" })).toBeDisabled();
  await window.getByTestId("panman-mode").click();
  await page.getByRole("menuitemradio", { name: "Rhythm Shape" }).click();
  await expect(window).toHaveAttribute("data-mode", "rhythmShape");
  await window.getByRole("button", { name: "Revert to Tooo Dang Fast" }).click();
  await expect.poll(async () => (await savedPan(page, id, effectId))?.mode).toBe("rhythmStep");

  // The rhythm from its LCD's menu: quarter notes. Tweak shows the editor; a click on an empty grid line adds a point.
  await window.getByRole("spinbutton", { name: "Rhythm" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "1/4 note" }).click();
  await expect.poll(async () => (await savedPan(page, id, effectId))?.rhythm).toBe("1/4");
  await window.getByRole("button", { name: /Tweak/ }).click();
  const editor = window.getByTestId("panman-step-editor");
  await expect(editor).toBeVisible();
  const box = (await editor.boundingBox())!;
  // The editor's area: 6 px in, 16 px for R / C / L on the right, 100 px high.
  const at = (tick: number, value: number) => ({ x: box.x + 6 + (tick / 384) * (box.width - 28), y: box.y + 6 + ((1 - value) / 2) * 100 });
  let point = at(48, 1);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await savedPan(page, id, effectId))?.custom).toBe(true);
  await expect.poll(async () => (await savedPan(page, id, effectId))?.stepPattern.points.map((p) => p.tick)).toEqual([0, 48, 96, 192, 288]);
  await expect(window.getByRole("spinbutton", { name: "Rhythm" })).toHaveText("Custom");
  // Right-click deletes it; undo brings it back.
  point = at(48, 1);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect.poll(async () => (await savedPan(page, id, effectId))?.stepPattern.points.map((p) => p.tick)).toEqual([0, 96, 192, 288]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedPan(page, id, effectId))?.stepPattern.points).toHaveLength(5);

  // The Analog Style.
  await window.getByRole("radio", { name: "Crunch" }).click();
  await expect.poll(async () => (await savedPan(page, id, effectId))?.style).toBe("crunch");

  // PingPong's Manual Trigger goes to the engine (not the song).
  await window.getByTestId("panman-mode").click();
  await page.getByRole("menuitemradio", { name: "PingPong" }).click();
  const triggered = page.waitForRequest((r) => r.url().endsWith("/api/engine/panMan"));
  await window.getByRole("button", { name: "Trigger", exact: true }).click();
  expect((await triggered).postDataJSON()).toEqual({ effect: effectId, trigger: true });

  // Its Offset can be automated, from its knob's menu.
  await window.getByRole("slider", { name: "Offset", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Create automation clip/ }).click();
  await expect.poll(async () => (await savedAutomations(page, id)).map((a) => a.target)).toEqual([{ kind: "panMan", effect: effectId, control: "offset" }]);
});

test("the assistant pans with YT-Pan: puts one on a track, loads a preset, draws a rhythm, automates its offset", async ({ page }) => {
  const id = await openNewSong(page, "Assisted pans");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_mixer_effect {"track": 1, "plugin": "YT-Pan"}',
      'call update_panman {"track": 1, "preset": "Wiper Panner", "width": 150}',
      'call set_panman_pattern {"track": 1, "editor": "shape", "events": [{"beat": 0, "length": 1.5}, {"beat": 2, "length": 2}]}',
      'call update_panman {"track": 1, "width": 400}',
      'call add_automation {"control": "panman offset", "track": 1, "slot": 1, "bar": 1, "length": 1, "points": [{"at": 0, "value": -90}, {"at": 1, "value": 90}]}',
      'call get_panman {"track": 1}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("add_automation: ok, get_panman: ok", { timeout: 30_000 });
  // A width of 400° is refused, saying the range.
  await expect(panel).toContainText("update_panman: failed");
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(1);
  const song = await savedSong(page, id);
  const effect = song.mixer.tracks[1].effects[0];
  expect(effect.plugin.name).toBe("YT-Pan");
  expect(effect.panMan).toMatchObject({ preset: "Wiper Panner", mode: "rhythmShape", width: 150, custom: true, shapePattern: { events: [{ tick: 0, length: 144 }, { tick: 192, length: 192 }] } });
  const [automation] = await savedAutomations(page, id);
  expect(automation.target).toEqual({ kind: "panMan", effect: effect.id, control: "offset" });
  expect(automation.points.map((p) => Math.round(p.value * 210 - 105))).toEqual([-90, 90]);
});

/** The song's YT-Pitch (the effect `effectId`) as saved; until it's saved, nothing (a poll waits for it). */
type SavedWheel = { value: number; range: number; snap: string; gravity: number };
type SavedPitchWheel = { pitch: SavedWheel; timbre: SavedWheel; timbreOn: boolean; midiMode: string; notesFrom: string | null; origin: number; resolution: string };
async function savedWheel(page: Page, id: string, effectId: string): Promise<SavedPitchWheel | null> {
  const song = await savedSong(page, id);
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect.pitchWheel;
  return null;
}

test("YT-Pitch: chosen for a slot, its wheels turned, ranged and snapped, the Timbre tab, presets, notes from a channel, its keyboard heard while it plays", async ({ page }) => {
  const id = await openNewSong(page, "Wheels");
  await page.keyboard.press("F9");
  const inspector = page.getByTestId("mixer-inspector");
  // Ours, in the effect picker's Built in; its window opens at once, nothing shifted.
  await inspector.getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /YT-Pitch/ }).click();
  const window = page.getByTestId("pitch-wheel");
  await expect(window).toBeVisible();
  const effectId = (await window.getAttribute("data-effect"))!;
  await expect.poll(async () => (await savedWheel(page, id, effectId))?.resolution).toBe("wide");
  expect(await savedWheel(page, id, effectId)).toMatchObject({ pitch: { value: 0, range: 24, snap: "semitone" }, timbreOn: true, midiMode: "single", origin: 60 });
  // Closed, its name in the slot opens it again.
  await page.getByRole("button", { name: /^Close YT-Pitch/ }).click();
  await expect(window).toHaveCount(0);
  await inspector.getByRole("button", { name: "YT-Pitch: open its window" }).click();
  await expect(window).toBeVisible();

  // The wheel by its keys: a semitone a press (snapped).
  const pitch = window.getByTestId("wheel-pitch");
  await pitch.press("ArrowUp");
  await pitch.press("ArrowUp");
  await expect.poll(async () => (await savedWheel(page, id, effectId))?.pitch.value).toBe(2);
  // Turned by dragging round it: from the top a quarter-turn clockwise, at range 24, is 8 semitones more.
  const box = (await pitch.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy - 80);
  await page.mouse.down();
  for (let deg = 5; deg <= 90; deg += 5) await page.mouse.move(cx + 80 * Math.sin((deg * Math.PI) / 180), cy - 80 * Math.cos((deg * Math.PI) / 180));
  await page.mouse.up();
  await expect.poll(async () => Math.round((await savedWheel(page, id, effectId))!.pitch.value)).toBe(10);
  // What's heard swings there (here, while the engine is silent, by the same physics).
  await expect.poll(async () => Number(await pitch.getAttribute("data-heard"))).toBeCloseTo(10, 1);

  // Range 12: the pointer comes in to +6. Snap to octaves.
  await window.getByTestId("wheel-pitch-range").click();
  await page.getByRole("menuitemradio", { name: /^12 semitones/ }).click();
  await expect.poll(async () => (await savedWheel(page, id, effectId))?.pitch).toMatchObject({ range: 12, value: 6 });
  await window.getByTestId("wheel-pitch-snap").click();
  await page.getByRole("menuitemradio", { name: "Octaves" }).click();
  await expect.poll(async () => (await savedWheel(page, id, effectId))?.pitch.snap).toBe("octave");

  // The Timbre tab closed: formants with the pitch; its wheel greyed out.
  await window.getByTestId("wheel-timbre-tab").click();
  await expect.poll(async () => (await savedWheel(page, id, effectId))?.timbreOn).toBe(false);
  await expect(window.getByTestId("wheel-timbre-tab")).toHaveAttribute("aria-pressed", "false");

  // A preset: both wheels and the tab.
  await window.getByTestId("wheel-preset").click();
  await page.getByRole("menuitem", { name: /Helium/ }).click();
  await expect.poll(async () => (await savedWheel(page, id, effectId))?.timbre.value).toBe(4);
  expect(await savedWheel(page, id, effectId)).toMatchObject({ timbreOn: true, pitch: { value: 0, snap: "semitone", range: 24 } });
  await expect(window.getByTestId("wheel-preset")).toContainText("Helium");
  // A knob: gravity down, the preset now Custom.
  await window.getByRole("slider", { name: "Pitch gravity" }).press("ArrowDown");
  await expect.poll(async () => (await savedWheel(page, id, effectId))?.pitch.gravity).toBeLessThan(0.75);
  await expect(window.getByTestId("wheel-preset")).toContainText("Custom");

  // Multi, its notes from the rack's channel; a right-click on the keyboard makes a key the origin.
  await window.getByTestId("wheel-midi-mode").getByRole("radio", { name: "Multi" }).click();
  await window.getByTestId("wheel-notes-from").click();
  await page.getByRole("menuitemradio", { name: /Sampler/ }).click();
  await expect.poll(async () => (await savedWheel(page, id, effectId))?.midiMode).toBe("multi");
  const song = await savedSong(page, id);
  expect((await savedWheel(page, id, effectId))?.notesFrom).toBe(song.channels[0].id);
  const keyboard = window.getByTestId("wheel-keyboard");
  const keys = (await keyboard.boundingBox())!;
  // The keyboard is C2..B6: 35 white keys. The 17th (E5, MIDI 64), low down (a white key's own part).
  const whiteKey = (index: number) => ({ x: keys.x + ((index + 0.5) / 35) * keys.width, y: keys.y + keys.height - 6 });
  await page.mouse.click(whiteKey(16).x, whiteKey(16).y, { button: "right" });
  await expect.poll(async () => (await savedWheel(page, id, effectId))?.origin).toBe(64);

  // Back to Single; while it plays, a key held moves what's heard: G5 (67) is 3 over the origin E5.
  await window.getByTestId("wheel-midi-mode").getByRole("radio", { name: "Single" }).click();
  await expect.poll(async () => (await savedWheel(page, id, effectId))?.midiMode).toBe("single");
  await page.keyboard.press("Space");
  await expect.poll(async () => Number(await pitch.getAttribute("data-heard"))).toBeCloseTo(0, 1);
  await page.mouse.move(whiteKey(18).x, whiteKey(18).y);
  await page.mouse.down();
  await expect.poll(async () => Number(await pitch.getAttribute("data-heard"))).toBeCloseTo(3, 1);
  await page.mouse.up();
  await page.keyboard.press("Space");
});

test("the assistant pitches a vocal: puts a YT-Pitch on its track, sets it for harmonies, automates its pitch", async ({ page }) => {
  const id = await openNewSong(page, "Assisted wheel");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_mixer_effect {"track": 1, "plugin": "YT-Pitch"}',
      'call update_pitch_wheel {"track": 1, "preset": "Fifth Up", "midiMode": "multi", "notesFrom": "Sampler", "origin": "A4", "timbre": {"value": -2}}',
      'call update_pitch_wheel {"track": 1, "midiMode": "chords"}',
      'call add_automation {"control": "wheel pitch", "track": 1, "slot": 1, "bar": 1, "length": 2, "points": [{"at": 0, "value": 0}, {"at": 1, "value": 12}]}',
      'call get_pitch_wheel {"track": 1}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("add_automation: ok, get_pitch_wheel: ok", { timeout: 30_000 });
  // A mode that isn't one is refused, saying which are.
  await expect(panel).toContainText("update_pitch_wheel: failed");
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(1);
  const song = await savedSong(page, id);
  const effect = song.mixer.tracks[1].effects[0];
  expect(effect.plugin.name).toBe("YT-Pitch");
  expect(effect.pitchWheel).toMatchObject({ pitch: { value: 7 }, timbre: { value: -2 }, midiMode: "multi", notesFrom: song.channels[0].id, origin: 57 });
  const [automation] = await savedAutomations(page, id);
  expect(automation.target).toEqual({ kind: "pitchWheel", effect: effect.id, control: "pitch" });
  expect(automation.points.map((p) => Math.round(p.value * 48 - 24))).toEqual([0, 12]);
});

/** The song's YT-Multiband (the effect `effectId`) as saved; until it's saved, none (a poll waits for it). */
type SavedOtt = { preset: string | null; depth: number; time: number; input: number; output: number; upward: number; downward: number; bands: { threshold: number; gain: number; upward: boolean; downward: boolean }[] };
async function savedOtt(page: Page, id: string, effectId: string): Promise<SavedOtt | null> {
  const song = await savedSong(page, id);
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect.ott;
  return null;
}

test("YT-Multiband: chosen for a slot, its knobs turned, a band's gap dragged and a compressor switched off, a preset; its controls automated from a knob and from the title bar", async ({ page }) => {
  const id = await openNewSong(page, "Squash");
  await page.keyboard.press("F9");
  const inspector = page.getByTestId("mixer-inspector");
  await inspector.getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /YT-Multiband/ }).click();
  const window = page.getByTestId("ott");
  await expect(window).toBeVisible();
  const effectId = (await window.getAttribute("data-effect"))!;
  await expect.poll(async () => (await savedOtt(page, id, effectId))?.preset).toBe("Default");
  // Closed, its name in the slot opens it again.
  await page.getByRole("button", { name: "Close YT-Multiband (Master)" }).click();
  await expect(window).toHaveCount(0);
  await inspector.getByRole("button", { name: "YT-Multiband: open its window" }).click();
  await expect(window).toBeVisible();

  // Depth dragged down: less of it, and the preset's name goes.
  await drag(page, window.getByRole("slider", { name: "Depth" }), window.getByRole("slider", { name: "Depth" }), { dy: 60 });
  await expect.poll(async () => (await savedOtt(page, id, effectId))?.depth).toBeLessThan(0.8);
  expect((await savedOtt(page, id, effectId))?.preset).toBeNull();

  // The mid row's gap dragged right: its threshold up. Ctrl+click on its brown (far left): its upward compressor off.
  const mid = window.getByTestId("ott-row-mid");
  await drag(page, mid, mid, { dx: 40 });
  await expect.poll(async () => (await savedOtt(page, id, effectId))?.bands[1].threshold).toBeGreaterThan(1.1);
  const box = (await mid.boundingBox())!;
  await page.keyboard.down("Control");
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await savedOtt(page, id, effectId))?.bands[1].upward).toBe(false);
  await expect(mid).toHaveAttribute("data-upward", "false");
  // Its menu turns it back on; a double-click resets its threshold.
  await mid.click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Upward compression" }).click();
  await expect.poll(async () => (await savedOtt(page, id, effectId))?.bands[1].upward).toBe(true);
  await mid.dblclick();
  await expect.poll(async () => (await savedOtt(page, id, effectId))?.bands[1].threshold).toBe(1);

  // A preset sets it all.
  await window.getByTestId("ott-preset").click();
  await page.getByRole("menuitem", { name: "Drum smash" }).click();
  await expect.poll(async () => (await savedOtt(page, id, effectId))?.preset).toBe("Drum smash");
  expect((await savedOtt(page, id, effectId))?.time).toBe(0.4);

  // Automated: Time from its knob's menu, then the last knob touched (Out Gain) from the title bar.
  await window.getByRole("slider", { name: "Time" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Create automation clip" }).click();
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(1);
  // (The Playlist opens on the new clip, over the window.)
  await page.getByRole("button", { name: "Close Playlist" }).click();
  await drag(page, window.getByRole("slider", { name: "Out Gain" }), window.getByRole("slider", { name: "Out Gain" }), { dy: -10 });
  await expect(page.getByTestId("automate-touched")).toContainText("Automate “Out Gain”");
  await page.getByTestId("automate-touched").click();
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(2);
  const targets = (await savedSong(page, id)).automations.map((a: { target: unknown }) => a.target);
  expect(targets).toEqual([
    { kind: "ott", effect: effectId, control: "time" },
    { kind: "ott", effect: effectId, control: "output" },
  ]);
});

/** The song's YT-C (the effect `effectId`) as saved; until it's saved, none (a poll waits for it). */
type SavedProC = { preset: string | null; style: string; threshold: number; slope: number; view: { sidechain: boolean; compact: boolean; knee: boolean }; sidechain: { trigger: string; track: string | null; bands: unknown[] } };
async function savedProC(page: Page, id: string, effectId: string): Promise<SavedProC | null> {
  const song = await savedSong(page, id);
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect.proC;
  return null;
}

test("YT-C: chosen for a slot, Threshold turned and undone, a Vintage style's face, a preset, the side chain keyed from another track", async ({ page }) => {
  const id = await openNewSong(page, "Compress");
  await page.keyboard.press("F9");
  const mixer = page.getByTestId("mixer");
  await mixer.locator('[data-track-name="Insert 1"]').locator("span").first().click();
  const inspector = page.getByTestId("mixer-inspector");
  await inspector.getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /YT-C/ }).click();
  const window = page.getByTestId("pro-c");
  await expect(window).toBeVisible();
  const effectId = (await window.getAttribute("data-effect"))!;
  // Vocals first: it starts on the Vocal style's preset.
  await expect.poll(async () => (await savedProC(page, id, effectId))?.preset).toBe("Vocal – Upfront");
  await expect(window).toHaveAttribute("data-style", "vocal");
  // Closed, its name in the slot opens it again.
  await page.getByRole("button", { name: "Close YT-C (Insert 1)" }).click();
  await expect(window).toHaveCount(0);
  await inspector.getByRole("button", { name: "YT-C: open its window" }).click();
  await expect(window).toBeVisible();
  await page.getByRole("button", { name: "Close Mixer" }).click();

  // Threshold turned up: the song changes and the preset's name goes; the window's Undo takes it back.
  const threshold = window.getByTestId("pro-c-knob-threshold");
  await drag(page, threshold, threshold, { dy: -40 });
  await expect.poll(async () => (await savedProC(page, id, effectId))?.threshold).toBeGreaterThan(-18);
  expect((await savedProC(page, id, effectId))?.preset).toBeNull();
  await window.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await savedProC(page, id, effectId))?.threshold).toBe(-18);

  // A Vintage style: FET 76's face, its Input and its ratio buttons.
  await window.getByTestId("pro-c-style").click();
  await page.getByRole("menuitem", { name: /Vintage/ }).click();
  await page.getByRole("menuitem", { name: /^FET 76/ }).click();
  await expect(window).toHaveAttribute("data-style", "fet");
  await expect(window.getByRole("slider", { name: "Input" })).toBeVisible();
  await expect(window.getByTestId("pro-c-vintage-switches")).toBeVisible();
  await window.getByTestId("pro-c-ratio-buttons").getByRole("radio", { name: "8" }).click();
  await expect.poll(async () => (await savedProC(page, id, effectId))?.slope).toBe(0.875);
  // Opto 2A: Peak Reduction and Emphasis.
  await window.getByTestId("pro-c-style").click();
  await page.getByRole("menuitem", { name: /Vintage/ }).click();
  await page.getByRole("menuitem", { name: /^Opto 2A/ }).click();
  await expect(window.getByRole("slider", { name: "Peak Reduction" })).toBeVisible();
  await expect(window.getByRole("slider", { name: "Emphasis" })).toBeVisible();
  await expect.poll(async () => (await savedProC(page, id, effectId))?.style).toBe("opto2a");

  // A preset, from its folder.
  await window.getByTestId("pro-c-preset").click();
  await page.getByRole("menuitem", { name: "Vocals" }).click();
  await page.getByRole("menuitem", { name: /^Vocal – Tracking Opto/ }).click();
  await expect.poll(async () => (await savedProC(page, id, effectId))?.preset).toBe("Vocal – Tracking Opto");
  expect((await savedProC(page, id, effectId))?.style).toBe("optoTube");
  await expect(window.getByTestId("pro-c-preset")).toHaveText("Vocal – Tracking Opto");

  // The side chain: opened, a band double-clicked into its EQ, then keyed from Insert 2 (no send needed: the key is the slot's).
  await window.getByTestId("pro-c-sidechain-toggle").click();
  await expect(window.getByTestId("pro-c-sidechain")).toBeVisible();
  await expect.poll(async () => (await savedProC(page, id, effectId))?.view.sidechain).toBe(true);
  const eq = (await window.getByTestId("pro-c-sidechain-eq").boundingBox())!;
  await page.mouse.dblclick(eq.x + eq.width * 0.6, eq.y + eq.height * 0.35);
  await expect.poll(async () => (await savedProC(page, id, effectId))?.sidechain.bands.length).toBe(1);
  await window.getByRole("radio", { name: "External" }).click();
  await window.getByTestId("pro-c-sidechain-source").click();
  await page.getByTestId("key-source-2").click();
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[1].effects[0]?.sidechain).toEqual({ track: "insert_2", tap: "postFx" });
  const song = await savedSong(page, id);
  expect(song.mixer.tracks[2].sends).not.toContainEqual({ to: "insert_1", level: 0 });
  expect((await savedProC(page, id, effectId))?.sidechain.trigger).toBe("external");
  await expect(window.getByTestId("pro-c-sidechain-source")).toHaveText(/2 \(after its effects\)/);

  // Compact: the displays go, the meters lie across.
  await window.getByTestId("pro-c-compact").click();
  await expect(window.getByTestId("pro-c-compact-meters")).toBeVisible();
  await expect(window.getByTestId("pro-c-display")).toHaveCount(0);

  // Match, while it plays: the loudness in and out measured, Wet Gain set from it (one edit).
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await window.getByTestId("pro-c-match").click();
  await expect(window.getByTestId("pro-c-match")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => ((await savedSong(page, id)).mixer.tracks[1].effects[0].proC.wet as number), { timeout: 15_000 }).not.toBe(0);
  await expect(window.getByTestId("pro-c-match")).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

type SavedProL = { style: string; gain: number; output: number; truePeak: boolean; clip: boolean; clipShape: string; clipOrder: string; preset: string | null; lockOutput: boolean; slot: string; hold: number | null; stereo: string; meter: { target: number; timeScale: string } };
async function savedProL(page: Page, id: string, effectId: string): Promise<SavedProL | null> {
  const song = await savedSong(page, id);
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect.proL;
  return null;
}

test("YT-L: chosen for the master's slot, Gain pushed and undone, a style, the clip stage, a preset under Lock Output, A/B, its meters while it plays", async ({ page }) => {
  const id = await openNewSong(page, "Loud");
  await page.keyboard.press("F9");
  const mixer = page.getByTestId("mixer");
  await mixer.locator('[data-track-name="Master"]').click({ position: { x: 8, y: 6 } });
  const inspector = page.getByTestId("mixer-inspector");
  await inspector.getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /YT-L/ }).click();
  const window = page.getByTestId("pro-l");
  await expect(window).toBeVisible();
  const effectId = (await window.getAttribute("data-effect"))!;
  // Théo's default: Modern, a −0.1 dBFS ceiling, the clipper off.
  await expect.poll(async () => (await savedProL(page, id, effectId))?.preset).toBe("Default Setting");
  await expect(window).toHaveAttribute("data-style", "modern");
  // Closed, its name in the slot opens it again.
  await page.getByRole("button", { name: /^Close YT-L/ }).click();
  await expect(window).toHaveCount(0);
  await inspector.getByRole("button", { name: "YT-L: open its window" }).click();
  await expect(window).toBeVisible();
  await page.getByRole("button", { name: "Close Mixer" }).click();

  // Gain pushed up: the song changes and the preset's name goes; Undo takes it back.
  const gain = window.getByTestId("pro-l-knob-gain");
  await drag(page, gain, gain, { dy: -60 });
  await expect.poll(async () => (await savedProL(page, id, effectId))?.gain).toBeGreaterThan(0);
  expect((await savedProL(page, id, effectId))?.preset).toBeNull();
  await window.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await savedProL(page, id, effectId))?.gain).toBe(0);

  // A style; Attack and Release grey out for one without a release stage.
  await window.getByTestId("pro-l-style").click();
  await page.getByRole("menuitemradio", { name: /^Aggressive/ }).click();
  await expect(window).toHaveAttribute("data-style", "aggressive");
  await expect(window.getByRole("slider", { name: "Attack" })).toHaveAttribute("aria-readonly", "true");
  // Hold: Auto off sets a time.
  await window.getByTestId("pro-l-auto-hold").click();
  await expect.poll(async () => (await savedProL(page, id, effectId))?.hold).toBe(0.005);

  // The clip stage: on, FL's shape, after the limiter (FL's Emphasizer).
  await window.getByTestId("pro-l-clip-on").click();
  await window.getByTestId("pro-l-clip-shape").click();
  await page.getByRole("menuitemradio", { name: /^FL/ }).click();
  await window.getByTestId("pro-l-clip-order").getByRole("radio", { name: "Last" }).click();
  await expect.poll(async () => await savedProL(page, id, effectId)).toMatchObject({ clip: true, clipShape: "fl", clipOrder: "last" });
  // Mid/side shows the side's floor in place of the links.
  await window.getByTestId("pro-l-stereo").getByRole("radio", { name: "M/S" }).click();
  await expect(window.getByRole("slider", { name: "Side Floor" })).toBeVisible();
  await expect.poll(async () => (await savedProL(page, id, effectId))?.stereo).toBe("ms");

  // Delivery set by hand and locked: a preset loads its sound but leaves the ceiling alone.
  await window.getByTestId("pro-l-true-peak").click();
  await window.getByTestId("pro-l-lock-output").click();
  await expect.poll(async () => await savedProL(page, id, effectId)).toMatchObject({ truePeak: true, lockOutput: true });
  await window.getByTestId("pro-l-preset").click();
  await page.getByRole("menuitem", { name: "Master" }).click();
  await page.getByRole("menuitem", { name: /^Master: Rage \/ Hyperpop/ }).click();
  await expect.poll(async () => await savedProL(page, id, effectId)).toMatchObject({ preset: "Master: Rage / Hyperpop", style: "aggressive", truePeak: true, output: -0.1, meter: { target: -4 } });
  await expect(window.getByTestId("pro-l-preset")).toHaveText("Master: Rage / Hyperpop");

  // A/B: B starts as A; changed there, A is as it was.
  await window.getByTestId("pro-l-ab").click();
  await expect.poll(async () => (await savedProL(page, id, effectId))?.slot).toBe("b");
  await window.getByTestId("pro-l-style").click();
  await page.getByRole("menuitemradio", { name: /^Transparent/ }).click();
  await window.getByTestId("pro-l-ab").click();
  await expect.poll(async () => await savedProL(page, id, effectId)).toMatchObject({ slot: "a", style: "aggressive" });

  // Its meters while the song plays (the stand-in engine's made-up loudness), the target from its menu, reset.
  await window.getByTestId("pro-l-target").click();
  await page.getByRole("menuitemradio", { name: /^-14 LUFS/ }).click();
  await expect.poll(async () => (await savedProL(page, id, effectId))?.meter.target).toBe(-14);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(window.getByTestId("pro-l-loudness-value")).not.toHaveText("—", { timeout: 5000 });
  await expect(window.getByTestId("pro-l-lra")).toHaveText(/LRA/);
  await window.getByRole("button", { name: "Reset the measurement" }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

test("sidechain: the kick's strip ducks a track with a new YT-C, the slot shows its key and changes its tap, a dotted cable", async ({ page }) => {
  const id = await openNewSong(page, "Ducked");
  await page.keyboard.press("F9");
  const mixer = page.getByTestId("mixer");
  // Insert 1 (the kick) → Sidechain to → Insert 2 → Duck with a new YT-C.
  await mixer.locator('[data-track-name="Insert 1"]').locator("span").first().click({ button: "right" });
  await page.getByTestId("sidechain-to").click();
  await page.getByTestId("sidechain-to-2").click();
  await page.getByTestId("duck-with-pro-c").click();
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[2].effects[0]?.sidechain).toEqual({ track: "insert_1", tap: "postFx" });
  const effect = (await savedSong(page, id)).mixer.tracks[2].effects[0];
  expect(effect.proC.preset).toBe("Sidechain – Duck to Kick");
  expect(effect.proC.sidechain.trigger).toBe("external");
  // Its window opens, its source shown.
  await expect(page.getByTestId("pro-c")).toBeVisible();
  await page.getByRole("button", { name: /^Close YT-C/ }).click();

  // Insert 2's inspector: the slot's key badge, and its menu's Sidechain input taking the key after the fader.
  await mixer.locator('[data-track-name="Insert 2"]').locator("span").first().click();
  const inspector = page.getByTestId("mixer-inspector");
  await expect(inspector.getByTestId("key-badge")).toHaveText("1");
  await inspector.locator('[data-slot="0"]').click({ button: "right" });
  await page.getByTestId("slot-sidechain").click();
  await page.getByRole("menuitemradio", { name: "After its fader" }).click();
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[2].effects[0]?.sidechain).toEqual({ track: "insert_1", tap: "postFader" });
  // A dotted cable into Insert 2 from Insert 1.
  await expect(mixer.locator('[data-sidechain][data-cable="insert_2"][data-cable-from="insert_1"]')).toHaveCount(1);
  // No key.
  await inspector.locator('[data-slot="0"]').click({ button: "right" });
  await page.getByTestId("slot-sidechain").click();
  await page.getByRole("menuitem", { name: "No key" }).click();
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[2].effects[0]?.sidechain).toBeUndefined();
  await expect(inspector.getByTestId("key-badge")).toHaveCount(0);
});

test("modulation: a fader follows another track's level from its menu, the Modulators window shows it, and it's taken off", async ({ page }) => {
  const id = await openNewSong(page, "Pumped");
  await page.keyboard.press("F9");
  const mixer = page.getByTestId("mixer");
  // Insert 2's fader → Modulate → Follow track → Insert 1.
  await mixer.getByRole("slider", { name: "Insert 2 volume" }).click({ button: "right" });
  await page.getByTestId("modulate").click();
  await page.getByTestId("follow-track").click();
  await page.getByTestId("follow-track-1").click();
  await expect.poll(async () => (await savedSong(page, id)).modulators).toEqual([
    expect.objectContaining({ source: { kind: "track", track: "insert_1", tap: "postFx" }, links: [{ target: { kind: "mixer", track: "insert_2", control: "volume" }, amount: -0.6 }] }),
  ]);
  // Its window: the modulator, what it moves, by how much.
  const window = page.getByTestId("modulators-window");
  await expect(window).toBeVisible();
  await expect(window.getByTestId("modulator-row")).toHaveText(/Insert 1 level/);
  await expect(window.getByTestId("modulation-link")).toContainText("Volume");
  await expect(window.getByTestId("modulation-link")).toContainText("−60%");
  // A second control linked to it from its menu (Link to).
  await mixer.getByRole("slider", { name: "Insert 3 pan" }).click({ button: "right" });
  await page.getByTestId("modulate").click();
  await page.getByRole("menuitem", { name: "Link to" }).click();
  await page.getByRole("menuitem", { name: /Insert 1 level/ }).click();
  await expect(window.getByTestId("modulation-link")).toHaveCount(2);
  // Taken off the fader again: its menu says what moves it.
  await mixer.getByRole("slider", { name: "Insert 2 volume" }).click({ button: "right" });
  await expect(page.getByTestId("modulate")).toHaveText(/Modulated by Insert 1 level/);
  await page.getByTestId("modulate").click();
  await page.getByTestId("remove-modulation").click();
  await expect.poll(async () => (await savedSong(page, id)).modulators[0].links.map((l: { target: { control: string } }) => l.target.control)).toEqual(["pan"]);
  // A control touched (Insert 4's pan turned), then linked from the window (FL's way for a plugin's parameter).
  const pan = (await mixer.getByRole("slider", { name: "Insert 4 pan" }).boundingBox())!;
  await page.mouse.move(pan.x + pan.width / 2, pan.y + pan.height / 2);
  await page.mouse.down();
  await page.mouse.move(pan.x + pan.width / 2, pan.y + pan.height / 2 - 20, { steps: 4 });
  await page.mouse.up();
  // The Mixer's menu brings it forward.
  await page.getByRole("button", { name: "Mixer menu" }).click();
  await page.getByTestId("open-modulators").click();
  await window.getByTestId("link-touched").filter({ hasText: "Insert 4" }).click();
  await expect.poll(async () => (await savedSong(page, id)).modulators[0].links.map((l: { target: { track: string } }) => l.target.track)).toEqual(["insert_3", "insert_4"]);
  await page.getByRole("button", { name: "Close Modulators" }).click();
  await expect(window).toHaveCount(0);
});

test("the assistant squashes a track with YT-Multiband: puts one on, sets it, automates its depth", async ({ page }) => {
  const id = await openNewSong(page, "Assisted YT-Multiband");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_mixer_effect {"track": 1, "plugin": "YT-Multiband"}',
      'call update_ott {"track": 1, "depth": 0.35, "time": 2, "bands": [{"band": "high", "gain": 2}, {"band": "low", "downward": false}]}',
      'call add_automation {"control": "ott depth", "track": 1, "slot": 1, "bar": 1, "length": 4, "points": [{"at": 0, "value": 0}, {"at": 4, "value": 0.6}]}',
      'call get_ott {"track": 1}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("add_automation: ok, get_ott: ok", { timeout: 30_000 });
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(1);
  const song = await savedSong(page, id);
  const effect = song.mixer.tracks[1].effects[0];
  expect(effect.plugin.name).toBe("YT-Multiband");
  expect(effect.ott).toMatchObject({ depth: 0.35, time: 2, preset: null });
  expect(effect.ott.bands[2].gain).toBe(2);
  expect(effect.ott.bands[0].downward).toBe(false);
  const [automation] = await savedAutomations(page, id);
  expect(automation.target).toEqual({ kind: "ott", effect: effect.id, control: "depth" });
  expect(automation.points.map((p: { value: number }) => p.value)).toEqual([0, 0.6]);
});

test("the assistant compresses a vocal with YT-C: the two-stage chain in one step, a style changed, a key from another track, a threshold automated", async ({ page }) => {
  const id = await openNewSong(page, "Assisted YT-C");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_vocal_compression {"track": 1, "amount": "heavy"}',
      'call update_pro_c {"track": 1, "effectSlot": 2, "options": {"limit": true, "emphasis": 6}}',
      'call set_pro_c_sidechain {"track": 1, "effectSlot": 1, "source": 2}',
      'call add_automation {"control": "pro-c threshold", "track": 1, "slot": 1, "bar": 1, "length": 4, "points": [{"at": 0, "value": -30}, {"at": 4, "value": -20}]}',
      'call get_pro_c {"track": 1, "effectSlot": 1}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("add_automation: ok, get_pro_c: ok", { timeout: 30_000 });
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(1);
  const song = await savedSong(page, id);
  const [fet, opto] = song.mixer.tracks[1].effects;
  expect(fet.plugin.name).toBe("YT-C");
  expect(fet.proC).toMatchObject({ style: "fet", threshold: -28, sidechain: { trigger: "external" } });
  expect(opto.proC).toMatchObject({ style: "opto2a", options: { limit: true, emphasis: 6 } });
  // The key is the slot's (no 0% send needed).
  expect(fet.sidechain).toEqual({ track: song.mixer.tracks[2].id, tap: "postFx" });
  expect(song.mixer.tracks[2].sends).not.toContainEqual({ to: song.mixer.tracks[1].id, level: 0 });
  const [automation] = await savedAutomations(page, id);
  expect(automation.target).toEqual({ kind: "proC", effect: fet.id, control: "threshold" });
  expect(automation.points.map((p: { value: number }) => p.value)).toEqual([0.5, 2 / 3]);
});

/**
 * Every knob and slider in `window` offers Create automation clip on its menu: the names of any that
 * don't. (Each is right-clicked, its menu read, and closed.)
 */
/** The song's YT-R (the effect `effectId`) as saved. */
async function savedReverb(page: Page, id: string, effectId: string) {
  const song = await savedSong(page, id);
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect.reverb;
  return null;
}

test("YT-R: chosen for a slot, Decay turned and reverted, a decay band made and dragged, undone, a preset and a mode, Freeze, the Shape display and the advanced panel, automated from a knob", async ({ page }) => {
  const id = await openNewSong(page, "Verb");
  await page.keyboard.press("F9");
  const inspector = page.getByTestId("mixer-inspector");
  await inspector.getByRole("button", { name: "Slot 1 menu" }).click();
  await page.getByTestId("effect-picker").getByRole("option", { name: /YT-R/ }).click();
  const window = page.getByTestId("reverb");
  await expect(window).toBeVisible();
  const effectId = (await window.getAttribute("data-effect"))!;
  // On the master: the vocal default at an insert's mix.
  await expect.poll(async () => (await savedReverb(page, id, effectId))?.preset).toBe("Vocal Plate");
  expect((await savedReverb(page, id, effectId))?.mix).toBe(0.18);
  await page.getByRole("button", { name: "Close Mixer" }).click();
  await page.getByRole("button", { name: "Close YT-R (Master)" }).click();
  await expect(window).toHaveCount(0);
  await page.keyboard.press("F9");
  await inspector.getByRole("button", { name: "YT-R: open its window" }).click();
  await expect(window).toBeVisible();
  await page.getByRole("button", { name: "Close Mixer" }).click();

  // Decay dragged up: a longer tail, the preset's name in italics, Revert lit; Revert brings it back.
  const decay = window.getByRole("slider", { name: "Decay", exact: true });
  await drag(page, decay, decay, { dy: -40 });
  await expect.poll(async () => (await savedReverb(page, id, effectId))?.decay).toBeGreaterThan(2.5);
  expect((await savedReverb(page, id, effectId))?.preset).toBeNull();
  await expect(window.getByTestId("reverb-revert")).toBeEnabled();
  await window.getByTestId("reverb-revert").click();
  await expect.poll(async () => (await savedReverb(page, id, effectId))?.decay).toBe(1.8);
  expect((await savedReverb(page, id, effectId))?.preset).toBe("Vocal Plate");

  // A double-click on the Decay display makes a band; dragged down, it rings shorter there; undo puts it back.
  const display = window.getByTestId("reverb-display");
  const box = (await display.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width * 0.62, box.y + box.height * 0.35);
  await expect.poll(async () => (await savedReverb(page, id, effectId))?.bands.length).toBe(1);
  const band = window.getByTestId("reverb-band-1");
  const before = Number(await band.getAttribute("data-multiplier"));
  await drag(page, band, band, { dy: 50 });
  await expect.poll(async () => (await savedReverb(page, id, effectId))?.bands[0].multiplier).toBeLessThan(before * 0.8);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedReverb(page, id, effectId))?.bands[0].multiplier).toBeCloseTo(before, 3);

  // A preset sets it all, the mode's arrows step through the modes, Freeze holds the tail.
  await window.getByTestId("reverb-preset").click();
  await page.getByRole("menuitem", { name: "Lead Vocal" }).click();
  await page.getByRole("menuitem", { name: /^Ballad Hall/ }).click();
  await expect.poll(async () => (await savedReverb(page, id, effectId))?.mode).toBe("hall");
  await expect(window).toHaveAttribute("data-mode", "hall");
  await window.getByRole("button", { name: "Next mode" }).click();
  await expect.poll(async () => (await savedReverb(page, id, effectId))?.mode).toBe("ambience");
  await window.getByTestId("reverb-freeze").click();
  await expect.poll(async () => (await savedReverb(page, id, effectId))?.freeze).toBe(true);
  await window.getByTestId("reverb-freeze").click();

  // The Shape display, and the advanced panel (its window grows for it).
  await window.getByTestId("reverb-tab-shape").click();
  await expect(display).toHaveAttribute("data-view", "shape");
  await window.getByTestId("reverb-advanced-toggle").click();
  await expect(window.getByTestId("reverb-advanced")).toBeVisible();
  await window.getByTestId("reverb-tone-lock").click();
  await expect.poll(async () => (await savedReverb(page, id, effectId))?.late.toneLock).toBe(false);

  // Automated: Decay from its knob's menu.
  await decay.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Create automation clip" }).click();
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(1);
  expect((await savedSong(page, id)).automations[0].target).toEqual({ kind: "reverb", effect: effectId, control: "decay" });
});

test("the assistant puts a reverb on a vocal: a send in one step, its decay shaped, its mix automated", async ({ page }) => {
  const id = await openNewSong(page, "Assisted YT-R");
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(
    [
      'call add_vocal_reverb {"track": 1, "kind": "lead"}',
      'call update_reverb {"track": 2, "decay": "2.2 s", "predelay": "1/32", "duck": "-6 dB"}',
      'call set_reverb_decay {"track": 2, "bands": [{"shape": "highShelf", "frequency": 6000, "multiplier": 0.6}]}',
      'call add_automation {"control": "reverb mix", "track": 2, "slot": 1, "bar": 1, "length": 4, "points": [{"at": 0, "value": 0.5}, {"at": 4, "value": 1}]}',
      'call get_reverb {"track": 2}',
    ].join("\n"),
  );
  await composer.press("Enter");
  await expect(panel).toContainText("add_automation: ok, get_reverb: ok", { timeout: 30_000 });
  await expect.poll(async () => (await savedSong(page, id)).automations.length).toBe(1);
  const song = await savedSong(page, id);
  const ret = song.mixer.tracks[2];
  expect(ret.name).toBe("Insert 1 Verb");
  const effect = ret.effects[0];
  expect(effect.plugin.name).toBe("YT-R");
  expect(effect.reverb).toMatchObject({ mix: 1, mixLock: true, decay: 2.2, sync: true, predelayNote: { note: 32, feel: "straight" }, duck: -6 });
  expect(effect.sidechain).toEqual({ track: song.mixer.tracks[1].id, tap: "postFader" });
  expect(effect.reverb.bands).toHaveLength(1);
  expect(song.mixer.tracks[1].sends.some((s: { to: string; level: number }) => s.to === ret.id && s.level > 0)).toBe(true);
  const [automation] = await savedAutomations(page, id);
  expect(automation.target).toEqual({ kind: "reverb", effect: effect.id, control: "mix" });
});

async function notAutomatable(page: Page, window: Locator): Promise<string[]> {
  // (By their role attribute: while a menu closes, the page is hidden from role queries for a moment.)
  const sliders = window.locator('[role="slider"]');
  const missing: string[] = [];
  const count = await sliders.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const slider = sliders.nth(i);
    if (!(await slider.isVisible())) continue;
    await slider.scrollIntoViewIfNeeded();
    await slider.click({ button: "right" });
    const item = page.getByRole("menuitem", { name: "Create automation clip" });
    const offered = await item.waitFor({ state: "visible", timeout: 1500 }).then(
      () => true,
      () => false,
    );
    if (!offered) missing.push((await slider.getAttribute("aria-label")) ?? `slider ${i}`);
    await page.keyboard.press("Escape");
    await expect(item).toHaveCount(0);
  }
  return missing;
}

test("every knob of our built-in effects can be automated: YT-Time, YT-Delay (each mode, Tweak, the Style Editor), YT-Tune, YT-EQ, YT-Multiband, YT-C, YT-L, YT-R (with its advanced panel), YT-Pan (each mode, Tweak), YT-Pitch", async ({ page }) => {
  test.setTimeout(300_000);
  await openNewSong(page, "Automate everything");
  await page.keyboard.press("F9");
  const inspector = page.getByTestId("mixer-inspector");
  let slot = 0;
  /** Put `name` in the next empty slot, its window open. */
  async function choose(name: RegExp, testId: string) {
    await inspector.getByRole("button", { name: `Slot ${++slot} menu` }).click();
    await page.getByTestId("effect-picker").getByRole("option", { name }).click();
    const window = page.getByTestId(testId);
    await expect(window).toBeVisible();
    return window;
  }
  // (The mixer's window over them is closed: each effect's window is checked alone.)
  const close = async (title: RegExp) => page.getByRole("button", { name: title }).click();

  let window = await choose(/YT-Time/, "gross-beat");
  await page.getByRole("button", { name: "Close Mixer" }).click();
  // (The scratching clock is played live, as HOLD is: a performance, not the song's.)
  expect(await notAutomatable(page, window)).toEqual(["Scratching clock: drag up and down to scratch"]);
  await close(/^Close YT-Time/);

  await page.keyboard.press("F9");
  window = await choose(/YT-Delay/, "echo-boy");
  await page.getByRole("button", { name: "Close Mixer" }).click();
  for (const mode of ["Single Echo", "Dual Echo", "Ping-Pong", "Rhythm Echo"]) {
    await window.getByRole("radio", { name: mode }).click();
    if (!(await window.getByTestId("echo-tweak").count())) await window.getByRole("button", { name: "Tweak" }).click();
    await expect(window.getByTestId("echo-tweak")).toBeVisible();
    expect(await notAutomatable(page, window), `${mode} with Tweak`).toEqual([]);
  }
  await window.getByRole("button", { name: "Style Edit" }).click();
  expect(await notAutomatable(page, window.getByTestId("echo-style-editor")), "the Style Editor").toEqual([]);
  await close(/^Close YT-Delay/);

  await page.keyboard.press("F9");
  window = await choose(/YT-Tune/, "auto-tune");
  await page.getByRole("button", { name: "Close Mixer" }).click();
  expect(await notAutomatable(page, window)).toEqual([]);
  await close(/^Close YT-Tune/);

  await page.keyboard.press("F9");
  window = await choose(/YT-EQ/, "pro-q");
  await page.getByRole("button", { name: "Close Mixer" }).click();
  // A band, so its controls show; and the output options.
  const display = (await page.getByTestId("pro-q-display").boundingBox())!;
  await page.mouse.dblclick(display.x + display.width * 0.5, display.y + display.height * 0.3);
  await expect(page.getByTestId("pro-q-band-controls")).toBeVisible();
  expect(await notAutomatable(page, window)).toEqual([]);
  await close(/^Close YT-EQ/);

  await page.keyboard.press("F9");
  window = await choose(/YT-Multiband/, "ott");
  await page.getByRole("button", { name: "Close Mixer" }).click();
  expect(await notAutomatable(page, window)).toEqual([]);
  await close(/^Close YT-Multiband/);

  await page.keyboard.press("F9");
  window = await choose(/YT-C/, "pro-c");
  await page.getByRole("button", { name: "Close Mixer" }).click();
  // (Lookahead isn't automatable, as YT-C's design has it: moving it moves where the gain lands.)
  expect(await notAutomatable(page, window)).toEqual(["Lookahead"]);
  await window.getByTestId("pro-c-output").click();
  expect(await notAutomatable(page, page.getByTestId("pro-c-output-panel"))).toEqual([]);
  await page.keyboard.press("Escape");
  await close(/^Close YT-C/);

  await page.keyboard.press("F9");
  window = await choose(/YT-L/, "pro-l");
  await page.getByRole("button", { name: "Close Mixer" }).click();
  // (Lookahead isn't automatable: it moves the latency.) In mid/side, the side's floor shows in place of the links.
  expect(await notAutomatable(page, window)).toEqual(["Lookahead"]);
  await window.getByTestId("pro-l-stereo").getByRole("radio", { name: "M/S" }).click();
  expect(await notAutomatable(page, window)).toEqual(["Lookahead"]);
  await close(/^Close YT-L/);

  await page.keyboard.press("F9");
  window = await choose(/YT-R/, "reverb");
  await page.getByRole("button", { name: "Close Mixer" }).click();
  if (!(await window.getByTestId("reverb-advanced").count())) await window.getByTestId("reverb-advanced-toggle").click();
  await expect(window.getByTestId("reverb-advanced")).toBeVisible();
  expect(await notAutomatable(page, window)).toEqual([]);
  await close(/^Close YT-R/);

  await page.keyboard.press("F9");
  window = await choose(/YT-Pan/, "panman");
  await page.getByRole("button", { name: "Close Mixer" }).click();
  await window.getByRole("button", { name: /Tweak/ }).click();
  for (const mode of ["LFO", "Rhythm Step", "Rhythm Shape", "PingPong", "Random", "Step"]) {
    await window.getByTestId("panman-mode").click();
    await page.getByRole("menuitemradio", { name: mode, exact: true }).click();
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
    expect(await notAutomatable(page, window), `YT-Pan's ${mode}, with Tweak`).toEqual([]);
  }
  await close(/^Close YT-Pan/);

  await page.keyboard.press("F9");
  window = await choose(/YT-Pitch/, "pitch-wheel");
  await page.getByRole("button", { name: "Close Mixer" }).click();
  expect(await notAutomatable(page, window)).toEqual([]);
});

test("an audio clip's Extract stems and Convert to notes: stems under it, the clip muted, one undo step; its notes a pattern on a sampler under it; the assistant does both", async ({ page }) => {
  // A song at 120 BPM with a four-second file on track 1 (EDITOR_MUSIC_MODELS=stand-in: each stem an even share of the file, a made-up melody).
  const { id } = await (await page.request.post("/api/projects", { data: { suite: "music", name: "Stems" } })).json();
  const file = path.resolve("e2e/.data/stems-song.wav");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeWav(file, Array.from({ length: 4 * 44100 }, (_, i) => Math.sin(i / 8) * 0.5), 44100);
  const asset = await (await page.request.post("/api/media/import-file", { data: { projectId: id, path: file } })).json();
  const song = await savedSong(page, id);
  song.settings.tempo = 120;
  song.channels.push({ id: "chan_song", name: "Song", kind: "audio", sampleId: asset.id });
  song.playlist.clips = [{ id: 1, kind: "audio", ref: "chan_song", track: 0, start: 0, length: 2 * BAR_TICKS, offset: 0, muted: false }];
  expect((await page.request.put(`/api/projects/${id}`, { data: song })).ok()).toBe(true);
  await page.goto(`/p/${id}`);
  await expect(page.getByTestId("playlist")).toBeVisible();
  await page.getByRole("button", { name: "Close Channel rack" }).click();
  const box = (await page.getByTestId("playlist-grid").boundingBox())!;
  const clipMenu = async () => {
    await page.mouse.click(box.x + 10, box.y + 6);
    return page.getByTestId("clip-menu");
  };

  // Extract stems…: four ticked (FL's), Guitar added; Other then holds the piano alone.
  await (await clipMenu()).getByRole("menuitem", { name: "Extract stems…" }).click();
  const stems = page.getByTestId("stems-window");
  await expect(stems).toBeVisible();
  for (const name of ["Vocals", "Drums", "Bass", "Other"]) await expect(stems.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
  await stems.getByRole("button", { name: "Guitar", exact: true }).click();
  await expect(stems).toContainText("Other holds the piano too.");
  await stems.getByRole("button", { name: "Extract", exact: true }).click();
  await expect(stems).toBeHidden();
  const stemNames = ["Song - Vocals", "Song - Drums", "Song - Bass", "Song - Guitar", "Song - Other"];
  await expect.poll(async () => (await savedSong(page, id)).channels.filter((c: { kind: string }) => c.kind === "audio").map((c: { name: string }) => c.name), { timeout: 30_000 }).toEqual(["Song", ...stemNames]);
  const placed = await savedSong(page, id);
  // Under the clip, lined up with it, on tracks named after them; the clip muted.
  expect(placed.playlist.clips.map((c: SavedClip) => [c.track, c.start, c.length, c.muted])).toEqual([[0, 0, 2 * BAR_TICKS, true], ...[1, 2, 3, 4, 5].map((t) => [t, 0, 2 * BAR_TICKS, false])]);
  expect(placed.playlist.tracks.slice(1, 6).map((t: { name: string | null }) => t.name)).toEqual(["Vocals", "Drums", "Bass", "Guitar", "Other"]);
  // Into the master: mixing them is the user's.
  expect(placed.channels.filter((c: { name: string }) => stemNames.includes(c.name)).every((c: { mixerTrack: string }) => c.mixerTrack === "master")).toBe(true);
  // One undo step takes it all back.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await savedClips(page, id)).map((c) => [c.track, c.muted])).toEqual([[0, false]]);

  // Convert to notes…: the made-up melody heard (a note every half second), drawn, then made a pattern under the clip.
  await (await clipMenu()).getByRole("menuitem", { name: "Convert to notes…" }).click();
  const convert = page.getByTestId("convert-window");
  await expect(convert).toBeVisible();
  await expect(convert.getByTestId("convert-summary")).toHaveText("8 notes, C4 to G4", { timeout: 15_000 });
  // Drums hears no hits in a sine.
  await convert.getByRole("radio", { name: "Drums" }).click();
  await expect(convert.getByTestId("convert-summary")).toHaveText("0 kicks, 0 snares, 0 hats");
  await convert.getByRole("radio", { name: "Melodic" }).click();
  await convert.getByRole("button", { name: "Convert", exact: true }).click();
  await expect(convert).toBeHidden();
  await expect.poll(async () => (await savedSong(page, id)).patterns.map((p: { name: string }) => p.name), { timeout: 15_000 }).toContain("Song notes");
  const converted = await savedSong(page, id);
  const pattern = converted.patterns.find((p: { name: string }) => p.name === "Song notes");
  const sampler = converted.channels.find((c: { name: string; sampleId: string | null }) => c.name === "Song notes");
  // A sampler (the kit's tone): replace it with any instrument.
  expect(sampler).toMatchObject({ kind: "sampler" });
  expect(converted.channels.some((c: { kind: string; sampleId: string | null }) => c.kind === "audio" && c.sampleId === sampler.sampleId)).toBe(false);
  const notes = pattern.notes[sampler.id] as { start: number; pitch: number }[];
  expect(notes.map((n) => [n.start, n.pitch])).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((k) => [k * 96, [60, 64, 67][k % 3]]));
  expect(converted.playlist.clips.find((c: SavedClip) => c.kind === "pattern")).toMatchObject({ ref: pattern.id, track: 1, start: 0, length: 2 * BAR_TICKS });
  // The Piano roll shows it.
  await expect(page.getByTestId("piano-roll")).toBeVisible();

  // The assistant: stems from the channel's file (under each of its clips), and its drums as notes.
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill(['call extract_stems {"audio": "Song", "stems": ["vocals", "other"], "mute": false}', 'call convert_to_notes {"clip": 1, "kind": "melodic", "quantize": 2}'].join("\n"));
  await composer.press("Enter");
  await expect(panel).toContainText("extract_stems: ok, convert_to_notes: ok", { timeout: 30_000 });
  await expect.poll(async () => (await savedSong(page, id)).patterns.filter((p: { name: string }) => p.name === "Song notes").length).toBe(2);
  const assisted = await savedSong(page, id);
  expect(assisted.channels.filter((c: { name: string }) => c.name === "Song - Vocals" || c.name === "Song - Other")).toHaveLength(2);
  expect(assisted.playlist.clips.find((c: SavedClip) => c.id === 1)!.muted).toBe(false);
  const second = assisted.patterns.filter((p: { name: string }) => p.name === "Song notes").at(-1);
  const eighths = Object.values(second.notes as Record<string, { start: number }[]>)[0].map((n) => n.start % 48);
  expect(eighths.every((r) => r === 0)).toBe(true);
});
