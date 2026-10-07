import { type CSSProperties, useEffect, useState } from "react";
import { PiArrowArcLeft, PiArrowArcRight, PiCaretDown, PiCaretLeftFill, PiCaretRightFill, PiDotsThreeVertical, PiPower } from "react-icons/pi";
import { cn } from "cn";
import { mixerTrackName } from "@shared/music/automation";
import { proLLatencySeconds } from "@shared/music/pro-l";
import { PRO_L_PRESETS, type ProLPreset, normalizeProLState } from "@shared/music/pro-l-presets";
import { type MixerEffect, type MusicProject, PRO_L_DISPLAY_MODES, PRO_L_DITHER, PRO_L_METER_SCALES, PRO_L_NOISE_SHAPINGS, PRO_L_OVERSAMPLING, type ProL, type ProLDisplayMode, type ProLMeterScale, type ProLNoiseShaping } from "@shared/music/types";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canRedo, canUndo } from "@/lib/document-history";
import { AutomateTouched } from "../automation/touched";
import { useMusic, useSong } from "../store";
import { useTransport } from "../transport";
import { proLWindow } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { chooseProL, closeProL, copyProLState, copyToOtherSlot, pasteProLState, presetName, setProL, stepProLPreset, toggleBypass, toggleProLAB } from "./actions";
import { GainSlider, MainControls, STYLE_NAMES, Toggle } from "./controls";
import { LevelDisplay, PLOT_TOP } from "./display";
import { LoudnessPanel, Meters } from "./meters";
import { useLimUi } from "./store";

/** As it opens (smaller if the desktop is). */
const WIDTH = 960;
const HEIGHT = 600;
const MIN = { minWidth: 900, minHeight: 520 };

/** Pro-C's controls drawn in YT-L's tokens: its look is its own (`--lim-*`, dark in every theme), Pro-C's knob reads `--comp-*`. */
const TOKENS = {
  "--comp-arc": "var(--lim-arc)",
  "--comp-knob": "var(--lim-knob)",
  "--comp-knob-light": "var(--lim-knob-light)",
  "--comp-knob-dark": "var(--lim-knob-dark)",
  "--comp-knob-edge": "var(--lim-knob-edge)",
  "--comp-label": "var(--lim-label)",
  "--comp-text": "var(--lim-text)",
  "--comp-bar": "var(--lim-bar)",
  "--comp-panel-edge": "var(--lim-panel-edge)",
  "--comp-ring": "var(--lim-meter)",
  "--comp-ring-hot": "var(--lim-meter-hot)",
  "--comp-handle-top": "var(--lim-handle-top)",
  "--comp-handle-bottom": "var(--lim-handle-bottom)",
} as CSSProperties;

function effectOf(song: MusicProject, effectId: string): MixerEffect | null {
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect;
  return null;
}
const trackOf = (song: MusicProject, effectId: string) => song.mixer.tracks.find((t) => t.effects.some((e) => e?.id === effectId))?.id ?? "";

/**
 * A YT-L's window (`docs/fabfilter/pro-l.md` §2, §8.6), FabFilter's limiter in our drawing: the top bar (undo,
 * A/B, presets, Lock Output), Gain at the left of the level display, the meters and the loudness panel at its
 * right, the controls under it, and the bottom bar (oversampling, dither, DC, Unity Gain, Audition, the display
 * and meter settings, the latency, bypass). Dark in every theme, as a plugin's is.
 */
