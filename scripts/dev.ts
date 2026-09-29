/**
 * Start the dev server and web app on the first free pair of ports (5310/5311, then 5410/5411, ...), so several
 * checkouts (git worktrees) can run side by side. EDITOR_WEB_PORT / EDITOR_SERVER_PORT still pin them.
 *
 *   pnpm dev
 */
import { spawn } from "node:child_process";
import net from "node:net";

const BASE_WEB_PORT = 5310;
const STEP = 100; // 5320/5321 belong to the e2e suite
const ATTEMPTS = 10;

/** Vite listens on `localhost` (IPv4 or IPv6), the server on 127.0.0.1: the port has to be free on both. */
function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "EADDRNOTAVAIL"));
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

async function isFree(port: number): Promise<boolean> {
  return (await canListen(port, "127.0.0.1")) && (await canListen(port, "::1"));
}

async function pickPorts(): Promise<{ web: number; server: number }> {
  const pinnedWeb = Number(process.env.EDITOR_WEB_PORT) || undefined;
  const pinnedServer = Number(process.env.EDITOR_SERVER_PORT) || undefined;
  if (pinnedWeb && pinnedServer) return { web: pinnedWeb, server: pinnedServer };
  for (let i = 0; i < ATTEMPTS; i++) {
    const web = pinnedWeb ?? BASE_WEB_PORT + i * STEP;
    const server = pinnedServer ?? web + 1;
    if ((pinnedWeb || (await isFree(web))) && (pinnedServer || (await isFree(server)))) return { web, server };
  }
  throw new Error(`no free ports between ${BASE_WEB_PORT} and ${BASE_WEB_PORT + ATTEMPTS * STEP}`);
}

const { web, server } = await pickPorts();
if (web !== BASE_WEB_PORT) console.log(`[dev] ${BASE_WEB_PORT} is taken, using ports ${web} (app) / ${server} (server)`);

const child = spawn(
  "pnpm",
  ["exec", "concurrently", "-k", "-n", "server,web", "-c", "blue,magenta", "pnpm dev:server", "pnpm dev:web"],
  {
    stdio: "inherit",
    env: { ...process.env, EDITOR_WEB_PORT: String(web), EDITOR_SERVER_PORT: String(server) },
  },
);
// Hand Ctrl+C / kill to concurrently (it stops both processes) and exit once it has.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
