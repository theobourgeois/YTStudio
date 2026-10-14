import { describe, expect, it, vi } from "vitest";
import { normalizeNowPlayingCommand, positionAt } from "../shared/now-playing.ts";
import { NowPlaying, spotifyPlayer, spotifyStatus, standInPlayer } from "./now-playing.ts";

const SONG = {
  running: true,
  state: "playing",
  position: 12.5,
  volume: 64,
  shuffling: true,
  repeating: false,
  track: {
    id: "spotify:track:abc",
    name: "Song",
    artist: "Band",
    album: "Record",
    duration: 201_000,
    artwork: "https://i.scdn.co/image/xyz",
    url: "spotify:track:abc",
  },
};

describe("Spotify's answer", () => {
  it("reads a song, its length in seconds (Spotify gives milliseconds)", () => {
    const status = spotifyStatus(JSON.stringify(SONG), 1000);
    expect(status).toMatchObject({ player: "Spotify", unavailable: null, state: "playing", position: 12.5, at: 1000, volume: 64, shuffling: true });
    expect(status.track).toMatchObject({ id: "spotify:track:abc", name: "Song", artist: "Band", duration: 201, artwork: "https://i.scdn.co/image/xyz", url: "https://open.spotify.com/track/abc" });
  });

  it("says when Spotify isn't open", () => {
    expect(spotifyStatus(JSON.stringify({ running: false }), 5)).toMatchObject({ unavailable: "not-running", track: null, at: 5 });
  });

  it("is stopped without a song, and keeps only web links", () => {
    expect(spotifyStatus(JSON.stringify({ ...SONG, track: null }), 0)).toMatchObject({ state: "stopped", track: null });
    const odd = spotifyStatus(JSON.stringify({ ...SONG, track: { ...SONG.track, artwork: "file:///etc/passwd", duration: 180 } }), 0);
    expect(odd.track).toMatchObject({ artwork: null, duration: 180 });
  });

  it("turns macOS saying no into a message, without throwing", async () => {
    const player = spotifyPlayer(async () => {
      throw new Error("execution error: Error: Not authorized to send Apple events to Spotify. (-1743)");
    });
    const status = await player.read();
    expect(status.unavailable).toBe("not-allowed");
    expect(status.message).toContain("Automation");
  });

  it("passes the action and its value to the script", async () => {
    const exec = vi.fn(async (_args: string[], _signal: AbortSignal) => "");
    await spotifyPlayer(exec).command({ action: "seek", position: 42 });
    expect(exec.mock.calls[0]?.[0].slice(-2)).toEqual(["seek", "42"]);
  });
});

describe("NowPlaying", () => {
  it("shares one answer between requests close together", async () => {
    const read = vi.fn(async () => spotifyStatus(JSON.stringify(SONG), Date.now()));
    const service = new NowPlaying({ name: "Spotify", read, command: async () => {} });
    await Promise.all([service.status(), service.status(), service.status()]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("refuses what isn't a command, and asks again after one", async () => {
    const read = vi.fn(async () => spotifyStatus(JSON.stringify(SONG), Date.now()));
    const command = vi.fn(async () => {});
    const service = new NowPlaying({ name: "Spotify", read, command });
    await service.status();
    await expect(service.command({ action: "dance" })).rejects.toMatchObject({ status: 400 });
    await service.command({ action: "next" });
    expect(command).toHaveBeenCalledWith({ action: "next" });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("has nothing to show on a computer without a player", async () => {
    expect((await new NowPlaying(null).status()).unavailable).toBe("unsupported");
  });
});

describe("the stand-in", () => {
  it("plays, pauses, skips and moves on when a song ends", async () => {
    let now = 0;
    const player = standInPlayer(() => now);
    // Not open until it's told to play.
    expect((await player.read()).unavailable).toBe("not-running");
    await player.command({ action: "play" });
    const first = await player.read();
    expect(first).toMatchObject({ state: "playing", demo: true });
    now += 10_000;
    expect((await player.read()).position).toBeCloseTo(first.position + 10);
    await player.command({ action: "pause" });
    now += 10_000;
    expect((await player.read()).position).toBeCloseTo(first.position + 10);
    await player.command({ action: "next" });
    const second = await player.read();
    expect(second.track?.id).not.toBe(first.track?.id);
    expect(second.position).toBe(0);
    await player.command({ action: "play" });
    now += (second.track!.duration + 1) * 1000;
    expect((await player.read()).track?.id).not.toBe(second.track?.id);
  });
});

describe("commands and positions", () => {
  it("normalises commands", () => {
    expect(normalizeNowPlayingCommand({ action: "toggle" })).toEqual({ action: "toggle" });
    expect(normalizeNowPlayingCommand({ action: "volume", volume: 140 })).toEqual({ action: "volume", volume: 100 });
    expect(normalizeNowPlayingCommand({ action: "seek", position: "1" })).toBeNull();
    expect(normalizeNowPlayingCommand(null)).toBeNull();
  });

  it("moves on while playing, up to the song's end", () => {
    const track = { id: "a", name: "", artist: "", album: "", duration: 100, artwork: null, url: null };
    expect(positionAt({ state: "playing", position: 10, at: 0, track }, 5000)).toBe(15);
    expect(positionAt({ state: "paused", position: 10, at: 0, track }, 5000)).toBe(10);
    expect(positionAt({ state: "playing", position: 99, at: 0, track }, 5000)).toBe(100);
  });
});
