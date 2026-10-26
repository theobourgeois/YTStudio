import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { restingAt, snapped, stepWheel, updatePitchWheel, wheelPhysics } from "@shared/music/pitch-wheel";
import type { AutomationTarget, Wheel } from "@shared/music/types";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { startPointerDrag } from "@/lib/pointer-drag";
import { CURSOR } from "../cursors";
import { AutomationMenuItems, useAutomatedControl } from "../automation/control";
import { prepare } from "../piano/draw";
import { songGesture, useMusic } from "../store";
import { useWheelValue } from "../wheel";
import { holdWheel, jumpWheel } from "./actions";
import { TRAIL_MS, type TrailPoint, drawDial, wheelColours } from "./draw";
import { pointerAngle, readout, scrollStep, turn, turned } from "./geometry";
import { freshWheel } from "./live";

/** How quickly the shown pitch catches up with the engine's readings (they come ~25 a second). */
const FOLLOW_MS = 30;

/**
 * One of a Pitch Wheel's wheels (QuikQuak's): turned by dragging round it from anywhere inside it (Shift
 * for fine), scrolled, Alt+click or a middle click for 0; its right-click menu types in a value (what's
 * heard jumps straight there) or automates it. What's heard (the glowing ring, the screen) is what the
 * engine says while sound goes through, else the same physics run here, so it swings as it will sound.
 */
