/**
 * One parameter of a layer effect, as its spec says (a slider and its number, a dial, a menu, a colour, a contour, a
 * gradient, a pattern): the Layer Style window's pages and Properties' Effects both draw them. An angle or altitude
 * with Use Global Light on shows and sets the document's. Where a change goes is the caller's.
 */
import type { ParamSpec } from "@shared/photo/effects/params";
import { styleDefinition } from "@shared/photo/style/definitions";
import { stylePatterns } from "@shared/photo/style/style";
import type { BlendMode, Contour, EffectInstance, EffectParamValue, GlobalLight, Gradient, PhotoPattern } from "@shared/photo/types";
import { useShallow } from "zustand/react/shallow";
import { ColorSwatchPicker } from "@/components/color-picker";
import { ScrubNumber } from "@/components/scrub-number";
import { Slider } from "@/components/ui/slider";
import { BlendModeMenu } from "../../panels/blend-mode-menu";
import { usePhoto } from "../../store";
import { AngleDial } from "./angle-dial";
import { ContourPicker } from "./contour-picker";
import { GradientPicker } from "./gradient-picker";
import { PatternPicker } from "./pattern-picker";

const NO_PATTERNS: PhotoPattern[] = [];

export interface StyleParamProps {
  effect: EffectInstance;
  spec: ParamSpec;
  globalLight: GlobalLight;
  onParams: (params: Record<string, EffectParamValue>) => void;
  onGlobalLight: (patch: Partial<GlobalLight>) => void;
  /** A blend mode under the pointer in its menu (null: none), to show meanwhile. */
  onHoverMode?: (mode: BlendMode | null) => void;
  onDeletePattern: (id: string) => void;
}

export function StyleParam({ effect, spec, globalLight, onParams, onGlobalLight, onHoverMode, onDeletePattern }: StyleParamProps) {
  const p = effect.params;
  const value = p[spec.key];
  switch (spec.kind) {
    case "number": {
      const global = p.globalLight === true;
      if (spec.key === "angle") return <AngleDial value={global ? globalLight.angle : (value as number)} onChange={(a) => (global ? onGlobalLight({ angle: a }) : onParams({ angle: a }))} />;
      // Bevel's altitude is the Global Light's too.
      const shown = spec.key === "altitude" && global ? globalLight.altitude : (value as number);
      const change = (v: number) => (spec.key === "altitude" && global ? onGlobalLight({ altitude: v }) : onParams({ [spec.key]: v }));
      return (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Slider aria-label={`${spec.label} slider`} min={spec.min} max={spec.key === "distance" ? Math.max(200, shown) : spec.max} step={spec.step} value={[shown]} onValueChange={([v]) => change(v)} className="min-w-0 flex-1" />
          <span className="w-16 shrink-0 rounded border border-line bg-surface-0 px-1">
            <ScrubNumber label={spec.label} value={shown} display={{ min: spec.min, max: spec.max, step: spec.step, decimals: spec.decimals, unit: spec.unit }} onBegin={() => {}} onChange={change} onEnd={() => {}} />
          </span>
        </span>
      );
    }
    case "choice":
      return spec.radio ? (
        <span className="flex flex-wrap gap-x-3 gap-y-1" role="radiogroup" aria-label={spec.label}>
          {spec.options.map((o) => (
            <label key={o.value} className="flex items-center gap-1">
              <input type="radio" name={`${effect.id}-${spec.key}`} checked={value === o.value} onChange={() => onParams({ [spec.key]: o.value })} className="accent-[var(--brand)]" />
              {o.label}
            </label>
          ))}
        </span>
      ) : (
        <select value={value as string} onChange={(e) => onParams({ [spec.key]: e.target.value })} className="h-7 min-w-0 rounded border border-line bg-surface-0 px-1.5" aria-label={spec.label}>
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "boolean":
      return <Check label={spec.label} checked={value === true} onChange={(v) => onParams({ [spec.key]: v })} />;
    case "colour":
      return <ColorSwatchPicker value={value as string} label={spec.label} edit={{ begin: () => {}, set: (c) => onParams({ [spec.key]: c }), end: () => {} }} className="h-6 w-10" />;
    case "blend":
      return (
        <BlendModeMenu
          className="w-44 max-w-full"
          value={value as BlendMode}
          onPreview={(mode) => onHoverMode?.(mode)}
          onChoose={(mode) => {
            onHoverMode?.(null);
            onParams({ [spec.key]: mode });
          }}
        />
      );
    case "contour":
      return <ContourPicker value={value as Contour} onChange={(c) => onParams({ [spec.key]: c })} />;
    case "gradient":
      return <GradientPicker value={value as Gradient} onChange={(g) => onParams({ [spec.key]: g })} />;
    case "pattern":
      return <PatternParam effect={effect} spec={spec} onParams={onParams} onDeletePattern={onDeletePattern} />;
    default:
      return null;
  }
}

/** A pattern: the photo's patterns (as shown now) and those its layers' effects read. */
function PatternParam({ effect, spec, onParams, onDeletePattern }: Pick<StyleParamProps, "effect" | "spec" | "onParams" | "onDeletePattern">) {
  const patterns = usePhoto((s) => s.history?.doc.doc.patterns) ?? NO_PATTERNS;
  const inUse = usePhoto(useShallow((s) => (s.history ? stylePatterns(s.history.doc.doc.layers) : [])));
  const keys = styleDefinition(effect.type)?.patterns?.find((k) => k.pattern === spec.key);
  return (
    <PatternPicker
      value={effect.params[spec.key] as string}
      patterns={patterns}
      inUse={inUse}
      onChange={(id) => onParams({ [spec.key]: id })}
      onSnap={keys ? () => onParams({ [keys.phaseX]: 0, [keys.phaseY]: 0 }) : undefined}
      onDelete={onDeletePattern}
    />
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--brand)]" />
      {label}
    </label>
  );
}
