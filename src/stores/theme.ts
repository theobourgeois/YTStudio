import { create } from "zustand";

/**
 * The app's themes. A theme is a CSS file in `src/themes/` that sets the variables `src/index.css` maps to
 * Tailwind, under a `theme-<id>` class, with its dark variant under `theme-<id>.dark`. Adding one is that
 * file, its import in `index.css` and a line here.
 */
export const THEMES = [{ id: "studio", name: "Studio" }] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

/** Which variant of the theme shows: `system` follows the computer's. */
export type Appearance = "light" | "dark" | "system";

// `index.html` reads these too, to paint the first frame in the right theme.
const THEME_KEY = "editor-theme-id";
const APPEARANCE_KEY = "editor-theme";

const media = window.matchMedia("(prefers-color-scheme: dark)");

function resolve(appearance: Appearance): "light" | "dark" {
  return appearance === "system" ? (media.matches ? "dark" : "light") : appearance;
}

const isTheme = (id: string | null): id is ThemeId => THEMES.some((t) => t.id === id);

/** Puts the theme's classes on <html>; `.dark` still means "a dark variant is showing". */
export function applyTheme(theme: ThemeId, appearance: Appearance, root: Element = document.documentElement) {
  for (const name of [...root.classList]) if (name.startsWith("theme-") && name !== `theme-${theme}`) root.classList.remove(name);
  root.classList.add(`theme-${theme}`);
  root.classList.toggle("dark", resolve(appearance) === "dark");
}

interface ThemeState {
  theme: ThemeId;
  appearance: Appearance;
  resolved: "light" | "dark";
  setTheme: (theme: ThemeId) => void;
  setAppearance: (appearance: Appearance) => void;
}

const savedTheme = localStorage.getItem(THEME_KEY);
const initialTheme: ThemeId = isTheme(savedTheme) ? savedTheme : THEMES[0].id;
const initialAppearance = (localStorage.getItem(APPEARANCE_KEY) as Appearance | null) ?? "dark";
applyTheme(initialTheme, initialAppearance);

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initialTheme,
  appearance: initialAppearance,
  resolved: resolve(initialAppearance),
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme, get().appearance);
    set({ theme });
  },
  setAppearance: (appearance) => {
    localStorage.setItem(APPEARANCE_KEY, appearance);
    applyTheme(get().theme, appearance);
    set({ appearance, resolved: resolve(appearance) });
  },
}));

media.addEventListener("change", () => {
  const { theme, appearance } = useTheme.getState();
  if (appearance !== "system") return;
  applyTheme(theme, appearance);
  useTheme.setState({ resolved: resolve(appearance) });
});
