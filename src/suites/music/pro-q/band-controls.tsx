import { useRef } from "react";
import { PiCaretLeftFill, PiCaretRightFill, PiGearSix, PiPower, PiScissors, PiX } from "react-icons/pi";
import { cn } from "cn";
import { clamp } from "@shared/math";
import { PLACEMENT_NAMES, SHAPE_NAMES, dragBands, editBands, editProQ, frequencyText, gainText, parseTyped, qText, setShape, slopeText, updateBands } from "@shared/music/pro-q";
import { EQ_CONTROL_SCALES, EQ_MAX_GAIN, EQ_MAX_Q, EQ_MIN_Q, EQ_MIN_THRESHOLD, canBeDynamic, hasGain, shapeSlopes, usesQ } from "@shared/music/pro-q-presets";
import { EQ_PLACEMENTS, EQ_SHAPES, type EqBand, type EqSlope, type MusicProject, type ProQ } from "@shared/music/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { startPointerDrag } from "@/lib/pointer-drag";
import { CURSOR } from "../cursors";
import { songGesture } from "../store";
import { useTransport } from "../transport";
import { clearBandsDynamics, deleteBands, editEq, splitSelected, stepBand } from "./actions";
import { bandColour } from "./draw";
import { type EqView, dotOf } from "./geometry";
import { SongEqKnob } from "./knob";
import { ShapeIcon } from "./shape-icon";
import { useEqView } from "./store";

const F = EQ_CONTROL_SCALES;
/** The panel's width, for placing it under the selection. */
const WIDTH = 560;

/**
 * The band controls (Pro-Q's floating panel), under the selected bands: bypass, shape and slope, FREQ,
 * GAIN with the dynamic range ring round it (and, for a dynamic band, Auto or a threshold with the level
 * in its range), Gain-Q, Q, the band's number with the arrows to the next, delete, placement and split.
 * With several bands selected, each knob moves them all (frequencies together, gains scaled together).
 */
