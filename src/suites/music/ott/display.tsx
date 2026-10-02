/**
 * OTT's display (`docs/xfer/ott.md`): a row a band, high at the top, each with its gain knob beside it.
 * In a row, dragging moves the gap between the brown and the green (the band's threshold), Ctrl+click on
 * the brown or the green switches that compressor off or on (Xfer's), Alt+click or a double-click resets
 * the threshold, and a right-click is its menu (automation too). The levels come from the engine's
 * transport events, eased each frame.
 */
import { useEffect, useMemo, useRef } from "react";
import { cn } from "cn";
import { controlAt, controlOf, isAutomated, targetKey } from "@shared/music/automation";
import { OTT_BAND_CONTROLS, OTT_CONTROL_SPECS, engineOtt, setOttControl, updateOttBand } from "@shared/music/ott";
import { OTT_BAND_GAIN_RANGE } from "@shared/music/ott-presets";
import type { AutomationTarget, MusicProject, Ott } from "@shared/music/types";
import { ContextMenu, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { startPointerDrag } from "@/lib/pointer-drag";
import { AutomationMenuItems } from "../automation/control";
import { useAutomationUi } from "../automation/store";
import { prepare } from "../piano/draw";
import { positionNow } from "../playhead";
import { songGesture, useMusic } from "../store";
import { useTransport } from "../transport";
import { OttKnob } from "./controls";
import { type OttRow, drawRow, ottColours } from "./draw";
import { ROW_BANDS, ROW_LABELS, dbText, draggedThreshold, xLevel, zoneAt } from "./geometry";

/** A row's size (px). */
export const ROW_WIDTH = 340;
const ROW_HEIGHT = 36;
const commit = (update: (song: MusicProject) => MusicProject) => useMusic.getState().commit(update);
const DB = { scale: 1, unit: "dB", digits: 1 };
const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const NAMES = ["Low", "Mid", "High"] as const;

export function OttDisplay({ effectId, ott }: { effectId: string; ott: Ott }) {
  return (
    <div className="flex flex-col gap-1" data-testid="ott-display">
      {ROW_BANDS.map((band, row) => (
        <div key={band} className="flex items-center gap-2">
          <BandRow effectId={effectId} ott={ott} band={band} row={row} />
          <OttKnob
            label={`${ROW_LABELS[row]} gain`}
            caption=""
            size={26}
            value={ott.bands[band].gain}
            min={OTT_BAND_GAIN_RANGE[0]}
            max={OTT_BAND_GAIN_RANGE[1]}
            defaultValue={0}
            format={db}
            unit={DB}
            target={{ kind: "ott", effect: effectId, control: OTT_BAND_CONTROLS[band].gain }}
            edit={(s, gain) => updateOttBand(s, effectId, band, { gain })}
            inline
          />
        </div>
      ))}
    </div>
  );
}

/** One band's row: its canvas, its gestures and its menu. */
function BandRow({ effectId, ott, band, row }: { effectId: string; ott: Ott; band: number; row: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hot = useRef(false);
  /** A Ctrl+click just switched a compressor: the context menu the Mac makes of it isn't opened. */
  const switched = useRef(false);
  const settings = useRef(ott);
  settings.current = ott;
  const target = useMemo((): AutomationTarget => ({ kind: "ott", effect: effectId, control: OTT_BAND_CONTROLS[band].threshold }), [effectId, band]);
  const b = ott.bands[band];
  const name = NAMES[band];

  // Drawn each frame its levels or settings move: the levels eased towards what the engine last said.
  useEffect(() => {
    let frame = 0;
    let level: number | null = null;
    let output: number | null = null;
    let last = "";
    const ease = (from: number | null, to: number | null) => (to === null ? null : from === null ? to : from + (to - from) * 0.35);
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = canvas.current;
      if (!element) return;
      const heard = useTransport.getState().otts[effectId]?.bands[band];
      const sounding = heard && heard.level > -119;
      level = ease(level, sounding ? heard.level : null);
      output = ease(output, sounding ? heard.level + heard.gain : null);
      const knees = engineOtt(followed(settings.current, band, target)).bands[band];
      const shown: OttRow = { upKnee: knees.upKnee, downKnee: knees.downKnee, upward: settings.current.bands[band].upward, downward: settings.current.bands[band].downward, level, output, hot: hot.current };
      const key = JSON.stringify(shown, (_, v) => (typeof v === "number" ? Math.round(v * 10) / 10 : v));
      if (key === last) return;
      last = key;
      const ctx = prepare(element, ROW_WIDTH, ROW_HEIGHT);
      if (ctx) drawRow(ctx, ROW_WIDTH, ROW_HEIGHT, shown, ROW_LABELS[row], ottColours(element));
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [effectId, band, row, target]);

  const knees = engineOtt(ott).bands[band];
  const at = (e: { clientX: number }) => xLevel(e.clientX - canvas.current!.getBoundingClientRect().left, ROW_WIDTH);
  const resetThreshold = () => commit((s) => updateOttBand(s, effectId, band, { threshold: 1 }));
  const toggle = (which: "upward" | "downward") => commit((s) => updateOttBand(s, effectId, band, { [which]: !settings.current.bands[band][which] }));

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <canvas
          ref={canvas}
          className={cn("block shrink-0 cursor-ew-resize rounded-sm", !b.upward && !b.downward && "opacity-80")}
          style={{ width: ROW_WIDTH, height: ROW_HEIGHT }}
          data-testid={`ott-row-${name.toLowerCase()}`}
          data-threshold={b.threshold}
          data-upward={b.upward}
          data-downward={b.downward}
          aria-label={`${name} band: threshold ${Math.round(b.threshold * 100)}%, upward below ${dbText(knees.upKnee)}${b.upward ? "" : " (off)"}, downward above ${dbText(knees.downKnee)}${b.downward ? "" : " (off)"}`}
          title={`${name} band (${Math.round(b.threshold * 100)}%): drag to move its thresholds; Ctrl+click the brown (upward) or green (downward) to switch it; Alt+click or double-click resets`}
          onPointerEnter={() => (hot.current = true)}
          onPointerLeave={() => (hot.current = false)}
          onDoubleClick={resetThreshold}
          onContextMenu={(e) => {
            if (!switched.current) return;
            switched.current = false;
            e.preventDefault();
          }}
          onPointerDown={(e) => {
            switched.current = false;
            if (e.button !== 0) return;
            if (e.altKey) return resetThreshold();
            if (e.ctrlKey || e.metaKey) {
              const zone = zoneAt(at(e), knees.upKnee, knees.downKnee);
              if (zone !== "gap") toggle(zone === "up" ? "upward" : "downward");
              switched.current = true;
              return;
            }
            const gesture = songGesture();
            const start = b.threshold;
            const automation = useAutomationUi.getState();
            startPointerDrag(e, {
              threshold: 2,
              cursor: "ew-resize",
              onStart() {
                automation.hold(targetKey(target));
                automation.touch(target);
                gesture.begin();
              },
              onMove: (_, travel) => gesture.apply((s) => setOttControl(s, effectId, OTT_BAND_CONTROLS[band].threshold, draggedThreshold(band, start, travel.x, ROW_WIDTH))),
              onEnd() {
                gesture.end();
                automation.release(targetKey(target));
              },
              onCancel() {
                gesture.cancel();
                automation.release(targetKey(target));
              },
            });
          }}
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={resetThreshold}>Reset threshold</ContextMenuItem>
        <ContextMenuCheckboxItem checked={b.upward} onSelect={() => toggle("upward")}>
          Upward compression
        </ContextMenuCheckboxItem>
        <ContextMenuCheckboxItem checked={b.downward} onSelect={() => toggle("downward")}>
          Downward compression
        </ContextMenuCheckboxItem>
        <AutomationMenuItems target={target} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The settings as the display shows them: in song mode, an automated threshold where its automation has
 * it now (unless the hand holds it), as its knob would follow it.
 */
function followed(ott: Ott, band: number, target: AutomationTarget): Ott {
  const song = useMusic.getState().history?.doc;
  if (!song || useTransport.getState().mode !== "song" || useAutomationUi.getState().held.has(targetKey(target)) || !isAutomated(song, target)) return ott;
  const fraction = controlAt(song, target, positionNow() ?? useTransport.getState().songStartTick);
  if (fraction === null) return ott;
  const control = OTT_BAND_CONTROLS[band].threshold;
  return OTT_CONTROL_SPECS[control].set(ott, controlOf(song, target).toControl(fraction));
}
