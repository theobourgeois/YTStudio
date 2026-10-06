/**
 * Scale Effects (Photoshop's Layer › Layer Style › Scale Effects, its Scale Layer Effects dialog): every size and
 * distance of the layers' effects scaled at once, without scaling the layers (`scaleStyle`). One gesture: the canvas
 * shows it as it's dragged, OK makes it one undo step, Cancel (or Escape) puts it back.
 */
import { useEffect, useState } from "react";
import { scaleStyle } from "@shared/photo/style/style";
import { ScrubNumber } from "@/components/scrub-number";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { FloatingWindow, centredOnDesktop } from "@/components/windows/floating-window";
import { photoGesture } from "../store";
import { usePhotoUi } from "../ui";

const SCALE = { min: 1, max: 1000, step: 1, decimals: 0, unit: "%" };

export function ScaleEffectsWindow({ layerIds }: { layerIds: string[] }) {
  const [initial] = useState(() => centredOnDesktop(320, 150, "photo"));
  const [gesture] = useState(() => photoGesture());
  const [scale, setScale] = useState(100);
  const [preview, setPreview] = useState(true);
  const close = () => usePhotoUi.getState().setScaleEffects(null);
  useEffect(() => {
    gesture.begin();
    return () => {
      if (gesture.active) gesture.cancel();
    };
  }, [gesture]);
  // Each preview from the document as it was when the window opened.
  const [base] = useState(() => ({ doc: null as null | Parameters<typeof scaleStyle>[0] }));
  useEffect(() => {
    if (!gesture.active) return;
    gesture.apply((doc) => {
      base.doc ??= doc;
      return preview ? scaleStyle(base.doc, layerIds, scale / 100) : base.doc;
    });
  }, [scale, preview, gesture, base, layerIds]);
  const ok = () => {
    gesture.end();
    close();
  };
  const cancel = () => {
    gesture.cancel();
    close();
  };
  return (
    <FloatingWindow id="scale-effects" title="Scale Layer Effects" initial={initial} keepsKeys escapeCloses onClose={cancel} className="w-[320px] max-w-full">
      <form
        className="flex flex-col gap-3 p-3 text-sm"
        data-scale-effects
        onSubmit={(e) => {
          e.preventDefault();
          ok();
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">Scale:</span>
          <Slider aria-label="Scale slider" min={1} max={500} step={1} value={[Math.min(500, scale)]} onValueChange={([v]) => setScale(v)} className="flex-1" />
          <span className="w-16 rounded border border-line bg-surface-0 px-1">
            <ScrubNumber label="Scale" value={scale} display={SCALE} onBegin={() => {}} onChange={(v) => setScale(Math.round(v))} onEnd={() => {}} />
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-1.5">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} className="accent-[var(--brand)]" />
            Preview
          </label>
          <Button type="button" size="sm" variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            OK
          </Button>
        </div>
      </form>
    </FloatingWindow>
  );
}
