/**
 * A property's link to a signal (the visualizer's links, docs/visualizer/README.md): the button by its
 * stopwatch, lit while it's linked, and the popover that edits the link: which signal (and heard
 * from where), how it moves the value, its response, a hit's shape, and a meter of the signal now.
 * Clicking the button on a property that isn't linked links it to the bass at once, sized for it.
 */
import { useRef } from "react";
import { PiLinkSimple, PiLinkSimpleBreak } from "react-icons/pi";
import { create } from "zustand";
import { currentSignalReader, findClip, linkLevel } from "@shared/audio-signals";
import { type EffectDefinition, atFrameRate, effectValuesAt, setLink } from "@shared/effects";
import { DEFAULT_HIT } from "@shared/links";
import type { NumberSpec, ParamSpec, Vec2Spec } from "@shared/params";
import { sourceTime, timelineTime } from "@shared/timeline";
import type { Clip, Effect, HitShape, ParamLink, Project, SignalResponse, Vec2 } from "@shared/types";
import { ScrubNumber } from "@/components/scrub-number";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EditGesture } from "@/lib/edit-gesture";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { cn } from "cn";
import { type DisplayContext, fromDisplay, numberDisplay, toDisplay } from "./display";
import { defaultLink, isHits, refFrom, refValue, signalOptions, sourceFrom, sourceOptions, sourceValue } from "./link-model";

/** Which property's link popover is open (`clip/effect/key`), so a property's menu can open it too. */
export const useLinkPopover = create<{ open: string | null }>(() => ({ open: null }));
const keyOf = (clipId: string, effectId: string, key: string) => `${clipId}/${effectId}/${key}`;

/** Link a property to the bass (sized for it) and open its popover, or with `unlink`, take its link away. */
export function toggleLink(clipId: string, effect: Effect, spec: ParamSpec, unlink = false) {
  const linked = !!effect.links?.[spec.key];
  if (unlink || linked) {
    if (linked && unlink) useEditor.getState().commit((p) => setLink(p, clipId, effect.id, spec.key, null));
    if (!unlink) useLinkPopover.setState({ open: keyOf(clipId, effect.id, spec.key) });
    return;
  }
  useEditor.getState().commit((p) => setLink(p, clipId, effect.id, spec.key, defaultLink(spec)));
  useLinkPopover.setState({ open: keyOf(clipId, effect.id, spec.key) });
}

interface LinkButtonProps {
  clip: Clip;
  effect: Effect;
  def: EffectDefinition;
  spec: ParamSpec;
  label: string;
  ctx: DisplayContext;
}

