/**
 * The photo suite's main column (`clientSuite("photo").Workspace`, ux.md "Workspace"): its menus (in the tab strip),
 * its header (name, the tool's options, then undo, export and the assistant as every suite has them), the tool
 * strip, the docked panels (the canvas, Layers, Properties: Photoshop's are docked too), and its windows. Its keys
 * are `keys.ts`'s.
 */
import { type DragEvent, type ReactNode, useEffect, useState } from "react";
import { cn } from "cn";
import {
  PiArrowsLeftRight,
  PiArrowUpRight,
  PiCircle,
  PiCircleDashed,
  PiCrop,
  PiCursor,
  PiDropHalf,
  PiEraser,
  PiEraserFill,
  PiEyedropper,
  PiFlame,
  PiGradient,
  PiHand,
  PiLineSegment,
  PiImage,
  PiLasso,
  PiMagicWand,
  PiMagnet,
  PiMagnifyingGlass,
  PiPaintBrush,
  PiPaintBrushBroad,
  PiSelectionForeground,
  PiPaintBucket,
  PiPolygon,
  PiRectangle,
  PiSelection,
  PiSparkle,
  PiSunDim,
  PiTextT,
} from "react-icons/pi";
import { toast } from "sonner";
import { moveLayersBy } from "@shared/photo/edits";
import { ColorSamplerContext, ColorSwatchPicker } from "@/components/color-picker";
import { stepBrushSize, useBrush } from "./brush-options";
import { useColours } from "./colours";
import { editActions, hasPhotoClipboard } from "./edit-actions";
import { PaintChoiceDialog, ToolOptions } from "./options-bar";
import { TOOLBOX } from "./toolbox";
import { photoColourSampler } from "./colour-sampling";
import { FeatherDialog, useFeather } from "./select-commands";
import { ModelDialog } from "./model-dialog";
import { runContentAwareFill } from "./content-aware-fill";
import { selectActions, useSelectOptions } from "./selecting";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { HeaderActions } from "@/components/header/header-actions";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { DockArea, DockMenuItems, FloatingPanels, type DockPanel } from "@/components/dock/dock-area";
import type { DockLayout } from "@/components/dock/model";
import { createDock } from "@/components/dock/store";
import { ProjectName } from "@/components/header/project-name";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Desktop, keptByWindow } from "@/components/windows/floating-window";
import { createWindows } from "@/components/windows/store";
import { PlainWorkspace, WorkspaceError, WorkspaceLoading } from "@/components/workspace/plain-workspace";
import { useFileDrop } from "@/hooks/use-file-drop";
import { api } from "@/lib/api";
import { CanvasPanel, actualPixels, canvasPointAt, fitToCanvas, zoomBy } from "./canvas/canvas-panel";
import { PhotoExportWindow } from "./export-window";
import { FilterGalleryWindow } from "./filters";
import { LayerStyleWindow } from "./layer-style/layer-style-window";
import { CameraRawWindow } from "./camera-raw/camera-raw-window";
import { cameraRawActions } from "./camera-raw/actions";
import { HueSaturationWindow } from "./hue-saturation/hue-saturation-window";
import { hueSaturationActions } from "./hue-saturation/actions";
import { PhotoMenus } from "./menus";
import { ScaleEffectsWindow } from "./layer-style/scale-effects-window";
import { resolvePhotoKey } from "./keys";
import { transformActions } from "./transform-actions";
import { freeTransform, useFreeTransform } from "./free-transform";
import { layerActions, selectedInOrder } from "./layer-actions";
import { liveRenderer } from "./live";
import { isImage } from "./media";
import { LayersPanel } from "./panels/layers-panel";
import { usePhotoPreferences } from "./preferences";
import { PropertiesPanel } from "./panels/properties-panel";
import { OnlinePanel } from "./online/online-panel";
import { getOnlineDragData, isOnlineDrag, placeOnline } from "./online/online";
import { StylesPanel } from "./panels/styles-panel";
import { currentSelection, flushPhotos, photoGesture, usePhoto } from "./store";
import { type PhotoTool, TOOL_GROUPS, type ToolGroup, useActiveTool, usePhotoUi } from "./ui";

type PhotoPanel = "canvas" | "layers" | "properties" | "styles" | "online";
type PhotoWindowId = "export" | "filters" | `panel:${string}`;

