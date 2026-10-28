import { type Page, expect, test } from "@playwright/test";

// The stand-in player (EDITOR_NOW_PLAYING=stand-in, playwright.config.ts) plays made-up songs, and the visualizer
// measures a made-up sound instead of the computer's: nothing here is ever heard.
test.describe.configure({ mode: "serial" });

/** The stand-in player, playing (on the first of its songs, if `first`). */
async function play(page: Page, first = false) {
  await page.request.post("/api/now-playing", { data: { action: "play" } });
  for (let i = 0; first && i < 3; i++) {
    const status = (await (await page.request.get("/api/now-playing")).json()) as { track?: { name: string } };
    if (status.track?.name === "Midnight Drive") break;
    await page.request.post("/api/now-playing", { data: { action: "next" } });
  }
}

/** Home's Visualizer button: the visualizer of what the computer plays (the Visualizer app's, docs/apps.md). */
const visualizerButton = (page: Page) => page.locator("[data-visualize-sound]");

test("Now Playing with nothing playing: the visualizer still opens, on the computer's sound", async ({ page }) => {
  // The stand-in is closed until the next test tells it to play.
  await page.goto("/");
  const button = visualizerButton(page);
  await expect(button).toBeVisible();
  await button.click();
  const view = page.locator("[data-now-playing-view]");
  await expect(view).toBeVisible();
  await expect(view).toContainText("Listening to the computer's sound");
  await page.keyboard.press("Escape");
  await expect(view).toBeHidden();
});

test("Now Playing: the visualizer of the song playing, from Home", async ({ page }) => {
  // The stand-in isn't open until it's told to play (the other specs never see it).
  await play(page, true);
  await page.goto("/");

  // Home's Visualizer fills the window with it, listening (to a made-up song) and drawing.
  await visualizerButton(page).click();
  const view = page.locator("[data-now-playing-view]");
  await expect(view).toBeVisible();
  await expect(view).toHaveAttribute("data-player", "playing");
  await expect(view.locator("[data-song-card]")).toContainText("Midnight Drive");
  await expect(view.locator("[data-song-card]")).toContainText("Neon Avenue");
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

  // Space plays and pauses the song.
  await page.keyboard.press(" ");
  await expect(view).toHaveAttribute("data-player", "paused");
  await page.keyboard.press(" ");
  await expect(view).toHaveAttribute("data-player", "playing");

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

  // Settings › General has its sound delay.
  await page.keyboard.press("ControlOrMeta+,");
  await page.getByRole("tab", { name: "General" }).click();
  await expect(page.getByText("Sound delay", { exact: true })).toBeVisible();
});

