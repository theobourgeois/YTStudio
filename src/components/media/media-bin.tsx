import { useMemo, useRef, useState } from "react";
import { PiFileArrowUp, PiUploadSimple } from "react-icons/pi";
import { useShallow } from "zustand/react/shallow";
import { subclipsByAsset } from "@shared/subclips";
import type { MediaAsset, Subclip } from "@shared/types";
import { NameDialog } from "@/components/library/library-dialogs";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TagChip } from "@/components/ui/tag-chip";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { useLibrary } from "@/stores/library";
import { useSourcePreview } from "@/stores/source-preview";
import { AssetCard } from "./asset-card";
import { DeleteAssetDialog } from "./delete-asset-dialog";
import { ACCEPTED_FILE_TYPES, importMedia } from "./import-media";
import { clipCountByAsset, filterAssets, type MediaFilter } from "./media-utils";
import { UploadCard } from "./upload-card";
import { useGridSelection } from "./use-grid-selection";

const FILTERS: { value: MediaFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "image", label: "Image" },
];

/**
 * The Media tab: the project's imported media, to preview, add to the timeline
 * or delete, one file or a selection (⌘/⇧-click, or drag a box). Each file's
 * subclips (parts of it made in the source preview) follow it, as cards of their own.
 */
export function MediaBin() {
  const assets = useEditor((s) => s.assets);
  const uploads = useEditor((s) => s.uploads);
  // Compared entry by entry, so moving clips around doesn't re-render the grid.
  const uses = useEditor(useShallow((s) => clipCountByAsset(s.project.clips)));
  const subclips = useEditor((s) => subclipsByAsset(s.project));
  const [renaming, setRenaming] = useState<Subclip | null>(null);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [pendingDelete, setPendingDelete] = useState<{ assets: MediaAsset[]; uses: number } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => filterAssets(assets, filter), [assets, filter]);
  const entries = useMemo(
    () =>
      visible.flatMap((asset): { asset: MediaAsset; subclip?: Subclip }[] => [
        { asset },
        ...(subclips.get(asset.id) ?? []).map((subclip) => ({ asset, subclip })),
      ]),
    [visible, subclips],
  );
  const order = useMemo(() => entries.map((e) => e.subclip?.id ?? e.asset.id), [entries]);
  const isEmpty = assets.length === 0 && uploads.length === 0;
  const openPicker = () => inputRef.current?.click();

  /**
   * Deleting files can't be undone: ask, except for one unused file picked from its menu.
   * Subclips go at once (that's an edit: undo brings them back).
   */
  const requestDelete = (ids: string[], ask = false) => {
    const subclipIds = ids.filter((id) => useEditor.getState().getSubclip(id));
    if (subclipIds.length) useEditor.getState().deleteSubclips(subclipIds);
    const doomed = new Set(ids);
    const chosen = assets.filter((a) => doomed.has(a.id));
    const count = chosen.reduce((n, a) => n + (uses.get(a.id) ?? 0), 0);
    if (count === 0 && chosen.length === 1 && !ask) {
      void useEditor.getState().deleteAsset(chosen[0].id);
      return;
    }
    if (chosen.length === 0) return;
    setPendingDelete({ assets: chosen, uses: count });
    setConfirmOpen(true);
  };
  const grid = useGridSelection(order, { onDelete: (ids) => requestDelete(ids, true) });

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Reset so picking the same file again still fires `change`.
          e.target.value = "";
          if (files.length > 0) importMedia(files);
        }}
      />
      {isEmpty ? (
        <EmptyState onClick={openPicker} />
      ) : (
        <>
          {assets.length > 0 && (
            <div className="shrink-0 px-3 pt-3">
              <div role="radiogroup" aria-label="Filter by type" className="flex flex-wrap gap-1">
                {FILTERS.map(({ value, label }) => (
                  <TagChip key={value} active={filter === value} onClick={() => setFilter(value)}>
                    {label}
                  </TagChip>
                ))}
              </div>
            </div>
          )}
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" {...grid.containerProps}>
                {/* Radix wraps content in a `display: table` div, which defeats `truncate`. */}
                <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
                  <div ref={grid.contentRef} tabIndex={-1} className="outline-none select-none">
                    <div className="grid grid-cols-2 gap-x-1 gap-y-1.5 p-2">
                      {uploads.map((u) => (
                        <UploadCard key={u.id} upload={u} />
                      ))}
                      {entries.map(({ asset, subclip }) => {
                        const id = subclip?.id ?? asset.id;
                        return (
                          <AssetCard
                            key={id}
                            asset={asset}
                            subclip={subclip}
                            uses={subclip ? 0 : (uses.get(asset.id) ?? 0)}
                            selected={grid.isSelected(id)}
                            count={grid.targets(id).length}
                            onClick={(e) => {
                              if (!grid.click(e, id) || !(asset.duration > 0)) return;
                              if (subclip) useSourcePreview.getState().openSubclip(subclip.id, asset.id);
                              else useSourcePreview.getState().open(asset.id);
                            }}
                            onGrab={() => grid.grab(id)}
                            onAdd={() => useEditor.getState().addAssetsToTimeline(grid.targets(id))}
                            onAddToLibrary={(folderId) => void useLibrary.getState().addAssets(grid.targets(id), folderId)}
                            onDelete={() => requestDelete(grid.targets(id))}
                            onRename={subclip && (() => setRenaming(subclip))}
                          />
                        );
                      })}
                    </div>
                    {visible.length === 0 && assets.length > 0 && (
                      <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                        No {filter === "image" ? "images" : `${filter} files`} yet.
                      </p>
                    )}
                  </div>
                </ScrollArea>
                {grid.marquee}
              </div>
            </ContextMenuTrigger>
            {/* Right-clicking empty space (cards have their own menus). */}
            <ContextMenuContent className="w-48">
              <ContextMenuItem onSelect={openPicker}>
                <PiUploadSimple />
                Import files
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </>
      )}

      <NameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename subclip"
        initial={renaming?.name ?? ""}
        confirmLabel="Rename"
        onConfirm={(name) => renaming && useEditor.getState().renameSubclip(renaming.id, name)}
      />

      <DeleteAssetDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        name={pendingDelete?.assets[0]?.name ?? ""}
        count={pendingDelete?.assets.length ?? 0}
        uses={pendingDelete?.uses ?? 0}
        onConfirm={() => {
          if (!pendingDelete) return;
          void (async () => {
            for (const asset of pendingDelete.assets) await useEditor.getState().deleteAsset(asset.id);
          })();
        }}
      />
    </>
  );
}

function EmptyState({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex flex-1 p-3">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 text-center",
          "text-muted-foreground transition-colors outline-none hover:border-foreground/25 hover:bg-accent/40",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        <span className="grid size-11 place-items-center rounded-full bg-muted text-foreground/80">
          <PiFileArrowUp className="size-5" />
        </span>
        <span className="space-y-1">
          <span className="block text-sm font-medium text-foreground">Drop videos, music or images here</span>
          <span className="block text-xs">or click to browse</span>
        </span>
        <span className="text-[11px] leading-relaxed text-muted-foreground/80">
          MP4, MOV, WebM, MKV
          <br />
          MP3, WAV, M4A, FLAC, OGG
          <br />
          PNG, JPG, WebP, GIF, BMP
        </span>
      </button>
    </div>
  );
}