export function ProLWindow({ effectId, index }: { effectId: string; index: number }) {
  const effect = useSong((s) => effectOf(s, effectId));
  const owner = useSong((s) => mixerTrackName(s, trackOf(s, effectId)));
  const id = proLWindow(effectId);
  const [initial] = useState(() => {
    const desktop = document.querySelector('[data-desktop="music"]')?.getBoundingClientRect();
    const width = Math.max(MIN.minWidth, Math.min(WIDTH, (desktop?.width ?? WIDTH) - 16));
    const height = Math.max(MIN.minHeight, Math.min(HEIGHT, (desktop?.height ?? HEIGHT) - 16));
    const place = centredOnDesktop(width, height);
    return { ...place, x: place.x + index * 28, y: Math.min(place.y, 40) + index * 28, width, height };
  });
  const proL = effect?.proL;
  const gone = !proL;
  useEffect(() => {
    if (gone) closeProL(effectId);
  }, [gone, effectId]);
  if (!effect || !proL) return null;
  return (
    <MusicWindow id={id} title={`${effect.plugin.name} (${owner})`} initial={initial} resizable={MIN} onClose={() => closeProL(effectId)} controls={<AutomateTouched effectId={effectId} />}>
      <div className="flex h-full min-h-0 flex-col bg-[var(--lim-bg-top)] text-xs text-[var(--lim-text)] select-none" style={TOKENS} data-testid="pro-l" data-effect={effectId} data-style={proL.style}>
        <TopBar effectId={effectId} proL={proL} />
        <div className="relative flex min-h-0 flex-1">
          <GainColumn effectId={effectId} proL={proL} />
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <LevelDisplay effectId={effectId} proL={proL} bypassed={!effect.enabled} />
          </div>
          <Meters effectId={effectId} proL={proL} top={PLOT_TOP + 10} bottom={10} />
          <LoudnessPanel effectId={effectId} proL={proL} />
        </div>
        <div className="shrink-0 border-t border-[var(--lim-panel-edge)] bg-gradient-to-b from-[var(--lim-panel)] to-[var(--lim-section)] py-2">
          <MainControls effectId={effectId} proL={proL} />
        </div>
        <BottomBar effectId={effectId} proL={proL} enabled={effect.enabled} />
      </div>
    </MusicWindow>
  );
}