test("Now Playing's visualizer: the mini player, a window over the app, and its own window", async ({ page }) => {
  await play(page);
  await page.goto("/");
  const open = visualizerButton(page);
  await open.click();
  const view = page.locator("[data-now-playing-view]");
  await expect(view).toHaveAttribute("data-player", "playing");
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
  await expect(open).toBeVisible();

  // Its keys are its own only once it's been clicked: the app's are the app's.
  await open.click();
  await expect(view).toHaveAttribute("data-engaged", "false");
  await page.keyboard.press("p");
  await expect(view).toHaveAttribute("data-now-playing-view", "mini");
  await view.click();
  await expect(view).toHaveAttribute("data-engaged", "true");
  await page.keyboard.press(" ");
  await expect(view).toHaveAttribute("data-player", "paused");
  await page.keyboard.press(" ");
  await expect(view).toHaveAttribute("data-player", "playing");

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
  await expect(out).toHaveAttribute("data-player", "paused");
  await stage.keyboard.press(" ");
  await expect(out).toHaveAttribute("data-player", "playing");

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
  await visualizerButton(page).click();
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
  // Butterchurn draws something (not black), and it moves: on a bright preset (a shuffle may land on a nearly black one).
  await menu.locator('[data-look="md-firestorm"]').click();
  await expect(milkdrop).toHaveAttribute("data-look", "md-firestorm");
  await menu.getByRole("button", { name: /^Looks:/ }).click();
  await menu.locator('[data-kind="milkdrop"]').click();
  await expect.poll(() => sum("canvas[data-milkdrop]"), { timeout: 10_000 }).toBeGreaterThan(64 * 36 * 6);
  const before = await sum("canvas[data-milkdrop]");
  await expect.poll(() => sum("canvas[data-milkdrop]")).not.toBe(before);
  await expect(canvas).toHaveAttribute("data-drawn", "clips");

  // Shuffle again (the menu stays): another preset, blended to; the one canvas draws it. Then one by name.
  await shuffle.click();
  await expect.poll(() => milkdrop.getAttribute("data-look")).not.toBe("md-firestorm");
  await expect(milkdrop).toHaveAttribute("data-look", /^md-/);
  const shown = await milkdrop.getAttribute("data-look");
  const other = menu.locator(`[data-look^="md-"]:not([data-look="${shown}"])`).first();
  const named = await other.getAttribute("data-look");
  await other.click();
  await expect(milkdrop).toHaveAttribute("data-look", named!);
  await expect(menu.getByRole("menu")).toHaveCount(0);
  await expect(view).toHaveAttribute("data-showing", named!);

  // Slow motion by choice (the Speed slider, or ⇧S): kept, and MilkDrop drawn at that speed, going on.
  const pace = () => page.evaluate(() => localStorage.getItem("editor-visualizer-pace"));
  await page.mouse.move(420, 320);
  await view.getByLabel("Speed").fill("0.5");
  await expect.poll(pace).toBe("0.5");
  await expect(milkdrop).toHaveAttribute("data-pace", "0.5");
  const frames = Number(await milkdrop.getAttribute("data-frames"));
  await expect.poll(async () => Number(await milkdrop.getAttribute("data-frames"))).toBeGreaterThan(frames);
  await page.keyboard.press("Shift+KeyS");
  await expect.poll(pace).toBe("1");
  await expect(view.getByLabel("Speed")).toHaveValue("1");
  await expect(milkdrop).toHaveAttribute("data-pace", "1");
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
  const open = visualizerButton(page);
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
  await visualizerButton(page).click();
  await expect(view.locator('[data-slot="visualizer-canvas"]')).toHaveAttribute("data-drawn", "clips", { timeout: 20_000 });
  await page.mouse.move(400, 300);
  await expect(offer).toHaveCount(0);
});

