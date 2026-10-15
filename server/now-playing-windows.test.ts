import { describe, expect, it } from "vitest";
import { imageType, windowsPlayer, windowsStatus } from "./now-playing-windows.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const song = { running: true, state: "Playing", title: "Midnight Drive", artist: "Neon Avenue", album: "Night Shift", position: 30, duration: 214, updated: 10_000, now: 12_000, shuffling: true, repeating: false, artHash: "0123456789abcdef" };

describe("Windows' answer", () => {
  it("reads a song, moving its position on from when Spotify last said", () => {
    const status = windowsStatus(JSON.stringify(song), 12_000);
    expect(status).toMatchObject({ player: "Spotify", unavailable: null, state: "playing", position: 32, shuffling: true, repeating: false });
    expect(status.track).toMatchObject({ name: "Midnight Drive", artist: "Neon Avenue", album: "Night Shift", duration: 214, artwork: "/api/now-playing/cover/0123456789abcdef", url: null });
    expect(status.track!.id).toMatch(/^windows:[0-9a-f]{16}$/);
  });

  it("keeps a paused song where it is, and the same song's id the same", () => {
    const paused = windowsStatus(JSON.stringify({ ...song, state: "Paused" }), 12_000);
    expect(paused).toMatchObject({ state: "paused", position: 30 });
    expect(paused.track!.id).toBe(windowsStatus(JSON.stringify(song), 0).track!.id);
    expect(windowsStatus(JSON.stringify({ ...song, title: "Golden Hour" }), 0).track!.id).not.toBe(paused.track!.id);
  });

  it("says when Spotify isn't open, has no song, or the helper failed", () => {
    expect(windowsStatus(JSON.stringify({ running: false }), 5)).toMatchObject({ unavailable: "not-running", at: 5 });
    expect(windowsStatus(JSON.stringify({ ...song, title: "" }), 0)).toMatchObject({ state: "stopped", track: null });
    expect(windowsStatus(JSON.stringify({ error: "Windows media controls did not answer" }), 0)).toMatchObject({ unavailable: "error", message: "Windows media controls did not answer" });
  });

  it("tells a cover's type by its first bytes", () => {
    expect(imageType(PNG)).toBe("image/png");
    expect(imageType(Buffer.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
  });
});

describe("the Windows player", () => {
  it("keeps the newest cover it was sent, for the tab to ask for by its hash", async () => {
    const answers = [{ ...song, art: PNG.toString("base64") }, song, { ...song, artHash: "fedcba9876543210", art: PNG.toString("base64") }];
    const player = windowsPlayer(async () => JSON.stringify(answers.shift()));
    await player.read();
    expect(player.cover("0123456789abcdef")).toEqual({ type: "image/png", data: PNG });
    await player.read();
    expect(player.cover("0123456789abcdef")).not.toBeNull();
    await player.read();
    expect(player.cover("0123456789abcdef")).toBeNull();
    expect(player.cover("fedcba9876543210")).not.toBeNull();
  });

  it("passes the action and its value, sets no volume, and turns a failure into a message", async () => {
    const asked: string[] = [];
    const player = windowsPlayer(async (line) => {
      asked.push(line);
      return line.startsWith("next") ? JSON.stringify({ error: "nope" }) : JSON.stringify({ ok: true });
    });
    await player.command({ action: "seek", position: 12.5 });
    await player.command({ action: "volume", volume: 40 });
    await expect(player.command({ action: "next" })).rejects.toThrow("nope");
    expect(asked).toEqual(["seek 12.5", "next 0"]);
    const broken = windowsPlayer(async () => {
      throw new Error("powershell.exe not found — is it installed?");
    });
    expect(await broken.read()).toMatchObject({ unavailable: "error", message: "powershell.exe not found — is it installed?" });
  });
});
