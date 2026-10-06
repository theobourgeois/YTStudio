import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ProjectSummary } from "../shared/types.ts";

const SAMPLES = path.resolve(import.meta.dirname, "..", "samples");
/** The e2e server's data folder (playwright.config.ts): its projects are in its Documents/Vaudio. */
const DATA_DIR = path.resolve(import.meta.dirname, ".data");
const FILES = [
  "vertical-1080x1920-6s.mp4",
  "landscape-1920x1080-8s.mp4",
  "square-1080-5s.mp4",
  "music-20s.mp3",
].map((f) => path.join(SAMPLES, f));

test.describe.configure({ mode: "serial" });

/** Clips currently on the timeline, left to right per lane. */
async function timelineClips(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-clip-id]")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.clipId!, x: r.x, y: r.y, w: r.width, h: r.height, text: el.textContent ?? "" };
      })
      .sort((a, b) => a.y - b.y || a.x - b.x),
  );
}

/** The open project's id (from the `/p/<id>` URL). */
const openProjectId = (page: Page) => new URL(page.url()).pathname.split("/").pop()!;

/** The open project's document as saved on the server (the id comes from the `/p/<id>` URL). */
async function savedProject(page: Page) {
  await expect(page).toHaveURL(/\/p\/[\w-]+$/);
  return page.evaluate(() => {
    const id = location.pathname.split("/").pop();
    return fetch(`/api/projects/${id}`).then((r) => r.json());
  });
}

async function projectList(page: Page) {
  return page.evaluate(() => fetch("/api/projects").then((r) => r.json()));
}

/**
 * Open the latest saved project, as the app used to on start (it starts on the Home screen now): most tests
 * carry on with the video the ones before made.
 */
async function openLatest(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
  const projects: ProjectSummary[] = await projectList(page);
  const latest = projects.reduce<ProjectSummary | null>((a, p) => (!a || p.updatedAt > a.updatedAt ? p : a), null);
  if (latest) await page.goto(`/p/${latest.id}`);
  return latest!;
}

/** Start a new video from the New project picker (⇧⌘O, from anywhere). */
async function newVideo(page: Page) {
  await page.keyboard.press("ControlOrMeta+Shift+KeyO");
  await page.getByRole("dialog").getByRole("option", { name: /^Video/ }).click();
}

/** HTML5-drag a media card onto a point on the page. */
async function dragAsset(page: Page, name: string, x: number, y: number) {
  const card = page.locator("[draggable=true]").filter({ hasText: name }).first();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.down();
  await page.mouse.move(x - 20, y, { steps: 5 });
  await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
}

async function laneY(page: Page, name: "Video 1" | "Audio 1") {
  const header = page.getByText(name, { exact: true }).last();
  const box = (await header.boundingBox())!;
  return box.y + box.height / 2;
}

/** Default zoom (px per second); the tests never change it. */
const PX_PER_S = 60;

/** Page x of timeline time `t` (with the timeline scrolled to the start). */
async function timeX(page: Page, t: number) {
  const box = (await page.locator("[data-timeline-lanes]").boundingBox())!;
  return box.x + t * PX_PER_S;
}

type SavedClip = {
  id: string;
  trackId: string;
  start: number;
  in: number;
  out: number;
  effects: { type: string; enabled: boolean; params: Record<string, unknown> }[];
  nullObject?: true;
  parent?: { id: string };
};

/** A saved clip with everything about its effects (keyframes, expressions) and its markers. */
type FullClip = Omit<SavedClip, "effects"> & { effects: FullEffect[]; markers?: { id: string; time: number; label?: string }[] };
type FullEffect = {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, unknown>;
  keyframes?: Record<string, { time: number; value: unknown; easing: string; spatialOut?: number[] }[]>;
  expressions?: Record<string, string>;
};

/** A saved clip's parameters for one of its effects. */
function effectParams(project: { clips: SavedClip[] }, clipId: string, type: string) {
  return project.clips.find((c) => c.id === clipId)?.effects.find((e) => e.type === type)?.params;
}

/** Saved clips on a track as [start, in] pairs, in time order. */
async function trackLayout(page: Page, trackId: string) {
  const p = await savedProject(page);
  return (p.clips as SavedClip[])
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start)
    .map((c) => [c.start, c.in]);
}

/** Press-drag-release with intermediate moves (so drags cross their thresholds). */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  }
  await page.mouse.up();
}

test("starts a new video from the Home screen, a file of its own", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
  await page.getByRole("button", { name: "New video" }).click();
  await expect(page).toHaveURL(/\/p\/[\w-]+$/);
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
  const [project] = await projectList(page);
  expect(await projectList(page)).toHaveLength(1);
  // In the e2e data folder's Documents/Vaudio (the user's own ~/Documents/Vaudio otherwise).
  expect(project.path).toBe(path.resolve(DATA_DIR, "Documents", "Vaudio", "Untitled.vaudio"));
  expect(existsSync(path.join(project.path, "project.json"))).toBe(true);
});

test("imports media into the library and names the video after the first clip", async ({ page }) => {
  await openLatest(page);
  await page.locator("input[type=file]").setInputFiles(FILES);
  for (const f of FILES) {
    await expect(page.getByText(path.basename(f).slice(0, 12)).first()).toBeVisible();
  }
  // Unsupported files are rejected with a clear message.
  await page.locator("input[type=file]").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.locator("[draggable=true]")).toHaveCount(FILES.length);
  await expect.poll(async () => (await projectList(page))[0].name).toMatch(/^(vertical|landscape|square|music)/);
});

test("drags clips onto the timeline where they're dropped; music goes to audio", async ({ page }) => {
  await openLatest(page);
  const videoY = await laneY(page, "Video 1");
  // Near 0 and near the end of the first clip: both snap exactly.
  await dragAsset(page, "vertical-1080x1920", await timeX(page, 0.05), videoY);
  await dragAsset(page, "landscape-1920x1080", await timeX(page, 6.05), videoY);
  // Past the end: stays where it's dropped, leaving a gap.
  await dragAsset(page, "square-1080", await timeX(page, 15), videoY);
  // Dropping music on the video lane is routed to an audio track.
  await dragAsset(page, "music-20s", await timeX(page, 1), videoY);

  await expect.poll(async () => (await timelineClips(page)).length).toBe(4);
  await expect.poll(() => trackLayout(page, "main")).toEqual([
    [0, 0],
    [6, 0],
    [15, 0],
  ]);
  await expect.poll(async () => (await trackLayout(page, "audio_1")).length).toBe(1);

  // Scrubbing the ruler with ⌘ held, the playhead hops to the nearest clip start or end.
  const rulerY = (await page.locator("[data-timeline-lanes]").boundingBox())!.y - 10;
  await page.keyboard.down("Meta");
  await drag(page, { x: await timeX(page, 3.2), y: rulerY }, { x: await timeX(page, 13.3), y: rulerY });
  await page.keyboard.up("Meta");
  await expect(page.getByText("0:14.00", { exact: true })).toBeVisible();
});

test("splits at the playhead, deletes (leaving a gap), closes a clicked gap or ripple-deletes, undoes and redoes", async ({ page }) => {
  await openLatest(page);
  await expect.poll(async () => (await timelineClips(page)).length).toBe(4);

  // Seek to 3s with the keyboard (Home, then 3 × Shift+Right).
  await page.locator("body").click({ position: { x: 720, y: 20 } });
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByText("0:03.00", { exact: false }).first()).toBeVisible();

  const first = (await timelineClips(page))[0];
  await page.mouse.click(first.x + 10, first.y + first.h / 2);
  await page.keyboard.press("s");
  await expect.poll(async () => (await timelineClips(page)).length).toBe(5);

  // The left half stays selected; Delete leaves a gap...
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await timelineClips(page)).length).toBe(4);
  await expect.poll(() => trackLayout(page, "main")).toEqual([
    [3, 3],
    [6, 0],
    [15, 0],
  ]);

  // ...clicking that gap selects it and Delete closes it (DaVinci-style)...
  const next = (await timelineClips(page))[0];
  await page.mouse.click(await timeX(page, 1.5), next.y + next.h / 2);
  await page.keyboard.press("Backspace");
  await expect.poll(() => trackLayout(page, "main")).toEqual([
    [0, 3],
    [3, 0],
    [12, 0],
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => trackLayout(page, "main")).toEqual([
    [3, 3],
    [6, 0],
    [15, 0],
  ]);

  // ...Shift+Delete closes it (later clips on that track slide left).
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await timelineClips(page)).length).toBe(5);
  const left = (await timelineClips(page))[0];
  await page.mouse.click(left.x + 10, left.y + left.h / 2);
  await page.keyboard.press("Shift+Backspace");
  await expect.poll(() => trackLayout(page, "main")).toEqual([
    [0, 3],
    [3, 0],
    [12, 0],
  ]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await timelineClips(page)).length).toBe(5);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await timelineClips(page)).length).toBe(4);

  // State survives a reload (autosave).
  await page.waitForTimeout(600);
  await page.reload();
  await expect.poll(async () => (await timelineClips(page)).length).toBe(4);
});

test("moves clips freely with snapping, onto a new track, and trims an edge", async ({ page }) => {
  await openLatest(page);
  await expect.poll(async () => (await trackLayout(page, "main")).length).toBe(3);
  const byStart = async () => {
    const p = await savedProject(page);
    return (p.clips as SavedClip[]).filter((c) => c.trackId === "main").sort((a, b) => a.start - b.start);
  };
  const [head, middle, last] = await byStart(); // 0..3, 3..11, 12..17

  // Drag the last clip left by ~1.05s: its start snaps onto the end of the middle clip (11).
  const lastBox = (await timelineClips(page)).find((c) => c.id === last.id)!;
  const y = lastBox.y + lastBox.h / 2;
  await drag(page, { x: lastBox.x + 30, y }, { x: lastBox.x + 30 - 1.05 * PX_PER_S, y });
  await expect.poll(() => trackLayout(page, "main")).toEqual([
    [0, 3],
    [3, 0],
    [11, 0],
  ]);

  // Snapping off (N): a small nudge right stays exactly where it's dropped instead of snapping back.
  await page.keyboard.press("n");
  await expect(page.getByRole("button", { name: "Snapping" })).toHaveAttribute("aria-pressed", "false");
  const snappedBox = (await timelineClips(page)).find((c) => c.id === last.id)!;
  await drag(page, { x: snappedBox.x + 30, y }, { x: snappedBox.x + 30 + 0.1 * PX_PER_S, y });
  await expect.poll(async () => (await byStart())[2].start).toBeCloseTo(11.1, 3);
  // Dropped over a neighbour, a clip lands right next to it instead of overlapping.
  const middleBox = (await timelineClips(page)).find((c) => c.id === middle.id)!;
  await drag(page, { x: middleBox.x + 30, y }, { x: middleBox.x + 30 - 0.5 * PX_PER_S, y });
  await expect.poll(async () => (await byStart())[1].start).toBe(3);
  await page.keyboard.press("n");

  // Drag the first clip up above the top track: it goes onto a new video track.
  const headBox = (await timelineClips(page)).find((c) => c.id === head.id)!;
  const top = (await page.locator("[data-timeline-lanes]").boundingBox())!.y;
  await drag(page, { x: headBox.x + 20, y: headBox.y + headBox.h / 2 }, { x: headBox.x + 20, y: top + 6 });
  await expect
    .poll(async () => {
      const p = await savedProject(page);
      const clip = (p.clips as SavedClip[]).find((c) => c.id === head.id)!;
      return [p.tracks.map((t: { kind: string }) => t.kind), clip.trackId === p.tracks[0].id, clip.start];
    })
    .toEqual([["video", "video", "audio"], true, 0]);
  await expect(page.getByText("Video 2", { exact: true }).first()).toBeVisible();

  // Trim its right edge left by ~1s worth of pixels.
  const moved = (await timelineClips(page)).find((c) => c.id === head.id)!;
  await drag(
    page,
    { x: moved.x + moved.w - 2, y: moved.y + moved.h / 2 },
    { x: moved.x + moved.w - 2 - PX_PER_S, y: moved.y + moved.h / 2 },
  );
  await expect
    .poll(async () => (await timelineClips(page)).find((c) => c.id === head.id)!.w)
    .toBeLessThan(moved.w - 40);

  // Auto ripple on: trimming the middle clip's end brings the clip after it along, keeping the 0.1s between them.
  await page.getByRole("button", { name: "Auto ripple" }).click();
  await expect(page.getByRole("button", { name: "Auto ripple" })).toHaveAttribute("aria-pressed", "true");
  const [before1, before2] = await byStart();
  const midBox = (await timelineClips(page)).find((c) => c.id === middle.id)!;
  await drag(
    page,
    { x: midBox.x + midBox.w - 2, y: midBox.y + midBox.h / 2 },
    { x: midBox.x + midBox.w - 2 - PX_PER_S, y: midBox.y + midBox.h / 2 },
  );
  await expect.poll(async () => (await byStart())[0].out).toBeLessThan(before1.out - 0.5);
  const [after1, after2] = await byStart();
  expect(after1.start).toBe(before1.start);
  expect(after2.start - (after1.start + after1.out - after1.in)).toBeCloseTo(before2.start - (before1.start + before1.out - before1.in), 3);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await byStart())[1].start).toBe(before2.start);
  await page.getByRole("button", { name: "Auto ripple" }).click();
});

test("right-click menus, copy/paste and the shortcuts dialog", async ({ page }) => {
  await openLatest(page);
  await expect.poll(async () => (await timelineClips(page)).length).toBe(4);

  // Duplicate from a clip's context menu.
  const [clip] = await timelineClips(page);
  // A quick right-click (press + release) opens the menu without choosing anything.
  await page.mouse.click(clip.x + 10, clip.y + clip.h / 2, { button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.locator("header button", { hasText: "Undo" })).toBeDisabled(); // nothing was chosen
  await page.getByRole("menuitem", { name: /^Duplicate/ }).click();
  await expect.poll(async () => (await timelineClips(page)).length).toBe(5);
  await expect(page.getByRole("menu")).toHaveCount(0);
  // Copy + paste with the keyboard (pointer parked away from tooltips).
  await page.mouse.move(700, 300);
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => (await timelineClips(page)).length).toBe(6);

  // Select everything, then nothing.
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator("[data-clip-id][data-selected]")).toHaveCount(6);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-clip-id][data-selected]")).toHaveCount(0);

  // Right-click the empty start of the Video 1 track (its first clip moved up a track).
  await page.keyboard.press("Home"); // scrolls the timeline back to the start
  await page.mouse.click(await timeX(page, 1.5), await laneY(page, "Video 1"), { button: "right" });
  await expect(page.getByRole("menuitem", { name: "Close gap" })).toBeEnabled();
  await page.getByRole("menuitem", { name: "Add audio track" }).click();
  await expect(page.getByText("Audio 2", { exact: true })).toBeVisible();

  // The cheat sheet.
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Undo back to the original four clips (and remove the extra track).
  for (let i = 0; i < 3; i++) await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await timelineClips(page)).length).toBe(4);
});

