import { type ChildProcess, spawnSync } from "node:child_process";

/** Invoke the package manager through Node, avoiding Windows .cmd shims and shell quoting. */
export function pnpmCommand(args: string[]): [string, string[]] {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error("Run this script through pnpm (for example: pnpm dev).");
  return [process.execPath, [cli, ...args]];
}

/**
 * Windows does not propagate signals to subprocess trees. `taskkill` is waited for: a script that exits straight after
 * (scripts/shell.ts) would take it down too (Node's children die with it), leaving the tree running.
 */
export function stopProcess(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    if (killer.error) child.kill();
  } else child.kill();
}
