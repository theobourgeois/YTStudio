import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  PiDotsThree,
  PiEye,
  PiFilmStrip,
  PiFolderSimple,
  PiImage,
  PiPencilSimple,
  PiPlus,
  PiSpeakerHigh,
  PiStack,
  PiStar,
  PiStarFill,
  PiTrash,
} from "react-icons/pi";
import type { LibraryItem, MediaAsset } from "@shared/types";
import { isTextClip, textStyleAt } from "@shared/effects";
import { formatDuration } from "@shared/format";
import { libraryItemCover, libraryItemDuration } from "@shared/library";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AudioTile, MarkedRangeBar } from "@/components/media/asset-card";
import { HoverScrub, useHoverX } from "@/components/media/hover-scrub";
import { type MenuKit, contextKit, dropdownKit } from "@/components/menu-kit";
import { setLibraryDragData } from "@/lib/dnd";
import { cn } from "cn";
import { useLibrary } from "@/stores/library";
import { useSourcePreview } from "@/stores/source-preview";
import { FolderMenuItems } from "./folder-menu-items";

interface LibraryCardProps {
  item: LibraryItem;
  media: ReadonlyMap<string, MediaAsset>;
  /** The folder it's in, shown while searching every folder. */
  location?: string;
  onRename: () => void;
  onDelete: () => void;
}

/** Wait this long before a hovered sound starts, so sweeping across the grid stays quiet. */
const AUDIO_HOVER_DELAY_MS = 150;

const overlayButton =
  "grid size-6 place-items-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none";

/**
 * A Library item: hover a video to scrub through it and a sound to hear it,
 * click a file to preview it, drag it onto the timeline or a folder, or
 * double-click to add it.
 */
