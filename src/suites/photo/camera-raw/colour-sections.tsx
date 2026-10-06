/**
 * Camera Raw's Color Mixer and Color Grading sections (docs/photo/camera-raw.md, "CR3"), as Adobe's: the Mixer's
 * eight colours by Hue, Saturation, Luminance or All, each slider's track drawn in what it does; Color Grading's
 * wheels (3-way, or one of Shadows, Midtones, Highlights, Global), a disc whose puck is the tint's hue (round it) and
 * saturation (out from the centre), with its Luminance under it, then Blending and Balance.
 */
import { useState } from "react";
import { GRADING_WHEELS, type GradingWheel, MIXER_COLOURS } from "@shared/photo/effects/camera-raw/index";
import { MIXER_CENTRES } from "@shared/photo/effects/camera-raw/colour";
import type { NumberParam } from "@shared/photo/effects/params";
import type { EffectParamValue } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { startPointerDrag } from "@/lib/pointer-drag";
import { CameraRawSlider, type CameraRawSink, cameraRawSpec } from "./sections";

const hsl = (h: number, s = 100, l = 50) => `hsl(${((h % 360) + 360) % 360} ${s}% ${l}%)`;

/** A Mixer slider's track: the hues it turns between, grey to the colour, or dark to light. */
function mixerTrack(kind: "hue" | "saturation" | "luminance", i: number): string {
  const h = MIXER_CENTRES[i];
  if (kind === "hue") return `linear-gradient(to right, ${hsl(h - 40)}, ${hsl(h)}, ${hsl(h + 40)})`;
  if (kind === "saturation") return `linear-gradient(to right, ${hsl(h, 0)}, ${hsl(h, 90)})`;
  return `linear-gradient(to right, ${hsl(h, 70, 18)}, ${hsl(h, 80, 50)}, ${hsl(h, 80, 85)})`;
}

const MIXER_KINDS = [
  { id: "hue", label: "Hue" },
  { id: "saturation", label: "Saturation" },
  { id: "luminance", label: "Luminance" },
  { id: "all", label: "All" },
] as const;

export function MixerPanel({ params, sink }: { params: Record<string, EffectParamValue>; sink: CameraRawSink }) {
  const [shown, setShown] = useState<(typeof MIXER_KINDS)[number]["id"]>("hue");
  const group = (kind: "hue" | "saturation" | "luminance") =>
    MIXER_COLOURS.map((c, i) => {
      const spec = cameraRawSpec(`${kind}${c}`) as NumberParam;
      return <CameraRawSlider key={spec.key} spec={spec} value={params[spec.key] as number} sink={sink} track={mixerTrack(kind, i)} />;
    });
  return (
    <div className="flex flex-col gap-2" data-mixer={shown}>
      <div className="flex gap-0.5" role="radiogroup" aria-label="Color Mixer">
        {MIXER_KINDS.map((k) => (
          <Button key={k.id} size="sm" variant={shown === k.id ? "secondary" : "ghost"} role="radio" aria-checked={shown === k.id} className="h-6 flex-1 px-1 text-xs" onClick={() => setShown(k.id)}>
            {k.label}
          </Button>
        ))}
      </div>
      {shown === "all" ? (
        (["hue", "saturation", "luminance"] as const).map((kind) => (
          <div key={kind} className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">{kind}</span>
            {group(kind)}
          </div>
        ))
      ) : (
        group(shown)
      )}
    </div>
  );
}

const WHEEL_VIEWS = [{ id: "3-way", label: "3-way" }, ...GRADING_WHEELS.map((w) => ({ id: w, label: w[0].toUpperCase() + w.slice(1) }))] as const;
const wheelLabel = (w: GradingWheel) => w[0].toUpperCase() + w.slice(1);