export function Dial({ effectId, wheel, settings, closed, size }: { effectId: string; wheel: "pitch" | "timbre"; settings: Wheel; closed: boolean; size: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const target: AutomationTarget = { kind: "pitchWheel", effect: effectId, control: wheel };
  const control = useAutomatedControl(target, settings.value);
  const [dragging, setDragging] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const drag = useRef<number | null>(null);
  const gesture = useRef(songGesture()).current;
  // What the animation loop reads: the latest of everything, without restarting it.
  const latest = useRef({ settings, closed, shown: control.value, dragging });
  latest.current = { settings, closed, shown: control.value, dragging };
  const range = settings.range;
  const half = range / 2;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let frame = 0;
    let last = performance.now();
    let motion = restingAt(snapped(latest.current.shown, latest.current.settings.snap));
    const trail: TrailPoint[] = [];
    let drawn = "";
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { settings: w, closed: shut, shown, dragging: held } = latest.current;
      const pointer = drag.current ?? shown;
      const goal = snapped(pointer, w.snap);
      // The engine's word while sound goes through it, caught up with smoothly; else the physics, here.
      const fresh = freshWheel(effectId, now);
      if (fresh && !shut) {
        const heard = wheel === "pitch" ? fresh.state.pitch : fresh.state.timbre;
        const next = motion.actual + (heard - motion.actual) * (1 - Math.exp(-(dt * 1000) / FOLLOW_MS));
        motion = { target: goal, actual: next, velocity: dt > 0 ? (next - motion.actual) / dt : 0 };
      } else motion = stepWheel(motion, shut ? 0 : goal, wheelPhysics(w), dt);
      const voices = fresh && wheel === "pitch" ? fresh.state.voices.map((v) => v.pitch) : [];
      const input = fresh ? fresh.state.input : 0;
      if (trail.length === 0 || Math.abs(trail[trail.length - 1].value - motion.actual) > 1e-3) trail.push({ value: motion.actual, at: now });
      while (trail.length && now - trail[0].at > TRAIL_MS) trail.shift();
      // Drawn only when something on it changed.
      const key = `${motion.actual.toFixed(4)}|${pointer.toFixed(4)}|${goal}|${trail.length}|${voices.join()}|${input.toFixed(2)}|${shut}|${held}|${w.range}|${document.documentElement.className}`;
      if (key === drawn) return;
      drawn = key;
      // What's heard, for whoever reads the page (tests, assistive tech).
      element.dataset.heard = motion.actual.toFixed(2);
      const ctx = prepare(element, size, size);
      if (!ctx) return;
      drawDial(ctx, {
        size,
        range: w.range,
        name: wheel === "pitch" ? "PITCH" : "TIMBRE",
        pointer,
        target: goal,
        actual: motion.actual,
        trail,
        voices,
        input,
        now,
        closed: shut,
        dragging: held,
        colours: wheelColours(element, wheel),
      });
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [effectId, wheel, size]);

  // Scrolling: a semitone a notch when snapped, a tenth when not; a run of them one undo step.
  const scroll = useRef(songGesture()).current;
  useWheelValue(canvas as React.RefObject<HTMLElement | null>, {
    value: () => latest.current.settings.value,
    min: -half,
    max: half,
    step: (fine) => scrollStep(latest.current.settings.snap, fine),
    onBegin: () => scroll.begin(),
    onDrag: (value) => scroll.apply((s) => updatePitchWheel(s, effectId, { [wheel]: { value } })),
    onEnd: () => scroll.end(),
  }, !closed);

  const set = (value: number) => useMusic.getState().commit((s) => updatePitchWheel(s, effectId, { [wheel]: { value } }));
  const typed = () => {
    const number = typing === null ? NaN : Number(typing.replace(",", "."));
    if (Number.isFinite(number)) jumpWheel(effectId, wheel, clamp(number, -half, half));
    setTyping(null);
  };
  const label = wheel === "pitch" ? "Pitch wheel" : "Timbre wheel";

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={closed}>
          <canvas
            ref={canvas}
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-valuemin={-half}
            aria-valuemax={half}
            aria-valuenow={settings.value}
            aria-valuetext={`${readout(settings.value)} semitones`}
            data-testid={`wheel-${wheel}`}
            data-value={settings.value}
            title={`${label}: ${readout(settings.value)} semitones. Drag round it (Shift: fine), scroll, Alt+click for 0; right-click to type a value${control.automated ? " (automated)" : ""}`}
            className={cn("block touch-none rounded-full outline-none", closed ? "cursor-default" : "cursor-grab", dragging && "cursor-grabbing")}
            style={{ width: size, height: size }}
            onDoubleClick={() => !closed && setTyping(readout(settings.value))}
            onPointerDown={(e) => {
              if (closed) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              if (Math.hypot(e.clientX - cx, e.clientY - cy) > size / 2) return;
              if (e.button === 1 || (e.button === 0 && e.altKey)) {
                e.preventDefault();
                set(0);
                return;
              }
              let angle = pointerAngle(e.clientX - cx, e.clientY - cy);
              let value = settings.value;
              let live: ReturnType<typeof holdWheel> | null = null;
              const end = () => {
                live?.release();
                drag.current = null;
                setDragging(false);
                control.release();
              };
              startPointerDrag(e, {
                threshold: 1,
                cursor: CURSOR.grabPoint,
                onStart() {
                  control.hold();
                  gesture.begin();
                  live = holdWheel(effectId, wheel, settings.snap);
                  drag.current = value;
                  setDragging(true);
                },
                onMove(ev) {
                  const dx = ev.clientX - cx;
                  const dy = ev.clientY - cy;
                  // Too near the middle, the direction jumps about: wait for the pointer to come out.
                  if (Math.hypot(dx, dy) < 10) return;
                  const now = pointerAngle(dx, dy);
                  value = turned(value, turn(angle, now), latest.current.settings.range, ev.shiftKey);
                  angle = now;
                  drag.current = value;
                  live?.move(value);
                  gesture.apply((s) => updatePitchWheel(s, effectId, { [wheel]: { value } }));
                },
                onEnd() {
                  gesture.end();
                  end();
                },
                onCancel() {
                  gesture.cancel();
                  end();
                },
              });
            }}
            onKeyDown={(e) => {
              const step = scrollStep(settings.snap, e.ctrlKey || e.metaKey);
              if (e.key === "ArrowUp" || e.key === "ArrowRight") set(clamp(settings.value + step, -half, half));
              else if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(clamp(settings.value - step, -half, half));
              else if (e.key === "Enter") setTyping(readout(settings.value));
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setTimeout(() => setTyping(readout(settings.value)), 0)}>Type in value…</ContextMenuItem>
          <ContextMenuItem onSelect={() => set(0)}>Reset to 0</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => jumpWheel(effectId, wheel, settings.value)}>Jump there (no swing)</ContextMenuItem>
          <AutomationMenuItems target={target} />
        </ContextMenuContent>
      </ContextMenu>
      {typing !== null && (
        <div className="absolute inset-0 grid place-items-center">
          <Input
            autoFocus
            aria-label={`${label} value`}
            inputMode="decimal"
            className="h-8 w-24 text-center font-mono text-base tabular-nums"
            value={typing}
            onChange={(e) => setTyping(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setTyping(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") typed();
              if (e.key === "Escape") setTyping(null);
              e.stopPropagation();
            }}
          />
        </div>
      )}
    </div>
  );
}
