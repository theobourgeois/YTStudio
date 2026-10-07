/**
 * What the Type tool makes new text with (its options bar with no text layer selected: docs/photo/tools/type.md),
 * kept in this browser as Photoshop keeps the tool's last settings. The colour is the foreground colour (`colours.ts`).
 */
import { create } from "zustand";
import { DEFAULT_TEXT_FONT, MAX_FONT_SIZE, MIN_FONT_SIZE } from "@shared/photo/text";
import type { TextAlign, TextFont } from "@shared/photo/types";

const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
const KEY = "photo-type";

export interface TypeOptions {
  font: TextFont;
  align: TextAlign;
  leading: number | null;
  tracking: number;
}

const DEFAULTS: TypeOptions = { font: DEFAULT_TEXT_FONT, align: "left", leading: null, tracking: 0 };

/** Options from anywhere (storage, a patch), each wrong one back to its default. */
export function sanitizeTypeOptions(o: Partial<Record<keyof TypeOptions, unknown>>): TypeOptions {
  const f = (o.font && typeof o.font === "object" ? o.font : {}) as Partial<Record<keyof TextFont, unknown>>;
  const font: TextFont = {
    family: typeof f.family === "string" && f.family.trim() ? f.family : DEFAULTS.font.family,
    style: typeof f.style === "string" && f.style ? f.style : DEFAULTS.font.style,
    weight: typeof f.weight === "number" && f.weight >= 1 && f.weight <= 1000 ? f.weight : DEFAULTS.font.weight,
    italic: f.italic === true,
    ...(typeof f.stretch === "string" && f.stretch !== "normal" ? { stretch: f.stretch } : {}),
    size: typeof f.size === "number" && Number.isFinite(f.size) ? Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, f.size)) : DEFAULTS.font.size,
  };
  return {
    font,
    align: o.align === "center" || o.align === "right" || o.align === "justify" ? o.align : "left",
    leading: typeof o.leading === "number" && o.leading >= 1 ? o.leading : null,
    tracking: typeof o.tracking === "number" && Number.isFinite(o.tracking) ? o.tracking : 0,
  };
}

function load(): TypeOptions {
  try {
    return sanitizeTypeOptions(JSON.parse(storage.getItem(KEY) ?? "{}"));
  } catch {
    return DEFAULTS;
  }
}

interface TypeOptionsStore extends TypeOptions {
  set: (patch: Partial<Omit<TypeOptions, "font">> & { font?: Partial<TextFont> }) => void;
}

export const useTypeOptions = create<TypeOptionsStore>((set, get) => ({
  ...load(),
  set(patch) {
    const { font, align, leading, tracking } = get();
    const next = sanitizeTypeOptions({ font: { ...font, ...patch.font }, align: patch.align ?? align, leading: patch.leading !== undefined ? patch.leading : leading, tracking: patch.tracking ?? tracking });
    storage.setItem(KEY, JSON.stringify(next));
    set(next);
  },
}));
