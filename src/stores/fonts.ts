import { create } from "zustand";
import type { FontFamily, FontStyleInfo } from "@shared/types";
import { api } from "@/lib/api";

/**
 * The fonts installed on this computer (listed by the server), for the font
 * pickers and for drawing text: a style name ("Bold Italic") becomes the CSS
 * weight, slope and width that select it.
 */
interface FontsState {
  families: FontFamily[];
  status: "idle" | "loading" | "ready" | "error";
  /** Fetch the list (once; again after an error). */
  load: () => void;
}

let index = new Map<string, FontFamily>();

export const useFonts = create<FontsState>((set, get) => ({
  families: [],
  status: "idle",
  load() {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading" });
    api.listFonts().then(
      (families) => {
        index = new Map(families.map((f) => [f.family.toLowerCase(), f]));
        set({ families, status: "ready" });
      },
      () => set({ status: "error" }),
    );
  },
}));

/** How many recently used families the pickers show first (Photoshop's default). */
export const RECENT_FONTS = 10;
const RECENT_KEY = "recent-fonts";
const storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage !== "undefined" ? localStorage : null;

/** `recent` with `family` first, once, at most `max` long. */
export function withRecentFont(recent: readonly string[], family: string, max = RECENT_FONTS): string[] {
  const key = family.toLowerCase();
  return [family, ...recent.filter((f) => f.toLowerCase() !== key)].slice(0, max);
}

/** The recent families still installed (in `families`), most recent first, as the list has them. */
export function recentFamilies(recent: readonly string[], families: readonly FontFamily[]): FontFamily[] {
  const byName = new Map(families.map((f) => [f.family.toLowerCase(), f]));
  return recent.flatMap((f) => byName.get(f.toLowerCase()) ?? []);
}

function loadRecent(): string[] {
  try {
    const list: unknown = JSON.parse(storage?.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((f): f is string => typeof f === "string" && !!f).slice(0, RECENT_FONTS) : [];
  } catch {
    return [];
  }
}

/** The families chosen lately in any font picker, most recent first: this computer's, shown at the top of the lists. */
export const useRecentFonts = create<{ recent: string[]; use: (family: string) => void }>((set, get) => ({
  recent: loadRecent(),
  use(family) {
    const recent = withRecentFont(get().recent, family);
    storage?.setItem(RECENT_KEY, JSON.stringify(recent));
    set({ recent });
  },
}));

/** Resolves once the font list has loaded (or failed to). */
export function fontsSettled(): Promise<void> {
  useFonts.getState().load();
  return new Promise((resolve) => {
    const settled = () => ["ready", "error"].includes(useFonts.getState().status);
    if (settled()) return resolve();
    const off = useFonts.subscribe(() => {
      if (!settled()) return;
      off();
      resolve();
    });
  });
}

export function findFamily(family: string): FontFamily | undefined {
  return index.get(family.toLowerCase());
}

/**
 * The CSS face for a family's style: from the installed font when it's known,
 * else guessed from the style's name (a font that isn't installed falls back
 * to the default sans-serif anyway).
 */
export function resolveFace(family: string, style: string): FontStyleInfo {
  const styles = findFamily(family)?.styles;
  const known = styles?.find((s) => s.name.toLowerCase() === style.toLowerCase());
  return known ?? faceFromName(style);
}

const WEIGHTS: [RegExp, number][] = [
  [/\b(hairline|thin)\b/, 100],
  [/\b(extra|ultra)[\s-]?light\b/, 200],
  [/\blight\b/, 300],
  [/\bmedium\b/, 500],
  [/\b(semi|demi)[\s-]?bold\b/, 600],
  [/\b(extra|ultra)[\s-]?bold\b/, 800],
  [/\bbold\b/, 700],
  [/\b(black|heavy)\b/, 900],
];

export function faceFromName(style: string): FontStyleInfo {
  const name = style.toLowerCase();
  const weight = WEIGHTS.find(([re]) => re.test(name))?.[1] ?? 400;
  return {
    name: style,
    weight,
    italic: /\b(italic|oblique)\b/.test(name),
    stretch: /\b(condensed|compressed|narrow)\b/.test(name) ? "condensed" : /\bexpanded\b/.test(name) ? "expanded" : "normal",
  };
}
