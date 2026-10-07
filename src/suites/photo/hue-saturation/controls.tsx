/**
 * Hue/Saturation's controls (docs/photo/hue-saturation.md), as Photoshop's dialog and its Properties lay them out:
 * Preset, the range edited (Master or one colour), Hue, Saturation and Lightness, Colorize, and the two colour bars
 * (every hue as it was, and as it comes out), the range edited lit on them. The window and Properties both show
 * these; where a change goes is the caller's (`ParamsSink`).
 */
import { useMemo, useState } from "react";
import { HUE_RANGES, type HueChannel, channelKeys } from "@shared/photo/effects/hue-saturation";
import { effectDefinition } from "@shared/photo/effects/index";
import type { NumberParam } from "@shared/photo/effects/params";
import { hslToRgb, hueSaturationEncoded, hueSaturationSettings, rangeWeight } from "@shared/photo/reference/hue-saturation";
import type { EffectParamValue } from "@shared/photo/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CameraRawSlider } from "../camera-raw/sections";
import type { ParamsSink } from "../effect-window";

const def = () => effectDefinition("hue-saturation")!;
const specOf = (key: string) => def().params.find((p) => p.key === key) as NumberParam;

/** A whole change in one step (a menu, a box). */
const once = (sink: ParamsSink, patch: Record<string, EffectParamValue>) => {
  sink.begin();
  sink.apply(patch);
  sink.end();
};

const hex = (rgb: readonly number[]) => `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("")}`;
const STEPS = 36;
const spectrum = (colour: (hue: number) => readonly number[]) => `linear-gradient(to right, ${Array.from({ length: STEPS + 1 }, (_, i) => hex(colour((i / STEPS) * 360))).join(", ")})`;

/** The sliders' tracks: the wheel as Hue turns it (from red), grey to colour, black to white. */
const HUE_TRACK = spectrum((h) => hslToRgb(h - 180, 1, 0.5));
const WHEEL_TRACK = spectrum((h) => hslToRgb(h, 1, 0.5));
const SATURATION_TRACK = "linear-gradient(to right, #808080, #ff2020)";
const LIGHTNESS_TRACK = "linear-gradient(to right, #000000, #808080, #ffffff)";

/** Which preset these parameters are, if any. */
function presetOf(params: Record<string, EffectParamValue>): string {
  const defaults = Object.fromEntries(def().params.map((p) => [p.key, p.default]));
  for (const preset of def().presets ?? []) {
    const values = { ...defaults, ...preset.params({ width: 1, height: 1 }) };
    if (def().params.every((p) => values[p.key] === params[p.key])) return preset.id;
  }
  return "custom";
}

export function HueSaturationControls({ params, sink }: { params: Record<string, EffectParamValue>; sink: ParamsSink }) {
  const [chosen, setChannel] = useState<HueChannel>("master");
  const colorize = params.colorize === true;
  const channel: HueChannel = colorize ? "master" : chosen;
  const keys = channelKeys(channel);
  const label = (key: string, name: string): NumberParam => ({ ...specOf(key), label: name });
  const sliders: [NumberParam, string][] = colorize
    ? [
        [label("colorizeHue", "Hue"), WHEEL_TRACK],
        [label("colorizeSaturation", "Saturation"), SATURATION_TRACK],
        [label("lightness", "Lightness"), LIGHTNESS_TRACK],
      ]
    : [
        [label(keys.hue, "Hue"), HUE_TRACK],
        [label(keys.saturation, "Saturation"), SATURATION_TRACK],
        [label(keys.lightness, "Lightness"), LIGHTNESS_TRACK],
      ];

  // The bars: every hue as it was, then as it comes out; outside the range edited, dimmed by how little it takes it.
  const bars = useMemo(() => {
    const s = hueSaturationSettings(params);
    const output = spectrum((h) => hueSaturationEncoded(hslToRgb(h, 1, 0.5), s));
    const range = HUE_RANGES.find((r) => r.id === channel);
    const shade = range
      ? `linear-gradient(to right, ${Array.from({ length: STEPS + 1 }, (_, i) => `rgba(0, 0, 0, ${(0.7 * (1 - rangeWeight((i / STEPS) * 360, range.centre))).toFixed(3)})`).join(", ")})`
      : null;
    return { output, shade };
  }, [params, channel]);
  const preset = presetOf(params);

  return (
    <div className="flex flex-col gap-3" data-hue-saturation-controls>
      <div className="flex items-center gap-2">
        <span className="w-14 text-xs text-muted-foreground">Preset</span>
        <Select
          value={preset}
          onValueChange={(id) => {
            const p = def().presets?.find((x) => x.id === id);
            if (p) once(sink, { ...Object.fromEntries(def().params.map((s) => [s.key, s.default])), ...p.params({ width: 1, height: 1 }) });
          }}
        >
          <SelectTrigger size="sm" className="h-7 flex-1 text-xs" aria-label="Preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {preset === "custom" && (
              <SelectItem value="custom" className="text-xs" disabled>
                Custom
              </SelectItem>
            )}
            {def().presets?.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-14 text-xs text-muted-foreground">Edit</span>
        <Select value={channel} onValueChange={(v) => setChannel(v as HueChannel)} disabled={colorize}>
          <SelectTrigger size="sm" className="h-7 flex-1 text-xs" aria-label="Range" data-hue-channel={channel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="master" className="text-xs">
              Master
            </SelectItem>
            {HUE_RANGES.map((r) => (
              <SelectItem key={r.id} value={r.id} className="text-xs">
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {sliders.map(([spec, track]) => (
        <CameraRawSlider key={spec.key} spec={spec} value={params[spec.key] as number} sink={sink} track={track} />
      ))}
      <label className="flex items-center gap-1.5 text-xs" title="Every pixel takes one hue and saturation, keeping its lightness">
        <input
          type="checkbox"
          checked={colorize}
          onChange={(e) => once(sink, { colorize: e.target.checked })}
          className="accent-[var(--brand)]"
          data-param="colorize"
        />
        Colorize
      </label>
      <div className="flex flex-col gap-1" aria-hidden data-hue-bars>
        <div className="relative h-2.5 rounded-sm" style={{ background: WHEEL_TRACK }}>
          {bars.shade && <div className="absolute inset-0 rounded-sm" style={{ background: bars.shade }} />}
        </div>
        <div className="relative h-2.5 rounded-sm" style={{ background: bars.output }} data-hue-output={bars.output}>
          {bars.shade && <div className="absolute inset-0 rounded-sm" style={{ background: bars.shade }} />}
        </div>
      </div>
    </div>
  );
}
