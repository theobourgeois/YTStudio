/**
 * The export's compositor page in a hidden window of the app's own Chromium, so the desktop app needs no
 * separate browser (see `setGlPageOpener` in server/gl-browser.ts). It shares the app's GPU process.
 */
import { BrowserWindow } from "electron";
import type { GlPageOpener } from "../server/gl-browser.ts";

/** What `evaluate`'s wrapper sends back: a thrown error's message survives, unlike a rejection's. */
type Outcome<R> = { ok: true; value: R } | { ok: false; error: string };

export const openWindowPage: GlPageOpener = async (url) => {
  const win = new BrowserWindow({
    show: false,
    // A hidden window's timers would otherwise be throttled, slowing the frame exchange to a crawl.
    webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const errors: string[] = [];
  win.webContents.on("console-message", ({ level, message }) => {
    if (level === "error") errors.push(message);
  });
  const close = async () => {
    if (!win.isDestroyed()) win.destroy();
  };
  try {
    await win.loadURL(url);
    // The page script defines `compositor` last: without it, the script threw.
    const loaded = await win.webContents.executeJavaScript("typeof globalThis.compositor === 'object'");
    if (!loaded) throw new Error(errors[0] ?? "The export's drawing page didn't start.");
  } catch (err) {
    await close();
    throw err;
  }
  return {
    async evaluate<A, R>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> {
      if (win.isDestroyed()) throw new Error("The export's drawing page was closed.");
      const code = `(async () => {
        try { return { ok: true, value: await (${fn.toString()})(${JSON.stringify(arg) ?? "undefined"}) }; }
        catch (err) { return { ok: false, error: String(err && err.message || err) }; }
      })()`;
      const outcome = (await win.webContents.executeJavaScript(code)) as Outcome<R>;
      if (!outcome.ok) throw new Error(outcome.error);
      return outcome.value;
    },
    close,
  };
};
