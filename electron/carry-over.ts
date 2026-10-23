/**
 * A new app (docs/apps.md) starts with what YTStudio's page kept: its theme, fonts, layouts and every suite's
 * preferences. They're in the page's localStorage, which is per profile and per origin, and each app has a profile
 * and a port of its own: so, once, YTStudio's is read from a copy of its profile and written into this app's.
 */
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, type Session, session } from "electron";
import { log } from "../server/log.ts";

const logger = log("desktop");

/** Marks the carry-over done (or found nothing to carry), so it happens once. */
const doneFile = () => path.join(app.getPath("userData"), "settings-carried-over");

/** A blank page in place of whatever the address serves: only its origin's storage is wanted. */
const BLANK = () => new Response("<!doctype html><title></title>", { headers: { "content-type": "text/html" } });

async function storageAt(ses: Session, url: string, run: string): Promise<unknown> {
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, javascript: true } });
  try {
    await win.loadURL(url);
    return await win.webContents.executeJavaScript(run);
  } finally {
    win.destroy();
  }
}

/**
 * Copies YTStudio's localStorage (its profile at `from`, its page at `fromPort`) into this app's page at `appUrl`,
 * the first time this app opens. Never stops the app opening: what goes wrong is logged.
 */
export async function carrySettingsOver(appUrl: string, from: string, fromPort: number): Promise<void> {
  if (existsSync(doneFile())) return;
  const source = path.join(from, "Local Storage");
  let copy = "";
  try {
    if (existsSync(source)) {
      // A copy, without the lock YTStudio holds while it's open.
      copy = mkdtempSync(path.join(os.tmpdir(), "ytstudio-carry-"));
      cpSync(source, path.join(copy, "Local Storage"), { recursive: true, filter: (file) => path.basename(file) !== "LOCK" });
      const old = session.fromPath(copy, { cache: false });
      old.protocol.handle("http", BLANK);
      const items = await storageAt(old, `http://127.0.0.1:${fromPort}/`, "JSON.stringify(Object.entries(localStorage))");
      const entries = JSON.parse(String(items)) as [string, string][];
      if (entries.length > 0) {
        // The app's own origin, on an address that draws nothing (the page itself would write its defaults first).
        await storageAt(
          session.defaultSession,
          new URL("/api/app", appUrl).href,
          `for (const [k, v] of ${JSON.stringify(entries)}) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);`,
        );
      }
      logger.info("carried settings over", { from, items: entries.length });
    }
    writeFileSync(doneFile(), new Date().toISOString());
  } catch (error) {
    logger.warn("couldn't carry settings over", { from, error: String(error) });
  } finally {
    if (copy) rmSync(copy, { recursive: true, force: true });
  }
}
