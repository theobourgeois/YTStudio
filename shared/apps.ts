/**
 * YTStudio is four apps (docs/apps.md): Music, Video, Photo and the Visualizer, built from one platform. Which one
 * this is comes from `EDITOR_APP` (the server's `config.ts`), and the page asks the server (`GET /api/app`), so one
 * build of the page serves every app. None is every suite at once: `pnpm dev`, the e2e suite and the gallery.
 *
 * An app lists the suites it opens and makes; the platform asks it rather than branching on an app's id.
 */
import { SUITE_IDS, type SuiteId } from "./suites.ts";

export type AppId = "video" | "music" | "photo" | "visualizer";

export interface AppInfo {
  /** Null for every suite at once (no `EDITOR_APP`). */
  id: AppId | null;
  /** Its name, where the page shows the app's ("YTStudio Video"). */
  name: string;
  /** The suites it opens and makes (none for the Visualizer, which makes no projects). */
  suites: SuiteId[];
  /** Whether it has Now Playing's full-window visualizer. */
  visualizer: boolean;
}

export const APPS: Record<AppId, AppInfo> = {
  video: { id: "video", name: "YTStudio Video", suites: ["video"], visualizer: false },
  music: { id: "music", name: "YTStudio Music", suites: ["music"], visualizer: false },
  photo: { id: "photo", name: "YTStudio Photo", suites: ["photo"], visualizer: false },
  visualizer: { id: "visualizer", name: "YTStudio Visualizer", suites: [], visualizer: true },
};

/** Every suite in one app, as YTStudio was: what runs with no `EDITOR_APP`. */
export const EVERY_APP: AppInfo = { id: null, name: "YTStudio", suites: SUITE_IDS, visualizer: true };

export const isAppId = (v: unknown): v is AppId => typeof v === "string" && Object.hasOwn(APPS, v);

export const appInfo = (id: AppId | null): AppInfo => (id ? APPS[id] : EVERY_APP);

/** The app a suite's projects open in, for telling the user where a file belongs ("Open it in YTStudio Music"). */
export const appOfSuite = (suite: SuiteId): AppInfo => Object.values(APPS).find((app) => app.suites.includes(suite)) ?? EVERY_APP;
