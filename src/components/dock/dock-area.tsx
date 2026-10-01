import {
  createContext,
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { PiArrowSquareIn, PiArrowSquareOut, PiDotsThree, PiLayout } from "react-icons/pi";
import { create } from "zustand";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FloatingWindow } from "@/components/windows/floating-window";
import { startPointerDrag } from "@/lib/pointer-drag";
import { type DockGroup, type DockLayout, type DockNode, type DockSplit, type DropZone, dropZone, resizePair, zoneRect } from "./model";
import type { DockStore } from "./store";

/** A panel the dock can show. */
export interface DockPanel {
  title: string;
  /**
   * What it shows, filling its group. `shown` is false for a `keepMounted` panel behind another tab
   * (it's drawn hidden, to keep its state).
   */
  render: (shown: boolean) => ReactNode;
  keepMounted?: boolean;
  /** The least room it needs (px). */
  minWidth: number;
  minHeight: number;
  /** A drag (of files...) held over its tab brings it to the front, to drop inside it. */
  springs?: (e: DragEvent) => boolean;
}

/** A ready-made layout, offered in every panel's menu (Premiere's workspaces). */
export interface DockWorkspace<P extends string = string> {
  name: string;
  layout: () => DockLayout<P>;
}

interface DockContextValue {
  dock: DockStore;
  panels: Record<string, DockPanel>;
  /** Minimums that change with what's showing (a panel that wants more room for a while). */
  mins: Partial<Record<string, { width?: number; height?: number }>>;
  workspaces: DockWorkspace[];
}

const DockContext = createContext<DockContextValue | null>(null);
const useDock = () => useContext(DockContext)!;

/** The tab being dragged and where it would land: drawn over the dock while it lasts. */
const useDockDrag = create<{ panel: string | null; target: { groupId: string; zone: DropZone; index?: number; rect: DOMRect } | null }>(() => ({
  panel: null,
  target: null,
}));

/** Hold a drag over a tab this long to bring its panel to the front. */
const SPRING_MS = 450;
/** The line between two panes (px); its grip is wider. */
const HANDLE = 1;
const TAB_STRIP = 36;

interface DockAreaProps<P extends string> {
  dock: DockStore<P>;
  panels: Record<P, DockPanel>;
  mins?: Partial<Record<P, { width?: number; height?: number }>>;
  workspaces?: DockWorkspace<P>[];
  className?: string;
}

/**
 * Panels laid out as the dock's layout says: groups of tabs in splits. A tab dragged onto another
 * group goes among its tabs (its middle or its tab strip) or beside it (nearer an edge); the line
 * between two panes resizes them; each group's menu floats its panel, picks a workspace or resets the
 * layout. Floating panels are drawn by `FloatingPanels`, on a desktop.
 */
export function DockArea<P extends string>({ dock, panels, mins = {}, workspaces = [], className }: DockAreaProps<P>) {
  const root = dock((s) => s.layout.root);
  const value: DockContextValue = {
    dock: dock as unknown as DockStore,
    panels,
    mins,
    workspaces: workspaces as DockWorkspace[],
  };
  return (
    <DockContext value={value}>
      <div className={cn("flex min-h-0 min-w-0 flex-1", className)} data-dock>
        {root ? <NodeView node={root} /> : <EmptyDock />}
      </div>
      <DropPreview />
    </DockContext>
  );
}

/** The least room a node needs: its panels' minimums, added up along a split. */
function minSize(node: DockNode, ctx: DockContextValue): { width: number; height: number } {
  if (node.type === "group") {
    let width = 0;
    let height = 0;
    for (const p of node.panels) {
      const def = ctx.panels[p];
      width = Math.max(width, def.minWidth, ctx.mins[p]?.width ?? 0);
      height = Math.max(height, def.minHeight + TAB_STRIP, (ctx.mins[p]?.height ?? 0) + TAB_STRIP);
    }
    return { width, height };
  }
  const sizes = node.children.map((c) => minSize(c, ctx));
  const along = (k: "width" | "height") => sizes.reduce((a, s) => a + s[k], 0) + HANDLE * (sizes.length - 1);
  const across = (k: "width" | "height") => Math.max(...sizes.map((s) => s[k]));
  return node.direction === "row" ? { width: along("width"), height: across("height") } : { width: across("width"), height: along("height") };
}

function NodeView({ node }: { node: DockNode }) {
  return node.type === "group" ? <GroupView group={node} /> : <SplitView split={node} />;
}

