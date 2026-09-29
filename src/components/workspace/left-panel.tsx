import { useEffect, useRef, type DragEvent, type ReactNode } from "react";
import { PiBooks, PiFileArrowUp, PiFilmStrip, PiGlobe } from "react-icons/pi";
import { CaptionsPanel } from "@/components/captions/captions-panel";
import { LibraryPanel } from "@/components/library/library-panel";
import { MediaBin } from "@/components/media/media-bin";
import { importMedia } from "@/components/media/import-media";
import { OnlinePanel } from "@/components/media/online-panel";
import { PropertiesPanel } from "@/components/properties/properties-panel";
import { TransitionsPanel } from "@/components/transitions/transitions-panel";
import { useFileDrop } from "@/hooks/use-file-drop";
import { type DragKind, dragKind } from "@/lib/dnd";
import { readDrop } from "@/lib/dropped-files";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { type LeftPanelTab, type MediaSource, useLayout } from "@/stores/layout";
import { useLibrary, viewFolder } from "@/stores/library";

/**
 * The tabs, in order. To add one: add its id to `LeftPanelTab`, then an entry here.
 * `springFor`: drags that open the tab when held over it (to drop inside it).
 */
const TABS: { id: LeftPanelTab; label: string; springFor?: DragKind[] }[] = [
  { id: "media", label: "Media", springFor: ["files"] },
  { id: "transitions", label: "Transitions" },
  { id: "captions", label: "Captions" },
  { id: "properties", label: "Properties" },
];

/** The Media tab's sources, switched at its top. */
const SOURCES: { id: MediaSource; label: string; icon: ReactNode; badge?: () => ReactNode; springFor?: DragKind[] }[] = [
  { id: "project", label: "This video", icon: <PiFilmStrip />, badge: () => <MediaCount />, springFor: ["files"] },
  { id: "library", label: "Library", icon: <PiBooks />, springFor: ["files", "assets"] },
  { id: "online", label: "Online", icon: <PiGlobe /> },
];

/** Hold a drag over a tab this long to open it. */
const SPRING_MS = 450;

/**
 * The left panel: media (the project's, the Library shared by every project, or online),
 * transitions, captions, and the selection's properties (Premiere's Effect Controls).
 * Files dropped anywhere on it are imported: into the Library when it's showing (into
 * the folder under the pointer, keeping dropped folders), otherwise into the project.
 */
export function LeftPanel() {
  const tab = useLayout((s) => s.leftPanel);
  const source = useLayout((s) => s.mediaSource);
  const setTab = useLayout((s) => s.setLeftPanel);
  const showMedia = useLayout((s) => s.showMedia);
  const inLibrary = tab === "media" && source === "library";
  // A clip's properties with their keyframe lanes need the room (Premiere's Effect Controls timeline).
  const lanes = useLayout((s) => s.keyframesOpen);
  const clipShown = useEditor((s) => s.selectedClipIds.length > 0 && !s.selectedTransition);
  const wide = tab === "properties" && lanes && clipShown;
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
      className={cn("relative flex shrink-0 flex-col border-r bg-background", wide ? "w-[43rem]" : "w-86")}
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
        <div
          role="tablist"
          aria-label="Media sources"
          className="mx-3 mt-3 grid shrink-0 grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5"
        >
          {SOURCES.map((s) => (
            <SourceButton key={s.id} active={source === s.id} springFor={s.springFor} onClick={() => showMedia(s.id)}>
              {s.icon}
              {s.label}
              {s.badge?.()}
            </SourceButton>
          ))}
        </div>
      )}
      {tab === "media" && source === "project" && <MediaBin />}
      {tab === "media" && source === "library" && <LibraryPanel />}
      {/* Always mounted: it keeps its search results and preview player while hidden. */}
      <OnlinePanel active={tab === "media" && source === "online"} />
      {tab === "transitions" && <TransitionsPanel />}
      {tab === "captions" && <CaptionsPanel />}
      {tab === "properties" && <PropertiesPanel />}

      {drop.active && (
        <div className="pointer-events-none absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand bg-brand/10 text-brand backdrop-blur-[2px]">
          <PiFileArrowUp className="size-6" />
          <span className="text-sm font-medium">{inLibrary ? "Drop to add to the Library" : "Drop to import"}</span>
        </div>
      )}
    </aside>
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

/** One segment of the Media tab's source switch. */
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
