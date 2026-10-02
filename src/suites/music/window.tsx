import type { DragEvent, ReactNode } from "react";
import { Desktop, FloatingWindow, type FloatingWindowProps, cascadedOnDesktop as cascadedOn, centredOnDesktop as centredOn } from "@/components/windows/floating-window";
import type { WindowPlace } from "@/components/windows/store";
import { type WindowId, useMusicWindows } from "./ui";

/** Where a small window of this size opens on the music editor's desktop: its middle, a little above. */
export const centredOnDesktop = (width: number, height: number): WindowPlace => centredOn(width, height, "music");

/** Where the `index`th of a cascade of windows of this size opens on the music editor's desktop, kept on it. */
export const cascadedOnDesktop = (index: number, origin: { x: number; y: number }, step: number, size: { width: number; height: number }): WindowPlace =>
  cascadedOn(index, origin, step, size, "music");

/**
 * A window of the music editor (the platform's `FloatingWindow`, on the editor's desktop): the channel
 * rack, a channel's settings, the Piano roll, the mixer, and the small ones commands open.
 */
export function MusicWindow(props: FloatingWindowProps & { id: WindowId }) {
  return <FloatingWindow {...props} />;
}

/** Where the music editor's windows float. */
export function MusicDesktop({ children, onDragOver, onDrop }: { children: ReactNode; onDragOver?: (e: DragEvent<HTMLDivElement>) => void; onDrop?: (e: DragEvent<HTMLDivElement>) => void }) {
  return (
    <Desktop windows={useMusicWindows} name="music" label="Song" className="relative min-h-0 flex-1 bg-stage" onDragOver={onDragOver} onDrop={onDrop}>
      {children}
    </Desktop>
  );
}
