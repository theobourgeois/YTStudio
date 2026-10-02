import { useEffect, useMemo, useState } from "react";
import { PiArrowArcLeft, PiArrowArcRight, PiCaretDown, PiCaretLeftFill, PiCaretRightFill, PiPower, PiSnowflake, PiWarningFill } from "react-icons/pi";
import { cn } from "cn";
import { mixerTrackName } from "@shared/music/automation";
import { updateEffect } from "@shared/music/mixer";
import { MODE_NAMES, RESOLUTION_NAMES, findProQ, frequencyText, proQState, proQs, updateProQ, type ProQPatch } from "@shared/music/pro-q";
import { applyPreset } from "@shared/music/pro-q";
import { EQ_CONTROL_SCALES, EQ_MAX_GAIN_SCALE, LINEAR_PHASE_LATENCY, PRO_Q_PRESETS, dynamicsInLinearPhase } from "@shared/music/pro-q-presets";
import { DEFAULT_PRO_Q } from "@shared/music/project";
import { EQ_MODES, EQ_RESOLUTIONS, type MixerEffect, type MusicProject, type ProQ, type ProQAnalyzer } from "@shared/music/types";
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
import { canRedo, canUndo } from "@/lib/document-history";
import { useMusic, useSong } from "../store";
import { proQWindow } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { closeProQ, copyToOther, loadPreset, selectBands, syncWatch, toggleAB } from "./actions";
import { Display } from "./display";
import { startMatch } from "./match-panel";
import { SongEqKnob } from "./knob";
import { useEqUi, useEqView } from "./store";
import { AutomateTouched } from "../automation/touched";

/** As it opens (smaller if the desktop is), and the least it can be: about Pro-Q's Medium. */
const WIDTH = 980;
const HEIGHT = 600;
const MIN = { minWidth: 720, minHeight: 440 };

function effectOf(song: MusicProject, effectId: string): MixerEffect | null {
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect;
  return null;
}
const trackOf = (song: MusicProject, effectId: string) => song.mixer.tracks.find((t) => t.effects.some((e) => e?.id === effectId))?.id ?? "";

/**
 * A Pro-Q's window (`docs/fabfilter/pro-q.md`), FabFilter's EQ: the display filling it (the analyzer, the
 * bands, their curves, the band controls floating under the selection), the top bar (undo, A/B, presets)
 * and the bottom bar (processing mode, analyzer, bypass, output).
 */
export function ProQWindow({ effectId, index }: { effectId: string; index: number }) {
  const effect = useSong((s) => effectOf(s, effectId));
  const owner = useSong((s) => mixerTrackName(s, trackOf(s, effectId)));
  const [initial] = useState(() => {
    const desktop = document.querySelector('[data-desktop="music"]')?.getBoundingClientRect();
    const width = Math.max(MIN.minWidth, Math.min(WIDTH, (desktop?.width ?? WIDTH) - 16));
    const height = Math.max(MIN.minHeight, Math.min(HEIGHT, (desktop?.height ?? HEIGHT) - 16));
    const place = centredOnDesktop(width, height);
    return { ...place, x: place.x + index * 28, y: Math.min(place.y, 40) + index * 28, width, height };
  });
  const pq = effect?.proQ;
  const gone = !pq;
  useEffect(() => {
    if (gone) closeProQ(effectId);
  }, [gone, effectId]);
  // The analyzer's settings decide what the engine measures.
  const analyzer = pq?.analyzer;
  useEffect(() => syncWatch(), [analyzer]);
  useEqKeys(effectId);
  if (!effect || !pq) return null;
  return (
    <MusicWindow id={proQWindow(effectId)} title={`${effect.plugin.name} (${owner})`} initial={initial} resizable={MIN} onClose={() => closeProQ(effectId)} controls={<AutomateTouched effectId={effectId} />}>
      <div className="flex h-full min-h-0 flex-col bg-[var(--eq-bg-top)] text-xs text-[var(--eq-text)] select-none" data-testid="pro-q" data-effect={effectId}>
        <TopBar effectId={effectId} pq={pq} />
        <Display effectId={effectId} pq={pq} bypassed={!effect.enabled} />
        <BottomBar effectId={effectId} pq={pq} enabled={effect.enabled} />
      </div>
    </MusicWindow>
  );
}

