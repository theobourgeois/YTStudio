/**
 * The music shell (docs/claude/music-shell.md): the app in a window of the audio engine's own, so the music suite
 * and its plugins' windows are one program, as FL Studio is. The server and the web app run as `pnpm dev`'s do (the
 * server not watched: restarting it would close the window); closing the window stops both.
 *
 *   pnpm engine:build && pnpm dev:music   # tsx scripts/shell.ts music: the Music app (docs/apps.md)
 *   pnpm dev:shell                        # every suite in the engine's window
 */
import { spawn } from "node:child_process";
import { BASE_WEB_PORT, pickPorts } from "./ports.ts";
import { pnpmCommand, stopProcess } from "./process.ts";
import { isAppId } from "../shared/apps.ts";

const app = process.argv[2];
if (app !== undefined && !isAppId(app)) throw new Error(`No app "${app}": video, music, photo or visualizer.`);

const { web, server } = await pickPorts();
if (web !== BASE_WEB_PORT) console.log(`[shell] ${BASE_WEB_PORT} is taken, using ports ${web} (app) / ${server} (server)`);

const child = spawn(
  ...pnpmCommand(["exec", "concurrently", "-k", "--success", "first", "-n", "server,web", "-c", "blue,magenta", "pnpm exec tsx server/index.ts", "pnpm dev:web"]),
  {
    stdio: "inherit",
    env: { ...process.env, EDITOR_WEB_PORT: String(web), EDITOR_SERVER_PORT: String(server), EDITOR_ENGINE_WINDOW: `http://localhost:${web}/`, ...(app && { EDITOR_APP: app }) },
  },
);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => stopProcess(child));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
