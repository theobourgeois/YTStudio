import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  directory: "",
  packaged: false,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  paths: [] as string[],
  setIcon: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => mock.directory, getAppPath: () => "/packaged/app", get isPackaged() { return mock.packaged; }, dock: { setIcon: mock.setIcon } },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => mock.handlers.set(channel, handler) },
  nativeImage: { createFromPath: (file: string) => { mock.paths.push(file); return { isEmpty: () => false }; } },
}));

beforeEach(() => {
  vi.resetModules();
  mock.directory = mkdtempSync(path.join(os.tmpdir(), "vaudio-icon-test-"));
  mock.handlers.clear();
  mock.paths = [];
  mock.packaged = false;
});
afterEach(() => rmSync(mock.directory, { recursive: true, force: true }));

describe("desktop app icons", () => {
  it("persists an icon and restores it before the page loads", async () => {
    const { initializeAppIcon } = await import("./app-icon");
    initializeAppIcon();
    mock.handlers.get("app-icon-set")!(null, "evergreen");
    expect(JSON.parse(readFileSync(path.join(mock.directory, "app-icon.json"), "utf8"))).toBe("evergreen");
    vi.resetModules();
    (await import("./app-icon")).initializeAppIcon();
    expect(mock.handlers.get("app-icon-get")!()).toBe("evergreen");
    expect(mock.paths.at(-1)).toContain(path.join("app-icons", "evergreen.png"));
  });

  it("rejects arbitrary paths without changing the selected icon", async () => {
    (await import("./app-icon")).initializeAppIcon();
    expect(() => mock.handlers.get("app-icon-set")!(null, "../../file")).toThrow("Unknown app icon");
    expect(mock.handlers.get("app-icon-get")!()).toBe("original");
  });

  it("loads packaged assets and falls back from an invalid saved choice", async () => {
    mock.packaged = true;
    writeFileSync(path.join(mock.directory, "app-icon.json"), '"removed-icon"');
    (await import("./app-icon")).initializeAppIcon();
    expect(mock.paths.at(-1)).toBe(path.join("/packaged/app", "dist", "app-icons", "original.png"));
  });

  it("takes Windows' copies on Windows", async () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      (await import("./app-icon")).initializeAppIcon("music");
      expect(mock.paths.at(-1)).toContain(path.join("app-icons", "win", "apps", "music.png"));
    } finally {
      platform.mockRestore();
    }
  });

  it("starts one of the apps on its own icon, and YTStudio's own choice on YTStudio's", async () => {
    (await import("./app-icon")).initializeAppIcon("visualizer");
    expect(mock.handlers.get("app-icon-get")!()).toBe("app");
    expect(mock.paths.at(-1)).toContain(path.join("app-icons", "apps", "visualizer.png"));
    mock.handlers.get("app-icon-set")!(null, "midnight");
    expect(mock.paths.at(-1)).toContain(path.join("app-icons", "midnight.png"));
    vi.resetModules();
    mock.handlers.clear();
    rmSync(path.join(mock.directory, "app-icon.json"));
    (await import("./app-icon")).initializeAppIcon(null);
    expect(mock.handlers.get("app-icon-get")!()).toBe("original");
  });
});
