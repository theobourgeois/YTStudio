/**
 * What the visualizer may see of the screen (docs/now-playing.md, "Your screen"): a screen or a window of another
 * program (FL Studio, a game) melting into its looks. The page asks for a screen share (`getDisplayMedia`) and the app
 * answers it itself: with the system's sound and the page as the picture when it's listening (it never asks to record
 * the screen for that), with the screen or window the page picked from `screen-sources` when it wants a picture.
 * The app's own windows aren't offered: the visualizer would be seeing itself.
 */
import { BrowserWindow, desktopCapturer, ipcMain, session, systemPreferences } from "electron";
import { log } from "../server/log.ts";

/** A screen or window the page may pick (`thumbnail`: a small JPEG of it now, as a data URL). */
export interface ScreenSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
}

/** How big the pictures of each are (the picker's tiles). */
const THUMBNAIL = { width: 320, height: 180 };

/** The source the page picked last: the next screen share without sound is it. */
let chosen: string | null = null;

/** Every screen, and every window that isn't this app's. */
async function sources(): Promise<{ sources: ScreenSource[]; access: string }> {
  // macOS asks once for screen recording; until it's allowed, only the app's own windows (and blank screens) are listed.
  const access = process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted";
  const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
  const found = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: THUMBNAIL });
  return {
    access,
    sources: found
      .filter((s) => !own.has(s.id) && s.name)
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith("screen:") ? "screen" : "window",
        thumbnail: s.thumbnail.isEmpty() ? "" : `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString("base64")}`,
      })),
  };
}

/** The page's screen shares answered (listening's and the screen's picture), and its picks heard. */
export function answerScreenShares() {
  ipcMain.handle("screen-sources", () => sources());
  ipcMain.handle("screen-choose", (_event, id: unknown) => {
    chosen = typeof id === "string" ? id : null;
  });
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (request.audioRequested) {
      callback({ video: request.frame ?? undefined, audio: "loopback" });
      return;
    }
    const id = chosen;
    chosen = null;
    if (!id) {
      callback({});
      return;
    }
    desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } }).then(
      (found) => {
        const source = found.find((s) => s.id === id);
        if (!source) log("desktop").warn("the screen or window picked has gone");
        callback(source ? { video: source } : {});
      },
      (err: unknown) => {
        log("desktop").warn(`couldn't list the screens: ${String(err)}`);
        callback({});
      },
    );
  });
}
