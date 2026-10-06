/**
 * The photo suite's main column (`clientSuite("photo").Workspace`, ux.md "Workspace"): its header (name, undo,
 * the tool's options, export, the assistant), the tool strip, the docked panels (the canvas, Layers, Properties:
 * Photoshop's are docked too), and its windows. Its keys are `keys.ts`'s.
 */
import { useEffect, useState } from "react";
import { cn } from "cn";
import { PiArrowCounterClockwise, PiArrowClockwise, PiArrowsLeftRight, PiCursor, PiEraser, PiExport, PiHand, PiMagnet, PiMagnifyingGlass, PiPaintBrush, PiSelection } from "react-icons/pi";
import { toast } from "sonner";
import { moveLayersBy } from "@shared/photo/edits";
import { allSelection } from "@shared/photo/selection";
import { ColorSwatchPicker } from "@/components/color-picker";
import { stepBrushSize, useBrush } from "./brush-options";
import { useColours } from "./colours";
import { editActions, hasPhotoClipboard } from "./edit-actions";
import { PaintChoiceDialog, ToolOptions } from "./options-bar";
import { AssistantButton } from "@/components/assistant/assistant-button";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { DockArea, FloatingPanels, type DockPanel } from "@/components/dock/dock-area";
import type { DockLayout } from "@/components/dock/model";
import { createDock } from "@/components/dock/store";
import { ProjectName } from "@/components/header/project-name";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Desktop, keptByWindow } from "@/components/windows/floating-window";
import { createWindows } from "@/components/windows/store";
import { PlainWorkspace, WorkspaceError, WorkspaceLoading } from "@/components/workspace/plain-workspace";
import { api } from "@/lib/api";
import { CanvasPanel, actualPixels, fitToCanvas, zoomBy } from "./canvas/canvas-panel";
import { PhotoExportWindow } from "./export-window";
import { resolvePhotoKey } from "./keys";
import { layerActions, selectedInOrder } from "./layer-actions";
import { liveRenderer } from "./live";
import { LayersPanel } from "./panels/layers-panel";
import { usePhotoPreferences } from "./preferences";
import { PropertiesPanel } from "./panels/properties-panel";
import { currentDoc, currentSelection, flushPhotos, photoGesture, usePhoto } from "./store";
import { type PhotoTool, useActiveTool, usePhotoUi } from "./ui";

type PhotoPanel = "canvas" | "layers" | "properties";
type PhotoWindowId = "export" | `panel:${string}`;

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
          { type: "group", id: "properties", panels: ["properties"], active: "properties" },
        ],
      },
    ],
  },
  floating: [],
});

const usePhotoDock = createDock<PhotoPanel, PhotoWindowId>({
  key: "editor-photo-layout",
  panels: ["canvas", "layers", "properties"],
  initial: defaultLayout,
  windows: usePhotoWindows,
  windowId: panelWindow,
});

const PANELS: Record<PhotoPanel, DockPanel> = {
  canvas: { title: "Canvas", render: () => <CanvasPanel />, keepMounted: true, minWidth: 320, minHeight: 240 },
  layers: { title: "Layers", render: () => <LayersPanel />, minWidth: 220, minHeight: 140 },
  properties: { title: "Properties", render: () => <PropertiesPanel />, minWidth: 220, minHeight: 160 },
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
  return (
    <div key={projectId} className="relative flex min-h-0 flex-1 flex-col" data-suite="photo">
      <PhotoHeader />
      <div className="flex min-h-0 flex-1">
        <ToolStrip />
        <DockArea dock={usePhotoDock} panels={PANELS} />
        <AssistantPanel suite="photo" />
      </div>
      <PhotoDesktop />
      <PaintChoiceDialog />
    </div>
  );
}

