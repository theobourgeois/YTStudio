import { type CSSProperties, useEffect, useRef, useState } from "react";
import { PiArrowCounterClockwise, PiCaretLeftFill, PiCaretRightFill, PiCopySimple, PiLock, PiLockOpen, PiPower, PiSnowflake } from "react-icons/pi";
import { cn } from "cn";
import { mixerTrackName } from "@shared/music/automation";
import { REVERB_CONTROL_SPECS, formatDecay, setReverbControl } from "@shared/music/reverb";
import { REVERB_ERA_SPECS, REVERB_MODE_SPECS } from "@shared/music/reverb-modes";
import { REVERB_FOLDERS, REVERB_PRESETS, heardReverb, isInfinite } from "@shared/music/reverb-presets";
import { type MixerEffect, type MusicProject, REVERB_ERAS, REVERB_MODES, type Reverb } from "@shared/music/types";
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
import type { WindowPlace } from "@/components/windows/store";
import { AutomateTouched } from "../automation/touched";
import { SongCompKnob } from "../pro-c/knob";
import { useSong } from "../store";
import { reverbWindow, useMusicWindows } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import {
  chooseReverb,
  closeReverb,
  copyReverbSettings,
  copyReverbToOther,
  holdFreeze,
  holdKill,
  pasteReverbSettings,
  presetName,
  revertReverb,
  setReverb,
  stepReverbPreset,
  toggleFreeze,
  toggleReverbAB,
  toggleReverbBypass,
} from "./actions";
import { AdvancedPanel, MainControls, VocalControls } from "./controls";
import { ReverbDisplay } from "./display";
import { latest } from "./live";
import { useVerbUi } from "./store";

/** As it opens (smaller if the desktop is); the advanced panel adds its height. */
const WIDTH = 900;
const HEIGHT = 540;
const ADVANCED_HEIGHT = 170;
const MIN = { minWidth: 820, minHeight: 470 };

/**
 * Pro-C's controls drawn in the Reverb's tokens: its look is its own (`--verb-*`, dark in every theme, as
 * Pro-Q's `--eq-*` is), Pro-C's knob reads `--comp-*`.
 */
const TOKENS = {
  "--comp-arc": "var(--verb-decay)",
  "--comp-knob": "var(--verb-knob)",
  "--comp-knob-light": "var(--verb-knob-light)",
  "--comp-knob-dark": "var(--verb-knob-dark)",
  "--comp-knob-edge": "var(--verb-knob-edge)",
  "--comp-label": "var(--verb-label)",
  "--comp-text": "var(--verb-text)",
  "--comp-bar": "var(--verb-bar)",
  "--comp-panel-edge": "var(--verb-panel-edge)",
  "--comp-ring": "var(--verb-meter)",
  "--comp-ring-hot": "var(--verb-meter-hot)",
  "--comp-handle-top": "var(--verb-handle-top)",
  "--comp-handle-bottom": "var(--verb-handle-bottom)",
} as CSSProperties;

function effectOf(song: MusicProject, effectId: string): MixerEffect | null {
  for (const track of song.mixer.tracks) for (const effect of track.effects) if (effect?.id === effectId) return effect;
  return null;
}
const trackOf = (song: MusicProject, effectId: string) => song.mixer.tracks.find((t) => t.effects.some((e) => e?.id === effectId))?.id ?? "";

/**
 * A Reverb's window (`docs/reverb/reverb.md` 4): the top bar (presets, Revert, A/B, Copy / Paste, the mode
 * and era, Kill, Freeze, Mix with its lock), the display (DECAY │ SHAPE) with the meters at its right, the
 * knob row, the vocal row and the advanced panel. Dark in every theme, as a plugin's window is.
 */