test("plays back and keeps the video in sync with the clock", async ({ page }) => {
  await openLatest(page);
  await page.locator("body").click({ position: { x: 720, y: 20 } });
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);
  await page.keyboard.press("Space");
  const state = await page.evaluate(() => {
    const visible = document.querySelector<HTMLVideoElement>("[data-slot=canvas] video[data-shown]");
    return { paused: visible?.paused, t: visible?.currentTime ?? -1 };
  });
  expect(state.paused).toBe(true);
  expect(state.t).toBeGreaterThan(1);
});

test("exports an MP4", async ({ page }) => {
  await openLatest(page);
  await page.getByRole("button", { name: /^export$/i }).first().click();
  const dialog = page.getByRole("region", { name: "Export" });
  await dialog.getByText("720p").click();
  await dialog.getByRole("button", { name: /^export$/i }).click();
  await expect(dialog.getByRole("link", { name: /download/i }).or(dialog.getByRole("button", { name: /download/i }))).toBeVisible({
    timeout: 60_000,
  });
  const src = await dialog.locator("video").getAttribute("src");
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("video/mp4");
});

test("video settings dialog, clip volume and previewing a library file", async ({ page }) => {
  await openLatest(page);

  // Settings live in a window opened from the header, which applies them at once and leaves the editor usable.
  await page.getByRole("button", { name: "Video settings", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Video settings" });
  await dialog.getByRole("radio", { name: /Square/ }).click();
  await expect(page.getByRole("button", { name: "Video settings", exact: true })).toHaveText("1:1 · 30 fps");
  // Esc closes it; the button brings it back.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Video settings", exact: true }).click();
  await dialog.getByRole("radio", { name: /60 fps/ }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Video settings", exact: true })).toHaveText("1:1 · 60 fps");
  await expect.poll(async () => (await savedProject(page)).settings).toMatchObject({ aspectRatio: "1:1", fps: 60 });

  // The selected clip's volume, from the timeline toolbar.
  await expect(page.getByRole("button", { name: "Clip volume" })).toBeDisabled();
  const [clip] = await timelineClips(page);
  await page.mouse.click(clip.x + clip.w / 2, clip.y + clip.h / 2);
  await page.getByRole("button", { name: "Clip volume" }).click();
  await page.getByRole("slider", { name: "Volume" }).press("Home");
  await expect
    .poll(async () => effectParams(await savedProject(page), clip.id, "volume")?.level)
    .toBe(0);
  await page.keyboard.press("Escape");

  // Preview a library file in place of the timeline; Space drives it, Escape goes back.
  const card = page.locator("[draggable=true]").filter({ hasText: "square-1080" }).first();
  await card.click();
  const position = page.getByRole("slider", { name: "Preview position" });
  await expect(position).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause preview" })).toBeVisible(); // autoplays
  await page.mouse.move(700, 300);
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play preview" })).toBeVisible();

  // Mark In at 1s and Out at 3s (I, O): only that part goes on the timeline.
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("i");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("o");
  const preview = page.getByRole("region", { name: "Preview", exact: true });
  await expect(preview.getByRole("button", { name: "Clear In and Out" })).toBeVisible();
  await expect(card.locator("[title^='Only the part']")).toBeVisible(); // the card shows the marked part
  const clipsBefore = new Set(((await savedProject(page)).clips as SavedClip[]).map((c) => c.id));
  await preview.getByRole("button", { name: "Add to timeline" }).click();
  await expect.poll(async () => ((await savedProject(page)).clips as SavedClip[]).length).toBe(clipsBefore.size + 1);
  const trimmed = ((await savedProject(page)).clips as SavedClip[]).find((c) => !clipsBefore.has(c.id))!;
  expect(trimmed.in).toBeCloseTo(1, 1);
  expect(trimmed.out).toBeCloseTo(3, 1);
  // Undone, so the tests after this one find the timeline as they left it.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => ((await savedProject(page)).clips as SavedClip[]).length).toBe(clipsBefore.size);
  // ⌥X clears them.
  await page.keyboard.press("Alt+KeyX");
  await expect(preview.getByRole("button", { name: "Clear In and Out" })).toHaveCount(0);
  // Dragging the trimmer's Out handle halfway along keeps the first half.
  const strip = (await position.boundingBox())!;
  const outHandle = (await preview.locator("[data-mark=out]").boundingBox())!;
  await page.mouse.move(outHandle.x + outHandle.width / 2, outHandle.y + outHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(strip.x + strip.width / 2, outHandle.y + outHandle.height / 2, { steps: 5 });
  await page.mouse.up();
  // About 2.5s of the 5s file (the chip's tooltip says where the marks are).
  await expect(preview.locator("[title^='In 0:00.00']")).toHaveAttribute("title", /Out 0:02\.[3-7]\d$/);
  await page.keyboard.press("Alt+KeyX");

  // ⌘U keeps the marked part (1s to 2s) as a subclip in Media, and clears the marks for the next part.
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("i");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("o");
  await page.keyboard.press("ControlOrMeta+u");
  const subclipCard = page.locator("[data-subclip]").filter({ hasText: "square-1080-5s 1" });
  await expect(subclipCard).toBeVisible();
  await expect(preview.getByRole("button", { name: "Clear In and Out" })).toHaveCount(0);
  await expect(preview.locator("[data-subclip-band]")).toHaveCount(1); // the trimmer shows the part kept
  type SavedSubclip = { id: string; name: string; in: number; out: number };
  const subclips = async () => ((await savedProject(page)).subclips ?? []) as SavedSubclip[];
  await expect.poll(async () => (await subclips()).map((s) => s.name)).toEqual(["square-1080-5s 1"]);
  const [kept] = await subclips();
  expect(kept.in).toBeCloseTo(1, 1);
  expect(kept.out).toBeCloseTo(2, 1);
  // Opening it shows its part; adding it puts that part on the timeline.
  await subclipCard.click();
  await expect(preview.getByText("Subclip", { exact: true })).toBeVisible();
  await page.mouse.move(700, 300);
  await preview.getByRole("button", { name: "Add to timeline" }).click();
  await expect.poll(async () => ((await savedProject(page)).clips as SavedClip[]).length).toBe(clipsBefore.size + 1);
  const fromSubclip = ((await savedProject(page)).clips as SavedClip[]).find((c) => !clipsBefore.has(c.id))!;
  expect([fromSubclip.in, fromSubclip.out]).toEqual([kept.in, kept.out]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => ((await savedProject(page)).clips as SavedClip[]).length).toBe(clipsBefore.size);
  // Deleted from its menu (an edit: the tests after this one find no subclips).
  await subclipCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete subclip" }).click();
  await expect(subclipCard).toHaveCount(0);
  await expect.poll(async () => (await subclips()).length).toBe(0);

  await page.keyboard.press("Escape");
  await expect(position).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("imports an image and transforms it in the properties panel and on the canvas", async ({ page }) => {
  await openLatest(page);
  await page.locator("input[type=file]").setInputFiles(path.join(SAMPLES, "sticker-800.png"));
  const card = page.locator("[draggable=true]").filter({ hasText: "sticker-800" });
  await expect(card).toBeVisible();
  const before = new Set(((await savedProject(page)).clips as SavedClip[]).map((c) => c.id));
  // Double-click appends it to the bottom video track (and selects it).
  await card.dblclick();
  await expect.poll(async () => ((await savedProject(page)).clips as SavedClip[]).length).toBe(before.size + 1);
  const image = ((await savedProject(page)).clips as SavedClip[]).find((c) => !before.has(c.id))!;
  expect(image.out - image.in).toBe(5); // a still's default length
  const motion = async () => effectParams(await savedProject(page), image.id, "motion")!;

  // Park the playhead on it: fit the timeline in view, then click the ruler above the clip.
  await page.getByRole("button", { name: "Zoom to fit" }).click();
  const clipBox = (await page.locator(`[data-clip-id="${image.id}"]`).boundingBox())!;
  const lanes = (await page.locator("[data-timeline-lanes]").boundingBox())!;
  await page.mouse.click(clipBox.x + clipBox.width / 2, lanes.y - 10);

  // An image has Motion and Opacity, but no Volume.
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  await expect(page.getByRole("region", { name: "Motion" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Opacity" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Volume" })).toHaveCount(0);

  // Type a value: click the number, type, Enter.
  await page.getByRole("spinbutton", { name: "Scale", exact: true }).click();
  await page.keyboard.type("50");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await motion()).scale).toBe(0.5);

  // Scrub a value: drag it sideways (1° per pixel).
  const rotation = (await page.getByRole("spinbutton", { name: "Rotation", exact: true }).boundingBox())!;
  const at = { x: rotation.x + rotation.width / 2, y: rotation.y + rotation.height / 2 };
  await drag(page, at, { x: at.x + 30, y: at.y });
  await expect.poll(async () => (await motion()).rotation).toBe(30);

  // The preview draws it where the properties say: half size, turned 30° clockwise. The sticker's
  // blue bar (just right of its middle, near the top) lands where it would show magenta unturned.
  const colourAt = (u: number, v: number) =>
    page.evaluate(
      ([u, v]) => {
        const gl = document.querySelector<HTMLCanvasElement>("[data-slot=preview-canvas]")!;
        const copy = document.createElement("canvas");
        copy.width = gl.width;
        copy.height = gl.height;
        const ctx = copy.getContext("2d")!;
        ctx.drawImage(gl, 0, 0);
        // (u, v): a point of the sticker from its centre, in fractions of its size.
        const side = Math.min(gl.width, gl.height) * 0.5;
        const [cos, sin] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
        const x = gl.width / 2 + side * (cos * u - sin * v);
        const y = gl.height / 2 + side * (sin * u + cos * v);
        const [r, g, b] = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return r > 150 && g < 90 && b < 90 ? "red" : b > 150 && r < 90 && g < 90 ? "blue" : `rgb(${r}, ${g}, ${b})`;
      },
      [u, v],
    );
  await expect.poll(() => colourAt(0.05, -0.3)).toBe("blue");
  expect(await colourAt(-0.4, 0)).toBe("red");

  // Canvas: a click on empty space deselects, a click on the image selects it.
  const canvas = (await page.locator("[data-slot=canvas]").boundingBox())!;
  const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  await page.mouse.click(canvas.x + 4, canvas.y + 4);
  await expect(page.getByText("Nothing selected")).toBeVisible();
  await page.mouse.click(centre.x + 20, centre.y + 20);
  await expect(page.getByRole("region", { name: "Motion" })).toBeVisible();

  // Drag it to move it (Alt: no snapping): one undo step.
  await page.keyboard.down("Alt");
  await drag(page, { x: centre.x + 20, y: centre.y + 20 }, { x: centre.x + 20 + canvas.width / 4, y: centre.y + 20 });
  await page.keyboard.up("Alt");
  await expect.poll(async () => ((await motion()).position as number[])[0]).toBeCloseTo(0.75, 2);
  expect(((await motion()).position as number[])[1]).toBeCloseTo(0.5, 5);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await motion()).position).toEqual([0.5, 0.5]);
  expect((await motion()).rotation).toBe(30);

  // Stretch: with uniform scale off, an edge handle changes only its own axis.
  await page.getByRole("switch", { name: "Uniform Scale" }).click();
  await expect(page.getByRole("spinbutton", { name: "Scale Height" })).toBeVisible();
  const edge = (await page.locator('[data-handle="0.5,0"]').boundingBox())!;
  const top = { x: edge.x + edge.width / 2, y: edge.y + edge.height / 2 };
  await drag(page, top, { x: top.x, y: top.y - 20 });
  await expect.poll(async () => (await motion()).scale as number).toBeGreaterThan(0.55);
  expect((await motion()).scaleWidth).toBe(0.5);

  // Reset puts all of Motion back.
  await page.getByRole("button", { name: "Reset Motion" }).click();
  await expect.poll(async () => (await motion()).rotation).toBe(0);
  expect(await motion()).toMatchObject({ scale: 1, scaleWidth: 1, uniformScale: true, position: [0.5, 0.5] });
});

test("animates a property with keyframes and edits them in the Effect Controls' lanes", async ({ page }) => {
  await openLatest(page);
  const media = await page.evaluate(() => fetch(`/api/media?projectId=${location.pathname.split("/").pop()}`).then((r) => r.json()));
  const stickerId = (media as { id: string; name: string }[]).find((a) => a.name === "sticker-800.png")!.id;
  const clipId = ((await savedProject(page)).clips as (SavedClip & { assetId: string })[]).find((c) => c.assetId === stickerId)!.id;
  type Keys = { time: number; value: number; easing: string }[];
  const opacityKeys = async () =>
    ((await savedProject(page)).clips as { id: string; effects: { type: string; keyframes?: Record<string, Keys> }[] }[])
      .find((c) => c.id === clipId)!.effects.find((e) => e.type === "opacity")!.keyframes?.opacity ?? [];

  // Select the image and park the playhead a fifth of the way in.
  await page.getByRole("button", { name: "Zoom to fit" }).click();
  const clip = page.locator(`[data-clip-id="${clipId}"]`);
  const box = (await clip.boundingBox())!;
  const lanes = (await page.locator("[data-timeline-lanes]").boundingBox())!;
  await clip.click({ position: { x: box.width / 2, y: 10 } });
  await page.mouse.click(box.x + box.width * 0.2, lanes.y - 10);
  await page.getByRole("tab", { name: "Properties", exact: true }).click();

  // The stopwatch starts animating; changing the value later on adds a keyframe there.
  await page.getByRole("button", { name: "Animate Opacity" }).click();
  await expect.poll(async () => (await opacityKeys()).map((k) => k.value)).toEqual([1]);
  await page.mouse.click(box.x + box.width * 0.7, lanes.y - 10);
  await page.getByRole("spinbutton", { name: "Opacity", exact: true }).click();
  await page.keyboard.type("20");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await opacityKeys()).map((k) => k.value)).toEqual([1, 0.2]);
  await expect(clip.locator("[data-clip-keyframes]")).toHaveAttribute("data-clip-keyframes", "2");

  // The navigator jumps back to the first keyframe (and is then on it).
  await page.getByRole("button", { name: "Previous Opacity keyframe" }).click();
  await expect(page.getByRole("button", { name: "Remove Opacity keyframe" })).toBeVisible();

  // The lanes: an interpolation from the keyframe's menu, then drag one along.
  await page.getByRole("button", { name: "Show keyframes" }).click();
  const diamonds = page.getByRole("group", { name: "Opacity keyframes", exact: true }).locator("[data-refs]");
  await expect(diamonds).toHaveCount(2);
  await diamonds.first().click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Ease Out" }).click();
  await expect.poll(async () => (await opacityKeys()).map((k) => k.easing)).toEqual(["ease-out", "linear"]);
  const before = (await opacityKeys())[1].time;
  const second = (await diamonds.nth(1).boundingBox())!;
  const at = { x: second.x + second.width / 2, y: second.y + second.height / 2 };
  await drag(page, at, { x: at.x - 30, y: at.y });
  await expect.poll(async () => (await opacityKeys())[1].time).toBeLessThan(before - 0.1);

  // ⌫ deletes the selected keyframe (not the clip); undo brings it back.
  await diamonds.nth(1).click();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await opacityKeys()).length).toBe(1);
  await expect(clip).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await opacityKeys()).length).toBe(2);

  // Turning the stopwatch off drops the keyframes and keeps the value showing.
  await page.getByRole("button", { name: "Animate Opacity" }).click();
  await expect.poll(async () => (await opacityKeys()).length).toBe(0);
  await page.getByRole("button", { name: "Hide keyframes" }).click();
});