const usePhotoWindows = createWindows<PhotoWindowId>();
const panelWindow = (panel: PhotoPanel): PhotoWindowId => `panel:${panel}`;

/** The canvas, with Layers over Properties on its right (Photoshop's default). */
const defaultLayout = (): DockLayout<PhotoPanel> => ({
  root: {
    type: "split",
    id: "photo",
    direction: "row",
    sizes: [1100, 300],
    children: [
      { type: "group", id: "canvas", panels: ["canvas"], active: "canvas" },
      {
        type: "split",
        id: "photo-right",
        direction: "column",
        sizes: [380, 420],
        children: [
          { type: "group", id: "layers", panels: ["layers"], active: "layers" },
          // Online sits with Properties, as Photoshop's Libraries does.
          { type: "group", id: "properties", panels: ["properties", "styles", "online"], active: "properties" },
        ],
      },
    ],
  },
  floating: [],
});

const usePhotoDock = createDock<PhotoPanel, PhotoWindowId>({
  key: "editor-photo-layout",
  panels: ["canvas", "layers", "properties", "styles", "online"],
  initial: defaultLayout,
  homes: { online: "properties" },
  windows: usePhotoWindows,
  windowId: panelWindow,
});

const PANELS: Record<PhotoPanel, DockPanel> = {
  canvas: { title: "Canvas", render: () => <CanvasPanel />, keepMounted: true, minWidth: 320, minHeight: 240 },
  layers: { title: "Layers", render: () => <LayersPanel />, minWidth: 220, minHeight: 140 },
  properties: { title: "Properties", render: () => <PropertiesPanel />, minWidth: 220, minHeight: 160 },
  styles: { title: "Styles", render: () => <StylesPanel />, minWidth: 180, minHeight: 120 },
  online: { title: "Online", render: () => <OnlinePanel />, minWidth: 220, minHeight: 160 },
};

export default function PhotoWorkspace() {
  const projectId = usePhoto((s) => s.projectId);
  const loaded = usePhoto((s) => s.history !== null);
  const loadError = usePhoto((s) => s.loadError);
  usePhotoKeys(loaded);
  useCover(loaded);

  if (!projectId || !loaded) {
    return <PlainWorkspace>{loadError ? <WorkspaceError noun="photo" error={loadError} /> : <WorkspaceLoading />}</PlainWorkspace>;
  }
  // Every colour picker shown in the photo editor samples the canvas, as Photoshop's Color Picker does.
  return (
    <ColorSamplerContext.Provider value={photoColourSampler}>
      <div key={projectId} className="relative flex min-h-0 flex-1 flex-col" data-suite="photo">
        <PhotoHeader />
        <PhotoMenus window={<DockMenuItems dock={usePhotoDock} panels={PANELS} />} />
        <div className="flex min-h-0 flex-1">
          <ImageDrop>
            <ToolStrip />
            <DockArea dock={usePhotoDock} panels={PANELS} />
          </ImageDrop>
          <AssistantPanel suite="photo" />
        </div>
        <PhotoDesktop />
        <PaintChoiceDialog />
        <FeatherDialog />
        <ModelDialog />
      </div>
    </ColorSamplerContext.Provider>
  );
}

/**
 * Images dragged in from Finder (or anywhere) become layers on top, as Photoshop places a file dragged into a
 * document: centred where they're dropped on the canvas (elsewhere, on its middle), fitted in it, and selected.
 * A result dragged from the Online panel is placed the same way.
 */
