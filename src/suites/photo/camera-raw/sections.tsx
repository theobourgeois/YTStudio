/**
 * Camera Raw's sections (docs/photo/camera-raw.md, "The Camera Raw window"), as Adobe's Edit column shows them:
 * each a header (a triangle that folds it, its title, an eye that hides what it does while held) and its controls.
 * The window and Properties both show these; where a change goes is the caller's (`CameraRawSink`).
 *
 * Sliders behave like Camera Raw's: a double-click on the label or the thumb resets one, ↑ ↓ in its field nudge
 * it (⇧: 10), Temperature's, Tint's, Vibrance's and Saturation's tracks are drawn in their colours, and a
 * two-sided slider's range runs from its middle.
 */
import { useMemo, useState } from "react";
import { PiCaretDown, PiCaretRight, PiEye, PiEyedropper } from "react-icons/pi";
import { Slider as SliderPrimitive } from "radix-ui";
import { CAMERA_RAW_PARAMS, CAMERA_RAW_SECTIONS, type CameraRawSection } from "@shared/photo/effects/camera-raw/index";
import { toneFunction } from "@shared/photo/effects/camera-raw/develop";
import type { ChoiceParam, NumberParam, ParamSpec } from "@shared/photo/effects/params";
import type { CurveSet, EffectParamValue } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type CurveSetEdit, CurveSetEditor } from "../panels/curves-editor";
import { GradingPanel, MixerPanel } from "./colour-sections";

/** Where the sections' changes go: a drag is `begin`, `apply`…, `end` (or `cancel`); a typed value or a reset the same, at once. */
export interface CameraRawSink {
  begin: () => void;
  apply: (patch: Record<string, EffectParamValue>) => void;
  end: () => void;
  cancel: () => void;
}

/** A whole change in one step (a typed value, a reset, a button). */
const once = (sink: CameraRawSink, patch: Record<string, EffectParamValue>) => {
  sink.begin();
  sink.apply(patch);
  sink.end();
};

/** A Camera Raw parameter's spec by key. */
export const cameraRawSpec = (key: string): ParamSpec => CAMERA_RAW_PARAMS.find((p) => p.key === key)!;
const specOf = cameraRawSpec;
const number = (key: string) => specOf(key) as NumberParam;

/** The tracks Camera Raw draws in colour. */
const TRACKS: Record<string, string> = {
  temperature: "linear-gradient(to right, #3a6fd9, #c9cdd6, #e3c13a)",
  tint: "linear-gradient(to right, #35b34a, #c9cdd6, #c94fc9)",
  vibrance: "linear-gradient(to right, #8a8a8a, #c46a6a, #c4b65a, #5ab46a, #5a8ac4, #a65ac4)",
  saturation: "linear-gradient(to right, #8a8a8a, #c46a6a, #c4b65a, #5ab46a, #5a8ac4, #a65ac4)",
  glowWarmth: "linear-gradient(to right, #6f9fe8, #c9cdd6, #f0a050)",
};

const OPEN_KEY = "photo.cameraRaw.open";
/** Which sections are unfolded (this computer's: the window and Properties alike). */
function useOpenSections() {
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null") as string[] | null;
      if (Array.isArray(saved)) return new Set(saved);
    } catch {
      // A bad saved value: the default.
    }
    return new Set(["light", "color", "effects"]);
  });
  const toggle = (id: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      return next;
    });
  return { open, toggle };
}

