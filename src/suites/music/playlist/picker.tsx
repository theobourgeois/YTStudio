import { useState } from "react";
import { PiListDashes, PiWaveform } from "react-icons/pi";
import { cn } from "cn";
import { clonePattern, removeChannels, renamePattern } from "@shared/music/edits";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useMusic, useSong } from "../store";
import { chooseSource, clipSource, deletePattern, splitPattern } from "./actions";
import { usePlaylist } from "./store";

/** What a drag from the Picker carries: the clip source, as JSON (`ClipSource`). */
export const CLIP_DRAG_TYPE = "application/x-vaudio-clip";

/**
 * FL Studio's Picker panel (Alt+P): every pattern and audio clip of the song. A click makes one the clip
 * source (what Draw and Paint add), a drag puts it on a track, a right-click is its menu (a pattern's:
 * rename, clone, split by channel, delete).
 */
export function Picker() {
  const patterns = useSong((song) => song.patterns);
  const channels = useSong((song) => song.channels);
  usePlaylist((s) => s.source);
  useMusic((s) => s.patternId);
  const song = useSong((s) => s);
  const source = clipSource(song);
  const [renaming, setRenaming] = useState<string | null>(null);
  const audio = channels.filter((c) => c.kind === "audio");

  const item = (kind: "pattern" | "audio", ref: string, name: string) => {
    const chosen = source.kind === kind && source.ref === ref;
    if (renaming === ref) {
      return (
        <input
          key={ref}
          autoFocus
          aria-label="Pattern name"
          defaultValue={name}
          className="sunken h-6 w-full rounded-sm px-1.5 text-[11px] outline-none"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            const value = e.currentTarget.value;
            setRenaming(null);
            useMusic.getState().commit((s) => renamePattern(s, ref, value));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(null);
            e.stopPropagation();
          }}
        />
      );
    }
    return (
      <ContextMenu key={ref}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            draggable
            data-picker-item={ref}
            aria-pressed={chosen}
            title={`${name}: click to draw it, drag it onto a track`}
            className={cn("flex h-6 w-full min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-left text-[11px]", chosen ? "pressed text-brand" : "raised hover:raised-hover")}
            onClick={() => chooseSource({ kind, ref })}
            onDoubleClick={() => kind === "pattern" && setRenaming(ref)}
            onDragStart={(e) => {
              e.dataTransfer.setData(CLIP_DRAG_TYPE, JSON.stringify({ kind, ref }));
              e.dataTransfer.effectAllowed = "copy";
            }}
          >
            {kind === "pattern" ? <PiListDashes className="size-3 shrink-0 opacity-70" /> : <PiWaveform className="size-3 shrink-0 opacity-70" />}
            <span className="truncate">{name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {kind === "pattern" ? (
            <>
              <ContextMenuItem onSelect={() => setRenaming(ref)}>Rename…</ContextMenuItem>
              <ContextMenuItem onSelect={() => useMusic.getState().commit((s) => clonePattern(s, ref))}>Clone</ContextMenuItem>
              <ContextMenuItem onSelect={() => splitPattern(ref)}>Split by channel</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" disabled={patterns.length <= 1} onSelect={() => deletePattern(ref)}>
                Delete
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem variant="destructive" onSelect={() => useMusic.getState().commit((s) => removeChannels(s, [ref]))}>
              Delete (and its clips)
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <div className="flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface-1 p-1" data-testid="picker" aria-label="Picker panel">
      <div className="px-1 pt-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Patterns</div>
      {patterns.map((p) => item("pattern", p.id, p.name))}
      {audio.length > 0 && <div className="px-1 pt-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Audio clips</div>}
      {audio.map((c) => item("audio", c.id, c.name))}
    </div>
  );
}
