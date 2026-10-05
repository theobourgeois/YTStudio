import { type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  PiArrowClockwise,
  PiCaretDownFill,
  PiCaretRightFill,
  PiFolderFill,
  PiFolderOpenFill,
  PiFolderSimpleDashed,
  PiMagnifyingGlass,
  PiSpeakerHighFill,
  PiSpeakerLowFill,
  PiStar,
  PiStarFill,
  PiWaveform,
  PiX,
} from "react-icons/pi";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { droppedPath, isDesktop } from "@/lib/desktop";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useTransport } from "../transport";
import { openInNewChannels, samplerToSendTo, sendToSelectedChannel, showInFinder } from "./actions";
import { BROWSER_DRAG_TYPE, type BrowserDrag, setCarriedPaths } from "./drops";
import { resolveBrowserKey } from "./keys";
import { useBrowser } from "./store";
import { type ItemRow, type Row, arrowAction, isItem, nameOf, resultRows, rowRange, step, treeRows } from "./tree";
import { type Peaks, PEAK_COLUMNS, loadPeaks, waveformStops } from "./waveform";


const ROW_HEIGHT = 22;
const INDENT = 12;

/**
 * The Browser (Alt+F8): the user's sample folders, the same in every project, searched and previewed
 * (`docs/fl-studio/browser.md`). It looks like the editor's windows but stays on the desktop's left, as
 * FL's docked Browser does: only its right edge moves, and the other windows keep to the desktop beside it.
 */
export function BrowserPanel() {
  const open = useBrowser((s) => s.open);
  const width = useBrowser((s) => s.width);
  const loaded = useBrowser((s) => s.state !== null);
  const [dropping, setDropping] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !loaded) void useBrowser.getState().load();
  }, [open, loaded]);
  // A preview doesn't outlive the song's editor.
  useEffect(() => () => useBrowser.getState().stopPreview(), []);
  // The engine's preview ends with the file: the row stops showing it.
  useEffect(
    () =>
      useTransport.subscribe((state, prev) => {
        const previewing = useBrowser.getState().previewing;
        if (previewing && prev.filePreview?.id === previewing.id && state.filePreview?.id !== previewing.id) useBrowser.setState({ previewing: null });
      }),
    [],
  );

  if (!open) return null;

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropping(true);
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDropping(false);
    if (!isDesktop) {
      toast("Folders are dropped in the desktop app", { description: "Here, add one by its path from the Browser's menu." });
      return;
    }
    const paths = [...e.dataTransfer.files].map(droppedPath).filter(Boolean);
    if (paths.length) void useBrowser.getState().addRoots(paths);
  };

  return (
    <aside
      aria-label="Browser"
      data-browser
      className="floating relative z-20 flex shrink-0 flex-col overflow-hidden border-r border-line bg-card select-none"
      style={{ width }}
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
      onDrop={onDrop}
    >
      <header className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line bg-surface-1 pr-1 pl-1">
        <BrowserMenu onAddFolder={() => setAddOpen(true)} />
        <h2 className="truncate text-xs font-medium">Browser</h2>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" aria-label="Read the folders again" title="Read the folders again (Ctrl+R)" className="text-muted-foreground hover:text-foreground" onClick={() => void useBrowser.getState().rescan()}>
            <PiArrowClockwise />
          </Button>
          <button
            type="button"
            aria-label="Close Browser"
            title="Close (Alt+F8)"
            className="grid size-5.5 place-items-center rounded-sm border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground active:pressed"
            onClick={() => useBrowser.getState().setOpen(false)}
          >
            <PiX className="size-3.5" />
          </button>
        </div>
      </header>
      <SearchBox inputRef={search} listRef={list} />
      <RowList listRef={list} searchRef={search} onAddFolder={() => setAddOpen(true)} />
      <PreviewBar />
      <WidthHandle />
      {dropping && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center border-2 border-brand/60 bg-brand/10 text-xs font-medium text-foreground" data-testid="browser-drop">
          Drop folders to add them
        </div>
      )}
      <AddFolderDialog open={addOpen} onOpenChange={setAddOpen} />
    </aside>
  );
}

