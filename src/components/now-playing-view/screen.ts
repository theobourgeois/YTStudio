/**
 * A screen or another program's window in the visualizer's looks (docs/now-playing.md, "Your screen"): FL Studio as
 * it's worked in, a game, a video call, melting into MilkDrop's looks as the user's clips do (`media-feed.ts`) while
 * what the computer plays drives them. Only its picture: the sound is listening's (`live-audio.ts`). The desktop app
 * lists the screens and windows (not its own: the visualizer would see itself) and hands over the one picked
 * (electron/screen-share.ts); a browser's own picker asks. It stops when the visualizer closes, or the share does.
 */
import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { type ScreenSource, desktopScreens } from "@/lib/desktop";
import { log } from "@/lib/log";

const logger = log("now-playing");

/** What the feed calls the screen (a clip's media id stands there otherwise). */
export const SCREEN_MEDIA = "screen";

/** Frames a second asked of the screen: the looks don't need more, and a big screen's frames cost to take. */
const FRAME_RATE = 30;

export interface SharedScreen {
  stream: MediaStream;
  /** What it is, for the panel and the assistant (a window's title, "Screen 1"...). */
  name: string;
  /** The desktop app's id for it (null: a browser's pick). */
  sourceId: string | null;
}

interface ScreenState {
  shared: SharedScreen | null;
  /** Being asked for (the browser's picker open, or the desktop app handing it over). */
  asking: boolean;
  /** What the desktop app offers (null: not listed yet, or a browser, whose picker asks). */
  sources: ScreenSource[] | null;
  /** macOS's answer about recording the screen ("granted", "denied", "not-determined"...; null: not asked). */
  access: string | null;
  /** The screens and windows there are now (the desktop app only). */
  list(): Promise<void>;
  /** A screen or window into the looks: the desktop app's `sourceId`, else the browser's picker. Whether it is. */
  share(sourceId?: string): Promise<boolean>;
  stop(): void;
}

/**
 * What a share the browser picked is, from its track: its label when that's a name (a window's title), not an id
 * (Chrome's `screen:0:0`, `window:1234:0`, or a long run of letters and digits).
 */
function nameOf(track: MediaStreamTrack): string {
  const surface = (track.getSettings() as { displaySurface?: string }).displaySurface;
  const id = /^(screen|window|web-contents-media-stream):/.test(track.label) || /^[\w+/=-]{16,}$/.test(track.label);
  if (track.label && !id) return track.label;
  return surface === "window" ? "A window" : surface === "browser" ? "A tab" : "The screen";
}

export const useVisualizerScreen = create<ScreenState>((set, get) => ({
  shared: null,
  asking: false,
  sources: null,
  access: null,
  async list() {
    const screens = desktopScreens();
    if (!screens) return;
    try {
      const { sources, access } = await screens.sources();
      set({ sources, access });
    } catch (err) {
      logger.warn(`couldn't list the screens and windows: ${errorMessage(err)}`);
      set({ sources: [] });
    }
  },
  async share(sourceId) {
    if (get().asking || !navigator.mediaDevices?.getDisplayMedia) {
      if (!navigator.mediaDevices?.getDisplayMedia) toast.error("This browser can't share the screen.");
      return false;
    }
    const screens = desktopScreens();
    const source = sourceId ? get().sources?.find((s) => s.id === sourceId) : undefined;
    if (screens && !source) return false;
    set({ asking: true });
    try {
      if (screens && source) await screens.choose(source.id);
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: FRAME_RATE, max: FRAME_RATE } },
        audio: false,
        // Chrome's picker: not this tab (the visualizer seeing itself), any other, a window or a screen.
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        monitorTypeSurfaces: "include",
      } as DisplayMediaStreamOptions);
      const [track] = stream.getVideoTracks();
      if (!track) {
        for (const t of stream.getTracks()) t.stop();
        throw new Error("no picture came of it");
      }
      get().stop();
      const shared: SharedScreen = { stream, name: source?.name ?? nameOf(track), sourceId: source?.id ?? null };
      // Shared no more (the browser's Stop sharing, the window closed): out of the looks.
      track.addEventListener("ended", () => {
        if (get().shared?.stream !== stream) return;
        set({ shared: null });
        logger.info(`${shared.name} isn't shared any more`);
      });
      set({ shared });
      logger.info(`${shared.name} in the visualizer's looks`);
      return true;
    } catch (err) {
      // (Cancelled in the picker: nothing to say.)
      if (!(err instanceof DOMException && err.name === "NotAllowedError" && !screens)) {
        toast.error(`Couldn't see ${source?.name ?? "the screen"}: ${errorMessage(err)}`);
        logger.warn(`couldn't share ${source?.name ?? "the screen"}: ${errorMessage(err)}`);
      }
      return false;
    } finally {
      set({ asking: false });
    }
  },
  stop() {
    const { shared } = get();
    if (!shared) return;
    for (const track of shared.stream.getTracks()) track.stop();
    set({ shared: null });
  },
}));
