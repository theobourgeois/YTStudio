import { createContext, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useContext } from "react";
import { PiCornersIn, PiCornersOut, PiX } from "react-icons/pi";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { startPointerDrag } from "@/lib/pointer-drag";
import { type Rect, type ResizeEdge, type WindowSnap, edgeSnap, magnetise, resizeRect, unsnapAt } from "./geometry";
import type { WindowPlace, WindowsStore } from "./store";

/** How much of a window must stay on the desktop (px), so it can always be grabbed again. */
const KEEP_IN_VIEW = 80;
const TITLE_HEIGHT = 28;

/** The windows of the desktop a window is on (`Desktop` provides them). */
const WindowsContext = createContext<WindowsStore | null>(null);

function useWindowsStore(): WindowsStore {
  const store = useContext(WindowsContext);
  if (!store) throw new Error("A FloatingWindow must be on a Desktop.");
  return store;
}

export interface FloatingWindowProps {
  id: string;
  title: string;
  /** Where it opens (and, if it's resizable, how big, and whether it fills the desktop), until it's moved. */
  initial: WindowPlace;
  onClose: () => void;
  /** At the start of the title bar (the window's menu arrow). */
  menu?: ReactNode;
  /** Shown instead of the title's text (which still names the window): a selector, as the Piano roll's channel. */
  heading?: ReactNode;
  /** After the title: the window's own controls. */
  controls?: ReactNode;
  /**
   * Its edges resize it (no smaller than this), a double-click on its title fills the desktop with it,
   * and dragged to the desktop's top or sides it snaps to fill it or half of it. Its content should
   * fill it. Windows that aren't resizable fit what's in them.
   */
  resizable?: { minWidth: number; minHeight: number };
  /**
   * Keys pressed in it are its own: the editors' shortcuts leave them alone (`keptByWindow`), as they
   * would in a dialog, though the window doesn't stop the editor under it being used. Settings is one.
   */
  keepsKeys?: boolean;
  className?: string;
  children: ReactNode;
}

/** Whether a key pressed on `target` belongs to a window that keeps its keys (`keepsKeys`): editors' shortcuts check it. */
export function keptByWindow(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-keeps-keys]") !== null;
}

const SNAPPED: Record<WindowSnap, CSSProperties> = {
  full: { left: 0, top: 0, width: "100%", height: "100%" },
  left: { left: 0, top: 0, width: "50%", height: "100%" },
  right: { left: "50%", top: 0, width: "50%", height: "100%" },
};

/** The rectangles of the desktop and of an element on it, in the desktop's coordinates. */
function measure(element: HTMLElement) {
  const desktopElement = element.closest<HTMLElement>("[data-desktop]");
  const desk = desktopElement?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  const on = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return { x: r.left - desk.left, y: r.top - desk.top, width: r.width, height: r.height };
  };
  const others = desktopElement ? [...desktopElement.querySelectorAll<HTMLElement>("[data-window]")].filter((w) => w !== element).map(on) : [];
  return { desk, rect: on(element), others };
}

/** Put the element's inline style back as React left it, before React is given the new place. */
function snapshotStyle(element: HTMLElement) {
  const saved = element.getAttribute("style") ?? "";
  return () => element.setAttribute("style", saved);
}

const px = (element: HTMLElement, r: Rect, sized: boolean) => {
  element.style.left = `${r.x}px`;
  element.style.top = `${r.y}px`;
  if (sized) {
    element.style.width = `${r.width}px`;
    element.style.height = `${r.height}px`;
  }
};

/** Pressing one of these in a title bar uses it: it doesn't drag the window or maximise it. */
const CONTROLS = "button, [role=slider], [role=spinbutton], [role=tab], input";

/**
 * A window, FL Studio's way: it floats on a desktop (`Desktop`), is dragged by its title bar (its edges
 * sticking to the desktop's and to other windows'), comes to the front when touched and closes with its
 * ×. Resizable ones also resize by any edge, fill the desktop (double-click the title, or drag it to the
 * top) or half of it (drag it to a side). Everything in the music editor is one of these, and so is
 * Settings, on the app's own desktop.
 */