function BrowserMenu({ onAddFolder }: { onAddFolder: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Browser menu" className="text-muted-foreground hover:text-foreground">
          <PiCaretRightFill />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onAddFolder}>Add a folder by its path…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void useBrowser.getState().rescan()}>
          Read the folders again <DropdownMenuShortcut>⌃R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useBrowser.getState().collapseAll()}>
          Close every folder <DropdownMenuShortcut>⌘↑</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddFolderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [path, setPath] = useState("");
  const add = () => {
    if (!path.trim()) return;
    void useBrowser.getState().addRoots([path.trim()]);
    setPath("");
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Add a folder</DialogTitle>
        <DialogDescription>Its full path. In the desktop app, you can drop folders from Finder onto the Browser instead.</DialogDescription>
        <Input autoFocus placeholder="/Users/you/Music/Samples" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="Folder path" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={add} disabled={!path.trim()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Search ------------------------------------------------------------------------------------------

function SearchBox({ inputRef, listRef }: { inputRef: React.RefObject<HTMLInputElement | null>; listRef: React.RefObject<HTMLDivElement | null> }) {
  const query = useBrowser((s) => s.query);
  const total = useBrowser((s) => s.results?.total ?? null);
  const indexing = useBrowser((s) => s.state?.indexing ?? false);

  const intoList = (play: boolean) => {
    const first = step(visibleRows(), null, 1);
    if (first) choose(first, play);
    listRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      intoList(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      intoList(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query) useBrowser.getState().setQuery("");
      else listRef.current?.focus();
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
      <div className="sunken flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5">
        <PiMagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Search (⌘F)"
          aria-label="Search the Browser"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          onChange={(e) => useBrowser.getState().setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button type="button" aria-label="Clear the search" className="text-muted-foreground hover:text-foreground" onClick={() => useBrowser.getState().setQuery("")}>
            <PiX className="size-3" />
          </button>
        )}
      </div>
      {query && total !== null && (
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" data-testid="browser-result-count">
          {total}
          {indexing ? "…" : ""}
        </span>
      )}
    </div>
  );
}

// --- Rows --------------------------------------------------------------------------------------------

/** The rows shown now: the search's results while there's a query, else the tree. */
function rowsOf(s: ReturnType<typeof useBrowser.getState>): Row[] {
  const favourites = s.state?.favourites ?? [];
  if (s.query.trim()) return s.results ? resultRows(s.results.hits, favourites) : [];
  return treeRows({ roots: s.state?.roots ?? [], favourites, expanded: s.expanded, contents: s.contents });
}

let rowsCache: { key: unknown[]; rows: Row[] } | null = null;
/** The rows, worked out again only when what they're made of changes. */
function visibleRows(): Row[] {
  const s = useBrowser.getState();
  const key = [s.state, s.query, s.results, s.expanded, s.contents];
  if (!rowsCache || rowsCache.key.some((k, i) => k !== key[i])) rowsCache = { key, rows: rowsOf(s) };
  return rowsCache.rows;
}

/** Select one row and act on it: a file plays, a favourite or found folder shows in the tree. */
function choose(row: ItemRow, play: boolean) {
  const store = useBrowser.getState();
  store.select([row.key], row.key);
  if (row.item.kind === "file") {
    if (play) store.preview(row.item.path);
  } else if (row.section !== "tree") {
    if (play) store.reveal(row.item.path, true);
  }
}

function RowList({ listRef, searchRef, onAddFolder }: { listRef: React.RefObject<HTMLDivElement | null>; searchRef: React.RefObject<HTMLInputElement | null>; onAddFolder: () => void }) {
  const rows = useBrowser(() => visibleRows());
  const roots = useBrowser((s) => s.state?.roots.length ?? null);
  const query = useBrowser((s) => s.query);
  const scrollTo = useBrowser((s) => s.scrollTo);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(400);
  const [menuRow, setMenuRow] = useState<ItemRow | null>(null);

  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, [listRef]);

  // Keep the cursor's row in view (the arrows, a jump to a favourite).
  const cursor = useBrowser((s) => s.cursor);
  const bringIntoView = (key: string | null) => {
    const element = listRef.current;
    const at = rows.findIndex((r) => r.key === key);
    if (!element || at < 0) return false;
    const top = at * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    return true;
  };
  useLayoutEffect(() => {
    bringIntoView(cursor);
    // Only when the cursor moves: scrolling by hand leaves it where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);
  useLayoutEffect(() => {
    if (scrollTo && bringIntoView(scrollTo)) useBrowser.getState().clearScrollTo();
  });
  // A new search starts at the top.
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query, listRef]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const action = resolveBrowserKey(e);
    if (!action) return;
    const store = useBrowser.getState();
    const current = rows.find((r) => r.key === store.cursor);
    e.preventDefault();
    switch (action.type) {
      case "move":
      case "page":
      case "edge": {
        const by = action.type === "move" ? action.direction : action.type === "page" ? action.direction * Math.max(1, Math.floor(height / ROW_HEIGHT) - 1) : action.direction * rows.length;
        const next = step(rows, store.cursor, store.cursor ? by : action.direction);
        if (!next) return;
        const send = action.type === "move" && action.send && next.item.kind === "file";
        choose(next, action.type === "move" && !send);
        if (send) void sendToSelectedChannel(next.item.path, { swap: true });
        return;
      }
      case "arrow": {
        if (!store.cursor) return;
        const arrow = arrowAction(rows, store.cursor, action.direction);
        if (arrow?.type === "expand") store.expand(arrow.path);
        else if (arrow?.type === "collapse") store.collapse(arrow.path);
        else if (arrow?.type === "go") choose(arrow.row, false);
        return;
      }
      case "enter":
        if (!isItem(current)) return;
        if (current.item.kind === "file") void sendToSelectedChannel(current.item.path);
        else if (current.section === "tree") store.toggleFolder(current.item.path);
        else store.reveal(current.item.path, true);
        return;
      case "escape":
        if (store.previewing) store.stopPreview();
        else if (store.query) store.setQuery("");
        return;
      case "search":
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      case "type":
        searchRef.current?.focus();
        store.setQuery(store.query + action.text);
        return;
      case "rescan":
        void store.rescan();
        return;
      case "collapseAll":
        store.collapseAll();
        return;
      case "selectAll": {
        const files = rows.filter(isItem).filter((r) => r.item.kind === "file");
        store.select(
          files.map((r) => r.key),
          store.cursor,
        );
        return;
      }
    }
  };

  const first = Math.max(0, Math.floor(scroll / ROW_HEIGHT) - 5);
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW_HEIGHT) + 5);

  return (
    <ContextMenu onOpenChange={(open) => !open && setMenuRow(null)}>
      <ContextMenuTrigger asChild>
        <div
          ref={listRef}
          role="tree"
          aria-label="Browser files"
          aria-multiselectable
          tabIndex={0}
          className="relative min-h-0 flex-1 overflow-y-auto py-0.5 text-xs outline-none"
          onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => {
            // Only a row has a menu.
            if (!(e.target as HTMLElement).closest("[data-row]")) e.preventDefault();
          }}
          data-testid="browser-list"
        >
          <div style={{ height: rows.length * ROW_HEIGHT }} className="relative">
            {rows.slice(first, last).map((row, i) => (
              <RowView key={row.key} row={row} top={(first + i) * ROW_HEIGHT} rows={rows} onMenu={setMenuRow} />
            ))}
          </div>
          {roots === 0 && !query && <EmptyState onAddFolder={onAddFolder} />}
          {query && rows.length === 0 && <p className="px-3 py-2 text-muted-foreground">Nothing found.</p>}
        </div>
      </ContextMenuTrigger>
      {menuRow && <RowMenu row={menuRow} />}
    </ContextMenu>
  );
}

