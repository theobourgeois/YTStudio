/**
 * The music app in development (docs/apps.md, docs/claude/music-shell.md): the audio engine is the app, as it is
 * packaged. It starts the server itself (this checkout's, through tsx: not watched, as restarting it would close
 * the window) and shows Vite's page in its window, so the page reloads as it's edited; closing the window stops
 * both, and this stops Vite.
 *
 *   pnpm engine:build && pnpm dev:music   # tsx scripts/shell.ts music: the Music app
 *   pnpm dev:shell                        # every suite in the engine's window
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { BASE_WEB_PORT, pickPorts } from "./ports.ts";
import { pnpmCommand, stopProcess } from "./process.ts";
import { isAppId } from "../shared/apps.ts";
import { engineExecutable } from "../server/engine-path.ts";

const app = process.argv[2];
if (app !== undefined && !isAppId(app)) throw new Error(`No app "${app}": video, music, photo or visualizer.`);

const root = path.resolve(import.meta.dirname, "..");
const build = path.join(root, "engine", "build");
const engine = process.env.EDITOR_ENGINE_PATH || engineExecutable(path.join(build, "VaudioEngine_artefacts", "Release"));
if (!existsSync(engine)) throw new Error(`No engine at ${engine}: run pnpm engine:build first.`);

const { web, server } = await pickPorts();
if (web !== BASE_WEB_PORT) console.log(`[shell] ${BASE_WEB_PORT} is taken, using ports ${web} (app) / ${server} (server)`);
const env = { ...process.env, EDITOR_WEB_PORT: String(web), EDITOR_SERVER_PORT: String(server), ...(app && { EDITOR_APP: app }) };

// The engine's settings where the server would keep them (`DataPaths.engine`): an app's own start with the checkout's.
const data = path.join(root, "data", ...(app ? ["apps", app] : []), "engine");
const plugins = ["VaudioTestSynth", "VaudioTestEffect"].map((name) => path.join(build, "test-plugin", `${name}_artefacts`, "Release", "VST3")).filter(existsSync);

const vite = spawn(...pnpmCommand(["dev:web"]), { stdio: "inherit", env });
const shell = spawn(
  engine,
  [
    "--data", data,
    ...(app ? ["--carry-from", path.join(root, "data", "engine")] : []),
    ...plugins.flatMap((dir) => ["--plugin-path", dir]),
    "--server", process.execPath,
    ...["--import", "tsx", path.join(root, "server", "index.ts")].flatMap((arg) => ["--server-arg", arg]),
    "--page", `http://localhost:${web}/`,
  ],
  { stdio: "inherit", env, cwd: root },
);

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(signal, () => {
    stopProcess(shell);
    stopProcess(vite);
  });
shell.on("exit", (code, signal) => {
  stopProcess(vite);
  process.exit(signal ? 1 : (code ?? 0));
});
vite.on("exit", () => stopProcess(shell));
