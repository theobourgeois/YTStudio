/**
 * The Library tab: media and saved clips shared by every video, in folders.
 * Like Resolve's Power Bins or Premiere's CC Libraries, but local. Using an
 * item copies its media into the video, so deleting it here never breaks one.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  PiBooks,
  PiCaretRight,
  PiClockCounterClockwise,
  PiDotsThree,
  PiFolderOpen,
  PiFolderSimple,
  PiFolderSimplePlus,
  PiMagnifyingGlass,
  PiPencilSimple,
  PiStarFill,
  PiTrash,
  PiUploadSimple,
  PiXCircleFill,
} from "react-icons/pi";
import { useShallow } from "zustand/react/shallow";
import type { LibraryFolder, LibraryItem } from "@shared/types";
import { folderPath, recentItems } from "@shared/library";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TagChip } from "@/components/ui/tag-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ACCEPTED_FILE_TYPES } from "@/components/media/import-media";
import { UploadCard } from "@/components/media/upload-card";
import { type MenuKit, contextKit, dropdownKit } from "@/components/menu-kit";
import { setLibraryDragData } from "@/lib/dnd";
import { cn } from "cn";
import { type LibraryFilter, type LibraryView, useLibrary, viewFolder } from "@/stores/library";
import { ConfirmDeleteDialog, NameDialog } from "./library-dialogs";
import { FolderMenuItems } from "./folder-menu-items";
import { LibraryCard } from "./library-card";
import { folderItemCounts, libraryContents } from "./library-utils";
import { useLibraryDrop } from "./use-library-drop";

const FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "image", label: "Image" },
  { value: "clips", label: "Clips" },
];

type Dialog =
  | { kind: "new-folder"; parentId: string | null }
  | { kind: "rename-folder"; folder: LibraryFolder }
  | { kind: "delete-folder"; folder: LibraryFolder; count: number }
  | { kind: "rename-item"; item: LibraryItem }
  | { kind: "delete-item"; item: LibraryItem };

export function LibraryPanel() {
  const library = useLibrary(
    useShallow((s) => ({
      loaded: s.loaded,
      loadError: s.loadError,
      folders: s.folders,
      items: s.items,
      assets: s.assets,
      uploads: s.uploads,
      view: s.view,
      query: s.query,
      filter: s.filter,
    })),
  );
  const { folders, items, assets, view, query, filter } = library;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => void useLibrary.getState().load(), []);

  const media = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const contents = useMemo(
    () => libraryContents({ folders, items, assets }, { view, query, filter }),
    [folders, items, assets, view, query, filter],
  );
  const counts = useMemo(() => folderItemCounts(folders, items), [folders, items]);
  const searching = query.trim() !== "";
  const current = viewFolder(view);
  const uploads = searching ? [] : library.uploads.filter((u) => view.kind === "folder" && u.folderId === current);
  const isEmpty = library.loaded && folders.length === 0 && items.length === 0 && library.uploads.length === 0;

  const open = (d: Dialog) => {
    setDialog(d);
    setDialogOpen(true);
  };
  const openPicker = () => inputRef.current?.click();
  const newFolder = () => open({ kind: "new-folder", parentId: current });
  const location = (item: LibraryItem) => folderPath(folders, item.folderId).map((f) => f.name).join(" / ") || "Library";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        aria-label="Import into the Library"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Reset so picking the same file again still fires `change`.
          e.target.value = "";
          if (files.length > 0) void useLibrary.getState().importFiles(files, current);
        }}
      />

      {library.loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-xs text-muted-foreground">
          <p>Couldn't load the Library: {library.loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void useLibrary.getState().load()}>
            Try again
          </Button>
        </div>
      ) : isEmpty ? (
        <EmptyLibrary onImport={openPicker} onNewFolder={newFolder} />
      ) : (
        <>
          <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2">
            <div className="flex items-center gap-1">
              <div className="relative min-w-0 flex-1">
                <PiMagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => useLibrary.getState().setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape" || !query) return;
                    e.stopPropagation(); // clears the search, rather than closing the preview
                    useLibrary.getState().setQuery("");
                  }}
                  placeholder="Search the Library"
                  aria-label="Search the Library"
                  spellCheck={false}
                  className="h-8 pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      useLibrary.getState().setQuery("");
                      searchRef.current?.focus();
                    }}
                    className="absolute top-1/2 right-2 grid size-4 -translate-y-1/2 place-items-center text-muted-foreground/70 hover:text-foreground"
                  >
                    <PiXCircleFill className="size-4" />
                    <span className="sr-only">Clear search</span>
                  </button>
                )}
              </div>
              <IconButton label="New folder" onClick={newFolder}>
                <PiFolderSimplePlus />
              </IconButton>
              <IconButton label="Import files" onClick={openPicker}>
                <PiUploadSimple />
              </IconButton>
            </div>
            <div role="radiogroup" aria-label="Filter by type" className="flex flex-wrap gap-1">
              {FILTERS.map(({ value, label }) => (
                <TagChip key={value} active={filter === value} onClick={() => useLibrary.getState().setFilter(value)}>
                  {label}
                </TagChip>
              ))}
            </div>
          </div>

          {searching ? (
            <p className="shrink-0 px-3 pb-1 text-[11px] text-muted-foreground">Results from every folder</p>
          ) : (
            <Breadcrumbs view={view} folders={folders} />
          )}

          <ContextMenu>
            <ContextMenuTrigger asChild>
              {/* Radix wraps content in a `display: table` div, which defeats `truncate`. */}
              <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
                <div className="flex flex-col px-2 pb-2">
                  {!searching && view.kind === "folder" && view.folderId === null && <SmartRows />}
                  {contents.folders.map((folder) => (
                    <FolderRow
                      key={folder.id}
                      folder={folder}
                      count={counts.get(folder.id) ?? 0}
                      location={searching ? folderPath(folders, folder.parentId).map((f) => f.name).join(" / ") : undefined}
                      onNewFolder={() => open({ kind: "new-folder", parentId: folder.id })}
                      onRename={() => open({ kind: "rename-folder", folder })}
                      onDelete={() => {
                        const count = counts.get(folder.id) ?? 0;
                        const empty = count === 0 && !folders.some((f) => f.parentId === folder.id);
                        if (empty) void useLibrary.getState().deleteFolder(folder.id);
                        else open({ kind: "delete-folder", folder, count });
                      }}
                    />
                  ))}
                </div>
                {(uploads.length > 0 || contents.items.length > 0) && (
                  <div className="grid grid-cols-2 gap-x-1 gap-y-1.5 px-2 pb-2">
                    {uploads.map((u) => (
                      <UploadCard key={u.id} upload={u} />
                    ))}
                    {contents.items.map((item) => (
                      <LibraryCard
                        key={item.id}
                        item={item}
                        media={media}
                        location={searching || view.kind !== "folder" ? location(item) : undefined}
                        onRename={() => open({ kind: "rename-item", item })}
                        onDelete={() => open({ kind: "delete-item", item })}
                      />
                    ))}
                  </div>
                )}
                {contents.items.length === 0 && contents.folders.length === 0 && uploads.length === 0 && library.loaded && (
                  <p className="px-6 py-8 text-center text-xs leading-relaxed text-muted-foreground">
                    {searching
                      ? `Nothing matches “${query.trim()}”.`
                      : filter !== "all"
                        ? `No ${filter === "clips" ? "saved clips" : filter === "image" ? "images" : `${filter} files`} here.`
                        : view.kind === "favorites"
                          ? "Star items to find them here."
                          : view.kind === "recent"
                            ? "Items you add to a video show up here."
                            : "This folder is empty. Drop files or folders here, or drag items into it."}
                  </p>
                )}
              </ScrollArea>
            </ContextMenuTrigger>
            {/* Right-clicking empty space (cards and folders have their own menus). */}
            <ContextMenuContent className="w-48">
              <ContextMenuItem onSelect={newFolder}>
                <PiFolderSimplePlus />
                New folder
              </ContextMenuItem>
              <ContextMenuItem onSelect={openPicker}>
                <PiUploadSimple />
                Import files
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </>
      )}

      <NameDialog
        open={dialogOpen && (dialog?.kind === "new-folder" || dialog?.kind === "rename-folder" || dialog?.kind === "rename-item")}
        onOpenChange={setDialogOpen}
        title={dialog?.kind === "new-folder" ? "New folder" : "Rename"}
        confirmLabel={dialog?.kind === "new-folder" ? "Create" : "Rename"}
        initial={
          dialog?.kind === "rename-folder" ? dialog.folder.name : dialog?.kind === "rename-item" ? dialog.item.name : ""
        }
        onConfirm={(name) => {
          const lib = useLibrary.getState();
          if (dialog?.kind === "new-folder") void lib.createFolder(name, dialog.parentId);
          else if (dialog?.kind === "rename-folder") void lib.renameFolder(dialog.folder.id, name);
          else if (dialog?.kind === "rename-item") void lib.updateItem(dialog.item.id, { name });
        }}
      />
      <ConfirmDeleteDialog
        open={dialogOpen && (dialog?.kind === "delete-folder" || dialog?.kind === "delete-item")}
        onOpenChange={setDialogOpen}
        title={
          dialog?.kind === "delete-folder"
            ? `Delete “${dialog.folder.name}”?`
            : dialog?.kind === "delete-item"
              ? `Delete “${dialog.item.name}”?`
              : ""
        }
        description={
          dialog?.kind === "delete-folder"
            ? `Its subfolders and ${dialog.count} item${dialog.count === 1 ? "" : "s"} will be deleted from the Library. Videos that use them keep their own copies.`
            : "It will be deleted from the Library. Videos that use it keep their own copy."
        }
        onConfirm={() => {
          const lib = useLibrary.getState();
          if (dialog?.kind === "delete-folder") void lib.deleteFolder(dialog.folder.id);
          else if (dialog?.kind === "delete-item") void lib.deleteItem(dialog.item.id);
        }}
      />
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-foreground" onClick={onClick}>
          {children}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Where the tab is: Library / Folder / Subfolder. Each level is a drop target to move things up. */
