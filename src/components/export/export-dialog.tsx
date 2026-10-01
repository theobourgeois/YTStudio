import { useRef, useState } from "react";
import { PiDownloadSimple } from "react-icons/pi";
import type { ExportResolution } from "@shared/types";
import { formatDuration } from "@shared/format";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FloatingWindow, WindowBody, WindowLead, centredOnDesktop } from "@/components/windows/floating-window";
import { useEditor } from "@/stores/editor";
import { useOpenVideoWindows } from "@/stores/video-windows";
import { layoutTexts } from "./layout-texts";
import { ExportForm, brandButton } from "./export-form";
import { ExportDone, ExportError, ExportProgress, formatElapsed } from "./export-status";
import { useExportJob, type ExportPhase } from "./use-export-job";
import { useFfmpegStatus } from "./use-ffmpeg-status";

/** The header's "Export" button: opens the export window (`ExportWindow`), or brings it to the front. */
export function ExportButton() {
  // The whole video is exported (its main sequence), whichever sequence the timeline shows.
  const empty = useEditor((s) => s.document.clips.length === 0);
  const button = (
    <Button size="sm" className={`h-8 px-3.5 ${brandButton}`} disabled={empty} onClick={() => useOpenVideoWindows.getState().show("export")}>
      <PiDownloadSimple />
      Export
    </Button>
  );
  if (!empty) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="rounded-md outline-none">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">Add clips to the timeline to export</TooltipContent>
    </Tooltip>
  );
}

const WIDTH = 448;

/**
 * The export, a window over the video editor: the file's name and size, then its progress and the
 * video. The edit can go on while it renders (what's exported is the video as it was when it started);
 * closing the window cancels the render, so Esc doesn't close it then, only its × or Cancel.
 */
export function ExportWindow() {
  const [initial] = useState(() => centredOnDesktop(WIDTH, 420, "video"));
  const [resolution, setResolution] = useState<ExportResolution>("1080p");
  const [excludeAudioTracks, setExcludeAudioTracks] = useState(false);
  const ffmpeg = useFfmpegStatus(true);
  const { phase, start, reset } = useExportJob();
  const lastRun = useRef({ fileName: "", excludeAudioTracks: false });
  const busy = phase.status === "starting" || phase.status === "running";

  const close = () => {
    // Closing mid-render cancels it (the window says so).
    if (busy) reset();
    useOpenVideoWindows.getState().close("export");
  };

  const run = (fileName: string, excludeAudioTracks: boolean) => {
    lastRun.current = { fileName, excludeAudioTracks };
    const project = useEditor.getState().document;
    void start(layoutTexts(project, resolution).then((texts) => ({ project, resolution, fileName, excludeAudioTracks, texts })));
  };

  const { title, description } = copy(phase);

  return (
    <FloatingWindow id="export" title="Export" heading={title} initial={initial} keepsKeys escapeCloses={!busy} onClose={close} className="w-[448px] max-w-full">
      <WindowBody>
        <WindowLead>{description}</WindowLead>
        {(phase.status === "idle" || phase.status === "starting") && (
          <ExportForm
            ffmpeg={ffmpeg}
            resolution={resolution}
            onResolutionChange={setResolution}
            excludeAudioTracks={excludeAudioTracks}
            onExcludeAudioTracksChange={setExcludeAudioTracks}
            starting={phase.status === "starting"}
            onSubmit={run}
            onCancel={close}
          />
        )}
        {phase.status === "running" && <ExportProgress job={phase.job} startedAt={phase.startedAt} onCancel={reset} />}
        {phase.status === "done" && <ExportDone job={phase.job} onAgain={reset} />}
        {phase.status === "error" && (
          <ExportError message={phase.message} onBack={reset} onRetry={() => run(lastRun.current.fileName, lastRun.current.excludeAudioTracks)} />
        )}
      </WindowBody>
    </FloatingWindow>
  );
}

function copy(phase: ExportPhase): { title: string; description: string } {
  switch (phase.status) {
    case "idle":
    case "starting":
      return { title: "Export video", description: "Render your timeline to an MP4 file." };
    case "running":
      return {
        title: "Exporting…",
        description: "Keep this window open — closing it cancels the export. You can go on editing meanwhile.",
      };
    case "done": {
      const { width, height, duration } = phase.job;
      return {
        title: "Your video is ready",
        description: `${width} × ${height} · ${formatDuration(duration)} · rendered in ${formatElapsed(phase.elapsedMs)}`,
      };
    }
    case "error":
      return { title: "Export failed", description: "Something went wrong while rendering." };
  }
}
