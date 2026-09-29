import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const SAMPLES = path.resolve(import.meta.dirname, "..", "samples");
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

type SavedClip = { id: string; trackId: string; start: number; in: number; out: number };

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

test("starts a new video from the empty state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Start a new video" })).toBeVisible();
  await page.getByRole("button", { name: "New video" }).last().click();
  await expect(page).toHaveURL(/\/p\/[\w-]+$/);
  await expect(page.locator("header").getByRole("button", { name: "Settle", exact: true })).toBeVisible();
  expect(await projectList(page)).toHaveLength(1);
});

test("imports media into the library and names the video after the first clip", async ({ page }) => {
  await page.goto("/");
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
  await page.goto("/");
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
});

test("splits at the playhead, deletes (leaving a gap), closes a clicked gap or ripple-deletes, undoes and redoes", async ({ page }) => {
  await page.goto("/");
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
  await page.goto("/");
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
});

test("right-click menus, copy/paste and the shortcuts dialog", async ({ page }) => {
  await page.goto("/");
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
  await page.goto("/");
  await page.locator("body").click({ position: { x: 720, y: 20 } });
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);
  await page.keyboard.press("Space");
  const state = await page.evaluate(() => {
    const visible = [...document.querySelectorAll("video")].find(
      (v) => getComputedStyle(v).opacity !== "0" && !v.closest("[role=dialog]"),
    );
    return { paused: visible?.paused, t: visible?.currentTime ?? -1 };
  });
  expect(state.paused).toBe(true);
  expect(state.t).toBeGreaterThan(1);
});

test("exports an MP4", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^export$/i }).first().click();
  const dialog = page.getByRole("dialog");
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
  await page.goto("/");

  // Settings live in a dialog opened from the header.
  await page.getByRole("button", { name: "Video settings" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Square/ }).click();
  await dialog.getByRole("radio", { name: /60 fps/ }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Video settings" })).toHaveText("1:1 · 60 fps");
  await expect.poll(async () => (await savedProject(page)).settings).toMatchObject({ aspectRatio: "1:1", fps: 60 });

  // The selected clip's volume, from the timeline toolbar.
  await expect(page.getByRole("button", { name: "Clip volume" })).toBeDisabled();
  const [clip] = await timelineClips(page);
  await page.mouse.click(clip.x + clip.w / 2, clip.y + clip.h / 2);
  await page.getByRole("button", { name: "Clip volume" }).click();
  await page.getByRole("slider", { name: "Volume" }).press("Home");
  await expect
    .poll(async () => ((await savedProject(page)).clips as { id: string; volume: number }[]).find((c) => c.id === clip.id)?.volume)
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
  await page.keyboard.press("Escape");
  await expect(position).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("settles a video, starts the next one, and unsettles it again", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/p\/[\w-]+$/);
  const firstUrl = page.url();
  const [first] = await projectList(page);

  // Start a second video from the sidebar; it opens empty.
  await page.getByRole("button", { name: "New video" }).first().click();
  await expect.poll(() => page.url()).not.toBe(firstUrl);
  await expect(page.locator("[data-clip-id]")).toHaveCount(0);
  const secondUrl = page.url();

  // Settle it: it moves to the settled pile and the editor switches back to the first video.
  await page.locator("header").getByRole("button", { name: "Settle", exact: true }).click();
  await expect(page).toHaveURL(firstUrl);
  await expect(page.getByRole("button", { name: /Settled/ })).toBeVisible();
  await expect
    .poll(async () => (await projectList(page)).map((p: { status: string }) => p.status).sort())
    .toEqual(["active", "settled"]);

  // Open it from the settled pile and unsettle it.
  await page.getByRole("button", { name: /Settled/ }).click();
  await page.getByRole("navigation", { name: "Settled" }).getByRole("button").first().click();
  await expect(page).toHaveURL(secondUrl);
  await page.locator("header").getByRole("button", { name: "Unsettle", exact: true }).click();
  await expect
    .poll(async () => (await projectList(page)).every((p: { status: string }) => p.status === "active"))
    .toBe(true);

  // The first video kept its timeline through all the switching.
  await page.goto(firstUrl);
  await expect.poll(async () => (await timelineClips(page)).length).toBeGreaterThan(0);
  expect((await savedProject(page)).name).toBe(first.name);
});
