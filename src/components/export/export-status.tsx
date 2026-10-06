import { PiArrowCounterClockwise, PiDownloadSimple } from "react-icons/pi";
import type { ExportJob } from "@shared/types";
import { formatDuration } from "@shared/format";
import { useNow } from "@/hooks/use-now";
import { Button } from "@/components/ui/button";
import { WindowFooter } from "@/components/windows/floating-window";
import { Progress } from "@/components/ui/progress";
import { brandButton } from "./export-form";

export const formatElapsed = (ms: number) => formatDuration(Math.floor(ms / 1000));

export function ExportProgress({
  job,
  startedAt,
  onCancel,
}: {
  job: ExportJob;
  startedAt: number;
  onCancel: () => void;
}) {
  const now = useNow(250);
  const percent = Math.round(Math.min(1, Math.max(0, job.progress)) * 100);

  return (
    <>
      <div className="grid gap-2.5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">{job.status === "queued" ? "Preparing…" : "Rendering"}</span>
          <span className="font-medium tabular-nums">{percent}%</span>
        </div>
        <Progress
          value={percent}
          className="h-2 bg-foreground/10 *:data-[slot=progress-indicator]:bg-brand"
        />
        <div className="flex justify-between gap-4 text-xs text-muted-foreground">
          <span className="truncate">{job.fileName}</span>
          <span className="shrink-0 tabular-nums">Elapsed {formatElapsed(now - startedAt)}</span>
        </div>
      </div>
      <WindowFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel export
        </Button>
      </WindowFooter>
    </>
  );
}

export function ExportDone({ job, onAgain }: { job: ExportJob; onAgain: () => void }) {
  const ratio = job.width / job.height;
  return (
    <>
      {!job.url && (
        <p className="truncate rounded-md bg-muted/60 px-3 py-2.5 text-sm">
          {job.fileName}.{job.extension}
        </p>
      )}
      {job.url && (
        <video
          key={job.url}
          src={job.url}
          controls
          playsInline
          className="mx-auto block rounded-lg bg-black"
          style={{ aspectRatio: `${job.width} / ${job.height}`, width: `min(100%, ${50 * ratio}vh)` }}
        />
      )}
      <WindowFooter>
        <Button variant="outline" onClick={onAgain}>
          <PiArrowCounterClockwise />
          Export again
        </Button>
        {job.downloadUrl && (
          <Button asChild className={brandButton}>
            <a href={job.downloadUrl} download={`${job.fileName}.${job.extension}`}>
              <PiDownloadSimple />
              Download
            </a>
          </Button>
        )}
      </WindowFooter>
    </>
  );
}

export function ExportError({
  message,
  onBack,
  onRetry,
}: {
  message: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      <p className="max-h-40 overflow-auto rounded-md border border-destructive/30 bg-destructive/10 p-3 font-mono text-xs break-words whitespace-pre-wrap text-destructive">
        {message}
      </p>
      <WindowFooter>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button className={brandButton} onClick={onRetry}>
          <PiArrowCounterClockwise />
          Try again
        </Button>
      </WindowFooter>
    </>
  );
}

/** Current time, refreshed every `intervalMs` while mounted. */
