/** Panel controls for text parameters: the text itself, colours, and the installed fonts. */
import { useEffect, useMemo, useState } from "react";
import { PiCaretDown, PiCheck, PiMagnifyingGlass, PiWarning } from "react-icons/pi";
import type { FontFamily, FontStyleInfo, ParamValues } from "@shared/types";
import type { ColorSpec, FontSpec, FontStyleSpec, TextSpec } from "@shared/params";
import { ColorSwatchPicker } from "@/components/color-picker";
import { normalizeHex } from "@/lib/color";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "cn";
import { faceFromName, findFamily, resolveFace, useFonts } from "@/stores/fonts";
import type { ParamEditor } from "./param-rows";

interface ControlProps<S, V> {
  spec: S;
  value: V;
  label: string;
  disabled: boolean;
  edit: ParamEditor;
}

const fieldClass =
  "rounded border bg-background text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

/** Several lines of text; a typing session (focus to blur) is one undo step. */
export function TextControl({ value, label, disabled, edit }: ControlProps<TextSpec, string>) {
  return (
    <textarea
      aria-label={label}
      value={value}
      disabled={disabled}
      rows={Math.min(6, Math.max(2, value.split("\n").length))}
      spellCheck={false}
      onFocus={edit.begin}
      onBlur={edit.end}
      onChange={(e) => edit.set(e.target.value)}
      className={cn(fieldClass, "my-1 ml-1 w-full resize-none px-1.5 py-1 leading-snug")}
    />
  );
}

/** A swatch opening the colour picker, and the hex value to type into. */
export function ColorControl({ value, label, disabled, edit }: ControlProps<ColorSpec, string>) {
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = () => {
    if (draft === null) return;
    const hex = normalizeHex(draft);
    if (hex) edit.set(hex);
    setDraft(null);
  };

  return (
    <div className="ml-1 flex min-w-0 items-center gap-1.5">
      <ColorSwatchPicker value={value} label={label} disabled={disabled} edit={edit} />
      <input
        aria-label={`${label} hex`}
        value={draft ?? value.toUpperCase()}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        className={cn(fieldClass, "h-6 w-20 min-w-0 px-1.5 font-mono uppercase tabular-nums")}
      />
    </div>
  );
}

/** CSS for showing text in a font's style (for previews in the menus). */
function faceStyle(family: string, face: FontStyleInfo) {
  return {
    fontFamily: `"${family.replace(/["\\]/g, "\\$&")}", sans-serif`,
    fontWeight: face.weight,
    fontStyle: face.italic ? "italic" : "normal",
    fontStretch: face.stretch,
  };
}

/**
 * The installed style of `family` closest to `face` (same slope and width
 * first, then the nearest weight), so switching fonts keeps "Bold" bold.
 */
function closestStyle(family: string, face: FontStyleInfo): string | null {
  const styles = findFamily(family)?.styles;
  if (!styles?.length) return null;
  const cost = (s: FontStyleInfo) =>
    (s.italic !== face.italic ? 2000 : 0) + (s.stretch !== face.stretch ? 1000 : 0) + Math.abs(s.weight - face.weight);
  return styles.reduce((best, s) => (cost(s) < cost(best) ? s : best)).name;
}

/** A searchable list of the installed font families, each shown in itself. */
export function FontControl({
  value,
  label,
  disabled,
  edit,
  values,
  styleKey,
}: ControlProps<FontSpec, string> & { values: ParamValues; styleKey: string | undefined }) {
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
    if (family === value) return;
    const style = styleKey ? closestStyle(family, resolveFace(value, String(values[styleKey] ?? ""))) : null;
    edit.patch(style && styleKey ? { [edit.key]: family, [styleKey]: style } : { [edit.key]: family });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={label}
          className={cn(fieldClass, "ml-1 flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 px-2 text-left text-[13px]")}
        >
          {!installed && <PiWarning className="size-3.5 shrink-0 text-amber-500" aria-label="Not installed" />}
          <span className="min-w-0 flex-1 truncate" style={{ fontFamily: faceStyle(value, faceFromName("Regular")).fontFamily }}>
            {value}
          </span>
          <PiCaretDown className="size-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center gap-2 border-b px-2.5">
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
        <FontList status={status} shown={shown} query={query} value={value} choose={choose} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The families matching the search. Its own component so the hundreds of rows are only built
 * while the popover is open: the closed panel re-renders as the playhead moves over keyframes.
 */
function FontList({
  status,
  shown,
  query,
  value,
  choose,
}: {
  status: ReturnType<typeof useFonts.getState>["status"];
  shown: FontFamily[];
  query: string;
  value: string;
  choose: (family: string) => void;
}) {
  return (
    <div role="listbox" aria-label="Fonts" className="max-h-80 overflow-y-auto overscroll-contain p-1">
      {status === "loading" && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Loading fonts…</p>}
      {status === "error" && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Couldn't list the installed fonts.</p>}
      {status === "ready" && shown.length === 0 && (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">No fonts match “{query.trim()}”.</p>
      )}
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
  );
}

const BASIC_STYLES = ["Regular", "Italic", "Bold", "Bold Italic"];

/** The styles the chosen family has installed, each shown in itself. */
export function FontStyleControl({
  spec,
  value,
  label,
  disabled,
  edit,
  values,
}: ControlProps<FontStyleSpec, string> & { values: ParamValues }) {
  const family = String(values[spec.familyKey] ?? "");
  useFonts((s) => s.status); // re-render once the styles are known
  const installed = findFamily(family)?.styles;
  const styles = installed?.length ? installed : BASIC_STYLES.map(faceFromName);
  // Keep a style that isn't installed selectable (and visible) rather than silently changing it.
  const options = styles.some((s) => s.name === value) ? styles : [faceFromName(value), ...styles];

  return (
    <Select value={value} onValueChange={(v) => edit.set(v)} disabled={disabled}>
      <SelectTrigger size="sm" aria-label={label} className="ml-1 h-7! w-full min-w-0 rounded px-2 text-[13px] shadow-none">
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
