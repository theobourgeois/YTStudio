import { createContext, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PiCornersIn, PiCornersOut, PiX } from "react-icons/pi";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { PortalContainerProvider } from "@/components/ui/portal-container";
import { desktopPanels } from "@/lib/desktop";
import { startPointerDrag } from "@/lib/pointer-drag";
import { isElement, ownerDocument } from "@/lib/window-events";
import { type Rect, type ResizeEdge, type WindowSnap, cascade, edgeSnap, magnetise, resizeRect, snappedRect, unsnapAt, EDGE_ZONE } from "./geometry";
import { workAreas } from "./native/bridge";
import { type DeskTracker, createDeskTracker, openPanels, useDeskVersion, usePanelWindow } from "./native/use-panel";
import { areaFor, capSize, deskToScreen, keepReachable, pointToDesk, sameRect, screenToDesk } from "./native/geometry";
import type { WindowPlace, WindowsStore } from "./store";

/** How much of a window must stay on the desktop (px), so it can always be grabbed again. */
const KEEP_IN_VIEW = 80;
const TITLE_HEIGHT = 28;

/** The windows of the desktop a window is on (`Desktop` provides them). */
const WindowsContext = createContext<WindowsStore | null>(null);
/**
 * Set when the desktop's windows are windows of the operating system (`Desktop`'s `native`, in the desktop
 * app): where the desktop is, so a window can be put on the screen.
 */
const NativeDeskContext = createContext<DeskTracker | null>(null);

function useWindowsStore(): WindowsStore {
  const store = useContext(WindowsContext);
  if (!store) throw new Error("A FloatingWindow must be on a Desktop.");
  return store;
}

/** The title bar's height (px): how much of a window stays on a display so it can be grabbed again. */
const KEEP_TITLE = 28;

export interface FloatingWindowProps {
  id: string;
  title: string;
  /** Where it opens (and, if it's resizable, how big, and whether it fills the desktop), until it's moved. */
  initial: WindowPlace;
  onClose: () => void;
  /** Called when a pointer activates this window, so native surfaces can follow its stacking order. */
  onActivate?: () => void;
  /** At the start of the title bar (the window's menu arrow). */
  menu?: ReactNode;
  /** Shown instead of the title's text (which still names the window): a selector, as the Piano roll's channel. */
  heading?: ReactNode;
  /** Before the title, as FL Studio puts them: the window's tools (the Piano roll's and the Playlist's). */
  tools?: ReactNode;
  /** After the title: the window's own controls. */
  controls?: ReactNode;
  /**
   * Its edges resize it (no smaller than this), a double-click on its title fills the desktop with it,
   * and dragged to the desktop's top or sides it snaps to fill it or half of it. Its content should
   * fill it. Windows that aren't resizable fit what's in them.
   */
  resizable?: { minWidth: number; minHeight: number };
  /**
   * Keys pressed in it are its own, as in a dialog, though the window doesn't stop the editor under it
   * being used: the editors' shortcuts leave them alone (`keptByWindow`) and Esc closes it. The focus
   * moves into it when it opens (to its `[data-autofocus]` element, or the window itself) and back
   * where it was when it closes. Settings, the export and the video editor's other windows are such.
   */
  keepsKeys?: boolean;
  /** With `keepsKeys`, whether Esc closes it (the export's doesn't while it renders). */
  escapeCloses?: boolean;
  className?: string;
  children: ReactNode;
}

