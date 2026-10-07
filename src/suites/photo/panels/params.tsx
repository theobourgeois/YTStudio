/**
 * A parameter of any effect, from its spec (effects/system.md: "Panels never contain effect-specific rendering
 * code"): a number's slider and field, a colour's swatch (the app's colour picker), a choice's buttons, a switch, a
 * point's x and y (with "the canvas's centre" for one that can follow it), a gradient's picker. Each change is one undo
 * step, a drag or a colour picked one too; or, with `change`, the caller's (the Filter Gallery's settings before
 * they're applied). Curves and element lists have editors of their own.
 */
import type { ParamSpec } from "@shared/photo/effects/params";
import type { DocPoint, EffectParamValue, Gradient, PhotoProject } from "@shared/photo/types";
import { ColorSwatchPicker } from "@/components/color-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GradientPicker } from "../layer-style/controls/gradient-picker";
import { usePhoto } from "../store";
import { NumberField, ParamSlider, useParamSink } from "./fields";

/** How a parameter's new value changes the document. */
export type ParamEdit = (value: EffectParamValue) => (doc: PhotoProject) => PhotoProject;

function Label({ spec }: { spec: ParamSpec }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex-1 text-xs">{spec.label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{spec.description}</TooltipContent>
    </Tooltip>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

export function ParamField({ spec, value, edit, change }: { spec: ParamSpec; value: EffectParamValue | undefined; edit?: ParamEdit; change?: (value: EffectParamValue) => void }) {
  const gesture = useParamSink(edit, change);
  // (Outside an open photo, the gallery's, a 1080 × 1920 canvas.)
  const centre = usePhoto((s) => [(s.history?.doc.doc.canvas.width ?? 1080) / 2, (s.history?.doc.doc.canvas.height ?? 1920) / 2].join(","));
  switch (spec.kind) {
    case "number":
      return <ParamSlider spec={spec} value={value as number} edit={edit as ((v: number) => (doc: PhotoProject) => PhotoProject) | undefined} change={change} />;
    case "colour":
      return (
        <div className="flex items-center gap-2" data-param={spec.key}>
          <Label spec={spec} />
          <ColorSwatchPicker
            value={value as string}
            label={spec.label}
            side="left"
            edit={{ begin: () => gesture.begin(), set: (hex) => gesture.apply(hex.toLowerCase()), end: () => gesture.end() }}
          />
        </div>
      );
    case "choice":
      // More than four don't fit the panel as buttons (a Gradient Fill's five types): a menu.
      if (spec.options.length > 4)
        return (
          <div className="flex items-center gap-2" data-param={spec.key}>
            <Label spec={spec} />
            <Select value={value as string} onValueChange={(v) => gesture.apply(v)}>
              <SelectTrigger size="sm" className="h-7 w-32 text-xs" aria-label={spec.label}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {spec.options.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      return (
        <div className="flex items-center gap-2" data-param={spec.key}>
          <Label spec={spec} />
          <ToggleGroup type="single" size="sm" variant="outline" value={value as string} onValueChange={(v) => v && gesture.apply(v)} aria-label={spec.label}>
            {spec.options.map((o) => (
              <ToggleGroupItem key={o.value} value={o.value} className="px-2.5 text-xs">
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      );
    case "boolean":
      return (
        <label className="flex items-center gap-2" data-param={spec.key}>
          <Label spec={spec} />
          <Switch checked={value as boolean} onCheckedChange={(v) => gesture.apply(v)} aria-label={spec.label} />
        </label>
      );
    case "point": {
      const follows = value === null;
      const [cx, cy] = centre.split(",").map(Number);
      const p = (value as DocPoint | null) ?? [cx, cy];
      return (
        <div className="flex flex-col gap-1" data-param={spec.key}>
          <div className="flex items-center gap-2">
            <Label spec={spec} />
            {spec.nullable && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={follows} onChange={(e) => gesture.apply(e.target.checked ? null : [p[0], p[1]])} />
                Canvas centre
              </label>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={`${spec.label} X`} value={round(p[0])} disabled={follows} suffix="px" onCommit={(x) => gesture.apply([x, p[1]])} />
            <NumberField label={`${spec.label} Y`} value={round(p[1])} disabled={follows} suffix="px" onCommit={(y) => gesture.apply([p[0], y])} />
          </div>
        </div>
      );
    }
    case "gradient":
      return (
        <div className="flex items-center gap-2" data-param={spec.key}>
          <Label spec={spec} />
          <GradientPicker value={value as Gradient} onChange={(g) => gesture.apply(g)} />
        </div>
      );
    default:
      return null;
  }
}