/** The window's keys while it's in front: Delete removes the selected bands, ⌘A selects them all, Esc none. */
function useEqKeys(effectId: string) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [role=slider]") || !target?.closest(`[data-effect="${effectId}"]`)) return;
      const pq = findProQ(useMusic.getState().history!.doc, effectId)?.proQ;
      if (!pq) return;
      const selected = useEqUi.getState().views[effectId]?.selected ?? [];
      if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
        e.preventDefault();
        e.stopPropagation();
        void import("./actions").then((a) => a.deleteBands(effectId, selected));
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        selectBands(
          effectId,
          pq.bands.map((b) => b.id),
        );
      } else if (e.key === "Escape" && selected.length) {
        e.stopPropagation();
        selectBands(effectId, []);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [effectId]);
}

// ---------------------------------------------------------------------------
// The top bar
// ---------------------------------------------------------------------------

/** The preset the state is, if it's one exactly (Pro-Q dims the name once it's changed). */
function presetOf(pq: ProQ): string | null {
  const now = JSON.stringify(proQState(pq));
  for (const preset of PRO_Q_PRESETS) if (JSON.stringify(proQState(applyPreset(DEFAULT_PRO_Q, preset))) === now) return preset.name;
  return null;
}

function TopBar({ effectId, pq }: { effectId: string; pq: ProQ }) {
  const history = useMusic((s) => s.history);
  const [last, setLast] = useState("Default Setting");
  const exact = presetOf(pq);
  const name = exact ?? last;
  const step = (by: 1 | -1) => {
    const at = PRO_Q_PRESETS.findIndex((p) => p.name === name);
    const next = PRO_Q_PRESETS[(at + by + PRO_Q_PRESETS.length) % PRO_Q_PRESETS.length];
    setLast(next.name);
    loadPreset(effectId, next.name);
  };
  const folders = [...new Set(PRO_Q_PRESETS.map((p) => p.folder))];
  const button = "rounded-sm px-1.5 py-0.5 text-[var(--eq-label)] hover:text-[var(--eq-text)] disabled:opacity-35";
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 bg-[var(--eq-bar)] px-2" data-testid="pro-q-top">
      <span className="mr-3 font-semibold tracking-wide">
        <span className="text-[var(--eq-curve)]">Pro·Q</span>
        <sup className="ml-0.5 text-[9px] text-[var(--eq-curve)]">3</sup>
      </span>
      <button type="button" aria-label="Undo" className={button} disabled={!history || !canUndo(history)} onClick={() => useMusic.getState().undo()}>
        <PiArrowArcLeft className="size-3.5" />
      </button>
      <button type="button" aria-label="Redo" className={button} disabled={!history || !canRedo(history)} onClick={() => useMusic.getState().redo()}>
        <PiArrowArcRight className="size-3.5" />
      </button>
      <button type="button" aria-label="A/B" className={cn(button, "ml-3 tabular-nums")} onClick={() => toggleAB(effectId)} title="Switch between two settings">
        <span className={pq.ab === "a" ? "text-[var(--eq-text)]" : ""}>A</span>/<span className={pq.ab === "b" ? "text-[var(--eq-text)]" : ""}>B</span>
      </button>
      <button
        type="button"
        className={button}
        disabled={!!pq.other && JSON.stringify(pq.other) === JSON.stringify(proQState(pq))}
        onClick={() => copyToOther(effectId)}
        title={`Copy ${pq.ab.toUpperCase()} to ${pq.ab === "a" ? "B" : "A"}`}
      >
        Copy
      </button>
      <div className="mx-auto flex items-center gap-1">
        <button type="button" aria-label="Previous preset" className={button} onClick={() => step(-1)}>
          <PiCaretLeftFill className="size-2.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Presets" className={cn("min-w-[160px] rounded-sm px-2 py-0.5 text-center hover:bg-white/5", exact ? "text-[var(--eq-text)]" : "text-[var(--eq-label)]")}>
              {name}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-56" data-testid="pro-q-presets">
            {folders.map((folder) =>
              folder === "" ? (
                PRO_Q_PRESETS.filter((p) => p.folder === "").map((p) => (
                  <DropdownMenuItem
                    key={p.name}
                    onSelect={() => {
                      setLast(p.name);
                      loadPreset(effectId, p.name);
                    }}
                  >
                    {exact === p.name ? "✓ " : ""}
                    {p.name}
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuSub key={folder}>
                  <DropdownMenuSubTrigger>{folder}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {PRO_Q_PRESETS.filter((p) => p.folder === folder).map((p) => (
                      <DropdownMenuItem
                        key={p.name}
                        onSelect={() => {
                          setLast(p.name);
                          loadPreset(effectId, p.name);
                        }}
                      >
                        {exact === p.name ? "✓ " : ""}
                        {p.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" aria-label="Next preset" className={button} onClick={() => step(1)}>
          <PiCaretRightFill className="size-2.5" />
        </button>
      </div>
      <span className="w-[120px]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The bottom bar
// ---------------------------------------------------------------------------

/** Linear Phase's delay in ms at a resolution (kept the same at every rate); Natural Phase's 7.3. */
const latencyMs = (pq: ProQ) => (pq.mode === "zeroLatency" ? 0 : pq.mode === "naturalPhase" ? 7.3 : (LINEAR_PHASE_LATENCY[pq.resolution] / 44100) * 1000);

function BottomBar({ effectId, pq, enabled }: { effectId: string; pq: ProQ; enabled: boolean }) {
  const set = (patch: ProQPatch) => useMusic.getState().commit((s) => updateProQ(s, effectId, patch));
  const warn = pq.mode === "linearPhase" && !dynamicsInLinearPhase(pq.resolution) && pq.bands.some((b) => b.range !== 0 && b.dynamics);
  const bypass = () =>
    useMusic.getState().commit((s) => {
      const found = findProQ(s, effectId);
      return found ? updateEffect(s, found.track.id, found.slot, { enabled: !found.effect.enabled }) : s;
    });
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 bg-[var(--eq-bottom-bar)] px-3 text-[11px]" data-testid="pro-q-bottom">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Processing mode" className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-white/5">
            {warn && <PiWarningFill className="size-3 text-[var(--eq-curve)]" aria-label="Dynamic bands don't play at this resolution" />}
            {MODE_NAMES[pq.mode]}
            {pq.mode === "linearPhase" && ` – ${RESOLUTION_NAMES[pq.resolution]}`}
            <PiCaretDown className="size-2.5 text-[var(--eq-label)]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Processing mode</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={pq.mode} onValueChange={(mode) => set({ mode: mode as ProQ["mode"] })}>
            {EQ_MODES.map((mode) => (
              <DropdownMenuRadioItem key={mode} value={mode}>
                {MODE_NAMES[mode]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Linear Phase resolution</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={pq.resolution} onValueChange={(resolution) => set({ resolution: resolution as ProQ["resolution"], mode: "linearPhase" })}>
            {EQ_RESOLUTIONS.map((r) => (
              <DropdownMenuRadioItem key={r} value={r}>
                {RESOLUTION_NAMES[r]}
                <span className="ml-auto pl-3 text-[10px] text-muted-foreground tabular-nums">{Math.round((LINEAR_PHASE_LATENCY[r] / 44100) * 1000)} ms</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {warn && <p className="px-2 py-1 text-[10px] text-muted-foreground">Dynamic bands play in Linear Phase up to High: lower the resolution.</p>}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-[10px] text-[var(--eq-label)] tabular-nums" title="How late it plays (the mixer delays the rest to match)">
        {pq.mode === "zeroLatency" ? "" : `${latencyMs(pq).toFixed(1)} ms`}
      </span>

      <AnalyzerButton effectId={effectId} pq={pq} />

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          aria-label={enabled ? "Bypass" : "Enable"}
          aria-pressed={!enabled}
          title="Bypass (latency compensated)"
          className={cn("relative rounded-sm p-1 hover:bg-white/5", enabled ? "text-[var(--eq-label)]" : "text-[var(--eq-dynamic)]")}
          onClick={bypass}
        >
          <PiPower className="size-3.5" />
          {!enabled && <span className="absolute inset-x-0.5 -top-1 h-0.5 rounded bg-[var(--eq-dynamic)]" />}
        </button>
        <OutputButton effectId={effectId} pq={pq} />
      </div>
    </div>
  );
}

const ANALYZER_RANGES = [60, 90, 120] as const;
const ANALYZER_RESOLUTIONS = ["low", "medium", "high", "maximum"] as const;
const ANALYZER_SPEEDS = ["verySlow", "slow", "medium", "fast", "veryFast"] as const;
const SPEED_NAMES = { verySlow: "Very Slow", slow: "Slow", medium: "Medium", fast: "Fast", veryFast: "Very Fast" } as const;
const TILTS = [0, 1.5, 3, 4.5, 6] as const;

/** The analyzer's button ("Analyzer: Pre+Post") and its panel: what's shown, another Pro-Q's spectrum, Freeze, Spectrum Grab, collisions, its settings. */
function AnalyzerButton({ effectId, pq }: { effectId: string; pq: ProQ }) {
  const a = pq.analyzer;
  const freeze = useEqView(effectId).freeze;
  // (The mixer itself, which stays the same object until it changes: a list made in the selector would render for ever.)
  const mixer = useSong((s) => s.mixer);
  const others = useMemo(() => {
    const s = { mixer } as MusicProject;
    return proQs(s)
      .filter((o) => o.effect.id !== effectId)
      .map((o) => ({ id: o.effect.id, name: mixerTrackName(s, o.track.id) }));
  }, [mixer, effectId]);
  const set = (patch: Partial<ProQAnalyzer>) => useMusic.getState().commit((s) => updateProQ(s, effectId, { analyzer: patch }));
  const label = [a.pre && "Pre", a.post && "Post", a.external && (others.find((o) => o.id === a.external)?.name ?? "")].filter(Boolean).join("+") || "Off";
  const toggle = (on: boolean) => cn("rounded-sm border border-white/10 px-2 py-0.5 text-[11px]", on ? "bg-white/10 text-[var(--eq-text)] shadow-[inset_0_-2px_0_var(--eq-curve)]" : "text-[var(--eq-label)] hover:text-[var(--eq-text)]");
  const option = <T extends string | number>(value: T, values: readonly T[], names: (v: T) => string, apply: (v: T) => void) => (
    <div className="flex gap-0.5">
      {values.map((v) => (
        <button key={String(v)} type="button" className={toggle(v === value)} onClick={() => apply(v)}>
          {names(v)}
        </button>
      ))}
    </div>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Analyzer" className="relative mx-auto rounded-sm px-2 py-0.5 hover:bg-white/5">
          <span className="text-[var(--eq-label)]">Analyzer:</span> {label}
          {freeze && <span className="absolute inset-x-1 -top-0.5 h-0.5 rounded bg-[var(--eq-side)]" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-[400px] space-y-2.5 border-[var(--eq-panel-edge)] bg-[var(--eq-panel)] p-3 text-[11px] text-[var(--eq-text)]" data-testid="pro-q-analyzer">
        <div className="flex gap-1">
          <button type="button" className={toggle(a.pre)} onClick={() => set({ pre: !a.pre })}>
            Pre
          </button>
          <button type="button" className={toggle(a.post)} onClick={() => set({ post: !a.post })}>
            Post
          </button>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] text-[var(--eq-label)]">External spectrum (another Pro-Q's, after it)</div>
          <div className="flex flex-wrap gap-1">
            <button type="button" className={toggle(a.external === null)} onClick={() => set({ external: null })}>
              Off
            </button>
            {others.map((o) => (
              <button key={o.id} type="button" className={toggle(a.external === o.id)} onClick={() => set({ external: o.id })}>
                {o.name}
              </button>
            ))}
            {!others.length && <span className="text-[10px] text-[var(--eq-label)]">(no other Pro-Q in the song)</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={toggle(freeze)} onClick={() => useEqUi.getState().setView(effectId, { freeze: !freeze })} title="The spectrum stops falling and keeps its highest">
            <PiSnowflake className="mr-1 inline size-3" />
            Freeze
          </button>
          <button type="button" className={toggle(a.grab)} onClick={() => set({ grab: !a.grab })} title="Rest the pointer on the spectrum: its peaks are labelled, drag one to make a band">
            Spectrum Grab
          </button>
          <button type="button" className={toggle(a.collisions)} onClick={() => set({ collisions: !a.collisions })} title="Where this sound and the external spectrum crowd each other">
            Show Collisions
          </button>
        </div>
        <div className="grid grid-cols-[64px_1fr] items-center gap-x-2 gap-y-1.5">
          <span className="text-[var(--eq-label)]">Range</span>
          {option(a.range, ANALYZER_RANGES, (v) => `${v} dB`, (range) => set({ range }))}
          <span className="text-[var(--eq-label)]">Resolution</span>
          {option(a.resolution, ANALYZER_RESOLUTIONS, (v) => v[0].toUpperCase() + v.slice(1, 3), (resolution) => set({ resolution }))}
          <span className="text-[var(--eq-label)]">Speed</span>
          {option(a.speed, ANALYZER_SPEEDS, (v) => SPEED_NAMES[v].replace("Very ", "V. "), (speed) => set({ speed }))}
          <span className="text-[var(--eq-label)]">Tilt</span>
          {option(a.tilt, TILTS, (v) => `${v}`, (tilt) => set({ tilt }))}
        </div>
        <p className="text-[10px] text-[var(--eq-label)]">Tilt is in dB per octave round 1 kHz (4.5: as loudness is heard).</p>
        <button
          type="button"
          className={cn(toggle(false), "w-full")}
          disabled={!a.external}
          title={a.external ? "Match this sound's tone to the external spectrum's" : "Pick an external spectrum first: it's what this sound is matched to"}
          onClick={() => a.external && startMatch(effectId, a.external)}
        >
          ≈ EQ Match{a.external ? ` to ${others.find((o) => o.id === a.external)?.name ?? ""}` : " (pick an external spectrum)"}
        </button>
      </PopoverContent>
    </Popover>
  );
}

/** The output's button ("100%  0.0 dB") and its panel: phase, Auto Gain, Gain Scale, level and pan. */
function OutputButton({ effectId, pq }: { effectId: string; pq: ProQ }) {
  const set = (patch: ProQPatch) => useMusic.getState().commit((s) => updateProQ(s, effectId, patch));
  const O = EQ_CONTROL_SCALES.output;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Output" className="relative flex items-center gap-2 rounded-sm px-2 py-0.5 tabular-nums hover:bg-white/5">
          {/* Its state lines: phase blue, Auto Gain yellow. */}
          <span className="absolute inset-x-1 -top-0.5 flex gap-0.5">
            <span className={cn("h-0.5 flex-1 rounded", pq.invert ? "bg-[var(--eq-side)]" : "bg-white/10")} />
            <span className={cn("h-0.5 flex-1 rounded", pq.autoGain ? "bg-[var(--eq-curve)]" : "bg-white/10")} />
          </span>
          <span>{Math.round(pq.gainScale * 100)}%</span>
          <span>{pq.output <= -60 ? "−∞" : `${pq.output > 0 ? "+" : ""}${pq.output.toFixed(1)} dB`}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-[260px] border-[var(--eq-panel-edge)] bg-[var(--eq-panel)] p-3 text-[11px] text-[var(--eq-text)]" data-testid="pro-q-output">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <button type="button" aria-pressed={pq.invert} className={cn("rounded-sm border border-white/10 px-2 py-0.5", pq.invert && "bg-[var(--eq-side)]/30 text-white")} onClick={() => set({ invert: !pq.invert })}>
              ⌀ Phase
            </button>
            <button type="button" aria-pressed={pq.autoGain} className={cn("rounded-sm border border-white/10 px-2 py-0.5", pq.autoGain && "bg-[var(--eq-curve)]/30 text-white")} onClick={() => set({ autoGain: !pq.autoGain })}>
              A Auto Gain
            </button>
            <button type="button" aria-pressed={pq.panMode === "ms"} className="rounded-sm border border-white/10 px-2 py-0.5" onClick={() => set({ panMode: pq.panMode === "lr" ? "ms" : "lr" })} title="What the pan balances">
              Pan: {pq.panMode === "lr" ? "L/R" : "M/S"}
            </button>
          </div>
          <SongEqKnob
            label="OUTPUT"
            size={52}
            value={O.toFraction(pq.output)}
            defaultValue={O.toFraction(0)}
            format={(v) => (O.toValue(v) <= -60 ? "−∞" : `${O.toValue(v) > 0 ? "+" : ""}${O.toValue(v).toFixed(1)} dB`)}
            typed={(v) => O.toValue(v).toFixed(1)}
            parse={(t) => (Number.isFinite(Number(t)) ? O.toFraction(Number(t)) : null)}
            target={{ kind: "proQ", effect: effectId, band: 0, control: "output" }}
            automation={{ own: pq.output, toFraction: O.toFraction }}
            edit={(s, v) => updateProQ(s, effectId, { output: Math.round(O.toValue(v) * 10) / 10 })}
          />
          <SongEqKnob
            label="PAN"
            size={34}
            bipolar
            value={(pq.pan + 1) / 2}
            defaultValue={0.5}
            format={(v) => (Math.abs(v - 0.5) < 0.005 ? "Centre" : `${Math.round(Math.abs(v * 2 - 1) * 100)}% ${v < 0.5 ? (pq.panMode === "lr" ? "left" : "mid") : pq.panMode === "lr" ? "right" : "side"}`)}
            typed={(v) => String(Math.round((v * 2 - 1) * 100))}
            parse={(t) => (Number.isFinite(Number(t)) ? (Number(t) / 100 + 1) / 2 : null)}
            edit={(s, v) => updateProQ(s, effectId, { pan: Math.round((v * 2 - 1) * 100) / 100 })}
          />
        </div>
        <label className="mt-2 flex items-center gap-2">
          <span className="w-16 text-[var(--eq-label)]">Gain Scale</span>
          <input
            type="range"
            aria-label="Gain Scale"
            min={0}
            max={EQ_MAX_GAIN_SCALE * 100}
            value={Math.round(pq.gainScale * 100)}
            onChange={(e) => set({ gainScale: Number(e.target.value) / 100 })}
            className="flex-1 accent-[var(--eq-curve)]"
          />
          <span className="w-9 text-right tabular-nums">{Math.round(pq.gainScale * 100)}%</span>
        </label>
      </PopoverContent>
    </Popover>
  );
}

/** For the tests: what a band's frequency reads as. */
export const bandFrequencyText = frequencyText;
