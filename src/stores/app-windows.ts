import { createWindows } from "@/components/windows/store";

/** The app's own windows, over whichever suite is open: Settings, and a suite's New window. */
export type AppWindowId = "settings" | "new-project";

/** Where the app's windows are, on their desktop over the whole app (`App.tsx`). */
export const useAppWindows = createWindows<AppWindowId>();