function ImageDrop({ children }: { children: ReactNode }) {
  const { active, handlers } = useFileDrop((files, e) => {
    const images = files.filter(isImage);
    if (images.length === 0) {
      toast.error(files.length === 1 ? `${files[0].name} isn't an image` : "Those aren't images", { description: "PNG, JPEG and WebP files can be placed." });
      return;
    }
    const at = canvasPointAt(e.clientX, e.clientY) ?? undefined;
    void usePhoto
      .getState()
      .placeFiles(images, { at })
      .then((ids) => ids.length && usePhotoUi.getState().setSelection(ids));
  });
  const online = {
    onDragOver(e: DragEvent) {
      if (!isOnlineDrag(e.dataTransfer)) return handlers.onDragOver(e);
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop(e: DragEvent) {
      if (!isOnlineDrag(e.dataTransfer)) return handlers.onDrop(e);
      e.preventDefault();
      const result = getOnlineDragData(e.dataTransfer);
      if (result) void placeOnline(result, { at: canvasPointAt(e.clientX, e.clientY) ?? undefined });
    },
  };
  return (
    <div className="relative flex min-w-0 flex-1" {...handlers} {...online} data-image-drop={active || undefined}>
      {children}
      {active && (
        <div className="pointer-events-none absolute inset-1 z-40 grid place-items-center rounded-md border-2 border-dashed border-brand bg-brand/8">
          <span className="floating flex items-center gap-2 rounded-md bg-surface-1 px-3 py-2 text-sm font-medium">
            <PiImage className="size-4.5 text-brand" /> Drop to place as layers
          </span>
        </div>
      )}
    </div>
  );
}

function PhotoDesktop() {
  const exportOpen = usePhotoUi((s) => s.exportOpen);
  const filterGalleryOpen = usePhotoUi((s) => s.filterGalleryOpen);
  const layerStyle = usePhotoUi((s) => s.layerStyle);
  const cameraRaw = usePhotoUi((s) => s.cameraRaw);
  const hueSaturation = usePhotoUi((s) => s.hueSaturation);
  const scaleEffects = usePhotoUi((s) => s.scaleEffects);
  return (
    <Desktop windows={usePhotoWindows} name="photo" label="Photo windows" overlay className="absolute inset-0 z-50">
      <FloatingPanels dock={usePhotoDock} panels={PANELS} windowId={panelWindow} />
      {exportOpen && <PhotoExportWindow />}
      {filterGalleryOpen && <FilterGalleryWindow />}
      {layerStyle && <LayerStyleWindow key={layerStyle.layerId} layerId={layerStyle.layerId} page={layerStyle.page} />}
      {cameraRaw && <CameraRawWindow key={`${cameraRaw.layerId}:${cameraRaw.filterId}`} target={cameraRaw} />}
      {hueSaturation && <HueSaturationWindow key={`${hueSaturation.layerId}:${hueSaturation.filterId}`} target={hueSaturation} />}
      {scaleEffects && <ScaleEffectsWindow key={scaleEffects.join()} layerIds={scaleEffects} />}
    </Desktop>
  );
}

function PhotoHeader() {
  const name = usePhoto((s) => s.history!.doc.doc.name);
  const canUndo = usePhoto((s) => (s.history?.past.length ?? 0) > 0);
  const canRedo = usePhoto((s) => (s.history?.future.length ?? 0) > 0);
  const tool = useActiveTool();
  const snap = usePhotoPreferences((s) => s.snap);
  return (
    <header data-titlebar="header" className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-3" data-photo-header>
      <ProjectName name={name} onRename={(n) => usePhoto.getState().rename(n)} />
      <SaveState />
      {/* The tool's options take the room there is, scrolling sideways rather than squeezing the rest. */}
      <div className="flex min-w-0 flex-[1_1_0%] items-center gap-2 overflow-x-auto [scrollbar-width:none]" data-tool-options-strip>
        <ToolOptions />
        {tool === "move" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Snap"
                aria-pressed={snap}
                className={cn(snap && "bg-accent text-foreground")}
                onClick={() => usePhotoPreferences.getState().setSnap(!snap)}
              >
                <PiMagnet />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Snap to the canvas and layers (⇧⌘;). Hold Control while dragging to not snap.</TooltipContent>
          </Tooltip>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={fitToCanvas}>
        Fit
      </Button>
      <Button size="sm" variant="outline" onClick={actualPixels}>
        100%
      </Button>
      <HeaderActions
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => usePhoto.getState().undo()}
        onRedo={() => usePhoto.getState().redo()}
        exportAction={{ onClick: () => usePhotoUi.getState().setExportOpen(true) }}
      />
    </header>
  );
}

/** A save quicker than this never says "Saving…" (autosave runs after every edit: the word would flicker). */
const SAVING_SHOWN_AFTER_MS = 500;

/**
 * Whether the photo is saved, in a box of its own width so the header never moves: "Saving…" only once a save has
 * taken a moment.
 */
function SaveState() {
  const saving = usePhoto((s) => s.saving);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!saving) return setSlow(false);
    const timer = setTimeout(() => setSlow(true), SAVING_SHOWN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [saving]);
  return (
    <span className="w-14 shrink-0 text-xs text-muted-foreground" data-save-state={saving ? "saving" : "saved"}>
      {slow ? "Saving…" : "Saved"}
    </span>
  );
}

