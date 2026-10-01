import { useRef, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { DEFAULT_FADER } from "@shared/music/project";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";
import { startPointerDrag } from "@/lib/pointer-drag";
import { faderAt, faderDb } from "./meter";

/** The handle's height, and how far a drag with Ctrl moves it for the same distance (fine changes). */
const HANDLE_H = 12;
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
 * A mixer track's level fader, FL Studio's: drag its handle (Ctrl for fine changes), or press its
 * groove to bring the handle there and drag on; Alt+click or a middle click puts it back at 0 dB; a
 * right-click opens its menu (Reset, Type in value, in dB). It shows its level in dB while it moves.
 */
export function Fader({ value, label, selected, className, onBegin, onDrag, onEnd, onCancel, onSet }: FaderProps) {
  const [dragging, setDragging] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const groove = useRef<HTMLDivElement>(null);
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
              className={cn("relative w-5 cursor-ns-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring/60", className)}
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
                  onMove: (ev) => onDrag(clamp(start + (origin - ev.clientY) / (travel * (ev.ctrlKey || ev.metaKey ? FINE : 1)), 0, 1)),
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
              {/* The groove, and a mark at 0 dB. */}
              <span className="sunken pointer-events-none absolute inset-y-1 left-1/2 w-1 -translate-x-1/2 rounded-full" aria-hidden />
              <span
                className="pointer-events-none absolute left-0.5 right-0.5 h-px bg-line-strong"
                style={{ top: `calc(${handleTop(DEFAULT_FADER)} + ${HANDLE_H / 2}px)` }}
                aria-hidden
              />
              <span
                className={cn("pointer-events-none absolute inset-x-0 rounded-[3px]", selected ? "raised-brand" : "raised")}
                style={{ top: handleTop(value), height: HANDLE_H }}
                aria-hidden
              >
                <span className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-current opacity-40" />
              </span>
              {dragging && (
                <span className="floating pointer-events-none absolute -top-6 left-1/2 z-20 -translate-x-1/2 rounded-sm px-1.5 py-0.5 text-[10px] whitespace-nowrap tabular-nums">
                  {faderDb(value)}
                </span>
              )}
            </div>
          </PopoverPrimitive.Anchor>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onSet(DEFAULT_FADER)}>Reset</ContextMenuItem>
          <ContextMenuSeparator />
          {/* After the menu has closed and given the focus back, or the field would lose it at once. */}
          <ContextMenuItem onSelect={() => setTimeout(() => setTyping(faderDb(value).replace(" dB", "").replace("−", "-").replace("∞", "inf")), 0)}>
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