test("Now Playing's ratings: L loves a look, B bins it (it goes), and the rating mode goes through the looks", async ({ page }) => {
  await page.request.post("/api/now-playing", { data: { action: "play" } });
  await page.goto("/");
  await visualizerButton(page).click();
  const view = page.locator("[data-now-playing-view]");
  await expect(view.locator('[data-slot="visualizer-canvas"]')).toHaveAttribute("data-drawn", "clips", { timeout: 20_000 });
  // What the server keeps (skips aside: what the music put up and was left soon after).
  type Kept = { look: string; verdict: string; rating?: true; song: { name: string } | null };
  const said = async () => ((await (await page.request.get("/api/now-playing/ratings")).json()).ratings as Kept[]).filter((r) => r.verdict !== "skip");

  // Staying on one look: L loves it (kept, with the song), shown on its heart and in the looks menu; L again takes it back.
  await page.mouse.move(400, 300);
  await view.getByLabel("Change looks").selectOption("off");
  const menu = view.locator("[data-looks-menu]");
  const looksButton = menu.getByRole("button", { name: /^Looks:/ });
  await looksButton.click();
  await menu.locator('[data-kind="spectrum"]').click();
  await menu.locator('[data-look="halo"]').click();
  await expect(view).toHaveAttribute("data-showing", "halo");
  await page.keyboard.press("l");
  await expect(view.locator("[data-rated]")).toHaveAttribute("data-rated", "love");
  await expect(view.locator("[data-rated]")).toContainText("Loved Halo");
  await expect.poll(async () => (await said()).map((r) => `${r.look} ${r.verdict}`)).toEqual(["halo love"]);
  expect((await said())[0].song?.name).toBeTruthy();
  await page.mouse.move(410, 310);
  await expect(view.getByRole("button", { name: /^Loved: shown more/ })).toBeVisible();
  await looksButton.click();
  await menu.locator('[data-kind="spectrum"]').click();
  await expect(menu.locator('[data-look="halo"]')).toHaveAttribute("data-verdict", "love");
  await looksButton.click();
  await page.keyboard.press("l");
  await expect(view.locator("[data-rated]")).toHaveAttribute("data-rated", "clear");
  await expect.poll(async () => (await said()).map((r) => r.verdict)).toEqual(["love", "clear"]);

  // B bins it: it goes at once.
  await page.keyboard.press("b");
  await expect(view.locator("[data-rated]")).toHaveAttribute("data-rated", "bin");
  await expect.poll(() => view.getAttribute("data-showing")).not.toBe("halo");
  await expect.poll(async () => (await said()).map((r) => r.verdict)).toEqual(["love", "clear", "bin"]);

  // The rating mode (⇧R): the looks one after another, a judged one never; L and B rate and move on, → passes over
  // it, ← goes back, Esc stops (the visualizer stays).
  await page.keyboard.press("Shift+KeyR");
  await expect(view).toHaveAttribute("data-rating", "on");
  const bar = view.locator("[data-rating-bar]");
  await expect(bar).toContainText("to go");
  const shownInBar = () => bar.getAttribute("data-rating-bar");
  const first = (await shownInBar())!;
  expect(first).not.toBe("halo");
  await expect(view).toHaveAttribute("data-showing", first);
  await page.keyboard.press("l");
  await expect.poll(shownInBar).not.toBe(first);
  const second = (await shownInBar())!;
  await bar.locator('[data-rate="bin"]').click();
  await expect.poll(shownInBar).not.toBe(second);
  const third = (await shownInBar())!;
  await page.keyboard.press("ArrowRight");
  await expect.poll(shownInBar).not.toBe(third);
  await page.keyboard.press("ArrowLeft");
  await expect(bar).toHaveAttribute("data-rating-bar", third);
  await expect
    .poll(async () => (await said()).slice(3).map((r) => `${r.look} ${r.verdict}${r.rating ? " (rating)" : ""}`))
    .toEqual([`${first} love (rating)`, `${second} bin (rating)`, `${third} pass (rating)`]);
  await page.keyboard.press("Escape");
  await expect(view).not.toHaveAttribute("data-rating", "on");
  await expect(bar).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
});