function PhotoDesktop() {
  const exportOpen = usePhotoUi((s) => s.exportOpen);
  return (
    <Desktop windows={usePhotoWindows} name="photo" label="Photo windows" overlay className="absolute inset-0 z-50">
      <FloatingPanels dock={usePhotoDock} panels={PANELS} windowId={panelWindow} />
      {exportOpen && <PhotoExportWindow />}
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
      <div className="mx-2 flex items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!canUndo} onClick={() => usePhoto.getState().undo()}>
          <PiArrowCounterClockwise />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!canRedo} onClick={() => usePhoto.getState().redo()}>
          <PiArrowClockwise />
        </Button>
      </div>
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
      <div className="flex-1" />
      <Button size="sm" variant="outline" onClick={fitToCanvas}>
        Fit
      </Button>
      <Button size="sm" variant="outline" onClick={actualPixels}>
        100%
      </Button>
      <Button size="sm" onClick={() => usePhotoUi.getState().setExportOpen(true)}>
        <PiExport /> Export
      </Button>
      <AssistantButton />
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

const TOOLS: { tool: PhotoTool; label: string; key: string; Icon: typeof PiCursor }[] = [
  { tool: "move", label: "Move", key: "V", Icon: PiCursor },
  { tool: "marquee", label: "Rectangular Marquee", key: "M", Icon: PiSelection },
  { tool: "brush", label: "Brush", key: "B", Icon: PiPaintBrush },
  { tool: "eraser", label: "Eraser", key: "E", Icon: PiEraser },
  { tool: "hand", label: "Hand", key: "H", Icon: PiHand },
  { tool: "zoom", label: "Zoom", key: "Z", Icon: PiMagnifyingGlass },
];

function ToolStrip() {
  const active = useActiveTool();
  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-1 py-2" aria-label="Tools">
      {TOOLS.map(({ tool, label, key, Icon }) => (
        <Tooltip key={tool}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              aria-pressed={active === tool}
              className={cn(active === tool && "bg-accent text-foreground")}
              onClick={() => usePhotoUi.getState().setTool(tool)}
            >
              <Icon className="size-4.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {label} ({key})
          </TooltipContent>
        </Tooltip>
      ))}
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

/** Moves the selected images by (dx, dy), all of them together. */
function nudge(dx: number, dy: number) {
  const ids = selectedInOrder();
  const doc = usePhoto.getState().history?.doc.doc;
  if (!doc || !doc.layers.some((l) => l.kind === "image" && ids.includes(l.id))) return;
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
      const action = resolvePhotoKey(e, mac);
      if (!action) return;
      e.preventDefault();
      const photo = usePhoto.getState();
      const ui = usePhotoUi.getState();
      switch (action.type) {
        case "tool":
          return ui.setTool(action.tool);
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
          if (currentSelection() && ui.selectedLayerId) return void editActions.fill(null);
          return layerActions.delete();
        // ⌘J with a selection is Layer via Copy; without one it duplicates the layers.
        case "duplicate":
          if (currentSelection() && ui.selectedLayerId) return void editActions.layerVia(false);
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
        case "snap":
          return usePhotoPreferences.getState().setSnap(!usePhotoPreferences.getState().snap);
        case "save":
          void flushPhotos().then(() => toast.success("Saved"));
          return;
        // ⌘D lets go of the selection, as Photoshop's; with none, of the layers.
        case "deselect":
          return currentSelection() ? photo.select(null) : layerActions.deselect();
        case "selectCanvas": {
          const doc = currentDoc();
          return doc && photo.select(allSelection(doc.canvas));
        }
        case "newLayer":
          return void layerActions.newLayer();
        case "brushSize":
          return useBrush.getState().set({ size: stepBrushSize(useBrush.getState().size, action.direction) });
        case "brushHardness":
          return useBrush.getState().set({ hardness: Math.round((useBrush.getState().hardness + action.direction * 0.25) * 4) / 4 });
        case "defaultColours":
          return useColours.getState().reset();
        case "swapColours":
          return useColours.getState().swap();
        case "copy":
          return void editActions.copy();
        case "cut":
          return void editActions.cut();
        case "layerViaCut":
          return void editActions.layerVia(true);
        case "fill":
          return void editActions.fill(useColours.getState()[action.colour]);
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
