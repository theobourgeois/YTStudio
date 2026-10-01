import { useEffect, useRef, useState } from "react";
import { PiChartLine, PiListDashes, PiPlus, PiWaveform } from "react-icons/pi";
import { cn } from "cn";
import { renamePattern } from "@shared/music/edits";
import { clipContext } from "@shared/music/playlist";
import type { Automation, Channel, Pattern } from "@shared/music/types";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { prepare } from "../piano/draw";
import { useMusic, useSong } from "../store";
import { useMusicUi } from "../ui";
import { controlOf } from "@shared/music/automation";
import { deleteAutomations, openAutomationWindow, openChooser } from "../automation/actions";
import {
  clickAudio,
  clickAutomation,
  clickPattern,
  clipSource,
  clonePickedPatterns,
  deletePickedAudio,
  deletePickedPatterns,
  movePickedPatterns,
  pickAudioForMenu,
  pickAutomationForMenu,
  pickForMenu,
  showInRack,
  splitPattern,
  transposePickedPatterns,
} from "./actions";
import { KIND_COLOURS, clipColours, drawAutomationPreview, drawPatternPreview, drawWaveformPreview } from "./draw";
import { pickMode } from "./picks";
import { type ClipSource, type PickerTab as PickerTabId, usePlaylist } from "./store";
import { clipPeaks, onWaveform } from "./waveforms";

/** What a drag from the Picker carries: the clip sources, as JSON (`ClipSource[]`). */
export const CLIP_DRAG_TYPE = "application/x-vaudio-clip";

/** An item's preview, under its name: as wide as the item, this tall. */
const PREVIEW_H = 16;

/**
 * FL Studio's Picker panel (Alt+P): the song's patterns, its audio clips or its automation clips (its tabs,
 * as FL's). Each is shown as its clips are, in its colour with a preview of its notes, waveform or curve. A click makes one the clip source (what Draw and Paint add), a double-click shows it in the
 * Channel rack, a drag puts it on a track (drawn there while it's dragged). They select as a list does
 * (⌘-click toggles one, Shift+click takes a range) for their menu (a right-click) and, for patterns,
 * Alt+↑ / ↓, which reorders them.
 */
export function Picker() {
  const tab = usePlaylist((s) => s.pickerTab);
  const patterns = useSong((song) => song.patterns);
  const channels = useSong((song) => song.channels);
  const audio = channels.filter((c) => c.kind === "audio");
  const automations = useSong((song) => song.automations);
  useDeselectAway();
  return (
    <div className="flex w-48 shrink-0 flex-col border-r border-line bg-surface-1" data-testid="picker" aria-label="Picker panel">
      <div className="flex h-7 shrink-0 items-end gap-0.5 border-b border-line px-1.5" role="tablist" aria-label="What the Picker shows">
        <PickerTab id="patterns" label={`Patterns (${patterns.length})`}>
          <PiListDashes className="size-3.5" />
        </PickerTab>
        <PickerTab id="audio" label={`Audio clips (${audio.length})`}>
          <PiWaveform className="size-3.5" />
        </PickerTab>
        <PickerTab id="automation" label={`Automation clips (${automations.length})`}>
          <PiChartLine className="size-3.5" />
        </PickerTab>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1">
        {tab === "patterns" ? <PatternItems patterns={patterns} /> : tab === "audio" ? <AudioItems audio={audio} /> : <AutomationItems automations={automations} />}
      </div>
    </div>
  );
}

/**
 * A press anywhere but on the Picker's items (or a menu opened from one, which acts on them) lets go of
 * the patterns and audio clips selected there, as a list's selection goes when it's clicked away from.
 */
function useDeselectAway() {
  useEffect(() => {
    const press = (e: PointerEvent) => {
      const { patternSelection, audioSelection, automationSelection } = usePlaylist.getState();
      if (!patternSelection.size && !audioSelection.size && !automationSelection.size) return;
      const target = e.target as Element | null;
      if (target?.closest?.("[data-picker-item], [data-radix-popper-content-wrapper], [role=menu], [role=dialog], [data-window='transpose']")) return;
      usePlaylist.setState({ patternSelection: new Set(), audioSelection: new Set(), automationSelection: new Set() });
    };
    window.addEventListener("pointerdown", press, true);
    return () => window.removeEventListener("pointerdown", press, true);
  }, []);
}

