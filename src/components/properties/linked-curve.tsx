/**
 * A linked property's value over its clip, drawn faintly in its keyframe lane (the visualizer's links):
 * what the sound does to it, beside its keyframes. A point's two parts are two lines.
 */
import { memo, useMemo } from "react";
import { atFrameRate, effectDefinition, effectValuesAt } from "@shared/effects";
import { clipEnd, sourceTime } from "@shared/timeline";
import type { Clip } from "@shared/types";
import { useEditor } from "@/stores/editor";
import { useSignals } from "@/stores/signals";

const SAMPLES = 160;

export const LinkedCurve = memo(function LinkedCurve({ clip, effectId, paramKey }: { clip: Clip; effectId: string; paramKey: string }) {
  const effect = clip.effects.find((e) => e.id === effectId);
  const fps = useEditor((s) => s.project.settings.fps);
  // The sound: the document (what plays where) and the files' signals.
  const document = useEditor((s) => s.document);
  const loaded = useSignals((s) => s.data);
  const lines = useMemo(() => {
    const def = effect && effectDefinition(effect.type);
    if (!def || !effect?.links?.[paramKey]) return [];
    const [start, end] = [clip.start, clipEnd(clip)];
    const values = atFrameRate(fps, () =>
      Array.from({ length: SAMPLES }, (_, i) => {
        const v = effectValuesAt(def, effect, sourceTime(clip, start + ((end - start) * (i + 0.5)) / SAMPLES), clip)[paramKey];
        return typeof v === "number" ? [v] : Array.isArray(v) ? (v as number[]) : [];
      }),
    );
    const parts = values[0]?.length ?? 0;
    return Array.from({ length: parts }, (_, k) => {
      const series = values.map((v) => v[k]);
      const lo = Math.min(...series);
      const hi = Math.max(...series);
      const range = hi - lo || 1;
      return series.map((v, i) => `${((i + 0.5) / SAMPLES) * 1000},${(1 - (v - lo) / range) * 80 + 10}`).join(" ");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, effect, paramKey, fps, document, loaded]);
  if (!lines.length) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full text-brand" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden data-linked-curve>
      {lines.map((points, i) => (
        <polyline key={i} points={points} fill="none" stroke="currentColor" strokeOpacity={i ? 0.25 : 0.4} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
});
