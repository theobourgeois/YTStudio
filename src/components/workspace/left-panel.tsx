import { useEffect, useRef, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { PiBooks, PiFileArrowUp, PiFilmStrip, PiGlobe, PiIntersect, PiMagicWand, PiSparkle } from "react-icons/pi";
import { CaptionsPanel } from "@/components/captions/captions-panel";
import { LibraryPanel } from "@/components/library/library-panel";
import { MediaBin } from "@/components/media/media-bin";
import { importMedia } from "@/components/media/import-media";
import { OnlinePanel } from "@/components/media/online-panel";
import { PropertiesPanel } from "@/components/properties/properties-panel";
import { PresetsPanel } from "@/components/effects/presets-panel";
import { TransitionsPanel } from "@/components/effects/transitions-panel";
import { VideoEffectsPanel } from "@/components/effects/video-effects-panel";
import { useFileDrop } from "@/hooks/use-file-drop";
import { type DragKind, dragKind } from "@/lib/dnd";
import { startPointerDrag } from "@/lib/pointer-drag";
import { readDrop } from "@/lib/dropped-files";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import {
  DEFAULT_PANEL_WIDTHS,
  type EffectKind,
  type LeftPanelTab,
  type MediaSource,
  MIN_PANEL_WIDTHS,
  type PanelWidthMode,
  useLayout,
} from "@/stores/layout";
import { useLibrary, viewFolder } from "@/stores/library";
import { useAssistant } from "@/stores/assistant";

/**
 * The tabs, in order. To add one: add its id to `LeftPanelTab`, then an entry here.
 * `springFor`: drags that open the tab when held over it (to drop inside it).
 */
const TABS: { id: LeftPanelTab; label: string; springFor?: DragKind[] }[] = [
  { id: "media", label: "Media", springFor: ["files"] },
  { id: "effects", label: "Effects" },
  { id: "captions", label: "Captions" },
  { id: "properties", label: "Properties" },
];

/** The Media tab's sources, switched at its top. */
const SOURCES: { id: MediaSource; label: string; icon: ReactNode; badge?: () => ReactNode; springFor?: DragKind[] }[] = [
  { id: "project", label: "This video", icon: <PiFilmStrip />, badge: () => <MediaCount />, springFor: ["files"] },
  { id: "library", label: "Library", icon: <PiBooks />, springFor: ["files", "assets"] },
  { id: "online", label: "Online", icon: <PiGlobe /> },
];

/** The Effects tab's kinds, switched at its top (hidden while there's only one). */
const KINDS: { id: EffectKind; label: string; icon: ReactNode }[] = [
  { id: "video", label: "Video effects", icon: <PiSparkle /> },
  { id: "presets", label: "Presets", icon: <PiMagicWand /> },
  { id: "transitions", label: "Transitions", icon: <PiIntersect /> },
];

/** Hold a drag over a tab this long to open it. */
const SPRING_MS = 450;

/**
 * The left panel: media (the project's, the Library shared by every project, or online),
 * effects (Premiere's Effects panel: video effects and transitions), captions, and the selection's properties (Premiere's Effect Controls).
 * Files dropped anywhere on it are imported: into the Library when it's showing (into
 * the folder under the pointer, keeping dropped folders), otherwise into the project.
 */
export function LeftPanel() {
  const tab = useLayout((s) => s.leftPanel);
  const source = useLayout((s) => s.mediaSource);
  const kind = useLayout((s) => s.effectKind);
  const showEffects = useLayout((s) => s.showEffects);
  const setTab = useLayout((s) => s.setLeftPanel);
  const showMedia = useLayout((s) => s.showMedia);
  const inLibrary = tab === "media" && source === "library";
  // A clip's properties with their keyframe lanes need the room (Premiere's Effect Controls timeline).
  const lanes = useLayout((s) => s.keyframesOpen);
  const clipShown = useEditor((s) => s.selectedClipIds.length > 0 && !s.selectedTransition);
  const mode: PanelWidthMode = tab === "properties" && lanes && clipShown ? "lanes" : "normal";
  const width = useLayout((s) => s.panelWidths[mode]);
  const assistantWidth = useAssistant((s) => (s.open ? s.width : 0));
  const drop = useFileDrop((files, e) => {
    if (inLibrary) {
      const target = (e.target as Element).closest<HTMLElement>("[data-library-folder]");
      const folderId = target ? target.dataset.libraryFolder || null : viewFolder(useLibrary.getState().view);
      void readDrop(e.dataTransfer).then((tree) => useLibrary.getState().importTree(tree, folderId));
      return;
    }
    showMedia("project");
    importMedia(files);
  });
  // Loaded up front so "Add to Library" menus know the folders.
  useEffect(() => void useLibrary.getState().load(), []);

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r bg-background"
      // The preview keeps some room however wide it's dragged.
      style={{ width: `min(${width}px, max(${MIN_PANEL_WIDTHS[mode]}px, 100vw - 30rem - ${assistantWidth}px))` }}
      aria-label="Media"
      {...drop.handlers}
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b pr-2 pl-1.5">
        <div role="tablist" aria-label="Panels" className="flex items-center">
          {TABS.map((t) => (
            <TabButton key={t.id} active={tab === t.id} springFor={t.springFor} onClick={() => setTab(t.id)}>
              {t.label}
            </TabButton>
          ))}
        </div>
      </div>

      {tab === "media" && (
        <SegmentedSwitch label="Media sources" count={SOURCES.length}>
          {SOURCES.map((s) => (
            <SourceButton key={s.id} active={source === s.id} springFor={s.springFor} onClick={() => showMedia(s.id)}>
              {s.icon}
              {s.label}
              {s.badge?.()}
            </SourceButton>
          ))}
        </SegmentedSwitch>
      )}
      {tab === "media" && source === "project" && <MediaBin />}
      {tab === "media" && source === "library" && <LibraryPanel />}
      {/* Always mounted: it keeps its search results and preview player while hidden. */}
      <OnlinePanel active={tab === "media" && source === "online"} />
      {tab === "effects" && KINDS.length > 1 && (
        <SegmentedSwitch label="Effect kinds" count={KINDS.length}>
          {KINDS.map((k) => (
            <SourceButton key={k.id} active={kind === k.id} onClick={() => showEffects(k.id)}>
              {k.icon}
              {k.label}
            </SourceButton>
          ))}
        </SegmentedSwitch>
      )}
      {tab === "effects" && kind === "video" && <VideoEffectsPanel />}
      {tab === "effects" && kind === "presets" && <PresetsPanel />}
      {tab === "effects" && kind === "transitions" && <TransitionsPanel />}
      {tab === "captions" && <CaptionsPanel />}
      {tab === "properties" && <PropertiesPanel />}

      <ResizeHandle mode={mode} />

      {drop.active && (
        <div className="pointer-events-none absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand bg-brand/10 text-brand backdrop-blur-[2px]">
          <PiFileArrowUp className="size-6" />
          <span className="text-sm font-medium">{inLibrary ? "Drop to add to the Library" : "Drop to import"}</span>
        </div>
      )}
    </aside>
  );
}

