/**
 * Properties' Develop (Lightroom's and Lumetri's way): Camera Raw's sections on every image or pixel layer, with no
 * filter to add first. The first touch adds the layer's Camera Raw filter (`develop.ts`), each change one undo step;
 * the header turns it off and on, takes it off again, and opens it in the Camera Raw window for everything else
 * (the histogram, presets, the eyedropper, the before view).
 */
import { useMemo, useRef, useState } from "react";
import { PiArrowCounterClockwise, PiArrowSquareOut, PiEye, PiEyeSlash } from "react-icons/pi";
import { createId } from "@shared/ids";
import { findLayer, removeFilter, setFilter } from "@shared/photo/edits";
import { effectDefinition } from "@shared/photo/effects/index";
import { defaultParams } from "@shared/photo/effects/params";
import type { ContentLayer } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { CameraRawSections, type CameraRawSink } from "../camera-raw/sections";
import { cameraRawActions } from "../camera-raw/actions";
import { currentDoc, photoGesture, usePhoto } from "../store";
import { usePhotoUi } from "../ui";
import { DEVELOP, developEdit, developOf } from "./develop";
import { FoldSection } from "./fold-section";

export function DevelopSection({ layer }: { layer: ContentLayer }) {
  const filter = developOf(layer);
  const inWindow = usePhotoUi((s) => s.cameraRaw?.layerId === layer.id);
  const commit = usePhoto((s) => s.commit);
  const [gesture] = useState(() => photoGesture());
  const defaults = useMemo(() => defaultParams(effectDefinition(DEVELOP)!.params), []);
  // A new filter's id, the same for every change of one gesture.
  const pending = useRef<string | null>(null);
  const now = () => {
    const doc = currentDoc();
    return doc ? developOf(findLayer(doc, layer.id)) : null;
  };
  const sink: CameraRawSink = {
    begin: () => {
      pending.current = null;
      gesture.begin();
    },
    // Each change carries the whole parameters, as Camera Raw's do.
    apply: (patch) => {
      const there = now();
      const id = there?.id ?? (pending.current ??= createId("fx"));
      gesture.apply(developEdit(layer.id, id, { ...(there?.params ?? defaults), ...patch }));
    },
    end: () => gesture.end(),
    cancel: () => gesture.cancel(),
  };
  const def = effectDefinition(DEVELOP)!;
  const summary = filter ? (filter.enabled ? def.summary(filter.params) : "off") : null;
  return (
    <FoldSection
      id="develop"
      title="Develop"
      summary={summary}
      active={filter !== null}
      actions={
        <span className="flex items-center" data-develop={filter ? (filter.enabled ? "on" : "off") : "none"}>
          {filter && (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={filter.enabled ? "Turn Develop off" : "Turn Develop on"}
                title={filter.enabled ? "Turn Develop off" : "Turn Develop on"}
                aria-pressed={!filter.enabled}
                onClick={() => commit((d) => setFilter(d, layer.id, filter.id, { enabled: !filter.enabled }))}
              >
                {filter.enabled ? <PiEye /> : <PiEyeSlash />}
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="Reset Develop" title="Reset: takes the develop off the layer" onClick={() => commit((d) => removeFilter(d, layer.id, filter.id))}>
                <PiArrowCounterClockwise />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Open in Camera Raw"
            title="Open in Camera Raw (⇧⌘A)"
            onClick={() => (filter ? cameraRawActions.edit(layer.id, filter.id) : usePhotoUi.getState().setCameraRaw({ layerId: layer.id, filterId: createId("fx"), adding: { above: null } }))}
          >
            <PiArrowSquareOut />
          </Button>
        </span>
      }
    >
      {inWindow ? (
        <p className="text-xs text-muted-foreground">Developing in the Camera Raw window.</p>
      ) : (
        <div data-develop-sections>
          <CameraRawSections params={filter?.params ?? defaults} sink={sink} />
        </div>
      )}
    </FoldSection>
  );
}
