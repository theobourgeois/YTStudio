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

  // Pause and play, and skip (shown on hover).
  await pill.getByRole("button", { name: "Pause" }).click();
  await expect(pill).toHaveAttribute("data-now-playing", "paused");
  await pill.getByRole("button", { name: "Play" }).click();
  await expect(pill).toHaveAttribute("data-now-playing", "playing");
  await pill.hover();
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

  // The looks: the arrows step through them, the picker picks one, keys punch the picture.
  const pressed = () => view.locator("[data-look][aria-pressed='true']").getAttribute("data-look");
  const first = await pressed();
  await page.keyboard.press("ArrowRight");
  await expect.poll(pressed).not.toBe(first);
  await view.getByRole("button", { name: "Spectrums", exact: true }).click();
  await view.locator('[data-look="halo"]').click();
  await expect(view.locator('[data-look="halo"]')).toHaveAttribute("aria-pressed", "true");
  for (const key of ["z", "x", "c", "v", "3"]) await page.keyboard.press(key);
  await expect(canvas).toHaveAttribute("data-drawn", "clips");

  // Space plays and pauses the song (not the video under it).
  await page.keyboard.press(" ");
  await expect(page.locator("[data-now-playing]").first()).toHaveAttribute("data-now-playing", "paused");
  await page.keyboard.press(" ");

  // I shows what it hears: the song's mood.
  await page.keyboard.press("i");
  await expect(view.locator("[data-mood]")).toContainText("intensity");
  await page.keyboard.press("i");
  await expect(view.locator("[data-mood]")).toHaveCount(0);
  // D: every setting the player plays (distort, feedback, the frame); Wash puts them back.
  await page.keyboard.press("d");
  const panel = view.locator("[data-play-panel]");
  await expect(panel).toContainText("Fluid warp");
  await expect(panel).toContainText("Echo zoom");
  await panel.getByRole("button", { name: "2×2" }).click();
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