test("Now Playing's media: clips and pictures of the user's, melting into MilkDrop's feedback", async ({ page }) => {
  await page.request.post("/api/now-playing", { data: { action: "play" } });
  await page.goto("/");
  await visualizerButton(page).click();
  const view = page.locator("[data-now-playing-view]");
  await expect(view.locator('[data-slot="visualizer-canvas"]')).toHaveAttribute("data-drawn", "clips", { timeout: 20_000 });

  // Staying on a MilkDrop look: nothing of the user's goes in while there's nothing.
  await page.mouse.move(400, 300);
  await view.getByLabel("Change looks").selectOption("off");
  const menu = view.locator("[data-looks-menu]");
  await menu.getByRole("button", { name: /^Looks:/ }).click();
  await menu.locator('[data-kind="milkdrop"]').click();
  await menu.locator('[data-shuffle="milkdrop"]').click();
  await menu.getByRole("button", { name: /^Looks:/ }).click();
  const milkdrop = page.locator("canvas[data-milkdrop]");
  await expect(milkdrop).toHaveAttribute("data-milkdrop", "ready", { timeout: 20_000 });
  await expect(milkdrop).toHaveAttribute("data-media", "");

  // A picture added from the media panel: kept in the Library's Visualizer folder, and fed into the look's feedback.
  await page.mouse.move(410, 310);
  await view.getByRole("button", { name: "Your clips, pictures and screen, in the feedback" }).click();
  const panel = view.locator("[data-media-panel]");
  await expect(panel).toContainText("Nothing yet");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff2266";
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = "#22ddff";
    ctx.beginPath();
    ctx.arc(160, 90, 60, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await panel.getByLabel("Add files: clips, pictures or 3D models").setInputFiles({ name: "glow.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  const item = panel.locator("[data-media]");
  await expect(item).toHaveCount(1);
  const id = (await item.getAttribute("data-media"))!;
  await expect(milkdrop).toHaveAttribute("data-media", id);
  await expect(item).toHaveAttribute("data-feeding", "true");
  await expect.poll(async () => Number(await milkdrop.getAttribute("data-fed")), { timeout: 10_000 }).toBeGreaterThan(30);
  const library = await (await page.request.get("/api/library")).json();
  type Folder = { id: string; name: string; parentId: string | null };
  const inSet = (lib: { folders: Folder[]; items: { folderId: string; mediaId: string }[] }, set: string) => {
    const root = lib.folders.find((f) => f.name === "Visualizer" && f.parentId === null);
    const folder = lib.folders.find((f) => f.name === set && f.parentId === root?.id);
    return lib.items.some((i) => i.folderId === folder?.id && i.mediaId === id);
  };
  // In the first set, made for it.
  expect(inSet(library, "My clips")).toBe(true);

  // ⇧N takes them out of the feedback and back; N with only one brings the same one in again.
  await page.keyboard.press("Shift+KeyN");
  await expect(milkdrop).toHaveAttribute("data-media", "");
  await page.keyboard.press("Shift+KeyN");
  await expect(milkdrop).toHaveAttribute("data-media", id);
  await page.keyboard.press("n");
  await expect(milkdrop).toHaveAttribute("data-media", id);

  // Sets: a new one is in use at once, and empty (nothing goes in); K goes on to the next, round to the first.
  const sets = panel.locator("[data-media-sets]");
  await expect(sets.getByRole("radio", { name: /My clips/ })).toHaveAttribute("aria-checked", "true");
  await sets.getByRole("button", { name: "A new set" }).click();
  const naming = panel.getByLabel("The new set's name");
  await naming.fill("Nature");
  await naming.press("Enter");
  await expect(sets.getByRole("radio", { name: /Nature/ })).toHaveAttribute("aria-checked", "true");
  await expect(panel).toContainText("Nothing in this set yet");
  await expect(milkdrop).toHaveAttribute("data-media", "");
  await page.keyboard.press("k");
  await expect(view.locator("[data-set-note]")).toContainText("My clips: 1 clip");
  await expect(sets.getByRole("radio", { name: /My clips/ })).toHaveAttribute("aria-checked", "true");
  await expect(milkdrop).toHaveAttribute("data-media", id);

  // Moved into another set: out of this one, in that one when it's picked.
  await item.hover();
  await item.getByRole("button", { name: /^Move glow/ }).click();
  await panel.locator("[data-moving]").getByRole("button", { name: "Nature" }).click();
  await expect(panel).toContainText("Nothing in this set yet");
  await expect(milkdrop).toHaveAttribute("data-media", "");
  await sets.getByRole("radio", { name: /Nature/ }).click();
  await expect(item).toHaveCount(1);
  await expect(milkdrop).toHaveAttribute("data-media", id);
  expect(inSet(await (await page.request.get("/api/library")).json(), "Nature")).toBe(true);

  // The empty set deleted (asked first): the sets left go on.
  await sets.getByRole("radio", { name: /My clips/ }).click();
  await sets.getByRole("button", { name: "Delete My clips" }).click();
  await panel.locator("[data-deleting]").getByRole("button", { name: "Delete" }).click();
  await expect(sets.getByRole("radio")).toHaveCount(1);
  await expect(sets.getByRole("radio", { name: /Nature/ })).toHaveAttribute("aria-checked", "true");
  await expect(milkdrop).toHaveAttribute("data-media", id);

  // Taken out: gone from the set and the feedback.
  await item.hover();
  await item.getByRole("button", { name: /^Take glow/ }).click();
  await expect(panel).toContainText("Nothing in this set yet");
  await expect(milkdrop).toHaveAttribute("data-media", "");

  // Found online (the video editor's Online search, a stand-in yt-dlp): typed into the search, not the visualizer's
  // keys (its A would have changed how looks change); a result's picture downloaded into the folder and shown at once.
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await panel.getByRole("menuitem", { name: /Online video/ }).click();
  const search = panel.getByLabel("Search YouTube or paste a link");
  await search.pressSequentially("amen");
  await expect(view.getByLabel("Change looks")).toHaveValue("off");
  const result = panel.locator('li[data-url*="amenbreak01"]');
  await expect(result).toBeVisible();
  await result.getByRole("button", { name: /^Into the visualizer/ }).click();
  // (Back on the set's list once it's in.)
  const online = panel.locator("[data-media]");
  await expect(online).toHaveCount(1, { timeout: 30_000 });
  await expect(online).toHaveAttribute("data-kind", "video");
  await expect(milkdrop).toHaveAttribute("data-media", (await online.getAttribute("data-media"))!);
  const after = await (await page.request.get("/api/library")).json();
  expect(after.media.some((m: { origin?: string; kind: string }) => m.origin === "web:video:amenbreak01" && m.kind === "video")).toBe(true);

  // A 3D model searched for (a stand-in site: made-up boxes, those that move marked) comes into the set and the look.
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await panel.getByRole("menuitem", { name: /3D models/ }).click();
  await panel.getByLabel("Search for 3D models").pressSequentially("robot");
  await expect(view.getByLabel("Change looks")).toHaveValue("off");
  const model = panel.locator('[data-model="model:poly-pizza:robot-0"]');
  await expect(model).toContainText("Moves");
  await model.getByRole("button", { name: "Add robot 1" }).click();
  const modelInSet = model.getByRole("button", { name: /^robot 1: in this set/ });
  await expect(modelInSet).toBeVisible({ timeout: 30_000 });
  // Clicked again it's taken out of the set (its tick a cross on hover), and can be put back.
  await modelInSet.click();
  await expect(model.getByRole("button", { name: "Add robot 1" })).toBeVisible({ timeout: 10_000 });
  await model.getByRole("button", { name: "Add robot 1" }).click();
  await expect(modelInSet).toBeVisible({ timeout: 30_000 });
  await panel.getByRole("button", { name: "Back to your media" }).click();
  const box = panel.locator('[data-media][data-kind="model"]');
  await expect(box).toHaveCount(1);
  await expect(box).toContainText("3D · animated");
  await expect(box).toContainText("Stand-in · CC0 1.0");
  // (First: the look may show the other beside it.)
  await expect(milkdrop).toHaveAttribute("data-media", new RegExp(`^${(await box.getAttribute("data-media"))!}( |$)`));
  await expect.poll(async () => Number(await milkdrop.getAttribute("data-fed")), { timeout: 10_000 }).toBeGreaterThan(30);
  const withModel = await (await page.request.get("/api/library")).json();
  expect(withModel.media.some((m: { origin?: string; kind: string }) => m.origin === "model:poly-pizza:robot-0" && m.kind === "model")).toBe(true);
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
});

test("Now Playing's screen: a window or screen shared into MilkDrop's looks, the clips coming in over it, the others not picked while it is", async ({ page }) => {
  // The browser's picker stands in for the screen (a moving picture, as a window shared is); listening's, asking for
  // sound, goes on as it was.
  await page.addInitScript(() => {
    const listen = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      if (options?.audio) return listen(options);
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d")!;
      let n = 0;
      setInterval(() => {
        ctx.fillStyle = "#202830";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#ff8800";
        ctx.fillRect((n++ * 7) % 600, 120, 40, 120);
      }, 33);
      return canvas.captureStream(30);
    };
  });
  await page.request.post("/api/now-playing", { data: { action: "play" } });
  await page.goto("/");
  await visualizerButton(page).click();
  const view = page.locator("[data-now-playing-view]");
  await expect(view.locator('[data-slot="visualizer-canvas"]')).toHaveAttribute("data-drawn", "clips", { timeout: 20_000 });

  // On one of ours (not MilkDrop's: the first look is), staying on it.
  await page.mouse.move(400, 300);
  await view.getByLabel("Change looks").selectOption("off");
  await expect(view).not.toHaveAttribute("data-showing", /^md-/);

  // Shared from the media panel's Screen: a MilkDrop look comes on, with the screen in it.
  await page.mouse.move(410, 310);
  await view.getByRole("button", { name: "Your clips, pictures and screen, in the feedback" }).click();
  const panel = view.locator("[data-media-panel]");
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await panel.getByRole("menuitem", { name: /Screen or window/ }).click();
  await panel.getByRole("button", { name: "Choose a screen or window…" }).click();
  await expect(panel.locator("[data-screen-shared]")).toContainText("The screen");
  // (Once MilkDrop's loaded: the look before shows till then.)
  await expect(view).toHaveAttribute("data-showing", /^md-/, { timeout: 20_000 });
  const milkdrop = page.locator("canvas[data-milkdrop]");
  await expect(milkdrop).toHaveAttribute("data-milkdrop", "ready");
  await expect(milkdrop).toHaveAttribute("data-screen", "on");
  await expect.poll(async () => Number(await milkdrop.getAttribute("data-screen-fed")), { timeout: 10_000 }).toBeGreaterThan(30);

  // A picture added comes in over the screen at once (one asked for doesn't wait for its turn), the screen staying.
  await panel.getByRole("button", { name: "Back to your media" }).click();
  await expect(panel.locator("[data-screen-row]")).toContainText("The screen");
  const items = panel.locator("[data-media]");
  const before = await items.evaluateAll((els) => els.map((el) => el.getAttribute("data-media")));
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#22ddff";
    ctx.fillRect(0, 0, 320, 180);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await panel.getByLabel("Add files: clips, pictures or 3D models").setInputFiles({ name: "over.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(items).toHaveCount(before.length + 1);
  const added = (await items.evaluateAll((els) => els.map((el) => el.getAttribute("data-media")))).find((id) => !before.includes(id))!;
  await expect(milkdrop).toHaveAttribute("data-media", added);
  const fed = Number((await milkdrop.getAttribute("data-fed")) ?? 0);
  await expect.poll(async () => Number(await milkdrop.getAttribute("data-fed")), { timeout: 10_000 }).toBeGreaterThan(fed);
  await expect(milkdrop).toHaveAttribute("data-screen", "on");
  await panel.locator("[data-screen-row]").click();

  // Looks picked while it's shared are MilkDrop's.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("r");
    await expect(view).toHaveAttribute("data-showing", /^md-/);
  }
  await expect(milkdrop).toHaveAttribute("data-screen", "on");

  // Stopped: out of the look (the user's clips go on as before). G shares again (a browser's picker at once) and stops it.
  await panel.getByRole("button", { name: "Stop sharing" }).click();
  await expect(panel.locator("[data-screen-shared]")).toHaveCount(0);
  await expect(milkdrop).toHaveAttribute("data-screen", "");
  await page.keyboard.press("g");
  await expect(milkdrop).toHaveAttribute("data-screen", "on");
  await page.keyboard.press("g");
  await expect(milkdrop).toHaveAttribute("data-screen", "");
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
});
