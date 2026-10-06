/**
 * The Layers panel (ux.md, "Workspace" and "Selecting layers"): the stack, top first; click selects (⌘ toggles,
 * Shift selects a run, a click below the rows selects nothing), a drag reorders every selected row together (one
 * undo step), the eye shows and hides, a double-click renames, a right-click is the Layers menu (merge, arrange).
 * A layer with a mask shows its thumbnail beside its own: clicking either targets what the brush paints (outlined,
 * as Photoshop's). Images show a thumbnail of themselves as they're placed on the
 * canvas; adjustments their kind and settings. A layer's filters (the glow) are listed under it as Photoshop's Smart
 * Filters are, after its effects. Missing images and effects this app can't run are said so. Its footer places
 * images, adds adjustment layers (above the selected layer, as Photoshop's does), a glow or a Lens Flare, duplicates,
 * moves and deletes. Above the rows, Photoshop's blend-mode menu (each mode previewed while it's hovered), Opacity and
 * Fill set every selected layer; Blending Options… (the menu, the fx button, a double-click on a row past its name)
 * opens the Layer Style window. Every change is an undoable edit.
 */
import { Fragment, useRef, useState } from "react";
import { cn } from "cn";
import {
  PiArrowDown,
  PiCaretDown,
  PiCaretRight,
  PiArrowUp,
  PiChartLine,
  PiCircleHalfTilt,
  PiCopy,
  PiEye,
  PiEyeSlash,
  PiFunnelSimple,
  PiImage,
  PiPaintBrush,
  PiPlus,
  PiSelectionBackground,
  PiSparkle,
  PiStackPlus,
  PiSun,
  PiSunHorizon,
  PiTrash,
  PiWarningCircle,
} from "react-icons/pi";
import { createId } from "@shared/ids";
import { blendingOf } from "@shared/photo/blending";
import { addAdjustmentLayer, moveFilter, moveLayersTo, setFilter, setFiltersEnabled, setLayerBlending, updateLayer } from "@shared/photo/edits";
import { STYLE_LIST, styleDefinition } from "@shared/photo/style/definitions";
import { setStyleEffect, setStyleEnabled } from "@shared/photo/style/style";
import { ADJUSTMENTS, effectDefinition, unavailableReason } from "@shared/photo/effects/index";
import { type AdjustmentLayer, type ContentLayer, type GeneratorLayer, type ImageLayer, type PhotoLayer, type PixelLayer, hasContent } from "@shared/photo/types";
import { ScrubNumber } from "@/components/scrub-number";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useSourceStates } from "../live";
import { photoGesture, usePhoto, usePhotoDoc, useSelection } from "../store";
import { editActions } from "../edit-actions";
import { layerActions } from "../layer-actions";
import { clickLayer } from "../selection";
import { usePhotoUi } from "../ui";
import { BlendModeMenu, useBlendModePreview } from "./blend-mode-menu";
import { useLayerThumbnail, useMaskThumbnail } from "./thumbnails";

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
  /** Layers whose effects' list is folded (Photoshop's arrow beside the fx). */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const fold = (id: string) => setFolded((f) => (f.has(id) ? new Set([...f].filter((x) => x !== id)) : new Set([...f, id])));
  const selectedIndexes = layers.flatMap((l, i) => (selectedIds.includes(l.id) ? [i] : []));
  const activeId = usePhotoUi((s) => s.selectedLayerId);
  const index = layers.findIndex((l) => l.id === activeId);
  const activeHasContent = index >= 0 && hasContent(layers[index]);
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
    const order = usePhoto.getState().history!.doc.doc.layers.map((l) => l.id);
    const mods = { toggle: MAC ? e.metaKey : e.ctrlKey, range: e.shiftKey };
    const keepForDrag = !mods.toggle && !mods.range && ui.selectedLayerIds.includes(layer.id);
    if (!keepForDrag) {
      const next = clickLayer({ ids: ui.selectedLayerIds, active: ui.selectedLayerId }, order, layer.id, mods);
      ui.setSelection(next.ids, next.active);
    }
    // A thumbnail pressed targets it: the layer's pixels, or its mask.
    const thumb = (e.target as Element).closest("[data-thumb]")?.getAttribute("data-thumb");
    if (thumb && usePhotoUi.getState().selectedLayerId === layer.id) usePhotoUi.getState().setTarget(thumb === "mask" ? "mask" : "content");
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
        const doc = usePhoto.getState().history?.doc.doc;
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
      <BlendBar />
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
              <Fragment key={l.id}>
                <LayerRow layer={l} selected={selectedIds.includes(l.id)} onPress={press} dropAbove={dropGap === i} dropBelow={dropGap === layers.length && i === layers.length - 1} folded={folded.has(l.id)} onFold={() => fold(l.id)} />
                {l.style && !folded.has(l.id) && <EffectRows layer={l} />}
                {hasContent(l) && (l.filters?.length ?? 0) > 0 && !folded.has(l.id) && <FilterRows layer={l} />}
              </Fragment>
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
        <FooterButton label="New layer (⇧⌘N)" onClick={() => layerActions.newLayer()}>
          <PiStackPlus />
        </FooterButton>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Add a layer style" disabled={index < 0}>
                  <span className="font-serif text-[13px] italic leading-none" aria-hidden>
                    fx
                  </span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Add a layer style</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" data-fx-menu>
            <DropdownMenuItem onSelect={() => layerActions.blendingOptions()}>Blending Options…</DropdownMenuItem>
            {layers[index]?.kind !== "adjustment" &&
              STYLE_LIST.map((type) => (
                <DropdownMenuItem key={type} onSelect={() => layerActions.blendingOptions(undefined, type)}>
                  {styleDefinition(type)!.label}…
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <FooterButton label="Add a mask (from the selection, if there is one)" disabled={index < 0} onClick={() => void layerActions.addMask()}>
          <PiSelectionBackground />
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
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Light</DropdownMenuLabel>
            <DropdownMenuItem disabled={!activeHasContent} onSelect={() => layerActions.addFilter("glow")}>
              <PiSunHorizon /> Glow (filter on the layer)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => layerActions.addFlare()}>
              <PiSparkle /> Lens Flare
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => usePhotoUi.getState().setFilterGalleryOpen(true)}>Filter Gallery…</DropdownMenuItem>
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

/**
 * Photoshop's row above the layers: the blend mode (previewed while hovered), Opacity and Fill, of the active layer,
 * setting every selected one (one undo step a change, or a drag).
 */
function BlendBar() {
  const activeId = usePhotoUi((s) => s.selectedLayerId);
  const active = usePhotoDoc((d) => d.layers.find((l) => l.id === activeId));
  const [gesture] = useState(() => photoGesture());
  const ids = () => usePhotoUi.getState().selectedLayerIds;
  const preview = useBlendModePreview(ids, (ids, blend) => (d) => setLayerBlending(d, ids, { blend }));
  const b = active ? blendingOf(active) : null;
  const percent = (label: string, value: number, key: "opacity" | "fill") => (
    <label className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      {label}
      <span className="w-14 rounded border border-line bg-surface-0 px-1 text-sm text-foreground">
        <ScrubNumber
          label={label}
          value={Math.round(value * 100)}
          display={{ min: 0, max: 100, step: 1, decimals: 0, unit: "%" }}
          disabled={!active}
          onBegin={() => gesture.begin()}
          onChange={(v) => gesture.apply((d) => setLayerBlending(d, ids(), { [key]: v / 100 }))}
          onEnd={() => gesture.end()}
        />
      </span>
    </label>
  );
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-line px-2 py-1.5" data-blend-bar>
      <div className="flex items-center gap-2">
        <BlendModeMenu
          className="flex-1"
          value={b?.mode ?? "normal"}
          disabled={!active}
          onOpenChange={(open, chosen) => preview.onOpenChange(open, chosen, b?.mode ?? "normal")}
          onPreview={preview.onPreview}
          onChoose={preview.onChoose}
        />
        {percent("Opacity", active?.opacity ?? 1, "opacity")}
      </div>
      <div className="flex items-center justify-end gap-2">{percent("Fill", b?.fill ?? 1, "fill")}</div>
    </div>
  );
}

