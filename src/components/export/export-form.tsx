import { useState, type FormEvent, type ReactNode } from "react";
import { PiSpinnerGap, PiWarning } from "react-icons/pi";
import type { ExportResolution } from "@shared/types";
import { EXPORT_FORMATS, EXPORT_QUALITIES, type ExportFormat, type ExportQuality, exportFormat } from "@shared/export-formats";
import { formatDuration } from "@shared/format";
import { isOnVideoTrack, outputSize, projectDuration, withoutAudioTracks } from "@shared/timeline";
import { Button } from "@/components/ui/button";
import { WindowFooter } from "@/components/windows/floating-window";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEditor } from "@/stores/editor";
import { useExportPreferences } from "@/stores/export-preferences";
import type { FfmpegStatus } from "./use-ffmpeg-status";

const RESOLUTIONS: { value: ExportResolution; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "4k", label: "4K" },
];

export const brandButton = "bg-brand text-brand-foreground hover:bg-brand/90";

/** A choice among a few (resolution, quality): a bordered card, ringed in the accent when on. */
const choiceItem =
  "h-auto flex-col gap-0.5 rounded-md border border-input py-2.5 hover:bg-accent/60 hover:text-foreground data-[state=on]:border-brand data-[state=on]:bg-brand/10 data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-brand";

interface ExportFormProps {
  ffmpeg: FfmpegStatus;
  /** What this ffmpeg can make; null while asking. */
  formats: ExportFormat[] | null;
  resolution: ExportResolution;
  onResolutionChange: (resolution: ExportResolution) => void;
  excludeAudioTracks: boolean;
  onExcludeAudioTracksChange: (exclude: boolean) => void;
  starting: boolean;
  onSubmit: (fileName: string, excludeAudioTracks: boolean) => void;
  onCancel: () => void;
}

export function ExportForm({
  ffmpeg,
  formats,
  resolution,
  onResolutionChange,
  excludeAudioTracks,
  onExcludeAudioTracksChange,
  starting,
  onSubmit,
  onCancel,
}: ExportFormProps) {
  const project = useEditor((s) => s.document);
  const hasAudioTracks = project.clips.some((c) => !isOnVideoTrack(project, c));
  const hasVideo = project.clips.some((c) => isOnVideoTrack(project, c));
  const exclude = hasAudioTracks && hasVideo && excludeAudioTracks;
  const [fileName, setFileName] = useState(project.name);
  const { aspectRatio, fps } = project.settings;
  const { format, quality, alpha, setFormat, setQuality, setAlpha } = useExportPreferences();
  const info = exportFormat(format);
  const unavailable = formats !== null && !formats.includes(format);
  const blocked = ffmpeg === "missing" || ffmpeg === "offline" || unavailable;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!blocked && !starting) onSubmit(fileName.trim() || project.name, exclude);
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
            .{info.extension}
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
              <ToggleGroupItem key={value} value={value} className={choiceItem}>
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                  {width} × {height}
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="export-format">Format</Label>
        <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
          <SelectTrigger id="export-format" className="w-full" aria-label="Format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPORT_FORMATS.map((f) => {
              const missing = formats !== null && !formats.includes(f.id);
              return (
                <SelectItem key={f.id} value={f.id} disabled={missing}>
                  {f.label}
                  <span className="text-muted-foreground">{missing ? `needs ffmpeg's ${f.encoder}` : f.container}</span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <p className="text-xs leading-relaxed text-muted-foreground">{info.description}</p>
      </div>

      {info.quality && (
        <div className="grid gap-2">
          <Label>Quality</Label>
          <ToggleGroup
            type="single"
            value={quality}
            onValueChange={(v) => v && setQuality(v as ExportQuality)}
            spacing={2}
            className="grid w-full grid-cols-3"
          >
            {EXPORT_QUALITIES.map((q) => (
              <ToggleGroupItem key={q.id} value={q.id} className={choiceItem}>
                <span className="text-sm font-semibold">{q.label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs leading-relaxed text-muted-foreground">{EXPORT_QUALITIES.find((q) => q.id === quality)!.description}</p>
        </div>
      )}

      {info.alpha && (
        <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
          <div className="grid gap-1">
            <Label htmlFor="export-alpha">Transparent background</Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Where no clip covers the frame, the file is transparent instead of black, to lay it over other
              footage. The canvas stays black here.
            </p>
          </div>
          <Switch id="export-alpha" checked={alpha} onCheckedChange={setAlpha} className="mt-0.5" />
        </div>
      )}

      {hasAudioTracks && hasVideo && (
        <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
          <div className="grid gap-1">
            <Label htmlFor="export-exclude-audio">Leave out music</Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Export without the audio tracks, then add the song in TikTok or Instagram when you
              post, so it doesn't get muted for copyright.
            </p>
          </div>
          <Switch
            id="export-exclude-audio"
            checked={excludeAudioTracks}
            onCheckedChange={onExcludeAudioTracksChange}
            className="mt-0.5"
          />
        </div>
      )}

      <dl className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-xs">
        <Stat label="Aspect" value={aspectRatio} />
        <Stat label="Frame rate" value={`${fps} fps`} />
        <Stat label="Duration" value={formatDuration(projectDuration(exclude ? withoutAudioTracks(project) : project))} />
        <Stat label="Format" value={info.container} />
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
      {ffmpeg === "available" && unavailable && (
        <Notice title={`This FFmpeg can't make ${info.label}`}>
          It has no {info.encoder} encoder. Install a full build with{" "}
          <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[11px]">brew install ffmpeg</code>, or pick
          another format.
        </Notice>
      )}
      {ffmpeg === "offline" && (
        <Notice title="Can't reach the editor server">
          Make sure <code className="font-mono text-[11px]">pnpm dev</code> is running, then try
          again.
        </Notice>
      )}

      <WindowFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className={brandButton} disabled={blocked || starting}>
          {starting && <PiSpinnerGap className="animate-spin" />}
          Export
        </Button>
      </WindowFooter>
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
      <PiWarning className="mt-px size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="grid gap-1">
        <p className="font-medium">{title}</p>
        <p className="leading-relaxed opacity-90">{children}</p>
      </div>
    </div>
  );
}
