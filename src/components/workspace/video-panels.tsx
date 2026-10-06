import { type DragEvent, useEffect, useMemo, useRef, type ReactNode } from "react";
import { PiBooks, PiFileArrowUp, PiFilmStrip, PiIntersect, PiMagicWand, PiSparkle } from "react-icons/pi";
import { CaptionsPanel } from "@/components/captions/captions-panel";
import type { DockPanel } from "@/components/dock/dock-area";
import { PresetsPanel } from "@/components/effects/presets-panel";
import { TransitionsPanel } from "@/components/effects/transitions-panel";
import { VideoEffectsPanel } from "@/components/effects/video-effects-panel";
import { LibraryPanel } from "@/components/library/library-panel";
import { importMedia } from "@/components/media/import-media";
import { MediaBin } from "@/components/media/media-bin";
import { OnlinePanel } from "@/components/media/online-panel";
import { Preview } from "@/components/preview/preview";
import { PropertiesDrop } from "@/components/properties/properties-drop";
import { PropertiesPanel } from "@/components/properties/properties-panel";
import { PANEL_MIN_HEIGHT } from "@/components/timeline/constants";
import { SequenceTabs } from "@/components/timeline/sequence-tabs";
import { Timeline } from "@/components/timeline/timeline";
import { useFileDrop } from "@/hooks/use-file-drop";
import { type DragKind, dragKind } from "@/lib/dnd";
import { readDrop } from "@/lib/dropped-files";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { type EffectKind, type MediaSource, useLayout } from "@/stores/layout";
import { useLibrary, viewFolder } from "@/stores/library";
import { type VideoPanel, showEffects, showMedia } from "@/stores/video-dock";

/** The Media panel's sources, switched at its top. */
const SOURCES: { id: MediaSource; label: string; icon: ReactNode; badge?: () => ReactNode; springFor?: DragKind[] }[] = [
  { id: "project", label: "This video", icon: <PiFilmStrip />, badge: () => <MediaCount />, springFor: ["files"] },
  { id: "library", label: "Library", icon: <PiBooks />, springFor: ["files", "assets"] },
];

/** The Effects panel's kinds, switched at its top (hidden while there's only one). */
const KINDS: { id: EffectKind; label: string; icon: ReactNode }[] = [
  { id: "video", label: "Video effects", icon: <PiSparkle /> },
  { id: "presets", label: "Presets", icon: <PiMagicWand /> },
  { id: "transitions", label: "Transitions", icon: <PiIntersect /> },
];

const springsFor = (kinds: DragKind[]) => (e: DragEvent) => {
  const kind = dragKind(e.dataTransfer);
  return kind !== null && kinds.includes(kind);
};

/**
 * The video editor's panels, as the dock shows them (`stores/video-dock.ts` lays them out). To add one:
 * its id in `VideoPanel` and `VIDEO_PANELS`, then an entry here.
 */
export const VIDEO_PANEL_DEFS: Record<VideoPanel, DockPanel> = {
  media: { title: "Media", render: (shown) => <MediaPanel shown={shown} />, keepMounted: true, minWidth: 280, minHeight: 200, springs: springsFor(["files"]) },
  // YouTube's search and links from other sites. Kept mounted behind other tabs: it keeps its search and its preview player.
  online: { title: "Online", render: (shown) => <OnlinePanel active={shown} />, keepMounted: true, minWidth: 280, minHeight: 200 },
  // Premiere's Effects panel: video effects, presets and transitions.
  effects: { title: "Effects", render: () => <EffectsPanel />, minWidth: 280, minHeight: 200 },
  captions: { title: "Captions", render: () => <CaptionsPanel />, minWidth: 280, minHeight: 200 },
  // The selection's properties (Premiere's Effect Controls); effects and presets dropped on it go on its clips.
  properties: {
    title: "Properties",
    render: () => (
      <PropertiesDrop>
        <PropertiesPanel />
      </PropertiesDrop>
    ),
    minWidth: 280,
    minHeight: 200,
  },
  // As wide as its transport bar (the time, the buttons, the resolution and the tools).
  program: { title: "Program", render: () => <Preview />, minWidth: 480, minHeight: 240 },
  // Its sequence tabs (once a nested one is open) in its tab strip, beside its own tab.
  timeline: { title: "Timeline", render: () => <Timeline />, header: () => <SequenceTabs />, minWidth: 360, minHeight: PANEL_MIN_HEIGHT },
};

/**
 * Minimums that change with what's showing: a clip's properties with their keyframe lanes need room
 * beside the values (Premiere's Effect Controls timeline), so their panel widens while they show.
 */
export function useVideoPanelMins(): Partial<Record<VideoPanel, { width: number }>> {
  const lanes = useLayout((s) => s.keyframesOpen);
  const clipShown = useEditor((s) => s.selectedClipIds.length > 0 && !s.selectedTransition);
  const wide = lanes && clipShown;
  return useMemo(() => (wide ? { properties: { width: 520 } } : {}), [wide]);
}

/**
 * Media: the project's, or the Library shared by every project. Files dropped on it are
 * imported: into the Library when it's showing (into the folder under the pointer, keeping dropped
 * folders), otherwise into the project.
 */
function MediaPanel({ shown }: { shown: boolean }) {
  const source = useLayout((s) => s.mediaSource);
  const inLibrary = source === "library";
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
    <div className="relative flex min-h-0 flex-1 flex-col" {...drop.handlers}>
      {shown && (
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
      {shown && source === "project" && <MediaBin />}
      {shown && source === "library" && <LibraryPanel />}
      {drop.active && (
        <div className="pointer-events-none absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand bg-brand/10 text-brand backdrop-blur-[2px]">
          <PiFileArrowUp className="size-6" />
          <span className="text-sm font-medium">{inLibrary ? "Drop to add to the Library" : "Drop to import"}</span>
        </div>
      )}
    </div>
  );
}

/** Effects: video effects (added to clips), presets, transitions (put on cuts). */
function EffectsPanel() {
  const kind = useLayout((s) => s.effectKind);
  return (
    <>
      {KINDS.length > 1 && (
        <SegmentedSwitch label="Effect kinds" count={KINDS.length}>
          {KINDS.map((k) => (
            <SourceButton key={k.id} active={kind === k.id} onClick={() => showEffects(k.id)}>
              {k.icon}
              {k.label}
            </SourceButton>
          ))}
        </SegmentedSwitch>
      )}
      {kind === "video" && <VideoEffectsPanel />}
      {kind === "presets" && <PresetsPanel />}
      {kind === "transitions" && <TransitionsPanel />}
    </>
  );
}

function MediaCount() {
  const count = useEditor((s) => s.assets.length);
  if (count === 0) return null;
  return <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>;
}

/** The switch at the top of a panel with several sources or kinds, one equal segment each. */
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

interface SourceButtonProps {
  active: boolean;
  onClick: () => void;
  springFor?: DragKind[];
  children: ReactNode;
}

/** One segment of a `SegmentedSwitch`. */
function SourceButton({ active, onClick, springFor, children }: SourceButtonProps) {
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
        active ? "bg-background text-foreground shadow-xs dark:bg-accent" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Hold a drag over a segment this long to open it. */
const SPRING_MS = 450;

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
