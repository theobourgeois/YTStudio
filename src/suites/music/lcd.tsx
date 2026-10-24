import { type ReactNode, useRef, useState } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { PopoverContent } from "@/components/ui/popover";
import { startPointerDrag } from "@/lib/pointer-drag";
import { resolveControlKey } from "./control-keys";
import { useWheelValue } from "./wheel";

/** Pixels of drag per step of the value. */
const DRAG_STEP = 6;

interface LcdProps {
  value: number;
  min: number;
  max: number;
  label: string;
  /** What it shows (default: the number). */
  text?: string;
  /** Dimmed: the value isn't set, it's worked out (Auto). */
  derived?: boolean;
  /** Its right-click menu's items. */
  menu?: ReactNode;
  /**
   * Its menu gets Type in value: a field that opens with `typeIn.initial` and is given the text typed
   * (Enter), to make sense of (a number, or a word like "master").
   */
  typeIn?: { initial: string; onType: (text: string) => void };
  className?: string;
  onBegin: () => void;
  onChange: (value: number) => void;
  onEnd: () => void;
  onCancel: () => void;
}

/**
 * A number display, FL Studio's "LCD" (the pattern length; later, mixer track numbers): drag up and
 * down on it (or scroll over it) to change the number, right-click for its menu.
 */
export function Lcd({ value, min, max, label, text, derived, menu, typeIn, className, onBegin, onChange, onEnd, onCancel }: LcdProps) {
  const [typing, setTyping] = useState<string | null>(null);
  const typingNext = useRef(false);
  // Typed in by typing a number on it: the field starts with that character, the caret after it.
  const caretAtEnd = useRef(false);
  const element = useRef<HTMLDivElement>(null);
  useWheelValue(element, { value: () => value, min, max, step: () => 1, onBegin, onDrag: onChange, onEnd });
  const commitTyped = () => {
    if (typing !== null && typing.trim()) typeIn?.onType(typing.trim());
    setTyping(null);
  };
  return (
    <PopoverPrimitive.Root open={typing !== null} onOpenChange={(open) => !open && setTyping(null)}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <PopoverPrimitive.Anchor asChild>
            <div
              ref={element}
              role="spinbutton"
              tabIndex={0}
              aria-label={label}
              aria-valuenow={value}
              aria-valuemin={min}
              aria-valuemax={max}
              title={label}
              className={cn(
                "flex h-6 min-w-9 cursor-ns-resize touch-none items-center justify-end rounded border bg-background px-1.5 font-mono text-xs tabular-nums outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60",
                derived && "text-muted-foreground",
                className,
              )}
              onPointerDown={(e) => {
                const origin = e.clientY;
                const start = value;
                startPointerDrag(e, {
                  threshold: 3,
                  cursor: "ns-resize",
                  onStart: onBegin,
                  onMove: (ev) => onChange(clamp(start + Math.round((origin - ev.clientY) / DRAG_STEP), min, max)),
                  onEnd,
                  onCancel,
                });
              }}
              onKeyDown={(e) => {
                const key = resolveControlKey(e, { types: !!typeIn });
                if (!key || key.type === "reset") return;
                e.preventDefault();
                e.stopPropagation();
                if (key.type === "typeIn") {
                  caretAtEnd.current = key.text !== undefined;
                  return setTyping(key.text ?? typeIn!.initial);
                }
                onBegin();
                onChange(key.type === "edge" ? (key.edge === "min" ? min : max) : clamp(value + key.direction * { fine: 1, normal: 1, coarse: 10 }[key.size], min, max));
                onEnd();
              }}
            >
              {text ?? value}
            </div>
          </PopoverPrimitive.Anchor>
        </ContextMenuTrigger>
        {(menu || typeIn) && (
          <ContextMenuContent
            // Choosing Type in value: the menu mustn't give the focus back to the LCD as it closes, or the field loses it and closes.
            onCloseAutoFocus={(e) => {
              if (!typingNext.current) return;
              e.preventDefault();
              typingNext.current = false;
            }}
          >
            {menu}
            {menu && typeIn && <ContextMenuSeparator />}
            {typeIn && (
              <ContextMenuItem
                onSelect={() => {
                  typingNext.current = true;
                  setTimeout(() => setTyping(typeIn.initial), 0);
                }}
              >
                Type in value…
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        )}
      </ContextMenu>
      <PopoverContent
        className="w-36 p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Typed (or let go), the keyboard is back on the LCD, for the next key.
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          element.current?.focus();
        }}
      >
        <Input
          autoFocus
          aria-label={`${label}: type a value`}
          className="h-7"
          value={typing ?? ""}
          onChange={(e) => setTyping(e.target.value)}
          onFocus={(e) => (caretAtEnd.current ? e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length) : e.currentTarget.select())}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitTyped();
            e.stopPropagation();
          }}
        />
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}
