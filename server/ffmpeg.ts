import { FFMPEG } from "./config.ts";
import { run } from "./process.ts";

/** Arguments every ffmpeg invocation starts with: quiet, non-interactive. */
export const FFMPEG_QUIET = ["-hide_banner", "-nostdin", "-loglevel", "error"] as const;

let versionPromise: Promise<string | null> | undefined;

/** ffmpeg's version string (e.g. "8.1.2"), or null when it can't be run. Cached. */
export function ffmpegVersion(): Promise<string | null> {
  versionPromise ??= run(FFMPEG, ["-hide_banner", "-version"]).then(
    (out) => /ffmpeg version (\S+)/.exec(out)?.[1] ?? "unknown",
    () => null,
  );
  return versionPromise;
}

let encodersPromise: Promise<ReadonlySet<string>> | undefined;

/** The encoders ffmpeg has (`libx264`, `prores_ks`...), none when it can't be run. Cached. */
export function ffmpegEncoders(): Promise<ReadonlySet<string>> {
  encodersPromise ??= run(FFMPEG, ["-hide_banner", "-encoders"]).then(
    (out) => new Set(out.split("\n").map((line) => line.trim().split(/\s+/)[1]).filter(Boolean)),
    () => new Set<string>(),
  );
  return encodersPromise;
}