/** The Layers menu (a right-click on the panel): Photoshop's Layer menu, on the selected layers. */
function LayersMenu({ count }: { count: number }) {
  const total = usePhotoDoc((d) => d.layers.length);
  const activeId = usePhotoUi((s) => s.selectedLayerId);
  const active = usePhotoDoc((d) => d.layers.find((l) => l.id === activeId));
  const selection = useSelection();
  const mod = MAC ? "⌘" : "Ctrl+";
  const alt = MAC ? "⌥" : "Alt+";
  const filterId = usePhotoUi((s) => s.selectedFilterId);
  const filter = active && hasContent(active) && filterId ? active.filters?.find((f) => f.id === filterId) : undefined;
  const commit = usePhoto((s) => s.commit);
  return (
    <ContextMenuContent className="w-56" data-layers-menu>
      {active && filter && (
        <>
          <ContextMenuItem onSelect={() => commit((d) => setFilter(d, active.id, filter.id, { enabled: !filter.enabled }))}>{filter.enabled ? "Bypass Filter" : "Turn Filter On"}</ContextMenuItem>
          <ContextMenuItem onSelect={() => layerActions.delete()}>
            Delete Filter
            <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem disabled={!active} onSelect={() => layerActions.blendingOptions()}>
        Blending Options…
      </ContextMenuItem>
      <ContextMenuItem disabled={!active} onSelect={layerActions.copyStyle}>
        Copy Layer Style
      </ContextMenuItem>
      <ContextMenuItem disabled={count === 0 || !layerActions.canPasteStyle()} onSelect={layerActions.pasteStyle}>
        Paste Layer Style
      </ContextMenuItem>
      <ContextMenuItem disabled={count === 0} onSelect={layerActions.clearStyle}>
        Clear Layer Style
      </ContextMenuItem>
      {active?.style && (
        <ContextMenuItem onSelect={() => layerActions.showEffects(!active.style!.enabled)}>{active.style.enabled ? "Hide All Effects" : "Show All Effects"}</ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => layerActions.newLayer()}>
        New Layer
        <ContextMenuShortcut>⇧{mod}N</ContextMenuShortcut>
      </ContextMenuItem>
      {active && !active.mask && <ContextMenuItem onSelect={() => void layerActions.addMask()}>Add Layer Mask</ContextMenuItem>}
      {active?.mask && <ContextMenuItem onSelect={() => layerActions.deleteMask()}>Delete Layer Mask</ContextMenuItem>}
      {active && hasContent(active) && <ContextMenuItem onSelect={() => layerActions.addFilter("glow", active.id)}>Add Glow Filter</ContextMenuItem>}
      <ContextMenuItem onSelect={() => usePhotoUi.getState().setFilterGalleryOpen(true)}>Filter Gallery…</ContextMenuItem>
      {(active?.kind === "image" || active?.kind === "generator") && <ContextMenuItem onSelect={() => void layerActions.convertToPixels(active.id)}>Convert to Pixels</ContextMenuItem>}
      <ContextMenuItem disabled={!selection || !active || active.kind === "adjustment"} onSelect={() => void editActions.layerVia(false)}>
        Layer via Copy
        <ContextMenuShortcut>{mod}J</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={!selection || active?.kind !== "pixel"} onSelect={() => void editActions.layerVia(true)}>
        Layer via Cut
        <ContextMenuShortcut>⇧{mod}J</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
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
  folded: boolean;
  onFold: () => void;
}

/**
 * A styled layer's effects under its row, as Photoshop's Layers panel lists them: "Effects" (its eye hides them
 * all), then each, top of the drawing first, with its eye; a double-click opens its page.
 */
function EffectRows({ layer }: { layer: PhotoLayer }) {
  const commit = usePhoto((s) => s.commit);
  const style = layer.style!;
  const eye = (on: boolean, label: string, toggle: () => void) => (
    <button type="button" className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground" aria-label={on ? `Hide ${label}` : `Show ${label}`} aria-pressed={on} onClick={toggle}>
      {on ? <PiEye /> : <PiEyeSlash />}
    </button>
  );
  return (
    <>
      <li className="flex h-6 items-center gap-1 pr-2 pl-2 text-xs" data-effects-of={layer.id}>
        {eye(style.enabled, "all effects", () => commit((d) => setStyleEnabled(d, [layer.id], !style.enabled)))}
        <span className={cn("pl-9", !style.enabled && "text-muted-foreground")}>Effects</span>
      </li>
      {[...style.effects].reverse().map((e) => {
        const def = styleDefinition(e.type);
        return (
          <li key={e.id} className="flex h-6 items-center gap-1 pr-2 pl-2 text-xs" data-effect={e.id} onDoubleClick={() => layerActions.blendingOptions(layer.id, e.id)}>
            {eye(e.enabled, def?.label ?? e.type, () => commit((d) => setStyleEffect(d, layer.id, e.id, { enabled: !e.enabled })))}
            <span className={cn("truncate pl-12", (!e.enabled || !style.enabled) && "text-muted-foreground")} data-unavailable={!def || e.version > def.version || undefined}>
              {def && e.version <= def.version ? def.label : `${def?.label ?? e.type} (unavailable)`}
            </span>
          </li>
        );
      })}
    </>
  );
}

function LayerRow({ layer, selected, onPress, dropAbove, dropBelow, folded, onFold }: RowProps) {
  const [renaming, setRenaming] = useState(false);
  // What the brush paints on the active layer is outlined (only one thumbnail of a layer can be).
  const target = usePhotoUi((s) => (s.selectedLayerId === layer.id ? s.target : null));
  const targeted = (part: "content" | "mask") => target !== null && (part === "mask" ? target === "mask" && !!layer.mask : target !== "mask" || !layer.mask);
  const commit = usePhoto((s) => s.commit);
  const source = useSourceStates((s) => (layer.kind === "image" ? (s.states[layer.mediaId]?.state ?? "loading") : undefined));
  return (
    <li
      className={cn("group relative flex h-10 cursor-default items-center gap-2 border-l-2 px-2", selected ? "border-brand bg-accent" : "border-transparent hover:bg-surface-2")}
      onPointerDown={(e) => {
        if (e.currentTarget.contains(e.target as Node)) onPress(e, layer);
      }}
      // On the row: its press captures the pointer (for dragging), so the click lands on the row, not the name. The
      // name renames; anywhere else past the buttons opens Blending Options (Photoshop's).
      onDoubleClick={(e) => {
        if ((e.target as Element).closest("button, input")) return;
        const name = e.currentTarget.querySelector("[data-layer-name]")?.getBoundingClientRect();
        const onName = name && e.clientX >= name.left - 2 && e.clientX <= name.right + 2 && e.clientY >= name.top - 2 && e.clientY <= name.bottom + 2;
        if (onName) setRenaming(true);
        else layerActions.blendingOptions(layer.id);
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
      <span className={cn("shrink-0 rounded-sm ring-offset-1 ring-offset-surface-1", targeted("content") && layer.kind !== "adjustment" && "ring-1 ring-foreground/70")} data-thumb="content" data-targeted={targeted("content") || undefined}>
        {layer.kind === "image" ? <ImageThumb layer={layer} /> : layer.kind === "pixel" ? <PixelThumb layer={layer} /> : layer.kind === "generator" ? <GeneratorThumb layer={layer} /> : <AdjustmentThumb layer={layer} />}
      </span>
      {layer.mask && (
        <span className={cn("shrink-0 rounded-sm ring-offset-1 ring-offset-surface-1", targeted("mask") && "ring-1 ring-foreground/70")} data-thumb="mask" data-targeted={targeted("mask") || undefined} title="Layer mask: black hides, white reveals">
          <MaskThumb layer={layer} />
        </span>
      )}
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
          <span className="max-w-full self-start truncate" data-layer-name>
            {layer.name}
          </span>
          {layer.kind === "adjustment" && <AdjustmentSummary layer={layer} />}
        </span>
      )}
      {layer.style && (
        <button type="button" className="flex shrink-0 items-center gap-0.5 rounded px-0.5 text-muted-foreground hover:text-foreground" aria-label={folded ? "Show the layer's effects" : "Fold the layer's effects"} aria-expanded={!folded} onPointerDown={(e) => e.stopPropagation()} onClick={onFold} data-fx>
          <span className="font-serif text-[13px] italic leading-none">fx</span>
          {folded ? <PiCaretRight className="size-3" /> : <PiCaretDown className="size-3" />}
        </button>
      )}
      {layer.kind === "image" ? <ImageWarning layer={layer} /> : layer.kind === "adjustment" ? <AdjustmentWarning layer={layer} /> : null}
    </li>
  );
}

/**
 * A layer's filters under it, as Photoshop lists Smart Filters: a "Filters" row whose eye bypasses them all, then
 * each, the last applied on top, with its eye. A click shows it in Properties; a drag reorders it among them.
 */
function FilterRows({ layer }: { layer: ContentLayer }) {
  const commit = usePhoto((s) => s.commit);
  const selectedId = usePhotoUi((s) => (s.selectedLayerId === layer.id ? s.selectedFilterId : null));
  const filters = layer.filters ?? [];
  const on = layer.filtersEnabled !== false;
  const press = (e: React.PointerEvent<HTMLLIElement>, id: string) => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    e.stopPropagation();
    usePhotoUi.getState().selectFilter(layer.id, id);
    // (React lets go of `currentTarget` once this handler returns.)
    const list = e.currentTarget.parentElement;
    let to: number | null = null;
    startPointerDrag(e, {
      threshold: 4,
      cursor: "grabbing",
      onMove: (ev) => {
        const rows = [...(list?.querySelectorAll<HTMLElement>(`[data-filter-of="${layer.id}"]`) ?? [])].map((r) => r.getBoundingClientRect());
        let gap = rows.findIndex((b) => ev.clientY < b.top + b.height / 2);
        if (gap < 0) gap = rows.length;
        // Listed last applied first: places count from the end.
        const shown = filters.length - 1 - filters.findIndex((f) => f.id === id);
        to = filters.length - 1 - (gap > shown ? gap - 1 : gap);
      },
      onEnd: () => {
        if (to !== null) commit((d) => moveFilter(d, layer.id, id, to!));
      },
    });
  };
  return (
    <>
      <li className={cn("flex h-6 items-center gap-1.5 pr-2 pl-9 text-xs text-muted-foreground", !layer.visible && "opacity-60")} data-filters={layer.id}>
        <button
          type="button"
          className="grid size-5 place-items-center rounded hover:text-foreground"
          aria-label={on ? "Bypass every filter" : "Turn the filters on"}
          aria-pressed={on}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => commit((d) => setFiltersEnabled(d, layer.id, !on))}
        >
          {on ? <PiEye /> : <PiEyeSlash />}
        </button>
        <PiFunnelSimple className="shrink-0" /> Filters
      </li>
      {[...filters].reverse().map((f) => {
        const def = effectDefinition(f.type);
        const reason = unavailableReason(f, "filter");
        return (
          <li
            key={f.id}
            className={cn("flex h-6 cursor-default items-center gap-1.5 pr-2 pl-14 text-xs", f.id === selectedId ? "bg-accent" : "hover:bg-surface-2", (!f.enabled || !on) && "text-muted-foreground")}
            onPointerDown={(e) => press(e, f.id)}
            onContextMenu={() => usePhotoUi.getState().selectFilter(layer.id, f.id)}
            data-filter={f.id}
            data-filter-of={layer.id}
            aria-selected={f.id === selectedId}
          >
            <button
              type="button"
              className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground"
              aria-label={f.enabled ? `Bypass ${def?.label ?? "the filter"}` : `Turn ${def?.label ?? "the filter"} on`}
              aria-pressed={f.enabled}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => commit((d) => setFilter(d, layer.id, f.id, { enabled: !f.enabled }))}
            >
              {f.enabled ? <PiEye /> : <PiEyeSlash />}
            </button>
            <span className="truncate">{def?.label ?? f.type}</span>
            {def && !reason && <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{def.summary(f.params)}</span>}
            {reason && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <PiWarningCircle className="ml-auto shrink-0 text-destructive" aria-label="Filter unavailable" />
                </TooltipTrigger>
                <TooltipContent>{reason} It's kept as it is and changes nothing here.</TooltipContent>
              </Tooltip>
            )}
          </li>
        );
      })}
    </>
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

function PixelThumb({ layer }: { layer: PixelLayer }) {
  const thumbnail = useLayerThumbnail(layer);
  return thumbnail ? (
    <img src={thumbnail} alt="" draggable={false} className="size-8 shrink-0 rounded-sm bg-surface-2 object-contain" data-thumbnail="rendered" />
  ) : (
    <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted-foreground" aria-hidden>
      <PiPaintBrush className="size-4" />
    </span>
  );
}

function GeneratorThumb({ layer }: { layer: GeneratorLayer }) {
  const thumbnail = useLayerThumbnail(layer);
  return thumbnail ? (
    <img src={thumbnail} alt="" draggable={false} className="size-8 shrink-0 rounded-sm bg-surface-2 object-contain" data-thumbnail="rendered" />
  ) : (
    <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-muted-foreground" aria-hidden>
      <PiSparkle className="size-4" />
    </span>
  );
}

function MaskThumb({ layer }: { layer: PhotoLayer }) {
  const thumbnail = useMaskThumbnail(layer);
  return thumbnail ? (
    <img src={thumbnail} alt="" draggable={false} className="size-8 shrink-0 rounded-sm bg-white object-contain" data-mask-thumbnail="rendered" />
  ) : (
    <span className="block size-8 shrink-0 rounded-sm bg-white" aria-hidden data-mask-thumbnail="blank" />
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
