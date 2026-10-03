/**
 * Real macOS clicks between the music editor's windows and a native plugin's (docs/windows.md): the editor's
 * windows are windows of the system, stacked among the plugin's by use. Run after build:desktop.
 *
 *   pnpm build:desktop && pnpm test:desktop:music
 *
 * It needs Accessibility access (the clicks) and an unlocked screen, and Serum or the test synth
 * (`pnpm engine:build`).
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Page, chromium } from "playwright-core";

if (process.platform !== "darwin") throw new Error("This native window test requires macOS");
const root = path.resolve(import.meta.dirname, "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "vaudio-focus-"));
const probe = path.join(tmp, "probe");
execFileSync("swiftc", [path.join(import.meta.dirname, "native-window-probe.swift"), "-o", probe]);
const native = (...args: string[]) => execFileSync(probe, args, { encoding: "utf8" });
type NativeWindow = { kCGWindowOwnerPID: number; kCGWindowLayer: number; kCGWindowNumber: number; kCGWindowName?: string; kCGWindowBounds: { X: number; Y: number; Width: number; Height: number } };
const state = (...pids: number[]) => JSON.parse(native("windows", ...pids.map(String))) as { front: number; trusted: boolean; windows: NativeWindow[] };
assert(state().trusted, "Accessibility access is required for native clicks");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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
  for (let attempt = 0; attempt < 120 && browser.contexts()[0].pages().length === 0; attempt++) await sleep(100);
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
    await sleep(250);
  }
  const plugins = await api("/api/engine/plugins", undefined, "GET");
  const plugin = plugins.find((p: { name: string; isInstrument: boolean }) => p.isInstrument && p.name.includes("Serum")) ?? plugins.find((p: { name: string }) => p.name === "Vaudio Test Synth");
  assert(plugin, "Install Serum or build Vaudio Test Synth");
  const created = await api("/api/projects", { suite: "music", name: "Native window focus" });
  const song = await api(`/api/projects/${created.id}`, undefined, "GET");
  song.channels = [{ id: "chan_focus", name: plugin.name, kind: "plugin", plugin: { id: plugin.id, name: plugin.name, format: plugin.format } }];
  await api(`/api/projects/${created.id}`, song, "PUT");
  await page.goto(`${base}/p/${created.id}`);
  await page.bringToFront();

  // The editor's windows are windows of the system, one each (the playlist and the rack are open at first).
  const panel = async (title: string): Promise<Page> => {
    for (let attempt = 0; attempt < 100; attempt++) {
      for (const p of browser.contexts()[0].pages()) if (p.url() === "about:blank" && (await p.title().catch(() => "")) === title) return p;
      await sleep(100);
    }
    throw new Error(`No window "${title}"`);
  };
  const rackPage = await panel("Channel rack");
  const playlistPage = await panel("Playlist");
  await sleep(1500);

  await api("/api/engine/channelEditor", { channel: "chan_focus", open: true });
  const processes = execFileSync("ps", ["-axo", "pid,command"], { encoding: "utf8" });
  const engine = processes.split("\n").find((line) => line.includes("Vaudio Engine --data " + path.join(tmp, "data")));
  assert(engine, "Native engine is running");
  const enginePid = Number(engine.trim().split(/\s+/)[0]);
  await sleep(1500);

  // front to back, as letters: R the rack, L the Playlist, P the plugin, M the main window.
  const letter = (w: NativeWindow) => (w.kCGWindowOwnerPID === enginePid ? "P" : w.kCGWindowName === "Channel rack" ? "R" : w.kCGWindowName === "Playlist" ? "L" : w.kCGWindowName === "Mixer" ? "X" : w.kCGWindowName?.startsWith("Piano") ? "N" : w.kCGWindowName === "Menus" ? "-" : "M");
  const order = () => state(child.pid!, enginePid).windows.map(letter).join("");
  const rect = (l: string) => state(child.pid!, enginePid).windows.find((w) => letter(w) === l)!.kCGWindowBounds;
  const click = async (x: number, y: number) => { native("click", String(x), String(y)); await sleep(700); };

  // Lay them out so that a part of each is uncovered by the others: the Playlist low, the rack above it,
  // the plugin to the right of the rack and over the Playlist's top.
  await playlistPage.evaluate(() => { window.resizeTo(900, 500); window.moveTo(420, 330); });
  await rackPage.evaluate(() => window.moveTo(332, 200));
  await sleep(400);
  const R = rect("R");
  native("move", String(enginePid), String(R.X + R.Width + 4), String(R.Y + 60));
  await sleep(700);
  const spot = {
    R: () => ({ x: rect("R").X + 60, y: rect("R").Y + 30 }),
    P: () => ({ x: rect("P").X + 70, y: rect("P").Y + 12 }),
    L: () => ({ x: rect("L").X + 100, y: rect("L").Y + 400 }),
  };
  const use = async (l: "R" | "P" | "L") => { const p = spot[l](); await click(p.x, p.y); return order().replace("M", ""); };

  // One click on a window puts it in front of the others, wherever the rest were: the plugin stays
  // between the app's windows, and the main window (the toolbar, the stage) never covers any of them.
  assert.equal((await use("L")).slice(0, 1), "L");
  assert.equal((await use("P")).slice(0, 1), "P");
  assert.equal((await use("R")).slice(0, 3), "RPL", "the plugin sits between the rack and the Playlist");
  assert.equal((await use("L")).slice(0, 3), "LRP");
  assert.equal((await use("R")).slice(0, 3), "RLP");
  assert.equal((await use("P")).slice(0, 3), "PRL");
  assert.equal((await use("R")).slice(0, 3), "RPL");
  assert(order().endsWith("M"), "the main window is behind them all");
  console.log("ok   native clicks stack the rack, the Playlist and the plugin by use, the plugin between the editor's windows");

  // A click on the editor's own main window (its toolbar) doesn't bury them.
  const main = state(child.pid!).windows.find((w) => letter(w) === "M")!.kCGWindowBounds;
  await click(main.X + main.Width - 80, main.Y + 20);
  assert.equal(order().replace("M", "").slice(0, 3), "RPL", "a click on the main window leaves the windows as they are");
  assert(order().endsWith("M"));
  console.log("ok   a click on the main window leaves the windows as they were");

  // Keys go to the window clicked: a plugin's passes on Space, a panel's runs it.
  await use("R");
  assert(await rackPage.evaluate(() => document.hasFocus()), "the rack has the keyboard after a click on it");
  console.log("ok   the rack has the keyboard after a click");

  // Switching to another program and back keeps their order.
  execFileSync("osascript", ["-e", 'tell application "Finder" to activate']);
  await sleep(1500);
  execFileSync("osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${child.pid}) to true`]);
  await sleep(1500);
  assert.equal(order().replace("M", "").slice(0, 3), "RPL", "back in the order they were in");
  console.log("ok   the windows come back in the order they were in");

  // Opening one from the toolbar puts it in front, among the plugin's.
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  await panel("Mixer");
  await sleep(800);
  assert.equal(order().replace("M", "").slice(0, 1), "X", "a window opened from the toolbar is in front");
  console.log("ok   a window opened from the toolbar comes in front");

  // Closing a window with its × leaves the others where they were.
  const mixerPage = await panel("Mixer");
  await mixerPage.getByRole("button", { name: "Close Mixer" }).click();
  await sleep(800);
  assert(!order().includes("X"), "the mixer's window is gone");
  assert.equal(order().replace("M", "").slice(0, 3), "RPL");
  console.log("ok   closing a window leaves the others in order");
} finally {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await browser.close();
  await exited;
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
