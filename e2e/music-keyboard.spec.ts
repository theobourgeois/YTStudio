/**
 * The music suite by keyboard alone (`docs/claude/music.md`, "Keyboard-first"): the command palette, the
 * Piano roll's cursor and step edit, the rack's step cursor, the Playlist's cursor, the mixer's keys, a
 * knob typed into and the windows gone round with Alt+`. Each test makes its own song, against the
 * stand-in engine (it echoes MIDI, so step edit hears the typing keyboard). With `E2E_SHOTS` set to a
 * folder, each step is photographed there.
 */
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const shot = async (page: Page, name: string) => {
  if (!process.env.E2E_SHOTS) return;
  // Past the popovers' fade-in.
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(process.env.E2E_SHOTS, `${name}.png`) });
};

interface SavedNote {
  start: number;
  length: number;
  pitch: number;
  velocity: number;
}

/** A song with a plugin channel ("Fake Synth") and the starter kit's names, open, the Browser closed. */
async function openSong(page: Page, name: string, { playlist = false } = {}): Promise<string> {
  await page.addInitScript(() => localStorage.setItem("vaudio.music.browser", JSON.stringify({ open: false, width: 280, volume: 0.8, expanded: [] })));
  const created = await (await page.request.post("/api/projects", { data: { suite: "music", name } })).json();
  const song = await (await page.request.get(`/api/projects/${created.id}`)).json();
  song.channels = [
    { id: "chan_synth", name: "Fake Synth", kind: "plugin", plugin: { id: "VST3-Fake Synth-1", name: "Fake Synth", format: "VST3" } },
    { id: "chan_kick", name: "Kick", kind: "sampler", sampleId: null },
    { id: "chan_snare", name: "Snare", kind: "sampler", sampleId: null },
    { id: "chan_hat", name: "Hat", kind: "sampler", sampleId: null },
  ];
  await page.request.put(`/api/projects/${created.id}`, { data: song });
  await page.goto(`/p/${created.id}`);
  await expect(page.locator('[role=listitem][data-channel-name="Fake Synth"]')).toBeVisible();
  if (!playlist) await page.getByRole("button", { name: "Close Playlist" }).click();
  return created.id;
}

const savedSong = async (page: Page, id: string) => (await page.request.get(`/api/projects/${id}`)).json();
const savedNotes = async (page: Page, id: string, channel: string): Promise<SavedNote[]> => (await savedSong(page, id)).patterns[0].notes[channel] ?? [];
const drawn = (page: Page, name: string) =>
  page
    .locator(`[aria-label="${name} steps"]`)
    .locator("[data-step]")
    .evaluateAll((steps) => steps.map((s) => (s.getAttribute("aria-pressed") === "true" ? "x" : "-")).join(""));
const press = async (page: Page, ...keys: string[]) => {
  for (const key of keys) await page.keyboard.press(key);
};

test("the command palette finds anything by name and runs it, its keys shown", async ({ page }) => {
  await openSong(page, "Keys palette");
  await page.keyboard.press("ControlOrMeta+Shift+P");
  const palette = page.locator("[data-command-palette]");
  await expect(palette).toBeVisible();
  await shot(page, "01-palette");

  // A few letters: the commands that match, the best first, each with its keys.
  await page.keyboard.type("pno");
  await expect(palette.getByRole("option").first()).toContainText("Piano Roll");
  await shot(page, "02-palette-search");
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page.getByTestId("piano-roll")).toBeVisible();

  // F1 too; the Piano roll's commands now, its tools and snaps among them; Go to a channel.
  await page.keyboard.press("F1");
  await page.keyboard.type("snap beat");
  await shot(page, "03-palette-snap");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Snap" })).toContainText("Beat");
  await page.keyboard.press("F1");
  await page.keyboard.type("go hat");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-channel-name", "Hat");

  // ⌘P's project search, from the music editor too: typed into at once, Escape closes it.
  await page.keyboard.press("ControlOrMeta+p");
  const search = page.getByRole("dialog");
  await expect(search.getByRole("textbox", { name: "Find a project" })).toBeFocused();
  await page.keyboard.type("keys pal");
  await expect(search.getByRole("option").first()).toContainText("Keys palette");
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
});

