/**
 * The selected clip's (or transition's) properties, like Premiere's Effect Controls: one
 * collapsible section per effect that applies to the clip (Motion and Opacity
 * for anything on a video track, Volume for anything with sound), each row
 * generated from the effect's parameter specs.
 */
import { type ReactNode, useState } from "react";
import { PiCaretRight, PiDiamondsFour, PiFilmStrip, PiImage, PiMusicNotes, PiSlidersHorizontal, PiSubtitles, PiTextT } from "react-icons/pi";
import { keyframeTime } from "@shared/animation";
import type { Clip, Effect, MediaAsset, ParamValues, Project } from "@shared/types";
import {
  type ClipTraits,
  type EffectDefinition,
  effectDefinition,
  hasKeyframes,
  isTextClip,
  resetParams,
  setEffectEnabled,
  setParams,
  storedValuesAt,
  textStyleAt,
} from "@shared/effects";
import { formatDuration } from "@shared/format";
import { isAnimatable, sameValue } from "@shared/params";
import { clipDuration, clipName, getClip, getTrack, isOnVideoTrack, outputSize, sourceTime } from "@shared/timeline";
import { refKey } from "@shared/transition-windows";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { layoutText } from "@/lib/text-render";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { usePlayback } from "@/stores/playback";
import { KeyframeNavigator, Stopwatch } from "./animation-controls";
import type { DisplayContext } from "./display";
import { EffectLane, KeyframeRuler, KeyframesRoot, ParamLane } from "./keyframe-lanes";
import { ParamRow, ResetButton, useParamEditors } from "./param-rows";
import { TransitionProperties } from "./transition-properties";

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
  const fps = useEditor((s) => s.project.settings.fps);
  const lanes = useLayout((s) => s.keyframesOpen);
  const transition = useEditor((s) => s.selectedTransition);

  if (transition) return <TransitionProperties key={refKey(transition)} transitionRef={transition} />;
  if (!clip) return <NothingSelected />;

  // Values show at the playhead; edits keyframe the frame there (or a keyframe right next to it).
  const time = sourceTime(clip, playhead);
  const editTime = keyframeTime(clip, playhead, fps);
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

  const body = (
    <>
      <PanelRow lanes={lanes} lane={<KeyframeRuler clip={clip} />} className="sticky top-0 z-[5] border-b bg-background">
        <ClipHeader
          asset={asset}
          text={text}
          name={clipName(clip, asset)}
          detail={[trackName, formatDuration(clipDuration(clip))]}
        />
      </PanelRow>
      {clip.caption && (
        <PanelRow lanes={lanes} className="border-b">
          <CaptionNote />
        </PanelRow>
      )}
      {selectedCount > 1 && (
        <PanelRow lanes={lanes} className="border-b">
          <p className="px-3 py-2 text-xs text-muted-foreground">{selectedCount} clips selected. Showing the last one you selected.</p>
        </PanelRow>
      )}
      {sections.map(({ effect, def }) => (
        <EffectSection
          key={effect.id}
          clip={clip}
          effect={effect}
          def={def}
          traits={traits}
          time={time}
          editTime={editTime}
          ctx={ctx}
          lanes={lanes}
        />
      ))}
    </>
  );

  return (
    // Radix wraps content in a `display: table` div, which defeats `truncate`.
    <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
      {lanes ? (
        <KeyframesRoot clip={clip} offset={ROWS_WIDTH}>
          {body}
        </KeyframesRoot>
      ) : (
        body
      )}
    </ScrollArea>
  );
}

/** Width of the properties' own column (the left panel's usual width, `w-86`). */
const ROWS_WIDTH = "21.5rem";

/** A row of the panel: the property (or header) on the left, its keyframe lane on the right while the lanes show. */
function PanelRow({ lanes, lane, className, children }: { lanes: boolean; lane?: ReactNode; className?: string; children: ReactNode }) {
  if (!lanes) return <div className={className}>{children}</div>;
  return (
    <div className={cn("flex", className)}>
      <div className="min-w-0 shrink-0" style={{ width: ROWS_WIDTH }}>
        {children}
      </div>
      <div className="relative min-w-0 flex-1 border-l">{lane}</div>
    </div>
  );
}