function SplitView({ split }: { split: DockSplit }) {
  const ctx = useDock();
  const row = split.direction === "row";
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1", row ? "flex-row" : "flex-col")} data-dock-split={split.id}>
      {split.children.map((child, i) => {
        const min = minSize(child, ctx);
        return (
          <Fragment key={child.id}>
            {i > 0 && <SplitHandle split={split} index={i - 1} />}
            <div data-dock-pane className="flex min-h-0 min-w-0" style={{ flex: `${split.sizes[i]} 1 0px`, minWidth: min.width, minHeight: min.height }}>
              <NodeView node={child} />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/** The line between two panes: drag it (or focus it and use the arrows) to share the room differently. */
function SplitHandle({ split, index }: { split: DockSplit; index: number }) {
  const ctx = useDock();
  const row = split.direction === "row";
  const [active, setActive] = useState(false);

  /** The panes' sizes now (px) and their minimums along the split. */
  const measure = (handle: HTMLElement) => {
    const panes = [...handle.parentElement!.children].filter((el) => el.hasAttribute("data-dock-pane"));
    const sizes = panes.map((el) => (row ? el.getBoundingClientRect().width : el.getBoundingClientRect().height));
    const mins = split.children.map((c) => (row ? minSize(c, ctx).width : minSize(c, ctx).height));
    return { sizes, mins };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { sizes, mins } = measure(e.currentTarget);
    const from = row ? e.clientX : e.clientY;
    let last = sizes;
    // Nothing under the pointer starts a native drag or a text selection meanwhile.
    e.preventDefault();
    startPointerDrag(e, {
      threshold: 0,
      cursor: row ? "col-resize" : "row-resize",
      onStart: () => setActive(true),
      onMove(ev) {
        last = resizePair(sizes, index, (row ? ev.clientX : ev.clientY) - from, mins);
        ctx.dock.getState().resize(split.id, last);
      },
      onEnd() {
        setActive(false);
        ctx.dock.getState().resize(split.id, last, true);
      },
      onCancel() {
        setActive(false);
        ctx.dock.getState().resize(split.id, split.sizes);
      },
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    const delta = e.key === (row ? "ArrowLeft" : "ArrowUp") ? -step : e.key === (row ? "ArrowRight" : "ArrowDown") ? step : 0;
    if (!delta) return;
    e.preventDefault();
    const { sizes, mins } = measure(e.currentTarget);
    ctx.dock.getState().resize(split.id, resizePair(sizes, index, delta, mins), true);
  };

  return (
    <div
      role="separator"
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-label="Resize panels"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      data-dock-handle={split.id}
      className={cn(
        "group/handle relative z-20 shrink-0 touch-none bg-line outline-none",
        row ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
      )}
    >
      {/* A grip wider than the line, and the accent along it while it's hovered, dragged or focused. */}
      <div className={cn("absolute", row ? "inset-y-0 -left-1 -right-1" : "inset-x-0 -top-1 -bottom-1")} />
      <div
        className={cn(
          "pointer-events-none absolute bg-brand opacity-0 transition-opacity group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100",
          row ? "inset-y-0 left-1/2 w-0.5 -translate-x-1/2" : "inset-x-0 top-1/2 h-0.5 -translate-y-1/2",
          active && "opacity-100",
        )}
      />
    </div>
  );
}

function GroupView({ group }: { group: DockGroup }) {
  const { panels } = useDock();
  const active = panels[group.active];
  return (
    <section data-dock-group={group.id} aria-label={`${active.title} panel`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-1 pr-1 pl-1" data-dock-tabs>
        <div role="tablist" aria-label="Panels" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
          {group.panels.map((p) => (
            <PanelTab key={p} panel={p} selected={p === group.active} />
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center">
          <PanelMenu panel={group.active} />
        </div>
      </div>
      {group.panels.map((p) =>
        p === group.active || panels[p].keepMounted ? (
          <div key={p} className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", p !== group.active && "hidden")} data-dock-panel={p}>
            {panels[p].render(p === group.active)}
          </div>
        ) : null,
      )}
    </section>
  );
}

/** A panel's tab: a click shows it; dragged, it moves the panel (onto another group's tabs, middle or side). */
function PanelTab({ panel, selected }: { panel: string; selected: boolean }) {
  const { dock, panels } = useDock();
  const def = panels[panel];
  const spring = useSpring(selected, () => dock.getState().show(panel), def.springs);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const area = e.currentTarget.closest<HTMLElement>("[data-dock]");
    startPointerDrag(e, {
      threshold: 6,
      cursor: "grabbing",
      onStart: () => useDockDrag.setState({ panel, target: null }),
      onMove(ev) {
        useDockDrag.setState({ target: area ? dropTarget(area, ev.clientX, ev.clientY) : null });
      },
      onEnd() {
        const { target } = useDockDrag.getState();
        useDockDrag.setState({ panel: null, target: null });
        if (target) dock.getState().move(panel, target.groupId, target.zone, target.index);
      },
      onCancel: () => useDockDrag.setState({ panel: null, target: null }),
    });
  };

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-dock-tab={panel}
      onClick={() => dock.getState().show(panel)}
      onPointerDown={onPointerDown}
      {...spring}
      className={cn(
        "flex h-7 shrink-0 items-center rounded-md px-2 text-[13px] font-medium whitespace-nowrap transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        selected ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {def.title}
    </button>
  );
}

/** Where a tab dragged to (x, y) would go in the dock `area`: a group's tab strip or one of its zones. */
function dropTarget(area: HTMLElement, x: number, y: number) {
  const under = document.elementFromPoint(x, y);
  const groupEl = under?.closest<HTMLElement>("[data-dock-group]");
  if (!groupEl || !area.contains(groupEl)) return null;
  const rect = groupEl.getBoundingClientRect();
  const groupId = groupEl.dataset.dockGroup!;
  const strip = under?.closest<HTMLElement>("[data-dock-tabs]");
  if (strip && groupEl.contains(strip)) {
    // Among its tabs, before the first whose middle is right of the pointer.
    const tabs = [...strip.querySelectorAll<HTMLElement>("[data-dock-tab]")];
    const index = tabs.filter((t) => t.getBoundingClientRect().left + t.getBoundingClientRect().width / 2 < x).length;
    return { groupId, zone: "center" as const, index, rect };
  }
  return { groupId, zone: dropZone(rect, { x, y }), rect };
}

/** Where the tab being dragged would go if it were let go now. */
function DropPreview() {
  const target = useDockDrag((s) => s.target);
  if (!target) return null;
  const r = zoneRect(target.rect, target.zone);
  return (
    <div
      className="pointer-events-none fixed z-[60] rounded-sm border-2 border-brand/70 bg-brand/15 transition-all duration-75"
      style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
      data-testid="dock-drop-preview"
      data-zone={target.zone}
    />
  );
}

/** A group's menu: float its panel out, a workspace, the default layout. */
function PanelMenu({ panel }: { panel: string }) {
  const { dock, panels, workspaces } = useDock();
  const title = panels[panel].title;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground hover:text-foreground" aria-label={`${title} panel menu`}>
          <PiDotsThree />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => dock.getState().float(panel)}>
          <PiArrowSquareOut />
          Float {title}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {workspaces.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>}
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.name} onSelect={() => dock.getState().reset(w.layout())}>
            <PiLayout />
            {w.name}
          </DropdownMenuItem>
        ))}
        {workspaces.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => dock.getState().reset()}>Reset layout</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Every panel is floating: a way back to the usual layout. */
function EmptyDock() {
  const { dock } = useDock();
  return (
    <div className="grid flex-1 place-items-center bg-stage text-sm text-muted-foreground">
      <div className="flex flex-col items-center gap-3">
        <p>Every panel is floating.</p>
        <Button variant="outline" size="sm" onClick={() => dock.getState().reset()}>
          Reset layout
        </Button>
      </div>
    </div>
  );
}

interface FloatingPanelsProps<P extends string> {
  dock: DockStore<P>;
  panels: Record<P, DockPanel>;
  windowId: (panel: P) => string;
}

/**
 * The dock's floating panels, each a resizable window: drawn by the owner on its desktop. Its × docks
 * the panel back (panels are never closed, only moved).
 */
export function FloatingPanels<P extends string>({ dock, panels, windowId }: FloatingPanelsProps<P>) {
  const floating = dock((s) => s.layout.floating);
  return (
    <>
      {floating.map((f, i) => (
        <FloatingPanelWindow key={f.panel} panel={f.panel} def={panels[f.panel]} index={i} id={windowId(f.panel)} onDock={() => dock.getState().dock(f.panel)} />
      ))}
    </>
  );
}

function FloatingPanelWindow({ panel, def, index, id, onDock }: { panel: string; def: DockPanel; index: number; id: string; onDock: () => void }) {
  // Cascading from the top left, comfortably bigger than it needs.
  const [initial] = useState(() => ({ x: 96 + index * 28, y: 72 + index * 28, width: Math.max(def.minWidth, 640), height: Math.max(def.minHeight + 28, 420) }));
  return (
    <FloatingWindow
      id={id}
      title={def.title}
      initial={initial}
      resizable={{ minWidth: def.minWidth, minHeight: def.minHeight + 28 }}
      onClose={onDock}
      controls={
        <button
          type="button"
          aria-label={`Dock ${def.title}`}
          title="Dock it back"
          className="grid size-5.5 place-items-center rounded-sm border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground active:pressed"
          onClick={onDock}
        >
          <PiArrowSquareIn className="size-3.5" />
        </button>
      }
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background" data-dock-panel={panel}>
        {def.render(true)}
      </div>
    </FloatingWindow>
  );
}

/** Drag handlers that call `open` when a drag `springs` accepts is held over the element (Finder's spring-loaded folders). */
function useSpring(active: boolean, open: () => void, springs?: (e: DragEvent) => boolean) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const cancel = () => clearTimeout(timer.current);
  return {
    onDragEnter(e: DragEvent) {
      if (active || !springs?.(e)) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(open, SPRING_MS);
    },
    onDragLeave: cancel,
    onDrop: cancel,
  };
}
