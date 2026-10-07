/**
 * The installed fonts (`src/stores/fonts.ts`, the platform's list), for the Type tool's options bar and a text layer's
 * Properties: a searchable list of families, each shown in itself, and the chosen family's styles.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { PiCaretDown, PiCheck, PiMagnifyingGlass, PiWarning } from "react-icons/pi";
import { cn } from "cn";
import type { TextFont } from "@shared/photo/types";
import type { FontStyleInfo } from "@shared/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { faceFromName, findFamily, recentFamilies, resolveFace, useFonts, useRecentFonts } from "@/stores/fonts";

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

/** How long the pointer rests on a family (or the keys on it) before the canvas shows it: a quick sweep doesn't redraw. */
const PREVIEW_DELAY = 60;

/**
 * A font family: a button showing it (a select's), opening the searchable list. `onChoose` gets the family's name;
 * `onPreview` the family hovered or reached with the arrows while the list is open (Photoshop's live font preview),
 * and null when there's none to show (the list closed, or chosen from).
 */
export function FontFamilyPicker({ value, onChoose, onPreview, className }: { value: string; onChoose: (family: string) => void; onPreview?: (family: string | null) => void; className?: string }) {
  const families = useFonts((s) => s.families);
  const status = useFonts((s) => s.status);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  const previewing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => useFonts.getState().load(), []);
  const installed = status !== "ready" || !!findFamily(value);
  const recentNames = useRecentFonts((s) => s.recent);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? families.filter((f) => f.family.toLowerCase().includes(q)) : families;
  }, [families, query]);
  // The families used lately first (Photoshop's), unless searching; then every family. One list for the keys.
  const recent = useMemo(() => (query.trim() ? [] : recentFamilies(recentNames, families)), [query, recentNames, families]);
  const rows = useMemo(() => [...recent, ...shown], [recent, shown]);

  const preview = (family: string | null) => {
    if (!onPreview) return;
    if (previewing.current) clearTimeout(previewing.current);
    previewing.current = null;
    if (family === null || family === value) return onPreview(null);
    previewing.current = setTimeout(() => onPreview(family), PREVIEW_DELAY);
  };
  // Nothing previewed once the list is gone (or this picker is).
  useEffect(() => () => preview(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const highlight = (index: number, scroll: boolean) => {
    setActive(index);
    preview(rows[index]?.family ?? null);
    if (scroll) list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const openChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      // The list opens on the family there is, as a select's does.
      const at = [...recentFamilies(recentNames, families), ...families].findIndex((f) => f.family === value);
      setActive(at);
      requestAnimationFrame(() => list.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: "center" }));
    } else {
      setQuery("");
      preview(null);
    }
  };
  const choose = (family: string) => {
    openChange(false);
    useRecentFonts.getState().use(family);
    if (family !== value) onChoose(family);
  };
  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Font family"
          title={installed ? "Font family" : `${value} isn't installed: it's drawn in the fallback font`}
          className={cn(
            "sunken flex h-6 min-w-0 items-center gap-1.5 rounded-md px-2.5 text-left text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            className,
          )}
          data-font-family={value}
        >
          {!installed && <PiWarning className="size-3.5 shrink-0 text-amber-500" aria-label="Not installed" />}
          <span className="min-w-0 flex-1 truncate" style={{ fontFamily: faceStyle(value, faceFromName("Regular")).fontFamily }}>
            {value}
          </span>
          <PiCaretDown className="size-3.5 shrink-0 text-muted-foreground opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" onOpenAutoFocus={(e) => e.preventDefault()} data-font-list>
        <div className="flex items-center gap-2 border-b border-line px-2.5">
          <PiMagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            aria-label="Search fonts"
            placeholder={families.length ? `Search ${families.length} fonts` : "Search fonts"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              preview(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!rows.length) return;
                const step = e.key === "ArrowDown" ? 1 : -1;
                highlight(active < 0 ? 0 : (active + step + rows.length) % rows.length, true);
              } else if (e.key === "Enter") {
                const pick = rows[active] ?? rows[0];
                if (pick) choose(pick.family);
              }
            }}
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={list} role="listbox" aria-label="Fonts" className="max-h-80 overflow-y-auto overscroll-contain p-1" onPointerLeave={() => preview(null)}>
          {status === "loading" && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Loading fonts…</p>}
          {status === "error" && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Couldn't list the installed fonts.</p>}
          {status === "ready" && shown.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">No fonts match “{query.trim()}”.</p>}
          {rows.map((f, i) => {
            const regular = f.styles.find((s) => s.weight === 400 && !s.italic) ?? f.styles[0];
            const selected = f.family === value;
            const inRecent = i < recent.length;
            return (
              <Fragment key={`${inRecent ? "recent" : "all"}:${f.family}`}>
              {recent.length > 0 && (i === 0 || i === recent.length) && (
                <div className={cn("px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground", i > 0 && "mt-1 border-t border-line pt-2")} data-font-section={i === 0 ? "recent" : "all"}>
                  {i === 0 ? "Recent" : "All fonts"}
                </div>
              )}
              <div
                data-recent={inRecent || undefined}
                role="option"
                aria-selected={selected}
                data-index={i}
                data-active={i === active || undefined}
                onPointerMove={() => i !== active && highlight(i, false)}
                onClick={() => choose(f.family)}
                className="relative flex w-full cursor-default items-center gap-2 rounded-sm py-1 pr-8 pl-2 text-[13px] select-none data-[active]:bg-brand/20 data-[active]:text-foreground"
              >
                <span className="min-w-0 flex-1 truncate text-sm leading-5" style={faceStyle(f.family, regular)}>
                  {f.family}
                </span>
                {f.styles.length > 1 && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{f.styles.length}</span>}
                {selected && <PiCheck className="absolute right-2 size-4 text-muted-foreground" />}
              </div>
              </Fragment>
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
