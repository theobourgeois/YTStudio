/**
 * Now Playing (docs/now-playing.md): asks the computer's music player what it's playing, and tells it to play,
 * pause, skip or seek. Spotify on a Mac answers AppleScript (JavaScript for Automation), so nothing needs an
 * account, a key or Premium: macOS asks the user once to let the app control Spotify (Privacy › Automation). On
 * Windows it's the system's media controls (`now-playing-windows.ts`).
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
import { windowsPlayer } from "./now-playing-windows.ts";
import { run } from "./process.ts";
import { HttpError } from "./storage.ts";

const logger = log("now-playing");

/** A music player the app can ask and tell. */
export interface Player {
  /** Its name, as the tab shows it ("Spotify"). */
  readonly name: string;
  read(): Promise<NowPlayingStatus>;
  command(command: NowPlayingCommand): Promise<void>;
  /** A cover the player hands over itself (Windows'), named by the status's `artwork` URL. */
  cover?(hash: string): { type: string; data: Buffer } | null;
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

  /** A cover the player handed over, or null if it isn't the newest one. */
  cover(hash: string): { type: string; data: Buffer } | null {
    return this.player?.cover?.(hash) ?? null;
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

/**
 * A made-up cover, in the track's colours, with what a real one has (shapes, edges, a title, grain), so the looks
 * that show or bend the cover are tried on something like one: a sky, a striped sun, hills, a grid to the horizon.
 */
function standInArtwork([a, b, c]: [string, string, string], title: string): string {
  // The sun's stripes, wider towards its foot (cut out of it).
  const stripes = [0, 1, 2, 3, 4].map((i) => `<rect x="60" y="${158 + i * 13}" width="180" height="${2 + i * 1.6}"/>`).join("");
  const across = [216, 226, 240, 258, 282].map((y) => `<line x1="0" y1="${y}" x2="300" y2="${y}"/>`).join("");
  const toward = [-300, -150, -50, 50, 150, 250, 350, 450, 600].map((x) => `<line x1="150" y1="208" x2="${x}" y2="300"/>`).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><defs>` +
    `<linearGradient id="sky" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="0.75" stop-color="${b}"/></linearGradient>` +
    `<linearGradient id="sun" x2="0" y2="1"><stop offset="0" stop-color="#fff1d0"/><stop offset="0.6" stop-color="${a}"/></linearGradient>` +
    `<mask id="cut"><rect width="300" height="300" fill="#fff"/><g fill="#000">${stripes}</g></mask>` +
    `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.14"/></feComponentTransfer></filter>` +
    `</defs><rect width="300" height="300" fill="url(#sky)"/>` +
    `<circle cx="150" cy="150" r="80" fill="url(#sun)" mask="url(#cut)"/>` +
    `<path d="M0 198 L38 166 L72 186 L112 138 L152 180 L188 154 L228 188 L262 162 L300 182 L300 300 L0 300Z" fill="${c}"/>` +
    `<g stroke="${a}" stroke-opacity="0.6" stroke-width="1.3">${across}${toward}</g>` +
    `<text x="150" y="42" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="21" letter-spacing="7" fill="#fff" fill-opacity="0.92">${title.toUpperCase()}</text>` +
    `<rect width="300" height="300" filter="url(#grain)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/**
 * A player that plays made-up songs (a clock, no sound): the tab makes up their sound (`NowPlayingStatus.demo`).
 * It isn't open until it's told to play (so other tests never see it).
 */
export function standInPlayer(now: () => number = Date.now): Player {
  let open = false;
  let index = 0;
  let playing = true;
  // Where the song was at `since`.
  let position = 30;
  let since = now();
  const trackAt = (i: number): NowPlayingTrack => {
    const { colours, ...track } = STAND_IN_TRACKS[i];
    return { ...track, artwork: standInArtwork(colours, track.album), url: null };
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
    read: async () => (open ? status() : unavailableStatus("Stand-in", "not-running")),
    async command(command) {
      if (!open) {
        open = true;
        since = now();
      }
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

/** The player this computer has: Spotify on a Mac or on Windows (else none), or the stand-in. */
export function defaultPlayer(setting: string | null): Player | null {
  if (setting === "stand-in") return standInPlayer();
  if (setting === "off") return null;
  if (process.platform === "darwin") return spotifyPlayer();
  if (process.platform === "win32") return windowsPlayer();
  return null;
}
