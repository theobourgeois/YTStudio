import type { ReactNode } from "react";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { startPointerDrag } from "@/lib/pointer-drag";

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
  className?: string;
  onBegin: () => void;
  onChange: (value: number) => void;
  onEnd: () => void;
  onCancel: () => void;
}

/**
 * A number display, FL Studio's "LCD" (the pattern length; later, mixer track numbers): drag up and
 * down on it to change the number, right-click for its menu.
 */
export function Lcd({ value, min, max, label, text, derived, menu, className, onBegin, onChange, onEnd, onCancel }: LcdProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
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
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            e.stopPropagation();
            onBegin();
            onChange(clamp(value + (e.key === "ArrowUp" ? 1 : -1), min, max));
            onEnd();
          }}
        >
          {text ?? value}
        </div>
      </ContextMenuTrigger>
      {menu && <ContextMenuContent>{menu}</ContextMenuContent>}
    </ContextMenu>
  );
}
