/**
 * Now Playing (docs/now-playing.md): asks the computer's music player what it's playing, and tells it to play,
 * pause, skip or seek. Spotify on a Mac answers AppleScript (JavaScript for Automation), so nothing needs an
 * account, a key or Premium: macOS asks the user once to let the app control Spotify (Privacy › Automation).
 * A stand-in player (`EDITOR_NOW_PLAYING=stand-in`) stands in for it in tests.
 */
import { errorMessage } from "../shared/errors.ts";
import {
  type NowPlayingCommand,
  type NowPlayingStatus,
  type NowPlayingTrack,
  type NowPlayingUnavailable,
  type PlayerState,
  normalizeNowPlayingCommand,
  positionAt,
  unavailableStatus,
} from "../shared/now-playing.ts";
import { log } from "./log.ts";
import { run } from "./process.ts";
import { HttpError } from "./storage.ts";

const logger = log("now-playing");

/** A music player the app can ask and tell. */
export interface Player {
  /** Its name, as the tab shows it ("Spotify"). */
  readonly name: string;
  read(): Promise<NowPlayingStatus>;
  command(command: NowPlayingCommand): Promise<void>;
}

/** How long one answer serves every tab asking (they poll about once a second). */
const FRESH_MS = 400;
/** A player that doesn't answer in this long (macOS's question still up, a hung player) is given up on. */
const READ_TIMEOUT_MS = 30_000;

export class NowPlaying {
  private cached: { at: number; status: Promise<NowPlayingStatus> } | null = null;
  private lastProblem: NowPlayingUnavailable | null = null;

  constructor(private readonly player: Player | null) {}

  /** What's playing (one answer shared by requests within `FRESH_MS`). */
  status(): Promise<NowPlayingStatus> {
    const player = this.player;
    if (!player) return Promise.resolve(unavailableStatus("Spotify", "unsupported"));
    const now = Date.now();
    if (this.cached && now - this.cached.at < FRESH_MS) return this.cached.status;
    const status = player
      .read()
      .catch((err: unknown) => unavailableStatus(player.name, "error", errorMessage(err)))
      .then((s) => this.note(s));
    this.cached = { at: now, status };
    return status;
  }

  /** Play, pause, skip, seek or set the volume; then what's playing. */
  async command(raw: unknown): Promise<NowPlayingStatus> {
    const command = normalizeNowPlayingCommand(raw);
    if (!command) throw new HttpError(400, 'Expected { action: "play" | "pause" | "toggle" | "next" | "previous" }, { action: "seek", position } or { action: "volume", volume }.');
    if (!this.player) throw new HttpError(503, "There's no music player to control on this computer.");
    await this.player.command(command);
    this.cached = null;
    return this.status();
  }

  /** Logs a problem once when it starts (not on every poll). */
  private note(status: NowPlayingStatus): NowPlayingStatus {
    const problem = status.unavailable === "error" || status.unavailable === "not-allowed" ? status.unavailable : null;
    if (problem && problem !== this.lastProblem) logger.warn(`${status.player} didn't answer: ${status.message ?? problem}`);
    this.lastProblem = problem;
    return status;
  }
}

// ---------------------------------------------------------------------------
// Spotify, on a Mac
// ---------------------------------------------------------------------------

/** Reads Spotify without starting it (`running()` doesn't). */
const SPOTIFY_READ = `
function run() {
  var app = Application("Spotify");
  if (!app.running()) return JSON.stringify({ running: false });
  var out = { running: true, state: String(app.playerState()), position: app.playerPosition(), volume: app.soundVolume(), shuffling: app.shuffling(), repeating: app.repeating(), track: null };
  try {
    var t = app.currentTrack;
    var id = t.id();
    if (id) out.track = { id: id, name: t.name(), artist: t.artist(), album: t.album(), duration: t.duration(), artwork: t.artworkUrl(), url: t.spotifyUrl() };
  } catch (e) {}
  return JSON.stringify(out);
}`;

/** Tells Spotify what to do (`argv`: the action and its number), only while it's open. */
const SPOTIFY_COMMAND = `
function run(argv) {
  var app = Application("Spotify");
  if (!app.running()) return;
  var a = argv[0];
  if (a === "play") app.play();
  else if (a === "pause") app.pause();
  else if (a === "toggle") app.playpause();
  else if (a === "next") app.nextTrack();
  else if (a === "previous") app.previousTrack();
  else if (a === "seek") app.playerPosition = Number(argv[1]);
  else if (a === "volume") app.soundVolume = Number(argv[1]);
}`;

const NOT_ALLOWED = "Allow YTStudio to control Spotify in System Settings › Privacy & Security › Automation.";

type Osascript = (args: string[], signal: AbortSignal) => Promise<string>;
const osascript: Osascript = (args, signal) => run("osascript", ["-l", "JavaScript", ...args], { signal });

/** A song's link on the web: Spotify gives `spotify:track:<id>`. */
function webLink(url: string): string | null {
  const id = /^spotify:track:([A-Za-z0-9]+)$/.exec(url)?.[1];
  if (id) return `https://open.spotify.com/track/${id}`;
  return /^https:\/\//.test(url) ? url : null;
}

