/**
 * The Layers panel (ux.md, "Workspace" and "Selecting layers"): the stack, top first; click selects (⌘ toggles,
 * Shift selects a run, a click below the rows selects nothing), a drag reorders every selected row together (one
 * undo step), the eye shows and hides, a double-click renames, a right-click is the Layers menu (merge, arrange). Images show a thumbnail of themselves as they're placed on the
 * canvas; adjustments their kind and settings. Missing images and adjustments this app can't run are said so. Its
 * footer places images, adds adjustment layers (above the selected layer, as Photoshop's does), duplicates, moves
 * and deletes. Every change is an undoable edit.
 */
import { useRef, useState } from "react";
import { cn } from "cn";
import { PiArrowDown, PiArrowUp, PiChartLine, PiCircleHalfTilt, PiCopy, PiEye, PiEyeSlash, PiImage, PiPlus, PiSun, PiTrash, PiWarningCircle } from "react-icons/pi";
import { createId } from "@shared/ids";
import { addAdjustmentLayer, moveLayersTo, updateLayer } from "@shared/photo/edits";
import { ADJUSTMENTS, effectDefinition, unavailableReason } from "@shared/photo/effects/index";
import type { AdjustmentLayer, ImageLayer, PhotoLayer } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useSourceStates } from "../live";
import { usePhoto, usePhotoDoc } from "../store";
import { layerActions } from "../layer-actions";
import { clickLayer } from "../selection";
import { usePhotoUi } from "../ui";
import { useLayerThumbnail } from "./thumbnails";

/** Each adjustment's icon (Photoshop's Adjustments panel has one per kind). */
export const ADJUSTMENT_ICONS: Record<string, typeof PiSun> = { exposure: PiSun, curves: PiChartLine };

