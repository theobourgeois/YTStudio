import { expect, test } from "@playwright/test";
import path from "node:path";
import { defaultEffects } from "../shared/effects.ts";
import type { MusicProject } from "../shared/music/types.ts";
import type { Project } from "../shared/types.ts";

test("home cards render saved projects, play one at a time, seek, and reuse cached previews", async ({ page }) => {
  const create = async (suite: "music" | "video", name: string) => {
    const response = await page.request.post("/api/projects", { data: { suite, name, blank: true } });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const song = await create("music", "Preview song");
  const music: MusicProject = await (await page.request.get(`/api/projects/${song.id}`)).json();
  const imported = await page.request.post("/api/media/import-file", { data: {
    projectId: song.id, path: path.resolve("samples/music-20s.mp3"),
  } });
  expect(imported.ok()).toBe(true);
  const audio = await imported.json();
  music.channels[0].sampleId = audio.id;
  music.patterns[0].notes[music.channels[0].id] = [{ id: 1, start: 0, length: 384, pitch: 60, velocity: 0.8, pan: 0, muted: false }];
  await page.request.put(`/api/projects/${song.id}`, { data: music });

  const video = await create("video", "Preview video");
  const project: Project = await (await page.request.get(`/api/projects/${video.id}`)).json();
  const sourceResponse = await page.request.post("/api/media/import-file", { data: {
    projectId: video.id, path: path.resolve("samples/landscape-1920x1080-8s.mp4"),
  } });
  expect(sourceResponse.ok()).toBe(true);
  const source = await sourceResponse.json();
  // A 3-second edit of an 8-second source: the card must preview the edit.
  project.clips = [{ id: "clip_123456789abc", assetId: source.id, trackId: project.tracks[0].id,
    start: 0, in: 2, out: 5, effects: defaultEffects() }];
  await page.request.put(`/api/projects/${video.id}`, { data: project });
  await page.goto("/");
  const songCard = page.locator(`[data-project-id="${song.id}"]`);
  const videoCard = page.locator(`[data-project-id="${video.id}"]`);
  await expect(songCard.getByRole("img", { name: "Song preview waveform" })).toBeVisible({ timeout: 60_000 });
  await expect(videoCard.locator("video")).toHaveCount(1, { timeout: 60_000 });
  await expect(videoCard.getByRole("slider")).toHaveCount(0);
  await expect(videoCard.getByRole("button", { name: "Unmute preview of Preview video" })).toHaveCount(0);
  await expect(songCard.locator("audio")).not.toHaveAttribute("src");
  await expect(videoCard.locator("video")).not.toHaveAttribute("src");

  await songCard.getByRole("button", { name: "Play preview of Preview song", exact: true }).click();
  await expect.poll(() => songCard.locator("audio").evaluate((e: HTMLAudioElement) => !e.paused && e.currentTime > 0)).toBe(true);
  await expect(page).toHaveURL(/\/$/);
  await songCard.getByRole("button", { name: "Pause preview of Preview song", exact: true }).click();
  const pausedAt = await songCard.locator("audio").evaluate((e: HTMLAudioElement) => e.currentTime);
  await songCard.getByRole("button", { name: "Play preview of Preview song", exact: true }).click();
  await expect.poll(() => songCard.locator("audio").evaluate((e: HTMLAudioElement) => e.currentTime)).toBeGreaterThan(pausedAt);

  await videoCard.locator("video").hover({ force: true });
  await expect.poll(() => videoCard.locator("video").evaluate((e: HTMLVideoElement) => !e.paused && e.currentTime > 0)).toBe(true);
  await expect.poll(() => songCard.locator("audio").evaluate((e: HTMLAudioElement) => e.paused)).toBe(true);
  expect(await videoCard.locator("video").evaluate((e: HTMLVideoElement) => e.muted)).toBe(true);
  expect(await videoCard.locator("video").evaluate((e: HTMLVideoElement) => e.duration)).toBeCloseTo(3, 0);
  await videoCard.getByRole("button", { name: "Unmute preview of Preview video" }).click();
  await expect.poll(() => videoCard.locator("video").evaluate((e: HTMLVideoElement) => e.muted)).toBe(false);
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("heading", { name: "Recent", exact: true }).hover();
  await expect.poll(() => videoCard.locator("video").evaluate((e: HTMLVideoElement) => e.paused && e.muted && e.currentTime === 0)).toBe(true);
  await expect(videoCard.getByRole("button", { name: "Unmute preview of Preview video" })).toHaveCount(0);
  await videoCard.locator("video").hover({ force: true });
  await expect.poll(() => videoCard.locator("video").evaluate((e: HTMLVideoElement) => !e.paused && e.muted)).toBe(true);
  await page.getByRole("heading", { name: "Recent", exact: true }).hover();
  const songSeek = songCard.getByRole("slider", { name: "Seek preview of Preview song" });
  await songSeek.fill("0.5");
  await expect.poll(() => songCard.locator("audio").evaluate((e: HTMLAudioElement) => e.currentTime)).toBeGreaterThanOrEqual(0.5);

  const cached = await (await page.request.get(`/api/projects/${song.id}/preview`)).json();
  await page.reload();
  await expect(songCard.getByRole("img", { name: "Song preview waveform" })).toBeVisible();
  expect(await (await page.request.get(`/api/projects/${song.id}/preview`)).json()).toEqual(cached);
  await songCard.getByRole("button", { name: "Play preview of Preview song", exact: true }).click();
  await songCard.getByText("Preview song", { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${song.id}$`));
  await expect(page.locator("audio")).toHaveCount(0);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await videoCard.locator("video").hover({ force: true });
  await expect(videoCard.locator("video")).toBeVisible();
  await videoCard.locator("video").click();
  await expect(page).toHaveURL(new RegExp(`/p/${video.id}$`));
});