export function FloatingWindow({ id, title, initial, onClose, menu, heading, controls, resizable, keepsKeys, className, children }: FloatingWindowProps) {
  const windows = useWindowsStore();
  const place = windows((s) => s.places[id]) ?? initial;
  const z = windows((s) => s.order.indexOf(id));
  const snap = resizable ? (place.snap ?? null) : null;
  const size = { width: place.width ?? initial.width ?? 800, height: place.height ?? initial.height ?? 500 };
  const style: CSSProperties = snap ? SNAPPED[snap] : { left: place.x, top: place.y, ...(resizable ? size : {}) };

  const dragTitle = (e: ReactPointerEvent<HTMLElement>) => {
    // Its controls are clicked, not dragged by. Nor is a menu opened from one of them: it's drawn
    // elsewhere on the page, but its events still pass through here.
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target) || target.closest(CONTROLS)) return;
    const element = e.currentTarget.parentElement!;
    const { desk, rect: start, others } = measure(element);
    const restore = snapshotStyle(element);
    // Where the window was grabbed, from its top-left corner.
    const offset = { x: e.clientX - desk.left - start.x, y: e.clientY - desk.top - start.y };
    let base = start;
    let moved = start;
    let snapped = snap;
    let snapTo: WindowSnap | null = null;
    // While it's dragged the window is moved directly, on the compositor: no rendering, no layout,
    // so it keeps up with the pointer. Where it ends up is recorded once, when it's let go.
    const settle = (next: WindowPlace | null) => {
      restore();
      windows.getState().setSnapPreview(null);
      if (next) windows.getState().place(id, next);
    };
    startPointerDrag(e, {
      threshold: 3,
      cursor: "grabbing",
      onStart: () => (element.style.willChange = "transform"),
      onMove(ev) {
        const p = { x: ev.clientX - desk.left, y: ev.clientY - desk.top };
        if (snapped) {
          // Out of its snap: back to its own size, under the pointer where it was grabbed.
          base = unsnapAt(p, { fraction: offset.x / start.width, dy: offset.y }, size);
          offset.x = p.x - base.x;
          offset.y = p.y - base.y;
          px(element, base, true);
          snapped = null;
        }
        let r: Rect = {
          x: clamp(p.x - offset.x, KEEP_IN_VIEW - base.width, desk.width - KEEP_IN_VIEW),
          y: clamp(p.y - offset.y, 0, desk.height - TITLE_HEIGHT),
          width: base.width,
          height: base.height,
        };
        // Alt: no sticking.
        if (!ev.altKey) r = magnetise(r, desk, others);
        moved = r;
        snapTo = resizable ? edgeSnap(p, desk) : null;
        windows.getState().setSnapPreview(snapTo);
        element.style.transform = `translate3d(${r.x - base.x}px, ${r.y - base.y}px, 0)`;
      },
      onEnd: () => {
        const sized = resizable ? { width: moved.width, height: moved.height } : {};
        settle({ x: Math.round(moved.x), y: Math.round(moved.y), ...sized, snap: snapTo });
      },
      onCancel: () => settle(null),
    });
  };

  const dragEdge = (e: ReactPointerEvent<HTMLElement>, edge: ResizeEdge) => {
    if (!resizable) return;
    e.stopPropagation();
    const element = e.currentTarget.parentElement!;
    const { desk, rect: start } = measure(element);
    const restore = snapshotStyle(element);
    let next = start;
    startPointerDrag(e, {
      threshold: 0,
      cursor: EDGE_CURSOR[edge],
      onMove(ev) {
        next = resizeRect(start, edge, ev.clientX - e.clientX, ev.clientY - e.clientY, { width: resizable.minWidth, height: resizable.minHeight }, desk);
        px(element, next, true);
      },
      onEnd() {
        restore();
        windows.getState().place(id, { x: Math.round(next.x), y: Math.round(next.y), width: Math.round(next.width), height: Math.round(next.height), snap: null });
      },
      onCancel: restore,
    });
  };

  return (
    <section
      aria-label={title}
      data-window={id}
      data-snap={snap ?? undefined}
      data-keeps-keys={keepsKeys || undefined}
      className={cn(
        // A floating surface (the theme's outline and short shadow), its title bar a step darker than its body.
        "floating pointer-events-auto absolute flex flex-col overflow-hidden bg-card",
        snap ? "rounded-none shadow-none" : "rounded-md",
        className,
      )}
      style={{ ...style, zIndex: 10 + (z < 0 ? 0 : z) }}
      onPointerDownCapture={() => windows.getState().focus(id)}
    >
      <header
        className="flex h-7 shrink-0 cursor-grab items-center gap-1.5 border-b border-line bg-surface-1 pr-1 pl-1 select-none active:cursor-grabbing"
        data-window-title
        onPointerDown={dragTitle}
        // A double-click on the title fills the desktop with a window that resizes; one that doesn't goes
        // to the desktop's corner (and back).
        onDoubleClick={(e) => {
          if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest(CONTROLS)) return;
          if (resizable) windows.getState().toggleMaximised(id, initial);
          else windows.getState().toggleCorner(id, initial);
        }}
      >
        {menu}
        <h2 className="min-w-0 truncate text-xs font-medium">{heading ?? title}</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {controls}
          {resizable && (
            <button
              type="button"
              aria-label={snap === "full" ? `Restore ${title}` : `Maximise ${title}`}
              title={snap === "full" ? "Restore (double-click the title)" : "Maximise (double-click the title)"}
              className="grid size-5.5 place-items-center rounded-sm border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground active:pressed"
              onClick={() => windows.getState().toggleMaximised(id, initial)}
            >
              {snap === "full" ? <PiCornersIn className="size-3.5" /> : <PiCornersOut className="size-3.5" />}
            </button>
          )}
          <button
            type="button"
            aria-label={`Close ${title}`}
            className="grid size-5.5 place-items-center rounded-sm border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground active:pressed"
            onClick={onClose}
          >
            <PiX className="size-3.5" />
          </button>
        </div>
      </header>
      {children}
      {resizable && !snap && EDGES.map((edge) => <div key={edge} aria-hidden className={cn("absolute z-20", EDGE_BOX[edge])} style={{ cursor: EDGE_CURSOR[edge] }} onPointerDown={(e) => dragEdge(e, edge)} data-resize={edge} />)}
    </section>
  );
}

const EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const EDGE_BOX: Record<ResizeEdge, string> = {
  n: "inset-x-2 top-0 h-1",
  s: "inset-x-2 bottom-0 h-1.5",
  e: "inset-y-2 right-0 w-1.5",
  w: "inset-y-2 left-0 w-1.5",
  ne: "top-0 right-0 size-2.5",
  nw: "top-0 left-0 size-2.5",
  se: "right-0 bottom-0 size-3",
  sw: "bottom-0 left-0 size-2.5",
};
const EDGE_CURSOR: Record<ResizeEdge, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/**
 * Where a small window of this size opens: the middle of the desktop named `desktop` (the first one on
 * the page by default), a little above it. It's read when the window first shows; after that, the
 * window is where it's been put.
 */
export function centredOnDesktop(width: number, height: number, desktop?: string): WindowPlace {
  const desk = document.querySelector(desktop ? `[data-desktop="${desktop}"]` : "[data-desktop]")?.getBoundingClientRect();
  if (!desk) return { x: 200, y: 120 };
  return { x: Math.max(0, Math.round((desk.width - width) / 2)), y: Math.max(0, Math.round((desk.height - height) / 3)) };
}

interface DesktopProps<Id extends string> {
  /** Where its windows are and how they're stacked. */
  windows: WindowsStore<Id>;
  /** Its name (`data-desktop`), for `centredOnDesktop`. */
  name: string;
  /** What it is, to a screen reader. */
  label: string;
  className?: string;
  children: ReactNode;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
}

/**
 * Where windows float: they're placed in it, stick to its edges and snap to fill it. It's a stacking
 * context of its own, so its windows' order never reaches past it (the app's windows float above an
 * editor's).
 */
export function Desktop<Id extends string>({ windows, name, label, className, children, onDragOver, onDrop }: DesktopProps<Id>) {
  return (
    // Its windows are given ids of its own kind (the owner's typed wrapper, as `MusicWindow`, sees to that).
    <WindowsContext.Provider value={windows as unknown as WindowsStore}>
      {/* Nothing on it is text to copy: a drag or a double-click never selects the names on buttons. */}
      <div className={cn("isolate overflow-hidden select-none", className)} data-desktop={name} aria-label={label} onDragOver={onDragOver} onDrop={onDrop}>
        {children}
        <SnapPreview />
      </div>
    </WindowsContext.Provider>
  );
}

/** Where a window being dragged to the desktop's edge will go when it's let go. */
function SnapPreview() {
  const windows = useWindowsStore();
  const snap = windows((s) => s.snapPreview);
  if (!snap) return null;
  return <div className="pointer-events-none absolute z-[9999] rounded-sm border-2 border-brand/60 bg-brand/10 transition-all" style={SNAPPED[snap]} data-testid="snap-preview" />;
}