/** Each tool's name, key and icon (a group's tools share their key: Shift + it steps through them). */
const TOOL_INFO: Record<PhotoTool, { label: string; key: string; Icon: typeof PiCursor }> = {
  move: { label: "Move", key: "V", Icon: PiCursor },
  marquee: { label: "Rectangular Marquee", key: "M", Icon: PiSelection },
  ellipse: { label: "Elliptical Marquee", key: "M", Icon: PiCircleDashed },
  lasso: { label: "Lasso", key: "L", Icon: PiLasso },
  polygonLasso: { label: "Polygonal Lasso", key: "L", Icon: PiPolygon },
  objectSelect: { label: "Object Selection", key: "W", Icon: PiSelectionForeground },
  quickSelect: { label: "Quick Selection", key: "W", Icon: PiPaintBrushBroad },
  magicWand: { label: "Magic Wand", key: "W", Icon: PiMagicWand },
  crop: { label: "Crop", key: "C", Icon: PiCrop },
  eyedropper: { label: "Eyedropper", key: "I", Icon: PiEyedropper },
  brush: { label: "Brush", key: "B", Icon: PiPaintBrush },
  eraser: { label: "Eraser", key: "E", Icon: PiEraser },
  backgroundEraser: { label: "Background Eraser", key: "E", Icon: PiEraserFill },
  magicEraser: { label: "Magic Eraser", key: "E", Icon: PiSparkle },
  gradient: { label: "Gradient", key: "G", Icon: PiGradient },
  paintBucket: { label: "Paint Bucket", key: "G", Icon: PiPaintBucket },
  dodge: { label: "Dodge", key: "O", Icon: PiSunDim },
  burn: { label: "Burn", key: "O", Icon: PiFlame },
  sponge: { label: "Sponge", key: "O", Icon: PiDropHalf },
  type: { label: "Type", key: "T", Icon: PiTextT },
  rectangleShape: { label: "Rectangle", key: "U", Icon: PiRectangle },
  ellipseShape: { label: "Ellipse", key: "U", Icon: PiCircle },
  lineShape: { label: "Line", key: "U", Icon: PiLineSegment },
  arrowShape: { label: "Arrow", key: "U", Icon: PiArrowUpRight },
  hand: { label: "Hand", key: "H", Icon: PiHand },
  zoom: { label: "Zoom", key: "Z", Icon: PiMagnifyingGlass },
};

/** The strip's places, top to bottom: a tool, or a group (showing the one of it used last). */
const STRIP: (PhotoTool | ToolGroup)[] = ["move", "marquee", "lasso", "wand", "crop", "eyedropper", "brush", "eraser", "fill", "toning", "type", "shape", "hand", "zoom"];

/** "marquee" in the strip is the Marquees' group. */
const isGroup = (place: PhotoTool | ToolGroup): place is ToolGroup => Object.hasOwn(TOOL_GROUPS, place);

