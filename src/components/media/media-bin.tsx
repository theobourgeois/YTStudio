import { useMemo, useRef, useState } from "react";
import { PiFileArrowUp } from "react-icons/pi";
import { useShallow } from "zustand/react/shallow";
import type { MediaAsset } from "@shared/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TagChip } from "@/components/ui/tag-chip";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { AssetCard } from "./asset-card";
import { DeleteAssetDialog } from "./delete-asset-dialog";
import { ACCEPTED_FILE_TYPES, importMedia } from "./import-media";
import { clipCountByAsset, filterAssets, type MediaFilter } from "./media-utils";
import { UploadCard } from "./upload-card";

const FILTERS: { value: MediaFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "image", label: "Image" },
];

/** The Media tab: the project's imported media, to preview, add to the timeline or delete. */
export function MediaBin() {
  const assets = useEditor((s) => s.assets);
  const uploads = useEditor((s) => s.uploads);
  // Compared entry by entry, so moving clips around doesn't re-render the grid.
  const uses = useEditor(useShallow((s) => clipCountByAsset(s.project.clips)));
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [pendingDelete, setPendingDelete] = useState<{ asset: MediaAsset; uses: number } | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => filterAssets(assets, filter), [assets, filter]);
  const isEmpty = assets.length === 0 && uploads.length === 0;
  const openPicker = () => inputRef.current?.click();

  const addToTimeline = (id: string) => useEditor.getState().addAssetsToTimeline([id]);
  const requestDelete = (asset: MediaAsset) => {
    const count = uses.get(asset.id) ?? 0;
    if (count === 0) {
      void useEditor.getState().deleteAsset(asset.id);
      return;
    }
    setPendingDelete({ asset, uses: count });
    setConfirmOpen(true);
  };

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
          {/* Radix wraps content in a `display: table` div, which defeats `truncate`. */}
          <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
            <div className="grid grid-cols-2 gap-x-1 gap-y-1.5 p-2">
              {uploads.map((u) => (
                <UploadCard key={u.id} upload={u} />
              ))}
              {visible.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  uses={uses.get(asset.id) ?? 0}
                  onAdd={() => addToTimeline(asset.id)}
                  onDelete={() => requestDelete(asset)}
                />
              ))}
            </div>
            {visible.length === 0 && assets.length > 0 && (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                No {filter === "image" ? "images" : `${filter} files`} yet.
              </p>
            )}
          </ScrollArea>
        </>
      )}

      <DeleteAssetDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        name={pendingDelete?.asset.name ?? ""}
        uses={pendingDelete?.uses ?? 0}
        onConfirm={() => {
          if (pendingDelete) void useEditor.getState().deleteAsset(pendingDelete.asset.id);
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
