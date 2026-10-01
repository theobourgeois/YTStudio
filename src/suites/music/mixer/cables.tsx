import { type RefObject, useEffect, useLayoutEffect, useState } from "react";
import type { Mixer } from "@shared/music/types";

interface Cable {
  key: string;
  d: string;
  /** A send at 0: only a sidechain (FL draws it faint). */
  faint: boolean;
}

/** A cable from one point to another along the strips' foot, hanging down between them. */
export function cablePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const sag = Math.min(14, 6 + Math.abs(to.x - from.x) * 0.04);
  return `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${Math.max(from.y, to.y) + sag} ${to.x} ${to.y}`;
}

/**
 * FL Studio's routing cables: from the selected track's send switch to each track it sends to, drawn
 * over the strips (`area`) and measured from them, so they follow the strips as they scroll.
 */
export function Cables({ area, mixer, current }: { area: RefObject<HTMLElement | null>; mixer: Mixer; current: string }) {
  const [cables, setCables] = useState<Cable[]>([]);
  const [tick, setTick] = useState(0);

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
    const from = point(current);
    const track = mixer.tracks.find((t) => t.id === current);
    if (!from || !track) return setCables([]);
    setCables(
      track.sends.flatMap((send) => {
        const to = point(send.to);
        return to ? [{ key: send.to, d: cablePath(from, to), faint: send.level === 0 }] : [];
      }),
    );
  }, [area, mixer, current, tick]);

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
        <path key={cable.key} d={cable.d} className="fill-none stroke-brand" strokeWidth={1.5} strokeOpacity={cable.faint ? 0.35 : 0.9} strokeLinecap="round" data-cable={cable.key} />
      ))}
    </svg>
  );
}