/** Shows or hides the keyframe lanes (Premiere's "Show/Hide Timeline View"). */
function KeyframesToggle() {
  const open = useLayout((s) => s.keyframesOpen);
  const toggle = useLayout((s) => s.toggleKeyframes);
  const label = open ? "Hide keyframes" : "Show keyframes";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={open}
          onClick={toggle}
          className={cn(
            "grid size-7 shrink-0 cursor-pointer place-items-center rounded-md transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
            open ? "bg-accent text-brand" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <PiDiamondsFour className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
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
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground ring-1 ring-border ring-inset">
        {asset?.poster ? <img src={asset.poster} alt="" className="size-full object-cover" draggable={false} /> : <Icon className="size-4" />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium" title={name}>
          {name}
        </p>
        <p className="truncate text-xs text-muted-foreground">{detail.filter(Boolean).join(" · ")}</p>
      </div>
      <div className="ml-auto">
        <KeyframesToggle />
      </div>
    </div>
  );
}

/** Sections the user opened or closed from how they start (kept while switching between clips). */
const toggled = new Set<string>();

/**
 * Where a section's edits go. By default, the clip's own effect (at the
 * playhead, so animated values get keyframes); the Captions tab sends them to
 * every caption instead.
 */
export interface EffectTarget {
  apply: (patch: ParamValues) => (p: Project) => Project;
  reset: (keys: string[]) => void;
}

export function EffectSection({
  clip,
  effect,
  def,
  traits,
  time,
  editTime = time,
  ctx,
  lanes = false,
  target,
  hide = [],
  collapseKey = def.type,
  defaultOpen = true,
}: {
  clip: Clip;
  effect: Effect;
  def: EffectDefinition;
  traits: ClipTraits;
  /** Source time the values show at. */
  time: number;
  /** Source time edits keyframe (animated properties). */
  editTime?: number;
  ctx: DisplayContext;
  /** Show keyframe lanes beside the rows. */
  lanes?: boolean;
  /** Edits go elsewhere (then the properties can't be animated from here). */
  target?: EffectTarget;
  /** Parameters not shown (e.g. the text itself, which is each caption's own). */
  hide?: string[];
  /** Sections with the same key open and close together. */
  collapseKey?: string;
  defaultOpen?: boolean;
}) {
  const clipId = clip.id;
  const [open, setOpen] = useState(() => toggled.has(collapseKey) !== defaultOpen);
  const values = storedValuesAt(def, effect, time);
  const commit = useEditor((s) => s.commit);
  const to: EffectTarget = target ?? {
    apply: (patch) => (p) => setParams(p, clipId, effect.id, patch, editTime),
    reset: (keys) => commit((p) => resetParams(p, clipId, effect.id, keys, editTime)),
  };
  const editor = useParamEditors(to.apply, (key) => to.reset([key]));
  const params = def.params.filter((p) => (p.appliesTo?.(traits) ?? true) && !hide.includes(p.key));
  const changed = params.some((p) => !sameValue(effect.params[p.key], p.default)) || !!effect.keyframes;
  const toggle = () => {
    if (open === defaultOpen) toggled.add(collapseKey);
    else toggled.delete(collapseKey);
    setOpen(!open);
  };

  return (
    <section aria-label={def.label} className="border-b">
      <PanelRow lanes={lanes} lane={<EffectLane clip={clip} effectId={effect.id} label={def.label} />}>
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
              onClick={() => to.reset(params.map((spec) => spec.key))}
            />
          )}
          {!def.alwaysOn && !target && (
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
      </PanelRow>
      {open && (
        <div className={cn(!effect.enabled && "[&_[data-param]]:opacity-60")}>
          {params.map((spec) => {
            const animatable = isAnimatable(spec) && !target;
            const animated = !!effect.keyframes?.[spec.key]?.length;
            const label = spec.labelFor?.(values) ?? spec.label;
            const param = { clipId, effectId: effect.id, paramKey: spec.key, label };
            return (
              <PanelRow
                key={spec.key}
                lanes={lanes}
                lane={animatable ? <ParamLane clip={clip} effectId={effect.id} paramKey={spec.key} label={label} /> : null}
              >
                <ParamRow
                  spec={spec}
                  values={values}
                  specs={params}
                  ctx={ctx}
                  edit={editor(spec.key)}
                  // Edits that go elsewhere (all captions) can't animate this clip: no stopwatch column at all.
                  animation={target ? undefined : animatable ? <Stopwatch {...param} animated={animated} /> : null}
                  navigator={animatable && animated ? <KeyframeNavigator {...param} /> : null}
                />
              </PanelRow>
            );
          })}
          <PanelRow lanes={lanes}>
            <div className="h-2" />
          </PanelRow>
        </div>
      )}
    </section>
  );
}

/** A caption's own look is edited here; everyone's is in the Captions tab. */
function CaptionNote() {
  return (
    <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
      <PiSubtitles className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">Changes here are for this caption only.</span>
      <button
        type="button"
        className="shrink-0 cursor-pointer font-medium text-brand hover:underline"
        onClick={() => useLayout.getState().setLeftPanel("captions")}
      >
        Edit all captions
      </button>
    </p>
  );
}

function NothingSelected() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-muted-foreground">
      <span className="grid size-11 place-items-center rounded-full bg-muted text-foreground/80">
        <PiSlidersHorizontal className="size-5" />
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-medium text-foreground">Nothing selected</span>
        <span className="block text-xs leading-relaxed text-balance">
          Select a clip on the timeline or the canvas to change its position, scale, rotation, opacity, volume and
          text, or a transition to change its timing and look.
        </span>
      </span>
    </div>
  );
}
