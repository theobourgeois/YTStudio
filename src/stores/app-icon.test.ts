// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  delete window.editorDesktopInfo;
  document.head.innerHTML = '<link rel="icon" href="/favicon.png">';
});

describe("app icon preference", () => {
  it("changes the favicon and restores the browser selection on reload", async () => {
    const { useAppIcon } = await import("./app-icon");
    await useAppIcon.getState().init();
    await useAppIcon.getState().setIcon("saffron");
    expect(document.querySelector("link")?.getAttribute("href")).toBe("/app-icons/saffron.png");
    vi.resetModules();
    const reloaded = await import("./app-icon");
    await reloaded.useAppIcon.getState().init();
    expect(reloaded.useAppIcon.getState().choice).toBe("saffron");
  });

  it("falls back to the original for an invalid stored value", async () => {
    localStorage.setItem("editor-app-icon", "../../other-file");
    const { useAppIcon } = await import("./app-icon");
    await useAppIcon.getState().init();
    expect(useAppIcon.getState().choice).toBe("original");
  });

  it("uses the desktop preference and keeps it selected when an update fails", async () => {
    localStorage.setItem("editor-app-icon", "saffron");
    const set = vi.fn().mockRejectedValue(new Error("Can't save"));
    window.editorDesktopInfo = { platform: "darwin", appIcon: { get: async () => "midnight", set } };
    const { useAppIcon } = await import("./app-icon");
    await useAppIcon.getState().init();
    expect(useAppIcon.getState().choice).toBe("midnight");
    await useAppIcon.getState().setIcon("banner-red");
    expect(set).toHaveBeenCalledWith("banner-red");
    expect(useAppIcon.getState().choice).toBe("midnight");
    expect(document.querySelector("link")?.getAttribute("href")).toBe("/app-icons/midnight.png");
    expect(useAppIcon.getState().error).toBeTruthy();
    expect(useAppIcon.getState().busy).toBe(false);
  });
});