/** Adds an adjustment layer above the selected layer (or on top) and selects it. */
export function addAdjustment(type: string) {
  const id = createId("layer");
  usePhoto.getState().commit((d) => addAdjustmentLayer(d, { id, type }, usePhotoUi.getState().selectedLayerId));
  usePhotoUi.getState().select(id);
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function LayersPanel() {
  const layers = usePhotoDoc((d) => d.layers);
  const selectedIds = usePhotoUi((s) => s.selectedLayerIds);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const selectedIndexes = layers.flatMap((l, i) => (selectedIds.includes(l.id) ? [i] : []));
  const none = selectedIndexes.length === 0;

  /**
   * A row's press: selects it (⌘ toggles, Shift selects the run from the active row), and a drag moves every
   * selected row in the stack together (dropped between rows). Pressing one of several selected rows keeps them all
   * for the drag; a click without one selects it alone.
   */
  const press = (e: React.PointerEvent<HTMLLIElement>, layer: PhotoLayer) => {
    if (e.button === 2) {
      // The menu acts on what's selected: a row outside it is selected first (Photoshop's).
      if (!usePhotoUi.getState().selectedLayerIds.includes(layer.id)) usePhotoUi.getState().select(layer.id);
      return;
    }
    const ui = usePhotoUi.getState();
    const order = usePhoto.getState().history!.doc.layers.map((l) => l.id);
    const mods = { toggle: MAC ? e.metaKey : e.ctrlKey, range: e.shiftKey };
    const keepForDrag = !mods.toggle && !mods.range && ui.selectedLayerIds.includes(layer.id);
    if (!keepForDrag) {
      const next = clickLayer({ ids: ui.selectedLayerIds, active: ui.selectedLayerId }, order, layer.id, mods);
      ui.setSelection(next.ids, next.active);
    }
    // Toggled off: nothing to drag.
    if (!usePhotoUi.getState().selectedLayerIds.includes(layer.id)) return;
    const rows = () => [...(list.current?.querySelectorAll<HTMLElement>("[data-layer]") ?? [])];
    let gap: number | null = null;
    startPointerDrag(e, {
      threshold: 4,
      cursor: "grabbing",
      onMove: (ev) => {
        const boxes = rows().map((r) => r.getBoundingClientRect());
        gap = boxes.findIndex((b) => ev.clientY < b.top + b.height / 2);
        if (gap < 0) gap = boxes.length;
        setDropGap(gap);
      },
      onEnd: () => {
        setDropGap(null);
        const doc = usePhoto.getState().history?.doc;
        if (gap === null || !doc) return;
        // The gap counts rows from the top; the edit counts layers below it.
        const below = doc.layers.length - gap;
        const ids = usePhotoUi.getState().selectedLayerIds;
        usePhoto.getState().commit((d) => moveLayersTo(d, ids, below));
      },
      onCancel: () => setDropGap(null),
      onClick: () => {
        if (keepForDrag) usePhotoUi.getState().setSelection([layer.id]);
      },
    });
  };

  return (
    <div className="flex min-h-0 flex-1 select-none flex-col text-sm" data-layers-panel>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ul
            ref={list}
            className="relative min-h-0 flex-1 overflow-y-auto py-1"
            aria-label="Layers"
            aria-multiselectable
            // A click on the panel below the rows selects no layer (Photoshop's).
            onPointerDown={(e) => {
              if (e.target === e.currentTarget && e.button === 0) layerActions.deselect();
            }}
          >
            {[...layers].reverse().map((l, i) => (
              <LayerRow key={l.id} layer={l} selected={selectedIds.includes(l.id)} onPress={press} dropAbove={dropGap === i} dropBelow={dropGap === layers.length && i === layers.length - 1} />
            ))}
            {layers.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">No layers: place an image.</li>}
          </ul>
        </ContextMenuTrigger>
        <LayersMenu count={selectedIds.length} />
      </ContextMenu>
      <div className="flex shrink-0 items-center gap-0.5 border-t border-line px-1.5 py-1">
        <FooterButton label="Place an image…" onClick={() => input.current?.click()}>
          <PiPlus />
        </FooterButton>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          data-place-input
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void usePhoto.getState().placeFiles(files).then((ids) => ids.length && usePhotoUi.getState().select(ids.at(-1)!));
          }}
        />
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="New adjustment layer">
                  <PiCircleHalfTilt />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>New adjustment layer</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            {ADJUSTMENTS.map((def) => {
              const Icon = ADJUSTMENT_ICONS[def.type] ?? PiCircleHalfTilt;
              return (
                <DropdownMenuItem key={def.type} onSelect={() => addAdjustment(def.type)}>
                  <Icon /> {def.label}…
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        <FooterButton label="Move up (⌘])" disabled={none || selectedIndexes.every((i, k) => i === layers.length - selectedIndexes.length + k)} onClick={() => layerActions.shift(1)}>
          <PiArrowUp />
        </FooterButton>
        <FooterButton label="Move down (⌘[)" disabled={none || selectedIndexes.every((i, k) => i === k)} onClick={() => layerActions.shift(-1)}>
          <PiArrowDown />
        </FooterButton>
        <FooterButton label="Duplicate (⌘J)" disabled={none} onClick={layerActions.duplicate}>
          <PiCopy />
        </FooterButton>
        <FooterButton label="Delete" disabled={none} onClick={layerActions.delete}>
          <PiTrash />
        </FooterButton>
      </div>
    </div>
  );
}

/** The Layers menu (a right-click on the panel): Photoshop's Layer menu, on the selected layers. */
function LayersMenu({ count }: { count: number }) {
  const total = usePhotoDoc((d) => d.layers.length);
  const mod = MAC ? "⌘" : "Ctrl+";
  const alt = MAC ? "⌥" : "Alt+";
  return (
    <ContextMenuContent className="w-56" data-layers-menu>
      <ContextMenuItem disabled={count === 0} onSelect={layerActions.duplicate}>
        {count > 1 ? "Duplicate Layers" : "Duplicate Layer"}
        <ContextMenuShortcut>{mod}J</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={count === 0} onSelect={layerActions.delete}>
        {count > 1 ? "Delete Layers" : "Delete Layer"}
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={count === 0} onSelect={() => void layerActions.merge()}>
        {count > 1 ? "Merge Layers" : "Merge Down"}
        <ContextMenuShortcut>{mod}E</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={total < 2} onSelect={() => void layerActions.mergeVisible()}>
        Merge Visible
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={count === 0} onSelect={() => layerActions.arrange("top")}>
        Bring to Front
      </ContextMenuItem>
      <ContextMenuItem disabled={count === 0} onSelect={() => layerActions.shift(1)}>
        Bring Forward
        <ContextMenuShortcut>{mod}]</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={count === 0} onSelect={() => layerActions.shift(-1)}>
        Send Backward
        <ContextMenuShortcut>{mod}[</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={count === 0} onSelect={() => layerActions.arrange("bottom")}>
        Send to Back
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={total === 0} onSelect={layerActions.selectAll}>
        Select All Layers
        <ContextMenuShortcut>
          {alt}
          {mod}A
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={count === 0} onSelect={layerActions.deselect}>
        Deselect Layers
        <ContextMenuShortcut>{mod}D</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function FooterButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface RowProps {
  layer: PhotoLayer;
  selected: boolean;
  onPress: (e: React.PointerEvent<HTMLLIElement>, layer: PhotoLayer) => void;
  dropAbove: boolean;
  dropBelow: boolean;
}

function LayerRow({ layer, selected, onPress, dropAbove, dropBelow }: RowProps) {
  const [renaming, setRenaming] = useState(false);
  const commit = usePhoto((s) => s.commit);
  const source = useSourceStates((s) => (layer.kind === "image" ? (s.states[layer.mediaId]?.state ?? "loading") : undefined));
  return (
    <li
      className={cn("group relative flex h-10 cursor-default items-center gap-2 border-l-2 px-2", selected ? "border-brand bg-accent" : "border-transparent hover:bg-surface-2")}
      onPointerDown={(e) => {
        if (e.currentTarget.contains(e.target as Node)) onPress(e, layer);
      }}
      // On the row: its press captures the pointer (for dragging), so the click lands on the row, not the name.
      onDoubleClick={(e) => {
        if (!(e.target as Element).closest("button, input")) setRenaming(true);
      }}
      data-layer={layer.id}
      data-kind={layer.kind}
      data-source={source}
      aria-selected={selected}
    >
      {dropAbove && <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 -translate-y-1/2 rounded bg-brand" data-drop-line />}
      {dropBelow && <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 translate-y-1/2 rounded bg-brand" data-drop-line />}
      <button
        type="button"
        className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
        aria-label={layer.visible ? "Hide" : "Show"}
        aria-pressed={layer.visible}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => commit((d) => updateLayer(d, layer.id, { visible: !layer.visible }))}
      >
        {layer.visible ? <PiEye /> : <PiEyeSlash />}
      </button>
      {layer.kind === "image" ? <ImageThumb layer={layer} /> : <AdjustmentThumb layer={layer} />}
      {renaming ? (
        <input
          autoFocus
          defaultValue={layer.name}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded border border-line bg-surface-0 px-1 text-sm"
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            commit((d) => updateLayer(d, layer.id, { name: e.currentTarget.value }));
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      ) : (
        <span className={cn("flex min-w-0 flex-1 flex-col leading-tight", !layer.visible && "text-muted-foreground")}>
          <span className="truncate" data-layer-name>
            {layer.name}
          </span>
          {layer.kind === "adjustment" && <AdjustmentSummary layer={layer} />}
        </span>
      )}
      {layer.kind === "image" ? <ImageWarning layer={layer} /> : <AdjustmentWarning layer={layer} />}
    </li>
  );
}

function ImageThumb({ layer }: { layer: ImageLayer }) {
  const thumbnail = useLayerThumbnail(layer);
  const poster = usePhoto((s) => s.assets.find((a) => a.id === layer.mediaId)?.poster);
  const src = thumbnail ?? poster;
  return src ? (
    <img src={src} alt="" draggable={false} className="size-8 shrink-0 rounded-sm bg-surface-2 object-contain" data-thumbnail={thumbnail ? "rendered" : "poster"} />
  ) : (
    <PiImage className="size-8 shrink-0 text-muted-foreground" />
  );
}

function AdjustmentThumb({ layer }: { layer: AdjustmentLayer }) {
  const Icon = ADJUSTMENT_ICONS[layer.effect.type] ?? PiCircleHalfTilt;
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted-foreground" aria-hidden>
      <Icon className="size-4.5" />
    </span>
  );
}

function AdjustmentSummary({ layer }: { layer: AdjustmentLayer }) {
  const def = effectDefinition(layer.effect.type);
  if (!def || unavailableReason(layer.effect)) return null;
  return <span className="truncate text-[11px] text-muted-foreground">{def.summary(layer.effect.params)}</span>;
}

function ImageWarning({ layer }: { layer: ImageLayer }) {
  const asset = usePhoto((s) => s.assets.find((a) => a.id === layer.mediaId));
  const source = useSourceStates((s) => s.states[layer.mediaId]);
  if (asset && source?.state !== "failed") return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PiWarningCircle className="shrink-0 text-destructive" aria-label={asset ? "Image unreadable" : "Image missing"} />
      </TooltipTrigger>
      <TooltipContent>{asset ? `Its image couldn't be read: ${source?.state === "failed" ? source.error : ""}` : "Its image isn't in the project any more."}</TooltipContent>
    </Tooltip>
  );
}

function AdjustmentWarning({ layer }: { layer: AdjustmentLayer }) {
  const reason = unavailableReason(layer.effect);
  if (!reason) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PiWarningCircle className="shrink-0 text-destructive" aria-label="Adjustment unavailable" />
      </TooltipTrigger>
      <TooltipContent>{reason} It's kept as it is and changes nothing here.</TooltipContent>
    </Tooltip>
  );
}
