import { useEffect, useRef, useState } from "react";
import { PiEyedropper } from "react-icons/pi";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Hsv, hexToHsv, hexToRgb, hsvToHex, normalizeHex, rgbToHex } from "@/lib/color";
import { startPointerDrag } from "@/lib/pointer-drag";

/** A change to the colour: `begin`, `set`*, `end` is one undo step (a drag, or one typed value). */
export interface ColorEdit {
  begin: () => void;
  set: (hex: string) => void;
  end: () => void;
}

/** A few colours to start from, and the ones picked lately (this browser's). */
const PRESETS = ["#ffffff", "#000000", "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#0a84ff", "#5e5ce6", "#bf5af2", "#ff2d55", "#8e8e93"];
const RECENT_KEY = "editor-recent-colours";
const MAX_RECENT = 12;

function readRecent(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string" && normalizeHex(c) !== null).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}
function remember(hex: string) {
  const list = [hex, ...readRecent().filter((c) => c !== hex)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

/** The browser's eyedropper (Chromium's), when it has one: picks a colour from anywhere on the screen. */
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const eyeDropper = () => (globalThis as { EyeDropper?: EyeDropperCtor }).EyeDropper;

/**
 * A swatch that opens the colour picker: a saturation/brightness square, a hue strip, the eyedropper,
 * hex and RGB to type, and swatches (presets and recent colours).
 */
export function ColorSwatchPicker({ value, label, disabled, edit, className }: { value: string; label: string; disabled?: boolean; edit: ColorEdit; className?: string }) {
  const opened = useRef(value);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) opened.current = value;
        else if (value !== opened.current) remember(value);
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "size-6 shrink-0 rounded border shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          style={{ background: value }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2.5" onOpenAutoFocus={(e) => e.preventDefault()}>
        <ColorPicker value={value} edit={edit} />
      </PopoverContent>
    </Popover>
  );
}

/** The picker itself (the popover's content). */
export function ColorPicker({ value, edit }: { value: string; edit: ColorEdit }) {
  // The hue and saturation are kept here: black and greys have none, and dragging through them mustn't lose them.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  useEffect(() => {
    setHsv((current) => (hsvToHex(current) === value ? current : keepHue(hexToHsv(value), current)));
  }, [value]);
  const [recent] = useState(readRecent);

  const show = (next: Hsv) => {
    setHsv(next);
    edit.set(hsvToHex(next));
  };
  /** One change outright (a swatch, a typed value, the eyedropper): one undo step. */
  const setOnce = (hex: string) => {
    edit.begin();
    edit.set(hex);
    edit.end();
  };

  return (
    <div className="flex flex-col gap-2.5">
      <SaturationValue hsv={hsv} edit={edit} onChange={show} />
      <div className="flex items-center gap-2">
        <EyedropperButton onPick={setOnce} />
        <span className="size-7 shrink-0 rounded-full border shadow-xs" style={{ background: value }} aria-hidden />
        <HueStrip hsv={hsv} edit={edit} onChange={show} />
      </div>
      <ColorFields value={value} onSet={setOnce} />
      <Swatches label="Colours" colors={PRESETS} value={value} onPick={setOnce} />
      {recent.length > 0 && <Swatches label="Recent" colors={recent} value={value} onPick={setOnce} />}
    </div>
  );
}

/** Greys have no hue and black no saturation: keep the ones being worked with. */
function keepHue(next: Hsv, current: Hsv): Hsv {
  if (next.v === 0) return { h: current.h, s: current.s, v: 0 };
  if (next.s === 0) return { ...next, h: current.h };
  return next;
}

/** The square: saturation across, brightness up. */
function SaturationValue({ hsv, edit, onChange }: { hsv: Hsv; edit: ColorEdit; onChange: (hsv: Hsv) => void }) {
  const at = (el: Element, ev: { clientX: number; clientY: number }): Hsv => {
    const r = el.getBoundingClientRect();
    return { h: hsv.h, s: clamp((ev.clientX - r.left) / r.width, 0, 1), v: clamp(1 - (ev.clientY - r.top) / r.height, 0, 1) };
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
      className="relative h-36 cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hsvToHex({ h: hsv.h, s: 1, v: 1 })}` }}
      onPointerDown={(e) => {
        const el = e.currentTarget;
        el.focus();
        edit.begin();
        onChange(at(el, e));
        if (!startPointerDrag(e, { threshold: 0, onMove: (ev) => onChange(at(el, ev)), onEnd: edit.end, onClick: edit.end, onCancel: edit.end })) edit.end();
      }}
      onKeyDown={(e) => {
        const by = e.shiftKey ? 0.1 : 0.01;
        const moves: Record<string, Partial<Hsv>> = {
          ArrowLeft: { s: clamp(hsv.s - by, 0, 1) },
          ArrowRight: { s: clamp(hsv.s + by, 0, 1) },
          ArrowUp: { v: clamp(hsv.v + by, 0, 1) },
          ArrowDown: { v: clamp(hsv.v - by, 0, 1) },
        };
        if (!moves[e.key]) return;
        e.preventDefault();
        edit.begin();
        onChange({ ...hsv, ...moves[e.key] });
        edit.end();
      }}
    >
      <span
        className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35),0_1px_3px_rgb(0_0_0/0.4)]"
        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }}
      />
    </div>
  );
}

