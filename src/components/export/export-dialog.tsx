import { useRef, useState } from "react";
import { PiDownloadSimple } from "react-icons/pi";
import type { ExportResolution } from "@shared/types";
import { formatDuration } from "@shared/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "@/stores/editor";
import { ExportForm, brandButton } from "./export-form";
import { ExportDone, ExportError, ExportProgress, formatElapsed } from "./export-status";
import { useExportJob, type ExportPhase } from "./use-export-job";
import { useFfmpegStatus } from "./use-ffmpeg-status";

/** The header's "Export" button and the export dialog it opens. */
export function ExportDialog() {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<ExportResolution>("1080p");
  const [excludeAudioTracks, setExcludeAudioTracks] = useState(false);
  const empty = useEditor((s) => s.project.clips.length === 0);
  const ffmpeg = useFfmpegStatus(open);
  const { phase, start, reset } = useExportJob();
  const lastRun = useRef({ fileName: "", excludeAudioTracks: false });
  const busy = phase.status === "starting" || phase.status === "running";

  const onOpenChange = (next: boolean) => {
    // Opening always starts fresh; closing mid-render cancels it (the dialog says so).
    if (next || busy) reset();
    setOpen(next);
  };

  const run = (fileName: string, excludeAudioTracks: boolean) => {
    lastRun.current = { fileName, excludeAudioTracks };
    void start({ project: useEditor.getState().project, resolution, fileName, excludeAudioTracks });
  };

  const trigger = (
    <DialogTrigger asChild>
      <Button size="sm" className={`h-8 px-3.5 ${brandButton}`} disabled={empty}>
        <PiDownloadSimple />
        Export
      </Button>
    </DialogTrigger>
  );
  const { title, description } = copy(phase);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {empty ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="rounded-md outline-none">
              {trigger}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Add clips to the timeline to export</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DialogContent
        className="gap-5 sm:max-w-md"
        // Don't lose a render to a stray click or Escape; the X and Cancel still close.
        onInteractOutside={(e) => busy && e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {(phase.status === "idle" || phase.status === "starting") && (
          <ExportForm
            ffmpeg={ffmpeg}
            resolution={resolution}
            onResolutionChange={setResolution}
            excludeAudioTracks={excludeAudioTracks}
            onExcludeAudioTracksChange={setExcludeAudioTracks}
            starting={phase.status === "starting"}
            onSubmit={run}
          />
        )}
        {phase.status === "running" && (
          <ExportProgress job={phase.job} startedAt={phase.startedAt} onCancel={reset} />
        )}
        {phase.status === "done" && <ExportDone job={phase.job} onAgain={reset} />}
        {phase.status === "error" && (
          <ExportError
            message={phase.message}
            onBack={reset}
            onRetry={() => run(lastRun.current.fileName, lastRun.current.excludeAudioTracks)}
          />
        )}
      </DialogContent>
    </Dialog>
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
        description: "Keep this window open — closing it cancels the export.",
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