/** Gain's slider as tall as the display. */
function GainColumn({ effectId, proL }: { effectId: string; proL: ProL }) {
  const [height, setHeight] = useState(200);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return (
    <div ref={setElement} className="flex">
      <GainSlider effectId={effectId} proL={proL} length={Math.max(80, height - 52)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The top bar
// ---------------------------------------------------------------------------

const FOLDERS: ProLPreset["folder"][] = ["Master", "Vocal", "Drums and bass", "Delivery"];

function TopBar({ effectId, proL }: { effectId: string; proL: ProL }) {
  const history = useMusic((s) => s.history);
  const copied = useLimUi((s) => s.copiedState !== null);
  useLimUi((s) => s.lastPreset[effectId]);
  // The preset loaded is remembered, so its name stays (dimmed) once it's changed.
  useEffect(() => {
    const last = useLimUi.getState().lastPreset;
    if (proL.preset && last[effectId] !== proL.preset) useLimUi.setState({ lastPreset: { ...last, [effectId]: proL.preset } });
  }, [effectId, proL.preset]);
  const name = presetName(effectId, proL);
  const same = !!proL.other && JSON.stringify(proL.other) === JSON.stringify(normalizeProLState(proL));
  const button = "rounded-sm px-1.5 py-0.5 text-[var(--lim-label)] outline-none hover:text-[var(--lim-text)] disabled:opacity-35 disabled:hover:text-[var(--lim-label)]";
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-black/50 bg-[var(--lim-bar)] px-2" data-testid="pro-l-top">
      <span className="mr-3 flex items-baseline font-semibold tracking-wide" aria-hidden>
        <span className="text-[15px] text-[var(--lim-arc)]">YT-L</span>
        <span className="ml-1.5 text-[9.5px] font-medium tracking-[0.14em] text-[var(--lim-label)]">LIMITER</span>
      </span>
      <button type="button" aria-label="Undo" className={button} disabled={!history || !canUndo(history)} onClick={() => useMusic.getState().undo()}>
        <PiArrowArcLeft className="size-3.5" />
      </button>
      <button type="button" aria-label="Redo" className={button} disabled={!history || !canRedo(history)} onClick={() => useMusic.getState().redo()}>
        <PiArrowArcRight className="size-3.5" />
      </button>
      <button type="button" aria-label="A/B" data-testid="pro-l-ab" className={cn(button, "ml-3 tabular-nums")} onClick={() => toggleProLAB(effectId)} title="Switch between two settings">
        <span className={proL.slot === "a" ? "text-[var(--lim-text)]" : ""}>A</span>/<span className={proL.slot === "b" ? "text-[var(--lim-text)]" : ""}>B</span>
      </button>
      <button type="button" className={button} disabled={same} onClick={() => copyToOtherSlot(effectId)} title={`Copy ${proL.slot.toUpperCase()} to ${proL.slot === "a" ? "B" : "A"}`}>
        Copy
      </button>

      <div className="mx-auto flex items-center gap-1">
        <button type="button" aria-label="Previous preset" className={button} onClick={() => stepProLPreset(effectId, -1)}>
          <PiCaretLeftFill className="size-2.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Presets"
              data-testid="pro-l-preset"
              title={proL.preset ? (PRO_L_PRESETS.find((p) => p.name === proL.preset)?.detail ?? "") : "Changed since the preset was loaded"}
              className={cn("min-w-[200px] rounded-sm px-2 py-0.5 text-center text-[12.5px] outline-none hover:bg-white/5", proL.preset ? "text-[var(--lim-text)]" : "text-[var(--lim-label)] italic")}
            >
              {name ?? "Untitled"}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-52" data-testid="pro-l-presets">
            {FOLDERS.map((folder) => (
              <DropdownMenuSub key={folder}>
                <DropdownMenuSubTrigger>{folder}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-[330px]">
                  {PRO_L_PRESETS.filter((p) => p.folder === folder).map((p) => (
                    <DropdownMenuItem key={p.name} onSelect={() => chooseProL(effectId, p.name)} className="items-start py-1.5">
                      <span className="flex min-w-0 flex-col">
                        <span className={cn("font-medium", proL.preset === p.name && "text-brand")}>
                          {proL.preset === p.name ? "✓ " : ""}
                          {p.name}
                        </span>
                        <span className="text-[11px] leading-snug text-muted-foreground">{p.detail}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" aria-label="Next preset" className={button} onClick={() => stepProLPreset(effectId, 1)}>
          <PiCaretRightFill className="size-2.5" />
        </button>
      </div>

      <Toggle on={proL.lockOutput} label="Lock Output" title="Lock Output: presets leave the Output Level, True Peak and dither alone" testId="pro-l-lock-output" onToggle={() => setProL(effectId, { lockOutput: !proL.lockOutput })} />
      <span className="ml-2 w-[90px] truncate text-right text-[10.5px] text-[var(--lim-label)]">
        Style · <span className="text-[var(--lim-text)]">{STYLE_NAMES[proL.style]}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="YT-L's options" className={button}>
            <PiDotsThreeVertical className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => chooseProL(effectId, "Default Setting")}>Reset to the default setting</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => copyProLState(effectId)}>Copy state</DropdownMenuItem>
          <DropdownMenuItem disabled={!copied} onSelect={() => pasteProLState(effectId)}>
            Paste state
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The bottom bar
// ---------------------------------------------------------------------------

const SHAPING_NAMES: Record<ProLNoiseShaping, string> = { none: "None", basic: "Basic", optimized: "Optimized", weighted: "Weighted" };
const SCALE_NAMES: Record<ProLMeterScale, string> = { "16": "16 dB", "32": "32 dB", "48": "48 dB", k12: "K-12", k14: "K-14", k20: "K-20", loudness: "48 dB (loudness)" };
const DISPLAY_NAMES: Record<ProLDisplayMode, string> = { slowDown: "Slow Down", fast: "Fast", slow: "Slow", infinite: "Infinite", off: "Off" };
const AUDITION_NAMES: Record<ProL["audition"], string> = { off: "Off", all: "All it takes away", clip: "The clip stage's share", limiter: "The limiter's share" };

function BottomBar({ effectId, proL, enabled }: { effectId: string; proL: ProL; enabled: boolean }) {
  const latency = useTransport((s) => s.limiters[effectId]?.latency ?? null);
  const rate = useTransport((s) => s.sampleRate);
  const label = "text-[var(--lim-label)]";
  const menuButton = "flex items-center gap-1 rounded-sm px-1.5 py-0.5 outline-none hover:bg-white/5";
  const latencyMs = latency !== null && latency > 0 ? (latency / rate) * 1000 : proLLatencySeconds(proL) * 1000;
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-t border-black/50 bg-[var(--lim-bottom-bar)] px-3 text-[11px]" data-testid="pro-l-bottom">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Oversampling" className={menuButton}>
            <span className={label}>Oversampling:</span> {proL.oversampling === 1 ? "Off" : `${proL.oversampling}x`}
            <PiCaretDown className="size-2.5 text-[var(--lim-label)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Oversampling (fewer peaks between the samples, a little latency)</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(proL.oversampling)} onValueChange={(v) => setProL(effectId, { oversampling: Number(v) as ProL["oversampling"] })}>
            {PRO_L_OVERSAMPLING.map((o) => (
              <DropdownMenuRadioItem key={o} value={String(o)}>
                {o === 1 ? "Off" : `${o}x`}
                {o === 16 && <span className="ml-auto pl-3 text-[10px] text-muted-foreground">CPU-intensive</span>}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Dither" data-testid="pro-l-dither" className={menuButton}>
            <span className={label}>Dither:</span> {proL.dither ? `${proL.dither} bits` : "Off"}
            <PiCaretDown className="size-2.5 text-[var(--lim-label)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Dither (only last, before a 16-bit file)</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(proL.dither)} onValueChange={(v) => setProL(effectId, { dither: Number(v) as ProL["dither"] })}>
            {PRO_L_DITHER.map((bits) => (
              <DropdownMenuRadioItem key={bits} value={String(bits)}>
                {bits ? `${bits} bits` : "Off"}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Noise shaping</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={proL.noiseShaping} onValueChange={(v) => setProL(effectId, { noiseShaping: v as ProLNoiseShaping })}>
            {PRO_L_NOISE_SHAPINGS.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                {SHAPING_NAMES[s]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Toggle on={proL.dcFilter} label="DC" title="Remove DC (a 1.5 Hz high-pass)" testId="pro-l-dc" onToggle={() => setProL(effectId, { dcFilter: !proL.dcFilter })} />
      <Toggle on={proL.unityGain} label="Unity Gain" title="Unity Gain: hear it at the level it came in (Gain taken back off), to judge the sound and not the loudness" testId="pro-l-unity" onToggle={() => setProL(effectId, { unityGain: !proL.unityGain })} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Audition" data-testid="pro-l-audition" className={cn(menuButton, proL.audition !== "off" && "text-[var(--lim-loud-near)]")}>
            <span className={label}>Audition:</span> {proL.audition === "off" ? "Off" : proL.audition === "all" ? "All" : proL.audition === "clip" ? "Clip" : "Limiter"}
            <PiCaretDown className="size-2.5 text-[var(--lim-label)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Listen to what it takes away</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={proL.audition} onValueChange={(v) => setProL(effectId, { audition: v as ProL["audition"] })}>
            {(["off", "all", "clip", "limiter"] as const).map((a) => (
              <DropdownMenuRadioItem key={a} value={a}>
                {AUDITION_NAMES[a]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Display" className={menuButton}>
              <span className={label}>Display:</span> {DISPLAY_NAMES[proL.meter.display]}
              <PiCaretDown className="size-2.5 text-[var(--lim-label)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={proL.meter.display} onValueChange={(v) => setProL(effectId, { meter: { display: v as ProLDisplayMode } })}>
              {PRO_L_DISPLAY_MODES.map((m) => (
                <DropdownMenuRadioItem key={m} value={m}>
                  {DISPLAY_NAMES[m]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Meter scale" className={menuButton}>
              {SCALE_NAMES[proL.meter.scale]}
              <PiCaretDown className="size-2.5 text-[var(--lim-label)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={proL.meter.scale} onValueChange={(v) => setProL(effectId, { meter: { scale: v as ProLMeterScale } })}>
              {PRO_L_METER_SCALES.filter((s) => s !== "loudness").map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {SCALE_NAMES[s]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={proL.meter.truePeakMeter} onCheckedChange={(on) => setProL(effectId, { meter: { truePeakMeter: on === true } })}>
              True peak metering
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className={cn(label, "text-[10px] tabular-nums")} title="How late it plays (the mixer delays the rest to match)">
          {latencyMs.toFixed(1)} ms
        </span>
        <button
          type="button"
          aria-label={enabled ? "Bypass" : "Enable"}
          aria-pressed={!enabled}
          title="Bypass (latency compensated)"
          className={cn("relative rounded-sm p-1 outline-none hover:bg-white/5", enabled ? "text-[var(--lim-label)]" : "text-[var(--lim-reduction)]")}
          onClick={() => toggleBypass(effectId)}
        >
          <PiPower className="size-3.5" />
          {!enabled && <span className="absolute inset-x-0.5 -top-1 h-0.5 rounded bg-[var(--lim-reduction)]" />}
        </button>
      </div>
    </div>
  );
}
