import { memo, useState } from "react";
import type { IconType } from "react-icons";
import {
  PiFlagPennant,
  PiFunction,
  PiLinkSimple,
  PiCode,
  PiRuler,
  PiGauge,
  PiArrowsLeftRight,
  PiArrowsOutLineHorizontal,
  PiBooks,
  PiCaretRight,
  PiCheck,
  PiCopy,
  PiCrosshair,
  PiDownloadSimple,
  PiEye,
  PiFilmStrip,
  PiFolder,
  PiGlobe,
  PiIntersect,
  PiListBullets,
  PiMagicWand,
  PiMagnifyingGlass,
  PiMetronome,
  PiMusicNotes,
  PiPlus,
  PiScissors,
  PiSlidersHorizontal,
  PiSparkle,
  PiSpinnerGap,
  PiSpiral,
  PiStack,
  PiSubtitles,
  PiTextT,
  PiTrash,
  PiUploadSimple,
  PiWarningCircle,
  PiWaveform,
  PiStar,
} from "react-icons/pi";
import { type ToolPart, describeToolCall } from "@shared/assistant";
import { toolSpec } from "@shared/suite-tools";
import { getClip } from "@shared/timeline";
import { cn } from "cn";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";

const ICONS: Record<string, IconType> = {
  get_timeline: PiListBullets,
  get_clips: PiListBullets,
  list_media: PiFilmStrip,
  view_frames: PiEye,
  view_media: PiEye,
  get_transcript: PiSubtitles,
  analyze_audio: PiWaveform,
  extract_stems: PiStack,
  convert_to_notes: PiMusicNotes,
  search_serum_presets: PiMagnifyingGlass,
  get_serum_sound: PiEye,
  load_serum_preset: PiDownloadSimple,
  set_serum_macros: PiSlidersHorizontal,
  rate_serum_preset: PiStar,
  capture_audio_snapshot: PiWaveform,
  get_vocal_mixing_workflow: PiWaveform,
  list_mix_workflows: PiWaveform,
  list_dataset_packages: PiWaveform,
  register_dataset_audio: PiWaveform,
  get_dataset_package: PiWaveform,
  get_dataset_import: PiWaveform,
  cancel_dataset_import: PiWaveform,
  retry_dataset_import: PiWaveform,
  get_mix_workflow: PiWaveform,
  search_mix_examples: PiWaveform,
  get_mix_example: PiWaveform,
  list_engineer_profiles: PiWaveform,
  get_engineer_profile: PiWaveform,
  create_vocal_mix_run: PiWaveform,
  get_vocal_mix_run: PiWaveform,
  cancel_vocal_mix_run: PiWaveform,
  retry_vocal_mix_run: PiWaveform,
  review_vocal_mix_run: PiWaveform,
  apply_vocal_mix_candidate: PiWaveform,
  render_audio_passage: PiWaveform,
  register_audio_artifact: PiWaveform,
  get_hearing_capabilities: PiWaveform,
  hear_audio_artifact: PiWaveform,
  get_hearing_receipt: PiWaveform,
  analyse_audio_artifact: PiWaveform,
  get_audio_job: PiWaveform,
  cancel_audio_job: PiWaveform,
  retry_audio_job: PiWaveform,
  get_audio_report: PiWaveform,

  analyze_music: PiMetronome,
  get_signals: PiWaveform,
  plot_signals: PiWaveform,
  detect_scenes: PiMagnifyingGlass,
  get_catalog: PiMagnifyingGlass,
  get_library: PiBooks,
  search_online: PiGlobe,
  search_online_audio: PiGlobe,
  add_clips: PiPlus,
  add_text: PiTextT,
  add_layer: PiStack,
  set_parent: PiSpiral,
  get_layout: PiRuler,
  set_markers: PiFlagPennant,
  mark_beats: PiMetronome,
  cut_to_markers: PiMetronome,
  set_expression: PiFunction,
  link_param: PiLinkSimple,
  set_shader: PiCode,
  define_signal: PiWaveform,
  delete_signal: PiWaveform,
  set_events: PiMetronome,
  nest_clips: PiStack,
  break_apart: PiStack,
  edit_sequence: PiStack,
  open_sequence: PiStack,
  remap_time: PiGauge,
  apply_preset: PiMagicWand,
  move_clips: PiArrowsLeftRight,
  trim_clip: PiArrowsOutLineHorizontal,
  set_speed: PiGauge,
  split_clips: PiScissors,
  delete_clips: PiTrash,
  close_gaps: PiArrowsLeftRight,
  duplicate_clips: PiCopy,
  set_properties: PiSlidersHorizontal,
  set_keyframes: PiSlidersHorizontal,
  add_effect: PiSparkle,
  edit_effect: PiSparkle,
  copy_effects: PiCopy,
  set_transition: PiIntersect,
  add_track: PiStack,
  edit_track: PiStack,
  set_project: PiSlidersHorizontal,
  style_captions: PiSubtitles,
  merge_captions: PiSubtitles,
  make_subclips: PiScissors,
  edit_subclips: PiScissors,
  batch: PiMagicWand,
  generate_captions: PiSubtitles,
  import_media: PiUploadSimple,
  delete_media: PiTrash,
  library_create_folder: PiFolder,
  library_update: PiFolder,
  library_delete: PiTrash,
  library_save: PiBooks,
  library_use: PiBooks,
  export_video: PiDownloadSimple,
  render_effects: PiFilmStrip,
  focus: PiCrosshair,
};

