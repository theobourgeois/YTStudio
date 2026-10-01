import { create } from "zustand";
import { type ThemeChoice, type ThemeId, isThemeId, resolveTheme, themeInfo } from "@/themes";

export { THEMES, type ThemeChoice, type ThemeId } from "@/themes";

/** A font the interface can be set in: its CSS stack (the bundled font first, `src/index.css`). */
export interface FontChoice {
  id: string;
  name: string;
  stack: string;
}

const SANS_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const MONO_FALLBACK = 'ui-monospace, "SF Mono", Menlo, monospace';

/** The interface's font (Tailwind's `font-sans`). The first is the default (`@theme` in `index.css`). */
export const FONTS: FontChoice[] = [
  { id: "dm-sans", name: "DM Sans", stack: `"DM Sans Variable", ${SANS_FALLBACK}` },
  { id: "inter", name: "Inter", stack: `"Inter Variable", ${SANS_FALLBACK}` },
  { id: "geist", name: "Geist", stack: `"Geist Variable", ${SANS_FALLBACK}` },
  { id: "ibm-plex-sans", name: "IBM Plex Sans", stack: `"IBM Plex Sans Variable", ${SANS_FALLBACK}` },
  { id: "figtree", name: "Figtree", stack: `"Figtree Variable", ${SANS_FALLBACK}` },
  { id: "manrope", name: "Manrope", stack: `"Manrope Variable", ${SANS_FALLBACK}` },
  // Windows XP's, for Luna (installed on Macs and Windows alike).
  { id: "tahoma", name: "Tahoma", stack: `Tahoma, Verdana, ${SANS_FALLBACK}` },
  { id: "system", name: "System", stack: SANS_FALLBACK },
];

/** Numbers, times and code (Tailwind's `font-mono`). The first is the default. */
export const MONO_FONTS: FontChoice[] = [
  { id: "geist-mono", name: "Geist Mono", stack: `"Geist Mono Variable", ${MONO_FALLBACK}` },
  { id: "jetbrains-mono", name: "JetBrains Mono", stack: `"JetBrains Mono Variable", ${MONO_FALLBACK}` },
  { id: "ibm-plex-mono", name: "IBM Plex Mono", stack: `"IBM Plex Mono", ${MONO_FALLBACK}` },
  { id: "fira-code", name: "Fira Code", stack: `"Fira Code Variable", ${MONO_FALLBACK}` },
  { id: "system-mono", name: "System", stack: MONO_FALLBACK },
];

// `index.html` reads these too, to paint the first frame in the right theme and fonts.
const CHOICE_KEY = "editor-theme-choice";
/** Whether the theme picked (not `system`) is a dark one, so `index.html` needn't know the list. */
const DARK_KEY = "editor-theme-dark";
/** Before themes were single looks: "light" | "dark" | "system" (and `editor-theme-id`, always Studio). */
const LEGACY_APPEARANCE_KEY = "editor-theme";
// The font's id, and its stack (all `index.html` needs) under the same name plus `-stack`.
const FONT_KEY = "editor-font";
const MONO_FONT_KEY = "editor-mono-font";

const media = window.matchMedia("(prefers-color-scheme: dark)");

/** The classes that put an element in a theme (a theme's preview in Settings wears them too). */
export const themeClasses = (theme: ThemeId) => `theme theme-${theme}${themeInfo(theme).dark ? " dark" : ""}`;

/** Puts the theme's classes on <html>; `.dark` still means "a dark theme is showing". */
export function applyTheme(theme: ThemeId, root: Element = document.documentElement) {
  for (const name of [...root.classList]) if (name.startsWith("theme-") && name !== `theme-${theme}`) root.classList.remove(name);
  root.classList.add("theme", `theme-${theme}`);
  root.classList.toggle("dark", themeInfo(theme).dark);
}

const fontById = (fonts: FontChoice[], id: string | null) => fonts.find((f) => f.id === id) ?? fonts[0];

/** Sets the interface's fonts on <html> (Tailwind's `font-sans` and `font-mono` read these variables). */
function applyFonts(font: FontChoice, mono: FontChoice, root: HTMLElement = document.documentElement) {
  root.style.setProperty("--font-sans", font.stack);
  root.style.setProperty("--font-mono", mono.stack);
}

interface ThemeState {
  /** What's picked: a theme, or `system` (Light or Dark as the computer is). */
  choice: ThemeChoice;
  /** The theme showing. */
  theme: ThemeId;
  resolved: "light" | "dark";
  /** The interface's font and the numbers' (`FONTS`, `MONO_FONTS`), by id. */
  font: string;
  monoFont: string;
  setTheme: (choice: ThemeChoice) => void;
  setFont: (id: string) => void;
  setMonoFont: (id: string) => void;
}

/** The saved choice; the old light / dark / system setting carries over, and nothing saved is `system`. */
function savedChoice(): ThemeChoice {
  const saved = localStorage.getItem(CHOICE_KEY);
  if (saved === "system" || isThemeId(saved)) return saved;
  const legacy = localStorage.getItem(LEGACY_APPEARANCE_KEY);
  return legacy === "light" || legacy === "dark" ? legacy : "system";
}

const showing = (choice: ThemeChoice) => {
  const theme = resolveTheme(choice, media.matches);
  return { theme, resolved: themeInfo(theme).dark ? ("dark" as const) : ("light" as const) };
};

const initialChoice = savedChoice();
const initialFont = fontById(FONTS, localStorage.getItem(FONT_KEY));
const initialMono = fontById(MONO_FONTS, localStorage.getItem(MONO_FONT_KEY));
applyTheme(showing(initialChoice).theme);
applyFonts(initialFont, initialMono);

function saveFont(key: string, font: FontChoice) {
  localStorage.setItem(key, font.id);
  localStorage.setItem(`${key}-stack`, font.stack);
}

export const useTheme = create<ThemeState>((set, get) => ({
  choice: initialChoice,
  ...showing(initialChoice),
  font: initialFont.id,
  monoFont: initialMono.id,
  setTheme: (choice) => {
    localStorage.setItem(CHOICE_KEY, choice);
    if (choice !== "system") localStorage.setItem(DARK_KEY, String(themeInfo(choice).dark));
    const next = showing(choice);
    applyTheme(next.theme);
    set({ choice, ...next });
  },
  setFont: (id) => {
    const font = fontById(FONTS, id);
    saveFont(FONT_KEY, font);
    applyFonts(font, fontById(MONO_FONTS, get().monoFont));
    set({ font: font.id });
  },
  setMonoFont: (id) => {
    const mono = fontById(MONO_FONTS, id);
    saveFont(MONO_FONT_KEY, mono);
    applyFonts(fontById(FONTS, get().font), mono);
    set({ monoFont: mono.id });
  },
}));

// System follows the computer as it changes.
media.addEventListener("change", () => {
  const { choice } = useTheme.getState();
  if (choice !== "system") return;
  const next = showing(choice);
  applyTheme(next.theme);
  useTheme.setState(next);
});