export function CameraRawSections({
  params,
  sink,
  onHide,
  picking,
  onPick,
}: {
  params: Record<string, EffectParamValue>;
  sink: CameraRawSink;
  /** The eye: a section's work hidden while it's held (the window shows it without; Properties has none). */
  onHide?: (section: CameraRawSection | null) => void;
  /** White balance's eyedropper: whether it's waiting for a click on the canvas, and asking for one. */
  picking?: boolean;
  onPick?: () => void;
}) {
  const { open, toggle } = useOpenSections();
  const slider = (key: string) => <CameraRawSlider key={key} spec={number(key)} value={params[key] as number} sink={sink} />;
  return (
    <div className="flex flex-col" data-camera-raw-sections>
      {CAMERA_RAW_SECTIONS.map(({ id, label }) => (
        <section key={id} className="border-b border-line last:border-b-0" data-section={id}>
          <header className="flex h-8 items-center gap-1">
            <button type="button" className="flex h-full flex-1 items-center gap-1.5 text-left text-[13px] font-semibold" aria-expanded={open.has(id)} onClick={() => toggle(id)}>
              {open.has(id) ? <PiCaretDown className="size-3.5 text-muted-foreground" /> : <PiCaretRight className="size-3.5 text-muted-foreground" />}
              {label}
            </button>
            {onHide && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Hold to hide ${label}`}
                    className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground active:text-brand"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      onHide(id);
                    }}
                    onPointerUp={() => onHide(null)}
                    onPointerCancel={() => onHide(null)}
                  >
                    <PiEye />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Hold to see the picture without {label}</TooltipContent>
              </Tooltip>
            )}
          </header>
          {open.has(id) && (
            <div className="flex flex-col gap-2 pb-3 pl-5">
              {id === "light" && ["exposure", "contrast", "highlights", "shadows", "whites", "blacks"].map(slider)}
              {id === "color" && (
                <>
                  <WhiteBalanceRow params={params} sink={sink} picking={picking} onPick={onPick} />
                  {["temperature", "tint", "vibrance", "saturation"].map(slider)}
                  <ChoiceRow spec={specOf("treatment") as ChoiceParam} value={params.treatment as string} sink={sink} />
                </>
              )}
              {id === "effects" && (
                <>
                  {["texture", "clarity", "dehaze"].map(slider)}
                  <Disclosed label="Glow" more={["glowRange", "glowSpread", "glowWarmth", "glowStyle"]} params={params} sink={sink}>
                    {slider("glow")}
                  </Disclosed>
                  <Disclosed label="Vignette" more={["vignetteMidpoint", "vignetteRoundness", "vignetteFeather", "vignetteHighlights", "vignetteStyle"]} params={params} sink={sink}>
                    {slider("vignette")}
                  </Disclosed>
                  <Disclosed label="Grain" more={["grainSize", "grainRoughness"]} params={params} sink={sink}>
                    {slider("grain")}
                  </Disclosed>
                </>
              )}
              {id === "curve" && <CurvePanel params={params} sink={sink} />}
              {id === "mixer" && <MixerPanel params={params} sink={sink} />}
              {id === "grading" && <GradingPanel params={params} sink={sink} />}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

const shown = (v: number, spec: NumberParam) => (spec.decimals ? v.toFixed(spec.decimals) : String(Math.round(v)));

/** One of Camera Raw's sliders: its label, its value typed, its track. */
export function CameraRawSlider({ spec, value, sink, track }: { spec: NumberParam; value: number; sink: CameraRawSink; track?: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  const reset = () => once(sink, { [spec.key]: spec.default });
  const set = (v: number) => once(sink, { [spec.key]: Math.max(spec.min, Math.min(spec.max, Number(v.toFixed(spec.decimals)))) });
  const twoSided = spec.min < 0;
  const at = (v: number) => ((v - spec.min) / (spec.max - spec.min)) * 100;
  const from = twoSided ? at(0) : 0;
  const to = at(value);
  const colours = track ?? TRACKS[spec.key];
  return (
    <div className="flex flex-col gap-0.5" data-param={spec.key}>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex-1 cursor-default text-xs select-none" onDoubleClick={reset}>
              {spec.label}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{spec.description} Double-click to reset.</TooltipContent>
        </Tooltip>
        <input
          aria-label={spec.label}
          inputMode="decimal"
          className="h-6 w-14 rounded border border-line bg-surface-0 px-1.5 text-right text-xs tabular-nums outline-none focus:border-brand"
          value={typed ?? `${value > 0 ? "+" : ""}${shown(value, spec)}`}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={() => {
            if (typed !== null && typed.trim() !== "" && Number.isFinite(Number(typed))) set(Number(typed));
            setTyped(null);
          }}
          onKeyDown={(e) => {
            // Enter sets what's typed and stays (the window's Enter is OK only outside its fields).
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (typed !== null && typed.trim() !== "" && Number.isFinite(Number(typed))) set(Number(typed));
              setTyped(null);
              e.currentTarget.select();
            }
            // Escape drops what's typed; with nothing typed it's the window's (Cancel).
            if (e.key === "Escape" && typed !== null) {
              e.stopPropagation();
              setTyped(null);
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const step = (e.shiftKey ? 10 : 1) * (spec.decimals ? 0.1 : 1) * (e.key === "ArrowUp" ? 1 : -1);
              setTyped(null);
              set(value + step);
            }
          }}
        />
      </div>
      <SliderPrimitive.Root
        className="relative flex h-4 w-full cursor-pointer touch-none items-center select-none"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={[value]}
        aria-label={`${spec.label} slider`}
        onPointerDown={() => sink.begin()}
        onValueChange={([v]) => sink.apply({ [spec.key]: v })}
        onValueCommit={() => sink.end()}
      >
        <SliderPrimitive.Track className={`sunken relative grow overflow-hidden rounded-full ${colours ? "h-1.5" : "h-1"}`} style={colours ? { background: colours } : undefined}>
          {!colours && <span className="absolute inset-y-0 bg-brand" style={{ left: `${Math.min(from, to)}%`, width: `${Math.abs(to - from)}%` }} />}
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb aria-label={`${spec.label} slider`} className="raised block size-3 rounded-full outline-none hover:raised-hover" onDoubleClick={reset} />
      </SliderPrimitive.Root>
    </div>
  );
}

function ChoiceRow({ spec, value, sink }: { spec: ChoiceParam; value: string; sink: CameraRawSink }) {
  return (
    <div className="flex items-center gap-2" data-param={spec.key}>
      <span className="flex-1 text-xs">{spec.label}</span>
      <div className="flex gap-0.5" role="radiogroup" aria-label={spec.label}>
        {spec.options.map((o) => (
          <Button key={o.value} size="sm" variant={value === o.value ? "secondary" : "ghost"} role="radio" aria-checked={value === o.value} className="h-6 px-2 text-xs" onClick={() => once(sink, { [spec.key]: o.value })}>
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** White balance: As Shot (no change) or Custom (the sliders moved), and the eyedropper. */
function WhiteBalanceRow({ params, sink, picking, onPick }: { params: Record<string, EffectParamValue>; sink: CameraRawSink; picking?: boolean; onPick?: () => void }) {
  const custom = params.temperature !== 0 || params.tint !== 0;
  return (
    <div className="flex items-center gap-2" data-white-balance>
      <span className="flex-1 text-xs">White balance</span>
      <select
        aria-label="White balance"
        className="h-6 rounded border border-line bg-surface-0 px-1 text-xs"
        value={custom ? "custom" : "shot"}
        onChange={(e) => e.target.value === "shot" && once(sink, { temperature: 0, tint: 0 })}
      >
        <option value="shot">As Shot</option>
        <option value="custom" disabled={!custom}>
          Custom
        </option>
      </select>
      {onPick && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={picking ? "secondary" : "ghost"} size="icon-sm" aria-label="White balance eyedropper" aria-pressed={picking} onClick={onPick}>
              <PiEyedropper />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Click something on the canvas that should be neutral grey</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/** A slider with a triangle that shows its further controls (Vignette's, Grain's), as Camera Raw's. */
function Disclosed({ label, more, params, sink, children }: { label: string; more: string[]; params: Record<string, EffectParamValue>; sink: CameraRawSink; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">{children}</div>
        <button type="button" aria-label={`${open ? "Hide" : "Show"} ${label}'s settings`} aria-expanded={open} className="mt-0.5 grid size-5 place-items-center text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)}>
          {open ? <PiCaretDown className="size-3" /> : <PiCaretRight className="size-3 rotate-180" />}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1.5 pl-3">
          {more
            .map((k) => specOf(k))
            .filter((spec) => spec.key !== "vignetteHighlights" || params.vignetteStyle === "highlight")
            .map((spec: ParamSpec) =>
              spec.kind === "number" ? (
                <CameraRawSlider key={spec.key} spec={spec} value={params[spec.key] as number} sink={sink} />
              ) : spec.kind === "choice" ? (
                <div key={spec.key} className="flex items-center gap-2" data-param={spec.key}>
                  <span className="flex-1 text-xs">{spec.label}</span>
                  <select aria-label={spec.label} className="h-6 rounded border border-line bg-surface-0 px-1 text-xs" value={params[spec.key] as string} onChange={(e) => once(sink, { [spec.key]: e.target.value })}>
                    {spec.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null,
            )}
        </div>
      )}
    </div>
  );
}

const CURVE_MODES = ["parametric", "point"] as const;

/** The Curve section: the parametric curve (its graph, regions and splits) or the point curves. */
function CurvePanel({ params, sink }: { params: Record<string, EffectParamValue>; sink: CameraRawSink }) {
  const [mode, setMode] = useState<(typeof CURVE_MODES)[number]>("parametric");
  const edit: CurveSetEdit = {
    begin: sink.begin,
    apply: (next: CurveSet) => sink.apply({ pointCurve: next }),
    end: sink.end,
    cancel: sink.cancel,
    commit: (next: CurveSet) => once(sink, { pointCurve: next }),
  };
  return (
    <div className="flex flex-col gap-2" data-curve-mode={mode}>
      <div className="flex gap-0.5" role="radiogroup" aria-label="Curve">
        {CURVE_MODES.map((m) => (
          <Button key={m} size="sm" variant={mode === m ? "secondary" : "ghost"} role="radio" aria-checked={mode === m} className="h-6 flex-1 text-xs" onClick={() => setMode(m)}>
            {m === "parametric" ? "Parametric" : "Point"}
          </Button>
        ))}
      </div>
      {mode === "parametric" ? (
        <>
          <ParametricGraph params={params} />
          {["curveHighlights", "curveLights", "curveDarks", "curveShadows"].map((k) => (
            <CameraRawSlider key={k} spec={number(k)} value={params[k] as number} sink={sink} />
          ))}
          <div className="grid grid-cols-3 gap-1.5">
            {["curveShadowSplit", "curveMidtoneSplit", "curveHighlightSplit"].map((k) => (
              <SplitField key={k} spec={number(k)} value={params[k] as number} params={params} sink={sink} />
            ))}
          </div>
        </>
      ) : (
        <CurveSetEditor set={params.pointCurve as CurveSet} edit={edit} />
      )}
    </div>
  );
}

/** A split, typed (kept between its neighbours, as Camera Raw keeps them in order). */
function SplitField({ spec, value, params, sink }: { spec: NumberParam; value: number; params: Record<string, EffectParamValue>; sink: CameraRawSink }) {
  const order = ["curveShadowSplit", "curveMidtoneSplit", "curveHighlightSplit"];
  const i = order.indexOf(spec.key);
  const lo = i > 0 ? (params[order[i - 1]] as number) + 5 : spec.min;
  const hi = i < 2 ? (params[order[i + 1]] as number) - 5 : spec.max;
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground" data-param={spec.key}>
      {spec.label.replace(" Split", "")}
      <input
        type="number"
        className="h-6 rounded border border-line bg-surface-0 px-1 text-xs text-foreground tabular-nums outline-none focus:border-brand"
        value={value}
        min={lo}
        max={hi}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) once(sink, { [spec.key]: Math.round(Math.max(lo, Math.min(hi, v))) });
        }}
      />
    </label>
  );
}

