/**
 * The music suite. Its tests make their own songs (through the API, then open them), so they don't
 * depend on what the video editor's tests left behind; like those, they run in order and share a
 * server. The audio engine is a stand-in (`server/music/fake-engine.mjs`): nothing is heard.
 */
import { type Page, expect, test } from "@playwright/test";

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

test("the audio engine starts, loads a plugin, opens its window and keeps its state", async ({ page }) => {
  await openNewSong(page, "Engine bench");
  await expect(page.getByRole("heading", { name: "Audio engine" })).toBeVisible();
  await expect(page.getByTestId("engine-device")).toContainText("48.0 kHz");

  // No instrument yet: nothing to play.
  const keys = page.getByRole("group", { name: "Keys" }).getByRole("button");
  await expect(keys.first()).toBeDisabled();

  // Each slot offers the plugins of its kind.
  await page.getByRole("combobox", { name: "Instrument plugin" }).click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("option", { name: /Fake Synth/ }).click();
  const instrument = page.locator('[data-slot-name="instrument"]');
  await instrument.getByRole("button", { name: "Open window" }).click();
  await expect(instrument.getByRole("button", { name: "Close window" })).toBeVisible();
  await expect(keys.first()).toBeEnabled();

  await expect(instrument.getByRole("button", { name: "Restore" })).toBeDisabled();
  await instrument.getByRole("button", { name: "Save state" }).click();
  await expect(instrument.getByRole("button", { name: "Restore" })).toBeEnabled();

  await instrument.getByRole("button", { name: "Remove" }).click();
  await expect(keys.first()).toBeDisabled();
});