test("adds transitions from the library, edits them and previews them", async ({ page }) => {
  await openLatest(page);
  await page.getByRole("tab", { name: "Effects", exact: true }).click();
  await page.getByRole("tab", { name: "Transitions" }).click();
  const card = (name: string) => page.locator("[data-transition-type]").filter({ hasText: name }).first();
  const withTransitions = async () =>
    ((await savedProject(page)).clips as (SavedClip & { transitionIn?: { type: string; duration: number }; transitionOut?: { type: string; duration: number } })[])
      .flatMap((c) => [c.transitionIn, c.transitionOut].filter(Boolean).map((t) => ({ clip: c.id, ...t! })));

  // Filter by tag and search.
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(card("Cube")).toBeVisible();
  await expect(card("Cross Dissolve")).toHaveCount(0);
  await page.getByRole("radio", { name: "All" }).click();
  await page.getByRole("searchbox", { name: "Search transitions" }).fill("dissolve");
  await expect(card("Cross Dissolve")).toBeVisible();
  await expect(card("Cube")).toHaveCount(0);

  // + puts it on the edit point nearest the playhead (the first clip's start) and selects it.
  await page.keyboard.press("Home");
  await card("Cross Dissolve").hover();
  await card("Cross Dissolve").getByRole("button", { name: "Add Cross Dissolve" }).click();
  await expect(page.locator("[data-transition]")).toHaveCount(1);
  await expect.poll(withTransitions).toEqual([expect.objectContaining({ type: "cross-dissolve", duration: 0.5 })]);

  // Its properties: type a new duration.
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  await expect(page.getByRole("region", { name: "Timing" })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Duration" }).click();
  await page.keyboard.type("1");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await withTransitions())[0]?.duration).toBe(1);

  // Drag another one onto the end of the first video clip.
  await page.getByRole("tab", { name: "Effects", exact: true }).click();
  await page.getByRole("tab", { name: "Transitions" }).click();
  await page.getByRole("searchbox", { name: "Search transitions" }).fill("glitch");
  const videoLane = await laneY(page, "Video 1");
  const video = (await timelineClips(page)).find((c) => Math.abs(c.y + c.h / 2 - videoLane) < 10)!;
  const src = (await card("Glitch").boundingBox())!;
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 3);
  await page.mouse.down();
  await page.mouse.move(video.x + video.w - 30, video.y + video.h / 2, { steps: 5 });
  await page.mouse.move(video.x + video.w - 6, video.y + video.h / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await withTransitions()).map((t) => t.type).sort()).toEqual(["cross-dissolve", "glitch"]);

  // Parked inside a transition, the preview draws it.
  const lanes = (await page.locator("[data-timeline-lanes]").boundingBox())!;
  await page.mouse.click(await timeX(page, 0.3), lanes.y - 10);
  await expect(page.locator("[data-slot=preview-canvas]")).toHaveAttribute("data-drawn", "transition");

  // Select one on the timeline and delete it; undo brings it back.
  await page.locator("[data-transition]").first().click();
  await page.keyboard.press("Delete");
  await expect(page.locator("[data-transition]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-transition]")).toHaveCount(2);
});

test("adds video effects from the Effects tab, edits, reorders and removes them", async ({ page }) => {
  await openLatest(page);
  await page.getByRole("tab", { name: "Effects", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Video effects" })).toHaveAttribute("aria-selected", "true");
  const card = (name: string) => page.locator("[data-effect-type]").filter({ hasText: name }).first();
  const videoLane = await laneY(page, "Video 1");
  const video = (await timelineClips(page)).find((c) => Math.abs(c.y + c.h / 2 - videoLane) < 10)!;
  const effectsOf = async () =>
    ((await savedProject(page)).clips as SavedClip[])
      .find((c) => c.id === video.id)!
      .effects.filter((e) => !["motion", "opacity", "volume"].includes(e.type))
      .map((e) => e.type);

  // Filter by category and search.
  await page.getByRole("radio", { name: "Blur" }).click();
  await expect(card("Gaussian Blur")).toBeVisible();
  await expect(card("Sepia")).toHaveCount(0);
  await page.getByRole("radio", { name: "All" }).click();
  await page.getByRole("searchbox", { name: "Search effects" }).fill("sepia");
  await expect(card("Sepia")).toBeVisible();
  await expect(card("Mosaic")).toHaveCount(0);

  // + adds it to the selected clip.
  await page.mouse.click(video.x + video.w / 2, video.y + video.h / 2);
  await card("Sepia").hover();
  await card("Sepia").getByRole("button", { name: "Add Sepia" }).click();
  await expect.poll(effectsOf).toEqual(["sepia"]);
  await expect(page.locator(`[data-clip-id="${video.id}"] [data-clip-effects]`)).toHaveAttribute("data-clip-effects", "sepia");

  // Drag another onto the clip on the timeline.
  await page.getByRole("searchbox", { name: "Search effects" }).fill("mosaic");
  const src = (await card("Mosaic").boundingBox())!;
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 3);
  await page.mouse.down();
  await page.mouse.move(video.x + video.w / 2, video.y + video.h / 2, { steps: 5 });
  await page.mouse.move(video.x + video.w / 2 + 4, video.y + video.h / 2, { steps: 2 });
  await page.mouse.up();
  await expect.poll(effectsOf).toEqual(["sepia", "mosaic"]);

  // Or onto the Properties panel, which shows the selected clip: it goes on that clip.
  await page.getByRole("searchbox", { name: "Search effects" }).fill("invert");
  const invert = (await card("Invert").boundingBox())!;
  const properties = (await page.getByRole("region", { name: "Properties panel" }).boundingBox())!;
  await page.mouse.move(invert.x + invert.width / 2, invert.y + invert.height / 3);
  await page.mouse.down();
  await page.mouse.move(properties.x + properties.width / 2, properties.y + properties.height / 2, { steps: 5 });
  await expect(page.getByTestId("properties-drop")).toHaveText("Drop to add to this clip");
  await page.mouse.move(properties.x + properties.width / 2 + 4, properties.y + properties.height / 2, { steps: 2 });
  await page.mouse.up();
  await expect.poll(effectsOf).toEqual(["sepia", "mosaic", "invert"]);
  await expect(page.getByTestId("properties-drop")).toHaveCount(0);
  await page.getByRole("button", { name: "Invert options" }).click();
  await page.getByRole("menuitem", { name: "Remove Invert" }).click();
  await expect.poll(effectsOf).toEqual(["sepia", "mosaic"]);

  // Properties: its settings, then move it up and remove the other.
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  await expect(page.getByRole("region", { name: "Mosaic" })).toBeVisible();
  await page.getByRole("button", { name: "Mosaic options" }).click();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect.poll(effectsOf).toEqual(["mosaic", "sepia"]);
  await page.getByRole("button", { name: "Sepia options" }).click();
  await page.getByRole("menuitem", { name: "Remove Sepia" }).click();
  await expect.poll(effectsOf).toEqual(["mosaic"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(effectsOf).toEqual(["mosaic", "sepia"]);

  // "Add an effect" goes back to the effects.
  await page.getByRole("button", { name: "Add an effect" }).click();
  await expect(page.getByRole("searchbox", { name: "Search effects" })).toBeVisible();

  // The line beside the panel resizes it (more cards per row); Reset layout puts it back.
  const panel = page.getByRole("region", { name: "Effects panel" });
  const before = (await panel.boundingBox())!.width;
  const edge = (await page.locator('[role=separator][aria-orientation=vertical][aria-label="Resize panels"]').first().boundingBox())!;
  await drag(page, { x: edge.x + edge.width / 2, y: edge.y + 300 }, { x: edge.x + edge.width / 2 + 60, y: edge.y + 300 });
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width - before)).toBe(60);
  await page.getByRole("button", { name: "Effects panel menu" }).click();
  await page.getByRole("menuitem", { name: "Reset layout" }).click();
  await expect.poll(async () => Math.round((await page.getByRole("region", { name: "Media panel" }).boundingBox())!.width)).toBe(Math.round(before));
});

test("panels dock where they're dragged, float out and back, and keep their layout", async ({ page }) => {
  await openLatest(page);
  await expect(page).toHaveURL(/\/p\/[\w-]+$/);
  const group = (title: string) => page.getByRole("region", { name: `${title} panel` });
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  /** A group's panel tabs (not the tabs inside its panels, like Media's sources). */
  const panelTabs = (title: string) => group(title).getByRole("tablist", { name: "Panels" }).getByRole("tab");
  /** Drag a panel's tab to a point (left held, to look at the drop before letting go). */
  const dragTab = async (name: string, to: { x: number; y: number }) => {
    const from = (await tab(name).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
  };

  // The usual layout: Media, Effects and Captions, the Program monitor, Properties, the timeline below.
  await expect(page.locator("[data-dock-group]")).toHaveCount(4);
  await expect(panelTabs("Media")).toHaveText(["Media", "Effects", "Captions"]);

  // Effects dropped in the middle of Properties: among its tabs, in front.
  const props = (await group("Properties").boundingBox())!;
  await dragTab("Effects", { x: props.x + props.width / 2, y: props.y + props.height / 2 });
  await expect(page.getByTestId("dock-drop-preview")).toHaveAttribute("data-zone", "center");
  await page.mouse.up();
  await expect(panelTabs("Effects")).toHaveText(["Properties", "Effects"]);
  await expect(panelTabs("Media")).toHaveText(["Media", "Captions"]);

  // Captions dragged to the Program monitor's left edge: a column of its own between the two.
  const program = (await group("Program").boundingBox())!;
  await dragTab("Captions", { x: program.x + 30, y: program.y + program.height / 2 });
  await expect(page.getByTestId("dock-drop-preview")).toHaveAttribute("data-zone", "left");
  await page.mouse.up();
  await expect(page.locator("[data-dock-group]")).toHaveCount(5);
  const captions = (await group("Captions").boundingBox())!;
  const media = (await group("Media").boundingBox())!;
  expect(captions.x).toBeGreaterThan(media.x + media.width - 2);
  expect(captions.x + captions.width).toBeLessThan((await group("Program").boundingBox())!.x + 2);

  // The layout is the same after a reload.
  await page.reload();
  await expect(page.locator("[data-dock-group]")).toHaveCount(5);
  await expect(panelTabs("Effects")).toHaveText(["Properties", "Effects"]);
  await expect(panelTabs("Captions")).toHaveText(["Captions"]);

  // The timeline floated out as a window, then docked back by its button.
  await page.getByRole("button", { name: "Timeline panel menu" }).click();
  await page.getByRole("menuitem", { name: "Float Timeline" }).click();
  const floated = page.locator('[data-window="panel:timeline"]');
  await expect(floated).toBeVisible();
  await expect(floated.getByRole("region", { name: "Timeline" })).toBeVisible();
  await expect(group("Timeline")).toHaveCount(0);
  await floated.getByRole("button", { name: "Dock Timeline" }).click();
  await expect(floated).toHaveCount(0);
  await expect(group("Timeline")).toBeVisible();

  // A workspace from any panel's menu; Reset layout goes back to the usual one.
  await page.getByRole("button", { name: "Program panel menu" }).click();
  await page.getByRole("menuitem", { name: "Compact" }).click();
  await expect(page.locator("[data-dock-group]")).toHaveCount(3);
  await expect(panelTabs("Media")).toHaveText(["Media", "Effects", "Captions", "Properties"]);
  await page.getByRole("button", { name: "Program panel menu" }).click();
  await page.getByRole("menuitem", { name: "Reset layout" }).click();
  await expect(page.locator("[data-dock-group]")).toHaveCount(4);
  await expect(panelTabs("Media")).toHaveText(["Media", "Effects", "Captions"]);
});

test("adds adjustment layers and solids, and presets: a transition across a cut and a move on a clip", async ({ page }) => {
  await openLatest(page);
  const videoLane = await laneY(page, "Video 1");
  const video = (await timelineClips(page)).find((c) => Math.abs(c.y + c.h / 2 - videoLane) < 10)!;
  type LayerClip = Omit<SavedClip, "effects"> & {
    adjustment?: true;
    effects: { type: string; enabled: boolean; params: Record<string, unknown>; keyframes?: Record<string, unknown[]> }[];
  };
  const saved = async () => (await savedProject(page)).clips as LayerClip[];
  const layers = async () => (await saved()).filter((c) => c.adjustment);

  // An adjustment layer over the selected clip, on a track above it.
  await page.mouse.click(video.x + video.w / 2, video.y + video.h / 2);
  await page.getByRole("button", { name: "New layer" }).click();
  await page.getByRole("menuitem", { name: /Adjustment layer/ }).click();
  await expect.poll(async () => (await layers()).length).toBe(1);
  const [layer] = await layers();
  const clip = (await saved()).find((c) => c.id === video.id)!;
  expect(layer.start).toBeCloseTo(clip.start, 3);
  expect(layer.trackId).not.toBe(clip.trackId);
  await expect(page.locator("[data-adjustment-note]")).toBeVisible();
  await expect(page.locator(`[data-clip-id="${layer.id}"]`)).toContainText("Adjustment Layer");
  // Its blend mode, from the menu of modes.
  await page.getByRole("combobox", { name: "Blend Mode" }).click();
  await page.getByRole("option", { name: "Screen" }).click();
  await expect.poll(async () => effectParams({ clips: await saved() }, layer.id, "opacity")?.blendMode).toBe("screen");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await layers()).length).toBe(0);

  // A solid.
  await page.getByRole("button", { name: "New layer" }).click();
  await page.getByRole("menuitem", { name: /Solid/ }).click();
  await expect.poll(async () => (await saved()).some((c) => c.effects.some((e) => e.type === "solid"))).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");

  // Presets: a spin across the cut nearest the playhead, drawn over what's below.
  await page.getByRole("tab", { name: "Effects", exact: true }).click();
  await page.getByRole("tab", { name: "Presets" }).click();
  await page.getByRole("searchbox", { name: "Search presets" }).fill("spin");
  const card = (name: string) => page.locator("[data-preset-type]").filter({ hasText: name }).first();
  await card("Spin Zoom").hover();
  await card("Spin Zoom").getByRole("button", { name: "Add Spin Zoom" }).click();
  await expect.poll(async () => (await layers()).length).toBe(1);
  const [spin] = await layers();
  expect(Object.keys(spin.effects.find((e) => e.type === "motion")!.keyframes!)).toEqual(expect.arrayContaining(["rotation", "scale"]));
  await expect(page.locator("canvas[data-drawn]").first()).not.toHaveAttribute("data-drawn", "empty");

  // A move dragged onto the clip goes on the clip itself.
  await page.getByRole("searchbox", { name: "Search presets" }).fill("punch");
  const src = (await card("Punch In").boundingBox())!;
  // The layer's new track on top moved the clip down.
  const target = (await page.locator(`[data-clip-id="${video.id}"]`).boundingBox())!;
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 3);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
  await page.mouse.move(target.x + target.width / 2 + 4, target.y + target.height / 2, { steps: 2 });
  await page.mouse.up();
  await expect
    .poll(async () => Object.keys((await saved()).find((c) => c.id === video.id)!.effects.find((e) => e.type === "motion")!.keyframes ?? {}))
    .toContain("scale");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await layers()).length).toBe(0);
});

