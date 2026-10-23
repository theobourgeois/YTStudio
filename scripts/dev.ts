/**
 * Start the dev server and web app on the first free pair of ports (5310/5311, then 5410/5411, ...), so several
 * checkouts (git worktrees) can run side by side. EDITOR_WEB_PORT / EDITOR_SERVER_PORT still pin them. Given an app
 * (docs/apps.md), it's that app (`EDITOR_APP`, its data in data/apps/<app>); else every suite at once.
 *
 *   pnpm dev                 # every suite
 *   pnpm dev:video           # tsx scripts/dev.ts video: one app (video, photo, visualizer)
 */
import { spawn } from "node:child_process";
import { BASE_WEB_PORT, pickPorts } from "./ports.ts";
import { pnpmCommand, stopProcess } from "./process.ts";
import { isAppId } from "../shared/apps.ts";

const app = process.argv[2];
if (app !== undefined && !isAppId(app)) throw new Error(`No app "${app}": video, music, photo or visualizer.`);

const { web, server } = await pickPorts();
if (web !== BASE_WEB_PORT) console.log(`[dev] ${BASE_WEB_PORT} is taken, using ports ${web} (app) / ${server} (server)`);

const child = spawn(
  ...pnpmCommand(["exec", "concurrently", "-k", "-n", "server,web", "-c", "blue,magenta", "pnpm dev:server", "pnpm dev:web"]),
  {
    stdio: "inherit",
    env: { ...process.env, EDITOR_WEB_PORT: String(web), EDITOR_SERVER_PORT: String(server), ...(app && { EDITOR_APP: app }) },
  },
);
// Hand Ctrl+C / kill to concurrently (it stops both processes) and exit once it has.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => stopProcess(child));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
