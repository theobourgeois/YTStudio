import { AutoCaptionsWindow } from "@/components/captions/auto-captions-dialog";
import { ExportWindow } from "@/components/export/export-dialog";
import { VideoSettingsWindow } from "@/components/header/settings-dialog";
import { SaveToLibraryWindow } from "@/components/library/library-dialogs";
import { FloatingPanels } from "@/components/dock/dock-area";
import { Desktop } from "@/components/windows/floating-window";
import { panelWindow, useVideoDock } from "@/stores/video-dock";
import { useOpenVideoWindows, useVideoWindows } from "@/stores/video-windows";
import { VIDEO_PANEL_DEFS } from "./video-panels";

/**
 * Where the video editor's windows float (`stores/video-windows.ts`): over the whole editor, which stays
 * usable beside them: what were its dialogs, and any of its panels floated out of the dock.
 */
export function VideoDesktop() {
  const exportOpen = useOpenVideoWindows((s) => s.export);
  const settingsOpen = useOpenVideoWindows((s) => s.settings);
  return (
    <Desktop windows={useVideoWindows} name="video" label="Video windows" overlay className="absolute inset-0 z-50">
      <FloatingPanels dock={useVideoDock} panels={VIDEO_PANEL_DEFS} windowId={panelWindow} />
      {settingsOpen && <VideoSettingsWindow />}
      {exportOpen && <ExportWindow />}
      <AutoCaptionsWindow />
      <SaveToLibraryWindow />
    </Desktop>
  );
}
