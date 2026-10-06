/**
 * The selected clip's (or transition's) properties, like Premiere's Effect Controls: one
 * collapsible section per effect that applies to the clip (Motion and Opacity
 * for anything on a video track, Volume for anything with sound, then the
 * video effects added from the Effects tab, in the order they're drawn), each
 * row generated from the effect's parameter specs.
 */
import { Fragment, memo, type ReactNode, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  PiArrowDown,
  PiArrowUp,
  PiBezierCurve,
  PiCaretRight,
  PiCircle,
  PiPenNib,
  PiPlus,
  PiPolygon,
  PiRectangle,
  PiCircleHalfTilt,
  PiClockCounterClockwise,
  PiCrosshairSimple,
  PiDiamondsFour,
  PiDotsThree,
  PiFilmStrip,
  PiImage,
  PiMusicNotes,
  PiSlidersHorizontal,
  PiSparkle,
  PiSquare,
  PiStack,
  PiSubtitles,
  PiTextAa,
  PiVideoCamera,
  PiTextT,
  PiTrash,
} from "react-icons/pi";
import { keyframeTime } from "@shared/animation";
import type { Clip, Effect, MediaAsset, ParamValues, Project } from "@shared/types";
import {
  type ClipKind,
  type ClipTraits,
  type EffectDefinition,
  effectDefinition,
  addEffect,
  canExpress,
  clipKind,
  effectLabel,
  effectPeers,
  hasKeyframes,
  TIME_REMAP,
  isAddedEffect,
  isRemapped,
  moveEffect,
  removeEffect,
  resetParams,
  setEffectEnabled,
  setParams,
  storedValuesAt,
  textStyleAt,
} from "@shared/effects";
import { MASK, SHAPE } from "@shared/effects";
import { SHAPE_OPERATORS } from "@shared/effect-library/shape";
import { formatDuration, formatSpeed } from "@shared/format";
import { maskPresetPath } from "@shared/masks";
import { ANIMATOR_PRESETS, addAnimator } from "@shared/text-animators";
import { type NumberSpec, type Vec2Spec, isAnimatable, sameValue } from "@shared/params";
import { canTimeRemap, clipDuration, clipName, clipSpeed, getClip, getTrack, isOnVideoTrack, outputSize, sourceTime } from "@shared/timeline";
import { refKey } from "@shared/transition-windows";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SpeedControl, commitSpeed, useRetimableSelection } from "@/components/timeline/speed-control";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { layoutText } from "@/lib/text-render";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";
import { graphId, useLayout } from "@/stores/layout";
import { usePathEditing } from "@/stores/path-editing";
import { usePlayback } from "@/stores/playback";
import { KeyframeNavigator, Stopwatch } from "./animation-controls";
import { LinkButton, toggleLink } from "./link-button";
import { ExpressionRow, toggleExpression } from "./expression-row";
import type { DisplayContext } from "./display";
import { GraphControls, GraphToggle, ParamGraph } from "./graph-editor";
import { EffectLane, KeyframeRuler, KeyframesRoot, ParamLane } from "./keyframe-lanes";
import { ParamRow, ResetButton, useParamEditors } from "./param-rows";
import { ParentRow } from "./parent-row";
import { RemapControls, TimeRemapSwitch } from "./time-remap-controls";
import { TransitionProperties } from "./transition-properties";
import { showEffects, showPanel } from "@/stores/video-dock";

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

  // Values show at the playhead; edits keyframe the frame there (or a keyframe right next to it).
  const time = clip ? sourceTime(clip, playhead) : 0;
  const kind = clip ? clipKind(clip) : "media";
  const audible = kind === "media" && !!asset?.hasAudio;
  // Kept the same while the playhead moves, so the sections that aren't animated don't re-render.
  const traits = useMemo<ClipTraits>(() => ({ visual, audible, kind }), [visual, audible, kind]);
  const canvas = outputSize(aspectRatio, "1080p");
  // Points on the clip's own frame are px of its media, or of the text's box at 1080p.
  const frame = clip && kind === "text" ? layoutText(textStyleAt(clip, time), 1) : asset?.width && asset.height ? asset : canvas;
  const [frameWidth, frameHeight] = [frame.width!, frame.height!];
  const ctx = useMemo<DisplayContext>(
    () => ({ canvas: { width: canvas.width, height: canvas.height }, media: { width: frameWidth, height: frameHeight } }),
    [canvas.width, canvas.height, frameWidth, frameHeight],
  );

  if (transition) return <TransitionProperties key={refKey(transition)} transitionRef={transition} />;
  if (!clip) return <NothingSelected />;

  const editTime = keyframeTime(clip, playhead, fps);
  const sections = clip.effects.flatMap((effect) => {
    const def = effectDefinition(effect.type);
    return def && def.appliesTo(traits) ? [{ effect, def }] : [];
  });
  // Speed and Time Remapping: clips that play media (a nested sequence's too).
  const retimable = canTimeRemap(clip, asset);
  // Speed goes before Time Remapping and the video effects.
  const firstVideoEffect = ((i) => (i === -1 ? sections.length : i))(
    sections.findIndex((s) => isAddedEffect(s.effect) || s.effect.type === TIME_REMAP.type),
  );

  const body = (
    <>
      <PanelRow lanes={lanes} lane={<KeyframeRuler clip={clip} />} className="sticky top-0 z-[5] border-b bg-background">
        <ClipHeader
          asset={asset}
          kind={kind}
          name={clipName(clip, asset)}
          detail={[
            trackName,
            formatDuration(clipDuration(clip)),
            clipSpeed(clip) !== 1 || clip.reversed ? `${formatSpeed(clipSpeed(clip))}${clip.reversed ? " reversed" : ""}` : undefined,
          ]}
        />
      </PanelRow>
      {clip.caption && (
        <PanelRow lanes={lanes} className="border-b">
          <CaptionNote />
        </PanelRow>
      )}
      {kind === "adjustment" && (
        <PanelRow lanes={lanes} className="border-b">
          <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" data-adjustment-note>
            <PiCircleHalfTilt className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">Its effects, Motion and Opacity change everything on the tracks below it.</span>
          </p>
        </PanelRow>
      )}
      {kind === "null" && (
        <PanelRow lanes={lanes} className="border-b">
          <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" data-null-note>
            <PiCrosshairSimple className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">Draws nothing. Clips parented to it follow its Motion.</span>
          </p>
        </PanelRow>
      )}
      {visual && kind !== "camera" && (
        <PanelRow lanes={lanes} className="border-b">
          <ParentRow clip={clip} />
        </PanelRow>
      )}
      {kind === "camera" && (
        <PanelRow lanes={lanes} className="border-b">
          <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" data-camera-note>
            <PiVideoCamera className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">3D layers (Motion → 3D Layer) are seen through it while it lasts.</span>
          </p>
        </PanelRow>
      )}
      {selectedCount > 1 && (
        <PanelRow lanes={lanes} className="border-b">
          <p className="px-3 py-2 text-xs text-muted-foreground">{selectedCount} clips selected. Showing the last one you selected.</p>
        </PanelRow>
      )}
      {sections.map(({ effect, def }, i) => (
        <Fragment key={effect.id}>
          {/* Speed comes after the built-in effects, before the video effects (like Premiere's Time Remapping). */}
          {retimable && i === firstVideoEffect && <SpeedSection clip={clip} lanes={lanes} />}
          <EffectSection
            clip={clip}
            effect={effect}
            def={def}
            label={effectLabel(clip, effect)}
            // Several masks or shapes each open and close on their own.
            collapseKey={def.stackable ? `${def.type}:${effect.id}` : def.type}
            traits={traits}
            // An effect without keyframes or expressions shows the same at every moment, and edits
            // ignore the time (`setParams`): a fixed one keeps it from re-rendering as the playhead moves.
            time={moves(effect) ? time : 0}
            editTime={moves(effect) ? editTime : 0}
            ctx={ctx}
            lanes={lanes}
          />
        </Fragment>
      ))}
      {retimable && firstVideoEffect === sections.length && <SpeedSection clip={clip} lanes={lanes} />}
      {visual && kind !== "camera" && (
        <PanelRow lanes={lanes}>
          <AddEffectRow clipId={clip.id} kind={kind} />
        </PanelRow>
      )}
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

/** Whether an effect's values change with the playhead. */
const moves = (effect: Effect) => !!effect.keyframes || !!effect.expressions || !!effect.links;

/** Width of the properties' own column beside the keyframe lanes (the left panel's usual width). */
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
  kind,
  name,
  detail,
}: {
  asset: MediaAsset | undefined;
  kind: ClipKind;
  name: string;
  detail: (string | undefined)[];
}) {
  const Icon =
    kind === "text"
      ? PiTextT
      : kind === "adjustment"
        ? PiCircleHalfTilt
        : kind === "solid"
          ? PiSquare
          : kind === "camera"
            ? PiVideoCamera
            : kind === "shape"
            ? PiPolygon
            : kind === "null"
            ? PiCrosshairSimple
            : asset?.sequence
            ? PiStack
            : asset?.kind === "image"
            ? PiImage
            : asset?.kind === "audio"
              ? PiMusicNotes
              : PiFilmStrip;
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

/** Memoised: the panel re-renders as the playhead moves, and only animated sections change with it. */
export const EffectSection = memo(function EffectSection({
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
  label: sectionLabel = def.label,
}: {
  clip: Clip;
  effect: Effect;
  def: EffectDefinition;
  /** What the section is called (the definition's label, numbered when there are several). */
  label?: string;
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
  const openGraphs = useLayout((s) => s.graphs);
  const values = storedValuesAt(def, effect, time);
  const commit = useEditor((s) => s.commit);
  const to: EffectTarget = target ?? {
    apply: (patch) => (p) => setParams(p, clipId, effect.id, patch, editTime),
    reset: (keys) => commit((p) => resetParams(p, clipId, effect.id, keys, editTime)),
  };
  const editor = useParamEditors(to.apply, (key) => to.reset([key]));
  const params = def.params.filter((p) => (p.appliesTo?.(traits) ?? true) && !hide.includes(p.key) && !p.hiddenFor?.(values));
  const changed = params.some((p) => !sameValue(effect.params[p.key], p.default)) || !!effect.keyframes;
  const toggle = () => {
    if (open === defaultOpen) toggled.add(collapseKey);
    else toggled.delete(collapseKey);
    setOpen(!open);
  };

  return (
    <section aria-label={sectionLabel} className="border-b" data-effect-id={effect.id}>
      <PanelRow lanes={lanes} lane={<EffectLane clip={clip} effectId={effect.id} label={sectionLabel} />}>
        <div className="flex h-9 items-center gap-1 pr-1 pl-1.5">
          <button
            type="button"
            aria-expanded={open}
            onClick={toggle}
            className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1 text-left text-[13px] font-medium outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <PiCaretRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
            <span className={cn("truncate", !effect.enabled && "text-muted-foreground line-through decoration-muted-foreground/60")}>
              {sectionLabel}
            </span>
          </button>
          {changed && (
            <ResetButton
              label={`Reset ${sectionLabel}`}
              onClick={() => to.reset(params.map((spec) => spec.key))}
            />
          )}
          {!target && isAddedEffect(effect) && <EffectMenu clipId={clipId} effectId={effect.id} label={sectionLabel} />}
          {!def.alwaysOn && !target && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="switch"
                  aria-checked={effect.enabled}
                  aria-label={`${sectionLabel} on`}
                  onClick={() => commit((p) => setEffectEnabled(p, clipId, effect.id, !effect.enabled))}
                  className={cn(
                    "grid h-5 cursor-pointer place-items-center rounded px-1 font-serif text-[11px] leading-none font-semibold italic transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    effect.enabled ? "text-brand hover:bg-accent" : "text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground",
                  )}
                >
                  fx
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{effect.enabled ? `Turn ${sectionLabel} off` : `Turn ${sectionLabel} on`}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </PanelRow>
      {open && (
        <div className={cn(!effect.enabled && "[&_[data-param]]:opacity-60")}>
          {def.shader?.history && (
            <PanelRow lanes={lanes}>
              <p className="flex items-center gap-2 px-3 pb-1.5 text-[11px] leading-snug text-muted-foreground" data-time-effect-note>
                <PiClockCounterClockwise className="size-3.5 shrink-0" />
                Uses the frames before this one: it shows while playing and in the export.
              </p>
            </PanelRow>
          )}
          {params.map((spec) => {
            const animatable = isAnimatable(spec) && !target;
            const animated = !!effect.keyframes?.[spec.key]?.length;
            const label = spec.labelFor?.(values) ?? spec.label;
            const param = { clipId, effectId: effect.id, paramKey: spec.key, label };
            const graphable = lanes && animatable && animated && (spec.kind === "number" || spec.kind === "vec2");
            const graph = graphable ? graphId(effect.type, spec.key) : null;
            // Expressions: on numbers and points of the clip's own effects (not where edits go to every caption).
            const expressible = !target && canExpress(def, spec);
            const expression = expressible && effect.expressions?.[spec.key] !== undefined;
            return (
              <Fragment key={spec.key}>
                <PanelRow
                  lanes={lanes}
                  lane={
                    animatable ? (
                      <>
                        <ParamLane clip={clip} effectId={effect.id} paramKey={spec.key} label={label} />
                        {graph && <GraphToggle id={graph} spec={spec as NumberSpec | Vec2Spec} label={label} />}
                      </>
                    ) : null
                  }
                >
                  <ParamRow
                    spec={spec}
                    values={values}
                    specs={params}
                    ctx={ctx}
                    edit={editor(spec.key)}
                    owner={target ? undefined : { clipId, effectId: effect.id }}
                    // Edits that go elsewhere (all captions) can't animate this clip: no stopwatch column at all.
                    animation={
                      target ? undefined : animatable ? (
                        <Stopwatch {...param} animated={animated} onAltClick={expressible ? () => toggleExpression(clipId, effect.id, spec.key) : undefined} />
                      ) : null
                    }
                    expression={expressible ? { on: expression, toggle: () => toggleExpression(clipId, effect.id, spec.key) } : undefined}
                    link={
                      expressible
                        ? {
                            button: <LinkButton clip={clip} effect={effect} def={def} spec={spec} label={label} ctx={ctx} />,
                            on: !!effect.links?.[spec.key],
                            open: () => toggleLink(clipId, effect, spec),
                            unlink: () => toggleLink(clipId, effect, spec, true),
                          }
                        : undefined
                    }
                    navigator={animatable && animated ? <KeyframeNavigator {...param} /> : null}
                  />
                </PanelRow>
                {expression && (
                  <PanelRow lanes={lanes}>
                    <ExpressionRow clip={clip} effect={effect} def={def} spec={spec} time={time} />
                  </PanelRow>
                )}
                {graph && openGraphs[graph] && (
                  <PanelRow
                    lanes={lanes}
                    className="border-y bg-muted/20"
                    lane={<ParamGraph clip={clip} effectId={effect.id} spec={spec as NumberSpec | Vec2Spec} mode={openGraphs[graph]} />}
                  >
                    <GraphControls id={graph} spec={spec as NumberSpec | Vec2Spec} label={label} />
                  </PanelRow>
                )}
              </Fragment>
            );
          })}
          <PanelRow lanes={lanes}>
            <div className="h-2" />
          </PanelRow>
        </div>
      )}
    </section>
  );
});

/** The clip's speed, direction and pitch (the same control as the timeline's Speed button). */
function SpeedSection({ clip, lanes }: { clip: Clip; lanes: boolean }) {
  const [open, setOpen] = useState(() => !toggled.has("speed"));
  // Every selected clip that can be retimed changes together, as in the timeline.
  const selection = useRetimableSelection();
  const remapped = isRemapped(clip);
  const ids = !remapped && selection.includes(clip.id) ? selection : [clip.id];
  const retimed = clipSpeed(clip) !== 1 || clip.reversed === true || clip.keepPitch === false;
  const toggle = () => {
    if (open) toggled.add("speed");
    else toggled.delete("speed");
    setOpen(!open);
  };
  return (
    <section aria-label="Speed" className="border-b">
      <PanelRow lanes={lanes}>
        <div className="flex h-9 items-center gap-1 pr-1 pl-1.5">
          <button
            type="button"
            aria-expanded={open}
            onClick={toggle}
            className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1 text-left text-[13px] font-medium outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <PiCaretRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
            <span className="truncate">Speed</span>
            {!open && remapped && <span className="text-xs font-normal text-muted-foreground">Time Remapping</span>}
            {!open && retimed && (
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {formatSpeed(clipSpeed(clip))}
                {clip.reversed && ", reversed"}
              </span>
            )}
          </button>
          {retimed && (
            <ResetButton label="Reset speed" onClick={() => commitSpeed(ids, { speed: 1, reversed: false, keepPitch: true })} />
          )}
        </div>
      </PanelRow>
      {open && (
        <PanelRow lanes={lanes}>
          <div className="grid gap-3 px-3 pt-1 pb-3">
            {!remapped && <SpeedControl clipIds={ids} clip={clip} />}
            <TimeRemapSwitch clipIds={ids} clip={clip} />
            {remapped && <RemapControls clip={clip} />}
          </div>
        </PanelRow>
      )}
    </section>
  );
}

/** An added effect's "⋯" menu: move it before or after the others of its kind, or remove it. */
function EffectMenu({ clipId, effectId, label }: { clipId: string; effectId: string; label: string }) {
  const commit = useEditor((s) => s.commit);
  // Whether it can move up or down among the clip's effects of its kind, and whether it can go at all.
  const [first, last, only] = useEditor(
    useShallow((s) => {
      const clip = getClip(s.project, clipId);
      const ids = clip ? effectPeers(clip, effectId) : [];
      const effect = clip?.effects.find((e) => e.id === effectId);
      // A shape layer keeps its last shape.
      const kept = !!effect && !!effectDefinition(effect.type)?.alwaysOn && clip!.effects.filter((e) => e.type === effect.type).length < 2;
      return [ids[0] === effectId, ids.at(-1) === effectId, kept];
    }),
  );
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label} options`}
          className="grid size-5 cursor-pointer place-items-center rounded text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <PiDotsThree className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled={first} onSelect={() => commit((p) => moveEffect(p, clipId, effectId, -1))}>
          <PiArrowUp />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => commit((p) => moveEffect(p, clipId, effectId, 1))}>
          <PiArrowDown />
          Move down
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={only} onSelect={() => commit((p) => removeEffect(p, clipId, effectId))}>
          <PiTrash />
          Remove {label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ADD_BUTTON =
  "flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed text-xs text-muted-foreground transition-colors outline-none hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

/** What can be added to the clip: an effect (from the Effects tab), a mask, and on a shape layer more shapes and operators. */
/** Memoised, as the panel re-renders while the playhead moves over keyframes and its menus are long. */
const AddEffectRow = memo(function AddEffectRow({ clipId, kind }: { clipId: string; kind: ClipKind }) {
  const commit = useEditor((s) => s.commit);
  /** Add one and show its path on the monitor, when it has one to edit. */
  const add = (type: string, params?: ParamValues, editPath = false) => {
    let effectId: string | undefined;
    commit((p) => {
      const made = addEffect(p, [clipId], type, params);
      effectId = made.added.get(clipId);
      return made.project;
    });
    if (effectId && editPath) usePathEditing.getState().edit({ clipId, effectId, key: "path" });
  };
  const pen = () => {
    usePathEditing.getState().edit(null);
    useLayout.getState().setTool("pen");
  };
  return (
    <div className="flex gap-1.5 px-3 py-2.5">
      <button type="button" aria-label="Add an effect" onClick={() => showEffects("video")} className={ADD_BUTTON}>
        <PiSparkle className="size-3.5 shrink-0" />
        <span className="truncate">Effect</span>
      </button>
      {kind === "text" && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Add a text animator" className={ADD_BUTTON}>
              <PiTextAa className="size-3.5 shrink-0" />
              <span className="truncate">Animator</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-52">
            {ANIMATOR_PRESETS.map((preset) => (
              <DropdownMenuItem key={preset.id} onSelect={() => commit((p) => addAnimator(p, clipId, preset.id).project)}>
                {preset.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => commit((p) => addAnimator(p, clipId).project)}>Blank animator</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {kind === "shape" && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Add to the shape layer" className={ADD_BUTTON}>
              <PiPlus className="size-3.5 shrink-0" />
              <span className="truncate">Shape</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-48">
            {(
              [
                ["rectangle", "Rectangle", <PiRectangle key="i" />],
                ["ellipse", "Ellipse", <PiCircle key="i" />],
                ["polygon", "Polygon", <PiPolygon key="i" />],
                ["star", "Star", <PiSparkle key="i" />],
              ] as const
            ).map(([shape, name, icon]) => (
              <DropdownMenuItem key={shape} onSelect={() => add(SHAPE.type, { kind: shape })}>
                {icon}
                {name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={pen}>
              <PiPenNib />
              Draw a path
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {SHAPE_OPERATORS.map((op) => (
              <DropdownMenuItem key={op.type} onSelect={() => add(op.type)}>
                {op.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {kind !== "null" && <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Add a mask" className={ADD_BUTTON}>
            <PiBezierCurve className="size-3.5 shrink-0" />
            <span className="truncate">Mask</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => add(MASK.type, { path: maskPresetPath("rectangle") }, true)}>
            <PiRectangle />
            Rectangle
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => add(MASK.type, { path: maskPresetPath("ellipse") }, true)}>
            <PiCircle />
            Ellipse
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={pen}>
            <PiPenNib />
            Draw with the pen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
  );
});

/** A caption's own look is edited here; everyone's is in the Captions tab. */
function CaptionNote() {
  return (
    <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
      <PiSubtitles className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">Changes here are for this caption only.</span>
      <button
        type="button"
        className="shrink-0 cursor-pointer font-medium text-brand hover:underline"
        onClick={() => showPanel("captions")}
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
          Select a clip on the timeline or the canvas to change its position, scale, rotation, opacity, volume, text
          and effects, or a transition to change its timing and look.
        </span>
      </span>
    </div>
  );
}