test("the Piano roll by keyboard: a cursor that Enter writes at, Tab goes round, step edit writes what's played", async ({ page }) => {
  const id = await openSong(page, "Keys piano");
  await page.getByRole("button", { name: "Select Fake Synth" }).click();
  await page.keyboard.press("F7");
  await expect(page.getByTestId("piano-roll")).toHaveAttribute("data-channel-name", "Fake Synth");

  // The first arrow shows the cursor; Enter writes a note there (a beat, the default) and steps past it.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedNotes(page, id, "chan_synth")).length).toBe(1);
  const [first] = await savedNotes(page, id, "chan_synth");
  expect([first.start, first.length]).toEqual([0, 96]);
  const root = first.pitch;
  // Up a semitone each, a little tune.
  await press(page, "ArrowUp", "ArrowUp", "Enter", "ArrowUp", "ArrowUp", "Enter", "ArrowDown", "Enter");
  await expect.poll(async () => (await savedNotes(page, id, "chan_synth")).map((n) => [n.start, n.pitch])).toEqual([
    [0, root],
    [96, root + 2],
    [192, root + 4],
    [288, root + 3],
  ]);
  // Shift+Tab back to the last note, selected; Alt+Shift+→ makes it longer by the grid, Alt+Shift+↓ softer.
  await page.keyboard.press("Shift+Tab");
  await press(page, "Alt+Shift+ArrowRight", "Alt+Shift+ArrowRight", "Alt+Shift+ArrowDown");
  await expect.poll(async () => (await savedNotes(page, id, "chan_synth"))[3].length).toBeGreaterThan(96);
  expect((await savedNotes(page, id, "chan_synth"))[3].velocity).toBeLessThan(first.velocity);
  // X takes the note under the cursor out of the selection; End goes to the pattern's end.
  await page.keyboard.press("x");
  await page.keyboard.press("End");
  await shot(page, "04-piano-cursor");

  // Step edit (⌘E): what's played (here the typing keyboard, Z is C5) is written at the cursor.
  await page.keyboard.press("ControlOrMeta+e");
  await expect(page.getByRole("button", { name: "Step edit" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ControlOrMeta+t");
  const before = (await savedNotes(page, id, "chan_synth")).length;
  await press(page, "z", "c", "b");
  await expect.poll(async () => (await savedNotes(page, id, "chan_synth")).slice(before).map((n) => n.pitch)).toEqual([60, 64, 67]);
  const written = (await savedNotes(page, id, "chan_synth")).slice(before);
  // Each as long as the last note drawn (lengthened above), the cursor stepping past it.
  expect(written[0].length).toBe((await savedNotes(page, id, "chan_synth"))[3].length);
  expect(written[1].start - written[0].start).toBe(written[0].length);
  await shot(page, "05-step-edit");
  await page.keyboard.press("ControlOrMeta+t");
  await page.keyboard.press("ControlOrMeta+e");
  await expect(page.getByRole("button", { name: "Step edit" })).toHaveAttribute("aria-pressed", "false");
});

test("the rack's step cursor, the Playlist's cursor, Alt+` round the windows, the mixer's keys and a fader typed into", async ({ page }) => {
  const id = await openSong(page, "Keys rack", { playlist: true });

  // The rack: ← → move the step cursor along the selected channel, Enter turns a step on, ↓ the next channel.
  await page.getByRole("button", { name: "Select Kick" }).click();
  await press(page, "ArrowRight", "Enter");
  for (let i = 0; i < 3; i++) await press(page, "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "Enter");
  await expect.poll(() => drawn(page, "Kick")).toBe("x---x---x---x---");
  await press(page, "ArrowDown", "Home");
  for (let i = 0; i < 2; i++) await press(page, ...Array(4).fill("ArrowRight"), "Enter", ...Array(4).fill("ArrowRight"));
  await press(page, "ArrowDown", "Home");
  for (let i = 0; i < 8; i++) await press(page, "ArrowRight", "Enter", "ArrowRight");
  await expect.poll(() => drawn(page, "Snare")).toBe("----x-------x---");
  await expect.poll(() => drawn(page, "Hat")).toBe("-x-x-x-x-x-x-x-x");
  await shot(page, "06-rack-cursor");

  // Alt+`: the window at the back (the Playlist) comes to the front, with the keyboard.
  await page.keyboard.press("Alt+Backquote");
  await expect.poll(() => page.locator('[data-window="playlist"]').evaluate((e) => e.contains(document.activeElement))).toBe(true);
  // Its cursor: Enter puts the pattern there and steps past it; ↓ a track down.
  await press(page, "ArrowRight", "Enter", "Enter", "ArrowDown", "Home", "Enter", "ArrowRight", "Enter");
  await expect.poll(async () => (await savedSong(page, id)).playlist.clips.map((c: { start: number; track: number }) => [c.track, c.start])).toHaveLength(4);
  await shot(page, "07-playlist-cursor");

  // The mixer: a digit goes to that insert, ↑ ↓ its fader, M mutes it.
  await page.keyboard.press("F9");
  const mixer = page.getByTestId("mixer");
  await expect(mixer).toBeVisible();
  await page.keyboard.press("3");
  await expect(mixer.locator('[data-track-name="Insert 3"]')).toHaveAttribute("aria-selected", "true");
  await press(page, "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "m");
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[3].volume).toBeLessThan(0.8);
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[3].muted).toBe(true);
  await page.keyboard.press("m");

  // A focused fader: typing a number types its level in, in dB; Enter sets it and the focus stays on the fader.
  const fader = mixer.locator('[data-track-name="Insert 3"]').getByRole("slider", { name: "Insert 3 volume" });
  await fader.focus();
  await press(page, "-", "1", "2");
  await expect(page.getByRole("textbox", { name: "Insert 3 volume in dB" })).toHaveValue("-12");
  await shot(page, "08-fader-typed");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[3].volume).toBeLessThan(0.6);
  await expect(fader).toBeFocused();
  // Home and End its ends, Delete back to 0 dB.
  await page.keyboard.press("End");
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[3].volume).toBe(1);
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await savedSong(page, id)).mixer.tracks[3].volume).toBe(0.8);
  await shot(page, "09-mixer");
});
