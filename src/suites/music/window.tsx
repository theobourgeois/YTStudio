import type { DragEvent, ReactNode } from "react";
import { Desktop, FloatingWindow, type FloatingWindowProps } from "@/components/windows/floating-window";
import { type WindowId, useMusicWindows } from "./ui";

export { centredOnDesktop } from "@/components/windows/floating-window";

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
