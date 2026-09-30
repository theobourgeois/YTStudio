/**
 * The Captions tab: every caption at once. The look (a preset, the
 * animation, and the Text, Appearance and Motion values) applies to all of
 * them, like Premiere's caption track style; below, the transcript, where
 * each caption's words are edited in place. One caption's own look is in
 * Properties.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PiArrowLineDown, PiSparkle, PiSubtitles, PiTrash } from "react-icons/pi";
import type { Clip } from "@shared/types";
import {
  applyCaptionPreset,
  captionAnimation,
  captionAnimationOf,
  captionClips,
  captionPreset,
  captionStyleOf,
  captionsWithNext,
  matchingPreset,
  mergeCaptionWithNext,
  removeCaptions,
  resetCaptionParams,
  setCaptionAnimation,
  setCaptionParams,
  setCaptionText,
} from "@shared/captions";
import { type ClipTraits, APPEARANCE, MOTION, TEXT, effectDefinition, findEffect, textStyleAt } from "@shared/effects";
import { formatTime } from "@shared/format";
import { clipEnd, outputSize, removeClips } from "@shared/timeline";
import { EffectSection, type EffectTarget } from "@/components/properties/properties-panel";
import type { DisplayContext } from "@/components/properties/display";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EditGesture } from "@/lib/edit-gesture";
import { layoutText } from "@/lib/text-render";
import { cn } from "cn";
import { useCaptions } from "@/stores/captions";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { useShallow } from "zustand/react/shallow";
import { AnimationSelect, StylePicker } from "./auto-captions-dialog";

const TRAITS: ClipTraits = { visual: true, audible: false, kind: "text" };

export function CaptionsPanel() {
  const captions = useEditor(useShallow((s) => captionClips(s.project)));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RunStatus />
      {captions.length === 0 ? <NoCaptions /> : <Captions captions={captions} />}
    </div>
  );
}

/** Progress of captions being made (the dialog may be closed). */
function RunStatus() {
  const run = useCaptions((s) => s.run);
  if (run.status !== "running") return null;
  return (
    <div className="grid gap-1.5 border-b px-3 py-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Making captions…</span>
        <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => useCaptions.getState().cancel()}>
          Stop
        </button>
      </div>
      <Progress value={run.progress * 100} className="h-1.5 [&>div]:bg-brand" />
    </div>
  );
}

function NoCaptions() {
  const running = useCaptions((s) => s.run.status === "running");
  const hasSound = useEditor((s) => s.project.clips.some((c) => s.assets.find((a) => a.id === c.assetId)?.hasAudio));
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center text-muted-foreground">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-foreground/80">
        <PiSubtitles className="size-5" />
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-medium text-foreground">No captions yet</span>
        <span className="block text-xs leading-relaxed text-balance">
          Auto captions listens to your clips and writes what's said as captions, timed to the speech. Then edit the
          words here, and style them all at once.
        </span>
      </span>
      <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90" disabled={!hasSound || running} onClick={() => useCaptions.getState().openDialog()}>
        <PiSparkle />
        Auto captions
      </Button>
      {!hasSound && <span className="text-xs">Add a clip with sound to the timeline first.</span>}
    </div>
  );
}

