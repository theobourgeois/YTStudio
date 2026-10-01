import { useState } from "react";
import { PiListDashes, PiWaveform } from "react-icons/pi";
import { cn } from "cn";
import { removeChannels, renamePattern } from "@shared/music/edits";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useMusic, useSong } from "../store";
import { useMusicUi } from "../ui";
import {
  chooseSource,
  clickPattern,
  clipSource,
  clonePickedPatterns,
  deletePickedPatterns,
  movePickedPatterns,
  pickForMenu,
  showInRack,
  splitPattern,
  transposePickedPatterns,
} from "./actions";
import { pickMode } from "./picks";
import { usePlaylist } from "./store";

/** What a drag from the Picker carries: the clip source, as JSON (`ClipSource`). */
export const CLIP_DRAG_TYPE = "application/x-vaudio-clip";

/**
 * FL Studio's Picker panel (Alt+P): every pattern and audio clip of the song. A click makes one the clip
 * source (what Draw and Paint add), a double-click shows it in the Channel rack, a drag puts it on a track
 * (drawn there while it's dragged). Patterns
 * select as a list does (⌘-click toggles one, Shift+click takes a range) for their menu (a right-click:
 * transpose, rename, clone, split by channel, move, delete) and Alt+↑ / ↓, which reorders them.
 */
export function Picker() {
  const patterns = useSong((song) => song.patterns);
  const channels = useSong((song) => song.channels);
  usePlaylist((s) => s.source);
  useMusic((s) => s.patternId);
  const patternSelection = usePlaylist((s) => s.patternSelection);
  const song = useSong((s) => s);
  const source = clipSource(song);
  const [renaming, setRenaming] = useState<string | null>(null);
  const audio = channels.filter((c) => c.kind === "audio");
  // What's selected: the patterns picked, or the clip source's pattern.
  const picked = patterns.filter((p) => patternSelection.has(p.id)).map((p) => p.id);
  if (!picked.length && source.kind === "pattern") picked.push(source.ref);
  const count = picked.length;

  const item = (kind: "pattern" | "audio", ref: string, name: string, color: string | null) => {
    const chosen = source.kind === kind && source.ref === ref;
    const selected = kind === "pattern" ? picked.includes(ref) : chosen;
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
      <ContextMenu key={ref} onOpenChange={(open) => open && kind === "pattern" && pickForMenu(ref)}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            draggable
            data-picker-item={ref}
            data-selected={selected || undefined}
            aria-pressed={selected}
            title={kind === "pattern" ? `${name}: click to draw it, drag it onto a track; ⌘-click or Shift+click to select several` : `${name}: click to draw it, drag it onto a track`}
            className={cn(
              "flex h-6 w-full min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-left text-[11px]",
              selected ? "pressed" : "raised hover:raised-hover",
              chosen && "text-brand",
            )}
            // Its colour (the clip menu's Rename and color), as a strip down its left edge.
            style={color ? { boxShadow: `inset 3px 0 ${color}` } : undefined}
            onClick={(e) => {
              if (kind === "pattern") return clickPattern(ref, pickMode(e));
              usePlaylist.setState({ patternSelection: new Set() });
              chooseSource({ kind, ref });
            }}
            // A double-click shows it in the Channel rack (an audio clip: its channel, in the rack's Audio group).
            onDoubleClick={(e) => pickMode(e) === "only" && showInRack(kind, ref)}
            onDragStart={(e) => {
              e.dataTransfer.setData(CLIP_DRAG_TYPE, JSON.stringify({ kind, ref }));
              e.dataTransfer.effectAllowed = "copy";
              usePlaylist.setState({ carried: { kind, ref } });
            }}
            onDragEnd={() => {
              // Dropped elsewhere, or called off (Esc): the clip shown on the tracks goes.
              if (usePlaylist.getState().drag?.kind === "add") usePlaylist.setState({ drag: null });
              usePlaylist.setState({ carried: null });
            }}
          >
            {kind === "pattern" ? <PiListDashes className="size-3 shrink-0 opacity-70" /> : <PiWaveform className="size-3 shrink-0 opacity-70" />}
            <span className="truncate">{name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent data-testid={kind === "pattern" ? "pattern-menu" : undefined} onCloseAutoFocus={(e) => useMusicUi.getState().transposeOpen && e.preventDefault()}>
          {kind === "pattern" ? (
            <>
              {count > 1 && <ContextMenuLabel className="text-[11px] text-muted-foreground">{count} patterns selected</ContextMenuLabel>}
              <ContextMenuItem onSelect={transposePickedPatterns}>Transpose selected…</ContextMenuItem>
              <ContextMenuItem onSelect={() => setRenaming(ref)}>Rename…</ContextMenuItem>
              <ContextMenuItem onSelect={clonePickedPatterns}>Clone</ContextMenuItem>
              <ContextMenuItem onSelect={() => splitPattern(ref)}>Split by channel</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem disabled={picked.includes(patterns[0]?.id)} onSelect={() => movePickedPatterns(-1)}>
                Move up <ContextMenuShortcut>⌥↑</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem disabled={picked.includes(patterns[patterns.length - 1]?.id)} onSelect={() => movePickedPatterns(1)}>
                Move down <ContextMenuShortcut>⌥↓</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" disabled={count >= patterns.length} onSelect={deletePickedPatterns}>
                {count > 1 ? `Delete ${count} patterns` : "Delete"}
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
      {patterns.map((p) => item("pattern", p.id, p.name, p.color))}
      {audio.length > 0 && <div className="px-1 pt-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Audio clips</div>}
      {audio.map((c) => item("audio", c.id, c.name, c.color))}
    </div>
  );
}
