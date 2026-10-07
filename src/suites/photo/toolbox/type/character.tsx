/**
 * Photoshop's Character panel, the whole layer's (docs/photo/tools/type.md): leading (Auto or pixels), tracking,
 * kerning (the font's own, or none), horizontal and vertical scale, and the row of type buttons (Faux Bold, Faux
 * Italic, All Caps, Small Caps, Underline, Strikethrough). Properties shows it under the family, style and size; the
 * options bar's Character button opens it. Each change is one undo step (while typing: part of that step).
 */
import { PiTextB, PiTextItalic, PiTextStrikethrough, PiTextUnderline } from "react-icons/pi";
import { type CharacterPatch, MAX_TEXT_SCALE, MIN_TEXT_SCALE, type TextPatch, leadingOf } from "@shared/photo/text";
import type { TextCharacter, TextLayer } from "@shared/photo/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Toggle } from "../../options-bar";
import { NumberField } from "../../panels/fields";

/** What the panel shows: a text layer's setting, or what new text is made with. */
export type CharacterValues = Pick<TextLayer, "font" | "leading" | "tracking"> & TextCharacter;

const round = (n: number) => Math.round(n * 100) / 100;
const percent = (scale: number | undefined) => round((scale ?? 1) * 100);
const fromPercent = (v: number) => Math.max(MIN_TEXT_SCALE, Math.min(MAX_TEXT_SCALE, v / 100));

/** The type buttons: each an on/off of the whole layer (the caps are one or the other). */
const STYLES: { key: "fauxBold" | "fauxItalic" | "caps:all" | "caps:small" | "underline" | "strikethrough"; label: string; icon: React.ReactNode }[] = [
  { key: "fauxBold", label: "Faux Bold", icon: <PiTextB /> },
  { key: "fauxItalic", label: "Faux Italic", icon: <PiTextItalic /> },
  { key: "caps:all", label: "All Caps", icon: <span className="text-[11px] font-semibold">TT</span> },
  { key: "caps:small", label: "Small Caps", icon: <span className="text-[11px] font-semibold">T<span className="text-[8px]">T</span></span> },
  { key: "underline", label: "Underline", icon: <PiTextUnderline /> },
  { key: "strikethrough", label: "Strikethrough", icon: <PiTextStrikethrough /> },
];

const stylesOn = (v: TextCharacter) => STYLES.filter(({ key }) => (key.startsWith("caps:") ? v.caps === key.slice(5) : v[key as "fauxBold"] === true)).map(({ key }) => key);

/** The buttons pressed now → what changed from `before` (All Caps and Small Caps take each other's place). */
function stylesPatch(before: TextCharacter, on: string[]): CharacterPatch {
  const was = new Set(stylesOn(before));
  const patch: CharacterPatch = {};
  for (const key of ["fauxBold", "fauxItalic", "underline", "strikethrough"] as const) if (was.has(key) !== on.includes(key)) patch[key] = on.includes(key);
  const added = on.find((k) => k.startsWith("caps:") && !was.has(k as "caps:all"));
  if (added) patch.caps = added.slice(5) as "all" | "small";
  else if (!on.some((k) => k.startsWith("caps:")) && before.caps) patch.caps = "none";
  return patch;
}

/** `withSize`: the font size first (Properties'; the options bar has its own). */
export function CharacterControls({ values, set, withSize = false }: { values: CharacterValues; set: (patch: TextPatch) => void; withSize?: boolean }) {
  return (
    <div className="flex flex-col gap-2" data-character-controls>
      <div className="grid grid-cols-3 gap-2">
        {withSize && <NumberField label="Size" value={round(values.font.size)} onCommit={(size) => set({ font: { size } })} suffix="px" />}
        <NumberField label="Leading" value={round(leadingOf(values))} onCommit={(leading) => set({ leading: Math.max(1, leading) })} suffix="px" />
        <NumberField label="Tracking" value={round(values.tracking)} onCommit={(tracking) => set({ tracking: Math.max(-1000, Math.min(10_000, tracking)) })} />
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Kerning</span>
          <Select value={values.kerning ?? "metrics"} onValueChange={(kerning) => set({ kerning: kerning as "metrics" | "none" })}>
            <SelectTrigger size="sm" aria-label="Kerning" className="h-7 w-full text-xs" data-option="Kerning">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="metrics">Metrics</SelectItem>
              <SelectItem value="none">0</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <NumberField label="Horizontal" value={percent(values.horizontalScale)} onCommit={(v) => set({ horizontalScale: fromPercent(v) })} suffix="%" />
        <NumberField label="Vertical" value={percent(values.verticalScale)} onCommit={(v) => set({ verticalScale: fromPercent(v) })} suffix="%" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 whitespace-nowrap">
        <ToggleGroup type="multiple" size="sm" variant="outline" value={stylesOn(values)} onValueChange={(on) => set(stylesPatch(values, on))} aria-label="Type styles">
          {STYLES.map(({ key, label, icon }) => (
            <ToggleGroupItem key={key} value={key} aria-label={label} title={label} className="px-1.5" data-text-style={key}>
              {icon}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Toggle label="Auto leading" title="Leading at Auto: 120% of the size" checked={values.leading === null} onChange={(auto) => set({ leading: auto ? null : leadingOf(values) })} />
      </div>
    </div>
  );
}
