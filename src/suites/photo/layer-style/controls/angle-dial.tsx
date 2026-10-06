/**
 * Photoshop's angle control (docs/photo/layer-style/dialog.md, "The angle dial"): a small circle with a line from
 * its centre to the rim at the angle, and the degrees beside it to scrub or type. Angles are degrees anticlockwise
 * from 3 o'clock, so 90° points up, on −180..180. A press in the circle points it there and a drag turns it (whole
 * degrees; Shift snaps to 15°), `onChange` live; arrow keys turn it a degree (Shift: 15).
 */
import { useRef } from "react";
import { cn } from "cn";
import { ScrubNumber } from "@/components/scrub-number";
import { startPointerDrag } from "@/lib/pointer-drag";
import { angleFromOffset, dialOffset, wrapAngle } from "./geometry";

const SIZE = 34;
const DEGREES = { min: -180, max: 180, step: 1, decimals: 0, unit: "°" };
const noop = () => {};

export function AngleDial({ value, onChange, label = "Angle", disabled }: { value: number; onChange: (degrees: number) => void; label?: string; disabled?: boolean }) {
  const dial = useRef<HTMLDivElement>(null);
  const end = dialOffset(value, SIZE / 2 - 2);

  const press = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    let last = value;
    const point = (ev: { clientX: number; clientY: number; shiftKey: boolean }) => {
      const r = dial.current!.getBoundingClientRect();
      const angle = angleFromOffset(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2), ev.shiftKey);
      if (angle !== null && angle !== last) {
        last = angle;
        onChange(angle);
      }
    };
    point(e);
    startPointerDrag(e, { threshold: 0, cursor: "crosshair", onMove: point });
  };

  const key = (e: React.KeyboardEvent) => {
    const by = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!by || disabled) return;
    e.preventDefault();
    // Shift: to the next 15° that way.
    const next = !e.shiftKey ? value + by : by > 0 ? Math.floor(value / 15) * 15 + 15 : Math.ceil(value / 15) * 15 - 15;
    onChange(wrapAngle(next));
  };

  return (
    <div className={cn("inline-flex items-center gap-1.5", disabled && "opacity-50")} data-angle-dial>
      <div
        ref={dial}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={-180}
        aria-valuemax={180}
        aria-valuenow={value}
        aria-valuetext={`${value}°`}
        aria-disabled={disabled || undefined}
        className={cn(
          "sunken relative shrink-0 touch-none rounded-full text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          !disabled && "cursor-crosshair",
        )}
        style={{ width: SIZE, height: SIZE }}
        onPointerDown={press}
        onKeyDown={key}
      >
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
          <line x1={SIZE / 2} y1={SIZE / 2} x2={SIZE / 2 + end.x} y2={SIZE / 2 + end.y} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
          <circle cx={SIZE / 2} cy={SIZE / 2} r={1.75} fill="currentColor" />
        </svg>
      </div>
      <ScrubNumber value={value} display={DEGREES} label={label} disabled={disabled} onBegin={noop} onChange={(v) => onChange(wrapAngle(Math.round(v)))} onEnd={noop} />
    </div>
  );
}
