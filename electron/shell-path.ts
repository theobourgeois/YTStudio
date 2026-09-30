/**
 * An app opened from the Finder or the Dock gets launchd's bare PATH (/usr/bin:/bin:...), not the one the
 * user's shell sets up, so ffmpeg, yt-dlp, whisper-cli, claude and codex wouldn't be found. Ask the login
 * shell for its PATH once at startup (as VS Code and T3 Code do) and add the usual Homebrew homes.
 */
import { execFile } from "node:child_process";
import os from "node:os";

const MARK = "__EDITOR_PATH__";
const TIMEOUT_MS = 5000;
/** Homebrew (Apple silicon, Intel) and user installs, in case the shell doesn't say. */
const FALLBACKS = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "~/.local/bin"];

/** The PATH the shell printed between the markers (shells may print banners around it), or null. */
export function parseShellPath(output: string): string | null {
  const start = output.indexOf(MARK);
  const end = output.indexOf(MARK, start + MARK.length);
  if (start < 0 || end < 0) return null;
  const value = output.slice(start + MARK.length, end).trim();
  return value || null;
}

/** PATH lists joined in order of preference, without repeats or empty entries (`~` expanded). */
export function mergePaths(lists: (string | null | undefined)[], home = os.homedir()): string {
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list?.split(":") ?? []) {
      const dir = raw.startsWith("~/") ? home + raw.slice(1) : raw;
      if (dir) seen.add(dir);
    }
  }
  return [...seen].join(":");
}

function shellPath(): Promise<string | null> {
  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  return new Promise((resolve) => {
    execFile(
      shell,
      // Interactive + login, so both .zprofile and .zshrc (where most PATH lines live) are read.
      ["-ilc", `printf '%s' "${MARK}$PATH${MARK}"`],
      { timeout: TIMEOUT_MS, env: { ...process.env, DISABLE_AUTO_UPDATE: "true", ZSH_TMUX_AUTOSTARTED: "true" } },
      (_err, stdout) => resolve(parseShellPath(String(stdout ?? ""))),
    );
  });
}

/** Put the login shell's PATH (then the fallbacks) in front of this process's. Windows is left alone. */
export async function loadShellPath(): Promise<void> {
  if (process.platform === "win32") return;
  process.env.PATH = mergePaths([await shellPath(), process.env.PATH, FALLBACKS.join(":")]);
}