function Breadcrumbs({ view, folders }: { view: LibraryView; folders: LibraryFolder[] }) {
  const path = view.kind === "folder" ? folderPath(folders, view.folderId) : [];
  if (view.kind === "folder" && path.length === 0) return null;
  const leaf = view.kind === "favorites" ? "Favourites" : view.kind === "recent" ? "Recent" : null;
  return (
    <nav aria-label="Library folders" className="flex min-w-0 shrink-0 items-center gap-0.5 px-2 pb-1.5 text-xs">
      <Crumb folderId={null} current={false}>
        Library
      </Crumb>
      {path.map((folder, i) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
          <PiCaretRight className="size-3 shrink-0 text-muted-foreground/60" />
          <Crumb folderId={folder.id} current={i === path.length - 1 && !leaf}>
            {folder.name}
          </Crumb>
        </span>
      ))}
      {leaf && (
        <span className="flex min-w-0 items-center gap-0.5">
          <PiCaretRight className="size-3 shrink-0 text-muted-foreground/60" />
          <span className="truncate px-1 font-medium text-foreground">{leaf}</span>
        </span>
      )}
    </nav>
  );
}

function Crumb({ folderId, current, children }: { folderId: string | null; current: boolean; children: string }) {
  const drop = useLibraryDrop(folderId);
  return (
    <button
      type="button"
      {...drop.handlers}
      aria-current={current ? "page" : undefined}
      disabled={current}
      onClick={() => useLibrary.getState().setView({ kind: "folder", folderId })}
      className={cn(
        "min-w-0 truncate rounded px-1 py-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        current ? "font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
        drop.active && "bg-brand/15 text-foreground ring-1 ring-brand",
      )}
    >
      {children}
    </button>
  );
}

