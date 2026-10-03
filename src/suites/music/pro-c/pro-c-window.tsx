import { useEffect, useRef, useState } from "react";
import { PiArrowArcLeft, PiArrowArcRight, PiArrowsInSimple, PiArrowsOutSimple, PiCaretDown, PiCaretLeftFill, PiCaretRightFill, PiDotsThreeVertical, PiPower, PiWaveform } from "react-icons/pi";
import { cn } from "cn";
import { mixerTrackName } from "@shared/music/automation";
import { PRO_C_GROUPS, PRO_C_OVERSAMPLING, PRO_C_PRESETS, PRO_C_STYLE_INFO, type ProCPreset, normalizeProCState, styleGroup } from "@shared/music/pro-c-presets";
import { updateProC } from "@shared/music/pro-c";
import type { MixerEffect, MusicProject, ProC } from "@shared/music/types";
import {
  DropdownMenu,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { WindowPlace } from "@/components/windows/store";
import { canRedo, canUndo } from "@/lib/document-history";
import { AutomateTouched } from "../automation/touched";
import { useMusic, useSong } from "../store";
import { useTransport } from "../transport";
import { proCWindow, useMusicWindows } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { chooseProC, closeProC, copyProCState, copyToOtherSlot, pasteProCState, presetName, setProC, startMatch, stepProCPreset, toggleBypass, toggleProCAB } from "./actions";
import { MainControls } from "./controls";
import { GUTTER, LevelDisplay, PLOT_TOP, ScaleButton } from "./display";
import { meterFraction, scaleSteps } from "./geometry";
import { Caption, SongBarSlider, SongCompKnob, useSongPan } from "./knob";
import { CompactMeters, Meters } from "./meters";
import { SidechainSection, SidechainToggle } from "./sidechain";
import { controlProps, linkedEdit } from "./specs";
import { useCompUi } from "./store";

/** As it opens (smaller if the desktop is), about Pro-C's Medium; the side chain section adds its height, Compact takes the displays away. */
const WIDTH = 900;
const HEIGHT = 640;
const SIDECHAIN_HEIGHT = 176;
const COMPACT_HEIGHT = 330;
const MIN = { minWidth: 780, minHeight: 500 };
const COMPACT_MIN = { minWidth: 780, minHeight: 300 };

function effectOf(song: MusicProject, effectId: string): MixerEffect | null {
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect;
  return null;
}
const trackOf = (song: MusicProject, effectId: string) => song.mixer.tracks.find((t) => t.effects.some((e) => e?.id === effectId))?.id ?? "";

/**
 * A Pro-C's window (`docs/fabfilter/pro-c.md` 2, 8.6), FabFilter's compressor in our drawing: the top bar
 * (undo, A/B, presets), the level display with the knee display and the controls over it, the meters at
 * the right, the side chain section under it (opened by its button), and the bottom bar (oversampling,
 * Maximum Lookahead, Match, bypass, the output panel, Compact). Dark in every theme, as a plugin's is.
 */
export function ProCWindow({ effectId, index }: { effectId: string; index: number }) {
  const effect = useSong((s) => effectOf(s, effectId));
  const owner = useSong((s) => mixerTrackName(s, trackOf(s, effectId)));
  const id = proCWindow(effectId);
  const [initial] = useState(() => {
    const proC = effect?.proC;
    const desktop = document.querySelector('[data-desktop="music"]')?.getBoundingClientRect();
    const wanted = proC?.view.compact ? COMPACT_HEIGHT : HEIGHT;
    const width = Math.max(MIN.minWidth, Math.min(WIDTH, (desktop?.width ?? WIDTH) - 16));
    const height = Math.max(COMPACT_MIN.minHeight, Math.min(wanted + (proC?.view.sidechain ? SIDECHAIN_HEIGHT : 0), (desktop?.height ?? HEIGHT) - 16));
    const place = centredOnDesktop(width, height);
    return { ...place, x: place.x + index * 28, y: Math.min(place.y, 40) + index * 28, width, height };
  });
  const proC = effect?.proC;
  const gone = !proC;
  useEffect(() => {
    if (gone) closeProC(effectId);
  }, [gone, effectId]);
  useGrowWithSections(id, initial, proC?.view.sidechain ?? false, proC?.view.compact ?? false);
  if (!effect || !proC) return null;
  const compact = proC.view.compact;
  return (
    <MusicWindow id={id} title={`${effect.plugin.name} (${owner})`} initial={initial} resizable={compact ? COMPACT_MIN : MIN} onClose={() => closeProC(effectId)} controls={<AutomateTouched effectId={effectId} />}>
      <div className="flex h-full min-h-0 flex-col bg-[var(--comp-bg-top)] text-xs text-[var(--comp-text)] select-none" data-testid="pro-c" data-effect={effectId} data-style={proC.style} data-compact={compact || undefined}>
        <TopBar effectId={effectId} proC={proC} />
        {compact ? (
          <CompactBody effectId={effectId} proC={proC} />
        ) : (
          <div className="relative flex min-h-0 flex-1">
            <div className="relative min-w-0 flex-1 overflow-hidden">
              <LevelDisplay effectId={effectId} proC={proC} bypassed={!effect.enabled} />
              {/* The controls float over the display's lower part, on a shade so they read over the levels. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[230px] bg-gradient-to-t from-black/55 via-black/30 to-transparent" style={{ right: GUTTER }} />
              <div className="absolute bottom-1 left-0 flex flex-col items-center gap-0.5" style={{ right: GUTTER }}>
                <MainControls effectId={effectId} proC={proC} />
                <SidechainToggle effectId={effectId} proC={proC} />
              </div>
            </div>
            <Meters effectId={effectId} scale={proC.view.scale} top={PLOT_TOP + 10} bottom={22} />
          </div>
        )}
        {proC.view.sidechain && <SidechainSection effectId={effectId} proC={proC} />}
        <BottomBar effectId={effectId} proC={proC} enabled={effect.enabled} />
      </div>
    </MusicWindow>
  );
}

/**
 * The window grows by the side chain section as it opens (and shrinks as it closes), and to Compact's
 * height and back, as Pro-C's does, unless it fills the desktop.
 */
function useGrowWithSections(id: ReturnType<typeof proCWindow>, initial: WindowPlace & { height: number }, sidechain: boolean, compact: boolean) {
  const before = useRef({ sidechain, compact });
  const expanded = useRef<number | null>(null);
  useEffect(() => {
    const was = before.current;
    before.current = { sidechain, compact };
    if (was.sidechain === sidechain && was.compact === compact) return;
    const windows = useMusicWindows.getState();
    const place = windows.places[id] ?? initial;
    if (place.snap) return;
    let height = place.height ?? initial.height;
    if (was.compact !== compact) {
      if (compact) {
        expanded.current = height - (sidechain ? SIDECHAIN_HEIGHT : 0);
        height = COMPACT_HEIGHT + (sidechain ? SIDECHAIN_HEIGHT : 0);
      } else height = (expanded.current ?? HEIGHT) + (sidechain ? SIDECHAIN_HEIGHT : 0);
    } else height += sidechain ? SIDECHAIN_HEIGHT : -SIDECHAIN_HEIGHT;
    const desktop = document.querySelector('[data-desktop="music"]')?.getBoundingClientRect();
    const room = desktop ? desktop.height - place.y - 4 : height;
    windows.place(id, { ...place, height: Math.max(COMPACT_MIN.minHeight, Math.min(height, Math.max(room, COMPACT_MIN.minHeight))) });
  }, [id, initial, sidechain, compact]);
}

// ---------------------------------------------------------------------------
// The top bar
// ---------------------------------------------------------------------------

const FOLDERS: ProCPreset["folder"][] = ["Vocals", "Drums", "Bass", "Mix", "Special"];

function TopBar({ effectId, proC }: { effectId: string; proC: ProC }) {
  const history = useMusic((s) => s.history);
  const copied = useCompUi((s) => s.copiedState !== null);
  useCompUi((s) => s.lastPreset[effectId]);
  // The preset loaded is remembered, so its name stays (dimmed) once it's changed.
  useEffect(() => {
    const last = useCompUi.getState().lastPreset;
    if (proC.preset && last[effectId] !== proC.preset) useCompUi.setState({ lastPreset: { ...last, [effectId]: proC.preset } });
  }, [effectId, proC.preset]);
  const name = presetName(effectId, proC);
  const same = !!proC.other && JSON.stringify(proC.other) === JSON.stringify(normalizeProCState(proC));
  const button = "rounded-sm px-1.5 py-0.5 text-[var(--comp-label)] outline-none hover:text-[var(--comp-text)] disabled:opacity-35 disabled:hover:text-[var(--comp-label)]";
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-black/50 bg-[var(--comp-bar)] px-2" data-testid="pro-c-top">
      <span className="mr-3 flex items-baseline font-semibold tracking-wide" aria-hidden>
        <span className="text-[15px] text-[var(--comp-arc)]">YT-C</span>
        <span className="ml-1.5 text-[9.5px] font-medium tracking-[0.14em] text-[var(--comp-label)]">COMPRESSOR</span>
      </span>
      <button type="button" aria-label="Undo" className={button} disabled={!history || !canUndo(history)} onClick={() => useMusic.getState().undo()}>
        <PiArrowArcLeft className="size-3.5" />
      </button>
      <button type="button" aria-label="Redo" className={button} disabled={!history || !canRedo(history)} onClick={() => useMusic.getState().redo()}>
        <PiArrowArcRight className="size-3.5" />
      </button>
      <button type="button" aria-label="A/B" data-testid="pro-c-ab" className={cn(button, "ml-3 tabular-nums")} onClick={() => toggleProCAB(effectId)} title="Switch between two settings">
        <span className={proC.slot === "a" ? "text-[var(--comp-text)]" : ""}>A</span>/<span className={proC.slot === "b" ? "text-[var(--comp-text)]" : ""}>B</span>
      </button>
      <button type="button" className={button} disabled={same} onClick={() => copyToOtherSlot(effectId)} title={`Copy ${proC.slot.toUpperCase()} to ${proC.slot === "a" ? "B" : "A"}`}>
        Copy
      </button>

      <div className="mx-auto flex items-center gap-1">
        <button type="button" aria-label="Previous preset" className={button} onClick={() => stepProCPreset(effectId, -1)}>
          <PiCaretLeftFill className="size-2.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Presets"
              data-testid="pro-c-preset"
              title={proC.preset ? (PRO_C_PRESETS.find((p) => p.name === proC.preset)?.detail ?? "") : "Changed since the preset was loaded"}
              className={cn("min-w-[200px] rounded-sm px-2 py-0.5 text-center text-[12.5px] outline-none hover:bg-white/5", proC.preset ? "text-[var(--comp-text)]" : "text-[var(--comp-label)] italic")}
            >
              {name ?? "Untitled"}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-52" data-testid="pro-c-presets">
            {FOLDERS.map((folder) => (
              <DropdownMenuSub key={folder}>
                <DropdownMenuSubTrigger>{folder}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-[330px]">
                  {PRO_C_PRESETS.filter((p) => p.folder === folder).map((p) => (
                    <DropdownMenuItem key={p.name} onSelect={() => chooseProC(effectId, p.name)} className="items-start py-1.5">
                      <span className="flex min-w-0 flex-col">
                        <span className={cn("font-medium", proC.preset === p.name && "text-brand")}>
                          {proC.preset === p.name ? "✓ " : ""}
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
        <button type="button" aria-label="Next preset" className={button} onClick={() => stepProCPreset(effectId, 1)}>
          <PiCaretRightFill className="size-2.5" />
        </button>
      </div>

      <span className="w-[150px] truncate text-right text-[10.5px] text-[var(--comp-label)]" title={PRO_C_STYLE_INFO[proC.style].detail}>
        {PRO_C_GROUPS.find((g) => g.id === styleGroup(proC.style))!.name} · <span className="text-[var(--comp-text)]">{PRO_C_STYLE_INFO[proC.style].name}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="YT-C's options" className={button}>
            <PiDotsThreeVertical className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => chooseProC(effectId, "Default Setting")}>Reset to the default setting</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => copyProCState(effectId)}>Copy state</DropdownMenuItem>
          <DropdownMenuItem disabled={!copied} onSelect={() => pasteProCState(effectId)}>
            Paste state
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact
// ---------------------------------------------------------------------------

/** Compact (Pro-C's without its displays): the controls, horizontal meters, the scale under them. */
function CompactBody({ effectId, proC }: { effectId: string; proC: ProC }) {
  const scale = proC.view.scale;
  const steps = scaleSteps(scale).filter((_, i, all) => all.length <= 12 || i % 2 === 0);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col justify-end bg-gradient-to-b from-[var(--comp-bg-top)] to-[var(--comp-bg-bottom)] pb-1">
      <div className="flex flex-1 items-center justify-center pt-1">
        <MainControls effectId={effectId} proC={proC} />
      </div>
      <div className="px-3">
        <CompactMeters effectId={effectId} scale={scale} />
        <div className="relative h-6">
          <ScaleButton effectId={effectId} scale={scale} className="absolute top-0.5 left-0" />
          {steps.map((db) => (
            <span key={db} className="absolute top-1 -translate-x-1/2 text-[9.5px] text-[var(--comp-label)] tabular-nums" style={{ left: `calc(72px + (100% - 116px) * ${meterFraction(db, scale)})` }}>
              {db === 0 ? "0" : `−${Math.abs(db)}`}
            </span>
          ))}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-[var(--comp-bg-bottom)] px-2">
            <SidechainToggle effectId={effectId} proC={proC} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The bottom bar
// ---------------------------------------------------------------------------

const LOOKAHEADS = [0, 0.001, 0.002, 0.003, 0.005, 0.01, 0.015, 0.02] as const;
const lookaheadText = (s: number) => (s <= 0 ? "Off" : `${Math.round(s * 1000)} ms`);

function BottomBar({ effectId, proC, enabled }: { effectId: string; proC: ProC; enabled: boolean }) {
  const latency = useTransport((s) => s.proCs[effectId]?.latency ?? null);
  const rate = useTransport((s) => s.sampleRate);
  const matching = useCompUi((s) => !!s.matching[effectId]);
  const label = "text-[var(--comp-label)]";
  const menuButton = "flex items-center gap-1 rounded-sm px-1.5 py-0.5 outline-none hover:bg-white/5";
  const latencyMs = latency !== null && latency > 0 ? (latency / rate) * 1000 : proC.maxLookahead * 1000;
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-black/50 bg-[var(--comp-bottom-bar)] px-3 text-[11px]" data-testid="pro-c-bottom">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Oversampling" className={menuButton}>
            <span className={label}>Oversampling:</span> {proC.oversampling === 1 ? "Off" : `${proC.oversampling}x`}
            <PiCaretDown className="size-2.5 text-[var(--comp-label)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Oversampling (less aliasing, a little latency)</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(proC.oversampling)} onValueChange={(v) => setProC(effectId, { oversampling: Number(v) as ProC["oversampling"] })}>
            {PRO_C_OVERSAMPLING.map((o) => (
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
          <button type="button" aria-label="Maximum lookahead" className={menuButton}>
            <span className={label}>Lookahead:</span> {lookaheadText(proC.maxLookahead)}
            <PiCaretDown className="size-2.5 text-[var(--comp-label)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Maximum lookahead (its latency)</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(proC.maxLookahead)} onValueChange={(v) => setProC(effectId, { maxLookahead: Number(v), ...(Number(v) > 0 && proC.lookahead === 0 && { lookahead: Math.min(0.002, Number(v)) }) })}>
            {LOOKAHEADS.map((l) => (
              <DropdownMenuRadioItem key={l} value={String(l)}>
                {lookaheadText(l)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className={cn(label, "text-[10px] tabular-nums")} title="How late it plays (the mixer delays the rest to match). Off and Off: zero latency, so a vocal can be recorded through it.">
        {latencyMs > 0 || proC.oversampling > 1 ? `${latencyMs.toFixed(1)} ms${proC.oversampling > 1 && !(latency && latency > 0) ? " +" : ""}` : "Zero latency"}
      </span>

      <button
        type="button"
        aria-pressed={matching}
        data-testid="pro-c-match"
        title="Match: listens to what comes in and goes out while the song plays, then sets Wet Gain so they're as loud"
        className={cn("ml-auto flex items-center gap-1 rounded-[4px] border px-2 py-px outline-none", matching ? "animate-pulse border-[var(--comp-arc)] text-[var(--comp-arc)]" : "border-[var(--comp-knob-edge)] text-[var(--comp-text)] hover:bg-white/5")}
        onClick={() => startMatch(effectId)}
      >
        <PiWaveform className="size-3" />
        {matching ? "Matching…" : "Match"}
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          aria-label={enabled ? "Bypass" : "Enable"}
          aria-pressed={!enabled}
          title="Bypass (latency compensated)"
          className={cn("relative rounded-sm p-1 outline-none hover:bg-white/5", enabled ? "text-[var(--comp-label)]" : "text-[var(--comp-reduction)]")}
          onClick={() => toggleBypass(effectId)}
        >
          <PiPower className="size-3.5" />
          {!enabled && <span className="absolute inset-x-0.5 -top-1 h-0.5 rounded bg-[var(--comp-reduction)]" />}
        </button>
        <OutputButton effectId={effectId} proC={proC} />
        <button
          type="button"
          aria-pressed={proC.view.compact}
          aria-label={proC.view.compact ? "Show the displays" : "Compact"}
          title={proC.view.compact ? "Show the displays" : "Compact: hide the displays (horizontal meters)"}
          data-testid="pro-c-compact"
          className="rounded-sm p-1 text-[var(--comp-label)] outline-none hover:bg-white/5 hover:text-[var(--comp-text)]"
          onClick={() => setProC(effectId, { view: { compact: !proC.view.compact } })}
        >
          {proC.view.compact ? <PiArrowsOutSimple className="size-3.5" /> : <PiArrowsInSimple className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

const lrText = (pan: number) => (Math.abs(pan) < 0.005 ? "Centre" : `${Math.round(Math.abs(pan) * 100)}% ${pan < 0 ? "left" : "right"}`);
const dbText = (v: number) => `${v > 0.05 ? "+" : v < -0.05 ? "−" : ""}${Math.abs(v).toFixed(1)} dB`;

/** The output's button ("100%  0.0 dB  0.0 dB") and its panel: Mix (0..200%), Input and Output with their pans. */
function OutputButton({ effectId, proC }: { effectId: string; proC: ProC }) {
  const inputPan = useSongPan(proC.inputPan, "Input pan", lrText, (s, inputPan) => updateProC(s, effectId, { inputPan }));
  const outputPan = useSongPan(proC.outputPan, "Output pan", lrText, (s, outputPan) => updateProC(s, effectId, { outputPan }));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Output" data-testid="pro-c-output" className="flex items-center gap-2.5 rounded-sm px-2 py-0.5 tabular-nums outline-none hover:bg-white/5">
          <span>{Math.round(proC.mix * 100)}%</span>
          <span>{dbText(proC.input)}</span>
          <span>{dbText(proC.output)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-[236px] border-[var(--comp-panel-edge)] bg-[var(--comp-panel)] p-3 text-[var(--comp-text)] shadow-xl" data-testid="pro-c-output-panel">
        <div className="flex justify-around">
          <SongCompKnob {...controlProps(effectId, proC, "input")} size={44} bipolar pan={inputPan} testId="pro-c-knob-input" linked={linkedEdit(effectId, "input")} caption={<Caption className="text-[9.5px]">Input</Caption>} />
          <SongCompKnob {...controlProps(effectId, proC, "output")} size={44} bipolar pan={outputPan} testId="pro-c-knob-output" linked={linkedEdit(effectId, "output")} caption={<Caption className="text-[9.5px]">Output</Caption>} />
        </div>
        <div className="mt-3 flex flex-col items-center gap-1">
          <SongBarSlider {...controlProps(effectId, proC, "mix")} length={180} testId="pro-c-knob-mix" />
          <Caption>Mix</Caption>
        </div>
      </PopoverContent>
    </Popover>
  );
}
