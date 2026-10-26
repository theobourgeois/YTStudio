import { useMemo } from "react";
import { nearestNote, updateBands, editProQ } from "@shared/music/pro-q";
import type { ProQ } from "@shared/music/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { CURSOR } from "../cursors";
import { songGesture } from "../store";
import { editEq } from "./actions";
import { bandColour } from "./draw";
import { type EqView, hzAt, xOf } from "./geometry";

const midiHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const BLACK = new Set([1, 3, 6, 8, 10]);

/**
 * The piano display (Pro-Q's): a keyboard along the bottom in place of the frequency scale, a grand
 * piano's 88 keys (A0 to C8) lit and the rest dim, each band a dot on it. Click a dot: its band on the
 * nearest note; drag it: the band moves a note at a time.
 */
export function Piano({ effectId, pq, view, bottom }: { effectId: string; pq: ProQ; view: EqView; bottom: number }) {
  const keys = useMemo(() => {
    const list: { midi: number; x0: number; x1: number; black: boolean }[] = [];
    for (let midi = 0; midi <= 135; midi++) {
      const hz = midiHz(midi);
      if (hz < view.low || hz > view.high) continue;
      list.push({ midi, x0: xOf(view, midiHz(midi - 0.5)), x1: xOf(view, midiHz(midi + 0.5)), black: BLACK.has(midi % 12) });
    }
    return list;
  }, [view]);
  return (
    <div className="absolute inset-x-0 bottom-0 overflow-hidden" style={{ height: bottom, width: view.width }} data-testid="pro-q-piano">
      {keys.map((k) => {
        const inPiano = k.midi >= 21 && k.midi <= 108;
        return (
          <div
            key={k.midi}
            className="absolute top-0 border-r border-black/40"
            style={{
              left: k.x0,
              width: Math.max(0.5, k.x1 - k.x0),
              height: k.black ? bottom * 0.62 : bottom,
              background: k.black ? (inPiano ? "#18161a" : "#2a272c") : inPiano ? "#d8d4da" : "#58545a",
              zIndex: k.black ? 1 : 0,
            }}
            title={k.midi % 12 === 0 ? `C${k.midi / 12 - 1}` : undefined}
          />
        );
      })}
      {pq.bands.map((band) => (
        <button
          type="button"
          key={band.id}
          aria-label={`Band ${band.id} on the keyboard`}
          className="absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/50"
          style={{ left: xOf(view, band.frequency), background: bandColour(band.id) }}
          onPointerDown={(e) => {
            e.stopPropagation();
            const gesture = songGesture();
            startPointerDrag(e, {
              threshold: 2,
              cursor: CURSOR.moveH,
              onStart: () => gesture.begin(),
              onMove: (ev) => {
                const rect = e.currentTarget.parentElement!.getBoundingClientRect();
                const frequency = nearestNote(hzAt(view, ev.clientX - rect.left));
                gesture.apply((s) => editProQ(s, effectId, (p) => updateBands(p, [band.id], { frequency })));
              },
              onEnd: () => gesture.end(),
              onCancel: () => gesture.cancel(),
              onClick: () => editEq(effectId, (p) => updateBands(p, [band.id], { frequency: nearestNote(band.frequency) })),
            });
          }}
        />
      ))}
    </div>
  );
}
