import { AutoCaptionsWindow } from "@/components/captions/auto-captions-dialog";
import { ExportWindow } from "@/components/export/export-dialog";
import { VideoSettingsWindow } from "@/components/header/settings-dialog";
import { SaveToLibraryWindow } from "@/components/library/library-dialogs";
import { Desktop } from "@/components/windows/floating-window";
import { useOpenVideoWindows, useVideoWindows } from "@/stores/video-windows";

/**
 * Where the video editor's windows float (`stores/video-windows.ts`): over the whole editor, which stays
 * usable beside them. They're what were its dialogs; its panels stay docked, as Premiere's do.
 */
export function VideoDesktop() {
  const exportOpen = useOpenVideoWindows((s) => s.export);
  const settingsOpen = useOpenVideoWindows((s) => s.settings);
  return (
    <Desktop windows={useVideoWindows} name="video" label="Video windows" overlay className="absolute inset-0 z-50">
      {settingsOpen && <VideoSettingsWindow />}
      {exportOpen && <ExportWindow />}
      <AutoCaptionsWindow />
      <SaveToLibraryWindow />
    </Desktop>
  );
}