export function GradingPanel({ params, sink }: { params: Record<string, EffectParamValue>; sink: CameraRawSink }) {
  const [view, setView] = useState<"3-way" | GradingWheel>("3-way");
  const slider = (key: string) => <CameraRawSlider key={key} spec={cameraRawSpec(key) as NumberParam} value={params[key] as number} sink={sink} />;
  const wheel = (w: GradingWheel, size: number) => (
    <ColourWheel wheel={w} size={size} hue={params[`${w}Hue`] as number} saturation={params[`${w}Saturation`] as number} sink={sink} />
  );
  return (
    <div className="flex flex-col gap-2" data-grading={view}>
      <div className="flex gap-0.5" role="radiogroup" aria-label="Color Grading view">
        {WHEEL_VIEWS.map((v) => (
          <Button key={v.id} size="sm" variant={view === v.id ? "secondary" : "ghost"} role="radio" aria-checked={view === v.id} className="h-6 flex-1 px-1 text-[11px]" onClick={() => setView(v.id)}>
            {v.label}
          </Button>
        ))}
      </div>
      {view === "3-way" ? (
        <>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[11px] text-muted-foreground">Midtones</span>
            {wheel("midtones", 112)}
            <div className="w-full">{slider("midtonesLuminance")}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(["shadows", "highlights"] as const).map((w) => (
              <div key={w} className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-muted-foreground">{wheelLabel(w)}</span>
                {wheel(w, 96)}
                <div className="w-full">{slider(`${w}Luminance`)}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex justify-center">{wheel(view, 152)}</div>
          {[`${view}Hue`, `${view}Saturation`, `${view}Luminance`].map((key) =>
            key.endsWith("Hue") ? (
              <CameraRawSlider key={key} spec={cameraRawSpec(key) as NumberParam} value={params[key] as number} sink={sink} track={`linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 359].map((h) => hsl(h)).join(", ")})`} />
            ) : (
              slider(key)
            ),
          )}
        </div>
      )}
      {view !== "global" && (
        <>
          {slider("gradingBlending")}
          {slider("gradingBalance")}
        </>
      )}
    </div>
  );
}

/**
 * A colour wheel: hue round it (0° red to the right, anticlockwise), saturation out from the centre; the puck is
 * dragged (or the disc pressed where it should go); a double-click puts the wheel back to no tint.
 */
export function ColourWheel({ wheel, size, hue, saturation, sink }: { wheel: GradingWheel; size: number; hue: number; saturation: number; sink: CameraRawSink }) {
  const r = size / 2;
  const at = (e: { clientX: number; clientY: number }, box: DOMRect) => {
    const dx = e.clientX - (box.left + r);
    const dy = e.clientY - (box.top + r);
    const s = Math.min(1, Math.hypot(dx, dy) / (r - 6));
    const h = Math.round(((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360) % 360;
    return { [`${wheel}Hue`]: h, [`${wheel}Saturation`]: Math.round(s * 100) };
  };
  const angle = (hue * Math.PI) / 180;
  const reach = (saturation / 100) * (r - 6);
  const stops = Array.from({ length: 13 }, (_, k) => `${hsl(360 - k * 30)} ${k * 30}deg`).join(", ");
  return (
    <div
      role="slider"
      aria-label={`${wheelLabel(wheel)} wheel`}
      aria-valuetext={`hue ${hue}°, saturation ${saturation}`}
      aria-valuenow={saturation}
      tabIndex={0}
      className="relative shrink-0 cursor-crosshair touch-none rounded-full shadow-[inset_0_0_0_1px_var(--line)]"
      style={{ width: size, height: size, background: `radial-gradient(closest-side, rgb(128 128 128) 0%, rgb(128 128 128 / 0.6) 35%, rgb(128 128 128 / 0) 100%), conic-gradient(from 90deg, ${stops})` }}
      data-wheel={wheel}
      onPointerDown={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        sink.begin();
        sink.apply(at(e, box));
        const started = startPointerDrag(e, {
          threshold: 0,
          onMove: (ev) => sink.apply(at(ev, box)),
          onEnd: () => sink.end(),
          onCancel: () => sink.cancel(),
          onClick: () => sink.end(),
        });
        if (!started) sink.end();
      }}
      onDoubleClick={() => {
        sink.begin();
        sink.apply({ [`${wheel}Hue`]: 0, [`${wheel}Saturation`]: 0 });
        sink.end();
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1;
        const patch =
          e.key === "ArrowLeft" || e.key === "ArrowRight"
            ? { [`${wheel}Hue`]: (hue + (e.key === "ArrowLeft" ? step : -step) + 360) % 360 }
            : e.key === "ArrowUp" || e.key === "ArrowDown"
              ? { [`${wheel}Saturation`]: Math.max(0, Math.min(100, saturation + (e.key === "ArrowUp" ? step : -step))) }
              : null;
        if (!patch) return;
        e.preventDefault();
        sink.begin();
        sink.apply(patch);
        sink.end();
      }}
    >
      <span className="pointer-events-none absolute top-1/2 left-1/2 size-1 -translate-1/2 rounded-full bg-black/40" />
      <span
        className="pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
        style={{ left: r + Math.cos(angle) * reach, top: r - Math.sin(angle) * reach, background: saturation > 0 ? hsl(hue) : "rgb(128 128 128)" }}
      />
    </div>
  );
}
