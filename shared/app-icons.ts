import type { AppId } from "./apps.ts";

export const APP_ICONS = [
  // Each of the apps' own (docs/apps.md, scripts/make-icon.ts --app): only offered in one of them.
  { id: "app", name: "Its own", description: "This app's colours" },
  { id: "original", name: "Original", description: "White and purple" },
  { id: "banner-blue", name: "Banner blue", description: "Blue, gold and crimson" },
  { id: "banner-red", name: "Banner red", description: "Crimson, gold and blue" },
  { id: "saffron", name: "Saffron", description: "Yellow, red and cobalt" },
  { id: "midnight", name: "Midnight", description: "Navy, gold and ivory" },
  { id: "parchment", name: "Parchment", description: "Ivory, gold and burgundy" },
  { id: "evergreen", name: "Evergreen", description: "Green, gold and ivory" },
] as const;

export type AppIconId = (typeof APP_ICONS)[number]["id"];

export function isAppIconId(value: unknown): value is AppIconId {
  return APP_ICONS.some(({ id }) => id === value);
}

/** What an app starts with: its own icon, or YTStudio's for every suite at once. */
export const defaultAppIcon = (app: AppId | null): AppIconId => (app ? "app" : "original");

/** The icons an app offers: its own only where it has one. */
export const appIcons = (app: AppId | null) => APP_ICONS.filter(({ id }) => id !== "app" || app);

/** Where an icon's picture is; "app" is the app's own (YTStudio's without one). */
export const appIconFile = (id: AppIconId, app: AppId | null) => (id !== "app" ? `${id}.png` : app ? `apps/${app}.png` : "original.png");

export const appIconUrl = (id: AppIconId, app: AppId | null) => `/app-icons/${appIconFile(id, app)}`;
