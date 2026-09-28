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

async function laneY(page: Page, name: "Video" | "Audio 1") {
  const header = page.getByText(name, { exact: true }).last();
  const box = (await header.boundingBox())!;
  return box.y + box.height / 2;
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

test("drags clips onto the timeline; video goes to the main track, music to audio", async ({ page }) => {
  await page.goto("/");
  const videoY = await laneY(page, "Video");
  await dragAsset(page, "vertical-1080x1920", 400, videoY);
  await dragAsset(page, "landscape-1920x1080", 1300, videoY);
  await dragAsset(page, "square-1080", 1400, videoY);
  // Dropping music on the video lane is routed to an audio track.
  await dragAsset(page, "music-20s", 300, videoY);

  await expect.poll(async () => (await timelineClips(page)).length).toBe(4);
  // Main clips pack back to back; the music lands on the audio track at the pointer.
  await expect
    .poll(async () => {
      const p = await savedProject(page);
      return p.clips.map((c: { trackId: string; start: number }) =>
        c.trackId === "main" ? `main@${c.start}` : c.trackId,
      );
    })
    .toEqual(expect.arrayContaining(["main@0", "main@6", "main@14", "audio_1"]));
});

test("splits at the playhead, deletes with ripple, undoes and redoes", async ({ page }) => {
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

  // The left half stays selected; delete it and the rest ripples left.
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await timelineClips(page)).length).toBe(4);
  await expect
    .poll(async () => {
      const p = await savedProject(page);
      return p.clips
        .filter((c: { trackId: string }) => c.trackId === "main")
        .map((c: { start: number; in: number }) => [c.start, c.in]);
    })
    .toEqual([
      [0, 3],
      [3, 0],
      [11, 0],
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

test("reorders main-track clips by dragging and trims an edge", async ({ page }) => {
  await page.goto("/");
  const mainOrder = async () => {
    const p = await savedProject(page);
    return p.clips
      .filter((c: { trackId: string }) => c.trackId === "main")
      .sort((a: { start: number }, b: { start: number }) => a.start - b.start)
      .map((c: { id: string }) => c.id);
  };
  await expect.poll(async () => (await mainOrder()).length).toBe(3);
  const before = await mainOrder();

  // Drag the last main clip to the very start.
  const main = (await timelineClips(page)).filter((c) => before.includes(c.id));
  const last = main[main.length - 1];
  await page.mouse.move(last.x + 30, last.y + last.h / 2);
  await page.mouse.down();
  for (let x = last.x + 30; x > main[0].x; x -= 40) await page.mouse.move(x, last.y + last.h / 2);
  await page.mouse.move(main[0].x + 2, last.y + last.h / 2);
  await page.mouse.up();
  await expect.poll(mainOrder).toEqual([before[2], before[0], before[1]]);

  // Trim the (new) first clip's right edge left by ~1s worth of pixels
  // (after the 150ms reorder animation settles).
  await page.waitForTimeout(400);
  const [first] = (await timelineClips(page)).filter((c) => c.id === before[2]);
  const durationBefore = first.w;
  await page.mouse.move(first.x + first.w - 2, first.y + first.h / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + first.w - 30, first.y + first.h / 2, { steps: 4 });
  await page.mouse.move(first.x + first.w - 60, first.y + first.h / 2, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => (await timelineClips(page)).find((c) => c.id === before[2])!.w)
    .toBeLessThan(durationBefore - 40);
  // Main track stays gap-free.
  await expect
    .poll(async () => {
      const p = await savedProject(page);
      const main = p.clips
        .filter((c: { trackId: string }) => c.trackId === "main")
        .sort((a: { start: number }, b: { start: number }) => a.start - b.start);
      return main.every(
        (c: { start: number }, i: number) =>
          i === 0 || Math.abs(c.start - (main[i - 1].start + main[i - 1].out - main[i - 1].in)) < 1e-6,
      );
    })
    .toBe(true);
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