export function ReverbWindow({ effectId, index }: { effectId: string; index: number }) {
  const effect = useSong((s) => effectOf(s, effectId));
  const owner = useSong((s) => mixerTrackName(s, trackOf(s, effectId)));
  const id = reverbWindow(effectId);
  const [initial] = useState(() => {
    const desktop = document.querySelector('[data-desktop="music"]')?.getBoundingClientRect();
    const advanced = effect?.reverb?.view.advanced ? ADVANCED_HEIGHT : 0;
    const width = Math.max(MIN.minWidth, Math.min(WIDTH, (desktop?.width ?? WIDTH) - 16));
    const height = Math.max(MIN.minHeight, Math.min(HEIGHT + advanced, (desktop?.height ?? HEIGHT) - 16));
    const place = centredOnDesktop(width, height);
    return { ...place, x: place.x + index * 28, y: Math.min(place.y, 40) + index * 28, width, height };
  });
  const reverb = effect?.reverb;
  const gone = !reverb;
  useEffect(() => {
    if (gone) closeReverb(effectId);
  }, [gone, effectId]);
  useGrowWithAdvanced(id, initial, reverb?.view.advanced ?? false);
  if (!effect || !reverb) return null;
  return (
    <MusicWindow id={id} title={`${effect.plugin.name} (${owner})`} initial={initial} resizable={MIN} onClose={() => closeReverb(effectId)} controls={<AutomateTouched effectId={effectId} />}>
      <div className="flex h-full min-h-0 flex-col bg-[var(--verb-bg-top)] text-xs text-[var(--verb-text)] select-none" style={TOKENS} data-testid="reverb" data-effect={effectId} data-mode={reverb.mode}>
        <TopBar effectId={effectId} reverb={reverb} enabled={effect.enabled} />
        <div className="relative flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col">
            <Tabs effectId={effectId} reverb={reverb} />
            <div className="relative min-h-0 flex-1">
              <ReverbDisplay effectId={effectId} reverb={reverb} />
            </div>
          </div>
          <Meters effectId={effectId} />
        </div>
        <div className="flex shrink-0 flex-col gap-1 border-t border-[var(--verb-panel-edge)] bg-gradient-to-b from-[var(--verb-panel)] to-[var(--verb-section)] pt-2 pb-1.5">
          <MainControls effectId={effectId} reverb={reverb} />
          <VocalControls effectId={effectId} reverb={reverb} deEssing={<DeEssLamp effectId={effectId} />} />
        </div>
        {reverb.view.advanced && <AdvancedPanel effectId={effectId} reverb={reverb} />}
      </div>
    </MusicWindow>
  );
}

/** The window grows by the advanced panel as it opens (and shrinks as it closes), unless it fills the desktop. */
function useGrowWithAdvanced(id: ReturnType<typeof reverbWindow>, initial: WindowPlace & { height: number }, advanced: boolean) {
  const before = useRef(advanced);
  useEffect(() => {
    if (before.current === advanced) return;
    before.current = advanced;
    const windows = useMusicWindows.getState();
    const place = windows.places[id] ?? initial;
    if (place.snap) return;
    const desktop = document.querySelector('[data-desktop="music"]')?.getBoundingClientRect();
    const height = (place.height ?? initial.height) + (advanced ? ADVANCED_HEIGHT : -ADVANCED_HEIGHT);
    const room = desktop ? desktop.height - place.y - 4 : height;
    windows.place(id, { ...place, height: Math.max(MIN.minHeight, Math.min(height, Math.max(room, MIN.minHeight))) });
  }, [id, initial, advanced]);
}

// ---------------------------------------------------------------------------
// The top bar
// ---------------------------------------------------------------------------

