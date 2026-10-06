/**
 * The photo suite's controls in the component gallery (`/gallery`): Properties' parameter sliders and the Curves
 * graph, as an adjustment shows them, a glow's parameters and a Lens Flare's Properties, and the Brush's options bar. Outside an open photo their edits go nowhere (the
 * brush's are this browser's): the gallery is for looking.
 */
import { useEffect } from "react";
import { effectDefinition } from "@shared/photo/effects/index";
import type { NumberParam } from "@shared/photo/effects/params";
import { identityCurveSet } from "@shared/photo/effects/params";
import { flarePreset } from "@shared/photo/effects/flare";
import type { AdjustmentLayer, GeneratorLayer } from "@shared/photo/types";
import type { GallerySection } from "@/gallery/types";
import { BrushOptionsBar } from "./options-bar";
import { CurvesEditor } from "./panels/curves-editor";
import { ParamSlider } from "./panels/fields";
import { GeneratorProperties } from "./panels/light";
import { ParamField } from "./panels/params";
import { usePhotoUi } from "./ui";

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

export const PHOTO_SECTIONS: GallerySection[] = [
  { id: "photo-brush", title: "Photo: the Brush's and Eraser's options bar (size, hardness, strength: drag sideways, click to type)", source: "suites/photo/options-bar.tsx", render: () => <BrushOptionsBar /> },
  { id: "photo-adjustments", title: "Photo: an adjustment's sliders, and Curves (straight; an S with its channels' curves faint behind)", source: "suites/photo/panels/fields.tsx, curves-editor.tsx", render: () => <Adjustments /> },
  { id: "photo-light", title: "Photo: a glow's parameters (from its specs), and a Lens Flare's Properties: its handles, blend, elements, a ghost's own", source: "suites/photo/panels/params.tsx, light.tsx", render: () => <Light /> },
];