/** One of the Picker's tabs: a quiet icon, lit when it's the one shown. */
function PickerTab({ id, label, children }: { id: PickerTabId; label: string; children: React.ReactNode }) {
  const selected = usePlaylist((s) => s.pickerTab === id);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={label}
      title={label}
      className={cn("-mb-px grid h-6 w-8 place-items-center border-b-2", selected ? "border-brand text-foreground" : "border-transparent text-muted-foreground/70 hover:text-foreground")}
      onClick={() => usePlaylist.setState({ pickerTab: id })}
    >
      {children}
    </button>
  );
}

function PatternItems({ patterns }: { patterns: readonly Pattern[] }) {
  usePlaylist((s) => s.source);
  useMusic((s) => s.patternId);
  const patternSelection = usePlaylist((s) => s.patternSelection);
  const song = useSong((s) => s);
  const source = clipSource(song);
  const [renaming, setRenaming] = useState<string | null>(null);
  // What's selected: the patterns picked, or the clip source's pattern.
  const picked = patterns.filter((p) => patternSelection.has(p.id)).map((p) => p.id);
  if (!picked.length && source.kind === "pattern") picked.push(source.ref);
  const count = picked.length;
  const ctx = clipContext(song);

  return patterns.map((pattern) => {
    const ref = pattern.id;
    if (renaming === ref) {
      return (
        <input
          key={ref}
          autoFocus
          aria-label="Pattern name"
          defaultValue={pattern.name}
          className="sunken h-[34px] w-full shrink-0 rounded-[3px] px-1.5 text-[11px] outline-none"
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
      <ContextMenu key={ref} onOpenChange={(open) => open && pickForMenu(ref)}>
        <ContextMenuTrigger asChild>
          <PickerItem
            kind="pattern"
            id={ref}
            name={pattern.name}
            color={pattern.color}
            selected={picked.includes(ref)}
            chosen={source.kind === "pattern" && source.ref === ref}
            title={`${pattern.name}: click to draw it, drag it onto a track, double-click to show it in the rack; ⌘-click or Shift+click to select several`}
            onClick={(e) => clickPattern(ref, pickMode(e))}
            carries={(picked.includes(ref) ? picked : [ref]).map((id) => carried(patterns.find((p) => p.id === id)!))}
            draw={(c, w, h, colour) => drawPatternPreview(c, pattern, ctx.patternTicks(ref), w, h, colour)}
            drawKey={pattern.notes}
          />
        </ContextMenuTrigger>
        <ContextMenuContent data-testid="pattern-menu" onCloseAutoFocus={(e) => useMusicUi.getState().transposeOpen && e.preventDefault()}>
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
          <ContextMenuItem variant="destructive" onSelect={deletePickedPatterns}>
            {count > 1 ? `Delete ${count} patterns` : "Delete"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  });
}

function AudioItems({ audio }: { audio: readonly Channel[] }) {
  usePlaylist((s) => s.source);
  const audioSelection = usePlaylist((s) => s.audioSelection);
  const assets = useMusic((s) => s.assets);
  const song = useSong((s) => s);
  const source = clipSource(song);
  const picked = audio.filter((c) => audioSelection.has(c.id)).map((c) => c.id);
  if (!picked.length && source.kind === "audio") picked.push(source.ref);
  const count = picked.length;
  if (!audio.length) return <p className="px-1.5 py-2 text-[11px] text-muted-foreground">No audio clips yet: drop a file from the Browser or the Finder on a track.</p>;

  return audio.map((channel) => {
    const url = assets.find((a) => a.id === channel.sampleId)?.src ?? null;
    return (
      <ContextMenu key={channel.id} onOpenChange={(open) => open && pickAudioForMenu(channel.id)}>
        <ContextMenuTrigger asChild>
          <PickerItem
            kind="audio"
            id={channel.id}
            name={channel.name}
            color={channel.color}
            selected={picked.includes(channel.id)}
            chosen={source.kind === "audio" && source.ref === channel.id}
            title={`${channel.name}: click to draw it, drag it onto a track; ⌘-click or Shift+click to select several`}
            onClick={(e) => clickAudio(channel.id, pickMode(e))}
            carries={(picked.includes(channel.id) ? picked : [channel.id]).map((id) => carried(audio.find((c) => c.id === id)!))}
            draw={(c, w, h, colour) => {
              const peaks = url ? clipPeaks(url, channel.precomputed) : null;
              if (peaks) drawWaveformPreview(c, peaks, w, h, colour);
              else c.clearRect(0, 0, w, h);
            }}
            drawKey={`${url}|${JSON.stringify(channel.precomputed)}`}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          {count > 1 && <ContextMenuLabel className="text-[11px] text-muted-foreground">{count} audio clips selected</ContextMenuLabel>}
          <ContextMenuItem onSelect={() => useMusicUi.getState().openChannelWindow(channel.id)}>Channel settings</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={deletePickedAudio}>
            {count > 1 ? `Delete ${count} audio clips (and their clips)` : "Delete (and its clips)"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  });
}

/**
 * The automation clips: an Automate… button first (every control of the song, to make one of), then each
 * clip as its clips show it, with what it drives under its name.
 */
function AutomationItems({ automations }: { automations: readonly Automation[] }) {
  usePlaylist((s) => s.source);
  const automationSelection = usePlaylist((s) => s.automationSelection);
  const song = useSong((s) => s);
  const source = clipSource(song);
  const picked = automations.filter((a) => automationSelection.has(a.id)).map((a) => a.id);
  if (!picked.length && source.kind === "automation") picked.push(source.ref);
  const count = picked.length;
  const { barTicks } = clipContext(song);
  return (
    <>
      <button
        type="button"
        className="raised hover:raised-hover flex h-6 shrink-0 items-center justify-center gap-1 rounded-[3px] text-[11px] font-medium"
        title="Pick a control to automate: a channel's, the mixer's, or one of a plugin's parameters"
        onClick={openChooser}
      >
        <PiPlus className="size-3" />
        Automate…
      </button>
      {!automations.length && (
        <p className="px-1.5 py-2 text-[11px] text-muted-foreground">
          No automation clips yet: right-click a knob (Create automation clip), touch a parameter in a plugin's window and press its Automate button, or pick a control with Automate….
        </p>
      )}
      {automations.map((automation) => {
        const info = controlOf(song, automation.target);
        return (
          <ContextMenu key={automation.id} onOpenChange={(open) => open && pickAutomationForMenu(automation.id)}>
            <ContextMenuTrigger asChild>
              <PickerItem
                kind="automation"
                id={automation.id}
                name={automation.name}
                color={automation.color}
                selected={picked.includes(automation.id)}
                chosen={source.kind === "automation" && source.ref === automation.id}
                title={`${automation.name}: ${info.exists ? `${info.name} of ${info.owner}` : "what it drove is gone"}. Click to draw it, drag it onto a track, double-click for its settings`}
                onClick={(e) => clickAutomation(automation.id, pickMode(e))}
                carries={(picked.includes(automation.id) ? picked : [automation.id]).map((id) => carried(automations.find((a) => a.id === id)!))}
                draw={(c, w, h, colour) => drawAutomationPreview(c, automation, w, h, colour, barTicks)}
                drawKey={automation}
                gone={!info.exists}
              />
            </ContextMenuTrigger>
            <ContextMenuContent>
              {count > 1 && <ContextMenuLabel className="text-[11px] text-muted-foreground">{count} automation clips selected</ContextMenuLabel>}
              <ContextMenuItem onSelect={() => openAutomationWindow(automation.id)}>Automation settings</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => deleteAutomations(picked.length ? picked : [automation.id])}>
                {count > 1 ? `Delete ${count} automation clips (and their clips)` : "Delete (and its clips)"}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </>
  );
}

/** An item a drag takes: its name and colour are on the badge under the pointer. */
interface Carried {
  id: string;
  name: string;
  color: string | null;
}
const carried = (item: Pattern | Channel | Automation): Carried => ({ id: item.id, name: item.name, color: item.color });

/**
 * What's under the pointer while items are dragged from the Picker: a small tag with the first one's
 * name, on a stack of cards when there are more (with how many), so it doesn't look like the clips
 * themselves, which the Playlist shows where they'd land.
 */
function dragBadge(transfer: DataTransfer, kind: ClipSource["kind"], items: readonly Carried[]) {
  const colours = (item: Carried) => (item.color ? clipColours(item.color) : KIND_COLOURS[kind]);
  const badge = document.createElement("div");
  badge.style.cssText = "position:fixed;top:-200px;left:0;padding:0 8px 8px 0;font:600 11px/1 var(--font-sans);pointer-events:none";
  const behind = items.slice(1, 3);
  behind.forEach((item, i) => {
    const card = document.createElement("div");
    const offset = (behind.length - i) * 3;
    card.style.cssText = `position:absolute;left:${offset}px;top:${offset}px;right:${8 - offset}px;bottom:${8 - offset}px;border-radius:3px;outline:1px solid rgb(0 0 0 / 0.35);background:${colours(item).title}`;
    badge.append(card);
  });
  const front = document.createElement("div");
  const first = colours(items[0]);
  front.style.cssText = `position:relative;display:flex;align-items:center;gap:6px;max-width:180px;height:18px;padding:0 6px;border-radius:3px;outline:1px solid rgb(0 0 0 / 0.35);box-shadow:0 2px 6px rgb(0 0 0 / 0.3);background:${first.title};color:${first.text}`;
  const name = document.createElement("span");
  name.textContent = items[0].name;
  name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  front.append(name);
  if (items.length > 1) {
    const count = document.createElement("span");
    count.textContent = `+${items.length - 1}`;
    count.style.cssText = "flex-shrink:0;padding:2px 4px;border-radius:999px;background:rgb(0 0 0 / 0.3)";
    front.append(count);
  }
  badge.append(front);
  document.body.append(badge);
  transfer.setDragImage(badge, 10, 9);
  // The browser takes its picture as the drag starts.
  setTimeout(() => badge.remove());
}

interface PickerItemProps extends Omit<React.ComponentProps<"button">, "onClick" | "color"> {
  kind: ClipSource["kind"];
  id: string;
  name: string;
  color: string | null;
  selected: boolean;
  /** It's the clip source: what Draw and Paint add (FL's red marker on its left). */
  chosen: boolean;
  onClick: (e: React.MouseEvent) => void;
  /** What a drag from it takes: itself, or every item selected with it (in the list's order). */
  carries: readonly Carried[];
  /** Draw its preview on a canvas `w` by `h` CSS pixels, in its content colour. */
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, colour: string) => void;
  /** When this changes, the preview is drawn again. */
  drawKey: unknown;
  /** What it plays is gone (an automation clip of a deleted channel): shown faded. */
  gone?: boolean;
}

/** An item of the Picker, as FL shows one: a small clip, its name on its title strip, its preview under it. */
function PickerItem({ kind, id, name, color, selected, chosen, onClick, carries, draw, drawKey, gone, ...rest }: PickerItemProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const colours = color ? clipColours(color) : KIND_COLOURS[kind];
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const paint = () => {
      const width = canvas.current?.clientWidth ?? 0;
      const c = canvas.current && width && prepare(canvas.current, width, PREVIEW_H);
      if (c) drawRef.current(c, width, PREVIEW_H, colours.content);
    };
    paint();
    // An audio file's waveform arrives once it's decoded.
    return kind === "audio" ? onWaveform(paint) : undefined;
  }, [drawKey, colours.content, kind]);

  return (
    <button
      {...rest}
      type="button"
      draggable
      data-picker-item={id}
      data-selected={selected || undefined}
      aria-pressed={selected}
      className={cn(
        "relative flex w-full shrink-0 flex-col overflow-hidden rounded-[3px] text-left outline-offset-1",
        selected ? "outline-2 outline-[var(--piano-start)]" : "outline-1 outline-black/30 hover:brightness-110",
        gone && "opacity-50",
      )}
      style={{ background: colours.body }}
      onClick={onClick}
      onDoubleClick={(e) => pickMode(e) === "only" && showInRack(kind, id)}
      onDragStart={(e) => {
        const sources = carries.map((c) => ({ kind, ref: c.id }));
        e.dataTransfer.setData(CLIP_DRAG_TYPE, JSON.stringify(sources));
        dragBadge(e.dataTransfer, kind, carries);
        e.dataTransfer.effectAllowed = "copy";
        usePlaylist.setState({ carried: sources });
      }}
      onDragEnd={() => {
        // Dropped elsewhere, or called off (Esc): the clip shown on the tracks goes.
        if (usePlaylist.getState().drag?.kind === "add") usePlaylist.setState({ drag: null });
        usePlaylist.setState({ carried: null });
      }}
    >
      <span className="flex h-4 items-center gap-1 px-1 text-[11px] leading-none font-semibold" style={{ background: colours.title, color: colours.text }}>
        {kind === "pattern" ? (
          <PiListDashes className="size-3 shrink-0 opacity-80" />
        ) : kind === "automation" ? (
          <PiChartLine className="size-3 shrink-0 opacity-80" />
        ) : (
          <PiWaveform className="size-3 shrink-0 opacity-80" />
        )}
        <span className="truncate">{name}</span>
      </span>
      <canvas ref={canvas} aria-hidden className="block w-full" style={{ height: PREVIEW_H }} />
      {chosen && <span aria-hidden className="absolute top-0.5 left-0 size-0 border-y-[5px] border-l-[6px] border-y-transparent border-l-[var(--piano-start)]" />}
    </button>
  );
}
