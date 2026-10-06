/**
 * The photo suite's controls in the component gallery (`/gallery`): Properties' parameter sliders and the Curves
 * graph, as an adjustment shows them, and the Brush's options bar. Outside an open photo their edits go nowhere (the
 * brush's are this browser's): the gallery is for looking.
 */
import { effectDefinition } from "@shared/photo/effects/index";
import type { NumberParam } from "@shared/photo/effects/params";
import { identityCurveSet } from "@shared/photo/effects/params";
import type { AdjustmentLayer } from "@shared/photo/types";
import type { GallerySection } from "@/gallery/types";
import { BrushOptionsBar } from "./options-bar";
import { CurvesEditor } from "./panels/curves-editor";
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

export const PHOTO_SECTIONS: GallerySection[] = [
  { id: "photo-brush", title: "Photo: the Brush's options bar (size, hardness, strength, the colours and their swap)", source: "suites/photo/options-bar.tsx", render: () => <BrushOptionsBar /> },
  { id: "photo-adjustments", title: "Photo: an adjustment's sliders, and Curves (straight; an S with its channels' curves faint behind)", source: "suites/photo/panels/fields.tsx, curves-editor.tsx", render: () => <Adjustments /> },
];
