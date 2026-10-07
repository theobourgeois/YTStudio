/**
 * YT-L's controls (`docs/fabfilter/pro-l.md` §2.3, §2.4, §5.7): the Gain slider at the display's left, and the
 * panel under the display: the Style with what it does, Lookahead, Attack and Release (greyed for the styles
 * without a release stage), Hold (AUTO: half the bass's period), the stereo mode with its links or the side's
 * floor, the clip stage (on, Range, shape, knee, before or after the limiter) and the Output Level with True Peak.
 * Pro-C's knobs, in YT-L's colours.
 */
import type { ReactNode } from "react";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { formatProLTime, updateProL } from "@shared/music/pro-l";
import { PRO_L_STYLE_SPECS } from "@shared/music/pro-l-presets";
import { PRO_L_CLIP_SHAPES, PRO_L_STYLES, type ProL, type ProLClipShape, type ProLStyle } from "@shared/music/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AutoToggle, Caption, SongBarSlider, SongCompKnob } from "../pro-c/knob";
import { setProL } from "./actions";
import { controlProps } from "./specs";

const BIG = 50;
const SMALL = 38;

export const STYLE_NAMES: Record<ProLStyle, string> = {
  transparent: "Transparent",
  punchy: "Punchy",
  dynamic: "Dynamic",
  allround: "Allround",
  aggressive: "Aggressive",
  modern: "Modern",
  bus: "Bus",
  safe: "Safe",
  spit: "Spit",
};
export const CLIP_SHAPE_NAMES: Record<ProLClipShape, { name: string; detail: string }> = {
  hard: { name: "Hard", detail: "A straight cut at its level: the most loudness, the most edge" },
  smooth: { name: "Smooth", detail: "A rounded knee (its width the Knee knob): the default" },
  soft: { name: "Soft", detail: "Rounds the peaks from well under them: warm, gentle" },
  converter: { name: "Converter", detail: "An A/D converter driven over: tanh in the top 6 dB" },
  fl: { name: "FL", detail: "FL Studio's Fruity Soft Clipper, as measured" },
};

/** The Gain slider (Pro-L 2's big one, left of the display): how hard it's pushed, its value above it. */
export function GainSlider({ effectId, proL, length }: { effectId: string; proL: ProL; length: number }) {
  const props = controlProps(effectId, proL, "gain");
  return (
    <div className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-black/50 bg-[var(--lim-section)] pt-1.5" data-testid="pro-l-gain">
      <span className="text-[11px] font-semibold text-[var(--lim-text)] tabular-nums">{`${proL.gain > 0 ? "+" : ""}${proL.gain.toFixed(1)}`}</span>
      <SongBarSlider {...props} vertical length={length} testId="pro-l-knob-gain" />
      <Caption className="mt-0">Gain</Caption>
    </div>
  );
}

/** A column of the panel: a knob and its caption. */
function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col items-center", className)}>{children}</div>;
}

/** Lookahead: the style's range (not automatable: it moves where the ramp starts). */
function LookaheadKnob({ effectId, proL }: { effectId: string; proL: ProL }) {
  const range = PRO_L_STYLE_SPECS[proL.style].range;
  const fraction = clamp(proL.lookahead / range, 0, 1);
  const toSeconds = (f: number) => Math.round(clamp(f, 0, 1) * range * 1e5) / 1e5;
  return (
    <SongCompKnob
      label="Lookahead"
      value={fraction}
      defaultValue={clamp(PRO_L_STYLE_SPECS[proL.style].start.lookahead / range, 0, 1)}
      format={(f) => formatProLTime(toSeconds(f))}
      typed={(f) => String(Number((toSeconds(f) * 1000).toPrecision(3)))}
      parse={(text) => {
        const n = Number.parseFloat(text.replace(",", "."));
        return Number.isFinite(n) ? clamp(n / 1000 / range, 0, 1) : null;
      }}
      edit={(song, f) => updateProL(song, effectId, { lookahead: toSeconds(f) })}
      size={SMALL}
      testId="pro-l-knob-lookahead"
      caption={<Caption>Lookahead</Caption>}
    />
  );
}

