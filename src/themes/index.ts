/**
 * The app's themes (pure: `stores/theme.ts` applies them, tests read them). Each is one complete look, light
 * or dark, in a CSS file of this folder: Light and Dark are Studio's two halves (`studio.css`, the base every
 * theme starts from); the others say what they change (`.theme.theme-<id>`) and `derived.css` works out the
 * rest. Adding one is its file, its import in `index.css`, and a line here. The `dark` ones also get the
 * `dark` class (Tailwind's `dark:`, the Piano roll's palette), and Studio's dark values as their base.
 */
export const THEMES = [
  { id: "light", name: "Light", description: "Blue-grey, blue accent", dark: false },
  { id: "dark", name: "Dark", description: "Blue-grey, blue accent", dark: true },
  { id: "luna", name: "Luna", description: "Windows XP: cream, glossy blue", dark: false },
  { id: "ultraviolet", name: "Ultraviolet", description: "Deep purple, hot pink", dark: true },
  { id: "synthwave", name: "Synthwave", description: "Night blue, neon pink and cyan", dark: true },
  { id: "terminal", name: "Terminal", description: "Green phosphor on black", dark: true },
  { id: "bubblegum", name: "Bubblegum", description: "Pastel pink, raspberry", dark: false },
  { id: "contrast", name: "High contrast", description: "Black, white, yellow: strongest", dark: true },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/** What's picked: a theme, or `system`, which is Light or Dark as the computer is. */
export type ThemeChoice = ThemeId | "system";

export const isThemeId = (id: unknown): id is ThemeId => THEMES.some((t) => t.id === id);

export const themeInfo = (id: ThemeId) => THEMES.find((t) => t.id === id)!;

/** The theme a choice shows, given whether the computer is in dark mode. */
export const resolveTheme = (choice: ThemeChoice, systemDark: boolean): ThemeId => (choice === "system" ? (systemDark ? "dark" : "light") : choice);