test("adds text with the Type tool, types into it on the canvas, styles it and exports it", async ({ page }) => {
  await openLatest(page);
  const before = new Set(((await savedProject(page)).clips as SavedClip[]).map((c) => c.id));
  await page.getByRole("button", { name: "Go to start" }).click();

  // T, then a click on the canvas adds a text there and starts typing into it.
  await page.keyboard.press("t");
  const canvas = (await page.locator("[data-slot=canvas]").boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 4);
  const editor = page.getByRole("textbox", { name: "Text on canvas" });
  await expect(editor).toBeFocused();
  await page.keyboard.type("Big news");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);

  const text = () => savedProject(page).then((p) => (p.clips as SavedClip[]).find((c) => !before.has(c.id)));
  const param = async (type: string, key: string) => {
    const c = await text();
    return c && effectParams({ clips: [c] }, c.id, type)?.[key];
  };
  await expect.poll(() => param("text", "text")).toBe("Big news");
  const clip = (await text())!;
  expect(effectParams({ clips: [clip] }, clip.id, "motion")!.position).toEqual([0.5, expect.closeTo(0.25, 2)]);
  await expect(page.locator(`[data-clip-id="${clip.id}"]`)).toContainText("Big news");

  // Creating and typing were one step.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(text).toBeUndefined();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await text())?.id).toBe(clip.id);

  // Its properties: Text and Appearance, no framing.
  await page.locator(`[data-clip-id="${clip.id}"]`).click();
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  await expect(page.getByRole("region", { name: "Text" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Appearance" })).toBeVisible();
  await expect(page.locator('[data-param="fit"]')).toHaveCount(0);
  const hex = page.getByRole("textbox", { name: "Fill hex" });
  await hex.fill("#ff0000");
  await hex.press("Enter");
  await expect.poll(() => param("appearance", "fill")).toBe("#ff0000");

  // Double-clicking it on the canvas types into it again; emptying it removes it.
  await page.mouse.dblclick(canvas.x + canvas.width / 2, canvas.y + canvas.height / 4);
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  await expect.poll(text).toBeUndefined();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await text())?.id).toBe(clip.id);

  // The export gets the text drawn by the browser.
  const request = page.waitForRequest((r) => r.url().endsWith("/api/exports") && r.method() === "POST");
  await page.getByRole("button", { name: "Export" }).first().click();
  await page.locator('button[type="submit"]').click();
  const body = (await request).postDataJSON();
  expect(Object.keys(body.texts)).toContain(clip.id);
  await expect(page.getByText(/ready|done|finished/i).first()).toBeVisible({ timeout: 30_000 });
});

test("auto captions: makes captions from the speech, edits one's words and styles them all", async ({ page }) => {
  await openLatest(page);
  type Caption = SavedClip & { caption?: true; transitionIn?: { type: string } };
  const captions = () =>
    savedProject(page).then((p) => (p.clips as Caption[]).filter((c) => c.caption).sort((a, b) => a.start - b.start));
  const words = async () => (await captions()).map((c) => effectParams({ clips: [c] }, c.id, "text")!.text);

  await page.getByRole("button", { name: "Auto captions" }).first().click();
  const dialog = page.getByRole("region", { name: "Auto captions" });
  await dialog.getByRole("radio", { name: "Whole timeline" }).click();
  await dialog.getByRole("radio", { name: "Yellow" }).click();
  await dialog.getByRole("radio", { name: "Word" }).click();
  // The (stand-in) local engine is ready, so there's nothing to set up.
  await expect(dialog.getByRole("radio", { name: /On this Mac/ })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "Generate captions" }).click();
  await expect(page.getByText(/Added \d+ captions/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Captions", exact: true })).toHaveAttribute("aria-selected", "true");

  // One word each, in the Yellow style, popping in, on their own track.
  await expect.poll(async () => (await words()).slice(0, 3)).toEqual(["This", "is", "a"]);
  const made = await captions();
  expect(new Set(made.map((c) => c.trackId)).size).toBe(1);
  expect(effectParams({ clips: made }, made[0].id, "text")).toMatchObject({ font: "Futura", textCase: "upper" });
  expect(effectParams({ clips: made }, made[0].id, "appearance")!.fill).toBe("#ffe14d");
  expect(made.every((c) => c.transitionIn?.type === "pop")).toBe(true);
  await expect(page.locator(`[data-clip-id="${made[0].id}"]`)).toBeVisible();

  // Editing one caption's words in the transcript.
  const first = page.getByRole("textbox", { name: /^Caption at/ }).first();
  await first.fill("Hello");
  await first.press("Enter");
  await expect(page.getByRole("textbox", { name: /^Caption at/ }).nth(1)).toBeFocused();
  await expect.poll(async () => (await words())[0]).toBe("Hello");

  // A style for all of them, keeping each one's words; then no animation.
  await page.getByRole("radio", { name: "Boxed" }).click();
  await expect.poll(async () => (await captions()).every((c) => effectParams({ clips: [c] }, c.id, "appearance")!.background === 0.8)).toBe(true);
  expect((await words()).slice(0, 2)).toEqual(["Hello", "is"]);
  await page.getByRole("combobox", { name: "Animation" }).click();
  await page.getByRole("option", { name: "None", exact: true }).click();
  await expect.poll(async () => (await captions()).some((c) => c.transitionIn)).toBe(false);

  // A caption's own look is in Properties, which points back here.
  await page.getByTitle("Go to this caption").first().click();
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  await page.getByRole("button", { name: "Edit all captions" }).click();
  await expect(page.getByRole("tab", { name: "Captions", exact: true })).toHaveAttribute("aria-selected", "true");

  // Deleting them all is one undoable step.
  await page.getByRole("button", { name: "Delete all captions" }).click();
  await expect(page.getByText("No captions yet")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await captions()).length).toBe(made.length);
});

test("settings: a window; ⌘, opens it on the video editor's tab; themes and fonts change the whole app and last", async ({ page }) => {
  await openLatest(page);
  // Nothing picked yet: the theme follows the computer's (this browser's) light or dark.
  await expect(page.locator("html")).toHaveClass(/\btheme-light\b/);
  await newVideo(page);
  await expect(page).toHaveURL(/\/p\/[\w-]+$/);
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings.getByRole("tab", { selected: true })).toHaveText("Video editor");
  await expect(settings.getByRole("tab")).toHaveText(["General", "Video editor", "Music", "Photo"]);
  // Keys pressed in it are its own: Space doesn't play the video under it.
  await page.keyboard.press("Space");
  await expect(page.locator("[data-settings]")).toHaveCount(1);

  // The timeline's own toggle, here too.
  const ripple = settings.getByRole("switch", { name: "Auto ripple" });
  await expect(ripple).not.toBeChecked();
  await ripple.click();
  await expect(ripple).toBeChecked();
  // New layers start as long as asked.
  const length = settings.getByLabel("Length of new text and layers, in seconds");
  await length.fill("3");
  await length.press("Enter");

  // It's a window: dragged by its title bar, out of the way of the app under it, which still works.
  const title = settings.locator("[data-window-title]");
  const at = (await title.boundingBox())!;
  await page.mouse.move(at.x + 200, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + 500, at.y + 200, { steps: 6 });
  await page.mouse.move(at.x + 760, at.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await settings.boundingBox())!.x).toBeGreaterThan(at.x + 500);
  await page.getByRole("button", { name: "Auto ripple", exact: true }).click();
  await expect(ripple).not.toBeChecked();
  await page.getByRole("button", { name: "Auto ripple", exact: true }).click();
  await expect(ripple).toBeChecked();
  // A double-click on its title fills the window with it, and another puts it back.
  await title.dblclick({ position: { x: 100, y: 10 } });
  await expect(settings).toHaveAttribute("data-snap", "full");
  await title.dblclick({ position: { x: 100, y: 10 } });
  await expect(settings).not.toHaveAttribute("data-snap", "full");

  // The arrows go from tab to tab.
  await settings.getByRole("tab", { name: "Video editor" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(settings.getByRole("tab", { selected: true })).toHaveText("Music");
  await expect(settings.getByRole("tab", { name: "Music" })).toBeFocused();
  await settings.getByRole("tab", { name: "General" }).click();
  await expect(settings.getByRole("tab", { selected: true })).toHaveText("General");
  await expect(settings.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
  await settings.getByRole("radio", { name: "Ultraviolet" }).click();
  await expect(settings.getByRole("radio", { name: "Ultraviolet" })).toHaveAttribute("aria-checked", "true");
  // A dark theme is dark everywhere (`dark:` styles, the canvases).
  await expect(page.locator("html")).toHaveClass(/\btheme-ultraviolet\b.*\bdark\b|\bdark\b.*\btheme-ultraviolet\b/);
  await settings.getByRole("combobox", { name: "Interface font" }).click();
  await page.getByRole("option", { name: "Inter", exact: true }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Inter Variable");

  // Esc goes back to the video, where they all hold.
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-settings]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Auto ripple", exact: true })).toHaveAttribute("aria-pressed", "true");
  type Layer = SavedClip & { adjustment?: boolean };
  const before = new Set(((await savedProject(page)).clips as Layer[]).filter((c) => c.adjustment).map((c) => c.id));
  await page.getByRole("button", { name: "New layer" }).click();
  await page.getByRole("menuitem", { name: /Adjustment layer/ }).click();
  await expect
    .poll(async () => {
      const layer = ((await savedProject(page)).clips as Layer[]).find((c) => c.adjustment && !before.has(c.id));
      return layer ? layer.out - layer.in : null;
    })
    .toBe(3);

  // And after a reload.
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\btheme-ultraviolet\b/);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("Inter Variable");
  // ⌘, opens and closes it; the gear does too, on the open project's section.
  await page.keyboard.press("ControlOrMeta+Comma");
  await expect(settings).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Comma");
  await expect(settings).toBeHidden();
  await page.locator("header").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(settings.getByRole("tab", { selected: true })).toHaveText("Video editor");
  // Its × closes it.
  await settings.getByRole("button", { name: "Close Settings" }).click();
  await expect(settings).toBeHidden();

  // The tests after this one expect only the videos they made.
  const id = new URL(page.url()).pathname.split("/").pop();
  expect((await page.request.delete(`/api/projects/${id}`)).ok()).toBe(true);
});