function EmptyState({ onAddFolder }: { onAddFolder: () => void }) {
  return (
    <div className="absolute inset-x-0 top-6 flex flex-col items-center gap-2 px-6 text-center text-muted-foreground">
      <PiFolderSimpleDashed className="size-8 opacity-60" />
      <p className="text-xs leading-relaxed">{isDesktop ? "Drop your sample folders here from Finder." : "Add your sample folders to browse and search them."}</p>
      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onAddFolder}>
        Add a folder by its path…
      </Button>
    </div>
  );
}

const RowView = memo(function RowView({ row, top, rows, onMenu }: { row: Row; top: number; rows: Row[]; onMenu: (row: ItemRow) => void }) {
  const selected = useBrowser((s) => s.selected.includes(row.key));
  const isCursor = useBrowser((s) => s.cursor === row.key);
  const playing = useBrowser((s) => isItem(row) && s.previewing?.path === row.item.path);

  if (row.kind === "heading") {
    return (
      <div className="absolute inset-x-0 flex items-end px-2 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase" style={{ top, height: ROW_HEIGHT }}>
        {row.label}
      </div>
    );
  }
  if (row.kind === "note") {
    return (
      <div className="absolute inset-x-0 flex items-center truncate pr-2 text-muted-foreground italic" style={{ top, height: ROW_HEIGHT, paddingLeft: 8 + row.depth * INDENT + 14 }}>
        {row.text}
      </div>
    );
  }

  const { item } = row;
  const folder = item.kind === "folder";
  const onClick = (e: MouseEvent) => {
    const store = useBrowser.getState();
    if (e.metaKey || e.ctrlKey) {
      const keys = store.selected.includes(row.key) ? store.selected.filter((k) => k !== row.key) : [...store.selected, row.key];
      return store.select(keys, row.key);
    }
    if (e.shiftKey && store.cursor) return store.select(rowRange(rows, store.cursor, row.key), store.cursor);
    if (folder && row.section === "tree") {
      store.select([row.key], row.key);
      return store.toggleFolder(item.path);
    }
    // A file played when it was pressed.
    choose(row, folder);
  };
  // A file plays as it's pressed, not when it's let go, as in FL Studio: so it can be played in time
  // with the song. Pressed among others selected, they stay selected for a drag (the click selects it alone).
  const onPointerDown = (e: ReactPointerEvent) => {
    if (folder || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || (e.target as HTMLElement).closest("button")) return;
    const store = useBrowser.getState();
    if (!store.selected.includes(row.key)) store.select([row.key], row.key);
    store.preview(item.path);
  };
  const onDragStart = (e: DragEvent) => {
    const store = useBrowser.getState();
    // A drag of a row that isn't selected takes it alone.
    const keys = store.selected.includes(row.key) ? store.selected : [row.key];
    if (!store.selected.includes(row.key)) store.select([row.key], row.key);
    const paths = keys.map((k) => rows.find((r) => r.key === k)).filter((r): r is ItemRow => isItem(r) && r.item.kind === "file").map((r) => r.item.path);
    if (!paths.length) return e.preventDefault();
    e.dataTransfer.setData(BROWSER_DRAG_TYPE, JSON.stringify({ paths } satisfies BrowserDrag));
    e.dataTransfer.effectAllowed = "copy";
    setCarriedPaths(paths);
  };

  return (
    <div
      role="treeitem"
      aria-label={item.name}
      aria-selected={selected}
      aria-expanded={folder && row.section === "tree" ? row.expanded : undefined}
      aria-level={row.depth + 1}
      data-row={row.key}
      data-kind={item.kind}
      data-playing={playing || undefined}
      title={row.folder ? `${row.folder}/${item.name}` : item.path}
      draggable={!folder}
      onDragStart={onDragStart}
      onDragEnd={() => setCarriedPaths(null)}
      onClick={onClick}
      onPointerDown={onPointerDown}
      // The middle button sends a file to the selected channel, as FL's does.
      onAuxClick={(e) => {
        if (e.button !== 1 || folder) return;
        e.preventDefault();
        useBrowser.getState().select([row.key], row.key);
        void sendToSelectedChannel(item.path);
      }}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onContextMenu={() => {
        const store = useBrowser.getState();
        if (!store.selected.includes(row.key)) store.select([row.key], row.key);
        onMenu(row);
      }}
      className={cn(
        "group absolute inset-x-0 flex cursor-pointer items-center gap-1 pr-1.5",
        selected ? "bg-brand/20" : "hover:bg-surface-2",
        isCursor && "shadow-[inset_2px_0_0_var(--color-brand)]",
        row.missing && "opacity-50",
      )}
      style={{ top, height: ROW_HEIGHT, paddingLeft: 6 + row.depth * INDENT }}
    >
      {folder && row.section === "tree" ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="grid size-3.5 shrink-0 place-items-center text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation();
            useBrowser.getState().toggleFolder(item.path);
          }}
        >
          {row.expanded ? <PiCaretDownFill className="size-2.5" /> : <PiCaretRightFill className="size-2.5" />}
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      {folder ? (
        row.expanded ? (
          <PiFolderOpenFill className={cn("size-3.5 shrink-0", row.root ? "text-brand" : "text-muted-foreground")} />
        ) : (
          <PiFolderFill className={cn("size-3.5 shrink-0", row.root ? "text-brand" : "text-muted-foreground")} />
        )
      ) : playing ? (
        <PiSpeakerHighFill className="size-3.5 shrink-0 text-brand" />
      ) : (
        <PiWaveform className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className={cn("min-w-0 truncate", playing && "text-brand", row.root && "font-medium")}>{item.name}</span>
      {row.folder && <span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground">{row.folder}</span>}
      <button
        type="button"
        tabIndex={-1}
        aria-label={row.favourite ? `Unstar ${item.name}` : `Star ${item.name}`}
        title={row.favourite ? "Remove from favourites" : "Add to favourites"}
        className={cn("ml-auto grid size-4 shrink-0 place-items-center", row.favourite ? "text-brand" : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground")}
        onClick={(e) => {
          e.stopPropagation();
          void useBrowser.getState().setFavourite(item.path, !row.favourite);
        }}
      >
        {row.favourite ? <PiStarFill className="size-3" /> : <PiStar className="size-3" />}
      </button>
    </div>
  );
});

function RowMenu({ row }: { row: ItemRow }) {
  const store = useBrowser.getState();
  const { item } = row;
  const folder = item.kind === "folder";
  // The files selected (the row right-clicked is one of them).
  const files = visibleRows()
    .filter(isItem)
    .filter((r) => store.selected.includes(r.key) && r.item.kind === "file")
    .map((r) => r.item.path);
  const target = samplerToSendTo();
  return (
    <ContextMenuContent className="min-w-56">
      {folder ? (
        row.section === "tree" ? (
          <ContextMenuItem onSelect={() => store.toggleFolder(item.path)}>{row.expanded ? "Close" : "Open"}</ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => store.reveal(item.path, true)}>Show in the Browser</ContextMenuItem>
        )
      ) : (
        <>
          <ContextMenuItem onSelect={() => void sendToSelectedChannel(item.path)}>
            {target ? `Send to ${target.name}` : "Send to selected channel"} <ContextMenuShortcut>↵</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void openInNewChannels(files.length ? files : [item.path])}>
            {files.length > 1 ? `Open ${files.length} files in new channels` : "Open in new channel"}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => store.preview(item.path)}>Play</ContextMenuItem>
          {row.section !== "tree" && <ContextMenuItem onSelect={() => store.reveal(item.path, false)}>Show in its folder</ContextMenuItem>}
        </>
      )}
      <ContextMenuItem onSelect={() => showInFinder(item.path)}>Show in Finder</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void store.setFavourite(item.path, !row.favourite)}>{row.favourite ? "Remove from favourites" : "Add to favourites"}</ContextMenuItem>
      {row.root && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void store.rescan()}>Read again</ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => void store.removeRoot(item.path)}>
            Remove from the Browser
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}

