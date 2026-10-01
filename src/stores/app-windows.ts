import { createWindows } from "@/components/windows/store";

/** The app's own windows, over whichever suite is open: Settings, so far. */
export type AppWindowId = "settings";

/** Where the app's windows are, on their desktop over the whole app (`App.tsx`). */
export const useAppWindows = createWindows<AppWindowId>();
