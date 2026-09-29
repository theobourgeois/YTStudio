import type { ReactNode } from "react";
import { PiFileArrowUp } from "react-icons/pi";
import { MediaBin } from "@/components/media/media-bin";
import { importMedia } from "@/components/media/import-media";
import { OnlinePanel } from "@/components/media/online-panel";
import { PropertiesPanel } from "@/components/properties/properties-panel";
import { TransitionsPanel } from "@/components/transitions/transitions-panel";
import { useFileDrop } from "@/hooks/use-file-drop";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { type LeftPanelTab, useLayout } from "@/stores/layout";

/** The tabs, in order. To add one: add its id to `LeftPanelTab`, then an entry here. */
const TABS: { id: LeftPanelTab; label: string; badge?: () => ReactNode }[] = [
  { id: "media", label: "Media", badge: () => <MediaCount /> },
  { id: "online", label: "Online" },
  { id: "transitions", label: "Transitions" },
  { id: "properties", label: "Properties" },
];

/**
 * The left panel: the project's media, online media, transitions, and the
 * selection's properties (Premiere's Effect Controls). Files dropped anywhere
 * on it are imported.
 */
export function LeftPanel() {
  const tab = useLayout((s) => s.leftPanel);
  const setTab = useLayout((s) => s.setLeftPanel);
  // A clip's properties with their keyframe lanes need the room (Premiere's Effect Controls timeline).
  const lanes = useLayout((s) => s.keyframesOpen);
  const clipShown = useEditor((s) => s.selectedClipIds.length > 0 && !s.selectedTransition);
  const wide = tab === "properties" && lanes && clipShown;
  const drop = useFileDrop((files) => {
    setTab("media");
    importMedia(files);
  });

  return (
    <aside
      className={cn("relative flex shrink-0 flex-col border-r bg-background", wide ? "w-[40rem]" : "w-80")}
      aria-label="Media"
      {...drop.handlers}
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b pr-2 pl-1.5">
        <div role="tablist" aria-label="Media sources" className="flex items-center gap-0.5">
          {TABS.map((t) => (
            <TabButton key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {t.badge?.()}
            </TabButton>
          ))}
        </div>
      </div>

      {tab === "media" && <MediaBin />}
      {/* Always mounted: it keeps its search results and preview player while hidden. */}
      <OnlinePanel active={tab === "online"} />
      {tab === "transitions" && <TransitionsPanel />}
      {tab === "properties" && <PropertiesPanel />}

      {drop.active && (
        <div className="pointer-events-none absolute inset-1.5 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand bg-brand/10 text-brand backdrop-blur-[2px]">
          <PiFileArrowUp className="size-6" />
          <span className="text-sm font-medium">Drop to import</span>
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
