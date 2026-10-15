import { expect, test } from "@playwright/test";

// The stand-in player (EDITOR_NOW_PLAYING=stand-in, playwright.config.ts) plays made-up songs, and the visualizer
// measures a made-up sound instead of the computer's: nothing here is ever heard.
test.describe.configure({ mode: "serial" });

test("Now Playing: the song in the top bar, controlled from there, and the visualizer of it", async ({ page }) => {
  // The stand-in isn't open until it's told to play (the other specs never see it).
  await page.request.post("/api/now-playing", { data: { action: "play" } });
  await page.goto("/");
  // Start from the first song, playing.
  const pill = page.locator("[data-now-playing]");
  await expect(pill).toBeVisible();
  for (let i = 0; i < 3 && !(await pill.textContent())?.includes("Midnight Drive"); i++) await pill.getByRole("button", { name: "Next" }).click({ force: true });
  await expect(pill).toContainText("Midnight Drive");
  await expect(pill).toContainText("Neon Avenue");
  if ((await pill.getAttribute("data-now-playing")) !== "playing") await pill.getByRole("button", { name: "Play" }).click();
  await expect(pill).toHaveAttribute("data-now-playing", "playing");

  // Pause and play, and skip (always there, not only on hover).
  await pill.getByRole("button", { name: "Pause" }).click();
  await expect(pill).toHaveAttribute("data-now-playing", "paused");
  await pill.getByRole("button", { name: "Play" }).click();
  await expect(pill).toHaveAttribute("data-now-playing", "playing");
  await expect(pill.getByRole("button", { name: "Previous" })).toBeVisible();
  await pill.getByRole("button", { name: "Next" }).click();
  await expect(pill).toContainText("Golden Hour");

  // With a project open, it's in the tab strip.
  await page.request.post("/api/projects", { data: { suite: "video", name: "Now Playing test", blank: true } }).then(async (r) => {
    const { id } = await r.json();
    await page.goto(`/p/${id}`);
  });
  await expect(page.locator('[data-titlebar="tabs"] [data-now-playing]')).toBeVisible();

  // Clicking it fills the window with the visualizer, listening (to a made-up song) and drawing.
  await page.locator("[data-now-playing] button[title='Open the visualizer']").click();
  const view = page.locator("[data-now-playing-view]");
  await expect(view).toBeVisible();
  await expect(view.locator("[data-song-card]")).toContainText("Golden Hour");
  await expect(view.getByText("Listening", { exact: true })).toBeVisible();
  const canvas = view.locator('[data-slot="visualizer-canvas"]');
  await expect(canvas).toHaveAttribute("data-drawn", "clips", { timeout: 20_000 });
  // Something is drawn (not a black frame), and it moves.
  const picture = () =>
    canvas.evaluate((el: HTMLCanvasElement) => {
      const small = document.createElement("canvas");
      small.width = 64;
      small.height = 36;
      const ctx = small.getContext("2d")!;
      ctx.drawImage(el, 0, 0, 64, 36);
      const data = ctx.getImageData(0, 0, 64, 36).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return sum;
    });
  await expect.poll(picture, { timeout: 20_000 }).toBeGreaterThan(64 * 36 * 6);
  const before = await picture();
  await expect.poll(picture).not.toBe(before);

  // The looks: the arrows step through them, the looks menu up top picks one (by kind), keys punch the picture.
  const showing = () => view.getAttribute("data-showing");
  const first = await showing();
  await page.keyboard.press("ArrowRight");
  await expect.poll(showing).not.toBe(first);
  const looks = view.locator("[data-looks-menu]");
  await looks.getByRole("button", { name: /^Looks:/ }).click();
  await looks.locator('[data-kind="spectrum"]').click();
  await looks.locator('[data-look="halo"]').click();
  await expect(view).toHaveAttribute("data-showing", "halo");
  await expect(looks.getByRole("menu")).toHaveCount(0);
  for (const key of ["z", "x", "c", "v", "3"]) await page.keyboard.press(key);
  await expect(canvas).toHaveAttribute("data-drawn", "clips");

  // Space plays and pauses the song (not the video under it).
  await page.keyboard.press(" ");
  await expect(page.locator("[data-now-playing]").first()).toHaveAttribute("data-now-playing", "paused");
  await page.keyboard.press(" ");

  // I shows what it hears: the song's mood.
  await page.keyboard.press("i");
  await expect(view.locator("[data-mood]")).toContainText("intensity");
  // And what CLAP hears (here its stand-in: a made-up vibe, every few seconds).
  await expect(view.locator("[data-vibe]")).toContainText("stand-in", { timeout: 30_000 });
  await page.keyboard.press("i");
  await expect(view.locator("[data-mood]")).toHaveCount(0);
  // D: every setting the player plays (distort, feedback, the frame); Wash puts them back.
  await page.keyboard.press("d");
  const panel = view.locator("[data-play-panel]");
  await expect(panel).toContainText("Fluid warp");
  await expect(panel).toContainText("Echo zoom");
  // The music plays the effects until they're touched; then they're played by hand.
  await expect(panel).toContainText("The music plays these");
  await panel.getByRole("button", { name: "2×2" }).click();
  await expect(panel).not.toContainText("The music plays these");
  await expect(panel.getByRole("button", { name: "2×2" })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("slider", { name: "Feedback" }).fill("0.5");
  await expect(panel).toContainText("050");
  await panel.getByRole("button", { name: "Wash (⌫)" }).click();
  await expect(panel.getByRole("button", { name: "1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveAttribute("data-drawn", "clips");
  await page.keyboard.press("d");
  await expect(panel).toHaveCount(0);
  // S taps along to sync (Escape stops it, the visualizer stays).
  await page.keyboard.press("s");
  await expect(view.locator("[data-tap-sync]")).toContainText("Tap Space on the beat");
  await page.keyboard.press(" ");
  await page.keyboard.press("Escape");
  await expect(view.locator("[data-tap-sync]")).toHaveCount(0);
  await expect(view).toBeVisible();

  // The keys' help, then Escape closes it all.
  await page.keyboard.press("?");
  await expect(view.getByRole("heading", { name: "Keys" })).toBeVisible();
  await page.keyboard.press("?");
  await page.keyboard.press("Escape");
  await expect(view).toBeHidden();

  // Settings › General can turn it off.
  await page.keyboard.press("ControlOrMeta+,");
  await page.getByRole("tab", { name: "General" }).click();
  await page.getByRole("switch", { name: "Show what's playing" }).click();
  await expect(page.locator("[data-now-playing]")).toHaveCount(0);
  await page.getByRole("switch", { name: "Show what's playing" }).click();
  await expect(page.locator("[data-now-playing]")).toHaveCount(1);
});

test("Now Playing's visualizer: the mini player, a window over the app, and its own window", async ({ page }) => {
  await page.request.post("/api/now-playing", { data: { action: "play" } });
  await page.goto("/");
  const pill = page.locator("[data-now-playing]");
  if ((await pill.getAttribute("data-now-playing")) !== "playing") await pill.getByRole("button", { name: "Play" }).click();
  await expect(pill).toHaveAttribute("data-now-playing", "playing");
  // (The song's button: its title is the app's tooltip while the pointer's on it.)
  const open = pill.locator("button").first();
  await open.click();
  const view = page.locator("[data-now-playing-view]");
  await expect(view).toHaveAttribute("data-now-playing-view", "full");
  await expect(view.locator('[data-slot="visualizer-canvas"]')).toHaveAttribute("data-drawn", "clips", { timeout: 20_000 });

  // The mini player: small, in the bottom right corner, over the app (which goes on under it).
  await page.mouse.move(400, 300);
  await view.getByRole("button", { name: "Mini player (P)" }).click();
  await expect(view).toHaveAttribute("data-now-playing-view", "mini");
  const screen = page.viewportSize()!;
  const mini = (await view.boundingBox())!;
  expect(mini.width).toBeCloseTo(360, -1);
  expect(mini.x + mini.width).toBeCloseTo(screen.width - 16, -1);
  expect(mini.y + mini.height).toBeCloseTo(screen.height - 16, -1);
  await expect(pill).toBeVisible();

  // Its keys are its own only once it's been clicked: the app's are the app's.
  await open.click();
  await expect(view).toHaveAttribute("data-engaged", "false");
  await page.keyboard.press("p");
  await expect(view).toHaveAttribute("data-now-playing-view", "mini");
  await view.click();
  await expect(view).toHaveAttribute("data-engaged", "true");
  await page.keyboard.press(" ");
  await expect(pill).toHaveAttribute("data-now-playing", "paused");
  await page.keyboard.press(" ");
  await expect(pill).toHaveAttribute("data-now-playing", "playing");

  // Moved by dragging it, resized by a corner (the opposite one staying put).
  const drag = async (from: { x: number; y: number }, by: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 6 });
    await page.mouse.up();
  };
  await drag({ x: mini.x + mini.width / 2, y: mini.y + mini.height / 2 }, { x: -300, y: -200 });
  const moved = (await view.boundingBox())!;
  expect(moved.x).toBeCloseTo(mini.x - 300, -1);
  expect(moved.y).toBeCloseTo(mini.y - 200, -1);
  const corner = (await view.locator('[data-resize="-1,-1"]').boundingBox())!;
  await drag({ x: corner.x + 3, y: corner.y + 3 }, { x: -120, y: -60 });
  const bigger = (await view.boundingBox())!;
  expect(bigger.width).toBeCloseTo(moved.width + 120, -1);
  expect(bigger.height).toBeCloseTo(moved.height + 60, -1);
  expect(bigger.x + bigger.width).toBeCloseTo(moved.x + moved.width, 0);

  // Double-click: it fills the app; again, it's back where it was.
  await view.dblclick();
  await expect(view).toHaveAttribute("data-now-playing-view", "full");
  await view.dblclick();
  await expect(view).toHaveAttribute("data-now-playing-view", "mini");
  expect((await view.boundingBox())!.x).toBeCloseTo(bigger.x, 0);

  // Closed and opened again, it's where it was left.
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
  await open.click();
  await expect(view).toHaveAttribute("data-now-playing-view", "mini");
  expect((await view.boundingBox())!.width).toBeCloseTo(bigger.width, 0);

  // Its own window: the picture leaves the app for a window of its own, and is drawn there.
  await view.hover();
  const opened = page.waitForEvent("popup");
  await view.getByRole("button", { name: "Its own window (O)" }).click();
  const stage = await opened;
  const out = stage.locator("[data-now-playing-view]");
  await expect(out).toHaveAttribute("data-now-playing-view", "out");
  await expect(view).toHaveCount(0);
  const canvas = out.locator('[data-slot="visualizer-canvas"]');
  await expect(canvas).toHaveAttribute("data-drawn", "clips", { timeout: 20_000 });
  const picture = () =>
    canvas.evaluate((el: HTMLCanvasElement) => {
      const small = document.createElement("canvas");
      small.width = 64;
      small.height = 36;
      const ctx = small.getContext("2d")!;
      ctx.drawImage(el, 0, 0, 64, 36);
      const data = ctx.getImageData(0, 0, 64, 36).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return sum;
    });
  await expect.poll(picture, { timeout: 20_000 }).toBeGreaterThan(64 * 36 * 6);
  const before = await picture();
  await expect.poll(picture).not.toBe(before);
  // Its keys are its own there: Space pauses the song.
  await stage.keyboard.press(" ");
  await expect(pill).toHaveAttribute("data-now-playing", "paused");
  await stage.keyboard.press(" ");
  await expect(pill).toHaveAttribute("data-now-playing", "playing");

  // Back into the app: its window closes, and it's the mini player again.
  await stage.mouse.move(200, 200);
  const gone = stage.waitForEvent("close");
  await out.getByRole("button", { name: "Back into the app (O)" }).click();
  await gone;
  await expect(view).toHaveAttribute("data-now-playing-view", "mini");
  await expect(view.locator('[data-slot="visualizer-canvas"]')).toHaveAttribute("data-drawn", "clips");

  // Out again, closing its window closes the visualizer.
  const reopened = page.waitForEvent("popup");
  await page.keyboard.press("o");
  const again = await reopened;
  await expect(again.locator("[data-now-playing-view]")).toHaveAttribute("data-now-playing-view", "out");
  await again.close();
  await expect(view).toHaveCount(0);
  await expect(page.locator("[data-now-playing-view]")).toHaveCount(0);
});

test("Now Playing's MilkDrop looks: Butterchurn's presets drawn live, as any look", async ({ page }) => {
  await page.request.post("/api/now-playing", { data: { action: "play" } });
  await page.goto("/");
  await page.locator("[data-now-playing] button").first().click();
  const view = page.locator("[data-now-playing-view]");
  const canvas = view.locator('[data-slot="visualizer-canvas"]');
  await expect(canvas).toHaveAttribute("data-drawn", "clips", { timeout: 20_000 });

  // A MilkDrop look, picked (staying on it): Butterchurn loads, draws its preset, and the visualizer shows it.
  await page.mouse.move(400, 300);
  await view.getByLabel("Change looks").selectOption("off");
  // In the looks menu up top, by kind: Shuffle MilkDrop, or one by name.
  const menu = view.locator("[data-looks-menu]");
  await menu.getByRole("button", { name: /^Looks:/ }).click();
  await menu.locator('[data-kind="milkdrop"]').click();
  const shuffle = menu.locator('[data-shuffle="milkdrop"]');
  await shuffle.click();
  const milkdrop = page.locator("canvas[data-milkdrop]");
  await expect(milkdrop).toHaveAttribute("data-milkdrop", "ready", { timeout: 20_000 });
  await expect(milkdrop).toHaveAttribute("data-look", /^md-/);
  const first = await milkdrop.getAttribute("data-look");
  await expect.poll(async () => Number(await milkdrop.getAttribute("data-frames")), { timeout: 10_000 }).toBeGreaterThan(30);
  const sum = (selector: string) =>
    page.locator(selector).evaluate((el: HTMLCanvasElement) => {
      const small = document.createElement("canvas");
      small.width = 64;
      small.height = 36;
      const ctx = small.getContext("2d")!;
      ctx.drawImage(el, 0, 0, 64, 36);
      const data = ctx.getImageData(0, 0, 64, 36).data;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2];
      return total;
    });
  // Butterchurn draws something (not black), and it moves.
  await expect.poll(() => sum("canvas[data-milkdrop]"), { timeout: 10_000 }).toBeGreaterThan(64 * 36 * 6);
  const before = await sum("canvas[data-milkdrop]");
  await expect.poll(() => sum("canvas[data-milkdrop]")).not.toBe(before);
  await expect(canvas).toHaveAttribute("data-drawn", "clips");

  // Shuffle again (the menu stays): another preset, blended to; the one canvas draws it. Then one by name.
  await shuffle.click();
  await expect.poll(() => milkdrop.getAttribute("data-look")).not.toBe(first);
  await expect(milkdrop).toHaveAttribute("data-look", /^md-/);
  const shown = await milkdrop.getAttribute("data-look");
  const other = menu.locator(`[data-look^="md-"]:not([data-look="${shown}"])`).first();
  const named = await other.getAttribute("data-look");
  await other.click();
  await expect(milkdrop).toHaveAttribute("data-look", named!);
  await expect(menu.getByRole("menu")).toHaveCount(0);
  await expect(view).toHaveAttribute("data-showing", named!);
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
});

test("Now Playing's vibe: its model offered while it isn't here, downloaded on asking, or not offered again", async ({ page }) => {
  // The server's answers made up: the model missing, then downloading once asked.
  let status: object = { status: "missing", progress: null, size: 281_749_092, error: null, standIn: false };
  await page.route("**/api/now-playing/vibe", (route) => route.fulfill({ json: status }));
  await page.route("**/api/now-playing/vibe/setup", (route) => {
    status = { ...status, status: "downloading", progress: 0.25 };
    return route.fulfill({ status: 202, json: status });
  });
  await page.request.post("/api/now-playing", { data: { action: "play" } });
  await page.goto("/");
  const open = page.locator("[data-now-playing] button").first();
  await open.click();
  const view = page.locator("[data-now-playing-view]");
  await page.mouse.move(400, 300);
  const offer = view.locator("[data-vibe-offer]");
  await expect(offer).toContainText("Hear each song's vibe");
  await offer.getByRole("button", { name: "Download (282 MB)" }).click();
  await expect(offer).toHaveAttribute("data-vibe-offer", "downloading");
  await expect(offer).toContainText("25%");
  // Missing again (say the download was stopped): offered again, until the user says not now, for good.
  status = { ...status, status: "missing", progress: null };
  await page.keyboard.press("Escape");
  await open.click();
  await page.mouse.move(420, 320);
  await expect(offer).toHaveAttribute("data-vibe-offer", "missing");
  await offer.getByRole("button", { name: "Not now" }).first().click();
  await expect(offer).toHaveCount(0);
  await page.reload();
  await page.locator("[data-now-playing] button").first().click();
  await expect(view.locator('[data-slot="visualizer-canvas"]')).toHaveAttribute("data-drawn", "clips", { timeout: 20_000 });
  await page.mouse.move(400, 300);
  await expect(offer).toHaveCount(0);
});