function Captions({ captions }: { captions: readonly Clip[] }) {
  const aspect = useEditor((s) => s.project.settings.aspectRatio);
  const selectedId = useEditor((s) => s.selectedClipIds.at(-1));
  const commit = useEditor((s) => s.commit);
  // The values shown: the selected caption's, else the first one's.
  const shown = captions.find((c) => c.id === selectedId) ?? captions[0];
  const look = captionStyleOf(shown);
  const preset = matchingPreset(look.style, aspect)?.id ?? null;
  const animation = useEditor((s) => captionAnimationOf(s.project)?.type ?? "none");
  const canvas = outputSize(aspect, "1080p");
  const ctx: DisplayContext = { canvas, media: layoutText(textStyleAt(shown, shown.in), 1) };
  const duration = clipEnd(captions.at(-1)!) - captions[0].start;

  const target = (type: string): EffectTarget => ({
    apply: (patch) => (p) => setCaptionParams(p, type, patch),
    reset: (keys) => commit((p) => resetCaptionParams(p, type, keys)),
  });

  return (
    <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">
            {captions.length} caption{captions.length === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted-foreground">Style changes here apply to all of them.</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => useCaptions.getState().openDialog()}>
              <PiSparkle />
              Auto captions
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56">
            Caption more clips, or make these again with other settings.
          </TooltipContent>
        </Tooltip>
      </div>

      <section aria-label="Caption style" className="grid gap-3 border-b px-3 py-3">
        <StylePicker
          compact
          value={preset}
          aspect={aspect}
          withCurrent={false}
          onChange={(id) => {
            const p = captionPreset(id);
            if (p) commit((project) => applyCaptionPreset(project, p));
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Animation</span>
          <AnimationSelect
            value={animation}
            className="h-7! w-40 text-xs"
            onChange={(type) => commit((p) => setCaptionAnimation(p, type === "none" ? null : captionAnimation(type)))}
          />
        </div>
      </section>

      {[TEXT, APPEARANCE, MOTION].map((def) => {
        const effect = findEffect(shown, def.type);
        if (!effect || !effectDefinition(def.type)) return null;
        return (
          <EffectSection
            key={def.type}
            clip={shown}
            effect={effect}
            def={def}
            traits={TRAITS}
            time={shown.in}
            ctx={ctx}
            target={target(def.type)}
            hide={def === TEXT ? ["text"] : []}
            collapseKey={`captions:${def.type}`}
            defaultOpen={false}
          />
        );
      })}

      <Transcript captions={captions} />

      <div className="flex items-center justify-between px-3 py-3 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatTime(duration)} of captions</span>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 hover:text-destructive"
          onClick={() => commit(removeCaptions)}
        >
          <PiTrash /> Delete all captions
        </button>
      </div>
    </ScrollArea>
  );
}

/** Each caption's words, editable in place, with the one playing highlighted. */
function Transcript({ captions }: { captions: readonly Clip[] }) {
  const selected = useEditor(useShallow((s) => s.selectedClipIds));
  const withNext = useEditor((s) => captionsWithNext(s.project));
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const list = useRef<HTMLOListElement>(null);

  // Keep the caption playing in view. Watched outside React: each row highlights itself, so playback
  // never re-renders the whole list.
  useEffect(() => {
    let shown: string | null = null;
    return usePlayback.subscribe(({ time, playing }) => {
      const id = playing ? (captions.find((c) => isPlaying(c, time))?.id ?? null) : null;
      if (id && id !== shown) list.current?.querySelector(`[data-caption="${id}"]`)?.scrollIntoView({ block: "nearest" });
      shown = id;
    });
  }, [captions]);

  const focusRow = useCallback((index: number) => {
    const el = list.current?.querySelectorAll<HTMLTextAreaElement>("textarea")[index];
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <section aria-label="Transcript" className="border-b">
      <p className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">Transcript</p>
      <ol ref={list} className="pb-2">
        {captions.map((c, i) => (
          <CaptionRow
            key={c.id}
            clip={c}
            index={i}
            selected={selectedSet.has(c.id)}
            hasNext={withNext.has(c.id)}
            focusRow={focusRow}
          />
        ))}
      </ol>
    </section>
  );
}

/** The caption is on screen at `time`. */
const isPlaying = (clip: Clip, time: number) => time >= clip.start - 1e-4 && time < clipEnd(clip) - 1e-4;

interface CaptionRowProps {
  clip: Clip;
  index: number;
  selected: boolean;
  /** There's a caption right after it to join it with. */
  hasNext: boolean;
  focusRow: (index: number) => void;
}

// Memoised: a long transcript re-renders only the rows that changed.
const CaptionRow = memo(function CaptionRow({ clip, index, selected, hasNext, focusRow }: CaptionRowProps) {
  const text = String(findEffect(clip, TEXT.type)?.params.text ?? "");
  const active = usePlayback((s) => isPlaying(clip, s.time));
  // The row's actions (and their tooltips) only exist while it's hovered: cheaper for long transcripts.
  const [hovered, setHovered] = useState(false);
  const [gesture] = useState(() => new EditGesture());
  useEffect(() => () => gesture.end(), [gesture]);
  const lines = useMemo(() => Math.min(4, text.split("\n").length), [text]);

  const show = () => {
    useEditor.getState().select(clip.id);
    if (!usePlayback.getState().playing) usePlayback.getState().seek(clip.start);
  };
  const commit = useEditor.getState().commit;

  return (
    <li
      data-caption={clip.id}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={cn(
        // Rows off screen skip layout and paint (a transcript can have thousands).
        "group relative flex items-start gap-2 px-3 py-1 transition-colors [contain-intrinsic-size:auto_32px] [content-visibility:auto]",
        active && "bg-brand/10",
        selected && "bg-accent/70",
      )}
    >
      <button
        type="button"
        onClick={show}
        className={cn(
          "mt-[5px] shrink-0 cursor-pointer rounded font-mono text-[11px] text-muted-foreground tabular-nums hover:text-foreground",
          active && "text-brand",
        )}
        title="Go to this caption"
      >
        {formatTime(clip.start)}
      </button>
      <textarea
        aria-label={`Caption at ${formatTime(clip.start)}`}
        value={text}
        rows={lines}
        spellCheck
        onFocus={() => {
          show();
          gesture.begin();
        }}
        onBlur={() => gesture.end()}
        onChange={(e) => gesture.apply((p) => setCaptionText(p, clip.id, e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            gesture.end();
            focusRow(index + 1);
          }
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        className="min-w-0 flex-1 resize-none rounded border border-transparent bg-transparent px-1.5 py-0.5 text-[13px] leading-snug outline-none hover:border-border focus:border-border focus:bg-background"
      />
      {hovered && (
        <div className="absolute top-1 right-2 hidden items-center gap-0.5 rounded-md bg-popover shadow-sm ring-1 ring-border group-hover:flex">
          {hasNext && (
            <RowAction label="Join with the next caption" onClick={() => commit((p) => mergeCaptionWithNext(p, clip.id))}>
              <PiArrowLineDown />
            </RowAction>
          )}
          <RowAction label="Delete caption" onClick={() => commit((p) => removeClips(p, [clip.id]))}>
            <PiTrash />
          </RowAction>
        </div>
      )}
    </li>
  );
});

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
