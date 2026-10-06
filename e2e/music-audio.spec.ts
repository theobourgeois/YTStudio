import { expect, test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { writeWav } from "../server/music/wav.ts";
import { createMusicProject } from "../shared/music/project.ts";
import { addAudioClips } from "../shared/music/playlist.ts";
import { addMixerTracks, updateMixerTrack } from "../shared/music/mixer.ts";
import { PRIVATE_USE } from "../shared/music/audio-intelligence/types.ts";

test("workflow and engineer package tools retrieve reviewed sources with the tab closed", async ({ page, context }) => {
  const source = path.resolve("e2e/.data/engineer-package"); await fs.mkdir(source, { recursive: true });
  await writeWav(path.join(source, "dry vocal.wav"), Float32Array.from({ length: 8000 }, (_, i) => .2 * Math.sin(i / 12)), 8000);
  await fs.writeFile(path.join(source, "session.ptx"), "opaque session, no readable controls");
  const { id } = await (await page.request.post("/api/projects", { data: { suite: "music", name: "Engineer reference tools" } })).json();
  await page.goto(`/p/${id}`); await expect(page.locator('[data-suite="music"]')).toBeVisible();
  const mcpUrl = `http://127.0.0.1:${process.env.E2E_SERVER_PORT || 5321}/mcp?chat=${id}`;
  const call = async (name: string, args: object = {}) => {
    const response = await context.request.post(mcpUrl, { data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } });
    const body = await response.json(); expect(body.error).toBeUndefined(); expect(body.result.isError, JSON.stringify(body.result)).not.toBe(true);
    return JSON.parse(body.result.content.find((c: { type: string }) => c.type === "text").text);
  };
  const workflows = await call("list_mix_workflows"); expect(workflows.some((w: { id: string }) => w.id === "vocal-eq")).toBe(true);
  expect((await call("get_mix_workflow", { workflowId: "vocal-eq" })).stoppingRules.length).toBeGreaterThan(0);
  const response = await context.request.post(`/api/music/audio/${id}/datasets/import-path`, { data: { path: source } }); expect(response.status()).toBe(202);
  const importing = await response.json(); await page.close();
  let job: { status: string; packageId: string };
  await expect.poll(async () => { job = await call("get_dataset_import", { importId: importing.id }); return job.status; }).toBe("succeeded");
  const packId = job!.packageId, pack = (await call("get_dataset_package", { packageId: packId })).package;
  expect(pack.coverage.some((c: { category: string; status: string }) => c.category === "native-session" && c.status === "preserved-opaque")).toBe(true);
  expect((await call("search_mix_examples")).noMatch).toBe(true);
  const audio = pack.assets.find((a: { audio: unknown }) => a.audio);
  const reviewed = await context.request.patch(`/api/music/audio/${id}/datasets/${packId}/review`, { data: { expectedRevision: null, review: { reviewer: "e2e data-fidelity reviewer", assets: [{ assetId: audio.id, song: "Song", version: "Version", recordingFamily: "e2e-source-family", role: "raw-vocal", stage: "dry export", masteringStatus: "unknown", timeOriginSeconds: null, permissions: { ...PRIVATE_USE, retrievalDisplay: true } }], pairs: [], notes: ["Synthetic integration data, not musical quality evidence."] } } }); expect(reviewed.ok()).toBe(true);
  const review = await reviewed.json();
  const profile = await context.request.post(`/api/music/audio/${id}/datasets/${packId}/profile`, { data: { name: "Engineer", expectedRevision: review.revision } }); expect(profile.status()).toBe(201);
  const examples = await call("search_mix_examples", { role: "raw-vocal", limit: 3 }); expect(examples.results).toHaveLength(1); expect(examples.results[0].eligibility.executableProposal).toBe(false);
  const detail = await call("get_mix_example", { exampleId: examples.results[0].example.id }); expect(detail.sourceLinks).toHaveLength(1);
  expect((await context.request.get(detail.sourceLinks[0].url)).ok()).toBe(true);
  const profiles = await call("list_engineer_profiles"); expect(profiles).toHaveLength(1);
  expect((await call("get_engineer_profile", { profileId: profiles[0].id })).tendencies[0].exampleIds).toContain(detail.example.id);
  const excerpt = await call("register_dataset_audio", { packageId: packId, assetId: audio.id, startSeconds: .1, endSeconds: .8 }); expect(excerpt.artifact.derivedFrom).toMatch(/^art_/);
  const other = await (await context.request.post("/api/projects", { data: { suite: "music", name: "Other dataset project" } })).json();
  const denied = await context.request.post(mcpUrl.replace(id, other.id), { data: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_mix_example", arguments: { exampleId: detail.example.id } } } });
  expect((await denied.json()).result.isError).toBe(true);
});

/** Captures the live document through the bridge; subsequent tools are server-owned. */
test("audio jobs and reports remain available after the editor tab closes", async ({ page, context }) => {
  const response = await page.request.post("/api/projects", { data: { suite: "music", name: "Audio evidence" } });
  const { id } = await response.json();
  await page.goto(`/p/${id}`);
  await expect(page.locator('[data-suite="music"]')).toBeVisible();
  const mcpUrl = `http://127.0.0.1:${process.env.E2E_SERVER_PORT || 5321}/mcp?chat=${id}`;
  const call = async (name: string, args: object = {}) => {
    const res = await context.request.post(mcpUrl, { data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } });
    const body = await res.json();
    expect(body.error).toBeUndefined();
    expect(body.result.isError, JSON.stringify(body.result)).not.toBe(true);
    return JSON.parse(body.result.content.find((c: { type: string }) => c.type === "text").text);
  };
  // The capture must use the chat's live song, even before an autosave finishes.
  const capture = await call("capture_audio_snapshot");
  expect(capture.projectId).toBe(id);
  expect(capture.capture.origin).toBe("live-document");
  const render = await call("render_audio_passage", { snapshotId: capture.id, startTick: 0, endTick: 192, tailSeconds: 0 });
  expect(["queued", "running"]).toContain(render.status);
  await page.close();
  let rendered: { status: string; result: { artifactIds: string[] } };
  await expect.poll(async () => {
    rendered = await call("get_audio_job", { jobId: render.id });
    return rendered.status;
  }).toBe("succeeded");
  const analysis = await call("analyse_audio_artifact", { artifactId: rendered!.result.artifactIds[0] });
  let measured: { status: string; result: { evidenceIds: string[] } };
  await expect.poll(async () => {
    measured = await call("get_audio_job", { jobId: analysis.id });
    return measured.status;
  }).toBe("succeeded");
  const report = await call("get_audio_report", { reportId: measured!.result.evidenceIds[0] });
  expect(report.snapshotId).toBe(capture.id);
  expect(report.measurements.some((m: { name: string }) => m.name === "rmsDbfs")).toBe(true);
  expect(report.observations).toEqual([]);
  expect(report.coverage.unavailable).toContain("hosted perception");
  // A different project's chat must not be able to read the job.
  const other = await context.request.post("/api/projects", { data: { suite: "music", name: "Other" } });
  const otherId = (await other.json()).id;
  const scoped = await context.request.post(mcpUrl.replace(id, otherId), { data: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_audio_job", arguments: { jobId: render.id } } } });
  expect((await scoped.json()).result.isError).toBe(true);
});


test("hosted listening permission is explicit, persists, and belongs to one song", async ({ page }) => {
  const create = async (name: string) => (await (await page.request.post("/api/projects", { data: { suite: "music", name } })).json()).id as string;
  const id = await create("Listening permission");
  await page.goto(`/p/${id}`);
  await expect(page.locator('[data-suite="music"]')).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Comma");
  const settings = page.getByRole("region", { name: "Settings" });
  const toggle = settings.getByRole("switch", { name: "Allow Gemini audio analysis for this song" });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(async () => (await (await page.request.get(`/api/music/audio/${id}/hearing`)).json()).settings.enabled).toBe(true);
  await page.reload();
  await expect(page.locator('[data-suite="music"]')).toBeVisible();
  if (!(await settings.isVisible())) await page.keyboard.press("ControlOrMeta+Comma");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  const other = await create("Private song");
  expect((await (await page.request.get(`/api/music/audio/${other}/hearing`)).json()).settings.enabled).toBe(false);
  const invalid = await page.request.patch(`/api/music/audio/${id}/hearing`, { data: { enabled: "yes" } });
  expect(invalid.status()).toBe(400);
});

test("the vocal is measured against the beat, alternatives proposed from it render without edits, apply as one undo step, and refuse stale comparisons", async ({ page, context }) => {
  // Ten renders through the stand-in engine's queue, about a second and a half each.
  test.setTimeout(120000);
  const source = path.resolve("e2e/.data/vocal-comparison.wav");
  await writeWav(source, Float32Array.from({ length: 48000 * 40 }, (_, i) => .2 * Math.sin(i * 2 * Math.PI * 1000 / 48000)), 48000);
  const project = await (await page.request.post("/api/projects", { data: { suite: "music", name: "Vocal comparison" } })).json();
  const media = await (await page.request.post("/api/media/import-file", { data: { projectId: project.id, path: source } })).json();
  let song = addAudioClips(addMixerTracks(createMusicProject("Vocal comparison", 120), null, 1, ["insert_vocal"]),
    [{ channelId: "chan_vocal", name: "Vocal", sampleId: media.id, seconds: 40 }], { start: 0, track: 0 }).song;
  song = { ...song, channels: song.channels.map(c => c.id === "chan_vocal" ? { ...c, mixerTrack: "insert_vocal" } : c) };
  song = updateMixerTrack(song, "insert_vocal", { name: "Vocal" });
  expect((await page.request.put(`/api/projects/${project.id}`, { data: song })).ok()).toBe(true);
  await page.goto(`/p/${project.id}`);
  await page.getByRole("button", { name: "Vocal mix comparison", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Vocal mix comparison" });
  await expect(dialog.getByLabel("Vocal mixer insert")).toHaveValue("insert_vocal");
  await dialog.getByRole("button", { name: "Measure and render alternatives", exact: true }).click();
  await expect(dialog.getByText("Both passages are ready to compare.")).toBeVisible({ timeout: 60000 });
  // The stand-in engine's vocal stem and beat are the same tone: 0 LU apart, so a "balanced" vocal comes down 3 dB.
  await expect(dialog.getByLabel("What the measurements found")).toContainText("The vocal sits 0.0 LU over the beat");
  const saved = async () => (await (await page.request.get(`/api/projects/${project.id}`)).json());
  expect((await saved()).mixer.tracks.find((t: { id: string }) => t.id === "insert_vocal").effects.filter(Boolean)).toHaveLength(0);
  await dialog.getByRole("button", { name: "Level + tone & dynamics", exact: true }).click();
  await expect(dialog.getByText(/^Vocal against the beat .*: 0\.0 → -3\.0 LU$/)).toBeVisible();
  await expect(dialog.locator("audio")).toHaveAttribute("src", /\/artifacts\/art_.*\/audio$/);
  await dialog.getByRole("button", { name: "Passage 2", exact: true }).click();
  await dialog.getByRole("button", { name: "Apply selected alternative", exact: true }).click();
  await expect(dialog.getByText("Applied as one undo step. Use Undo to restore the previous mix.")).toBeVisible();
  await expect.poll(async () => (await saved()).mixer.tracks.find((t: { id: string }) => t.id === "insert_vocal").effects.filter(Boolean).length).toBe(1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => (await saved()).mixer.tracks.find((t: { id: string }) => t.id === "insert_vocal").effects.filter(Boolean).length).toBe(0);
  await page.getByRole("button", { name: "Vocal mix comparison", exact: true }).click();
  await dialog.getByRole("button", { name: "Vocal level", exact: true }).click();
  const mcpUrl = `http://127.0.0.1:${process.env.E2E_SERVER_PORT || 5321}/mcp?chat=${project.id}`;
  const changed = await context.request.post(mcpUrl, { data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "update_song", arguments: { tempo: 130 } } } });
  expect((await changed.json()).result.isError).not.toBe(true);
  await expect(dialog.getByText("The song changed. Start a fresh comparison before applying.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply selected alternative", exact: true })).toBeDisabled();
});