/** Spotify's answer (`SPOTIFY_READ`'s JSON), asked at `at`. */
export function spotifyStatus(json: string, at: number): NowPlayingStatus {
  const raw = JSON.parse(json) as Record<string, unknown>;
  if (!raw.running) return { ...unavailableStatus("Spotify", "not-running"), at };
  const state: PlayerState = raw.state === "playing" || raw.state === "paused" ? raw.state : "stopped";
  const t = raw.track as Record<string, unknown> | null;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  // Spotify says seconds, but gives milliseconds (no song is 10 000 seconds long; none is 10 seconds either).
  const duration = num(t?.duration) >= 10_000 ? num(t?.duration) / 1000 : num(t?.duration);
  const track: NowPlayingTrack | null = t && text(t.id)
    ? {
        id: text(t.id),
        name: text(t.name) || "Untitled",
        artist: text(t.artist),
        album: text(t.album),
        duration,
        artwork: /^https:\/\//.test(text(t.artwork)) ? text(t.artwork) : null,
        url: webLink(text(t.url)),
      }
    : null;
  return {
    player: "Spotify",
    unavailable: null,
    state: track ? state : "stopped",
    track,
    position: Math.max(0, num(raw.position)),
    at,
    volume: num(raw.volume),
    shuffling: raw.shuffling === true,
    repeating: raw.repeating === true,
  };
}

/** Why asking failed, from osascript's message. */
function spotifyProblem(message: string): NowPlayingStatus {
  if (/-1743|not authori[sz]ed/i.test(message)) return unavailableStatus("Spotify", "not-allowed", NOT_ALLOWED);
  if (/-2700|-10814|can.t be found|can.t find/i.test(message)) return unavailableStatus("Spotify", "not-running", "Spotify isn't installed.");
  return unavailableStatus("Spotify", "error", message);
}

/** Spotify's desktop app, asked through osascript (`exec` stands in for it in tests). */
export function spotifyPlayer(exec: Osascript = osascript): Player {
  return {
    name: "Spotify",
    async read() {
      const at = Date.now();
      try {
        return spotifyStatus(await exec(["-e", SPOTIFY_READ], AbortSignal.timeout(READ_TIMEOUT_MS)), at);
      } catch (err) {
        return spotifyProblem(errorMessage(err));
      }
    },
    async command(command) {
      const value = command.action === "seek" ? command.position : command.action === "volume" ? command.volume : 0;
      try {
        await exec(["-e", SPOTIFY_COMMAND, command.action, String(value)], AbortSignal.timeout(READ_TIMEOUT_MS));
      } catch (err) {
        const problem = spotifyProblem(errorMessage(err));
        throw new HttpError(problem.unavailable === "not-allowed" ? 403 : 502, problem.message ?? "Spotify didn't answer.");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The stand-in (tests)
// ---------------------------------------------------------------------------

const STAND_IN_TRACKS: (Omit<NowPlayingTrack, "artwork" | "url"> & { colours: [string, string, string] })[] = [
  { id: "stand-in:track:1", name: "Midnight Drive", artist: "Neon Avenue", album: "Night Shift", duration: 214, colours: ["#ff3d9a", "#5b21b6", "#0b0420"] },
  { id: "stand-in:track:2", name: "Golden Hour", artist: "Sol Rae", album: "Daybreak", duration: 187, colours: ["#ffb22e", "#ff5a1f", "#2a0d05"] },
  { id: "stand-in:track:3", name: "Deep Blue", artist: "Tidal", album: "Undertow", duration: 241, colours: ["#22d3ee", "#1e3a8a", "#020617"] },
];

/** A made-up cover: a glow over a gradient, in the track's colours. */
function standInArtwork([a, b, c]: [string, string, string]): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient><radialGradient id="r"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="190" cy="120" r="110" fill="url(#r)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** A player that plays made-up songs (a clock, no sound): the tab makes up their sound (`NowPlayingStatus.demo`). */
export function standInPlayer(now: () => number = Date.now): Player {
  let index = 0;
  let playing = true;
  // Where the song was at `since`.
  let position = 30;
  let since = now();
  const trackAt = (i: number): NowPlayingTrack => {
    const { colours, ...track } = STAND_IN_TRACKS[i];
    return { ...track, artwork: standInArtwork(colours), url: null };
  };
  const status = (): NowPlayingStatus => {
    const at = now();
    // Songs end and the next one starts, as in a player.
    let p = positionAt({ state: playing ? "playing" : "paused", position, at: since, track: null }, at);
    while (p >= STAND_IN_TRACKS[index].duration) {
      p -= STAND_IN_TRACKS[index].duration;
      index = (index + 1) % STAND_IN_TRACKS.length;
    }
    position = p;
    since = at;
    return { player: "Stand-in", unavailable: null, state: playing ? "playing" : "paused", track: trackAt(index), position: p, at, volume: 70, shuffling: false, repeating: false, demo: true };
  };
  return {
    name: "Stand-in",
    read: async () => status(),
    async command(command) {
      status();
      if (command.action === "play") playing = true;
      else if (command.action === "pause") playing = false;
      else if (command.action === "toggle") playing = !playing;
      else if (command.action === "next" || command.action === "previous") {
        const step = command.action === "next" ? 1 : STAND_IN_TRACKS.length - 1;
        index = (index + step) % STAND_IN_TRACKS.length;
        position = 0;
      } else if (command.action === "seek") position = Math.min(command.position, STAND_IN_TRACKS[index].duration - 0.5);
    },
  };
}

/** The player this computer has: Spotify on a Mac (else none), or the stand-in. */
export function defaultPlayer(setting: string | null): Player | null {
  if (setting === "stand-in") return standInPlayer();
  if (setting === "off") return null;
  return process.platform === "darwin" ? spotifyPlayer() : null;
}
