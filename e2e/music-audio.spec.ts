import { expect, test } from "@playwright/test";

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
