import { create } from "zustand";

export type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "editor-theme";

const media = window.matchMedia("(prefers-color-scheme: dark)");

function resolve(theme: Theme): "light" | "dark" {
  return theme === "system" ? (media.matches ? "dark" : "light") : theme;
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", resolve(theme) === "dark");
}

interface ThemeState {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const initial = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "dark";

export const useTheme = create<ThemeState>((set) => ({
  theme: initial,
  resolved: resolve(initial),
  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
    set({ theme, resolved: resolve(theme) });
  },
}));

media.addEventListener("change", () => {
  const { theme } = useTheme.getState();
  if (theme !== "system") return;
  applyTheme(theme);
  useTheme.setState({ resolved: resolve(theme) });
});
