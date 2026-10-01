import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { Header } from "@/components/header/header";
import { Preview } from "@/components/preview/preview";
import { Timeline } from "@/components/timeline/timeline";
import { useEditor } from "@/stores/editor";
import { LeftPanel } from "./left-panel";
import { PlainWorkspace, WorkspaceError, WorkspaceLoading } from "./plain-workspace";
import { VideoDesktop } from "./video-desktop";

/** The video suite's main column: the open video's editor (`clientSuite("video").Workspace`). */
export default function VideoWorkspace() {
  const projectId = useEditor((s) => s.projectId);
  const loadError = useEditor((s) => s.loadError);

  if (projectId) {
    return (
      // Keyed so per-project UI state (scroll, zoom anchors, dialogs) starts fresh.
      <div key={projectId} className="relative flex min-h-0 flex-1 flex-col">
        <Header />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <LeftPanel />
              <Preview />
            </div>
            <Timeline />
          </div>
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
