/**
 * A press of a brush that reads its pixels (`EffectStroke`): its samples along the pointer, as the Brush's, every
 * coalesced sample in order, committed when it's let go and dropped by Escape.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { startPointerDrag } from "@/lib/pointer-drag";
import type { DocPointOf } from "./kit";
import type { EffectStroke } from "./effect-stroke";

export function dragStroke(e: ReactPointerEvent<HTMLDivElement>, docPoint: DocPointOf, stroke: EffectStroke) {
  stroke.add([docPoint(e.clientX, e.clientY)]);
  startPointerDrag(e, {
    threshold: 0,
    onMove: (ev) => {
      const samples = ev.getCoalescedEvents?.() ?? [];
      stroke.add((samples.length ? samples : [ev]).map((s) => docPoint(s.clientX, s.clientY)));
    },
    onEnd: () => void stroke.end(),
    onCancel: () => stroke.cancel(),
    onClick: () => void stroke.end(),
  });
}
