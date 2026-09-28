import { PiSpinnerGap } from "react-icons/pi";
import { Progress } from "@/components/ui/progress";
import type { Upload } from "@/stores/editor";

/** Placeholder card for a file that is still uploading / being probed. */
export function UploadCard({ upload }: { upload: Upload }) {
  const uploaded = upload.progress >= 1;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 p-1" title={upload.name}>
      <div className="relative flex aspect-video flex-col items-center justify-center gap-2 rounded-md bg-muted px-3 ring-1 ring-border ring-inset">
        <PiSpinnerGap className="size-4 animate-spin text-muted-foreground" />
        <Progress
          value={upload.progress * 100}
          className="h-1 bg-foreground/10 *:data-[slot=progress-indicator]:bg-brand"
        />
        <span className="text-[10px] leading-none text-muted-foreground tabular-nums">
          {uploaded ? "Processing…" : `${Math.round(upload.progress * 100)}%`}
        </span>
      </div>
      <p className="truncate px-0.5 text-xs leading-4 text-muted-foreground">{upload.name}</p>
    </div>
  );
}