export function LinkButton({ clip, effect, def, spec, label, ctx }: LinkButtonProps) {
  const id = keyOf(clip.id, effect.id, spec.key);
  const open = useLinkPopover((s) => s.open === id);
  const link = effect.links?.[spec.key];
  const setOpen = (next: boolean) => useLinkPopover.setState({ open: next ? id : null });
  return (
    <Popover open={open && !!link} onOpenChange={setOpen} modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Link ${label} to a signal`}
              aria-pressed={!!link}
              data-link={spec.key}
              onClick={(e) => {
                e.preventDefault();
                if (link) setOpen(!open);
                else toggleLink(clip.id, effect, spec);
              }}
              className={cn(
                "grid size-5 cursor-pointer place-items-center rounded transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
                link ? "text-brand" : "text-muted-foreground/50 hover:text-foreground",
              )}
            >
              <PiLinkSimple className="size-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{link ? `${label} follows a signal` : `Make ${label} follow the sound`}</TooltipContent>
      </Tooltip>
      {link && (
        <PopoverContent align="start" side="bottom" className="w-80 space-y-2.5 text-xs" data-link-popover={spec.key} onOpenAutoFocus={(e) => e.preventDefault()}>
          <LinkEditor clip={clip} effect={effect} def={def} spec={spec} label={label} ctx={ctx} link={link} />
        </PopoverContent>
      )}
    </Popover>
  );
}

/** What a scrub or a pick does to the link: one-shot edits, or a gesture while a number is dragged. */
function useLinkEdits(clipId: string, effectId: string, key: string) {
  const gesture = useRef<EditGesture | null>(null);
  const write = (next: ParamLink) => (p: Project) => setLink(p, clipId, effectId, key, next);
  return {
    set: (next: ParamLink) => useEditor.getState().commit(write(next)),
    begin: () => {
      gesture.current = new EditGesture();
      gesture.current.begin();
    },
    change: (next: ParamLink) => {
      if (gesture.current) gesture.current.apply(write(next));
      else useEditor.getState().commit(write(next));
    },
    end: () => {
      gesture.current?.end();
      gesture.current = null;
    },
  };
}

const MS: { min: number; max: number; step: number; decimals: number; unit: string } = { min: 0, max: 10_000, step: 5, decimals: 0, unit: "ms" };
const PERCENT = { min: 0, max: 99, step: 1, decimals: 0, unit: "%" };

function LinkEditor({ clip, effect, def, spec, label, ctx, link }: LinkButtonProps & { link: ParamLink }) {
  const view = useEditor((s) => s.project);
  const edits = useLinkEdits(clip.id, effect.id, spec.key);
  const hits = isHits(link.signal, view);
  const custom = "id" in link.signal;
  const point = spec.kind === "vec2";
  const response = (patch: Partial<SignalResponse>) => ({ ...link, response: { ...link.response, ...patch } });
  const hit = link.hit ?? DEFAULT_HIT;
  const withHit = (patch: Partial<HitShape>) => ({ ...link, hit: { ...hit, ...patch } });

  /** A number of the link (in the parameter's display units). */
  const amountRow = (title: string, value: number | Vec2, set: (v: number | Vec2) => ParamLink, factor = false) => (
    <Row title={title}>
      {point ? (
        ([0, 1] as const).map((axis) => {
          const v: Vec2 = typeof value === "number" ? [value, value] : value;
          const shown = toDisplay(spec as Vec2Spec, v, ctx);
          return (
            <ScrubNumber
              key={axis}
              value={shown[axis]}
              display={{ ...numberDisplay(spec as Vec2Spec, ctx, axis), min: -1e6, max: 1e6 }}
              label={`${label} ${title} ${axis === 0 ? "X" : "Y"}`}
              onBegin={edits.begin}
              onChange={(n) => edits.change(set(fromDisplay(spec as Vec2Spec, axis === 0 ? [n, shown[1]] : [shown[0], n], ctx)))}
              onEnd={edits.end}
            />
          );
        })
      ) : factor ? (
        <ScrubNumber
          value={(value as number) * 100}
          display={{ min: -1000, max: 10_000, step: 1, decimals: 0, unit: "%" }}
          label={`${label} ${title}`}
          onBegin={edits.begin}
          onChange={(n) => edits.change(set(n / 100))}
          onEnd={edits.end}
        />
      ) : (
        <ScrubNumber
          value={toDisplay(spec as NumberSpec, value as number)}
          display={{ ...numberDisplay(spec as NumberSpec, ctx), min: -1e6, max: 1e6 }}
          label={`${label} ${title}`}
          onBegin={edits.begin}
          onChange={(n) => edits.change(set(fromDisplay(spec as NumberSpec, n)))}
          onEnd={edits.end}
        />
      )}
    </Row>
  );

  const seconds = (title: string, value: number, set: (s: number) => ParamLink) => (
    <Row title={title}>
      <ScrubNumber value={value * 1000} display={MS} label={`${label} ${title}`} onBegin={edits.begin} onChange={(ms) => edits.change(set(ms / 1000))} onEnd={edits.end} />
    </Row>
  );

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="font-medium">{label} follows</span>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => {
            useLinkPopover.setState({ open: null });
            useEditor.getState().commit((p) => setLink(p, clip.id, effect.id, spec.key, null));
          }}
        >
          <PiLinkSimpleBreak className="size-3.5" /> Unlink
        </button>
      </div>
      <div className="flex gap-1.5">
        <Select
          value={refValue(link.signal)}
          onValueChange={(v) => {
            const ref = refFrom(v);
            const keep = "name" in ref && "name" in link.signal && link.signal.source ? { ...ref, source: link.signal.source } : ref;
            const next: ParamLink = { ...link, signal: keep };
            // Hits take a shape (a punch each); levels don't.
            if (isHits(ref, view)) next.hit = next.hit ?? { ...DEFAULT_HIT };
            else delete next.hit;
            edits.set(next);
          }}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label={`${label}: signal`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {signalOptions(view).map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
            {custom && !view.signals?.some((d) => "id" in link.signal && d.id === link.signal.id) && (
              <SelectItem value={refValue(link.signal)} disabled>
                A deleted signal
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        {!custom && (
          <Select
            value={sourceValue("name" in link.signal ? link.signal.source : undefined, clip.id)}
            onValueChange={(v) => {
              const source = sourceFrom(v, clip.id);
              const name = (link.signal as { name: string }).name;
              edits.set({ ...link, signal: source ? { name, source } : { name } });
            }}
          >
            <SelectTrigger size="sm" className="w-32" aria-label={`${label}: heard from`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sourceOptions(view, clip).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="grid grid-cols-3 gap-0.5 rounded-md bg-muted/40 p-0.5" role="radiogroup" aria-label={`${label}: how it moves`}>
        {(["add", "multiply", "map"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={link.mode === mode}
            onClick={() => {
              if (mode === link.mode) return;
              const base = effectValuesAt(def, { ...effect, links: undefined }, sourceTime(clip, usePlayback.getState().time), clip)[spec.key] as number | Vec2;
              const next: ParamLink = { ...link, mode };
              if (mode === "map") next.to = typeof base === "number" ? base + (typeof link.amount === "number" ? link.amount : 0) : (link.amount as Vec2).map((a, i) => (base as Vec2)[i] + a) as Vec2;
              else delete next.to;
              if (mode === "multiply") next.amount = point ? [0.3, 0.3] : 0.3;
              if (mode === "add" && link.mode === "multiply") next.amount = defaultLink(spec).amount;
              edits.set(next);
            }}
            className={cn(
              "cursor-pointer rounded px-2 py-1 capitalize transition-colors",
              link.mode === mode ? "raised bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {mode === "map" ? "Map to" : mode}
          </button>
        ))}
      </div>
      {link.mode === "map"
        ? amountRow("At full", link.to ?? 0, (v) => ({ ...link, to: v }))
        : amountRow(link.mode === "multiply" ? "Up to" : "By", link.amount, (v) => ({ ...link, amount: v }), link.mode === "multiply" && !point)}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {hits ? (
          <>
            {seconds("Hit attack", hit.attack, (s) => withHit({ attack: s }))}
            {seconds("Hold", hit.hold, (s) => withHit({ hold: s }))}
            {seconds("Decay", hit.decay, (s) => withHit({ decay: s }))}
          </>
        ) : (
          <>
            {seconds("Attack", link.response.attack, (s) => response({ attack: s }))}
            {seconds("Release", link.response.release, (s) => response({ release: s }))}
          </>
        )}
        <Row title="Threshold">
          <ScrubNumber
            value={link.response.threshold * 100}
            display={PERCENT}
            label={`${label} threshold`}
            onBegin={edits.begin}
            onChange={(n) => edits.change(response({ threshold: n / 100 }))}
            onEnd={edits.end}
          />
        </Row>
        <Row title="Curve">
          <ScrubNumber
            value={link.response.curve}
            display={{ min: 0.1, max: 10, step: 0.05, decimals: 2 }}
            label={`${label} curve`}
            onBegin={edits.begin}
            onChange={(n) => edits.change(response({ curve: n }))}
            onEnd={edits.end}
          />
        </Row>
        <label className="flex items-center justify-between gap-2 text-muted-foreground">
          Invert
          <Switch checked={link.response.invert} onCheckedChange={(on) => edits.set(response({ invert: on }))} aria-label={`${label}: invert`} />
        </label>
      </div>
      <LinkMeter clip={clip} effect={effect} def={def} spec={spec} link={link} />
    </>
  );
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{title}</span>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
    </div>
  );
}

/** The signal now (a bar, 0..1) and the value it gives the property, live while playing. */
function LinkMeter({ clip, effect, def, spec, link }: { clip: Clip; effect: Effect; def: EffectDefinition; spec: ParamSpec; link: ParamLink }) {
  const time = usePlayback((s) => s.time);
  const fps = useEditor((s) => s.project.settings.fps);
  // Re-read when the sound's signals arrive.
  const reader = currentSignalReader();
  const found = reader ? findClip(reader.document, clip.id) : undefined;
  const at = Math.min(Math.max(time, clip.start), clip.start + (clip.out - clip.in));
  const level = reader && found ? linkLevel(reader, found.sequenceId, link, timelineTime(found.clip, sourceTime(clip, at))) : 0;
  const result = atFrameRate(fps, () => effectValuesAt(def, effect, sourceTime(clip, at), clip))[spec.key];
  const shown = (v: unknown) => (typeof v === "number" ? round(v, spec) : Array.isArray(v) ? `[${(v as number[]).map((x) => round(x, spec)).join(", ")}]` : "");
  return (
    <div className="space-y-1" data-link-meter>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" title="The signal now">
        <div className="h-full rounded-full bg-brand transition-[width] duration-75" style={{ width: `${Math.round(Math.min(1, Math.max(0, level)) * 100)}%` }} />
      </div>
      <p className="text-[10px] text-muted-foreground tabular-nums" data-link-value>
        {reader ? `Now ${Math.round(level * 100)}%: ${shown(result)}` : "Waiting for the sound to be analysed…"}
      </p>
    </div>
  );
}

const round = (v: number, spec: ParamSpec) => {
  const scale = spec.kind === "number" ? (spec.scale ?? 1) : 1;
  return `${Math.round(v * scale * 100) / 100}${spec.kind === "number" && spec.unit ? spec.unit : ""}`;
};
