import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import type { ExportResolution } from "@shared/types";
import { formatDuration } from "@shared/format";
import { outputSize, projectDuration } from "@shared/timeline";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEditor } from "@/stores/editor";
import type { FfmpegStatus } from "./use-ffmpeg-status";

const RESOLUTIONS: { value: ExportResolution; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "4k", label: "4K" },
];

export const brandButton = "bg-brand text-brand-foreground hover:bg-brand/90";

interface ExportFormProps {
  ffmpeg: FfmpegStatus;
  resolution: ExportResolution;
  onResolutionChange: (resolution: ExportResolution) => void;
  starting: boolean;
  onSubmit: (fileName: string) => void;
}

export function ExportForm({
  ffmpeg,
  resolution,
  onResolutionChange,
  starting,
  onSubmit,
}: ExportFormProps) {
  const project = useEditor((s) => s.project);
  const [fileName, setFileName] = useState(project.name);
  const { aspectRatio, fps } = project.settings;
  const blocked = ffmpeg === "missing" || ffmpeg === "offline";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!blocked && !starting) onSubmit(fileName.trim() || project.name);
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor="export-file-name">File name</Label>
        <div className="relative">
          <Input
            id="export-file-name"
            value={fileName}
            maxLength={120}
            spellCheck={false}
            onChange={(e) => setFileName(e.target.value)}
            onFocus={(e) => e.target.select()}
            className="pr-14"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
            .mp4
          </span>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Resolution</Label>
        <ToggleGroup
          type="single"
          value={resolution}
          onValueChange={(v) => v && onResolutionChange(v as ExportResolution)}
          spacing={2}
          className="grid w-full grid-cols-3"
        >
          {RESOLUTIONS.map(({ value, label }) => {
            const { width, height } = outputSize(aspectRatio, value);
            return (
              <ToggleGroupItem
                key={value}
                value={value}
                className="h-auto flex-col gap-0.5 rounded-md border border-input py-2.5 hover:bg-accent/60 hover:text-foreground data-[state=on]:border-brand data-[state=on]:bg-brand/10 data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-brand"
              >
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                  {width} × {height}
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>

      <dl className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-xs">
        <Stat label="Aspect" value={aspectRatio} />
        <Stat label="Frame rate" value={`${fps} fps`} />
        <Stat label="Duration" value={formatDuration(projectDuration(project))} />
        <Stat label="Format" value="MP4" />
      </dl>

      {ffmpeg === "missing" && (
        <Notice title="FFmpeg isn't installed">
          Exporting needs FFmpeg. Install it with{" "}
          <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[11px]">
            brew install ffmpeg
          </code>
          , then restart the editor server.
        </Notice>
      )}
      {ffmpeg === "offline" && (
        <Notice title="Can't reach the editor server">
          Make sure <code className="font-mono text-[11px]">pnpm dev</code> is running, then try
          again.
        </Notice>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" className={brandButton} disabled={blocked || starting}>
          {starting && <Loader2 className="animate-spin" />}
          Export
        </Button>
      </DialogFooter>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
      <TriangleAlert className="mt-px size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="grid gap-1">
        <p className="font-medium">{title}</p>
        <p className="leading-relaxed opacity-90">{children}</p>
      </div>
    </div>
  );
}
