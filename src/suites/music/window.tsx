import type { ReactNode } from "react";
import { PiX } from "react-icons/pi";
import { cn } from "cn";
import { startPointerDrag } from "@/lib/pointer-drag";
import { type WindowId, type WindowPlace, useMusicUi } from "./ui";

/** How much of a window must stay on the desktop (px), so it can always be grabbed again. */
const KEEP_IN_VIEW = 80;
const TITLE_HEIGHT = 32;

interface MusicWindowProps {
  id: WindowId;
  title: string;
  /** Where it opens, until it's moved. */
  initial: WindowPlace;
  onClose: () => void;
  /** At the start of the title bar (the window's menu arrow). */
  menu?: ReactNode;
  /** After the title: the window's own controls. */
  controls?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * A window of the music editor, FL Studio's way: it floats on the editor's desktop (`Desktop`), is
 * dragged by its title bar, comes to the front when touched and closes with its ×. Everything in the
 * music editor is one of these: the channel rack, a channel's settings, later the piano roll, the
 * mixer and the playlist.
 */
export function MusicWindow({ id, title, initial, onClose, menu, controls, className, children }: MusicWindowProps) {
  const place = useMusicUi((s) => s.places[id]) ?? initial;
  const z = useMusicUi((s) => s.order.indexOf(id));

  return (
    <section
      aria-label={title}
      data-window={id}
      className={cn("absolute flex flex-col rounded-lg border bg-card shadow-xl shadow-black/20 dark:border-white/10 dark:shadow-black/50", className)}
      style={{ left: place.x, top: place.y, zIndex: 10 + (z < 0 ? 0 : z) }}
      onPointerDownCapture={() => useMusicUi.getState().focusWindow(id)}
    >
      <header
        className="flex h-8 shrink-0 cursor-grab items-center gap-1.5 rounded-t-lg border-b bg-muted/60 pr-1 pl-1.5 select-none active:cursor-grabbing"
        data-window-title
        onPointerDown={(e) => {
          // Its controls are clicked, not dragged by. Nor is a menu opened from one of them: it's drawn
          // elsewhere on the page, but its events still pass through here.
          const target = e.target as HTMLElement;
          if (!e.currentTarget.contains(target) || target.closest("button, [role=slider], [role=spinbutton], input")) return;
          const element = e.currentTarget.parentElement!;
          const desktop = e.currentTarget.closest("[data-desktop]")?.getBoundingClientRect();
          const width = e.currentTarget.getBoundingClientRect().width;
          const origin = { x: e.clientX - place.x, y: e.clientY - place.y };
          let moved = place;
          // While it's dragged the window is moved directly, on the compositor: no rendering, no layout,
          // so it keeps up with the pointer. Where it ends up is recorded once, when it's let go.
          const settle = (next: WindowPlace) => {
            element.style.transform = "";
            element.style.willChange = "";
            useMusicUi.getState().placeWindow(id, next);
          };
          startPointerDrag(e, {
            threshold: 2,
            cursor: "grabbing",
            onStart: () => (element.style.willChange = "transform"),
            onMove(ev) {
              const x = ev.clientX - origin.x;
              const y = ev.clientY - origin.y;
              moved = {
                x: desktop ? Math.min(desktop.width - KEEP_IN_VIEW, Math.max(KEEP_IN_VIEW - width, x)) : x,
                y: desktop ? Math.min(desktop.height - TITLE_HEIGHT, Math.max(0, y)) : Math.max(0, y),
              };
              element.style.transform = `translate3d(${moved.x - place.x}px, ${moved.y - place.y}px, 0)`;
            },
            onEnd: () => settle(moved),
            onCancel: () => settle(place),
          });
        }}
      >
        {menu}
        <h2 className="truncate text-xs font-medium text-muted-foreground">{title}</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {controls}
          <button
            type="button"
            aria-label={`Close ${title}`}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            <PiX className="size-3.5" />
          </button>
        </div>
      </header>
      {children}
    </section>
  );
}

/** Where the music editor's windows float. */
export function Desktop({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-stage" data-desktop aria-label="Song">
      {children}
    </div>
  );
}