function TopBar({ effectId, reverb, enabled }: { effectId: string; reverb: Reverb; enabled: boolean }) {
  const copied = useVerbUi((s) => s.copiedState !== null);
  const killHeld = useVerbUi((s) => s.killHeld === effectId);
  const freezeHeld = useVerbUi((s) => s.freezeHeld === effectId);
  useVerbUi((s) => s.lastPreset[effectId]);
  // The preset loaded is remembered, so its name stays (in italics) once it's changed, and Revert can go back.
  useEffect(() => {
    const last = useVerbUi.getState().lastPreset;
    if (reverb.preset && last[effectId] !== reverb.preset) useVerbUi.setState({ lastPreset: { ...last, [effectId]: reverb.preset } });
  }, [effectId, reverb.preset]);
  const name = presetName(effectId, reverb);
  const edited = !reverb.preset && !!name;
  const same = !!reverb.other && JSON.stringify(reverb.other) === JSON.stringify(heardReverb(reverb));
  const button = "rounded-sm px-1.5 py-0.5 text-[var(--verb-label)] outline-none hover:text-[var(--verb-text)] disabled:opacity-35 disabled:hover:text-[var(--verb-label)]";
  const modeIndex = REVERB_MODES.indexOf(reverb.mode);
  const frozen = reverb.freeze || freezeHeld;
  const mixSpec = REVERB_CONTROL_SPECS.mix;
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-black/50 bg-[var(--verb-bar)] px-2" data-testid="reverb-top">
      <span className="mr-2 flex items-baseline font-semibold tracking-wide" aria-hidden>
        <span className="text-[15px] text-[var(--verb-decay)]">Reverb</span>
      </span>
      <button type="button" aria-label="Previous preset" className={button} onClick={() => stepReverbPreset(effectId, -1)}>
        <PiCaretLeftFill className="size-2.5" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Presets"
            data-testid="reverb-preset"
            title={reverb.preset ? (REVERB_PRESETS.find((p) => p.name === reverb.preset)?.detail ?? "") : "Changed since the preset was loaded"}
            className={cn("w-[170px] truncate rounded-sm px-2 py-0.5 text-left text-[12.5px] outline-none hover:bg-white/5", edited ? "text-[var(--verb-label)] italic" : "text-[var(--verb-text)]")}
          >
            {name ?? "Untitled"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52" data-testid="reverb-presets">
          {REVERB_FOLDERS.map((folder) => (
            <DropdownMenuSub key={folder}>
              <DropdownMenuSubTrigger>{folder}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-[340px]">
                {REVERB_PRESETS.filter((p) => p.folder === folder).map((p) => (
                  <DropdownMenuItem key={p.name} onSelect={() => chooseReverb(effectId, p.name)} className="items-start py-1.5">
                    <span className="flex min-w-0 flex-col">
                      <span className={cn("font-medium", reverb.preset === p.name && "text-brand")}>
                        {reverb.preset === p.name ? "✓ " : ""}
                        {p.name}
                      </span>
                      <span className="text-[11px] leading-snug text-muted-foreground">{p.detail}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
          <DropdownMenuItem onSelect={() => chooseReverb(effectId, "Init")}>Init</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => copyReverbSettings(effectId)}>Copy settings</DropdownMenuItem>
          <DropdownMenuItem disabled={!copied} onSelect={() => pasteReverbSettings(effectId)}>
            Paste settings
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!edited} onSelect={() => revertReverb(effectId)}>
            Revert
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" aria-label="Next preset" className={button} onClick={() => stepReverbPreset(effectId, 1)}>
        <PiCaretRightFill className="size-2.5" />
      </button>
      <button type="button" aria-label="Revert" title="Back to the preset as loaded" data-testid="reverb-revert" disabled={!edited} className={cn(button, edited && "text-[var(--verb-decay)]")} onClick={() => revertReverb(effectId)}>
        <PiArrowCounterClockwise className="size-3.5" />
      </button>
      <button type="button" aria-label="A/B" data-testid="reverb-ab" className={cn(button, "ml-1 tabular-nums")} onClick={() => toggleReverbAB(effectId)} title="Switch between two settings">
        <span className={reverb.slot === "a" ? "text-[var(--verb-text)]" : ""}>A</span>│<span className={reverb.slot === "b" ? "text-[var(--verb-text)]" : ""}>B</span>
      </button>
      <button type="button" className={button} disabled={same} onClick={() => copyReverbToOther(effectId)} title={`Copy ${reverb.slot.toUpperCase()} to ${reverb.slot === "a" ? "B" : "A"}`}>
        <PiCopySimple className="size-3.5" />
      </button>

      <div className="mx-auto flex items-center gap-1">
        <span className="text-[9.5px] font-semibold tracking-[0.16em] text-[var(--verb-label)]">MODE</span>
        <button type="button" aria-label="Previous mode" className={button} onClick={() => setReverb(effectId, { mode: REVERB_MODES[(modeIndex + REVERB_MODES.length - 1) % REVERB_MODES.length] })}>
          <PiCaretLeftFill className="size-2.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Mode" data-testid="reverb-mode" title={REVERB_MODE_SPECS[reverb.mode].detail} className="w-[104px] rounded-sm px-1.5 py-0.5 text-center text-[12px] text-[var(--verb-text)] outline-none hover:bg-white/5">
              {REVERB_MODE_SPECS[reverb.mode].name}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-[300px]">
            <DropdownMenuRadioGroup value={reverb.mode} onValueChange={(mode) => setReverb(effectId, { mode: mode as Reverb["mode"] })}>
              {REVERB_MODES.map((m) => (
                <DropdownMenuRadioItem key={m} value={m} className="items-start">
                  <span className="flex flex-col">
                    <span>{REVERB_MODE_SPECS[m].name}</span>
                    <span className="text-[11px] text-muted-foreground">{REVERB_MODE_SPECS[m].detail}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" aria-label="Next mode" className={button} onClick={() => setReverb(effectId, { mode: REVERB_MODES[(modeIndex + 1) % REVERB_MODES.length] })}>
          <PiCaretRightFill className="size-2.5" />
        </button>
        <span className="ml-2 text-[9.5px] font-semibold tracking-[0.16em] text-[var(--verb-label)]">ERA</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Era" data-testid="reverb-era" title={REVERB_ERA_SPECS[reverb.era].detail} className="rounded-sm px-1.5 py-0.5 text-[12px] text-[var(--verb-text)] outline-none hover:bg-white/5">
              {REVERB_ERA_SPECS[reverb.era].name}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-[300px]">
            <DropdownMenuLabel>Era</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={reverb.era} onValueChange={(era) => setReverb(effectId, { era: era as Reverb["era"] })}>
              {REVERB_ERAS.map((e) => (
                <DropdownMenuRadioItem key={e} value={e} className="items-start">
                  <span className="flex flex-col">
                    <span>{REVERB_ERA_SPECS[e].name}</span>
                    <span className="text-[11px] text-muted-foreground">{REVERB_ERA_SPECS[e].detail}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        aria-label="Kill"
        aria-pressed={killHeld}
        title="Kill (hold): the input muted while the tail is heard"
        data-testid="reverb-kill"
        className={cn(button, killHeld && "text-[var(--verb-duck)]")}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          holdKill(effectId, true);
          const up = () => {
            holdKill(effectId, false);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
          };
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", up);
        }}
      >
        <PiPower className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Freeze"
        aria-pressed={frozen}
        title="Freeze: the tail held for ever (Alt-click or hold F: while held)"
        data-testid="reverb-freeze"
        className={cn("flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold tracking-wider outline-none", frozen || isInfinite(reverb.decay) ? "bg-[var(--verb-freeze)]/20 text-[var(--verb-freeze)]" : "text-[var(--verb-label)] hover:text-[var(--verb-text)]")}
        onPointerDown={(e) => {
          if (e.button !== 0 || !e.altKey) return;
          // Alt: momentary, let go when released.
          e.preventDefault();
          holdFreeze(effectId, true);
          const up = () => {
            holdFreeze(effectId, false);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointerup", up);
        }}
        onClick={(e) => !e.altKey && toggleFreeze(effectId)}
      >
        <PiSnowflake className="size-3.5" />
        FREEZE
      </button>
      <div className="ml-1 flex items-center">
        <SongCompKnob
          value={mixSpec.fromControl(reverb.mix)}
          defaultValue={mixSpec.fromControl(mixSpec.defaultValue)}
          label="Mix"
          format={(f) => mixSpec.format(mixSpec.toControl(f))}
          parse={(text) => {
            const v = Number(text.replace("%", "")) / (text.includes("%") || Number(text) > 1 ? 100 : 1);
            return Number.isFinite(v) ? mixSpec.fromControl(v) : null;
          }}
          typed={(f) => `${Math.round(mixSpec.toControl(f) * 100)}%`}
          size={22}
          testId="reverb-knob-mix"
          caption={null}
          target={{ kind: "reverb", effect: effectId, control: "mix" }}
          edit={(s, f) => setReverbControl(s, effectId, "mix", mixSpec.toControl(f))}
        />
        <span className="w-9 text-right text-[11px] text-[var(--verb-text)] tabular-nums">{Math.round(reverb.mix * 100)}%</span>
        <button
          type="button"
          aria-label="Mix Lock"
          aria-pressed={reverb.mixLock}
          title="Mix Lock: presets and A/B leave Mix alone"
          data-testid="reverb-mix-lock"
          className={cn(button, reverb.mixLock && "text-[var(--verb-decay)]")}
          onClick={() => setReverb(effectId, { mixLock: !reverb.mixLock })}
        >
          {reverb.mixLock ? <PiLock className="size-3.5" /> : <PiLockOpen className="size-3.5" />}
        </button>
      </div>
      <button
        type="button"
        aria-label={enabled ? "Bypass" : "Enable"}
        aria-pressed={!enabled}
        title="Bypass"
        className={cn("relative rounded-sm p-1 outline-none hover:bg-white/5", enabled ? "text-[var(--verb-label)]" : "text-[var(--verb-duck)]")}
        onClick={() => toggleReverbBypass(effectId)}
      >
        <PiPower className="size-3.5" />
        {!enabled && <span className="absolute inset-x-0.5 -top-1 h-0.5 rounded bg-[var(--verb-duck)]" />}
      </button>
    </div>
  );
}

/** DECAY │ SHAPE, the Decay EQ's bypass, and what's under the display's pointer now. */
function Tabs({ effectId, reverb }: { effectId: string; reverb: Reverb }) {
  const tab = (view: "decay" | "shape", label: string) => (
    <button
      type="button"
      aria-pressed={reverb.view.display === view}
      data-testid={`reverb-tab-${view}`}
      className={cn("px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em] outline-none", reverb.view.display === view ? "text-[var(--verb-decay)]" : "text-[var(--verb-label)] hover:text-[var(--verb-text)]")}
      onClick={() => setReverb(effectId, { view: { display: view } })}
    >
      {label}
    </button>
  );
  return (
    <div className="absolute top-1 left-10 z-10 flex items-center gap-1 rounded-sm bg-black/35 px-1">
      {tab("decay", "DECAY")}
      <span className="text-[var(--verb-panel-edge)]">│</span>
      {tab("shape", "SHAPE")}
      {reverb.view.display === "decay" && (
        <button
          type="button"
          aria-pressed={reverb.bandsBypass}
          aria-label="Bypass the Decay EQ"
          title="Every band off at once: hear what they do"
          data-testid="reverb-bands-bypass"
          className={cn("ml-2 rounded-sm px-1.5 text-[10px] font-semibold tracking-wider outline-none", reverb.bandsBypass ? "text-[var(--verb-duck)]" : "text-[var(--verb-label)] hover:text-[var(--verb-text)]")}
          onClick={() => setReverb(effectId, { bandsBypass: !reverb.bandsBypass })}
        >
          EQ {reverb.bandsBypass ? "OFF" : "ON"}
        </button>
      )}
      <span className="ml-3 text-[10px] text-[var(--verb-text)] tabular-nums" data-testid="reverb-decay-readout">
        {formatDecay(reverb.decay)} @ 1 kHz
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The meters
// ---------------------------------------------------------------------------

/** A level's place on a meter (0..1): −60 .. 0 dBFS. */
const meterAt = (peak: number) => Math.max(0, Math.min(1, (20 * Math.log10(Math.max(peak, 1e-6)) + 60) / 60));

/** In and out (each side), the duck's reduction: drawn every frame from the engine's last word, outside React. */
function Meters({ effectId }: { effectId: string }) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const clip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const live = latest(effectId);
      const values = live ? [meterAt(live.input[0]), meterAt(live.input[1]), meterAt(live.output[0]), meterAt(live.output[1]), Math.min(1, -live.duck / 24)] : [0, 0, 0, 0, 0];
      values.forEach((v, i) => {
        const el = refs.current[i];
        if (el) el.style.transform = i === 4 ? `scaleY(${v})` : `scaleY(${v})`;
      });
      if (clip.current) clip.current.style.opacity = live?.clip ? "1" : "0.15";
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [effectId]);
  const bar = (i: number, colour: string, fromTop = false) => (
    <div className="relative h-full w-[5px] overflow-hidden rounded-[1px] bg-black/50">
      <div ref={(el) => void (refs.current[i] = el)} className={cn("absolute inset-0", fromTop ? "origin-top" : "origin-bottom")} style={{ background: colour, transform: "scaleY(0)" }} />
    </div>
  );
  return (
    <div className="flex w-[64px] shrink-0 flex-col items-center gap-1 border-l border-[var(--verb-panel-edge)] bg-[var(--verb-section)] px-1 pt-2 pb-5" data-testid="reverb-meters">
      <div ref={clip} title="The loop's guard clipped" className="h-1.5 w-8 rounded-sm bg-[var(--verb-duck)]" style={{ opacity: 0.15 }} />
      <div className="flex min-h-0 flex-1 items-stretch gap-[3px]">
        <div className="flex flex-col items-center gap-0.5">
          <div className="flex min-h-0 flex-1 gap-[2px]">
            {bar(0, "var(--verb-meter)")}
            {bar(1, "var(--verb-meter)")}
          </div>
          <span className="text-[8.5px] text-[var(--verb-label)]">IN</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <div className="flex min-h-0 flex-1 gap-[2px]">
            {bar(2, "var(--verb-decay)")}
            {bar(3, "var(--verb-decay)")}
          </div>
          <span className="text-[8.5px] text-[var(--verb-label)]">OUT</span>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <div className="flex min-h-0 flex-1">{bar(4, "var(--verb-duck)", true)}</div>
          <span className="text-[8.5px] text-[var(--verb-label)]">DUCK</span>
        </div>
      </div>
    </div>
  );
}

/** The de-esser's lamp: glows with how much it's taking off. */
function DeEssLamp({ effectId }: { effectId: string }) {
  const lamp = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const live = latest(effectId);
      if (lamp.current) lamp.current.style.opacity = String(0.15 + 0.85 * Math.min(1, (live?.deEss ?? 0) / 6));
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [effectId]);
  return <span ref={lamp} title="De-essing" data-testid="reverb-de-ess-lamp" className="size-2 rounded-full bg-[var(--verb-meter-hot)]" style={{ opacity: 0.15 }} />;
}