export function BandControls({ effectId, pq, view, bottom }: { effectId: string; pq: ProQ; view: EqView; bottom: number }) {
  const selectedIds = useEqView(effectId).selected;
  const bands = pq.bands.filter((b) => selectedIds.includes(b.id));
  const live = useTransport((s) => s.eq[effectId]?.bands);
  const ringGesture = useRef(songGesture()).current;
  if (!bands.length) return null;
  const band = bands.find((b) => b.id === selectedIds[selectedIds.length - 1]) ?? bands[0];
  const ids = new Set(bands.map((b) => b.id));
  const several = bands.length > 1;
  const colour = several ? "var(--eq-curve)" : bandColour(band.id);
  // Under the selection, inside the display.
  const centre = bands.reduce((sum, b) => sum + dotOf(view, b).x, 0) / bands.length;
  const left = clamp(centre - WIDTH / 2, 8, Math.max(8, view.width - WIDTH - 8));
  const gainful = bands.some((b) => hasGain(b.shape));
  const dynamic = band.range !== 0;
  const target = (control: "frequency" | "gain" | "q" | "range") => (several ? undefined : ({ kind: "proQ", effect: effectId, band: band.id, control }) as const);
  /** Every selected band moved with the shown one (`base`: the bands as the gesture began). */
  const moveAll = (song: MusicProject, frequency: number | null, gain: number | null) =>
    editProQ(song, effectId, (p) => ({ ...p, bands: dragBands(p.bands, ids, band.id, frequency, gain) }));
  const scaleQ = (song: MusicProject, q: number) =>
    editProQ(song, effectId, (p) => {
      const from = p.bands.find((b) => b.id === band.id)?.q ?? band.q;
      return { ...p, bands: p.bands.map((b) => (ids.has(b.id) ? { ...b, q: clamp(b.q * (q / from), EQ_MIN_Q, EQ_MAX_Q) } : b)) };
    });
  const liveGain = live?.[String(band.id)]?.gain ?? null;

  return (
    <div
      className="absolute z-10 flex items-center gap-3 rounded-xl border border-[var(--eq-panel-edge)] bg-[var(--eq-panel)]/85 px-3 pt-2 pb-1.5 backdrop-blur-sm"
      style={{ left, bottom: bottom + 6, width: WIDTH, boxShadow: `0 6px 24px rgba(0,0,0,0.5), 0 0 18px -6px ${colour}` }}
      data-testid="pro-q-band-controls"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Bypass, shape and slope. */}
      <div className="flex w-[104px] shrink-0 flex-col gap-1.5">
        <button
          type="button"
          aria-label={band.enabled ? "Bypass the band" : "Enable the band"}
          aria-pressed={!band.enabled}
          className={cn("w-fit rounded-md border border-white/5 bg-black/30 p-1", band.enabled ? "text-[var(--eq-label)] hover:text-[var(--eq-text)]" : "text-[var(--eq-dynamic)]")}
          onClick={() => editEq(effectId, (p) => updateBands(p, ids, { enabled: !band.enabled }))}
        >
          <PiPower className="size-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Shape" className="flex items-center gap-1.5 rounded-md border border-white/5 bg-black/25 px-2 py-1 text-[11px] text-[var(--eq-text)] hover:bg-black/40">
              <ShapeIcon shape={band.shape} className="size-3.5" />
              {several && bands.some((b) => b.shape !== band.shape) ? "(Multiple)" : SHAPE_NAMES[band.shape]}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={band.shape} onValueChange={(v) => editEq(effectId, (p) => setShape(p, ids, v as EqBand["shape"]))}>
              {EQ_SHAPES.map((shape) => (
                <DropdownMenuRadioItem key={shape} value={shape}>
                  <ShapeIcon shape={shape} className="mr-2 size-3.5" />
                  {SHAPE_NAMES[shape]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={band.shape === "flatTilt"}>
            <button type="button" aria-label="Slope" className="text-left text-[11px] text-[var(--eq-label)] hover:text-[var(--eq-text)] disabled:opacity-40">
              {band.shape === "flatTilt" ? "—" : slopeText(band.slope)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={String(band.slope)} onValueChange={(v) => editEq(effectId, (p) => updateBands(p, ids, { slope: (v === "brickwall" ? v : Number(v)) as EqSlope }))}>
              {shapeSlopes(band.shape).map((slope) => (
                <DropdownMenuRadioItem key={slope} value={String(slope)}>
                  {slopeText(slope)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <SongEqKnob
        label="FREQ"
        size={50}
        ends={["10 Hz", "30 kHz"]}
        value={F.frequency.toFraction(band.frequency)}
        defaultValue={F.frequency.toFraction(1000)}
        format={(v) => frequencyText(F.frequency.toValue(v))}
        typed={(v) => String(Math.round(F.frequency.toValue(v) * 100) / 100)}
        parse={(t) => {
          const hz = parseTyped(t, "frequency");
          return hz === null ? null : F.frequency.toFraction(hz);
        }}
        target={target("frequency")}
        automation={{ own: band.frequency, toFraction: F.frequency.toFraction }}
        edit={(song, v) => moveAll(song, F.frequency.toValue(v), null)}
      />

      {/* GAIN, the dynamic range ring round it, and its dynamics' controls. */}
      <div className="relative flex flex-col items-center">
        {canBeDynamic(band.shape) && (
          <div className="absolute -top-1 left-1/2 z-10 flex -translate-x-1/2 -translate-y-full items-center gap-1 text-[10px] text-[var(--eq-label)]">
            {dynamic && (
              <>
                <button type="button" aria-label="Clear dynamics" title="Clear dynamics" className="hover:text-[var(--eq-text)]" onClick={() => clearBandsDynamics(effectId, [...ids])}>
                  <PiX className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="Bypass dynamics"
                  aria-pressed={!band.dynamics}
                  title="Bypass dynamics"
                  className={band.dynamics ? "hover:text-[var(--eq-text)]" : "text-[var(--eq-dynamic)]"}
                  onClick={() => editEq(effectId, (p) => updateBands(p, ids, { dynamics: !band.dynamics }))}
                >
                  <PiPower className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="Auto threshold"
                  aria-pressed={band.threshold === null}
                  title={band.threshold === null ? "Auto threshold: click to set one" : "A threshold set: click for Auto"}
                  className={cn("rounded-sm px-1 hover:text-[var(--eq-text)]", band.threshold === null && "text-[var(--eq-text)]")}
                  onClick={() => editEq(effectId, (p) => updateBands(p, ids, { threshold: band.threshold === null ? clamp(Math.round((live?.[String(band.id)]?.level ?? -20) + 4), EQ_MIN_THRESHOLD, 0) : null }))}
                >
                  {band.threshold === null ? "Auto" : `${band.threshold.toFixed(1)}`}
                </button>
                {/* Pro-Q 3's External Side Chain: only with a threshold of its own. */}
                {band.threshold !== null && (
                  <button
                    type="button"
                    aria-label="External side chain"
                    aria-pressed={!!band.external}
                    title={band.external ? "External side chain: its dynamics hear the slot's key (the Mixer slot's Sidechain input). Click for its own range" : "Trigger on the slot's key (its Sidechain input in the Mixer) rather than its own range"}
                    data-testid="pro-q-external"
                    className={cn("rounded-sm px-1 font-semibold hover:text-[var(--eq-text)]", band.external && "text-[var(--eq-dynamic)]")}
                    onClick={() => editEq(effectId, (p) => editBands(p, ids, ({ external: _, ...b }) => (band.external ? b : { ...b, external: true })))}
                  >
                    SC
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <SongEqKnob
          label="GAIN"
          ends={["−30", "+30"]}
          size={58}
          bipolar
          disabled={!gainful}
          value={F.gain.toFraction(hasGain(band.shape) ? band.gain : 0)}
          defaultValue={0.5}
          format={(v) => gainText(F.gain.toValue(v))}
          typed={(v) => String(Math.round(F.gain.toValue(v) * 100) / 100)}
          parse={(t) => {
            const db = parseTyped(t, "gain");
            return db === null ? null : F.gain.toFraction(clamp(db, -EQ_MAX_GAIN, EQ_MAX_GAIN));
          }}
          target={target("gain")}
          automation={{ own: band.gain, toFraction: F.gain.toFraction }}
          edit={(song, v) => moveAll(song, null, F.gain.toValue(v))}
          ring={
            canBeDynamic(band.shape)
              ? {
                  from: F.gain.toFraction(band.gain),
                  to: F.gain.toFraction(clamp(band.gain + band.range, -EQ_MAX_GAIN, EQ_MAX_GAIN)),
                  live: liveGain === null ? null : F.gain.toFraction(clamp(band.gain + liveGain, -EQ_MAX_GAIN, EQ_MAX_GAIN)),
                  onBegin: () => ringGesture.begin(),
                  onDrag: (delta) => {
                    const range = clamp(Math.round(delta * 2 * EQ_MAX_GAIN * 100) / 100, -EQ_MAX_GAIN, EQ_MAX_GAIN);
                    ringGesture.apply((s) => editProQ(s, effectId, (p) => updateBands(p, ids, { range })));
                  },
                  onEnd: () => ringGesture.end(),
                  onCancel: () => ringGesture.cancel(),
                }
              : undefined
          }
        />
      </div>

      {dynamic && band.threshold !== null && <ThresholdSlider effectId={effectId} ids={[...ids]} threshold={band.threshold} level={live?.[String(band.id)]?.level ?? null} />}

      <button
        type="button"
        aria-label="Gain-Q interaction"
        aria-pressed={pq.gainQ}
        title="Gain-Q interaction: a Bell narrows as it's boosted or cut, as an analog EQ's does"
        className={cn("self-start rounded-md p-1", pq.gainQ ? "text-[var(--eq-curve)]" : "text-[var(--eq-label)] hover:text-[var(--eq-text)]")}
        onClick={() => editEq(effectId, (p) => ({ ...p, gainQ: !p.gainQ }))}
      >
        <PiGearSix className="size-3.5" />
      </button>

      <SongEqKnob
        label="Q"
        size={50}
        ends={["0.025", "40"]}
        disabled={!usesQ(band)}
        value={F.q.toFraction(band.q)}
        defaultValue={F.q.toFraction(1)}
        format={(v) => qText(F.q.toValue(v))}
        typed={(v) => String(Math.round(F.q.toValue(v) * 1000) / 1000)}
        parse={(t) => {
          const q = parseTyped(t, "q");
          return q === null ? null : F.q.toFraction(clamp(q, EQ_MIN_Q, EQ_MAX_Q));
        }}
        target={target("q")}
        automation={{ own: band.q, toFraction: F.q.toFraction }}
        edit={(song, v) => scaleQ(song, F.q.toValue(v))}
      />

      {/* The band's number and the arrows; delete; placement and split. */}
      <div className="ml-auto flex w-[104px] shrink-0 flex-col items-end gap-1.5">
        <div className="flex items-center gap-1 text-[11px] text-[var(--eq-label)]">
          <button type="button" aria-label="Previous band" className="hover:text-[var(--eq-text)]" onClick={() => stepBand(effectId, -1)}>
            <PiCaretLeftFill className="size-2.5" />
          </button>
          <span className="w-4 text-center tabular-nums" style={{ color: several ? undefined : bandColour(band.id) }}>
            {several ? "#" : band.id}
          </span>
          <button type="button" aria-label="Next band" className="hover:text-[var(--eq-text)]" onClick={() => stepBand(effectId, 1)}>
            <PiCaretRightFill className="size-2.5" />
          </button>
          <button type="button" aria-label={several ? "Delete the bands" : "Delete the band"} className="ml-2 rounded-md border border-white/5 bg-black/30 p-1 hover:text-[var(--eq-text)]" onClick={() => deleteBands(effectId, [...ids])}>
            <PiX className="size-3" />
          </button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Stereo placement" className="flex items-center gap-1.5 rounded-md border border-white/5 bg-black/25 px-2 py-1 text-[11px] text-[var(--eq-text)] hover:bg-black/40">
              <span className="size-1.5 rounded-full" style={{ background: `var(--eq-${band.placement === "stereo" ? "curve" : band.placement})` }} />
              {PLACEMENT_NAMES[band.placement]}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={band.placement} onValueChange={(v) => editEq(effectId, (p) => updateBands(p, ids, { placement: v as EqBand["placement"] }))}>
              {EQ_PLACEMENTS.map((placement) => (
                <DropdownMenuRadioItem key={placement} value={placement}>
                  <span className="mr-2 size-1.5 rounded-full" style={{ background: `var(--eq-${placement === "stereo" ? "curve" : placement})` }} />
                  {PLACEMENT_NAMES[placement]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={band.placement === "mid" || band.placement === "side" ? "Split into mid and side" : "Split into left and right"}
          title="Split: a copy for each side"
          className="text-[var(--eq-label)] hover:text-[var(--eq-text)]"
          onClick={() => splitSelected(effectId, [...ids])}
        >
          <PiScissors className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/** A dynamic band's threshold: a slider with the level in its range shown as a meter behind it. */
function ThresholdSlider({ effectId, ids, threshold, level }: { effectId: string; ids: number[]; threshold: number; level: number | null }) {
  const gesture = useRef(songGesture()).current;
  const HEIGHT = 56;
  const at = (db: number) => (1 - (db - EQ_MIN_THRESHOLD) / -EQ_MIN_THRESHOLD) * HEIGHT;
  return (
    <div
      role="slider"
      aria-label="Threshold"
      aria-valuemin={EQ_MIN_THRESHOLD}
      aria-valuemax={0}
      aria-valuenow={threshold}
      title={`Threshold: ${threshold.toFixed(1)} dB`}
      className="relative w-2.5 cursor-ns-resize rounded-full bg-black/50"
      style={{ height: HEIGHT }}
      onPointerDown={(e) => {
        const startY = e.clientY;
        const from = threshold;
        startPointerDrag(e, {
          threshold: 0,
          cursor: CURSOR.moveV,
          onStart: () => gesture.begin(),
          onMove: (ev) => {
            const db = clamp(Math.round((from + ((startY - ev.clientY) / HEIGHT) * -EQ_MIN_THRESHOLD * (ev.shiftKey ? 0.1 : 1)) * 10) / 10, EQ_MIN_THRESHOLD, 0);
            gesture.apply((s) => editProQ(s, effectId, (p) => updateBands(p, ids, { threshold: db })));
          },
          onEnd: () => gesture.end(),
          onCancel: () => gesture.cancel(),
        });
      }}
    >
      {level !== null && level > EQ_MIN_THRESHOLD && (
        <div className="absolute inset-x-0 bottom-0 rounded-full bg-gradient-to-t from-[var(--eq-meter)] to-[var(--eq-meter-hot)]" style={{ height: HEIGHT - at(clamp(level, EQ_MIN_THRESHOLD, 0)) }} />
      )}
      <div className="absolute -inset-x-1 h-1.5 -translate-y-1/2 rounded-sm bg-[var(--eq-text)]" style={{ top: at(threshold) }} />
    </div>
  );
}