// --- Preview -----------------------------------------------------------------------------------------

/** The selected file (or the one playing): its waveform, where the preview is in it, and the preview's volume. */
function PreviewBar() {
  const path = useBrowser((s) => {
    const row = visibleRows().find((r) => r.key === s.cursor);
    return isItem(row) && row.item.kind === "file" ? row.item.path : (s.previewing?.path ?? null);
  });
  const volume = useBrowser((s) => s.volume);
  const [peaks, setPeaks] = useState<{ path: string; peaks: Peaks | null; error?: string } | null>(null);

  useEffect(() => {
    if (!path) return;
    let current = true;
    loadPeaks(path).then(
      (loaded) => current && setPeaks({ path, peaks: loaded }),
      (err: unknown) => current && setPeaks({ path, peaks: null, error: err instanceof Error ? err.message : "Can't draw it." }),
    );
    return () => {
      current = false;
    };
  }, [path]);

  const shown = peaks?.path === path ? peaks : null;
  const name = path ? nameOf(path) : "";
  return (
    <div className="shrink-0 border-t border-line bg-surface-1 px-2 pt-1.5 pb-2" data-testid="browser-preview">
      <div className="mb-1 flex h-4 items-center gap-1.5 text-[11px]">
        <span className="min-w-0 flex-1 truncate">{name || <span className="text-muted-foreground">No file selected</span>}</span>
        {shown?.peaks && <span className="shrink-0 text-muted-foreground tabular-nums">{formatSeconds(shown.peaks.duration)}</span>}
      </div>
      <Waveform path={path} peaks={shown?.peaks ?? null} note={shown?.error} />
      <div className="mt-1.5 flex items-center gap-2">
        <PiSpeakerLowFill className="size-3 shrink-0 text-muted-foreground" />
        <Slider className="flex-1" min={0} max={1} step={0.01} value={[volume]} onValueChange={([v]) => useBrowser.getState().setVolume(v)} aria-label="Preview volume" />
        <PiSpeakerHighFill className="size-3 shrink-0 text-muted-foreground" />
      </div>
    </div>
  );
}

