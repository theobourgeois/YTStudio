/**
 * Which of YTStudio's apps this page is (`shared/apps.ts`, docs/apps.md): the server says (`EDITOR_APP`), so one
 * build of the page serves every app. Asked once, before the page draws (`main.tsx`); every suite until it answers.
 */
import { type AppInfo, EVERY_APP, appInfo, isAppId } from "@shared/apps";
import type { SuiteId } from "@shared/suites";
import { api } from "@/lib/api";

let current: AppInfo = EVERY_APP;

/** How long the page waits for the server to answer (`pnpm dev` starts both at once) before drawing anyway. */
const WAIT_MS = 5000;

export async function loadApp(): Promise<void> {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    try {
      const { app } = await api.app();
      current = appInfo(isAppId(app) ? app : null);
      break;
    } catch {
      if (Date.now() > until) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  document.title = current.name;
}

export const currentApp = (): AppInfo => current;

/** The suites this app opens and makes, in `SUITE_IDS`' order. */
export const appSuites = (): readonly SuiteId[] => current.suites;

/** Whether this app opens a suite's projects: music's Make Visualizer makes a video, so only where videos open. */
export const appOpens = (suite: SuiteId): boolean => current.suites.includes(suite);