const HUES = "linear-gradient(to right, #f00 0%, #ff0 16.67%, #0f0 33.33%, #0ff 50%, #00f 66.67%, #f0f 83.33%, #f00 100%)";

function HueStrip({ hsv, edit, onChange }: { hsv: Hsv; edit: ColorEdit; onChange: (hsv: Hsv) => void }) {
  const at = (el: Element, ev: { clientX: number }): Hsv => {
    const r = el.getBoundingClientRect();
    return { ...hsv, h: clamp((ev.clientX - r.left) / r.width, 0, 1) * 360 };
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Hue"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hsv.h)}
      className="relative h-3 min-w-0 flex-1 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      style={{ background: HUES }}
      onPointerDown={(e) => {
        const el = e.currentTarget;
        el.focus();
        edit.begin();
        onChange(at(el, e));
        if (!startPointerDrag(e, { threshold: 0, onMove: (ev) => onChange(at(el, ev)), onEnd: edit.end, onClick: edit.end, onCancel: edit.end })) edit.end();
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const by = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1);
        edit.begin();
        onChange({ ...hsv, h: clamp(hsv.h + by, 0, 360) });
        edit.end();
      }}
    >
      <span
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35),0_1px_3px_rgb(0_0_0/0.4)]"
        style={{ left: `${(hsv.h / 360) * 100}%`, background: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }}
      />
    </div>
  );
}

function EyedropperButton({ onPick }: { onPick: (hex: string) => void }) {
  const Dropper = eyeDropper();
  if (!Dropper) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Pick a colour from the screen"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:raised hover:text-foreground"
          onClick={() => {
            new Dropper()
              .open()
              .then((result) => {
                const hex = normalizeHex(result.sRGBHex);
                if (hex) onPick(hex);
              })
              .catch(() => {}); // Escape: nothing picked.
          }}
        >
          <PiEyedropper className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Pick from the screen</TooltipContent>
    </Tooltip>
  );
}

const fieldClass = "sunken h-7 w-full min-w-0 rounded-sm px-1 text-center font-mono text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** Hex and R, G, B to type into: each sets the colour when Enter is pressed or it's left. */
function ColorFields({ value, onSet }: { value: string; onSet: (hex: string) => void }) {
  const rgb = hexToRgb(value);
  return (
    <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-1.5">
      <TypedField
        label="Hex"
        value={value.toUpperCase()}
        className="uppercase"
        parse={(text) => normalizeHex(text)}
        onSet={onSet}
      />
      {(["r", "g", "b"] as const).map((channel) => (
        <TypedField
          key={channel}
          label={channel.toUpperCase()}
          value={String(rgb[channel])}
          inputMode="numeric"
          parse={(text) => {
            const n = Number(text.trim());
            return text.trim() !== "" && Number.isFinite(n) ? rgbToHex({ ...rgb, [channel]: clamp(Math.round(n), 0, 255) }) : null;
          }}
          onSet={onSet}
        />
      ))}
    </div>
  );
}

function TypedField({
  label,
  value,
  parse,
  onSet,
  className,
  inputMode,
}: {
  label: string;
  value: string;
  parse: (text: string) => string | null;
  onSet: (hex: string) => void;
  className?: string;
  inputMode?: "numeric";
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const hex = parse(draft);
    if (hex) onSet(hex);
    setDraft(null);
  };
  return (
    <label className="flex min-w-0 flex-col items-center gap-0.5">
      <input
        aria-label={label}
        value={draft ?? value}
        inputMode={inputMode}
        spellCheck={false}
        className={cn(fieldClass, className)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape" && draft !== null) {
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
    </label>
  );
}

function Swatches({ label, colors, value, onPick }: { label: string; colors: string[]; value: string; onPick: (hex: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      <div className="grid grid-cols-12 gap-1">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color.toUpperCase()}
            title={color.toUpperCase()}
            className={cn("aspect-square rounded-[3px] border border-black/20 outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring/50", color === value && "ring-2 ring-brand ring-offset-1 ring-offset-popover")}
            style={{ background: color }}
            onClick={() => onPick(color)}
          />
        ))}
      </div>
    </div>
  );
}