const WAVE_HEIGHT = 44;
/** How far from the middle a full-scale (0 dB) point is drawn. */
const WAVE_SCALE = WAVE_HEIGHT / 2 - 2;
const WAVE_STOPS = waveformStops(WAVE_HEIGHT, WAVE_SCALE);

/**
 * A file's waveform, in the mixer meters' colours (green, through amber, to red at 0 dB), opening out from
 * its middle as it arrives: click it to play from there. A playhead follows the engine's preview of it.
 */
function Waveform({ path, peaks, note }: { path: string | null; peaks: Peaks | null; note?: string }) {
  const gradient = useId();
  const head = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);

  // The playhead, moved directly once a frame while this file plays.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = head.current;
      if (!element) return;
      const { filePreview, at, latencyMs } = useTransport.getState();
      const previewing = useBrowser.getState().previewing;
      if (!filePreview || !previewing || previewing.id !== filePreview.id || previewing.path !== path || filePreview.duration <= 0) {
        element.style.opacity = "0";
        return;
      }
      const seconds = filePreview.seconds + Math.max(0, performance.now() - at - latencyMs) / 1000;
      element.style.opacity = "1";
      element.style.left = `${Math.min(100, (seconds / filePreview.duration) * 100)}%`;
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [path]);

  const d = useMemo(() => {
    if (!peaks) return "";
    const mid = WAVE_HEIGHT / 2;
    const y = (v: number, nudge: number) => (mid - Math.max(-1, Math.min(1, v)) * WAVE_SCALE + nudge).toFixed(1);
    let path = "";
    for (let x = 0; x < PEAK_COLUMNS; x++) path += `${x ? "L" : "M"}${x} ${y(peaks.max[x], -0.5)}`;
    for (let x = PEAK_COLUMNS - 1; x >= 0; x--) path += `L${x} ${y(peaks.min[x], 0.5)}`;
    return `${path}Z`;
  }, [peaks]);

  return (
    <div
      ref={box}
      className={cn("sunken relative overflow-hidden rounded-sm", path && "cursor-pointer")}
      style={{ height: WAVE_HEIGHT }}
      onPointerDown={(e) => {
        if (!path || e.button !== 0) return;
        const r = e.currentTarget.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        useBrowser.getState().preview(path, peaks ? fraction * peaks.duration : 0);
      }}
      title={path ? "Click to play from there" : undefined}
      data-testid="browser-waveform"
      data-loaded={peaks !== null}
    >
      {peaks ? (
        // Keyed by the peaks, so each file's waveform comes in afresh.
        <svg key={path} viewBox={`0 0 ${PEAK_COLUMNS} ${WAVE_HEIGHT}`} preserveAspectRatio="none" className="browser-wave absolute inset-0 size-full" aria-hidden>
          <defs>
            <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={WAVE_HEIGHT}>
              {WAVE_STOPS.map((stop, i) => (
                <stop key={i} offset={stop.offset} style={{ stopColor: stop.colour }} />
              ))}
            </linearGradient>
          </defs>
          <line x1={0} x2={PEAK_COLUMNS} y1={WAVE_HEIGHT / 2} y2={WAVE_HEIGHT / 2} strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ stroke: "var(--meter-low)" }} opacity={0.35} />
          <path d={d} fill={`url(#${gradient})`} opacity={0.92} />
        </svg>
      ) : (
        note && <p className="absolute inset-0 grid place-items-center text-[10px] text-muted-foreground">{note}</p>
      )}
      <div ref={head} className="pointer-events-none absolute inset-y-0 w-px bg-foreground opacity-0" />
    </div>
  );
}

const formatSeconds = (seconds: number) => {
  if (seconds < 10) return `${seconds.toFixed(2)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/** The Browser's right edge: dragged to make it wider or narrower. */
function WidthHandle() {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = useBrowser.getState().width;
    startPointerDrag(e, {
      threshold: 0,
      cursor: "ew-resize",
      onMove: (ev) => useBrowser.getState().setWidth(start + ev.clientX - e.clientX),
      onCancel: () => useBrowser.getState().setWidth(start),
    });
  };
  return <div aria-hidden className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-ew-resize hover:bg-brand/30" onPointerDown={onPointerDown} data-testid="browser-resize" />;
}