/** The parametric curve's shape, with its splits, as Camera Raw draws it (the regions' sliders move it). */
function ParametricGraph({ params }: { params: Record<string, EffectParamValue> }) {
  const keys = ["curveHighlights", "curveLights", "curveDarks", "curveShadows", "curveShadowSplit", "curveMidtoneSplit", "curveHighlightSplit"];
  const signature = keys.map((k) => params[k]).join(",");
  const d = useMemo(() => {
    const only = Object.fromEntries(keys.map((k) => [k, params[k]]));
    const f = toneFunction(only) ?? ((c: number) => c);
    const parts: string[] = [];
    for (let i = 0; i <= 128; i++) {
      const x = (i / 128) * 255;
      parts.push(`${i ? "L" : "M"}${x.toFixed(2)},${(255 - Math.max(0, Math.min(255, f(x)))).toFixed(2)}`);
    }
    return parts.join("");
    // The curve's settings, by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  return (
    <svg viewBox="0 0 255 255" preserveAspectRatio="none" className="sunken aspect-square w-full overflow-visible rounded text-foreground" aria-label="Parametric curve" data-parametric-graph>
      {[64, 128, 191].map((v) => (
        <line key={v} x1={0} y1={v} x2={255} y2={v} className="stroke-line" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      ))}
      {["curveShadowSplit", "curveMidtoneSplit", "curveHighlightSplit"].map((k) => {
        const x = ((params[k] as number) / 100) * 255;
        return <line key={k} x1={x} y1={0} x2={x} y2={255} className="stroke-muted-foreground/50" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
      })}
      <line x1={0} y1={255} x2={255} y2={0} className="stroke-muted-foreground/40" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