/** The panel's right edge: drag it to resize the panel, double-click it to go back to the usual width. */
function ResizeHandle({ mode }: { mode: PanelWidthMode }) {
  const width = useLayout((s) => s.panelWidths[mode]);
  const setWidth = useLayout((s) => s.setPanelWidth);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const panel = e.currentTarget.parentElement!;
    // From what's showing (the window may have squeezed it below the stored width).
    const start = panel.getBoundingClientRect().width;
    const x0 = e.clientX;
    let last = start;
    // No mouse events follow: Chromium would otherwise start a native drag of whatever card the
    // panel grows under the pressed point (it looks for one there, not under the pointer).
    e.preventDefault();
    startPointerDrag(e, {
      threshold: 0,
      cursor: "col-resize",
      onMove: (ev) => {
        last = start + ev.clientX - x0;
        setWidth(mode, last);
      },
      onEnd: () => setWidth(mode, last, true),
      onCancel: () => setWidth(mode, width),
    });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") setWidth(mode, width - step, true);
    else if (e.key === "ArrowRight") setWidth(mode, width + step, true);
    else return;
    e.preventDefault();
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(mode, DEFAULT_PANEL_WIDTHS[mode], true)}
      onKeyDown={onKeyDown}
      className={cn(
        "group absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize touch-none outline-none",
        // A line on the border while hovered, dragged or focused.
        "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-brand after:opacity-0 after:transition-opacity",
        "hover:after:opacity-100 focus-visible:after:opacity-100 active:after:opacity-100",
      )}
    />
  );
}

function MediaCount() {
  const count = useEditor((s) => s.assets.length);
  if (count === 0) return null;
  return <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>;
}

interface SwitchButtonProps {
  active: boolean;
  onClick: () => void;
  springFor?: DragKind[];
  children: ReactNode;
}

function TabButton({ active, onClick, springFor, children }: SwitchButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      {...useSpring(active, onClick, springFor)}
      className={cn(
        "flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** The switch at the top of a tab with several sources or kinds, one equal segment each. */
function SegmentedSwitch({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mx-3 mt-3 grid shrink-0 gap-0.5 rounded-md bg-muted p-0.5"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

/** One segment of a `SegmentedSwitch`. */
function SourceButton({ active, onClick, springFor, children }: SwitchButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      {...useSpring(active, onClick, springFor)}
      className={cn(
        "flex h-6 min-w-0 items-center justify-center gap-1.5 rounded-[5px] px-1.5 text-xs whitespace-nowrap transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        active
          ? "bg-background text-foreground shadow-xs dark:bg-accent"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Drag handlers that call `open` when one of `springFor` is held over the element (Finder's spring-loaded folders). */
function useSpring(active: boolean, open: () => void, springFor?: DragKind[]) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const cancel = () => clearTimeout(timer.current);
  return {
    onDragEnter(e: DragEvent) {
      const kind = dragKind(e.dataTransfer);
      if (active || !kind || !springFor?.includes(kind)) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(open, SPRING_MS);
    },
    onDragLeave: cancel,
    onDrop: cancel,
  };
}
