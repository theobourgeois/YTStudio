/**
 * Start the dev server and web app on the first free pair of ports (5310/5311, then 5410/5411, ...), so several
 * checkouts (git worktrees) can run side by side. EDITOR_WEB_PORT / EDITOR_SERVER_PORT still pin them.
 *
 *   pnpm dev
 */
import { spawn } from "node:child_process";
import { BASE_WEB_PORT, pickPorts } from "./ports.ts";
import { pnpmCommand, stopProcess } from "./process.ts";

const { web, server } = await pickPorts();
if (web !== BASE_WEB_PORT) console.log(`[dev] ${BASE_WEB_PORT} is taken, using ports ${web} (app) / ${server} (server)`);

const child = spawn(
  ...pnpmCommand(["exec", "concurrently", "-k", "-n", "server,web", "-c", "blue,magenta", "pnpm dev:server", "pnpm dev:web"]),
  {
    stdio: "inherit",
    env: { ...process.env, EDITOR_WEB_PORT: String(web), EDITOR_SERVER_PORT: String(server) },
  },
);
// Hand Ctrl+C / kill to concurrently (it stops both processes) and exit once it has.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => stopProcess(child));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
