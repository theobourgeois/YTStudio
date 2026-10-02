import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { MASTER_TRACK_ID } from "@shared/music/project";
import type { Mixer } from "@shared/music/types";

interface Cable {
  /** "from>to". */
  key: string;
  from: string;
  /** The track it goes to. */
  to: string;
  /** A send at 0: only a sidechain (FL draws it faint). */
  faint: boolean;
  /** Coming into a selected track from one that isn't selected (it feeds it): dashed. */
  incoming: boolean;
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
 * FL Studio's routing cables: from each selected track's send switch to each track it sends to, and
 * (dashed) from each track that feeds a selected one into it, so a bus shows what's on it. Drawn
 * over the strips (`area`, which clips them at its bottom). Which cables there are is React's; where they
 * are is measured from the strips and written straight into the paths, on every scroll, resize and frame
 * of a swing, so they never lag behind the strips. A cable just plugged in swings a moment before it settles.
 */
export function Cables({ area, mixer, sources }: { area: RefObject<HTMLElement | null>; mixer: Mixer; sources: readonly string[] }) {
  const paths = useRef(new Map<string, SVGPathElement>());
  // When each cable was plugged in (a send made from the track shown), for its swing.
  const born = useRef(new Map<string, number>());
  // Null until the first: the cables there when the mixer opens (or other tracks are selected) don't swing.
  const shownFor = useRef<string | null>(null);
  const shown = sources.join(" ");
  const selected = new Set(sources);
  const cables: Cable[] = [
    ...sources.flatMap((from) =>
      (mixer.tracks.find((t) => t.id === from)?.sends ?? []).map((send) => ({ key: `${from}>${send.to}`, from, to: send.to, faint: send.level === 0, incoming: false })),
    ),
    ...mixer.tracks.flatMap((t) =>
      // Not into the master: everything goes there.
      selected.has(t.id) ? [] : t.sends.filter((s) => selected.has(s.to) && s.to !== MASTER_TRACK_ID).map((send) => ({ key: `in:${t.id}>${send.to}`, from: t.id, to: send.to, faint: send.level === 0, incoming: true })),
    ),
  ];
  const ends = useRef(new Map<string, Cable>());
  ends.current = new Map(cables.map((c) => [c.key, c]));

  /** Measure the strips and put every cable where it is now. */
  const place = useRef(() => {});
  place.current = () => {
    const root = area.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const point = (id: string) => {
      const strip = `[data-track="${CSS.escape(id)}"]`;
      // Its send knob or source arrow; else (a track feeding a selected one) its send switch.
      const cell = root.querySelector<HTMLElement>(`${strip} [data-send-point]`) ?? root.querySelector<HTMLElement>(`${strip} [data-send] button`);
      if (!cell) return null;
      const r = cell.getBoundingClientRect();
      return { x: r.left + r.width / 2 - box.left, y: r.bottom - box.top };
    };
    const now = performance.now();
    const points = new Map<string, { x: number; y: number } | null>();
    const at = (id: string) => {
      if (!points.has(id)) points.set(id, point(id));
      return points.get(id)!;
    };
    for (const [key, path] of paths.current) {
      const cable = ends.current.get(key);
      const from = cable && at(cable.from);
      const to = cable && at(cable.to);
      // An end that isn't drawn (scrolled far off): no cable for now.
      if (!from || !to) {
        path.setAttribute("d", "");
        continue;
      }
      path.setAttribute("d", cablePath(from, to, box.height, cableSwing(now - (born.current.get(key) ?? -Infinity))));
    }
  };

  // The cables of the tracks shown: new ones plugged in swing.
  useLayoutEffect(() => {
    const sameTracks = shownFor.current === shown;
    shownFor.current = shown;
    const time = performance.now();
    for (const key of [...born.current.keys()]) if (!ends.current.has(key)) born.current.delete(key);
    for (const key of ends.current.keys()) if (!born.current.has(key)) born.current.set(key, sameTracks ? time : -Infinity);
    place.current();
    // While one swings, a frame at a time.
    let frame = 0;
    const swing = (now: number) => {
      place.current();
      if ([...born.current.values()].some((t) => now - t < SETTLE_MS)) frame = requestAnimationFrame(swing);
    };
    if ([...born.current.values()].some((t) => time - t < SETTLE_MS)) frame = requestAnimationFrame(swing);
    return () => cancelAnimationFrame(frame);
  });

  // As the strips scroll (at once, and again once strips scrolled into view are drawn) and as the window resizes.
  useEffect(() => {
    const root = area.current;
    if (!root) return;
    let frame = 0;
    const again = () => {
      place.current();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => place.current());
    };
    root.addEventListener("scroll", again, { capture: true, passive: true });
    const resize = new ResizeObserver(again);
    resize.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", again, { capture: true });
      resize.disconnect();
    };
  }, [area]);

  return (
    <svg className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible" aria-hidden data-testid="cables">
      {cables.map((cable) => (
        <path
          key={cable.key}
          ref={(path) => {
            if (path) paths.current.set(cable.key, path);
            else paths.current.delete(cable.key);
          }}
          className="fill-none"
          stroke={cable.incoming ? "var(--mixer-name)" : "var(--mixer-on)"}
          strokeWidth={cable.incoming ? 1.25 : 1.75}
          strokeDasharray={cable.incoming ? "4 3" : undefined}
          strokeOpacity={cable.faint ? 0.35 : cable.incoming ? 0.75 : 0.9}
          strokeLinecap="round"
          data-cable={cable.to}
          data-cable-from={cable.from}
          data-incoming={cable.incoming || undefined}
        />
      ))}
    </svg>
  );
}