test("goes Home and back, and opens, renames, duplicates, removes and trashes projects there", async ({ page }) => {
  const first = await openLatest(page);
  const firstUrl = page.url();

  // Start a second video (⇧⌘O, from anywhere); it opens empty.
  await newVideo(page);
  await expect.poll(() => page.url()).not.toBe(firstUrl);
  await expect(page.locator("[data-clip-id]")).toHaveCount(0);
  const secondUrl = page.url();
  const secondId = openProjectId(page);

  // Home (the corner's button) lists both, the latest first; ⇧⌘H goes back to the second, and Home again.
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const recent = page.getByRole("list", { name: "Recent projects" });
  const card = (id: string) => recent.locator(`[data-project-id="${id}"]`);
  await expect(recent.locator("[data-project-id]").first()).toHaveAttribute("data-project-id", secondId);
  await expect(card(first.id)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+KeyH");
  await expect(page).toHaveURL(secondUrl);
  await page.keyboard.press("ControlOrMeta+Shift+KeyH");
  await expect(page).toHaveURL(/\/$/);

  // Rename the second from its card: its file follows.
  await card(secondId).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Second take");
  await page.keyboard.press("Enter");
  await expect(card(secondId)).toContainText("Second take");
  const pathOf = async (id: string) => ((await projectList(page)) as ProjectSummary[]).find((p) => p.id === id)?.path;
  await expect.poll(() => pathOf(secondId)).toMatch(/\/Second take\.vaudio$/);
  expect(existsSync((await pathOf(secondId))!)).toBe(true);

  // Search narrows the cards; the suite filter too.
  await page.getByRole("searchbox", { name: "Search projects" }).fill("second");
  await expect(recent.locator("[data-project-id]")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search projects" }).fill("");
  await page.getByRole("radio", { name: "Songs" }).click();
  await expect(page.getByText("Nothing matches.")).toBeVisible();
  await page.getByRole("radio", { name: "All" }).click();

  // The first video kept its timeline through all the switching.
  await card(first.id).click();
  await expect(page).toHaveURL(firstUrl);
  await expect.poll(async () => (await timelineClips(page)).length).toBeGreaterThan(0);
  expect((await savedProject(page)).name).toBe(first.name);
  await page.getByRole("button", { name: "Home", exact: true }).click();

  // Duplicate it from its card: the copy, beside it, has the same timeline and its own media; Home stays.
  await card(first.id).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(recent.getByRole("button", { name: `${first.name} copy`, exact: true })).toBeVisible();
  const copy = ((await projectList(page)) as (ProjectSummary & { clipCount: number })[]).find((p) => p.name === `${first.name} copy`)!;
  expect(copy).toMatchObject({ clipCount: first.suite === "video" ? first.clipCount : 0, path: path.join(path.dirname(first.path), `${first.name} copy.vaudio`) });
  const media = (id: string) => page.evaluate((i) => fetch(`/api/media?projectId=${i}`).then((r) => r.json()), id);
  const [originals, copies] = [await media(first.id), await media(copy.id)];
  expect(copies.map((a: { name: string }) => a.name)).toEqual(originals.map((a: { name: string }) => a.name));
  await expect(page).toHaveURL(/\/$/);

  // Remove the copy from the recents: its file stays, and Open… (⌘O; a browser asks for the path) brings it back.
  await card(copy.id).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from Recents" }).click();
  await expect(card(copy.id)).toHaveCount(0);
  expect(existsSync(copy.path)).toBe(true);
  await page.keyboard.press("ControlOrMeta+KeyO");
  await page.getByRole("textbox", { name: "Project path" }).fill(copy.path);
  await page.getByRole("dialog").getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(`/p/${copy.id}`);
  await expect.poll(async () => (await timelineClips(page)).length).toBe(copy.clipCount);

  // Move it to the Trash, asked first (in the e2e data folder it's deleted rather than trashed).
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await card(copy.id).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Move to Trash" }).click();
  await expect(card(copy.id)).toHaveCount(0);
  await expect.poll(() => existsSync(copy.path)).toBe(false);
  expect(existsSync((await pathOf(first.id))!)).toBe(true);
});

test("keeps media and saved clips in the Library and uses them in another video", async ({ page }) => {
  await openLatest(page);
  const withClips = (await projectList(page)).find((p: { clipCount: number }) => p.clipCount > 0);
  await page.goto(`/p/${withClips.id}`);
  await expect.poll(async () => (await timelineClips(page)).length).toBeGreaterThan(0);
  const library = () => page.evaluate(() => fetch("/api/library").then((r) => r.json()));

  // An empty Library explains itself; make a folder.
  await page.getByRole("tab", { name: "Library" }).click();
  await expect(page.getByText("Your Library, in every video")).toBeVisible();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Logos");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("button", { name: /^Logos/ })).toBeVisible();

  // Add a media file to that folder from this video's media.
  await page.getByRole("tab", { name: /^This video/ }).click();
  const card = page.locator("[draggable=true]").filter({ hasText: "square-1080" }).first();
  await card.hover();
  await card.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Add to Library" }).click();
  await page.getByRole("menuitem", { name: "Logos" }).click();
  await expect.poll(async () => (await library()).items.length).toBe(1);

  // Save a timeline clip, with its settings, from its context menu.
  const [clip] = await timelineClips(page);
  await page.mouse.click(clip.x + 10, clip.y + clip.h / 2, { button: "right" });
  await page.getByRole("menuitem", { name: /Save to Library/ }).click();
  const dialog = page.getByRole("region", { name: "Save clip to Library" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Intro shot");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await library()).items.map((i: { kind: string }) => i.kind).sort()).toEqual(["clips", "media"]);

  // A new video can use both.
  await newVideo(page);
  await expect(page.locator("[data-clip-id]")).toHaveCount(0);
  await page.getByRole("tab", { name: "Library" }).click();
  const saved = page.locator("[data-library-item]").filter({ hasText: "Intro shot" });
  const box = (await saved.boundingBox())!;
  const x = await timeX(page, 2);
  const y = await laneY(page, "Video 1");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.down();
  await page.mouse.move(x - 20, y, { steps: 5 });
  await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await savedProject(page)).clips.map((c: SavedClip) => c.start)).toEqual([2]);

  await page.getByRole("button", { name: /^Logos/ }).click();
  await page.locator("[data-library-item]").filter({ hasText: "square-1080" }).dblclick();
  await expect.poll(async () => (await savedProject(page)).clips.length).toBe(2);
  // The media was copied into this video, once per file.
  const project = await savedProject(page);
  const used = new Set((project.clips as SavedClip[]).map((c) => (c as SavedClip & { assetId: string }).assetId).filter(Boolean));
  const media = await page.evaluate((id) => fetch(`/api/media?projectId=${id}`).then((r) => r.json()), openProjectId(page));
  expect(media.map((m: { id: string }) => m.id).sort()).toEqual([...used].sort());
  expect(used.size).toBeGreaterThan(0);

  // Search every folder, star an item, and find it in Favourites.
  await page.getByRole("searchbox", { name: "Search the Library" }).fill("intro");
  const result = page.locator("[data-library-item]");
  await expect(result).toHaveCount(1);
  await result.hover();
  await result.getByRole("button", { name: "Add to favourites" }).click();
  await page.getByRole("searchbox", { name: "Search the Library" }).fill("");
  await page.getByRole("navigation", { name: "Library folders" }).getByRole("button", { name: "Library" }).click();
  await page.getByRole("button", { name: /^Favourites/ }).click();
  await expect(page.locator("[data-library-item]")).toHaveText(/Intro shot/);

  // Deleting it from the Library leaves the video alone.
  await page.locator("[data-library-item]").hover();
  await page.locator("[data-library-item]").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect.poll(async () => (await library()).items.length).toBe(1);
  expect((await savedProject(page)).clips).toHaveLength(2);
});

test("skims a video's card and copies one clip's effects onto another", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await expect(page.locator("[data-clip-id]")).toHaveCount(0);
  await page.getByRole("tab", { name: /^This video/ }).click();
  await page.locator("input[type=file]").first().setInputFiles([FILES[1], FILES[2]]);
  const card = page.locator("[draggable=true]").filter({ hasText: "landscape-1920x1080" }).first();
  await expect(card).toBeVisible();

  // Moving across the card shows the filmstrip frame under the mouse.
  const thumb = card.locator("div.aspect-video");
  const box = (await thumb.boundingBox())!;
  const frameAt = async (fraction: number) => {
    await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 2 });
    return thumb.locator("img[src*='/frames/']").getAttribute("src");
  };
  await expect.poll(() => frameAt(0.1), { timeout: 20_000 }).toMatch(/frames\/\d+\.jpg$/);
  const early = await frameAt(0.1);
  expect(await frameAt(0.9)).not.toBe(early);
  await page.mouse.move(0, 0);
  await expect(thumb.locator("img[src*='/frames/']")).toHaveCount(0);

  const y = await laneY(page, "Video 1");
  await dragAsset(page, "landscape-1920x1080", await timeX(page, 0.05), y);
  await dragAsset(page, "square-1080", await timeX(page, 9), y);
  await expect.poll(async () => (await timelineClips(page)).length).toBe(2);
  const [first, second] = await timelineClips(page);

  // Fill is a Motion value: copy it from the first clip, paste it onto the second.
  await page.mouse.click(first.x + 10, first.y + first.h / 2, { button: "right" });
  await page.getByRole("menuitemradio", { name: /Fill/ }).click();
  await page.mouse.click(first.x + 10, first.y + first.h / 2, { button: "right" });
  await page.getByRole("menuitem", { name: "Copy effects" }).click();
  await page.mouse.click(second.x + 10, second.y + second.h / 2, { button: "right" });
  await page.getByRole("menuitem", { name: "Paste effects" }).click();
  await page.getByRole("menuitem", { name: /All effects/ }).click();
  const fits = async () =>
    (await savedProject(page)).clips.map((c: { effects: { type: string; params: { fit?: string } }[] }) =>
      c.effects.find((e) => e.type === "motion")?.params.fit,
    );
  await expect.poll(fits).toEqual(["cover", "cover"]);
});

