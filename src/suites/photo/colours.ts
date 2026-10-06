/**
 * The photo editor's colours (Photoshop's foreground and background, the swatches at the foot of its tool strip):
 * one pair for every tool that paints or makes something coloured (the brush and fills now; text and shapes later),
 * kept in this browser across photos, as Photoshop keeps them. D makes them black and white, X swaps them.
 */
import { create } from "zustand";

const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
const KEY = "photo-colours";
/** Where the brush kept them before they were every tool's. */
const OLD_KEY = "photo-brush";

export interface Colours {
  /** "#rrggbb": what tools paint (on a mask, its grey: black hides, white reveals). */
  foreground: string;
  /** "#rrggbb": what Delete-style fills and the eraser on a mask use. */
  background: string;
}

const DEFAULTS: Colours = { foreground: "#000000", background: "#ffffff" };

const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);

export const sanitizeColours = (c: Partial<Record<keyof Colours, unknown>>): Colours => ({ foreground: hex(c.foreground, DEFAULTS.foreground), background: hex(c.background, DEFAULTS.background) });

function load(): Colours {
  try {
    return sanitizeColours(JSON.parse(storage.getItem(KEY) ?? storage.getItem(OLD_KEY) ?? "{}") as Partial<Colours>);
  } catch {
    return DEFAULTS;
  }
}

interface ColourStore extends Colours {
  set: (patch: Partial<Colours>) => void;
  /** D: black and white. */
  reset: () => void;
  /** X: swapped. */
  swap: () => void;
}

export const useColours = create<ColourStore>((set, get) => {
  const save = (patch: Partial<Colours>) => {
    const next = sanitizeColours({ foreground: get().foreground, background: get().background, ...patch });
    storage.setItem(KEY, JSON.stringify(next));
    set(next);
  };
  return {
    ...load(),
    set: save,
    reset: () => save(DEFAULTS),
    swap: () => save({ foreground: get().background, background: get().foreground }),
  };
});