/** Hold: its knob, and AUTO (half the bass's period, so a bass note isn't distorted). */
function HoldKnob({ effectId, proL }: { effectId: string; proL: ProL }) {
  const auto = proL.hold === null;
  return (
    <SongCompKnob
      {...controlProps(effectId, proL, "hold")}
      size={SMALL}
      disabled={auto}
      testId="pro-l-knob-hold"
      caption={
        <Caption>
          <AutoToggle on={auto} label="Auto Hold: half the bass's period" testId="pro-l-auto-hold" onToggle={() => setProL(effectId, { hold: auto ? 0.005 : null })} />
          Hold
        </Caption>
      }
    />
  );
}

function StyleButton({ effectId, proL }: { effectId: string; proL: ProL }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Style"
          data-testid="pro-l-style"
          title={PRO_L_STYLE_SPECS[proL.style].hint}
          className="min-w-[96px] rounded-[4px] border border-[var(--lim-panel-edge)] bg-gradient-to-b from-[var(--lim-button-top)] to-[var(--lim-button-bottom)] px-2 py-1 text-[12px] font-medium text-[var(--lim-text)] outline-none hover:brightness-110"
        >
          {STYLE_NAMES[proL.style]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-[330px]">
        <DropdownMenuLabel>Style</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={proL.style} onValueChange={(v) => setProL(effectId, { style: v as ProLStyle })}>
          {PRO_L_STYLES.map((style) => (
            <DropdownMenuRadioItem key={style} value={style} className="items-start py-1.5">
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{STYLE_NAMES[style]}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">{PRO_L_STYLE_SPECS[style].hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A small two-way switch (L/R · M/S, First · Last). */
function Switch<T extends string>({ value, options, onChange, label, testId }: { value: T; options: { id: T; name: string; title: string }[]; onChange: (v: T) => void; label: string; testId?: string }) {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} className="flex overflow-hidden rounded-[4px] border border-[var(--lim-panel-edge)] text-[10.5px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          title={o.title}
          className={cn("px-1.5 py-0.5 outline-none", value === o.id ? "bg-[var(--lim-arc)] font-semibold text-black" : "text-[var(--lim-label)] hover:text-[var(--lim-text)]")}
          onClick={() => onChange(o.id)}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}

/** A lit toggle (Clip, True Peak). */
export function Toggle({ on, label, title, onToggle, testId }: { on: boolean; label: string; title: string; onToggle: () => void; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      data-testid={testId}
      className={cn("rounded-[4px] border px-1.5 py-0.5 text-[10.5px] font-semibold tracking-[0.06em] uppercase outline-none", on ? "border-[var(--lim-arc)] text-[var(--lim-arc)]" : "border-[var(--lim-panel-edge)] text-[var(--lim-label)] hover:text-[var(--lim-text)]")}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

/** The panel under the display. */
export function MainControls({ effectId, proL }: { effectId: string; proL: ProL }) {
  const spec = PRO_L_STYLE_SPECS[proL.style];
  const ms = proL.stereo === "ms";
  return (
    <div className="flex items-start justify-center gap-3 px-2" data-testid="pro-l-controls" data-style={proL.style}>
      <Cell className="gap-1.5 pt-2">
        <StyleButton effectId={effectId} proL={proL} />
        <span className="max-w-[110px] text-center text-[9.5px] leading-tight text-[var(--lim-label)]">{spec.timed ? "Attack and Release shape its slow stage" : "No slow stage: Attack and Release do nothing"}</span>
      </Cell>
      <LookaheadKnob effectId={effectId} proL={proL} />
      <SongCompKnob {...controlProps(effectId, proL, "attack")} size={SMALL} disabled={!spec.timed} testId="pro-l-knob-attack" caption={<Caption disabled={!spec.timed}>Attack</Caption>} />
      <SongCompKnob {...controlProps(effectId, proL, "release")} size={SMALL} disabled={!spec.timed} testId="pro-l-knob-release" caption={<Caption disabled={!spec.timed}>Release</Caption>} />
      <HoldKnob effectId={effectId} proL={proL} />

      <div className="flex flex-col items-center gap-1 border-l border-[var(--lim-panel-edge)] pl-3">
        <Switch
          label="Stereo"
          testId="pro-l-stereo"
          value={proL.stereo}
          onChange={(stereo) => setProL(effectId, { stereo })}
          options={[
            { id: "lr", name: "L/R", title: "Left and right, linked by the Channel Link knobs" },
            { id: "ms", name: "M/S", title: "Mid/side: the side turned down first, so the centre (kick, 808, vocal) stays put" },
          ]}
        />
        <div className="flex gap-1">
          {ms ? (
            <SongCompKnob {...controlProps(effectId, proL, "sideFloor")} size={SMALL} testId="pro-l-knob-side-floor" caption={<Caption>Side Floor</Caption>} />
          ) : (
            <>
              <SongCompKnob {...controlProps(effectId, proL, "linkTransients")} size={SMALL} testId="pro-l-knob-link-transients" caption={<Caption>Transients</Caption>} />
              <SongCompKnob {...controlProps(effectId, proL, "linkRelease")} size={SMALL} testId="pro-l-knob-link-release" caption={<Caption>Release</Caption>} />
            </>
          )}
        </div>
      </div>

      <ClipPanel effectId={effectId} proL={proL} />

      <div className="flex flex-col items-center gap-1 border-l border-[var(--lim-panel-edge)] pl-3">
        <SongCompKnob {...controlProps(effectId, proL, "output")} size={BIG} testId="pro-l-knob-output" caption={<Caption>{proL.truePeak ? "Output (dBTP)" : "Output"}</Caption>} />
        <Toggle on={proL.truePeak} label="True Peak" title="True Peak Limiting: the ceiling holds between the samples too, as streaming services ask (−1 dBTP)" testId="pro-l-true-peak" onToggle={() => setProL(effectId, { truePeak: !proL.truePeak })} />
      </div>
    </div>
  );
}

/** The clip stage: on, Range (its gap over the limiter), the shape, the knee (Smooth), first or last. */
function ClipPanel({ effectId, proL }: { effectId: string; proL: ProL }) {
  const off = !proL.clip;
  return (
    <div className="flex flex-col items-center gap-1 border-l border-[var(--lim-panel-edge)] pl-3" data-testid="pro-l-clip" data-on={proL.clip || undefined}>
      <div className="flex items-center gap-1.5">
        <Toggle on={proL.clip} label="Clip" title="The clip stage: a clipper before the limiter (the loud masters' way), anti-aliased at 4x at least" testId="pro-l-clip-on" onToggle={() => setProL(effectId, { clip: !proL.clip })} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Clip shape" data-testid="pro-l-clip-shape" title={CLIP_SHAPE_NAMES[proL.clipShape].detail} className={cn("rounded-[4px] border border-[var(--lim-panel-edge)] px-1.5 py-0.5 text-[10.5px] outline-none hover:text-[var(--lim-text)]", off ? "text-[var(--lim-label)]" : "text-[var(--lim-text)]")}>
              {CLIP_SHAPE_NAMES[proL.clipShape].name}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-[300px]">
            <DropdownMenuLabel>Clip shape</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={proL.clipShape} onValueChange={(v) => setProL(effectId, { clipShape: v as ProLClipShape, clip: true })}>
              {PRO_L_CLIP_SHAPES.map((shape) => (
                <DropdownMenuRadioItem key={shape} value={shape} className="items-start py-1.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{CLIP_SHAPE_NAMES[shape].name}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">{CLIP_SHAPE_NAMES[shape].detail}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Switch
          label="Clip order"
          testId="pro-l-clip-order"
          value={proL.clipOrder}
          onChange={(clipOrder) => setProL(effectId, { clipOrder })}
          options={[
            { id: "first", name: "First", title: "Clip, then limit: the clipper takes the peaks, the limiter the rest" },
            { id: "last", name: "Last", title: "Limit, then clip at the ceiling: FL Studio's Emphasizer" },
          ]}
        />
      </div>
      <div className="flex gap-1">
        <SongCompKnob {...controlProps(effectId, proL, "clipRange")} size={SMALL} disabled={off} testId="pro-l-knob-clip-range" caption={<Caption disabled={off}>Range</Caption>} />
        <SongCompKnob {...controlProps(effectId, proL, "clipKnee")} size={SMALL} disabled={off || proL.clipShape !== "smooth"} testId="pro-l-knob-clip-knee" caption={<Caption disabled={off || proL.clipShape !== "smooth"}>Knee</Caption>} />
      </div>
    </div>
  );
}