/** Consecutive tool calls of one answer: collapsed to a summary once there are many and they're done. */
export function ToolSteps({ parts, live }: { parts: ToolPart[]; live: boolean }) {
  const running = parts.some((p) => p.status === "running");
  const [open, setOpen] = useState(false);
  const collapsible = parts.length > 4 && !running && !live;
  if (collapsible && !open) {
    const edits = parts.filter((p) => toolSpec(p.name)?.kind !== "look").length;
    const failed = parts.filter((p) => p.status === "error").length;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full cursor-pointer items-center gap-2 rounded-lg border bg-card/60 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        <PiCaretRight className="size-3 shrink-0" />
        <span className="font-medium text-foreground/80">{parts.length} steps</span>
        <span>
          {edits > 0 && `${edits} change${edits === 1 ? "" : "s"}`}
          {failed > 0 && ` · ${failed} failed`}
        </span>
        <span className="ml-auto flex -space-x-1">
          {parts.slice(-5).map((p) => {
            const Icon = ICONS[p.name] ?? PiMagicWand;
            return (
              <span key={p.id} className="grid size-4.5 place-items-center rounded-full border bg-card">
                <Icon className="size-2.5" />
              </span>
            );
          })}
        </span>
      </button>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-card/60">
      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex w-full cursor-pointer items-center gap-2 border-b px-2.5 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
        >
          <PiCaretRight className="size-3 rotate-90" />
          {parts.length} steps
        </button>
      )}
      {parts.map((p) => (
        <ToolStep key={p.id} part={p} />
      ))}
    </div>
  );
}

/** Select what a step changed and go to it. */
function showChanges(ids: string[]) {
  const { project, setSelection } = useEditor.getState();
  const clips = ids.flatMap((id) => getClip(project, id) ?? []);
  if (clips.length === 0) return;
  setSelection(clips.map((c) => c.id));
  usePlayback.getState().pause();
  usePlayback.getState().seek(Math.min(...clips.map((c) => c.start)));
}

