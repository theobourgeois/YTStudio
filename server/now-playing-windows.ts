/**
 * Now Playing on Windows (docs/now-playing.md): Spotify's desktop app tells Windows what it plays through the system's
 * media controls (GlobalSystemMediaTransportControls, the panel over the volume flyout), which any program may read
 * and drive: no account, no key, no Premium, nothing to allow. They're WinRT, so one PowerShell (always on Windows)
 * stays open and answers a line at a time (`HELPER`): starting one per question would take half a second each.
 */
import { createHash } from "node:crypto";
import { errorMessage } from "../shared/errors.ts";
import { type NowPlayingStatus, type NowPlayingTrack, type PlayerState, unavailableStatus } from "../shared/now-playing.ts";
import type { Player } from "./now-playing.ts";
import { spawnStreaming } from "./process.ts";
import { HttpError } from "./storage.ts";

/**
 * Reads a line (`read`, or an action and its number), answers a line of JSON. A cover is sent only when it changed
 * (`artHash` names it either way). Spotify's session is the one whose app id says so (`Spotify.exe`, or the Store's).
 */
const HELPER = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
# The cover's stream comes back as a bare COM object, which PowerShell can't match to an overload itself.
$asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${"`"}1' } | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(5000)) { throw 'Windows media controls did not answer' }
  $task.Result
}
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$md5 = [System.Security.Cryptography.MD5]::Create()
$sentArt = ''
# The cover is looked at on a new song and a few answers after (Spotify can swap it in late), not on every one.
$song = ''
$coverLooks = 0
$artHash = $null
function Spotify { foreach ($s in $manager.GetSessions()) { if ($s.SourceAppUserModelId -match 'spotify') { return $s } }; $null }
function Read-Cover($ref) {
  $stream = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $net = $asStream.Invoke($null, @($stream))
  $copy = New-Object System.IO.MemoryStream
  $net.CopyTo($copy)
  $net.Dispose()
  $copy.ToArray()
}
function Answer($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $words = $line.Split(' ')
  try {
    $s = Spotify
    if ($words[0] -eq 'read') {
      if ($null -eq $s) { Answer @{ running = $false }; continue }
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $t = $s.GetTimelineProperties()
      $i = $s.GetPlaybackInfo()
      $out = [ordered]@{
        running = $true; state = "$($i.PlaybackStatus)"; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
        position = $t.Position.TotalSeconds; duration = ($t.EndTime - $t.StartTime).TotalSeconds
        updated = $t.LastUpdatedTime.ToUnixTimeMilliseconds(); now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        shuffling = $i.IsShuffleActive -eq $true; repeating = "$($i.AutoRepeatMode)" -ne 'None' -and $null -ne $i.AutoRepeatMode
        artHash = $null
      }
      $key = "$($p.Title)|$($p.Artist)|$($p.AlbumTitle)"
      if ($key -ne $song) { $song = $key; $coverLooks = 0; $artHash = $null }
      if ($coverLooks -lt 4 -and $null -ne $p.Thumbnail) {
        $coverLooks++
        try {
          $bytes = Read-Cover $p.Thumbnail
          if ($bytes.Length -gt 0) { $artHash = ([BitConverter]::ToString($md5.ComputeHash($bytes)) -replace '-', '').Substring(0, 16).ToLower() }
          if ($null -ne $artHash -and $artHash -ne $sentArt) { $out.art = [Convert]::ToBase64String($bytes); $sentArt = $artHash }
        } catch {}
      }
      $out.artHash = $artHash
      Answer $out
    } else {
      if ($null -ne $s) {
        $op = switch ($words[0]) {
          'play' { $s.TryPlayAsync() }
          'pause' { $s.TryPauseAsync() }
          'toggle' { $s.TryTogglePlayPauseAsync() }
          'next' { $s.TrySkipNextAsync() }
          'previous' { $s.TrySkipPreviousAsync() }
          'seek' { $s.TryChangePlaybackPositionAsync([long]([double]$words[1] * 10000000)) }
          default { $null }
        }
        if ($null -ne $op) { $null = Await $op ([bool]) }
      }
      Answer @{ ok = $true }
    }
  } catch {
    Answer @{ error = $_.Exception.Message }
  }
}
`;

/** Asks the helper a line, gets its answer's line. */
export type Ask = (line: string) => Promise<string>;

/** A cover, as Windows gave it. */
export interface Cover {
  type: string;
  data: Buffer;
}

/** The helper's answer to `read`, at `at` (ms since the epoch); the cover is served at `/api/now-playing/cover/<hash>`. */
export function windowsStatus(json: string, at: number): NowPlayingStatus {
  const raw = JSON.parse(json) as Record<string, unknown>;
  if (typeof raw.error === "string") return unavailableStatus("Spotify", "error", raw.error);
  if (!raw.running) return { ...unavailableStatus("Spotify", "not-running"), at };
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const state: PlayerState = raw.state === "Playing" ? "playing" : raw.state === "Paused" ? "paused" : "stopped";
  const name = text(raw.title);
  const duration = Math.max(0, num(raw.duration));
  // Windows has no song id: its name, artist and album stand for one.
  const track: NowPlayingTrack | null = name
    ? {
        id: `windows:${createHash("sha1").update(`${name}\0${text(raw.artist)}\0${text(raw.album)}`).digest("hex").slice(0, 16)}`,
        name,
        artist: text(raw.artist),
        album: text(raw.album),
        duration,
        artwork: typeof raw.artHash === "string" && /^[0-9a-f]+$/.test(raw.artHash) ? `/api/now-playing/cover/${raw.artHash}` : null,
        url: null,
      }
    : null;
  // The position is where it was when Spotify last said (`updated`), moving on since while it plays.
  const updated = num(raw.updated);
  const now = num(raw.now) || at;
  const moved = state === "playing" && updated > 0 ? Math.max(0, now - updated) / 1000 : 0;
  const position = Math.max(0, num(raw.position) + moved);
  return {
    player: "Spotify",
    unavailable: null,
    state: track ? state : "stopped",
    track,
    position: duration > 0 ? Math.min(position, duration) : position,
    at,
    // Windows' media controls have no volume: Spotify's own slider still works.
    volume: 100,
    shuffling: raw.shuffling === true,
    repeating: raw.repeating === true,
  };
}

/** A cover's type, from its first bytes (Windows doesn't say). */
export function imageType(data: Buffer): string {
  if (data[0] === 0x89 && data[1] === 0x50) return "image/png";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (data.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  return "image/jpeg";
}

/** Why the helper couldn't be asked. */
function windowsProblem(message: string): NowPlayingStatus {
  if (/Unable to find type|TypeNotFound/i.test(message)) return unavailableStatus("Spotify", "unsupported", "This version of Windows has no media controls to ask.");
  return unavailableStatus("Spotify", "error", message);
}

/** How long the helper has to answer (its first answer includes starting PowerShell). */
const ANSWER_TIMEOUT_MS = 15_000;

/** One PowerShell running `HELPER`, started when first asked and again if it dies; questions wait their turn. */
export function powershellHelper(): Ask {
  let helper: { write: (line: string) => void; next: () => Promise<string>; kill: () => void } | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const start = () => {
    const encoded = Buffer.from(HELPER, "utf16le").toString("base64");
    const { child, done } = spawnStreaming(
      ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      "pipe",
      "pipe",
    );
    let buffered = "";
    const lines: string[] = [];
    const waiting: { resolve: (line: string) => void; reject: (err: Error) => void }[] = [];
    let ended: Error | null = null;
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffered += chunk;
      for (let at = buffered.indexOf("\n"); at >= 0; at = buffered.indexOf("\n")) {
        const line = buffered.slice(0, at).trim();
        buffered = buffered.slice(at + 1);
        if (!line) continue;
        const waiter = waiting.shift();
        if (waiter) waiter.resolve(line);
        else lines.push(line);
      }
    });
    const end = (err: Error) => {
      ended = err;
      if (helper === self) helper = null;
      for (const waiter of waiting.splice(0)) waiter.reject(err);
    };
    done.then(() => end(new Error("PowerShell stopped answering.")), end);
    child.stdin!.on("error", () => {});
    const self = {
      write: (line: string) => child.stdin!.write(`${line}\n`),
      next: () => {
        if (lines.length) return Promise.resolve(lines.shift()!);
        if (ended) return Promise.reject(ended);
        return new Promise<string>((resolve, reject) => waiting.push({ resolve, reject }));
      },
      kill: () => child.kill(),
    };
    return self;
  };

  const askNow = async (line: string) => {
    const h = (helper ??= start());
    h.write(line);
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("PowerShell didn't answer in time.")), ANSWER_TIMEOUT_MS);
    });
    try {
      return await Promise.race([h.next(), late]);
    } catch (err) {
      // An answer that comes late would be taken for the next question's: start again.
      h.kill();
      if (helper === h) helper = null;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  return (line) => {
    const answer = queue.then(() => askNow(line));
    queue = answer.catch(() => {});
    return answer;
  };
}

/** Spotify on Windows, through the system's media controls (`ask` stands in for the helper in tests). */
export function windowsPlayer(ask: Ask = powershellHelper()): Player & { cover(hash: string): Cover | null } {
  // The newest cover only: the tab asks for the one its status names.
  let cover: { hash: string; cover: Cover } | null = null;
  return {
    name: "Spotify",
    async read() {
      const at = Date.now();
      try {
        const json = await ask("read");
        const raw = JSON.parse(json) as { artHash?: unknown; art?: unknown };
        if (typeof raw.artHash === "string" && typeof raw.art === "string") {
          const data = Buffer.from(raw.art, "base64");
          cover = { hash: raw.artHash, cover: { type: imageType(data), data } };
        }
        return windowsStatus(json, at);
      } catch (err) {
        return windowsProblem(errorMessage(err));
      }
    },
    async command(command) {
      // No volume: Windows' media controls can't set a player's.
      if (command.action === "volume") return;
      const value = command.action === "seek" ? command.position : 0;
      let answer: Record<string, unknown>;
      try {
        answer = JSON.parse(await ask(`${command.action} ${value}`)) as Record<string, unknown>;
      } catch (err) {
        throw new HttpError(502, windowsProblem(errorMessage(err)).message ?? "Spotify didn't answer.");
      }
      if (typeof answer.error === "string") throw new HttpError(502, answer.error);
    },
    cover: (hash) => (cover?.hash === hash ? cover.cover : null),
  };
}