function ToolStrip() {
  const active = useActiveTool();
  const groupTools = usePhotoUi((s) => s.groupTools);
  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-1 py-2" aria-label="Tools">
      {STRIP.map((place) => {
        const group = isGroup(place) ? place : null;
        const tool = group ? groupTools[group] : (place as PhotoTool);
        const { label, key, Icon } = TOOL_INFO[tool];
        const pressed = group ? TOOL_GROUPS[group].includes(active) : active === tool;
        const button = (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            className={cn("relative", pressed && "bg-accent text-foreground")}
            onClick={() => usePhotoUi.getState().setTool(tool)}
            data-tool-button={tool}
          >
            <Icon className="size-4.5" />
            {/* Photoshop's corner mark: more tools here (right-click). */}
            {group && <span className="absolute right-0.5 bottom-0.5 size-0 border-t-[3px] border-l-[3px] border-t-transparent border-l-transparent border-r-[3px] border-b-[3px] border-r-muted-foreground border-b-muted-foreground" />}
          </Button>
        );
        const tip = (
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="right">
              {label} ({group ? `${key}, Shift+${key} for the next` : key})
            </TooltipContent>
          </Tooltip>
        );
        if (!group) return <div key={place}>{tip}</div>;
        return (
          <ContextMenu key={place}>
            <ContextMenuTrigger asChild>
              <div>{tip}</div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-52" data-tool-group={group}>
              {TOOL_GROUPS[group].map((t) => {
                const info = TOOL_INFO[t];
                return (
                  <ContextMenuItem key={t} onSelect={() => usePhotoUi.getState().setTool(t)} data-tool-item={t}>
                    <info.Icon /> {info.label}
                    <ContextMenuShortcut>{info.key}</ContextMenuShortcut>
                  </ContextMenuItem>
                );
              })}
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      <div className="flex-1" />
      <ColourSwatches />
    </nav>
  );
}

/**
 * The colours every tool uses (Photoshop's swatches at the foot of its tool strip): the foreground over the
 * background, each opening the colour picker; the arrows swap them (X), the small pair makes them black and white (D).
 */
function ColourSwatches() {
  const foreground = useColours((s) => s.foreground);
  const background = useColours((s) => s.background);
  const edit = (which: "foreground" | "background") => ({ begin: () => {}, set: (hex: string) => useColours.getState().set({ [which]: hex }), end: () => {} });
  return (
    <div className="flex flex-col items-center gap-1 pb-1" data-colours>
      <div className="relative size-9">
        <ColorSwatchPicker value={background} label="Background colour" side="right" edit={edit("background")} className="absolute right-0 bottom-0 size-5.5" />
        <ColorSwatchPicker value={foreground} label="Foreground colour" side="right" edit={edit("foreground")} className="absolute top-0 left-0 size-5.5" />
      </div>
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Black and white (D)" className="relative size-4 rounded-sm" onClick={() => useColours.getState().reset()}>
              <span className="absolute top-0 left-0 size-2.5 rounded-[2px] border border-line bg-black" />
              <span className="absolute right-0 bottom-0 size-2.5 rounded-[2px] border border-line bg-white" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Black and white (D)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Swap colours (X)" className="grid size-4 place-items-center text-muted-foreground hover:text-foreground" onClick={() => useColours.getState().swap()}>
              <PiArrowsLeftRight className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Swap colours (X)</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Arrow nudges a moment apart are one undo step (ux.md, "Gestures"). */
let nudging: { gesture: ReturnType<typeof photoGesture>; timer: ReturnType<typeof setTimeout>; key: string } | null = null;

/** Moves the selected layers by (dx, dy), all of them together (a generator's handles too). */
function nudge(dx: number, dy: number) {
  const ids = selectedInOrder();
  const doc = usePhoto.getState().history?.doc.doc;
  if (!doc || !doc.layers.some((l) => l.kind !== "adjustment" && ids.includes(l.id))) return;
  const key = ids.join(" ");
  if (!nudging || nudging.key !== key) {
    if (nudging) {
      clearTimeout(nudging.timer);
      nudging.gesture.end();
    }
    const gesture = photoGesture();
    gesture.begin();
    nudging = { gesture, key, timer: setTimeout(() => {}, 0) };
  }
  clearTimeout(nudging.timer);
  nudging.gesture.apply((d) => moveLayersBy(d, ids, dx, dy));
  nudging.timer = setTimeout(() => {
    nudging?.gesture.end();
    nudging = null;
  }, 600);
}

/** The photo editor's keys while its workspace is shown. */
function usePhotoKeys(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || keptByWindow(e.target)) return;
      if (e.key === " " && !e.repeat) {
        e.preventDefault();
        usePhotoUi.getState().setSpaceHand(true);
        return;
      }
      // Free Transform's Enter and Escape: commit or put back every drag of the session.
      if (useFreeTransform.getState().session && (e.key === "Enter" || e.key === "Escape") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        return e.key === "Enter" ? freeTransform.commit() : freeTransform.cancel();
      }
      const action = resolvePhotoKey(e, mac);
      if (!action) return;
      e.preventDefault();
      const photo = usePhoto.getState();
      const ui = usePhotoUi.getState();
      switch (action.type) {
        case "tool":
          return ui.setTool(action.tool);
        case "toolGroup":
          return ui.pickGroup(action.group, action.cycle);
        case "inverse":
          return selectActions.inverse();
        case "feather":
          return currentSelection() ? useFeather.setState({ open: true }) : undefined;
        case "undo":
          return photo.undo();
        case "redo":
          return photo.redo();
        case "fit":
          return fitToCanvas();
        case "actual":
          return actualPixels();
        case "zoom":
          return zoomBy(action.factor);
        case "nudge":
          return nudge(action.dx, action.dy);
        // Delete clears the selection's pixels (Photoshop's); with no selection it deletes the layers.
        case "delete":
          if (currentSelection()) return void editActions.fill(null);
          return layerActions.delete();
        // ⌘J with a selection is Layer via Copy; without one it duplicates the layers.
        case "duplicate":
          if (currentSelection()) return void editActions.layerVia(false);
          return layerActions.duplicate();
        case "merge":
          return void layerActions.merge();
        case "shift":
          return layerActions.shift(action.direction);
        case "selectAll":
          return layerActions.selectAll();
        case "step":
          return layerActions.step(action.direction, action.add);
        case "edge":
          return layerActions.edge(action.to, action.add);
        case "export":
          return ui.setExportOpen(true);
        case "lastFilter":
          return void layerActions.repeatLastFilter();
        case "cameraRaw":
          return cameraRawActions.filter();
        case "hueSaturation":
          return hueSaturationActions.open();
        case "snap":
          return usePhotoPreferences.getState().setSnap(!usePhotoPreferences.getState().snap);
        case "save":
          void flushPhotos().then(() => toast.success("Saved"));
          return;
        // ⌘D lets go of the selection, as Photoshop's; with none, of the layers.
        case "deselect":
          return currentSelection() ? photo.select(null) : layerActions.deselect();
        case "selectCanvas":
          return selectActions.all();
        case "newLayer":
          return void layerActions.newLayer();
        // Quick Selection's brush is its own, and so is a kit's that has one (Dodge, Burn, Sponge, the Background Eraser).
        case "brushSize": {
          if (ui.tool === "quickSelect") return useSelectOptions.getState().set({ quickSize: stepBrushSize(useSelectOptions.getState().quickSize, action.direction) });
          const own = TOOLBOX[ui.tool]?.brush;
          if (own) return own.set({ size: stepBrushSize(own.get().size, action.direction) });
          return useBrush.getState().set({ size: stepBrushSize(useBrush.getState().size, action.direction) });
        }
        case "brushHardness": {
          const own = TOOLBOX[ui.tool]?.brush;
          if (own) return own.set({ hardness: Math.round((own.get().hardness + action.direction * 0.25) * 4) / 4 });
          return useBrush.getState().set({ hardness: Math.round((useBrush.getState().hardness + action.direction * 0.25) * 4) / 4 });
        }
        case "defaultColours":
          return useColours.getState().reset();
        case "swapColours":
          return useColours.getState().swap();
        case "blendMode":
          return layerActions.setBlendMode(action.mode);
        case "stepBlendMode":
          return layerActions.stepBlendMode(action.direction);
        case "copy":
          return void editActions.copy();
        case "cut":
          return void editActions.cut();
        case "layerViaCut":
          return void editActions.layerVia(true);
        case "fill":
          return void editActions.fill(useColours.getState()[action.colour]);
        case "contentAwareFill":
          return void runContentAwareFill();
        case "orient":
          return transformActions.layers(action.orientation);
        case "freeTransform":
          if (!freeTransform.start()) toast.message("Select a layer to transform.");
          return;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") usePhotoUi.getState().setSpaceHand(false);
    };
    const blur = () => usePhotoUi.getState().setSpaceHand(false);
    // ⌘V: images copied elsewhere are placed (Photoshop pastes them as layers); else what ⌘C or ⌘X put aside.
    const paste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || keptByWindow(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void usePhoto.getState().placeFiles(files).then((ids) => ids.length && usePhotoUi.getState().select(ids.at(-1)!));
      } else if (hasPhotoClipboard()) {
        e.preventDefault();
        void editActions.paste();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("paste", paste);
    };
  }, [active]);
}

/** Home's card shows the photo as it is: a small picture rendered after it's saved (a moment after the last edit). */
function useCover(active: boolean) {
  const savedAt = usePhoto((s) => s.savedAt);
  const [lastCover, setLastCover] = useState<unknown>(null);
  useEffect(() => {
    if (!active || savedAt === null) return;
    const timer = setTimeout(async () => {
      const { projectId, history } = usePhoto.getState();
      const pending = liveRenderer();
      if (!projectId || !history || !pending || history.doc.doc === lastCover) return;
      try {
        const renderer = await pending;
        await renderer.ready();
        const blob = await renderer.picture(history.doc.doc, 480);
        await api.saveCover(projectId, blob);
        setLastCover(history.doc.doc);
      } catch {
        // A cover is a nicety: the card keeps its last one.
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [active, savedAt, lastCover]);
}