const ToolStep = memo(function ToolStep({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[part.name] ?? PiMagicWand;
  const label = describeToolCall(part.name, part.input);
  const changed = part.changes ? [...part.changes.added, ...part.changes.changed] : [];
  const stillThere = useEditor((s) => changed.some((id) => s.project.clips.some((c) => c.id === id)));
  const hasDetails = part.output !== undefined || (part.input !== null && typeof part.input === "object" && Object.keys(part.input).length > 0);

  return (
    <div className="border-b last:border-b-0" data-tool={part.name} data-status={part.status}>
      <div className="group/step flex min-h-7.5 items-center gap-2 px-2.5 py-1">
        <StatusIcon status={part.status} />
        <button
          type="button"
          disabled={!hasDetails}
          onClick={() => setOpen(!open)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs",
            hasDetails && "cursor-pointer",
            part.status === "error" ? "text-destructive" : part.status === "running" ? "text-foreground" : "text-foreground/80",
          )}
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
          {hasDetails && (
            <PiCaretRight className={cn("size-2.5 shrink-0 text-muted-foreground opacity-0 transition group-hover/step:opacity-100", open && "rotate-90 opacity-100")} />
          )}
        </button>
        {part.changes && <ChangeCounts changes={part.changes} />}
        {stillThere && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Show on the timeline"
                onClick={() => showChanges(changed)}
                className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground opacity-0 transition group-hover/step:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
              >
                <PiCrosshair className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Select what changed</TooltipContent>
          </Tooltip>
        )}
      </div>
      {part.status === "running" && part.progress && (
        <div className="flex items-center gap-2 px-2.5 pb-2 pl-8">
          <Progress value={(part.progress.fraction ?? 0) * 100} className={cn("h-1 flex-1 [&>div]:bg-brand", part.progress.fraction === null && "animate-pulse")} />
          <span className="shrink-0 text-[10.5px] text-muted-foreground tabular-nums">
            {part.progress.label}
            {part.progress.fraction !== null && ` ${Math.round(part.progress.fraction * 100)}%`}
          </span>
        </div>
      )}
      {part.images && part.images.length > 0 && <Thumbnails urls={part.images} />}
      {open && hasDetails && <Details part={part} />}
    </div>
  );
});

function StatusIcon({ status }: { status: ToolPart["status"] }) {
  if (status === "running") return <PiSpinnerGap className="size-3.5 shrink-0 animate-spin text-brand" />;
  if (status === "error") return <PiWarningCircle className="size-3.5 shrink-0 text-destructive" />;
  return <PiCheck className="size-3.5 shrink-0 text-muted-foreground" />;
}

function ChangeCounts({ changes }: { changes: NonNullable<ToolPart["changes"]> }) {
  const items = [
    { n: changes.added.length, sign: "+", title: "added", className: "text-emerald-600 dark:text-emerald-400" },
    { n: changes.changed.length, sign: "~", title: "changed", className: "text-brand" },
    { n: changes.removed, sign: "−", title: "removed", className: "text-destructive" },
  ].filter((i) => i.n > 0);
  if (items.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] tabular-nums">
      {items.map((i) => (
        <span key={i.sign} className={i.className} title={`${i.n} clip${i.n === 1 ? "" : "s"} ${i.title}`}>
          {i.sign}
          {i.n}
        </span>
      ))}
    </span>
  );
}

/** What the assistant looked at. */
function Thumbnails({ urls }: { urls: string[] }) {
  const [zoomed, setZoomed] = useState<string | null>(null);
  return (
    <div className="px-2.5 pb-2 pl-8">
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {urls.map((url) => (
          <button
            key={url}
            type="button"
            onClick={() => setZoomed(zoomed === url ? null : url)}
            className={cn(
              "h-12 shrink-0 cursor-zoom-in overflow-hidden rounded border bg-black transition hover:opacity-90",
              zoomed === url && "ring-2 ring-brand",
            )}
          >
            <img src={url} alt="" className="h-full w-auto object-contain" loading="lazy" />
          </button>
        ))}
      </div>
      {zoomed && (
        <button type="button" onClick={() => setZoomed(null)} className="mt-1.5 block w-full cursor-zoom-out overflow-hidden rounded-md border bg-black">
          <img src={zoomed} alt="" className="mx-auto max-h-72 w-auto object-contain" />
        </button>
      )}
    </div>
  );
}

function Details({ part }: { part: ToolPart }) {
  const input = JSON.stringify(part.input, null, 2);
  return (
    <div className="grid gap-2 border-t bg-muted/30 px-2.5 py-2">
      {input && input !== "{}" && (
        <Block title="Input">
          <pre className="max-h-48 overflow-auto font-mono text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">{input}</pre>
        </Block>
      )}
      {part.output !== undefined && (
        <Block title={part.status === "error" ? "Error" : "Result"}>
          <pre className={cn("max-h-64 overflow-auto font-mono text-[11px] leading-snug whitespace-pre-wrap", part.status === "error" ? "text-destructive" : "text-muted-foreground")}>
            {part.output || "(nothing)"}
          </pre>
        </Block>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground/80 uppercase">{title}</span>
      {children}
    </div>
  );
}
