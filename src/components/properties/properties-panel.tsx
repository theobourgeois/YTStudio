/**
 * The selected clip's properties, like Premiere's Effect Controls: one
 * collapsible section per effect that applies to the clip (Motion and Opacity
 * for anything on a video track, Volume for anything with sound), each row
 * generated from the effect's parameter specs.
 */
import { useState } from "react";
import { PiCaretRight, PiFilmStrip, PiImage, PiMusicNotes, PiSlidersHorizontal, PiTextT } from "react-icons/pi";
import type { Effect, MediaAsset } from "@shared/types";
import {
  type ClipTraits,
  type EffectDefinition,
  effectDefinition,
  hasKeyframes,
  isTextClip,
  resetParams,
  sameValue,
  setEffectEnabled,
  setParams,
  storedValuesAt,
  textStyleAt,
} from "@shared/effects";
import { formatDuration } from "@shared/format";
import { clipDuration, clipName, getClip, getTrack, isOnVideoTrack, outputSize } from "@shared/timeline";
import { sourceTime } from "@/components/preview/sync";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { layoutText } from "@/lib/text-render";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import type { DisplayContext } from "./display";
import { ParamRow, ResetButton, useParamEditors } from "./param-rows";

export function PropertiesPanel() {
  const clipId = useEditor((s) => s.selectedClipIds.at(-1) ?? null);
  const selectedCount = useEditor((s) => s.selectedClipIds.length);
  const clip = useEditor((s) => (clipId ? getClip(s.project, clipId) : undefined));
  const asset = useEditor((s) => (clip ? s.assets.find((a) => a.id === clip.assetId) : undefined));
  const visual = useEditor((s) => !!clip && isOnVideoTrack(s.project, clip));
  const trackName = useEditor((s) => (clip ? getTrack(s.project, clip.trackId)?.name : undefined));
  const aspectRatio = useEditor((s) => s.project.settings.aspectRatio);
  // Values only change with the playhead when they're animated.
  const animated = !!clip && hasKeyframes(clip);
  const playhead = usePlayback((s) => (animated ? s.time : 0));

  if (!clip) return <NothingSelected />;

  const time = sourceTime(clip, playhead);
  const text = isTextClip(clip);
  const traits: ClipTraits = { visual, audible: !!asset?.hasAudio, text };
  const canvas = outputSize(aspectRatio, "1080p");
  // Points on the clip's own frame are px of its media, or of the text's box at 1080p.
  const frame = text ? layoutText(textStyleAt(clip, time), 1) : asset?.width && asset.height ? asset : canvas;
  const ctx: DisplayContext = { canvas, media: { width: frame.width!, height: frame.height! } };
  const sections = clip.effects.flatMap((effect) => {
    const def = effectDefinition(effect.type);
    return def && def.appliesTo(traits) ? [{ effect, def }] : [];
  });

  return (
    // Radix wraps content in a `display: table` div, which defeats `truncate`.
    <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
      <ClipHeader
        asset={asset}
        text={text}
        name={clipName(clip, asset)}
        detail={[trackName, formatDuration(clipDuration(clip))]}
      />
      {selectedCount > 1 && (
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">
          {selectedCount} clips selected. Showing the last one you selected.
        </p>
      )}
      {sections.map(({ effect, def }) => (
        <EffectSection key={effect.id} clipId={clip.id} effect={effect} def={def} traits={traits} time={time} ctx={ctx} />
      ))}
    </ScrollArea>
  );
}

function ClipHeader({
  asset,
  text,
  name,
  detail,
}: {
  asset: MediaAsset | undefined;
  text: boolean;
  name: string;
  detail: (string | undefined)[];
}) {
  const Icon = text ? PiTextT : asset?.kind === "image" ? PiImage : asset?.kind === "audio" ? PiMusicNotes : PiFilmStrip;
  return (
    <div className="flex items-center gap-2.5 border-b px-3 py-2.5">
      <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground ring-1 ring-border ring-inset">
        {asset?.poster ? <img src={asset.poster} alt="" className="size-full object-cover" draggable={false} /> : <Icon className="size-4" />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium" title={name}>
          {name}
        </p>
        <p className="truncate text-xs text-muted-foreground">{detail.filter(Boolean).join(" · ")}</p>
      </div>
    </div>
  );
}

/** Sections the user collapsed (kept while switching between clips). */
const collapsed = new Set<string>();

function EffectSection({
  clipId,
  effect,
  def,
  traits,
  time,
  ctx,
}: {
  clipId: string;
  effect: Effect;
  def: EffectDefinition;
  traits: ClipTraits;
  time: number;
  ctx: DisplayContext;
}) {
  const [open, setOpen] = useState(() => !collapsed.has(def.type));
  const values = storedValuesAt(def, effect, time);
  const commit = useEditor((s) => s.commit);
  const editor = useParamEditors(
    (patch) => (p) => setParams(p, clipId, effect.id, patch, time),
    (key) => commit((p) => resetParams(p, clipId, effect.id, [key])),
  );
  const params = def.params.filter((p) => p.appliesTo?.(traits) ?? true);
  const changed = params.some((p) => !sameValue(effect.params[p.key], p.default)) || !!effect.keyframes;
  const toggle = () => {
    if (open) collapsed.add(def.type);
    else collapsed.delete(def.type);
    setOpen(!open);
  };

  return (
    <section aria-label={def.label} className="border-b">
      <div className="flex h-9 items-center gap-1 pr-1 pl-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1 text-left text-[13px] font-medium outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <PiCaretRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className={cn("truncate", !effect.enabled && "text-muted-foreground line-through decoration-muted-foreground/60")}>
            {def.label}
          </span>
        </button>
        {changed && (
          <ResetButton
            label={`Reset ${def.label}`}
            onClick={() => commit((p) => resetParams(p, clipId, effect.id, params.map((spec) => spec.key)))}
          />
        )}
        {!def.alwaysOn && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="switch"
              aria-checked={effect.enabled}
              aria-label={`${def.label} on`}
              onClick={() => commit((p) => setEffectEnabled(p, clipId, effect.id, !effect.enabled))}
              className={cn(
                "grid h-5 cursor-pointer place-items-center rounded px-1 font-serif text-[11px] leading-none font-semibold italic transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                effect.enabled ? "text-brand hover:bg-accent" : "text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground",
              )}
            >
              fx
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{effect.enabled ? `Turn ${def.label} off` : `Turn ${def.label} on`}</TooltipContent>
        </Tooltip>
        )}
      </div>
      {open && (
        <div className={cn("pb-2", !effect.enabled && "opacity-60")}>
          {params.map((spec) => (
            <ParamRow key={spec.key} spec={spec} values={values} specs={params} ctx={ctx} edit={editor(spec.key)} />
          ))}
        </div>
      )}
    </section>
  );
}

function NothingSelected() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-muted-foreground">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-foreground/80">
        <PiSlidersHorizontal className="size-5" />
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-medium text-foreground">No clip selected</span>
        <span className="block text-xs leading-relaxed text-balance">
          Select a clip on the timeline or the canvas to change its position, scale, rotation, opacity and volume,
          or its text.
        </span>
      </span>
    </div>
  );
}
