/**
 * Now Playing (docs/now-playing.md): what the computer's music player (Spotify, on a Mac) is playing, shown at the
 * top of the window and drawn full screen by the visualizer. The server asks the player (AppleScript, so no account
 * or developer key); the tab listens to the sound itself (`src/lib/live-audio.ts`). Pure.
 */

export type PlayerState = "playing" | "paused" | "stopped";

export interface NowPlayingTrack {
  /** The player's own id ("spotify:track:…"): a new one is a new song. */
  id: string;
  name: string;
  artist: string;
  album: string;
  /** Seconds. */
  duration: number;
  /** The cover, as the player gives it (Spotify's are served with CORS, so canvases can read them), or null. */
  artwork: string | null;
  /** The song in the player (open.spotify.com), or null. */
  url: string | null;
}

/**
 * Why there's nothing to show: turned off in Settings (`off`), a computer whose player can't be asked
 * (`unsupported`), the player isn't open (`not-running`), macOS said no (`not-allowed`, Privacy › Automation),
 * or asking it failed (`error`).
 */
export type NowPlayingUnavailable = "off" | "unsupported" | "not-running" | "not-allowed" | "error";

export interface NowPlayingStatus {
  /** Which player this is about ("Spotify"). */
  player: string;
  /** Null when the player answered, else why it didn't. */
  unavailable: NowPlayingUnavailable | null;
  /** What to tell the user about `not-allowed` or `error`. */
  message?: string;
  state: PlayerState;
  track: NowPlayingTrack | null;
  /** Seconds into the track when the player was asked (`at`). */
  position: number;
  /** When it was asked (ms since the epoch: the server and the tab share the computer's clock). */
  at: number;
  /** 0..100. */
  volume: number;
  shuffling: boolean;
  repeating: boolean;
  /** A made-up player (tests, `EDITOR_NOW_PLAYING=stand-in`): there's no sound to listen to, so the tab makes some. */
  demo?: true;
}

export type NowPlayingCommand =
  | { action: "play" | "pause" | "toggle" | "next" | "previous" }
  | { action: "seek"; position: number }
  | { action: "volume"; volume: number };

const SIMPLE = new Set(["play", "pause", "toggle", "next", "previous"]);

/** A command from an untrusted body, or null if it isn't one. */
export function normalizeNowPlayingCommand(raw: unknown): NowPlayingCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const { action, position, volume } = raw as Record<string, unknown>;
  if (typeof action !== "string") return null;
  if (SIMPLE.has(action)) return { action: action as "play" };
  if (action === "seek" && typeof position === "number" && Number.isFinite(position)) return { action, position: Math.max(0, position) };
  if (action === "volume" && typeof volume === "number" && Number.isFinite(volume)) return { action, volume: Math.round(Math.min(100, Math.max(0, volume))) };
  return null;
}

/** Nothing to show, and why. */
export function unavailableStatus(player: string, unavailable: NowPlayingUnavailable, message?: string): NowPlayingStatus {
  return { player, unavailable, ...(message && { message }), state: "stopped", track: null, position: 0, at: Date.now(), volume: 0, shuffling: false, repeating: false };
}

/** Where the song is at `now` (ms since the epoch): moving on from where it was asked while it plays. */
export function positionAt(status: Pick<NowPlayingStatus, "state" | "position" | "at" | "track">, now: number): number {
  const moved = status.state === "playing" ? Math.max(0, now - status.at) / 1000 : 0;
  const position = status.position + moved;
  return status.track ? Math.min(Math.max(0, position), status.track.duration) : Math.max(0, position);
}
