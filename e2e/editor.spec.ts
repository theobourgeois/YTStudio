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
  await page.keyboard.press("Escape");
  await expect(position).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("imports an image and transforms it in the properties panel and on the canvas", async ({ page }) => {
  await page.goto("/");
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
  await page.getByRole("tab", { name: "Properties" }).click();
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

  // The preview draws it where the properties say.
  const transform = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[data-slot=canvas] img, [data-slot=canvas] video")]
        .filter((el) => el.style.opacity !== "0")
        .map((el) => el.style.transform),
    );
  await expect.poll(transform).toEqual([expect.stringMatching(/^matrix\(0\.433013, 0\.25, -0\.25, 0\.433013,/)]);

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

test("adds transitions from the library, edits them and previews them", async ({ page }) => {
  await page.goto("/");
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
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByRole("region", { name: "Timing" })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Duration" }).click();
  await page.keyboard.type("1");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await withTransitions())[0]?.duration).toBe(1);

  // Drag another one onto the end of the first video clip.
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

  // Parked inside a transition, the preview draws the track with WebGL.
  const lanes = (await page.locator("[data-timeline-lanes]").boundingBox())!;
  await page.mouse.click(await timeX(page, 0.3), lanes.y - 10);
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement>("[data-slot=canvas] canvas")].some((c) => c.style.opacity === "1")))
    .toBe(true);

  // Select one on the timeline and delete it; undo brings it back.
  await page.locator("[data-transition]").first().click();
  await page.keyboard.press("Delete");
  await expect(page.locator("[data-transition]")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("[data-transition]")).toHaveCount(2);
});

test("adds text with the Type tool, types into it on the canvas, styles it and exports it", async ({ page }) => {
  await page.goto("/");
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
  await page.getByRole("tab", { name: "Properties" }).click();
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
  await page.goto("/");
  type Caption = SavedClip & { caption?: true; transitionIn?: { type: string } };
  const captions = () =>
    savedProject(page).then((p) => (p.clips as Caption[]).filter((c) => c.caption).sort((a, b) => a.start - b.start));
  const words = async () => (await captions()).map((c) => effectParams({ clips: [c] }, c.id, "text")!.text);

  await page.getByRole("button", { name: "Auto captions" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Whole timeline" }).click();
  await dialog.getByRole("radio", { name: "Yellow" }).click();
  await dialog.getByRole("radio", { name: "Word" }).click();
  // The (stand-in) local engine is ready, so there's nothing to set up.
  await expect(dialog.getByRole("radio", { name: /On this Mac/ })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "Generate captions" }).click();
  await expect(page.getByText(/Added \d+ captions/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Captions" })).toHaveAttribute("aria-selected", "true");

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
  await page.getByRole("tab", { name: "Properties" }).click();
  await page.getByRole("button", { name: "Edit all captions" }).click();
  await expect(page.getByRole("tab", { name: "Captions" })).toHaveAttribute("aria-selected", "true");

  // Deleting them all is one undoable step.
  await page.getByRole("button", { name: "Delete all captions" }).click();
  await expect(page.getByText("No captions yet")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await captions()).length).toBe(made.length);
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

  // Right-click it in the sidebar and duplicate it: the copy has the same timeline and its own media.
  const inProgress = page.getByRole("navigation", { name: "In progress" });
  await inProgress.getByTitle(first.name, { exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(inProgress.getByTitle(`${first.name} copy`, { exact: true })).toBeVisible();
  const list = await projectList(page);
  const copy = list.find((p: { name: string }) => p.name === `${first.name} copy`);
  expect(copy).toMatchObject({ status: "active", clipCount: (await savedProject(page)).clips.length });
  const media = (id: string) => page.evaluate((i) => fetch(`/api/media?projectId=${i}`).then((r) => r.json()), id);
  const [originals, copies] = [await media(first.id), await media(copy.id)];
  expect(copies.map((a: { name: string }) => a.name)).toEqual(originals.map((a: { name: string }) => a.name));
  await expect(page).toHaveURL(firstUrl); // duplicating doesn't switch videos
});

test("keeps media and saved clips in the Library and uses them in another video", async ({ page }) => {
  await page.goto("/");
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

  // Add a media file to that folder from the Media tab.
  await page.getByRole("tab", { name: /^Media/ }).click();
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
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name" }).fill("Intro shot");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await library()).items.map((i: { kind: string }) => i.kind).sort()).toEqual(["clips", "media"]);

  // A new video can use both.
  await page.getByRole("button", { name: "New video" }).first().click();
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
