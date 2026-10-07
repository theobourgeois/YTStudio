/**
 * A Hue/Saturation filter or adjustment layer in Properties (Photoshop shows an adjustment layer's controls there):
 * the window's controls, each change one undo step (a drag one too), and Reset.
 */
import { useState } from "react";
import { PiArrowCounterClockwise } from "react-icons/pi";
import { effectDefinition } from "@shared/photo/effects/index";
import { defaultParams } from "@shared/photo/effects/params";
import { Button } from "@/components/ui/button";
import { type ParamsSink, targetEdit, targetEffect } from "../effect-window";
import { photoGesture, usePhoto, usePhotoDoc } from "../store";
import { HUE_SATURATION } from "./actions";
import { HueSaturationControls } from "./controls";

export function HueSaturationProperties({ layerId, filterId }: { layerId: string; filterId: string | null }) {
  const target = { layerId, filterId };
  const params = usePhotoDoc((d) => targetEffect(d, target, HUE_SATURATION)?.params);
  const [gesture] = useState(() => photoGesture());
  if (!params) return null;
  // Each change carries the whole parameters (absolute: a gesture applies it again and again).
  const latest = () => targetEffect(usePhoto.getState().history!.doc.doc, target, HUE_SATURATION)?.params ?? params;
  const sink: ParamsSink = {
    begin: () => gesture.begin(),
    apply: (patch) => gesture.apply(targetEdit(HUE_SATURATION, target, { ...latest(), ...patch })),
    end: () => gesture.end(),
    cancel: () => gesture.cancel(),
  };
  return (
    <div className="flex flex-col gap-3" data-hue-saturation-properties={filterId ? "filter" : "adjustment"}>
      <HueSaturationControls params={params} sink={sink} />
      <Button size="sm" variant="outline" className="self-start" onClick={() => usePhoto.getState().commit(targetEdit(HUE_SATURATION, target, defaultParams(effectDefinition(HUE_SATURATION)!.params)))}>
        <PiArrowCounterClockwise /> Reset
      </Button>
    </div>
  );
}