const rowClass =
  "group/row flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50";

/** Favourites and Recent, at the top level when they have anything. */
function SmartRows() {
  const favorites = useLibrary((s) => s.items.filter((i) => i.favorite).length);
  const recent = useLibrary((s) => recentItems(s.items).length);
  const setView = useLibrary.getState().setView;
  return (
    <>
      {favorites > 0 && (
        <button type="button" className={rowClass} onClick={() => setView({ kind: "favorites" })}>
          <PiStarFill className="size-4 shrink-0 text-amber-400" />
          <span className="flex-1 truncate">Favourites</span>
          <span className="text-xs text-muted-foreground tabular-nums">{favorites}</span>
        </button>
      )}
      {recent > 0 && (
        <button type="button" className={rowClass} onClick={() => setView({ kind: "recent" })}>
          <PiClockCounterClockwise className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">Recent</span>
          <span className="text-xs text-muted-foreground tabular-nums">{recent}</span>
        </button>
      )}
    </>
  );
}

interface FolderRowProps {
  folder: LibraryFolder;
  count: number;
  /** Where it is, shown while searching. */
  location?: string;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/** A folder: click to open, drop things on it to put them inside, drag it into another folder. */
function FolderRow({ folder, count, location, onNewFolder, onRename, onDelete }: FolderRowProps) {
  const drop = useLibraryDrop(folder.id);
  const openFolder = () => useLibrary.getState().setView({ kind: "folder", folderId: folder.id });
  const menu = (kit: MenuKit) => (
    <FolderRowMenuItems
      kit={kit}
      folder={folder}
      onOpen={openFolder}
      onNewFolder={onNewFolder}
      onRename={onRename}
      onDelete={onDelete}
    />
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          draggable
          {...drop.handlers}
          onDragStart={(e: DragEvent) => setLibraryDragData(e.dataTransfer, folder.id)}
          onClick={openFolder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target === e.currentTarget) openFolder();
          }}
          className={cn(
            rowClass,
            "cursor-pointer data-[state=open]:bg-accent/60",
            drop.active && "bg-brand/15 ring-1 ring-brand",
          )}
        >
          <PiFolderSimple className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {folder.name}
            {location && <span className="ml-1.5 text-[11px] text-muted-foreground">in {location || "Library"}</span>}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums group-hover/row:hidden group-has-data-[state=open]/row:hidden">
            {count > 0 ? count : ""}
          </span>
          <div
            className="hidden group-hover/row:block group-has-data-[state=open]/row:block"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <PiDotsThree className="size-4" />
                  <span className="sr-only">Folder actions</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {menu(dropdownKit)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <PiCaretRight className="size-3 shrink-0 text-muted-foreground/60" />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">{menu(contextKit)}</ContextMenuContent>
    </ContextMenu>
  );
}

