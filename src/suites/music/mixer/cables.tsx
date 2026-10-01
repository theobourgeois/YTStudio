import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Mixer } from "@shared/music/types";

interface Cable {
  key: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** A send at 0: only a sidechain (FL draws it faint). */
  faint: boolean;
}

/**
 * A cable from one point to another, FL Studio's: it drops from the first past the bottom of the strips
 * (`bottom`) and comes back up into the second, so only its two ends show. `swing` (px) moves the bottom
 * of the loop, for the wobble of a cable just plugged in.
 */
export function cablePath(from: { x: number; y: number }, to: { x: number; y: number }, bottom: number, swing = 0): string {
  const below = bottom + 28 + Math.min(120, Math.abs(to.x - from.x) * 0.12) + swing;
  return `M ${from.x} ${from.y} C ${from.x} ${below}, ${to.x} ${below}, ${to.x} ${to.y}`;
}

/** How far a cable plugged in `age` ms ago has swung from where it hangs: a quick damped bounce. */
export const cableSwing = (age: number) => (age >= SETTLE_MS ? 0 : 18 * Math.exp(-age / 160) * Math.cos(age / 55));
const SETTLE_MS = 900;

/**
 * FL Studio's routing cables: from the selected track's send switch to each track it sends to, drawn
 * over the strips (`area`, which clips them at its bottom) and measured from them, so they follow the
 * strips as they scroll. A cable just plugged in swings a moment before it settles.
 */
export function Cables({ area, mixer, current }: { area: RefObject<HTMLElement | null>; mixer: Mixer; current: string }) {
  const [cables, setCables] = useState<Cable[]>([]);
  const [bottom, setBottom] = useState(0);
  const [tick, setTick] = useState(0);
  // When each cable was plugged in (a send made from the track shown), for its wobble; and the time now, while one wobbles.
  const born = useRef(new Map<string, number>());
  // Null until the first measure: the cables there when the mixer opens don't swing either.
  const shownFor = useRef<string | null>(null);
  const [now, setNow] = useState(() => performance.now());

  useLayoutEffect(() => {
    const root = area.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const point = (id: string) => {
      const cell = root.querySelector<HTMLElement>(`[data-track="${CSS.escape(id)}"] [data-send-point]`);
      if (!cell) return null;
      const r = cell.getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.bottom - box.top };
    };
    setBottom(box.height);
    const from = point(current);
    const track = mixer.tracks.find((t) => t.id === current);
    // Another track shown: its cables are already there, they don't swing.
    const sameTrack = shownFor.current === current;
    shownFor.current = current;
    const sends = track?.sends ?? [];
    const time = performance.now();
    for (const key of [...born.current.keys()]) if (!sends.some((s) => s.to === key)) born.current.delete(key);
    for (const send of sends) if (!born.current.has(send.to)) born.current.set(send.to, sameTrack ? time : -Infinity);
    if (!from || !track) return setCables([]);
    setCables(
      sends.flatMap((send) => {
        const to = point(send.to);
        return to ? [{ key: send.to, from, to, faint: send.level === 0 }] : [];
      }),
    );
  }, [area, mixer, current, tick]);

  // While a cable wobbles, a frame at a time.
  const wobbling = [...born.current.values()].some((t) => now - t < SETTLE_MS);
  useEffect(() => {
    if (!wobbling && ![...born.current.values()].some((t) => performance.now() - t < SETTLE_MS)) return;
    let frame = requestAnimationFrame(function step(time) {
      setNow(time);
      if ([...born.current.values()].some((t) => time - t < SETTLE_MS)) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [cables, wobbling]);

  // Again when the strips scroll or the window resizes.
  useEffect(() => {
    const root = area.current;
    if (!root) return;
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    root.addEventListener("scroll", again, true);
    const resize = new ResizeObserver(again);
    resize.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", again, true);
      resize.disconnect();
    };
  }, [area]);

  return (
    <svg className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible" aria-hidden data-testid="cables">
      {cables.map((cable) => (
        <path
          key={cable.key}
          d={cablePath(cable.from, cable.to, bottom, cableSwing(now - (born.current.get(cable.key) ?? -Infinity)))}
          className="fill-none stroke-brand"
          strokeWidth={1.75}
          strokeOpacity={cable.faint ? 0.35 : 0.9}
          strokeLinecap="round"
          data-cable={cable.key}
        />
      ))}
    </svg>
  );
}
