/**
 * The photo suite's controls in the component gallery (`/gallery`): Properties' parameter sliders and the Curves
 * graph, as an adjustment shows them, a glow's parameters and a Lens Flare's Properties, the Brush's options bar, and
 * Blending Options' blend-mode menu and Blend If bars, and Layer Style's angle dial, contour and gradient pickers.
 * Outside an open photo their edits go nowhere (the brush's are this browser's): the gallery is for looking.
 */
import { useEffect, useState } from "react";
import { effectDefinition } from "@shared/photo/effects/index";
import type { NumberParam } from "@shared/photo/effects/params";
import { defaultParams, identityCurveSet } from "@shared/photo/effects/params";
import { flarePreset } from "@shared/photo/effects/flare";
import { CONTOUR_PRESETS } from "@shared/photo/style/contours";
import { GRADIENT_PRESETS } from "@shared/photo/style/gradients";
import type { AdjustmentLayer, BlendMode, BlendRange, Contour, GeneratorLayer, Gradient } from "@shared/photo/types";
import type { GallerySection } from "@/gallery/types";
import { BrushOptionsBar } from "./options-bar";
import { CurvesEditor } from "./panels/curves-editor";
import { BlendIfSlider } from "./layer-style/blend-if-slider";
import { AngleDial } from "./layer-style/controls/angle-dial";
import { ContourPicker } from "./layer-style/controls/contour-picker";
import { GradientPicker } from "./layer-style/controls/gradient-picker";
import { PatternPicker } from "./layer-style/controls/pattern-picker";
import { BlendModeMenu } from "./panels/blend-mode-menu";
import { ParamSlider } from "./panels/fields";
import { GeneratorProperties } from "./panels/light";
import { FilterCard } from "./filters";
import { filterEntry } from "@shared/photo/effects/catalog";
import { ParamField } from "./panels/params";
import { usePhotoUi } from "./ui";
import { CAMERA_RAW_PARAMS } from "@shared/photo/effects/camera-raw/index";
import type { EffectParamValue } from "@shared/photo/types";
import { GradingPanel, MixerPanel } from "./camera-raw/colour-sections";
import type { CameraRawSink } from "./camera-raw/sections";

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
  const [pattern, setPattern] = useState("builtin:bricks");
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
      <div className="flex w-72 items-center gap-2">
        <span>Pattern:</span>
        <PatternPicker value={pattern} patterns={[]} onChange={setPattern} onSnap={() => {}} />
      </div>
    </div>
  );
}

/** Light: a glow's parameters (a filter's, from its specs: sliders and a colour), and a Lens Flare's Properties. */
function Light() {
  const glow = effectDefinition("glow")!;
  const values: Record<string, number | string> = { radius: 240, intensity: 0.5, threshold: 75, knee: 25, tint: "#ffb070", tintAmount: 30, mix: 100 };
  const elements = flarePreset("classic", 1080, 1920);
  const flare: GeneratorLayer = {
    id: "gallery-flare",
    kind: "generator",
    name: "Lens Flare",
    visible: true,
    opacity: 1,
    blend: "linear-dodge",
    blendSpace: "linear",
    effect: { id: "gallery-flare_fx", type: "lens-flare", version: 1, enabled: true, params: { source: [324, 653], centre: null, intensity: 0, colour: "#ffffff", elements } },
  };
  // A ghost selected, so its own parameters (a choice among them) show.
  useEffect(() => usePhotoUi.getState().selectElement("e4"), []);
  return (
    <div className="grid grid-cols-2 gap-6 text-sm">
      <div className="flex w-64 flex-col gap-3">
        {glow.params.map((spec) => (
          <ParamField key={spec.key} spec={spec} value={values[spec.key]} edit={() => (d) => d} />
        ))}
      </div>
      <div className="flex w-72 flex-col gap-4">
        <GeneratorProperties layer={flare} />
      </div>
    </div>
  );
}

/** The Filter Gallery's cards: one, the one picked, and one unavailable here (a filter on an adjustment layer). */
function FilterCards() {
  return (
    <div className="grid w-[520px] grid-cols-3 gap-1">
      <FilterCard entry={filterEntry("glow/bloom")!} onPick={() => {}} onApply={() => {}} />
      <FilterCard entry={filterEntry("lens-flare/anamorphic")!} picked onPick={() => {}} onApply={() => {}} />
      <FilterCard entry={filterEntry("glow/halation")!} disabled reason="An adjustment layer: filters work on a layer's own pixels." onPick={() => {}} onApply={() => {}} />
    </div>
  );
}

export const PHOTO_SECTIONS: GallerySection[] = [
  { id: "photo-brush", title: "Photo: the Brush's and Eraser's options bar (size, hardness, strength: drag sideways, click to type)", source: "suites/photo/options-bar.tsx", render: () => <BrushOptionsBar /> },
  { id: "photo-adjustments", title: "Photo: an adjustment's sliders, and Curves (straight; an S with its channels' curves faint behind)", source: "suites/photo/panels/fields.tsx, curves-editor.tsx", render: () => <Adjustments /> },
  { id: "photo-blending", title: "Photo: Blending Options' blend-mode menu (each mode previewed while hovered) and Blend If's bars (⌥-drag splits a handle)", source: "suites/photo/panels/blend-mode-menu.tsx, layer-style/blend-if-slider.tsx", render: () => <Blending /> },
  {
    id: "photo-style-controls",
    title: "Photo: Layer Style's angle dial (drag in the circle, ⇧ snaps to 15°), contour picker (thumbnail: the Contour Editor; arrow: presets), gradient picker (swatch: the Gradient Editor; arrow: presets) and pattern picker (the built-in patterns and the photo's own; Snap to Origin)",
    source: "suites/photo/layer-style/controls/",
    render: () => <StyleControls />,
    shots: [
      { name: "contour-presets", click: "Contour presets" },
      { name: "contour-editor", click: "Contour: Ring. Edit the contour" },
      { name: "gradient-editor", click: "Gradient: White, Transparent. Edit the gradient" },
      { name: "pattern-picker", click: "Pattern: Bricks. Choose a pattern" },
    ],
  },
  { id: "photo-filters", title: "Photo: the Filter Gallery's cards (a look, the one picked, unavailable on this layer)", source: "suites/photo/filters.tsx", render: () => <FilterCards /> },
  { id: "photo-light", title: "Photo: a glow's parameters (from its specs), and a Lens Flare's Properties: its handles, blend, elements, a ghost's own", source: "suites/photo/panels/params.tsx, light.tsx", render: () => <Light /> },
  {
    id: "photo-camera-raw-colour",
    title: "Photo: Camera Raw's Color Mixer (sliders drawn in what they do) and Color Grading's wheels (drag the puck; double-click resets), 3-way and one wheel",
    source: "suites/photo/camera-raw/colour-sections.tsx",
    render: () => <CameraRawColour />,
  },
];

function CameraRawColour() {
  const [params, setParams] = useState<Record<string, EffectParamValue>>(() => ({
    ...defaultParams(CAMERA_RAW_PARAMS),
    hueOrange: 25,
    saturationBlue: -40,
    shadowsHue: 200,
    shadowsSaturation: 45,
    highlightsHue: 35,
    highlightsSaturation: 60,
    midtonesLuminance: -15,
  }));
  const sink: CameraRawSink = { begin: () => {}, apply: (patch) => setParams((p) => ({ ...p, ...patch })), end: () => {}, cancel: () => {} };
  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="w-72">
        <MixerPanel params={params} sink={sink} />
      </div>
      <div className="w-72">
        <GradingPanel params={params} sink={sink} />
      </div>
    </div>
  );
}
