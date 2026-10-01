import { useRef, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { DEFAULT_FADER } from "@shared/music/project";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";
import { startPointerDrag } from "@/lib/pointer-drag";
import { detent, faderAt, faderDb } from "./meter";
import { useWheelValue } from "../wheel";

/** The handle's height, and how far a drag with Ctrl moves it for the same distance (fine changes). */
const HANDLE_H = 38;
/** How far (px) the pointer moves while the fader hangs at 0 dB. */
const HOLD_PX = 7;
/** Levels marked across the fader (FL's faint lines), in dB. */
const TICKS_DB = [0, -6, -12, -24];
const FINE = 10;

interface FaderProps {
  /** 0..1, the fader's position (`DEFAULT_FADER` is 0 dB). */
  value: number;
  label: string;
  /** Lit with the accent: its track is selected (FL Studio's green fader). */
  selected?: boolean;
  className?: string;
  onBegin: () => void;
  onDrag: (value: number) => void;
  onEnd: () => void;
  onCancel: () => void;
  /** Set outright: a reset, a typed value, a key. */
  onSet: (value: number) => void;
}

/**
 * A mixer track's level fader, FL Studio's: drag its handle (Ctrl for fine changes; it hangs at 0 dB on
 * the way past, unless Shift is held), or press its
 * groove to bring the handle there and drag on; Alt+click or a middle click puts it back at 0 dB; a
 * right-click opens its menu (Reset, Type in value, in dB). It shows its level in dB while it moves.
 */
export function Fader({ value, label, selected, className, onBegin, onDrag, onEnd, onCancel, onSet }: FaderProps) {
  const [dragging, setDragging] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const typingNext = useRef(false);
  const groove = useRef<HTMLDivElement>(null);
  useWheelValue(groove, { value: () => value, min: 0, max: 1, step: (fine) => (fine ? 0.005 : 0.025), onBegin, onDrag, onEnd });
  const handleTop = (v: number) => `calc((1 - ${v}) * (100% - ${HANDLE_H}px))`;

  const commitTyped = () => {
    const db = typing === null ? NaN : Number(typing.replace(",", ".").replace("−", "-"));
    if (Number.isFinite(db)) onSet(faderAt(db));
    setTyping(null);
  };

  return (
    <PopoverPrimitive.Root open={typing !== null} onOpenChange={(open) => !open && setTyping(null)}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <PopoverPrimitive.Anchor asChild>
            <div
              ref={groove}
              role="slider"
              tabIndex={0}
              aria-label={label}
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={1}
              aria-valuenow={value}
              aria-valuetext={faderDb(value)}
              title={`${label}: ${faderDb(value)}`}
              className={cn("relative w-[22px] cursor-ns-resize touch-none outline-none", className)}
              onPointerDown={(e) => {
                if (e.button === 1 || (e.button === 0 && e.altKey)) {
                  e.preventDefault();
                  onSet(DEFAULT_FADER);
                  return;
                }
                if (e.button !== 0) return;
                const rect = groove.current!.getBoundingClientRect();
                const travel = rect.height - HANDLE_H;
                const handleY = rect.top + (1 - value) * travel;
                // On the handle it's dragged from where it is; on the groove, it's brought there first.
                const onHandle = e.clientY >= handleY && e.clientY <= handleY + HANDLE_H;
                const start = onHandle ? value : clamp(1 - (e.clientY - rect.top - HANDLE_H / 2) / travel, 0, 1);
                const origin = e.clientY;
                let began = false;
                const begin = () => {
                  if (began) return;
                  began = true;
                  setDragging(true);
                  onBegin();
                };
                if (!onHandle) {
                  begin();
                  onDrag(start);
                }
                startPointerDrag(e, {
                  threshold: onHandle ? 2 : 0,
                  cursor: "ns-resize",
                  onStart: begin,
                  onMove(ev) {
                    const raw = clamp(start + (origin - ev.clientY) / (travel * (ev.ctrlKey || ev.metaKey ? FINE : 1)), 0, 1);
                    // It hangs at 0 dB for a few pixels on the way past (Shift: it doesn't).
                    onDrag(ev.shiftKey ? raw : detent(raw, DEFAULT_FADER, HOLD_PX / (travel * (ev.ctrlKey || ev.metaKey ? FINE : 1))));
                  },
                  onEnd() {
                    setDragging(false);
                    if (began) onEnd();
                  },
                  onCancel() {
                    setDragging(false);
                    if (began) onCancel();
                  },
                });
              }}
              onKeyDown={(e) => {
                const step = e.ctrlKey || e.metaKey ? 0.005 : 0.025;
                if (e.key === "ArrowUp") onSet(clamp(value + step, 0, 1));
                else if (e.key === "ArrowDown") onSet(clamp(value - step, 0, 1));
                else return;
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {/* FL Studio's fader: a thin dark groove (lit below the cap of a selected track), faint lines across at 0, -6, -12 and -24 dB, and a chunky metal cap. */}
              {/* The darker slot the fader runs in (FL's), then its groove. */}
              <span className="pointer-events-none absolute inset-y-0 left-1/2 w-[30px] -translate-x-1/2 rounded-[4px]" style={{ background: "var(--fader-slot)" }} aria-hidden />
              <span className="pointer-events-none absolute inset-y-1 left-1/2 w-[3px] -translate-x-1/2 rounded-full" style={{ background: "var(--fader-groove)", boxShadow: "inset 0 1px 1px rgb(0 0 0 / 0.5)" }} aria-hidden />
              {selected && (
                <span
                  className="pointer-events-none absolute bottom-1 left-1/2 w-px -translate-x-1/2"
                  style={{ top: `calc(${handleTop(value)} + ${HANDLE_H}px)`, background: "var(--fader-cap-on)" }}
                  aria-hidden
                />
              )}
              {TICKS_DB.map((db) => (
                <span
                  key={db}
                  className="pointer-events-none absolute -right-2.5 -left-2.5 h-px"
                  style={{ top: `calc(${handleTop(faderAt(db))} + ${HANDLE_H / 2}px)`, background: db === 0 ? "var(--fader-tick-strong)" : "var(--fader-tick)" }}
                  aria-hidden
                />
              ))}
              <span
                className="pointer-events-none absolute inset-x-[3px] rounded-[3px]"
                style={{
                  top: handleTop(value),
                  height: HANDLE_H,
                  background: capFace(selected ?? false),
                  boxShadow: `0 0 0 1px ${selected ? "var(--fader-cap-on-edge)" : "var(--fader-cap-edge)"}, 0 3px 4px rgb(0 0 0 / 0.5)`,
                }}
                aria-hidden
              />
              {dragging && (
                <span className="floating pointer-events-none absolute -top-6 left-1/2 z-20 -translate-x-1/2 rounded-sm px-1.5 py-0.5 text-[10px] whitespace-nowrap tabular-nums">
                  {faderDb(value)}
                </span>
              )}
            </div>
          </PopoverPrimitive.Anchor>
        </ContextMenuTrigger>
        {/* Choosing Type in value: the menu mustn't give the focus back to the control as it closes, or the field loses it and closes. */}
        <ContextMenuContent
          onCloseAutoFocus={(e) => {
            if (!typingNext.current) return;
            e.preventDefault();
            typingNext.current = false;
          }}
        >
          <ContextMenuItem onSelect={() => onSet(DEFAULT_FADER)}>Reset</ContextMenuItem>
          <ContextMenuSeparator />
          {/* After the menu has closed and given the focus back, or the field would lose it at once. */}
          <ContextMenuItem
            onSelect={() => {
              typingNext.current = true;
              setTimeout(() => setTyping(faderDb(value).replace(" dB", "").replace("−", "-").replace("∞", "inf")), 0);
            }}
          >
            Type in value…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent className="w-36 p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Input
            autoFocus
            aria-label={`${label} in dB`}
            inputMode="decimal"
            className="h-7"
            value={typing ?? ""}
            onChange={(e) => setTyping(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTyped();
              e.stopPropagation();
            }}
          />
          dB
        </label>
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}

/**
 * FL Studio's fader cap, as its picture: a cylinder (darker at its sides), a light curved top face, a dark
 * line across its middle, a shadow band under it, and a light lip at the foot. From the theme's tokens: the
 * metal (`--fader-cap-*`) or, on the selected track, the accent (`--fader-cap-on-*`).
 */
function capFace(selected: boolean): string {
  const [light, mid, dark] = selected
    ? ["var(--fader-cap-on-light)", "var(--fader-cap-on)", "var(--fader-cap-on-dark)"]
    : ["var(--fader-cap-light)", "var(--fader-cap)", "var(--fader-cap-dark)"];
  const sides = "linear-gradient(to right, rgb(0 0 0 / 0.3), rgb(0 0 0 / 0) 24%, rgb(255 255 255 / 0.08) 50%, rgb(0 0 0 / 0) 76%, rgb(0 0 0 / 0.3))";
  const bands = [
    `${light} 0%`,
    `${light} 7%`,
    `${mid} 30%`,
    `${light} 33%`,
    `${mid} 45%`,
    `rgb(20 22 28) 45%`,
    `rgb(20 22 28) 50%`,
    `${mid} 50%`,
    `${mid} 58%`,
    `${dark} 64%`,
    `color-mix(in oklab, ${dark} 70%, #000) 72%`,
    `${dark} 82%`,
    `${light} 94%`,
    `${mid} 100%`,
  ];
  return `${sides}, linear-gradient(to bottom, ${bands.join(", ")})`;
}
