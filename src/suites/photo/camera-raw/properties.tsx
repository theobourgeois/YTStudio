/**
 * A Camera Raw filter or adjustment layer in Properties: Open Camera Raw…, and its sections for quick touches, each
 * change one undo step (the window's are one for the whole session).
 */
import { useState } from "react";
import { PiArrowCounterClockwise, PiAperture } from "react-icons/pi";
import { effectDefinition } from "@shared/photo/effects/index";
import { defaultParams } from "@shared/photo/effects/params";
import { Button } from "@/components/ui/button";
import { photoGesture, usePhoto, usePhotoDoc } from "../store";
import { cameraRawActions, cameraRawEdit, cameraRawOf, CAMERA_RAW } from "./actions";
import { CameraRawSections, type CameraRawSink } from "./sections";

export function CameraRawProperties({ layerId, filterId }: { layerId: string; filterId: string | null }) {
  const target = { layerId, filterId };
  const params = usePhotoDoc((d) => cameraRawOf(d, target)?.params);
  const [gesture] = useState(() => photoGesture());
  if (!params) return null;
  // Each change carries the whole parameters, as the window's do (absolute: a gesture applies it again and again).
  const latest = () => cameraRawOf(usePhoto.getState().history!.doc.doc, target)?.params ?? params;
  const sink: CameraRawSink = {
    begin: () => gesture.begin(),
    apply: (patch) => gesture.apply(cameraRawEdit(target, { ...latest(), ...patch })),
    end: () => gesture.end(),
    cancel: () => gesture.cancel(),
  };
  return (
    <div className="flex flex-col gap-2" data-camera-raw-properties={filterId ? "filter" : "adjustment"}>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={() => cameraRawActions.edit(layerId, filterId)}>
          <PiAperture /> Open Camera Raw…
        </Button>
        <Button size="sm" variant="ghost" onClick={() => usePhoto.getState().commit(cameraRawEdit(target, defaultParams(effectDefinition(CAMERA_RAW)!.params)))}>
          <PiArrowCounterClockwise /> Reset
        </Button>
      </div>
      <CameraRawSections params={params} sink={sink} />
    </div>
  );
}
