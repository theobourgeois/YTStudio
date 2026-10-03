/** Real macOS clicks from a native plugin back to each music window. Run after build:desktop. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

if (process.platform !== "darwin") throw new Error("This native window test requires macOS");
const root = path.resolve(import.meta.dirname, "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "vaudio-focus-"));
const probe = path.join(tmp, "probe");
execFileSync("swiftc", [path.join(import.meta.dirname, "native-window-probe.swift"), "-o", probe]);
const native = (...args: string[]) => execFileSync(probe, args, { encoding: "utf8" });
type NativeWindow = { kCGWindowOwnerPID: number; kCGWindowLayer: number; kCGWindowNumber: number; kCGWindowBounds: { X: number; Y: number; Width: number; Height: number } };
const state = (...pids: number[]) => JSON.parse(native("windows", ...pids.map(String))) as { front: number; trusted: boolean; windows: NativeWindow[] };
assert(state().trusted, "Accessibility access is required for native clicks");
const env: NodeJS.ProcessEnv = { ...process.env, EDITOR_DATA_DIR: path.join(tmp, "data"), EDITOR_USER_DATA_DIR: path.join(tmp, "profile") };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.join(root, `release/mac-${process.arch}/Vaudio.app/Contents/MacOS/Vaudio`), ["--remote-debugging-port=0"], { env, stdio: ["ignore", "ignore", "pipe"] });
const endpoint = await new Promise<string>((resolve, reject) => {
  let stderr = "";
  const timeout = setTimeout(() => reject(new Error("No desktop DevTools endpoint")), 30000);
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
    const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) { clearTimeout(timeout); resolve(match[1]); }
  });
  child.once("exit", () => { clearTimeout(timeout); reject(new Error(stderr)); });
});
const browser = await chromium.connectOverCDP(endpoint);
try {
  for (let attempt = 0; attempt < 120 && browser.contexts()[0].pages().length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
  const page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => console.error("page error:", error.message));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
  await page.waitForLoadState("domcontentloaded");
  const base = new URL(page.url()).origin;
  const api = async (url: string, body?: unknown, method = "POST") => {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    assert(response.ok, `${url}: ${await response.clone().text()}`);
    return response.json();
  };
  await api("/api/engine/scan", {});
  for (let attempt = 0; attempt < 120; attempt++) {
    if (!(await api("/api/engine/status", {})).scanning) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const plugins = await api("/api/engine/plugins", undefined, "GET");
  const plugin = plugins.find((p: { name: string; isInstrument: boolean }) => p.isInstrument && p.name.includes("Serum")) ?? plugins.find((p: { name: string }) => p.name === "Vaudio Test Synth");
  assert(plugin, "Install Serum or build Vaudio Test Synth");
  const created = await api("/api/projects", { suite: "music", name: "Native window focus" });
  const song = await api(`/api/projects/${created.id}`, undefined, "GET");
  song.channels = [{ id: "chan_focus", name: plugin.name, kind: "plugin", plugin: { id: plugin.id, name: plugin.name, format: plugin.format } }];
  await api(`/api/projects/${created.id}`, song, "PUT");
  await page.goto(base);
  await page.getByRole("button", { name: /Native window focus/ }).click();
  await page.locator("[data-window=rack]").waitFor().catch(async (error) => {
    console.error("page:", page.url(), await page.locator("body").innerText());
    throw error;
  });
  for (const [id, label] of [["rack", "Channel rack"], ["playlist", "Playlist"], ["piano", "Piano roll"], ["mixer", "Mixer"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const surface = page.locator(`[data-window="${id}"]`);
    await surface.waitFor();
    const title = (await surface.locator("header h2").boundingBox())!;
    const bounds = state(child.pid!).windows.find((w) => w.kCGWindowLayer === 0)!.kCGWindowBounds;
    const viewport = await page.evaluate(() => ({ height: innerHeight }));
    await api("/api/engine/channelEditor", { channel: "chan_focus", open: true });
    const processes = execFileSync("ps", ["-axo", "pid,command"], { encoding: "utf8" });
    const engine = processes.split("\n").find((line) => line.includes("Vaudio Engine --data " + path.join(tmp, "data")));
    assert(engine, "Native engine is running");
    const enginePid = Number(engine.trim().split(/\s+/)[0]);
    native("move", String(enginePid), String(bounds.X + 100), String(bounds.Y + 240));
    assert.equal(state(child.pid!, enginePid).front, enginePid, "Plugin has native focus before the click");
    native("click", String(bounds.X + title.x + title.width + 2), String(bounds.Y + bounds.Height - viewport.height + title.y + title.height / 2));
    let passed = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const after = state(child.pid!, enginePid);
      const hostIndex = after.windows.findIndex((w) => w.kCGWindowOwnerPID === child.pid);
      const pluginIndex = after.windows.findIndex((w) => w.kCGWindowOwnerPID === enginePid);
      const focus = await page.evaluate(() => document.activeElement?.closest<HTMLElement>("[data-window]")?.dataset.window);
      if (after.front === child.pid && hostIndex >= 0 && pluginIndex > hostIndex && focus === id) { passed = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!passed) console.error("native:", state(child.pid!, enginePid), "focus:", await page.evaluate(() => document.activeElement?.outerHTML.slice(0,400)), "hit:", await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.outerHTML.slice(0,300), { x: title.x + title.width + 2, y: title.y + title.height / 2 }));
    assert(passed, `One native click brings ${label} above ${plugin.name} and gives it keyboard focus`);
    console.log(`ok   native click brings ${label} above ${plugin.name}`);
  }
  await page.screenshot({ path: path.join(root, "music-window-smoke.png") });
} finally {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await browser.close();
  await exited;
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
