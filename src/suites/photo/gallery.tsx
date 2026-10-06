/**
 * The photo suite's controls in the component gallery (`/gallery`): Properties' parameter sliders and the Curves
 * graph, as an adjustment shows them, the Brush's options bar, and Blending Options' blend-mode menu and Blend If
 * bars, and Layer Style's angle dial, contour and gradient pickers. Outside an open photo their edits go nowhere (the
 * brush's are this browser's): the gallery is for looking.
 */
import { effectDefinition } from "@shared/photo/effects/index";
import type { NumberParam } from "@shared/photo/effects/params";
import { identityCurveSet } from "@shared/photo/effects/params";
import { useState } from "react";
import { CONTOUR_PRESETS } from "@shared/photo/style/contours";
import { GRADIENT_PRESETS } from "@shared/photo/style/gradients";
import type { AdjustmentLayer, BlendMode, BlendRange, Contour, Gradient } from "@shared/photo/types";
import type { GallerySection } from "@/gallery/types";
import { BrushOptionsBar } from "./options-bar";
import { CurvesEditor } from "./panels/curves-editor";
import { BlendIfSlider } from "./layer-style/blend-if-slider";
import { AngleDial } from "./layer-style/controls/angle-dial";
import { ContourPicker } from "./layer-style/controls/contour-picker";
import { GradientPicker } from "./layer-style/controls/gradient-picker";
import { BlendModeMenu } from "./panels/blend-mode-menu";
import { ParamSlider } from "./panels/fields";

const curves = (id: string, set: AdjustmentLayer["effect"]["params"]["curves"]): AdjustmentLayer => ({
  id,
  kind: "adjustment",
  name: "Curves",
  visible: true,
  opacity: 1,
  effect: { id: `${id}_fx`, type: "curves", version: 1, enabled: true, params: { curves: set } },
});

function Adjustments() {
  const exposure = effectDefinition("exposure")!.params as NumberParam[];
  const values = { exposure: 1.25, offset: -0.0125, gamma: 1 };
  return (
    <div className="grid grid-cols-3 gap-6 text-sm">
      <div className="flex w-64 flex-col gap-3">
        {exposure.map((spec) => (
          <ParamSlider key={spec.key} spec={spec} value={values[spec.key as keyof typeof values]} edit={() => (d) => d} />
        ))}
      </div>
      <div className="w-64">
        <CurvesEditor layer={curves("gallery-identity", identityCurveSet())} />
      </div>
      <div className="w-64">
        <CurvesEditor
          layer={curves("gallery-s", {
            ...identityCurveSet(),
            rgb: [
              [0, 0],
              [64, 48],
              [192, 210],
              [255, 255],
            ],
            red: [
              [0, 18],
              [255, 255],
            ],
            blue: [
              [0, 0],
              [128, 110],
              [255, 240],
            ],
          })}
        />
      </div>
    </div>
  );
}

/** The blend-mode menu (hover a mode: it shows beside), a Blend If bar whole and one with split handles. */
function Blending() {
  const [mode, setMode] = useState<BlendMode>("multiply");
  const [hovered, setHovered] = useState<BlendMode | null>(null);
  const [whole, setWhole] = useState<BlendRange>([0, 0, 255, 255]);
  const [split, setSplit] = useState<BlendRange>([45, 124, 205, 235]);
  return (
    <div className="flex items-start gap-8 text-sm">
      <div className="flex w-52 flex-col gap-1">
        <BlendModeMenu value={mode} onPreview={setHovered} onChoose={setMode} />
        <span className="text-xs text-muted-foreground">Previewing: {hovered ?? "nothing"}</span>
      </div>
      <div className="flex flex-col gap-3">
        <BlendIfSlider label="Current Layer" range={whole} colour="#fff" onChange={setWhole} />
        <BlendIfSlider label="Underlying Layer" range={split} colour="#f00" onChange={setSplit} />
      </div>
    </div>
  );
}

/** Layer Style's shared controls: the angle dial (and one disabled), the contour picker and the gradient picker. */
function StyleControls() {
  const [angle, setAngle] = useState(120);
  const [contour, setContour] = useState<Contour>(CONTOUR_PRESETS[7]);
  const [gradient, setGradient] = useState<Gradient>(GRADIENT_PRESETS[1]);
  return (
    <div className="flex items-center gap-8 text-xs">
      <div className="flex items-center gap-2">
        <span>Angle:</span>
        <AngleDial value={angle} onChange={setAngle} />
      </div>
      <AngleDial value={-45} onChange={() => {}} disabled />
      <div className="flex items-center gap-2">
        <span>Contour:</span>
        <ContourPicker value={contour} onChange={setContour} />
        <span className="text-muted-foreground">{contour.name}</span>
      </div>
      <div className="flex items-center gap-2">
        <span>Gradient:</span>
        <GradientPicker value={gradient} onChange={setGradient} />
        <span className="text-muted-foreground">{gradient.name}</span>
      </div>
    </div>
  );
}

export const PHOTO_SECTIONS: GallerySection[] = [
  { id: "photo-brush", title: "Photo: the Brush's and Eraser's options bar (size, hardness, strength: drag sideways, click to type)", source: "suites/photo/options-bar.tsx", render: () => <BrushOptionsBar /> },
  { id: "photo-adjustments", title: "Photo: an adjustment's sliders, and Curves (straight; an S with its channels' curves faint behind)", source: "suites/photo/panels/fields.tsx, curves-editor.tsx", render: () => <Adjustments /> },
  { id: "photo-blending", title: "Photo: Blending Options' blend-mode menu (each mode previewed while hovered) and Blend If's bars (⌥-drag splits a handle)", source: "suites/photo/panels/blend-mode-menu.tsx, layer-style/blend-if-slider.tsx", render: () => <Blending /> },
  {
    id: "photo-style-controls",
    title: "Photo: Layer Style's angle dial (drag in the circle, ⇧ snaps to 15°), contour picker (thumbnail: the Contour Editor; arrow: presets) and gradient picker (swatch: the Gradient Editor; arrow: presets)",
    source: "suites/photo/layer-style/controls/",
    render: () => <StyleControls />,
    shots: [
      { name: "contour-presets", click: "Contour presets" },
      { name: "contour-editor", click: "Contour: Ring. Edit the contour" },
      { name: "gradient-editor", click: "Gradient: White, Transparent. Edit the gradient" },
    ],
  },
];
