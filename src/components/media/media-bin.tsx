import { useMemo, useRef, useState, type ReactNode } from "react";
import { PiFileArrowUp, PiTrayArrowDown } from "react-icons/pi";
import type { MediaAsset } from "@shared/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFileDrop } from "@/hooks/use-file-drop";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { AssetCard } from "./asset-card";
import { DeleteAssetDialog } from "./delete-asset-dialog";
import { ACCEPTED_FILE_TYPES, importMedia } from "./import-media";
import { clipCountByAsset, filterAssets, type MediaFilter } from "./media-utils";
import { MusicPanel } from "./music-panel";
import { UploadCard } from "./upload-card";

type Tab = "media" | "music";

export function MediaBin() {
  const assets = useEditor((s) => s.assets);
  const uploads = useEditor((s) => s.uploads);
  const clips = useEditor((s) => s.project.clips);
  const [tab, setTab] = useState<Tab>("media");
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [pendingDelete, setPendingDelete] = useState<{ asset: MediaAsset; uses: number } | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const drop = useFileDrop((files) => {
    setTab("media");
    importMedia(files);
  });

  const uses = useMemo(() => clipCountByAsset(clips), [clips]);
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
    <aside
      className="relative flex w-72 shrink-0 flex-col border-r bg-card"
      aria-label="Media"
      {...drop.handlers}
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b pr-2 pl-1.5">
        <div role="tablist" aria-label="Media sources" className="flex items-center gap-0.5">
          <TabButton active={tab === "media"} onClick={() => setTab("media")}>
            Media
            {assets.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground tabular-nums">{assets.length}</span>
            )}
          </TabButton>
          <TabButton active={tab === "music"} onClick={() => setTab("music")}>
            Music
          </TabButton>
        </div>
        {tab === "media" && (
          <Button variant="secondary" size="xs" className="ml-auto h-7 px-2.5" onClick={openPicker}>
            <PiTrayArrowDown />
            Import
          </Button>
        )}
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
      </div>

      <MusicPanel active={tab === "music"} />
      {tab === "music" ? null : isEmpty ? (
        <EmptyState onClick={openPicker} />
      ) : (
        <>
          {assets.length > 0 && (
            <div className="shrink-0 px-3 pt-3">
              <ToggleGroup
                type="single"
                size="sm"
                value={filter}
                onValueChange={(v) => v && setFilter(v as MediaFilter)}
                className="grid w-full grid-cols-3 rounded-md bg-muted p-0.5"
              >
                {(["all", "video", "audio"] as const).map((f) => (
                  <ToggleGroupItem
                    key={f}
                    value={f}
                    className="h-6 min-w-0 rounded-[5px]! text-xs text-muted-foreground capitalize hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs! dark:data-[state=on]:bg-accent"
                  >
                    {f}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
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
                No {filter} files yet.
              </p>
            )}
          </ScrollArea>
        </>
      )}

      {drop.active && (
        <div className="pointer-events-none absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand bg-brand/10 text-brand backdrop-blur-[2px]">
          <PiFileArrowUp className="size-6" />
          <span className="text-sm font-medium">Drop to import</span>
        </div>
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
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-semibold transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
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
          <span className="block text-sm font-medium text-foreground">Drop videos or music here</span>
          <span className="block text-xs">or click Import</span>
        </span>
        <span className="text-[11px] leading-relaxed text-muted-foreground/80">
          MP4, MOV, WebM, MKV
          <br />
          MP3, WAV, M4A, FLAC, OGG
        </span>
      </button>
    </div>
  );
}
