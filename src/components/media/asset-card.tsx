import { useMemo, useRef, useState, type DragEvent } from "react";
import { PiDotsThree, PiFilmStrip, PiImage, PiMusicNote, PiPlus, PiSpinnerGap, PiTrash, PiWarning } from "react-icons/pi";
import type { MediaAsset } from "@shared/types";
import { formatDuration } from "@shared/format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setAssetDragData } from "@/lib/dnd";
import { cn } from "@/lib/utils";
import { useSourcePreview } from "@/stores/source-preview";
import { decorativePeaks } from "./media-utils";

interface AssetCardProps {
  asset: MediaAsset;
  /** Number of timeline clips using this asset. */
  uses: number;
  onAdd: () => void;
  onDelete: () => void;
}

const overlayButton =
  "grid size-6 place-items-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none";

export function AssetCard({ asset, uses, onAdd, onDelete }: AssetCardProps) {
  const thumbRef = useRef<HTMLDivElement>(null);
  // "error" only means thumbnails/waveform couldn't be generated; the media itself is fine.
  const previewsFailed = asset.status === "error";
  const usable = asset.duration > 0;
  const previewing = useSourcePreview((s) => s.assetId === asset.id);

  const onDragStart = (e: DragEvent) => {
    setAssetDragData(e.dataTransfer, { assetIds: [asset.id] });
    const thumb = thumbRef.current;
    if (thumb) {
      const rect = thumb.getBoundingClientRect();
      const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
      const y = Math.min(Math.max(0, e.clientY - rect.top), rect.height);
      e.dataTransfer.setDragImage(thumb, x, y);
    }
  };

  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col gap-1.5 rounded-lg p-1 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/60",
        usable && "cursor-pointer active:cursor-grabbing",
      )}
      draggable={usable}
      tabIndex={0}
      title={previewsFailed ? `${asset.name}\n${asset.error ?? "Couldn't generate previews"}` : asset.name}
      onDragStart={onDragStart}
      onClick={() => usable && useSourcePreview.getState().open(asset.id)}
      onDoubleClick={() => usable && onAdd()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget && usable) onAdd();
      }}
    >
      <div
        ref={thumbRef}
        className={cn(
          "relative aspect-video overflow-hidden rounded-md bg-muted ring-1 ring-border ring-inset",
          previewing && "ring-2 ring-brand",
        )}
      >
        <Thumbnail asset={asset} />

        {asset.kind === "image" ? (
          <span className="absolute right-1 bottom-1 grid size-5 place-items-center rounded bg-black/65 text-white" title="Image">
            <PiImage className="size-3" />
          </span>
        ) : (
          <span className="absolute right-1 bottom-1 rounded bg-black/65 px-1 py-px text-[10px] leading-4 font-medium text-white tabular-nums">
            {formatDuration(asset.duration)}
          </span>
        )}
        {previewsFailed && (
          <span
            className="absolute bottom-1 left-1 grid size-5 place-items-center rounded bg-black/65 text-amber-400"
            title={asset.error ?? "Couldn't generate previews"}
          >
            <PiWarning className="size-3" />
          </span>
        )}

        {asset.status === "processing" && (
          <span
            className="absolute bottom-1 left-1 grid size-5 place-items-center rounded bg-black/65 text-white"
            title="Generating previews…"
          >
            <PiSpinnerGap className="size-3 animate-spin" />
          </span>
        )}

        {uses > 0 && (
          <span
            className="absolute top-1.5 left-1.5 size-2 rounded-full bg-brand ring-2 ring-black/40"
            title={`Used in ${uses} clip${uses === 1 ? "" : "s"}`}
          >
            <span className="sr-only">On the timeline</span>
          </span>
        )}
      </div>

      {/* Siblings of the thumbnail so they don't show up in the drag image. */}
      <div
        className={cn(
          "absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity",
          "group-focus-within:opacity-100 group-hover:opacity-100 has-data-[state=open]:opacity-100",
        )}
        // Menu items are portalled but still bubble here through React; keep them from opening the preview.
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {usable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className={overlayButton} onClick={onAdd}>
                <PiPlus className="size-3.5" />
                <span className="sr-only">Add to timeline</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Add to timeline</TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className={overlayButton}>
              <PiDotsThree className="size-3.5" />
              <span className="sr-only">More actions</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={!usable} onSelect={onAdd}>
              <PiPlus />
              Add to timeline
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <PiTrash />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="truncate px-0.5 text-xs leading-4 text-foreground/90">
        {asset.name}
      </p>
    </div>
  );
}

function Thumbnail({ asset }: { asset: MediaAsset }) {
  const [broken, setBroken] = useState(false);
  if (asset.hasVideo && asset.poster && !broken) {
    return (
      <img
        src={asset.poster}
        alt=""
        draggable={false}
        loading="lazy"
        className="size-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  }
  if (asset.hasVideo) {
    return (
      <div className="grid size-full place-items-center text-muted-foreground">
        <PiFilmStrip className="size-5" />
      </div>
    );
  }
  return <AudioTile seed={asset.id} />;
}

function AudioTile({ seed }: { seed: string }) {
  const peaks = useMemo(() => decorativePeaks(seed, 28), [seed]);
  return (
    <div className="relative size-full bg-linear-to-br from-clip-audio/25 to-clip-audio/5">
      <div className="absolute inset-x-2.5 top-1/2 flex h-1/2 -translate-y-1/2 items-center gap-[2px] opacity-60">
        {peaks.map((p, i) => (
          <span
            key={i}
            className="flex-1 rounded-full bg-clip-audio"
            style={{ height: `${p * 100}%` }}
          />
        ))}
      </div>
      <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-clip-audio text-white shadow-sm group-hover:opacity-0">
        <PiMusicNote className="size-3" />
      </span>
    </div>
  );
}
