import { PiSpinnerGap } from "react-icons/pi";
import type { WebDownloadProgress } from "@shared/types";
import { Progress } from "@/components/ui/progress";
import type { Upload } from "@/stores/editor";

/** What an online clip's download is doing, in a few words. */
export function downloadLabel({ status, progress }: WebDownloadProgress): string {
  if (status === "processing") return "Processing…";
  if (status === "downloading") return progress === null ? "Downloading…" : `Downloading ${Math.floor(progress * 100)}%`;
  return "Starting…";
}

/** Placeholder card for a file that is still uploading / being probed, or an online clip downloading. */
export function UploadCard({ upload }: { upload: Upload }) {
  const download = upload.download?.state;
  // Downloads: null until the size is known, then while merging or converting.
  const fraction = download ? (download.status === "downloading" ? download.progress : null) : upload.progress < 1 ? upload.progress : null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 p-1" title={upload.name}>
      <div className="relative flex aspect-video flex-col items-center justify-center gap-2 rounded-md bg-muted px-3 ring-1 ring-border ring-inset">
        <PiSpinnerGap className="size-4 animate-spin text-muted-foreground" />
        {fraction !== null && (
          <Progress value={fraction * 100} className="h-1 bg-foreground/10 *:data-[slot=progress-indicator]:bg-brand" />
        )}
        <span className="text-[10px] leading-none text-muted-foreground tabular-nums">
          {download ? downloadLabel(download) : fraction === null ? "Processing…" : `${Math.round(fraction * 100)}%`}
        </span>
      </div>
      <p className="truncate px-0.5 text-xs leading-4 text-muted-foreground">{upload.name}</p>
    </div>
  );
}