export function LibraryCard({ item, media, location, onRename, onDelete }: LibraryCardProps) {
  const thumbRef = useRef<HTMLDivElement>(null);
  const cover = libraryItemCover(item, media);
  const duration = libraryItemDuration(item, media);
  const previewing = useSourcePreview((s) => s.libraryItemId === item.id);
  const { hoverX, clear: clearHover, handlers: hoverHandlers } = useHoverX();
  const audio = useHoverAudio(item.kind === "media" && cover && !cover.hasVideo ? cover.src : null, hoverX !== null);

  const add = () => void useLibrary.getState().addToTimeline(item.id);
  const preview = item.kind === "media" && cover ? () => useSourcePreview.getState().open(cover.id, item.id) : undefined;
  const toggleFavorite = () => void useLibrary.getState().updateItem(item.id, { favorite: !item.favorite });
  const menu = (kit: MenuKit) => (
    <LibraryItemMenuItems
      kit={kit}
      item={item}
      onAdd={add}
      onPreview={preview}
      onToggleFavorite={toggleFavorite}
      onRename={onRename}
      onDelete={onDelete}
    />
  );
  const onDragStart = (e: DragEvent) => {
    clearHover();
    setLibraryDragData(e.dataTransfer, item.id);
    const thumb = thumbRef.current;
    if (thumb) {
      const rect = thumb.getBoundingClientRect();
      e.dataTransfer.setDragImage(thumb, Math.min(e.clientX - rect.left, rect.width), Math.min(e.clientY - rect.top, rect.height));
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group relative flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing data-[state=open]:bg-accent/60"
          draggable
          tabIndex={0}
          title={item.name}
          data-library-item={item.id}
          onDragStart={onDragStart}
          onClick={preview}
          onDoubleClick={add}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target === e.currentTarget) add();
          }}
        >
          <div
            ref={thumbRef}
            className={cn(
              "relative aspect-video overflow-hidden rounded-md bg-muted ring-1 ring-border ring-inset",
              previewing && "ring-2 ring-brand",
            )}
            {...hoverHandlers}
          >
            <Thumbnail item={item} cover={cover} hoverX={hoverX} />

            {audio.playing && (
              <>
                <span className="absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-clip-audio text-white">
                  <PiSpeakerHigh className="size-3" />
                </span>
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-black/30">
                  <span className="block h-full bg-clip-audio" style={{ width: `${audio.progress * 100}%` }} />
                </span>
              </>
            )}
            {item.kind === "media" && cover && !audio.playing && <MarkedRangeBar asset={cover} />}
            {item.favorite && !audio.playing && (
              <PiStarFill className="absolute top-1.5 left-1.5 size-3.5 text-amber-400 drop-shadow-[0_1px_1px_rgb(0_0_0/0.6)]" />
            )}
            {item.kind === "clips" && (
              <span
                className="absolute bottom-1 left-1 flex h-5 items-center gap-0.5 rounded bg-black/65 px-1 text-[10px] font-medium text-white"
                title="Saved clips, with their settings"
              >
                <PiStack className="size-3" />
                {item.template.clips.length > 1 && item.template.clips.length}
              </span>
            )}
            {cover?.kind === "image" && item.kind === "media" ? (
              <span className="absolute right-1 bottom-1 grid size-5 place-items-center rounded bg-black/65 text-white" title="Image">
                <PiImage className="size-3" />
              </span>
            ) : (
              duration > 0 && (
                <span className="absolute right-1 bottom-1 rounded bg-black/65 px-1 py-px text-[10px] leading-4 font-medium text-white tabular-nums">
                  {formatDuration(duration)}
                </span>
              )
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
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className={overlayButton} onClick={toggleFavorite}>
                  {item.favorite ? <PiStarFill className="size-3.5 text-amber-400" /> : <PiStar className="size-3.5" />}
                  <span className="sr-only">{item.favorite ? "Remove from favourites" : "Add to favourites"}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{item.favorite ? "Unfavourite" : "Favourite"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className={overlayButton} onClick={add}>
                  <PiPlus className="size-3.5" />
                  <span className="sr-only">Add to timeline</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Add to timeline</TooltipContent>
            </Tooltip>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={overlayButton}>
                  <PiDotsThree className="size-3.5" />
                  <span className="sr-only">More actions</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {menu(dropdownKit)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="min-w-0 px-0.5">
            <p className="truncate text-xs leading-4 text-foreground/90">{item.name}</p>
            {location && <p className="truncate text-[10px] leading-3.5 text-muted-foreground">{location}</p>}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">{menu(contextKit)}</ContextMenuContent>
    </ContextMenu>
  );
}

/** A Library item's actions, for its "⋯" menu and its right-click menu. */
function LibraryItemMenuItems({
  kit,
  item,
  onAdd,
  onPreview,
  onToggleFavorite,
  onRename,
  onDelete,
}: {
  kit: MenuKit;
  item: LibraryItem;
  onAdd: () => void;
  /** Files only: saved clips have no single file to show. */
  onPreview?: () => void;
  onToggleFavorite: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = kit;
  return (
    <>
      {onPreview && (
        <Item onSelect={onPreview}>
          <PiEye />
          Preview
        </Item>
      )}
      <Item onSelect={onAdd}>
        <PiPlus />
        Add to timeline
      </Item>
      <Item onSelect={onToggleFavorite}>
        {item.favorite ? <PiStarFill /> : <PiStar />}
        {item.favorite ? "Unfavourite" : "Favourite"}
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
            current={item.folderId}
            onSelect={(folderId) => void useLibrary.getState().updateItem(item.id, { folderId })}
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

function Thumbnail({ item, cover, hoverX }: { item: LibraryItem; cover: MediaAsset | undefined; hoverX: number | null }) {
  const [broken, setBroken] = useState(false);
  if (cover?.hasVideo && cover.poster && !broken) {
    return (
      <>
        <img
          src={cover.poster}
          alt=""
          draggable={false}
          loading="lazy"
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
        <HoverScrub asset={cover} hoverX={hoverX} />
      </>
    );
  }
  if (cover?.hasVideo) {
    return (
      <div className="grid size-full place-items-center text-muted-foreground">
        <PiFilmStrip className="size-5" />
      </div>
    );
  }
  if (cover) return <AudioTile seed={cover.id} />;
  return <TextTile item={item} />;
}

/** Saved text with no picture under it: the text in its own font and colour. */
function TextTile({ item }: { item: LibraryItem }) {
  const text = item.kind === "clips" ? item.template.clips.find(isTextClip) : undefined;
  const style = text ? textStyleAt(text, text.in) : null;
  return (
    <div className="grid size-full place-items-center bg-neutral-900 px-2">
      <span
        className="line-clamp-2 text-center text-sm leading-tight font-semibold break-words"
        style={{ fontFamily: style ? `"${style.font}", sans-serif` : undefined, color: style?.fill ?? "#fff" }}
      >
        {style?.text.trim() || "Text"}
      </span>
    </div>
  );
}

/**
 * Plays `src` from the start while `hovered` (after a short delay), with its
 * progress 0..1. Null `src` plays nothing.
 */
function useHoverAudio(src: string | null, hovered: boolean) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!src || !hovered) return;
    const el = new Audio(src);
    let raf = 0;
    const tick = () => {
      setProgress(el.duration ? el.currentTime / el.duration : 0);
      raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => {
      el.play().then(
        () => {
          setPlaying(true);
          raf = requestAnimationFrame(tick);
        },
        () => {},
      );
    }, AUDIO_HOVER_DELAY_MS);
    el.onended = () => setPlaying(false);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      el.pause();
      el.removeAttribute("src");
      el.load();
      setPlaying(false);
      setProgress(0);
    };
  }, [src, hovered]);

  return { playing, progress };
}
