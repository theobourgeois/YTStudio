import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { DockArea } from "@/components/dock/dock-area";
import { Header } from "@/components/header/header";
import { useEditor } from "@/stores/editor";
import { VIDEO_WORKSPACES, useVideoDock } from "@/stores/video-dock";
import { PlainWorkspace, WorkspaceError, WorkspaceLoading } from "./plain-workspace";
import { VideoDesktop } from "./video-desktop";
import { VideoMenus } from "./video-menus";
import { VIDEO_PANEL_DEFS, useVideoPanelMins } from "./video-panels";

/** The video suite's main column: the open video's editor (`clientSuite("video").Workspace`). */
export default function VideoWorkspace() {
  const projectId = useEditor((s) => s.projectId);
  const loadError = useEditor((s) => s.loadError);

  if (projectId) {
    return (
      // Keyed so per-project UI state (scroll, zoom anchors, dialogs) starts fresh.
      <div key={projectId} className="relative flex min-h-0 flex-1 flex-col">
        <Header />
        <VideoMenus />
        <div className="flex min-h-0 flex-1">
          {/* The editor's panels, docked: rearranged by dragging their tabs, floated out from their menus. */}
          <VideoPanels />
          {/* Full height beside the preview and the timeline, so both stay in view while it works. */}
          <AssistantPanel suite="video" />
        </div>
        {/* Last, so its windows are over the editor (at the same z as the timeline's own layers). */}
        <VideoDesktop />
      </div>
    );
  }

  return <PlainWorkspace>{loadError ? <WorkspaceError noun="video" error={loadError} /> : <WorkspaceLoading />}</PlainWorkspace>;
}

function VideoPanels() {
  const mins = useVideoPanelMins();
  return <DockArea dock={useVideoDock} panels={VIDEO_PANEL_DEFS} mins={mins} workspaces={VIDEO_WORKSPACES} />;
}
