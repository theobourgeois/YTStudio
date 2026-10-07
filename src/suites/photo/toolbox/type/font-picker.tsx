/**
 * The installed fonts (`src/stores/fonts.ts`, the platform's list), for the Type tool's options bar and a text layer's
 * Properties: a searchable list of families, each shown in itself, and the chosen family's styles.
 */
import { useEffect, useMemo, useState } from "react";
import { PiCaretDown, PiCheck, PiMagnifyingGlass, PiWarning } from "react-icons/pi";
import { cn } from "cn";
import type { TextFont } from "@shared/photo/types";
import type { FontStyleInfo } from "@shared/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { faceFromName, findFamily, resolveFace, useFonts } from "@/stores/fonts";

/** CSS that shows text in a face (the menus' previews). */
const faceStyle = (family: string, face: Pick<FontStyleInfo, "weight" | "italic" | "stretch">) => ({
  fontFamily: `"${family.replace(/["\\]/g, "\\$&")}", sans-serif`,
  fontWeight: face.weight,
  fontStyle: face.italic ? "italic" : "normal",
  fontStretch: face.stretch,
});

/** A face as a text's font fields. */
export const faceFields = (face: FontStyleInfo): Pick<TextFont, "style" | "weight" | "italic" | "stretch"> => ({ style: face.name, weight: face.weight, italic: face.italic, stretch: face.stretch });

/** The installed style of `family` nearest `font`'s (slope and width first, then weight): switching keeps Bold bold. */
export function closestFace(family: string, font: Pick<TextFont, "weight" | "italic" | "stretch">): FontStyleInfo {
  const styles = findFamily(family)?.styles;
  if (!styles?.length) return faceFromName(font.italic ? (font.weight >= 600 ? "Bold Italic" : "Italic") : font.weight >= 600 ? "Bold" : "Regular");
  const cost = (s: FontStyleInfo) => (s.italic !== font.italic ? 2000 : 0) + (s.stretch !== (font.stretch ?? "normal") ? 1000 : 0) + Math.abs(s.weight - font.weight);
  return styles.reduce((best, s) => (cost(s) < cost(best) ? s : best));
}

/** A font family: a button showing it, opening the searchable list. `onChoose` gets the family's name. */
export function FontFamilyPicker({ value, onChoose, className }: { value: string; onChoose: (family: string) => void; className?: string }) {
  const families = useFonts((s) => s.families);
  const status = useFonts((s) => s.status);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => useFonts.getState().load(), []);
  const installed = status !== "ready" || !!findFamily(value);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? families.filter((f) => f.family.toLowerCase().includes(q)) : families;
  }, [families, query]);
  const choose = (family: string) => {
    setOpen(false);
    setQuery("");
    if (family !== value) onChoose(family);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Font family"
          title={installed ? "Font family" : `${value} isn't installed: it's drawn in the fallback font`}
          className={cn("flex h-6 min-w-0 items-center gap-1.5 rounded border border-line bg-surface-0 px-2 text-left text-xs", className)}
          data-font-family={value}
        >
          {!installed && <PiWarning className="size-3.5 shrink-0 text-amber-500" aria-label="Not installed" />}
          <span className="min-w-0 flex-1 truncate" style={{ fontFamily: faceStyle(value, faceFromName("Regular")).fontFamily }}>
            {value}
          </span>
          <PiCaretDown className="size-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-2 border-b border-line px-2.5">
          <PiMagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            aria-label="Search fonts"
            placeholder={families.length ? `Search ${families.length} fonts` : "Search fonts"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) choose(shown[0].family);
            }}
            className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div role="listbox" aria-label="Fonts" className="max-h-80 overflow-y-auto overscroll-contain p-1">
          {status === "loading" && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Loading fonts…</p>}
          {status === "error" && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Couldn't list the installed fonts.</p>}
          {status === "ready" && shown.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">No fonts match “{query.trim()}”.</p>}
          {shown.map((f) => {
            const regular = f.styles.find((s) => s.weight === 400 && !s.italic) ?? f.styles[0];
            const selected = f.family === value;
            return (
              <button
                key={f.family}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => choose(f.family)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate text-[15px] leading-6" style={faceStyle(f.family, regular)}>
                  {f.family}
                </span>
                {f.styles.length > 1 && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{f.styles.length}</span>}
                <PiCheck className={cn("size-3.5 shrink-0", !selected && "invisible")} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const BASIC_STYLES = ["Regular", "Italic", "Bold", "Bold Italic"];

/** The chosen family's installed styles, each shown in itself. `onChoose` gets the face. */
export function FontStylePicker({ family, value, onChoose, className }: { family: string; value: string; onChoose: (face: FontStyleInfo) => void; className?: string }) {
  useFonts((s) => s.status); // again once the styles are known
  const installed = findFamily(family)?.styles;
  const styles = installed?.length ? installed : BASIC_STYLES.map(faceFromName);
  // A style that isn't installed stays selectable (and visible) rather than silently changing.
  const options = styles.some((s) => s.name === value) ? styles : [faceFromName(value), ...styles];
  return (
    <Select value={value} onValueChange={(v) => onChoose(options.find((s) => s.name === v) ?? resolveFace(family, v))}>
      <SelectTrigger size="sm" aria-label="Font style" className={cn("h-6 text-xs", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="max-h-80">
        {options.map((s) => (
          <SelectItem key={s.name} value={s.name}>
            <span style={faceStyle(family, s)}>{s.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