/** A folder's actions, for its "⋯" menu and its right-click menu. */
function FolderRowMenuItems({
  kit,
  folder,
  onOpen,
  onNewFolder,
  onRename,
  onDelete,
}: {
  kit: MenuKit;
  folder: LibraryFolder;
  onOpen: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = kit;
  return (
    <>
      <Item onSelect={onOpen}>
        <PiFolderOpen />
        Open
      </Item>
      <Item onSelect={onNewFolder}>
        <PiFolderSimplePlus />
        New folder inside…
      </Item>
      <Separator />
      <Item onSelect={onRename}>
        <PiPencilSimple />
        Rename…
      </Item>
      <Sub>
        <SubTrigger>
          <PiFolderSimple />
          Move to
        </SubTrigger>
        <SubContent className="max-h-72 w-52 overflow-y-auto">
          <FolderMenuItems
            kit={kit}
            current={folder.parentId}
            moving={folder.id}
            onSelect={(parentId) => void useLibrary.getState().moveFolder(folder.id, parentId)}
          />
        </SubContent>
      </Sub>
      <Separator />
      <Item variant="destructive" onSelect={onDelete}>
        <PiTrash />
        Delete
      </Item>
    </>
  );
}

function EmptyLibrary({ onImport, onNewFolder }: { onImport: () => void; onNewFolder: () => void }) {
  return (
    <div className="flex flex-1 p-3">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border px-6 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-muted text-foreground/80">
          <PiBooks className="size-5" />
        </span>
        <span className="space-y-1.5">
          <span className="block text-sm font-medium text-foreground">Your Library, in every video</span>
          <span className="block text-xs leading-relaxed text-muted-foreground">
            Keep sound effects, logos, intros and music here. Drop files or whole folders, or right-click clips on
            the timeline to save them with their settings.
          </span>
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onImport}>
            <PiUploadSimple />
            Import files
          </Button>
          <Button variant="ghost" size="sm" onClick={onNewFolder}>
            <PiFolderSimplePlus />
            New folder
          </Button>
        </div>
      </div>
    </div>
  );
}