test("the assistant edits the video with the editor's tools, live and undoably; outside agents can too", async ({ page }) => {
  // Claude Code is played by e2e/fake-claude.mjs, which makes the tool calls a message lists.
  const latest = await openLatest(page);
  await page.goto(`/p/${latest.id}`);
  await expect(page.locator("[data-clip-id]")).toHaveCount(2);

  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  await expect(panel.getByText("Claude Max")).toBeVisible();
  await expect(panel.getByText("Edit with Claude")).toBeVisible();
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });

  // Its edits happen on the open timeline, flash the clips they touch, and list as steps.
  await composer.fill('call get_timeline\ncall split_clips {"at": 1, "clipIds": ["$clip"]}');
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(panel.locator('[data-tool="split_clips"][data-status="done"]')).toContainText("Split 1 clip at 1s");
  await expect(page.locator("[data-clip-id]")).toHaveCount(3);
  await expect(page.locator("[data-assistant-flash]").first()).toBeAttached();
  await expect(panel.getByText("Done.")).toBeVisible();
  await expect.poll(async () => (await savedProject(page)).clips.length).toBe(3);

  // One click takes the whole answer back.
  await panel.getByRole("button", { name: "Revert" }).click();
  await expect(page.locator("[data-clip-id]")).toHaveCount(2);
  await expect(panel.getByText("Reverted")).toBeVisible();

  // The chat is kept with the video.
  await page.reload();
  await expect(panel.locator('[data-tool="split_clips"]')).toBeVisible();

  // Anything undo can't bring back asks first.
  await composer.fill('call list_media\ncall delete_media {"assetId": "$media"}');
  await composer.press("Enter");
  await page.getByRole("alertdialog", { name: /Delete/ }).getByRole("button", { name: "Don't" }).click();
  await expect(panel.locator('[data-tool="delete_media"][data-status="error"]')).toBeVisible();
  const media = await page.evaluate((id) => fetch(`/api/media?projectId=${id}`).then((r) => r.json()), latest.id);
  expect(media).toHaveLength(2);

  // A turn can be stopped; the preview says it's working meanwhile.
  await expect(composer).toBeEnabled();
  await composer.fill("wait");
  await composer.press("Enter");
  await expect(page.locator('[data-slot="assistant-activity"]')).toBeVisible();
  await panel.getByRole("button", { name: "Stop" }).click();
  await expect(panel.getByText("Stopped")).toBeVisible();
  await expect(page.locator('[data-slot="assistant-activity"]')).toHaveCount(0);

  // Any MCP client (e.g. Claude Code in a terminal) works in the open tab too.
  const mcp = async (method: string, params: object) => {
    const res = await fetch(`http://127.0.0.1:${process.env.E2E_SERVER_PORT || 5321}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return (await res.json()).result;
  };
  expect((await mcp("tools/list", {})).tools.map((t: { name: string }) => t.name)).toContain("split_clips");
  const timeline = await mcp("tools/call", { name: "get_timeline", arguments: {} });
  expect(timeline.content[0].text).toContain("Video 1");
  const tracks = (await savedProject(page)).tracks.length;
  await mcp("tools/call", { name: "add_track", arguments: { kind: "video" } });
  await expect(page.getByText("Agent: Add video track")).toBeVisible();
  await expect.poll(async () => (await savedProject(page)).tracks.length).toBe(tracks + 1);
});

test("Codex answers too, and a chat keeps editing its video while another one is open", async ({ page }) => {
  // Codex is played by e2e/fake-codex.mjs (like fake-claude.mjs), which names the model it ran on.
  const latest = await openLatest(page);
  const projects: ProjectSummary[] = await projectList(page);
  const other = projects.find((p) => p.id !== latest.id && p.suite === "video")!;
  await page.goto(`/p/${latest.id}`);
  await expect(page.locator("[data-clip-id]")).toHaveCount(2);

  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  await panel.getByRole("button", { name: "New chat" }).click();
  await expect(panel.getByText("Edit with Claude")).toBeVisible();

  // The picker lists each provider's models (Codex's as Codex lists them), newest first.
  await panel.locator('[data-slot="model-picker"]').click();
  await page.getByRole("tab", { name: "Codex" }).click();
  await expect(page.getByRole("option")).toHaveText([/GPT-6-Astra/, /GPT-6-Sol/, /GPT-5.5/]);
  await expect(page.getByText("Legacy models")).toBeVisible();
  await page.getByRole("option", { name: /GPT-6-Sol/ }).click();
  await expect(panel.getByText("Edit with Codex")).toBeVisible();
  await expect(panel.getByText("ChatGPT")).toBeVisible();
  // It thinks as hard as asked (the levels are the model's own).
  await panel.locator('[data-slot="effort-picker"]').click();
  await expect(page.getByRole("menuitem")).toHaveText(["Auto (Medium)", "Low", "Medium", "High", "Extra high", "Max", "Ultra"]);
  await page.getByRole("menuitem", { name: "High", exact: true }).click();
  await expect(panel.locator('[data-slot="effort-picker"]')).toHaveText("High");

  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill('call get_timeline\ncall split_clips {"at": 0.5, "clipIds": ["$clip"]}');
  await composer.press("Enter");
  await expect(panel.locator('[data-tool="split_clips"][data-status="done"]')).toContainText("Split 1 clip at 0.5s");
  await expect(page.locator("[data-clip-id]")).toHaveCount(3);
  await expect(panel.getByText("Done on gpt-6-sol at high.")).toBeVisible();

  // Go Home mid-answer: its card says it's working. Open another video: the chat carries on with its own.
  const tracks = (await savedProject(page)).tracks.length;
  await composer.fill('sleep 2500\ncall add_track {"kind": "video"}\ncall view_frames {"times": [0.2]}');
  await composer.press("Enter");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const card = page.locator(`[data-project-id="${latest.id}"]`);
  await expect(card).toHaveAttribute("data-chat-status", "working");
  await expect(card).toContainText("Working");
  await page.locator(`[data-project-id="${other.id}"]`).click();
  await expect(page).toHaveURL(`/p/${other.id}`);
  const saved = () => page.evaluate((id) => fetch(`/api/projects/${id}`).then((r) => r.json()), latest.id);
  await expect.poll(async () => (await saved()).tracks.length, { timeout: 15_000 }).toBe(tracks + 1);
  // It finished (looking at its video offscreen) while the user was elsewhere: Home says so.
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(card).toHaveAttribute("data-chat-status", "done", { timeout: 15_000 });
  await expect(card).toContainText("Done");

  await card.click();
  await expect(page).toHaveURL(`/p/${latest.id}`);
  await expect(panel.locator('[data-tool="view_frames"][data-status="done"]')).toBeVisible();
  await expect(panel.locator('[data-tool="add_track"][data-status="done"]')).toBeVisible();
  await expect.poll(async () => (await savedProject(page)).tracks.length).toBe(tracks + 1);
  // Seen: back Home, its card has nothing more to say.
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(card).not.toHaveAttribute("data-chat-status", /./);
});

test("plays an audio track cut into pieces with one pair of players", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await expect(page.locator("[data-clip-id]")).toHaveCount(0);
  await page.getByRole("tab", { name: /^This video/ }).click();
  await page.locator("input[type=file]").first().setInputFiles(FILES[3]);
  await expect(page.locator("[draggable=true]").filter({ hasText: "music-20s" }).first()).toBeVisible();
  const y = await laneY(page, "Audio 1");
  await dragAsset(page, "music-20s", await timeX(page, 0.05), y);
  await expect.poll(async () => (await timelineClips(page)).length).toBe(1);

  // Cut it at 1 s and 2 s.
  await page.locator("body").click({ position: { x: 720, y: 20 } });
  await page.keyboard.press("Home");
  for (const t of [1, 2]) {
    await page.keyboard.press("Shift+ArrowRight");
    await page.mouse.click(await timeX(page, t + 0.5), y);
    await page.keyboard.press("s");
  }
  await expect.poll(async () => (await timelineClips(page)).length).toBe(3);

  // However many pieces, the track plays through the same two elements, handing over at each cut.
  const players = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLAudioElement>("[data-slot=canvas] audio")].map((a) => ({ paused: a.paused, t: a.currentTime })),
    );
  expect(await players()).toHaveLength(2);
  await page.locator("body").click({ position: { x: 720, y: 20 } });
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await page.waitForTimeout(2500);
  const playing = (await players()).filter((p) => !p.paused);
  await page.keyboard.press("Space");
  expect(playing).toHaveLength(1);
  expect(playing[0].t).toBeGreaterThan(2);
  expect(playing[0].t).toBeLessThan(3.5);
});

test("marks a song's beats on its clip and cuts a clip to them", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await page.getByRole("tab", { name: /^This video/ }).click();
  await page.locator("input[type=file]").first().setInputFiles([FILES[0], FILES[3]]);
  await expect(page.locator("[draggable=true]").filter({ hasText: "music-20s" }).first()).toBeVisible();
  await expect(page.locator("[draggable=true]").filter({ hasText: "vertical-1080x1920" }).first()).toBeVisible();
  await dragAsset(page, "music-20s", await timeX(page, 0.05), await laneY(page, "Audio 1"));
  await expect.poll(async () => (await timelineClips(page)).length).toBe(1);
  await dragAsset(page, "vertical-1080x1920", await timeX(page, 0.05), await laneY(page, "Video 1"));
  await expect.poll(async () => (await timelineClips(page)).length).toBe(2);

  // The song's menu: the server listens to it, and its beats show along the clip's top edge.
  const [video, song] = await timelineClips(page);
  await page.mouse.click(song.x + 30, song.y + song.h - 6, { button: "right" });
  await page.getByRole("menuitem", { name: "Mark beats" }).click();
  await page.getByRole("menuitem", { name: "Every beat" }).click();
  await expect.poll(() => page.locator("[data-beat]").count(), { timeout: 60_000 }).toBeGreaterThan(8);
  type Marked = { id: string; start: number; in: number; out: number; markers?: { time: number; beat?: boolean }[] };
  const clips = async () => (await savedProject(page)).clips as Marked[];
  await expect.poll(async () => (await clips()).find((c) => c.id === song.id)?.markers?.length ?? 0).toBeGreaterThan(8);
  const beats = (await clips()).find((c) => c.id === song.id)!.markers!;
  expect(beats.every((m) => m.beat)).toBe(true);

  // The video clip (6 s) is cut to end on a beat: four markers on from its start.
  await page.mouse.click(video.x + 30, video.y + video.h - 6, { button: "right" });
  await page.getByRole("menuitem", { name: "Cut to the beat" }).click();
  await page.getByRole("menuitem", { name: "Every 4 markers" }).click();
  const fourth = beats.map((m) => m.time).filter((t) => t > 0.001)[3];
  await expect.poll(async () => {
    const clip = (await clips()).find((c) => c.id === video.id)!;
    return Math.abs(clip.out - clip.in - fourth);
  }).toBeLessThan(0.002);
  expect(fourth).toBeLessThan(6);
  // One undo puts its length back; the beats stay.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await clips()).find((c) => c.id === video.id)!.out).toBeGreaterThan(5.9);
  expect(await page.locator("[data-beat]").count()).toBeGreaterThan(8);
});

test("links a clip's scale to the song's bass, then to its kicks, and unlinks it", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await page.getByRole("tab", { name: /^This video/ }).click();
  await page.locator("input[type=file]").first().setInputFiles([FILES[0], FILES[3]]);
  await expect(page.locator("[draggable=true]").filter({ hasText: "music-20s" }).first()).toBeVisible();
  await dragAsset(page, "music-20s", await timeX(page, 0.05), await laneY(page, "Audio 1"));
  await expect.poll(async () => (await timelineClips(page)).length).toBe(1);
  await dragAsset(page, "vertical-1080x1920", await timeX(page, 0.05), await laneY(page, "Video 1"));
  await expect.poll(async () => (await timelineClips(page)).length).toBe(2);
  const [video] = await timelineClips(page);
  await page.mouse.click(video.x + 30, video.y + video.h / 2);
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  type Linked = { id: string; effects: (FullEffect & { links?: Record<string, { signal: { name?: string }; mode: string; amount: unknown; hit?: object }> })[] };
  const link = async () => ((await savedProject(page)).clips as Linked[]).find((c) => c.id === video.id)?.effects.find((e) => e.type === "motion")?.links?.scale;

  // The link button by Scale's stopwatch links it to the bass at once (a fifth more at full) and opens its popover.
  const motion = page.getByRole("region", { name: "Motion" });
  await motion.getByRole("button", { name: "Link Scale to a signal" }).click();
  await expect.poll(link).toMatchObject({ signal: { name: "bass" }, mode: "add", amount: 0.2 });
  const popover = page.locator("[data-link-popover=scale]");
  await expect(popover).toBeVisible();
  // Its meter reads the song once it's analysed.
  await expect(popover.locator("[data-link-value]")).toContainText("Now", { timeout: 60_000 });

  // Kicks: hits, each a punch.
  await popover.getByRole("combobox", { name: "Scale: signal" }).click();
  await page.getByRole("option", { name: "Kicks" }).click();
  await expect.poll(link).toMatchObject({ signal: { name: "onsetLow" }, hit: { decay: 0.25 } });
  await popover.getByRole("radio", { name: "multiply" }).click();
  await expect.poll(link).toMatchObject({ mode: "multiply", amount: 0.3 });
  // One undo takes the mode back; Unlink takes the link away.
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(link).toMatchObject({ mode: "add" });
  await expect(motion.getByRole("button", { name: "Link Scale to a signal" })).toHaveAttribute("aria-pressed", "true");
  await motion.getByRole("button", { name: "Link Scale to a signal" }).click();
  await page.locator("[data-link-popover=scale]").getByRole("button", { name: "Unlink" }).click();
  await expect.poll(link).toBeUndefined();
});

test("makes signals in the Signals window: a band from the spectrum, hits dragged on their lane, spectrograms", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await page.getByRole("tab", { name: /^This video/ }).click();
  await page.locator("input[type=file]").first().setInputFiles([FILES[3]]);
  await expect(page.locator("[draggable=true]").filter({ hasText: "music-20s" }).first()).toBeVisible();
  await dragAsset(page, "music-20s", await timeX(page, 0.05), await laneY(page, "Audio 1"));
  await expect.poll(async () => (await timelineClips(page)).length).toBe(1);
  type Signal = { id: string; name: string; kind: string; low?: number; high?: number; events?: { time: number }[] };
  const signals = async () => ((await savedProject(page)).signals ?? []) as Signal[];

  // The toolbar's Signals opens the window; New band makes a kick (40–120 Hz).
  await page.getByRole("button", { name: /^Signals/ }).click();
  const win = page.locator("[data-signals-window]");
  await expect(win).toBeVisible();
  await win.getByRole("button", { name: "New band" }).click();
  await expect.poll(signals).toMatchObject([{ name: "Kick", kind: "band", low: 40, high: 120 }]);
  // Dragged across the spectrum (log, 20 Hz to 20 kHz): about 200 Hz to 2 kHz.
  const spectrum = (await win.locator("[data-spectrum]").boundingBox())!;
  const at = (hz: number) => spectrum.x + (Math.log(hz / 20) / Math.log(1000)) * spectrum.width;
  await drag(page, { x: at(200), y: spectrum.y + 40 }, { x: at(2000), y: spectrum.y + 40 });
  await expect.poll(async () => {
    const [kick] = await signals();
    return Math.abs(Math.log((kick.low ?? 0) / 200)) < 0.1 && Math.abs(Math.log((kick.high ?? 0) / 2000)) < 0.1;
  }).toBe(true);
  // Its lane shows under the ruler, and the meter reads the song once it's analysed.
  await expect(page.locator("[data-signal-lane]")).toHaveCount(1);
  await expect(win.locator("[data-signal-meter]")).toContainText("Now");

  // New hits, one at the playhead (1 s): dragged half a second along its lane, then right-clicked away.
  await win.getByRole("button", { name: "New hits" }).click();
  await expect.poll(async () => (await signals()).length).toBe(2);
  const ruler = (await page.locator("[data-timeline-ruler]").boundingBox())!;
  await page.mouse.click(ruler.x + 60, ruler.y + ruler.height / 2);
  await win.getByRole("button", { name: "At the playhead" }).click();
  const hits = async () => (await signals())[1]?.events?.map((e) => Math.round(e.time * 100) / 100);
  await expect.poll(hits).toEqual([1]);
  const tick = (await page.locator("[data-hit]").first().boundingBox())!;
  // Without snapping (the magnet), so it lands where it's let go rather than on a beat.
  await page.getByRole("button", { name: "Snapping" }).click();
  await drag(page, { x: tick.x + 1, y: tick.y + tick.height / 2 }, { x: tick.x + 1 + 30, y: tick.y + tick.height / 2 });
  await expect.poll(hits).toEqual([1.5]);
  const moved = (await page.locator("[data-hit]").first().boundingBox())!;
  await page.mouse.click(moved.x + 1, moved.y + moved.height / 2, { button: "right" });
  await expect.poll(hits).toEqual([]);

  // Spectrograms instead of waveforms on audio clips.
  await expect(page.locator("[data-spectrogram]")).toHaveCount(0);
  await win.getByRole("switch", { name: "Spectrograms on audio clips" }).click();
  await expect(page.locator("[data-spectrogram]").first()).toBeVisible();
  await win.getByRole("switch", { name: "Spectrograms on audio clips" }).click();
  await page.getByRole("button", { name: "Snapping" }).click();
});

test("adds a visualizer that moves with the song, and edits what it listens to", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await page.getByRole("tab", { name: /^This video/ }).click();
  await page.locator("input[type=file]").first().setInputFiles([FILES[3]]);
  await expect(page.locator("[draggable=true]").filter({ hasText: "music-20s" }).first()).toBeVisible();
  await dragAsset(page, "music-20s", await timeX(page, 0), await laneY(page, "Audio 1"));
  await expect.poll(async () => (await timelineClips(page)).length).toBe(1);
  type Visual = { id: string; out: number; effects: { type: string; params: Record<string, unknown> }[] };
  const visualizer = async () => ((await savedProject(page)).clips as Visual[]).find((c) => c.effects.some((e) => e.type === "audio-bars"));

  // New item › Visualizer: Spectrum Bars drawn alone over what's below, as long as the song.
  const ruler = (await page.locator("[data-timeline-ruler]").boundingBox())!;
  await page.mouse.click(ruler.x + 1, ruler.y + ruler.height / 2);
  await page.getByRole("button", { name: "New layer" }).click();
  await page.getByRole("menuitem", { name: "Visualizer" }).click();
  await expect.poll(async () => (await visualizer())?.effects.find((e) => e.type === "audio-bars")?.params).toMatchObject({ blendMode: "replace", source: "master" });
  expect((await visualizer())!.out).toBeGreaterThan(19);

  // Once the song is analysed, bars stand on the Program monitor while it plays (the canvas is black elsewhere).
  await page.mouse.click(ruler.x + 2 * 60, ruler.y + ruler.height / 2);
  const lit = async () => {
    for (let u = 0.1; u < 0.9; u += 0.02) if ((await monitorPixel(page, u, 0.68)).some((c) => c > 60)) return true;
    return false;
  };
  await expect.poll(lit, { timeout: 60_000 }).toBe(true);
  await page.screenshot({ path: "/tmp/visualizer.png" });

  // Its Listens To picks an audio track; Properties shows the Audio effect's controls.
  const bars = page.getByRole("region", { name: "Spectrum Bars" });
  await bars.getByRole("combobox", { name: "Listens To" }).click();
  await page.getByRole("option", { name: "Audio 1" }).click();
  await expect.poll(async () => (await visualizer())?.effects.find((e) => e.type === "audio-bars")?.params.source).toMatch(/^t:/);
});

test("pinching over the monitor scales the selected clip, as one undo step", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await page.getByRole("tab", { name: /^This video/ }).click();
  await page.locator("input[type=file]").first().setInputFiles(FILES[0]);
  await expect(page.locator("[draggable=true]").filter({ hasText: "vertical-1080x1920" }).first()).toBeVisible();
  await dragAsset(page, "vertical-1080x1920", await timeX(page, 0.05), await laneY(page, "Video 1"));
  await expect.poll(async () => (await timelineClips(page)).length).toBe(1);

  const canvas = (await page.locator('[data-slot="transform-overlay"]').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  // A trackpad pinch arrives as a wheel event with ctrlKey.
  await page.keyboard.down("Control");
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -10);
  await page.keyboard.up("Control");
  const scale = async () => {
    const p = await savedProject(page);
    return p.clips[0] ? (effectParams(p, p.clips[0].id, "motion")?.scale as number) : 0;
  };
  await expect.poll(scale).toBeGreaterThan(1.3);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(scale).toBe(1);
});

test("speeds a clip up, reverses it and stretches it to fit, moving the clips after it", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await page.getByRole("tab", { name: /^This video/ }).click();
  await page.locator("input[type=file]").first().setInputFiles(FILES[0]);
  await expect(page.locator("[draggable=true]").filter({ hasText: "vertical-1080x1920" }).first()).toBeVisible();
  const y = await laneY(page, "Video 1");
  await dragAsset(page, "vertical-1080x1920", await timeX(page, 0.05), y);
  await expect.poll(async () => (await timelineClips(page)).length).toBe(1);
  // Cut it in two at 3 s.
  await page.locator("body").click({ position: { x: 720, y: 20 } });
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("s");
  await expect.poll(async () => (await timelineClips(page)).length).toBe(2);
  const clips = async () =>
    ((await savedProject(page)).clips as (SavedClip & { assetId: string; speed?: number; reversed?: boolean })[]).sort((a, b) => a.start - b.start);
  await expect.poll(async () => (await clips()).length).toBe(2);
  const [first] = await clips();

  // Twice as fast from the toolbar: half as long, and the next clip moves up.
  await page.mouse.click(await timeX(page, 1), y);
  await page.getByRole("region", { name: "Timeline", exact: true }).getByRole("button", { name: "Speed", exact: true }).click();
  // The toolbar's popover (Properties, beside the monitor, has the same control).
  const control = page.locator("[data-radix-popper-content-wrapper] [data-speed-control]");
  await control.getByRole("button", { name: "2×" }).click();
  await expect.poll(async () => (await clips()).map((c) => [c.start, c.speed])).toEqual([[0, 2], [1.5, undefined]]);
  await expect(control.locator("[data-speed-duration]")).toContainText("0:01.50");

  // Backwards: the preview plays the media's reversed copy, at the clip's speed.
  await control.getByRole("switch", { name: "Reverse" }).click();
  await expect.poll(async () => (await clips())[0].reversed).toBe(true);
  await expect(page.locator(`[data-clip-id="${first.id}"] [data-clip-speed]`)).toHaveAttribute("data-clip-speed", "-2");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => page.evaluate((id) => fetch(`/api/media/${id}`).then((r) => r.json()).then((a) => a.reversed?.status), first.assetId), { timeout: 30_000 })
    .toBe("ready");
  await page.locator("body").click({ position: { x: 720, y: 20 } });
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  const shown = await page.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>("[data-slot=canvas] video[data-shown]");
    return { src: v?.currentSrc ?? "", rate: v?.playbackRate ?? 0, t: v?.currentTime ?? 0 };
  });
  await page.keyboard.press("Space");
  expect(shown.src).toMatch(/\/reversed\.mp4$/);
  expect(shown.rate).toBeCloseTo(2, 1);
  // 6 s of media backwards from its 3 s mark: 3 s into the reversed copy, and on from there.
  expect(shown.t).toBeGreaterThan(3.5);

  // ⌥-drag its end in by half a second: the same media in 1 s is 3× speed.
  const clip = (await timelineClips(page)).find((c) => c.id === first.id)!;
  const edge = { x: clip.x + clip.w - 3, y: clip.y + clip.h / 2 };
  await page.keyboard.down("Alt");
  await drag(page, edge, { x: edge.x - PX_PER_S / 2, y: edge.y });
  await page.keyboard.up("Alt");
  await expect.poll(async () => (await clips())[0]).toMatchObject({ in: 0, out: 3, speed: 3, reversed: true });

  // From the clip's menu, back to normal speed; one undo brings the stretch back.
  await page.mouse.click(clip.x + 10, edge.y, { button: "right" });
  await page.getByRole("menuitem", { name: /^Speed/ }).hover();
  await page.getByRole("menuitemradio", { name: /Normal/ }).click();
  await expect.poll(async () => (await clips())[0].speed).toBeUndefined();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect.poll(async () => (await clips())[0].speed).toBe(3);
});

test("selects several media cards to drag them together and delete them at once", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await expect(page.locator("[data-clip-id]")).toHaveCount(0);
  await page.getByRole("tab", { name: /^This video/ }).click();
  await page.locator("input[type=file]").first().setInputFiles([FILES[0], FILES[1], FILES[2]]);
  const card = (name: string) => page.locator("[data-grid-item]").filter({ hasText: name }).first();
  const selected = page.locator("[data-grid-item][aria-selected=true]");
  for (const name of ["vertical-1080x1920", "landscape-1920x1080", "square-1080"]) await expect(card(name)).toBeVisible();

  // Click one, ⌘-click another: both selected, and dragging one brings both.
  await card("vertical-1080x1920").click();
  await card("square-1080").click({ modifiers: ["ControlOrMeta"] });
  await expect(selected).toHaveCount(2);
  await dragAsset(page, "square-1080", await timeX(page, 0.05), await laneY(page, "Video 1"));
  await expect.poll(async () => (await timelineClips(page)).length).toBe(2);

  // ⌘-click takes one out again; Escape clears (after closing the source preview, if it's open).
  await card("square-1080").click({ modifiers: ["ControlOrMeta"] });
  await expect(selected).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(selected).toHaveCount(0);

  // A box dragged from the empty space after the cards selects every card it touches.
  const cards = page.locator("[data-grid-item]");
  const first = (await cards.nth(0).boundingBox())!;
  const last = (await cards.nth(2).boundingBox())!;
  const from = { x: first.x + first.width * 1.5, y: last.y + last.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 40, from.y - 20, { steps: 3 });
  await page.mouse.move(first.x + 10, first.y + 10, { steps: 5 });
  await page.mouse.up();
  await expect(selected).toHaveCount(3);

  // ⌘-dragging from a card draws a box too, rather than dragging the card to the timeline.
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await card("vertical-1080x1920").click({ modifiers: ["ControlOrMeta"] });
  await card("landscape-1920x1080").click({ modifiers: ["ControlOrMeta"] });
  await expect(selected).toHaveCount(1);
  const b = (await cards.nth(1).boundingBox())!;
  const c = (await cards.nth(2).boundingBox())!;
  await page.keyboard.down(mod);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up(mod);
  await expect(selected).toHaveCount(3);
  await expect.poll(async () => (await timelineClips(page)).length).toBe(2);

  // ⌘⌫ asks once for all of them, then removes them and their clips.
  await page.keyboard.press(`${mod}+Backspace`);
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Remove 3 files?");
  await expect(confirm).toContainText("used in 2 clips");
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(cards).toHaveCount(0);
  await expect.poll(async () => (await savedProject(page)).clips.length).toBe(0);
});

test("parents to a null, nests clips, opens the nest in a tab, and remaps its time with a graph", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await expect(page.locator("[data-clip-id]")).toHaveCount(0);
  await page.getByRole("tab", { name: /^This video/ }).click();
  await page.locator("input[type=file]").first().setInputFiles([FILES[0], FILES[2]]);
  const card = (name: string) => page.locator("[data-grid-item]").filter({ hasText: name }).first();
  await card("vertical-1080x1920").dblclick();
  await card("square-1080").dblclick();
  await expect.poll(async () => (await timelineClips(page)).length).toBe(2);

  // A null object, and the first clip parented to it from Properties.
  await page.getByRole("button", { name: "New layer" }).click();
  await page.getByRole("menuitem", { name: "Null object" }).click();
  await expect.poll(async () => (await savedProject(page)).clips.filter((c: SavedClip) => c.nullObject).length).toBe(1);
  const video = (await timelineClips(page)).find((c) => c.text.includes("vertical"))!;
  await page.locator(`[data-clip-id="${video.id}"]`).click();
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  await page.getByRole("combobox", { name: "Parent" }).click();
  await page.getByRole("option", { name: "Null" }).click();
  await expect.poll(async () => (await savedProject(page)).clips.find((c: SavedClip) => c.id === video.id)?.parent?.id).toBeTruthy();
  await expect(page.locator("[data-clip-parented]")).toHaveCount(1);

  // Nest everything (⌥G): one clip plays the new sequence.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Alt+g");
  await expect.poll(async () => (await timelineClips(page)).length).toBe(1);
  await expect(page.locator("[data-clip-id]").first()).toContainText("Nested Sequence 1");
  await expect.poll(async () => (await savedProject(page)).sequences?.[0]?.clips.length).toBe(3);

  // Double-click opens it in a tab; the main sequence is a tab away.
  await page.locator("[data-clip-id]").first().dblclick();
  await expect(page.getByRole("tab", { name: /Nested Sequence 1/ })).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => (await timelineClips(page)).length).toBe(3);
  await page.getByRole("tab", { name: "Main" }).click();
  await expect.poll(async () => (await timelineClips(page)).length).toBe(1);

  // Time Remapping on the nest, then a freeze frame at the start: a second longer.
  const nest = (await timelineClips(page))[0];
  await page.locator(`[data-clip-id="${nest.id}"]`).click();
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  const before = (await savedProject(page)).clips[0];
  await page.getByRole("switch", { name: "Time Remapping" }).click();
  await page.getByRole("button", { name: "Freeze frame" }).click();
  await expect.poll(async () => {
    const c = (await savedProject(page)).clips[0];
    return Math.round((c.out - c.in - (before.out - before.in)) * 100) / 100;
  }).toBe(1);
  await expect(page.locator("[data-remap-segment]")).toHaveCount(2);

  // The Source Time's Speed Graph in the keyframe lanes.
  await page.getByRole("button", { name: "Show keyframes" }).click();
  await page.getByRole("button", { name: "Show Source Time graph" }).click();
  await expect(page.locator("[data-graph=value]")).toBeVisible();
  await page.getByRole("radio", { name: "Speed" }).click();
  await expect(page.locator("[data-graph=speed]")).toBeVisible();
  await page.getByRole("button", { name: "Hide keyframes" }).click();
});

/** The colour the Program monitor shows at a point of the canvas (fractions from its top-left). */
async function monitorPixel(page: Page, u: number, v: number): Promise<number[]> {
  return page.evaluate(
    ([x, y]) => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-slot=preview-canvas]")!;
      const gl = canvas.getContext("webgl2")!;
      const px = new Uint8Array(4);
      gl.readPixels(Math.floor(x * canvas.width), Math.floor((1 - y) * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2]];
    },
    [u, v],
  );
}
/** A point of the Program monitor's canvas on the page. */
async function monitorPoint(page: Page, u: number, v: number) {
  const box = (await page.locator("[data-slot=canvas]").boundingBox())!;
  return { x: box.x + box.width * u, y: box.y + box.height * v };
}
/** Click the middle of something drawn on the monitor's overlay (its presses are the overlay's own). */
async function clickOn(page: Page, selector: string, alt = false) {
  const box = (await page.locator(selector).first().boundingBox())!;
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (alt) await page.keyboard.up("Alt");
}
const effectsOf = (clip: FullClip | undefined, type: string) => clip?.effects.filter((e) => e.type === type) ?? [];

test("masks a clip with shapes and the pen, and draws shape layers with operators", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await expect(page.locator("[data-clip-id]")).toHaveCount(0);
  await page.getByRole("tab", { name: /^This video/ }).click();
  await page.locator("input[type=file]").first().setInputFiles([FILES[0]]);
  await page.locator("[data-grid-item]").filter({ hasText: "vertical-1080x1920" }).first().dblclick();
  await expect(page.locator("[data-clip-id]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  const video = () => savedProject(page).then((p) => (p.clips as FullClip[])[0]);
  const black = (c: number[]) => c.every((v) => v < 30);

  // An ellipse mask from Properties: the corners of the picture go, its middle stays.
  await page.locator("[data-clip-id]").first().click();
  await page.getByRole("tab", { name: "Properties", exact: true }).click();
  await expect.poll(async () => black(await monitorPixel(page, 0.04, 0.03))).toBe(false);
  await page.getByRole("button", { name: "Add a mask" }).click();
  await page.getByRole("menuitem", { name: "Ellipse" }).click();
  await expect.poll(async () => effectsOf(await video(), "mask").length).toBe(1);
  await expect.poll(async () => black(await monitorPixel(page, 0.04, 0.03))).toBe(true);
  expect(black(await monitorPixel(page, 0.5, 0.5))).toBe(false);

  // Its points show on the monitor: dragging the top one down reshapes it.
  await expect(page.locator("[data-path-vertex]")).toHaveCount(4);
  const top = (await page.locator("[data-path-vertex='0']").boundingBox())!;
  await drag(page, { x: top.x + 3, y: top.y + 3 }, { x: top.x + 3, y: top.y + 60 });
  type Path = { vertices: { point: number[] }[]; closed: boolean };
  await expect.poll(async () => (effectsOf(await video(), "mask")[0].params.path as Path).vertices[0].point[1]).toBeGreaterThan(0.15);
  // ⌥-click makes that point a corner; feather softens the edge.
  await clickOn(page, "[data-path-vertex='0']", true);
  await expect.poll(async () => JSON.stringify((effectsOf(await video(), "mask")[0].params.path as { vertices: { out: number[] }[] }).vertices[0].out)).toBe("[0,0]");
  await page.getByRole("spinbutton", { name: "Feather" }).click();
  await page.keyboard.type("40");
  await page.keyboard.press("Enter");
  await expect.poll(async () => effectsOf(await video(), "mask")[0].params.feather).toBe(40);

  // The pen draws a second mask, click by click, closed on its first point; it takes a triangle out.
  await page.keyboard.press("p");
  for (const [u, v] of [[0.3, 0.4], [0.7, 0.4], [0.5, 0.6]]) {
    const pt = await monitorPoint(page, u, v);
    await page.mouse.click(pt.x, pt.y);
  }
  const first = await monitorPoint(page, 0.3, 0.4);
  await page.mouse.click(first.x, first.y);
  await expect.poll(async () => effectsOf(await video(), "mask").map((m) => [(m.params.path as Path).vertices.length, (m.params.path as Path).closed])).toEqual([[4, true], [3, true]]);
  await page.keyboard.press("v");
  await page.getByRole("region", { name: "Mask 2" }).getByRole("combobox", { name: "Mode" }).click();
  await page.getByRole("option", { name: "Subtract" }).click();
  await expect.poll(async () => black(await monitorPixel(page, 0.5, 0.45))).toBe(true);
  expect(black(await monitorPixel(page, 0.5, 0.75))).toBe(false);
  // A selected point is deleted with ⌫ (the clip stays).
  await clickOn(page, "[data-path-vertex='1']");
  await page.keyboard.press("Delete");
  await expect.poll(async () => (effectsOf(await video(), "mask")[1].params.path as Path).vertices.length).toBe(2);
  await expect(page.locator("[data-clip-id]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (effectsOf(await video(), "mask")[1].params.path as Path).vertices.length).toBe(3);

  // Nothing selected: the Rectangle tool drags out a shape layer instead.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-clip-id][data-selected]")).toHaveCount(0);
  await page.keyboard.press("r");
  await drag(page, await monitorPoint(page, 0.2, 0.7), await monitorPoint(page, 0.8, 0.9));
  const shape = () => savedProject(page).then((p) => (p.clips as FullClip[]).find((c) => c.effects.some((e) => e.type === "vector-shape")));
  await expect.poll(async () => effectsOf(await shape(), "vector-shape")[0]?.params.kind).toBe("rectangle");
  const rect = effectsOf(await shape(), "vector-shape")[0].params as { position: number[]; size: number[] };
  expect(rect.position[0]).toBeCloseTo(0.5, 1);
  expect(rect.position[1]).toBeCloseTo(0.8, 1);
  expect(rect.size[0]).toBeCloseTo(0.6 * 1080, -1);
  await expect(page.locator("[data-clip-id]").filter({ hasText: "Shape" })).toHaveCount(1);
  await expect.poll(async () => monitorPixel(page, 0.5, 0.8)).toEqual([255, 255, 255]);

  // Its contents in Properties: a repeater, then a star on top; the fill's colour.
  const addToShape = async (name: string) => {
    await page.getByRole("button", { name: "Add to the shape layer" }).click();
    await page.getByRole("menuitem", { name }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
  };
  await addToShape("Repeater");
  await addToShape("Star");
  await expect.poll(async () => (await shape())?.effects.slice(3).map((e) => e.type)).toEqual(["vector-shape", "repeater", "vector-shape"]);
  await expect(page.getByRole("region", { name: "Shape 2" })).toBeVisible();
  // Trim Paths from the menu, then taken off again; the last shape can't go.
  await addToShape("Trim Paths");
  await page.getByRole("button", { name: "Trim Paths options" }).click();
  await page.getByRole("menuitem", { name: "Remove Trim Paths" }).click();
  await expect.poll(async () => (await shape())?.effects.some((e) => e.type === "trim-paths")).toBe(false);
});

test("animates text by word, links properties with an expression, marks the timeline and bends a motion path", async ({ page }) => {
  await openLatest(page);
  await newVideo(page);
  await expect(page.locator("[data-clip-id]")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const text = () => savedProject(page).then((p) => (p.clips as FullClip[])[0]);
  const lanes = (await page.locator("[data-timeline-lanes]").boundingBox())!;
  const seek = (t: number) => page.mouse.click(lanes.x + t * 60, lanes.y - 10);

  // A text, with an animator from the menu: its range is keyframed from the clip's start.
  await page.getByRole("button", { name: /^Type tool/ }).click();
  const mid = await monitorPoint(page, 0.5, 0.4);
  await page.mouse.click(mid.x, mid.y);
  await expect(page.getByRole("textbox", { name: "Text on canvas" })).toBeFocused();
  await page.keyboard.type("One two three");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add a text animator" }).click();
  await page.getByRole("menuitem", { name: "Pop in by word" }).click();
  await expect.poll(async () => effectsOf(await text(), "text-animator")[0]?.keyframes?.start.map((k) => k.value)).toEqual([0, 1]);
  expect(effectsOf(await text(), "text-animator")[0].params).toMatchObject({ basedOn: "words", scale: 0, opacity: 0 });
  // At its start nothing of it shows yet; once the animation is over all of it does.
  const white = async () => {
    for (let u = 0.2; u < 0.8; u += 0.02) if ((await monitorPixel(page, u, 0.4)).every((c) => c > 200)) return true;
    return false;
  };
  await seek(0);
  await expect.poll(white).toBe(false);
  await seek(2);
  await expect.poll(white).toBe(true);

  // ⌥-click a stopwatch: an expression on Rotation, with what it gives; a mistake says what's wrong.
  const motion = page.getByRole("region", { name: "Motion" });
  await motion.getByRole("button", { name: "Animate Rotation" }).click({ modifiers: ["Alt"] });
  const script = page.getByRole("textbox", { name: "Rotation expression" });
  await expect(script).toHaveValue("value");
  await script.fill("time * 10");
  await expect(page.locator("[data-expression=rotation] [data-expression-status]")).toHaveText("= 20");
  await script.blur();
  await expect.poll(async () => effectsOf(await text(), "motion")[0].expressions).toEqual({ rotation: "time * 10" });
  await script.fill("wigle(1, 2)");
  await expect(page.locator("[data-expression=rotation] [data-expression-status]")).toContainText("wigle");
  await script.fill("wiggle(1, 2)");
  await script.blur();
  // Its examples menu writes one; the ✕ takes the expression away.
  await page.getByRole("button", { name: "Rotation expression examples" }).click();
  await page.getByRole("menuitem", { name: /Swing back and forth/ }).click();
  await expect.poll(async () => effectsOf(await text(), "motion")[0].expressions?.rotation).toContain("Math.sin");
  await page.getByRole("button", { name: "Remove Rotation expression" }).click();
  await expect.poll(async () => effectsOf(await text(), "motion")[0].expressions).toBeUndefined();

  // M marks the selected clip under the playhead; with nothing selected, the timeline.
  await page.keyboard.press("m");
  await expect.poll(async () => (await text()).markers?.map((m) => m.time)).toEqual([2]);
  await expect(page.locator("[data-clip-markers]")).toHaveAttribute("data-clip-markers", "1");
  await page.keyboard.press("Escape");
  await seek(3);
  await page.keyboard.press("m");
  await expect.poll(async () => ((await savedProject(page)).markers as { time: number }[] | undefined)?.map((m) => m.time)).toEqual([3]);
  // ⇧⌘M goes back to the clip's marker, ⇧M on to the timeline's; M on a marker opens its name.
  await page.keyboard.press("ControlOrMeta+Shift+m");
  await expect(page.getByText("0:02.00").first()).toBeVisible();
  await page.keyboard.press("Shift+m");
  await expect(page.getByText("0:03.00").first()).toBeVisible();
  await page.keyboard.press("m");
  await page.getByRole("textbox", { name: "Marker name" }).fill("Drop");
  await page.getByRole("radio", { name: "Red" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await savedProject(page)).markers).toEqual([{ id: expect.any(String), time: 3, label: "Drop", color: "red" }]);
  // Dragged along the ruler (once the playhead is off it); ⌥M at the playhead deletes it.
  await seek(1);
  const flag = (await page.locator("[data-marker]").first().boundingBox())!;
  await drag(page, { x: flag.x + flag.width / 2, y: flag.y + 16 }, { x: flag.x + flag.width / 2 + 60, y: flag.y + 16 });
  await expect.poll(async () => (await savedProject(page)).markers[0].time).toBe(4);
  await seek(4);
  await page.keyboard.press("Alt+m");
  await expect.poll(async () => (await savedProject(page)).markers).toBeUndefined();

  // A position animated by dragging on the monitor: its path shows, with a dot per keyframe.
  await seek(0);
  await page.locator("[data-clip-id]").first().click();
  await motion.getByRole("button", { name: "Animate Position", exact: true }).click();
  await seek(2);
  const from = await monitorPoint(page, 0.5, 0.4);
  await drag(page, from, await monitorPoint(page, 0.5, 0.7));
  type Keys = { time: number; value: number[]; easing: string; spatialOut?: number[]; spatialIn?: number[] }[];
  const keys = async () => (effectsOf(await text(), "motion")[0].keyframes?.position ?? []) as Keys;
  await expect.poll(async () => (await keys()).map((k) => k.time)).toEqual([0, 2]);
  const dots = page.locator("[data-motion-keyframe]");
  await expect(dots).toHaveCount(2);
  // ⌥-click a dot: the path leaves it smoothly (a handle to bend it with). Dragging the dot moves that keyframe.
  await dots.first().click({ modifiers: ["Alt"] });
  await expect.poll(async () => (await keys())[0].spatialOut?.length).toBe(2);
  await expect(page.locator("[data-motion-handle=out]")).toHaveCount(1);
  const handle = (await page.locator("[data-motion-handle=out]").boundingBox())!;
  await drag(page, { x: handle.x + 4, y: handle.y + 4 }, { x: handle.x + 64, y: handle.y + 4 });
  await expect.poll(async () => (await keys())[0].spatialOut![0]).toBeGreaterThan(0.1);
  const dot = (await dots.first().boundingBox())!;
  await drag(page, { x: dot.x + 4, y: dot.y + 4 }, { x: dot.x - 40, y: dot.y + 4 });
  await expect.poll(async () => (await keys())[0].value[0]).toBeLessThan(0.45);

  // The lanes: copy a keyframe, paste it at the playhead, ease it with F9, then stretch all three with ⌥-drag.
  await page.getByRole("button", { name: "Show keyframes" }).click();
  const diamonds = page.getByRole("group", { name: "Position keyframes", exact: true }).locator("[data-refs]");
  await diamonds.first().click();
  await page.keyboard.press("ControlOrMeta+c");
  await seek(4);
  await page.keyboard.press("ControlOrMeta+v");
  await expect.poll(async () => (await keys()).map((k) => k.time)).toEqual([0, 2, 4]);
  await page.keyboard.press("F9");
  await expect.poll(async () => (await keys()).map((k) => k.easing)).toEqual(["linear", "linear", "ease"]);
  await expect(page.locator("[data-clip-id]")).toHaveCount(1);
  await diamonds.first().click();
  await diamonds.nth(1).click({ modifiers: ["Shift"] });
  await diamonds.nth(2).click({ modifiers: ["Shift"] });
  const last = (await diamonds.nth(2).boundingBox())!;
  await page.keyboard.down("Alt");
  await drag(page, { x: last.x + last.width / 2, y: last.y + last.height / 2 }, { x: last.x + last.width / 2 - 60, y: last.y + last.height / 2 });
  await page.keyboard.up("Alt");
  await expect.poll(async () => {
    const k = await keys();
    // Still evenly spaced from the first, which stayed put.
    return k.length === 3 && k[0].time === 0 && k[2].time < 3.8 && Math.abs(k[1].time - k[2].time / 2) < 0.05;
  }).toBe(true);
  await page.getByRole("button", { name: "Hide keyframes" }).click();

  // It all exports: the animated text is drawn again for every frame it changes in.
  await page.getByRole("button", { name: /^export$/i }).first().click();
  const dialog = page.getByRole("region", { name: "Export" });
  await dialog.getByText("720p").click();
  await dialog.getByRole("button", { name: /^export$/i }).click();
  await expect(dialog.getByRole("link", { name: /download/i }).or(dialog.getByRole("button", { name: /download/i }))).toBeVisible({ timeout: 60_000 });
});

test("starts a song in the music suite, with its own assistant, then goes back to a video", async ({ page }) => {
  await openLatest(page);
  await expect(page).toHaveURL(/\/p\/[\w-]+$/);
  const videoUrl = page.url();

  // The New project picker (⇧⌘O) lists every suite; typing narrows it, Enter makes one.
  await page.keyboard.press("ControlOrMeta+Shift+KeyO");
  const picker = page.getByRole("dialog");
  await expect(picker.getByRole("option")).toHaveCount(3);
  await picker.getByRole("textbox").fill("song");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect.poll(() => page.url()).not.toBe(videoUrl);
  await expect(page.getByRole("region", { name: "Channel rack" })).toBeVisible();
  const song = (await projectList(page)).find((p: { suite: string }) => p.suite === "music");
  expect(song).toMatchObject({ name: "Untitled", tempo: 140 });
  expect(song.path).toMatch(/\/Documents\/Vaudio\/Untitled( \d+)?\.vaudio$/);

  // Renamed from its header, like a video; its file takes the name once it's closed (Home shows it).
  await page.locator("header").getByTitle("Rename project").click();
  await page.getByRole("textbox", { name: "Project name" }).fill("Anthem");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await projectList(page)).find((p: { id: string }) => p.id === song.id).name).toBe("Anthem");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator(`[data-project-id="${song.id}"]`)).toContainText("Anthem");
  await expect(page.locator(`[data-project-id="${song.id}"]`)).toContainText("140 BPM");
  await expect.poll(async () => path.basename((await projectList(page)).find((p: { id: string }) => p.id === song.id).path)).toBe("Anthem.vaudio");
  await page.locator(`[data-project-id="${song.id}"]`).click();
  await expect(page.getByRole("region", { name: "Channel rack" })).toBeVisible();

  // Its assistant has the music editor's tools (and not the video editor's).
  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.locator('[data-slot="assistant-panel"]');
  const composer = panel.getByRole("textbox", { name: "Message the assistant" });
  await expect(composer).toHaveAttribute("placeholder", /help with your song/);
  await expect(panel.getByText("140 BPM, 4/4")).toBeVisible();
  await composer.fill('call get_song\ncall split_clips {"at": 1}');
  await composer.press("Enter");
  await expect(panel.locator('[data-tool="get_song"][data-status="done"]')).toContainText("Read the song");
  await expect(panel.locator('[data-tool="split_clips"][data-status="error"]')).toBeVisible();

  // Back to the video: its editor opens as it was.
  await page.goto(videoUrl);
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByText("Video 1", { exact: true }).last()).toBeVisible();
  const clips = (await savedProject(page)).clips.length;
  await expect.poll(async () => (await timelineClips(page)).length).toBe(clips);
  await page.goto(`/p/${song.id}`);
  await expect(page.getByRole("region", { name: "Channel rack" })).toBeVisible();

  // ⇧⌘O from the song: the New project picker starts on Music, the app it's in.
  await page.keyboard.press("ControlOrMeta+Shift+o");
  await expect(page.getByRole("dialog").getByRole("option").first()).toHaveAttribute("data-suite", "music");
  await expect(page.getByRole("dialog").getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");

  // ⌘P finds a project from anywhere (the music editor has the keyboard here) and Enter opens it.
  await page.keyboard.press("ControlOrMeta+p");
  const search = page.getByRole("dialog");
  await expect(search.getByRole("textbox", { name: "Find a project" })).toBeFocused();
  await search.getByRole("textbox").fill("anth");
  await expect(search.getByRole("option")).toHaveText([/Anthem/]);
  await search.getByRole("textbox").fill("");
  await expect(search.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+p");
  // (Video names repeat: it's picked by its row.)
  await search.locator(`[data-project-id="${videoUrl.split("/").pop()}"]`).click();
  await expect(search).toHaveCount(0);
  await expect.poll(() => page.url()).toBe(videoUrl);

  // ⇧⌘O opens the New project picker (on Video now, with a video open), and closes it again.
  await page.keyboard.press("ControlOrMeta+Shift+o");
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "Search project types" })).toBeFocused();
  await expect(page.getByRole("dialog").getByRole("option").first()).toHaveAttribute("data-suite", "video");
  await page.keyboard.press("ControlOrMeta+Shift+o");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("keeps the open projects as tabs: switch, reorder, close", async ({ page }) => {
  await openLatest(page);
  const firstUrl = page.url();
  const tabs = page.getByRole("tablist", { name: "Open projects" });
  // One project open: no strip.
  await expect(tabs).toHaveCount(0);

  // A second one makes it appear, the new one selected.
  await newVideo(page);
  await expect.poll(() => page.url()).not.toBe(firstUrl);
  const secondUrl = page.url();
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(tabs.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
  // (Its Home button is the strip's: only one in the page.)
  await expect(page.getByRole("button", { name: "Home", exact: true })).toHaveCount(1);

  // Click the first tab: that project is back.
  await tabs.getByRole("tab").first().click();
  await expect(page).toHaveURL(firstUrl);
  await expect(tabs.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");

  // ⇧⌘] goes to the next, wrapping round.
  await page.keyboard.press("ControlOrMeta+Shift+BracketRight");
  await expect(page).toHaveURL(secondUrl);
  await page.keyboard.press("ControlOrMeta+Shift+BracketRight");
  await expect(page).toHaveURL(firstUrl);

  // Drag the first tab past the second: they swap places.
  const first = tabs.getByRole("tab").first();
  const [a, b] = [await first.boundingBox(), await tabs.getByRole("tab").nth(1).boundingBox()];
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(tabs.getByRole("tab").nth(1)).toHaveAttribute("data-tab-id", /./);
  await expect(tabs.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");

  // ⌘W closes the open one's tab: the other shows, alone, so the strip goes.
  await page.keyboard.press("ControlOrMeta+w");
  await expect(page).toHaveURL(secondUrl);
  await expect(tabs).toHaveCount(0);

  // Home with one tab still open shows the strip, so it can be gone back to.
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(tabs.getByRole("tab")).toHaveCount(1);
  await tabs.getByRole("tab").click();
  await expect(page).toHaveURL(secondUrl);
});
