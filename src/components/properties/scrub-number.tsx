import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { type NumberDisplay, formatShown, parseShown, roundShown } from "./display";

/** Pixels the pointer must travel before a press becomes a scrub. */
const SCRUB_THRESHOLD = 3;

interface ScrubNumberProps {
  /** Value in display units. */
  value: number;
  display: NumberDisplay;
  label: string;
  disabled?: boolean;
  /** A scrub starts (a continuous edit). */
  onBegin: () => void;
  /** New value: live while scrubbing, or a one-off change (typed, arrow keys). */
  onChange: (value: number) => void;
  onEnd: () => void;
}

/**
 * Premiere's "scrubby" number: drag sideways to change it (Shift = ×10,
 * Alt = ×0.1), click to type a value, ↑/↓ to step it.
 */
export function ScrubNumber({ value, display, label, disabled, onBegin, onChange, onEnd }: ScrubNumberProps) {
  const [editing, setEditing] = useState(false);
  const scrub = useRef<{ x: number; value: number; moved: boolean } | null>(null);
  const clamp = (v: number) => roundShown(Math.min(display.max, Math.max(display.min, v)), display.decimals);
  const shown = formatShown(value, display.decimals);

  const finishScrub = () => {
    const s = scrub.current;
    scrub.current = null;
    if (s?.moved) onEnd();
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || disabled) return;
    e.preventDefault(); // keep focus where it is until it's a click
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub.current = { x: e.clientX, value, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.moved) {
      if (Math.abs(dx) < SCRUB_THRESHOLD) return;
      s.moved = true;
      onBegin();
    }
    const speed = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    onChange(clamp(s.value + dx * display.step * speed));
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const clicked = scrub.current && !scrub.current.moved;
    finishScrub();
    if (clicked) {
      e.currentTarget.focus();
      setEditing(true);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (disabled) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? 1 : -1;
      onChange(clamp(value + dir * display.step * (e.shiftKey ? 10 : 1)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      setEditing(true);
    }
  };

  if (editing) {
    return (
      <ValueInput
        initial={shown}
        label={label}
        unit={display.unit}
        step={display.step}
        onDone={(text) => {
          setEditing(false);
          const n = text === null ? null : parseShown(text);
          if (n !== null && clamp(n) !== clamp(value)) onChange(clamp(n));
        }}
      />
    );
  }

  return (
    <span
      role="spinbutton"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuenow={roundShown(value, display.decimals)}
      aria-valuemin={display.min}
      aria-valuemax={display.max}
      aria-disabled={disabled || undefined}
      className={cn(
        "inline-flex h-6 min-w-0 touch-none items-center rounded px-1 font-mono text-xs tabular-nums outline-none select-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        disabled
          ? "text-muted-foreground/60"
          : "cursor-ew-resize text-brand decoration-brand/50 decoration-dotted underline-offset-4 hover:bg-accent hover:underline",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onLostPointerCapture={finishScrub}
      onKeyDown={onKeyDown}
    >
      {shown}
      {display.unit && <span className="ml-0.5 font-sans text-muted-foreground">{display.unit}</span>}
    </span>
  );
}

/** Typing a value: Enter or leaving the field applies it, Escape doesn't. ↑/↓ step the text. */
function ValueInput({
  initial,
  label,
  unit,
  step,
  onDone,
}: {
  initial: string;
  label: string;
  unit?: string;
  step: number;
  onDone: (text: string | null) => void;
}) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const finish = (result: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(result);
  };
  return (
    <span className="inline-flex h-6 min-w-0 items-center">
      <input
        aria-label={label}
        value={text}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(text);
          else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(null);
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const n = parseShown(text);
            if (n !== null) setText(String(roundShown(n + (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1), 6)));
          }
        }}
        className="h-6 w-16 min-w-0 rounded border bg-background px-1 font-mono text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      {unit && <span className="ml-0.5 text-xs text-muted-foreground">{unit}</span>}
    </span>
  );
}
