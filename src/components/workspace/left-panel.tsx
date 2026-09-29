import { useEffect, useRef, type DragEvent, type ReactNode } from "react";
import { PiFileArrowUp } from "react-icons/pi";
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
import { type LeftPanelTab, useLayout } from "@/stores/layout";
import { useLibrary, viewFolder } from "@/stores/library";

/**
 * The tabs, in order. To add one: add its id to `LeftPanelTab`, then an entry here.
 * `springFor`: drags that open the tab when held over it (to drop inside it).
 */
const TABS: { id: LeftPanelTab; label: string; badge?: () => ReactNode; springFor?: DragKind[] }[] = [
  { id: "media", label: "Media", badge: () => <MediaCount />, springFor: ["files"] },
  { id: "library", label: "Library", springFor: ["files", "assets"] },
  { id: "online", label: "Online" },
  { id: "transitions", label: "Transitions" },
  { id: "captions", label: "Captions" },
  { id: "properties", label: "Properties" },
];

/** Hold a drag over a tab this long to open it. */
const SPRING_MS = 450;

/**
 * The left panel: the project's media, the Library shared by every project,
 * online media, transitions, captions, and the selection's properties (Premiere's
 * Effect Controls). Files dropped anywhere on it are imported: into the Library on its
 * tab (into the folder under the pointer, keeping dropped folders), otherwise
 * into the project.
 */
export function LeftPanel() {
  const tab = useLayout((s) => s.leftPanel);
  const setTab = useLayout((s) => s.setLeftPanel);
  // A clip's properties with their keyframe lanes need the room (Premiere's Effect Controls timeline).
  const lanes = useLayout((s) => s.keyframesOpen);
  const clipShown = useEditor((s) => s.selectedClipIds.length > 0 && !s.selectedTransition);
  const wide = tab === "properties" && lanes && clipShown;
  const drop = useFileDrop((files, e) => {
    if (tab === "library") {
      const target = (e.target as Element).closest<HTMLElement>("[data-library-folder]");
      const folderId = target ? target.dataset.libraryFolder || null : viewFolder(useLibrary.getState().view);
      void readDrop(e.dataTransfer).then((tree) => useLibrary.getState().importTree(tree, folderId));
      return;
    }
    setTab("media");
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
        <div role="tablist" aria-label="Media sources" className="flex items-center">
          {TABS.map((t) => (
            <TabButton key={t.id} active={tab === t.id} springFor={t.springFor} onClick={() => setTab(t.id)}>
              {t.label}
              {t.badge?.()}
            </TabButton>
          ))}
        </div>
      </div>

      {tab === "media" && <MediaBin />}
      {tab === "library" && <LibraryPanel />}
      {/* Always mounted: it keeps its search results and preview player while hidden. */}
      <OnlinePanel active={tab === "online"} />
      {tab === "transitions" && <TransitionsPanel />}
      {tab === "captions" && <CaptionsPanel />}
      {tab === "properties" && <PropertiesPanel />}

      {drop.active && (
        <div className="pointer-events-none absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand bg-brand/10 text-brand backdrop-blur-[2px]">
          <PiFileArrowUp className="size-6" />
          <span className="text-sm font-medium">{tab === "library" ? "Drop to add to the Library" : "Drop to import"}</span>
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

function TabButton({
  active,
  onClick,
  springFor,
  children,
}: {
  active: boolean;
  onClick: () => void;
  springFor?: DragKind[];
  children: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onDragEnter = (e: DragEvent) => {
    const kind = dragKind(e.dataTransfer);
    if (active || !kind || !springFor?.includes(kind)) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(onClick, SPRING_MS);
  };
  const cancel = () => clearTimeout(timer.current);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      onDragEnter={onDragEnter}
      onDragLeave={cancel}
      onDrop={cancel}
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