/** Whether a key pressed on `target` belongs to a window that keeps its keys (`keepsKeys`): editors' shortcuts check it. */
export function keptByWindow(target: EventTarget | null): boolean {
  return isElement(target) && target.closest("[data-keeps-keys]") !== null;
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
export function FloatingWindow({ id, title, initial, onClose, onActivate, menu, heading, tools, controls, resizable, keepsKeys, escapeCloses = true, className, children }: FloatingWindowProps) {
  const windows = useWindowsStore();
  // In the desktop app the music editor's windows are windows of the system (docs/windows.md): this one is
  // drawn into its own, and its place is a place on the screen.
  const desk = useContext(NativeDeskContext);
  const native = desk !== null;
  const deskVersion = useDeskVersion(desk ?? NO_DESK);
  const panel = usePanelWindow(id, title, native, onClose);
  const ref = useRef<HTMLElement>(null);
  // What had the focus before it opened (read while rendering, before a field in it takes it with `autoFocus`).
  const [focusedBefore] = useState(() => (keepsKeys && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => {
    if (!keepsKeys || (native && !panel)) return;
    const element = ref.current;
    const doc = element?.ownerDocument ?? document;
    if (element && !element.contains(doc.activeElement)) (element.querySelector<HTMLElement>("[data-autofocus]") ?? element).focus();
    // Back where it was, unless it's been taken elsewhere since (a click on the app under it).
    return () => {
      const now = doc.activeElement;
      if (!now || now === doc.body || element?.contains(now)) {
        focusedBefore?.ownerDocument.defaultView?.focus();
        focusedBefore?.focus();
      }
    };
  }, [keepsKeys, focusedBefore, native, panel]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!keepsKeys || !escapeCloses || e.key !== "Escape" || e.defaultPrevented || e.nativeEvent.isComposing) return;
    // An open menu or list closes first (one only fading out doesn't count).
    if (ownerDocument(e.currentTarget).querySelector("[data-radix-popper-content-wrapper] [data-state=open]")) return;
    e.preventDefault();
    onClose();
  };
  const place = windows((s) => s.places[id]) ?? initial;
  const z = windows((s) => s.order.indexOf(id));
  const snap = resizable ? (place.snap ?? null) : null;
  const size = { width: place.width ?? initial.width ?? 800, height: place.height ?? initial.height ?? 500 };
  // One that fits what's in it reaches no further than the desktop's bottom: its body scrolls instead (`WindowBody`).
  // (A native one is as big as what's in it, up to its display: `fit`.)
  const fit = native && !resizable ? fitOf(desk, panel) : null;
  const style: CSSProperties = native
    ? { ...(fit && { maxHeight: fit.height }) }
    : snap
      ? SNAPPED[snap]
      : { left: place.x, top: place.y, ...(resizable ? size : { maxHeight: `calc(100% - ${Math.max(0, place.y)}px)` }) };

  // --- Native: where the window is on the screen, and when it's shown --------------------------------------
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const applied = useRef<Rect | null>(null);
  const shown = useRef(false);
  const configured = useRef("");
  useLayoutEffect(() => {
    // A window that fits what's in it is as big as that: the panel's container is as big as its content.
    if (!panel) return;
    const c = panel.container.style;
    c.position = "fixed";
    c.left = "0";
    c.top = "0";
    if (resizable) {
      c.right = "0";
      c.bottom = "0";
      c.width = "";
      c.height = "";
      c.maxWidth = "";
      c.maxHeight = "";
    } else {
      c.right = "";
      c.bottom = "";
      c.width = "max-content";
      c.height = "max-content";
      const f = fitOf(desk, panel);
      c.maxWidth = f ? `${f.width}px` : "";
      c.maxHeight = f ? `${f.height}px` : "";
    }
  }, [panel, resizable, desk, deskVersion]);
  useLayoutEffect(() => {
    if (!panel || resizable) return;
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const r = element.getBoundingClientRect();
      const next = { width: Math.ceil(r.width), height: Math.ceil(r.height) };
      setMeasured((was) => (was && was.width === next.width && was.height === next.height ? was : next));
    };
    measure();
    // The window's own ResizeObserver: its frames are the ones the content changes in.
    const Observer = (panel.win as unknown as typeof globalThis).ResizeObserver;
    const observer = new Observer(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [panel, resizable]);
  useEffect(() => {
    if (!panel || !desk) return;
    const m = desk.metrics();
    if (!m) return;
    let r: Rect;
    if (snap) r = snappedRect(snap, m.desk);
    else if (resizable) r = { x: place.x, y: place.y, ...size };
    else if (measured) r = { x: place.x, y: place.y, ...measured };
    else return;
    const screen = keepReachable(deskToScreen(m, r), workAreas(), 80, KEEP_TITLE);
    const next = { x: Math.round(screen.x), y: Math.round(screen.y), width: Math.round(screen.width), height: Math.round(screen.height) };
    const options = JSON.stringify([resizable ? [Math.round(resizable.minWidth * m.scale), Math.round(resizable.minHeight * m.scale)] : null, resizable && !snap]);
    if (configured.current !== options) {
      configured.current = options;
      desktopPanels()?.configure(panel.name, {
        ...(resizable && { minWidth: resizable.minWidth * m.scale, minHeight: resizable.minHeight * m.scale }),
        resizable: !!resizable && !snap,
        backgroundColor: cssColour(panel.win, ownerDocument(panel.container).body),
        title,
      });
    }
    const win = panel.win;
    if (win.screenX !== next.x || win.screenY !== next.y) win.moveTo(next.x, next.y);
    if (win.outerWidth !== next.width || win.outerHeight !== next.height) win.resizeTo(next.width, next.height);
    applied.current = next;
    if (!shown.current) {
      shown.current = true;
      const front = windows.getState().order[windows.getState().order.length - 1] === id;
      desktopPanels()?.show(panel.name, front);
      if (front) ref.current?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `size` is a function of `place` and `initial`
  }, [panel, desk, deskVersion, snap, resizable, place, measured]);

  // The user resizes it by its edges (the system's): that's its place now.
  useEffect(() => {
    if (!panel || !desk || !resizable) return;
    const win = panel.win;
    const onResize = () => {
      const m = desk.metrics();
      if (!m || !shown.current) return;
      const now = { x: win.screenX, y: win.screenY, width: win.outerWidth, height: win.outerHeight };
      if (applied.current && sameRect(now, applied.current)) return;
      applied.current = now;
      const d = screenToDesk(m, now);
      windows.getState().place(id, { x: Math.round(d.x), y: Math.round(d.y), width: Math.round(d.width), height: Math.round(d.height), snap: null });
    };
    win.addEventListener("resize", onResize);
    return () => win.removeEventListener("resize", onResize);
  }, [panel, desk, resizable, windows, id]);

  // The system's focus and the stacking order the editor keeps are one: a window clicked is the front one,
  // and one brought to the front (opened again from the toolbar) is raised.
  useEffect(() => {
    if (!panel) return;
    const win = panel.win;
    const onFocus = () => windows.getState().focus(id);
    win.addEventListener("focus", onFocus);
    return () => win.removeEventListener("focus", onFocus);
  }, [panel, windows, id]);
  const isFront = windows((s) => s.order[s.order.length - 1] === id);
  useEffect(() => {
    if (panel && isFront && shown.current && !panel.win.document.hasFocus()) desktopPanels()?.raise(panel.name);
  }, [panel, isFront]);

  const dragTitle = (e: ReactPointerEvent<HTMLElement>) => {
    // Its controls are clicked, not dragged by. Nor is a menu opened from one of them: it's drawn
    // elsewhere on the page, but its events still pass through here.
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target) || target.closest(CONTROLS)) return;
    if (native) return dragNativeTitle(e);
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

  /**
   * The same drag for a window of the system: the pointer's place on the screen moves the window itself
   * (`moveTo`), its edges sticking to the desktop's and to other windows' as before; where it ends up is
   * recorded once, when it's let go. It may leave the main window, and the screen it was on, but not all of them.
   */
  const dragNativeTitle = (e: ReactPointerEvent<HTMLElement>) => {
    const m = desk?.metrics();
    if (!desk || !panel || !m) return;
    const win = panel.win;
    const areas = workAreas();
    const deskSize = { width: m.desk.width, height: m.desk.height };
    const start = screenToDesk(m, { x: win.screenX, y: win.screenY, width: win.outerWidth, height: win.outerHeight });
    const grabbed = pointToDesk(m, { x: e.screenX, y: e.screenY });
    const offset = { x: grabbed.x - start.x, y: grabbed.y - start.y };
    const others: Rect[] = [];
    for (const [otherId, other] of openPanels()) {
      if (otherId === id) continue;
      others.push(screenToDesk(m, { x: other.win.screenX, y: other.win.screenY, width: other.win.outerWidth, height: other.win.outerHeight }));
    }
    let base = start;
    let moved = start;
    let snapped = snap;
    let snapTo: WindowSnap | null = null;
    const put = (r: Rect, sized: boolean) => {
      const s = deskToScreen(m, r);
      if (sized) win.resizeTo(Math.round(s.width), Math.round(s.height));
      win.moveTo(Math.round(s.x), Math.round(s.y));
      applied.current = { x: Math.round(s.x), y: Math.round(s.y), width: Math.round(s.width), height: Math.round(s.height) };
    };
    const settle = (next: WindowPlace | null) => {
      windows.getState().setSnapPreview(null);
      if (next) windows.getState().place(id, next);
      else put(start, true);
    };
    startPointerDrag(e, {
      threshold: 3,
      cursor: "grabbing",
      onMove(ev) {
        const p = pointToDesk(m, { x: ev.screenX, y: ev.screenY });
        if (snapped) {
          // Out of its snap: back to its own size, under the pointer where it was grabbed.
          base = unsnapAt(p, { fraction: offset.x / start.width, dy: offset.y }, size);
          offset.x = p.x - base.x;
          offset.y = p.y - base.y;
          put(base, true);
          snapped = null;
        }
        const wanted: Rect = { x: p.x - offset.x, y: p.y - offset.y, width: base.width, height: base.height };
        let r = screenToDesk(m, keepReachable(deskToScreen(m, wanted), areas, 80, KEEP_TITLE));
        // Alt: no sticking.
        if (!ev.altKey) r = magnetise(r, deskSize, others);
        moved = r;
        snapTo = resizable ? nativeEdgeSnap(p, m.desk) : null;
        windows.getState().setSnapPreview(snapTo);
        put(r, false);
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

  const frame = (
    <section
      ref={ref}
      aria-label={title}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-window={id}
      data-snap={snap ?? undefined}
      data-keeps-keys={keepsKeys || undefined}
      className={cn(
        // A floating surface (the theme's outline and short shadow), its title bar a step darker than its body.
        "floating flex flex-col overflow-hidden bg-card outline-none",
        native ? (resizable ? "size-full rounded-none shadow-none" : "relative rounded-none shadow-none") : "absolute",
        !native && (snap ? "rounded-none shadow-none" : "rounded-md"),
        className,
      )}
      style={native ? style : { ...style, zIndex: 10 + (z < 0 ? 0 : z) }}
      onPointerDownCapture={(e) => {
        // Portalled menus belong to this React tree, but aren't clicks on the window.
        if (!e.currentTarget.contains(e.target as Node)) return;
        windows.getState().focus(id);
        // Controls keep their own focus; a canvas or title gives keys to the window.
        const control = (e.target as Element).closest('input, textarea, select, button, a[href], [tabindex], [contenteditable="true"]');
        if (!control || control === e.currentTarget) e.currentTarget.focus({ preventScroll: true });
        onActivate?.();
      }}
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
        {tools && <div className="flex shrink-0 items-center gap-1.5">{tools}</div>}
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
      {/* A native window is resized by the system, by its edges. */}
      {!native && resizable && !snap && EDGES.map((edge) => <div key={edge} aria-hidden className={cn("absolute z-20", EDGE_BOX[edge])} style={{ cursor: EDGE_CURSOR[edge] }} onPointerDown={(e) => dragEdge(e, edge)} data-resize={edge} />)}
    </section>
  );

  if (!native) return frame;
  // Until its window is open there's nothing to draw it in.
  return panel ? createPortal(<PortalContainerProvider value={panel.container}>{frame}</PortalContainerProvider>, panel.container) : null;
}

/** A desk tracker that never changes, for a window that isn't native (hooks can't be skipped). */
const NO_DESK: DeskTracker = { metrics: () => null, subscribe: () => () => {}, version: () => 0 };

/**
 * How big a window that fits its content can be (CSS px): its display's usable area, less a little.
 * Null before there's a display to ask about.
 */
function fitOf(desk: DeskTracker | null, panel: { win: Window } | null): { width: number; height: number } | null {
  const m = desk?.metrics();
  if (!m) return null;
  const area = areaFor(m.content, workAreas());
  if (!area) return null;
  void panel;
  const size = capSize({ width: area.width / m.scale, height: area.height / m.scale }, null);
  return { width: Math.floor(size.width), height: Math.floor(size.height) };
}

/** Where the pointer at the desktop's edge snaps a window to (the pointer must be at the desktop, not on another screen). */
function nativeEdgeSnap(p: { x: number; y: number }, desk: Rect): WindowSnap | null {
  const within = p.x >= -EDGE_ZONE && p.x <= desk.width + EDGE_ZONE && p.y >= -desk.y && p.y <= desk.height + EDGE_ZONE;
  return within ? edgeSnap(p, desk) : null;
}

/** A CSS colour (an element's background) as a hex colour the system understands, whatever its notation. */
function cssColour(win: Window, element: HTMLElement): string {
  const canvas = win.document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return "#16191d";
  g.fillStyle = "#16191d";
  g.fillStyle = win.getComputedStyle(element).backgroundColor;
  g.fillRect(0, 0, 1, 1);
  const [r, green, b] = g.getImageData(0, 0, 1, 1).data;
  return `#${[r, green, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
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

/**
 * Where the `index`th of a cascade of windows of this size opens on the desktop named `desktop`: from
 * `origin`, a `step` down and right each, kept on the desktop (`cascade`). Read when the window first shows.
 */
export function cascadedOnDesktop(index: number, origin: { x: number; y: number }, step: number, size: { width: number; height: number }, desktop?: string): WindowPlace {
  const desk = document.querySelector(desktop ? `[data-desktop="${desktop}"]` : "[data-desktop]")?.getBoundingClientRect();
  if (!desk) return { x: origin.x + index * step, y: origin.y + index * step };
  return cascade(index, origin, step, size, desk);
}

interface DesktopProps<Id extends string> {
  /** Where its windows are and how they're stacked. */
  windows: WindowsStore<Id>;
  /** Its name (`data-desktop`), for `centredOnDesktop`. */
  name: string;
  /** What it is, to a screen reader. */
  label: string;
  /** It lies over other content (the app, an editor), which stays usable: only its windows take the pointer. */
  overlay?: boolean;
  /**
   * In the desktop app, its windows are windows of the operating system rather than boxes in the page
   * (docs/windows.md): they stack among the audio engine's plugin windows, and can leave the app's window.
   * In a browser tab they stay boxes in the page.
   */
  native?: boolean;
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
export function Desktop<Id extends string>({ windows, name, label, overlay, native, className, children, onDragOver, onDrop }: DesktopProps<Id>) {
  const ref = useRef<HTMLDivElement>(null);
  const isNative = !!native && desktopPanels() !== undefined;
  const tracker = useMemo(() => createDeskTracker(ref), []);
  return (
    // Its windows are given ids of its own kind (the owner's typed wrapper, as `MusicWindow`, sees to that).
    <WindowsContext.Provider value={windows as unknown as WindowsStore}>
      <NativeDeskContext.Provider value={isNative ? tracker : null}>
        {/* Nothing on it is text to copy: a drag or a double-click never selects the names on buttons. */}
        <div ref={ref} className={cn("isolate overflow-hidden select-none", overlay && "pointer-events-none [&>[data-window]]:pointer-events-auto", className)} data-desktop={name} aria-label={label} onDragOver={onDragOver} onDrop={onDrop}>
          {children}
          <SnapPreview />
        </div>
      </NativeDeskContext.Provider>
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

/** A window's content: room around it, and scrolling when it's taller than the desktop leaves room for. */
export function WindowBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex min-h-0 flex-col gap-5 overflow-y-auto p-5", className)}>{children}</div>;
}

/** The line at the top of a window's content, on what it's for (a dialog's description). */
export function WindowLead({ children }: { children: ReactNode }) {
  return <p className="-mt-1 text-[13px] text-muted-foreground">{children}</p>;
}

/** A window's buttons, at the end of its content (a dialog's footer). */
export function WindowFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}>{children}</div>;
}
