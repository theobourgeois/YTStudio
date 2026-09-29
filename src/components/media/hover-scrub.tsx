import { type PointerEvent, useState } from "react";
import type { Filmstrip, MediaAsset } from "@shared/types";
import { filmstripFrameUrl } from "@/lib/api";

/**
 * Where the mouse is across a thumbnail (0..1), null when it isn't over it: moving
 * across a video's card skims through it (Premiere's hover scrub). Not while dragging.
 */
export function useHoverX() {
  const [hoverX, setHoverX] = useState<number | null>(null);
  return {
    hoverX,
    clear: () => setHoverX(null),
    handlers: {
      onPointerMove(e: PointerEvent<HTMLElement>) {
        if (e.pointerType !== "mouse" || e.buttons) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setHoverX(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
      },
      onPointerLeave: () => setHoverX(null),
    },
  };
}

/** The filmstrip frame at source time `t` of a file of `duration`. */
export function filmstripFrameAt(strip: Filmstrip, t: number, duration: number): number {
  const at = duration > 0 ? t / duration : 0;
  return Math.min(strip.count - 1, Math.max(0, Math.floor(at * strip.count)));
}

/**
 * The filmstrip frame under the mouse and a playhead line, over a video's poster. With a
 * `range` (a subclip), the card's width is that part of the file.
 */
export function HoverScrub({ asset, hoverX, range }: { asset: MediaAsset; hoverX: number | null; range?: { in: number; out: number } }) {
  const strip = asset.kind === "video" ? asset.filmstrip : null;
  if (!strip || hoverX === null) return null;
  const from = range?.in ?? 0;
  const to = range?.out ?? asset.duration;
  const frame = filmstripFrameAt(strip, from + hoverX * (to - from), asset.duration);
  return (
    <>
      <img
        src={filmstripFrameUrl(strip.urlPattern, frame)}
        alt=""
        draggable={false}
        className="absolute inset-0 size-full object-cover"
      />
      <span className="absolute inset-y-0 w-px bg-brand" style={{ left: `${hoverX * 100}%` }} />
    </>
  );
}
