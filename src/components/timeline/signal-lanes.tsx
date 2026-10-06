/**
 * The video's own signals as lanes under the ruler (the visualizer, docs/visualizer/README.md): a band's or
 * a curve's value drawn over time, an events signal's hits as ticks. Hits are dragged along the lane
 * (snapping to the beat while snapping is on), right-clicked away, and a double-click adds one. Only on the
 * main sequence, whose timeline the signals' times are on. Its name opens the Signals window on it.
 */
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { MASTER, currentSignalReader, customSignalLevel, eventTimes } from "@shared/audio-signals";
import { setSignalEvents } from "@shared/links";
import { projectDuration } from "@shared/timeline";
import type { SignalDef } from "@shared/types";
import { addEvent, eventsBetween, moveEvents, removeEvents, snapToBeats } from "@/components/signals/geometry";
import { EditGesture } from "@/lib/edit-gesture";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useEditor } from "@/stores/editor";
import { useSignalView } from "@/stores/signal-view";
import { useSignals } from "@/stores/signals";
import { HEADER_WIDTH, RULER_HEIGHT, SNAP_PX } from "./constants";
import { PlayheadLine } from "./playhead";
import { useVisibleWindow } from "./view-store";

export const SIGNAL_LANE_HEIGHT = 24;

/** Whether the timeline shows signal lanes now (and how many). */
export function useSignalLaneCount(): number {
  const show = useSignalView((s) => s.lanes);
  const count = useEditor((s) => s.project.signals?.length ?? 0);
  const main = useEditor((s) => s.sequenceId === null);
  return show && main ? count : 0;
}

export function SignalLanes({ width, zoom }: { width: number; zoom: number }) {
  const count = useSignalLaneCount();
  const signals = useEditor((s) => s.project.signals);
  if (!count || !signals) return null;
  return (
    <div className="sticky z-30 flex shrink-0 border-b bg-timeline" style={{ top: RULER_HEIGHT, height: count * SIGNAL_LANE_HEIGHT }} data-signal-lanes>
      <div className="sticky left-0 z-20 shrink-0 border-r bg-timeline" style={{ width: HEADER_WIDTH }}>
        {signals.map((d) => (
          <button
            key={d.id}
            type="button"
            title={`${d.name}: open it in the Signals window`}
            onClick={() => useSignalView.getState().show(d.id)}
            className="flex w-full cursor-pointer items-center gap-1.5 px-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
            style={{ height: SIGNAL_LANE_HEIGHT }}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className="truncate">{d.name}</span>
          </button>
        ))}
      </div>
      <div className="relative overflow-hidden" style={{ width }}>
        {signals.map((d, i) => (
          <div key={d.id} className="absolute inset-x-0 border-b border-line/40" style={{ top: i * SIGNAL_LANE_HEIGHT, height: SIGNAL_LANE_HEIGHT }} data-signal-lane={d.id}>
            {d.kind === "events" ? <HitsLane def={d} zoom={zoom} /> : <CurveLane def={d} zoom={zoom} />}
          </div>
        ))}
        <PlayheadLine />
      </div>
    </div>
  );
}

/** A band's or a curve's value over the part of the timeline in view. */
const CurveLane = memo(function CurveLane({ def, zoom }: { def: SignalDef; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [x0, x1] = useVisibleWindow();
  // What it reads changes with the sound (the document) and once the files' signals arrive.
  const document = useEditor((s) => s.document);
  const loaded = useSignals((s) => s.data);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    const reader = currentSignalReader();
    if (!canvas || !g) return;
    const span = Math.max(1, x1 - x0);
    const dpr = Math.min(window.devicePixelRatio || 1, 12_000 / span);
    canvas.width = Math.round(span * dpr);
    canvas.height = Math.round(SIGNAL_LANE_HEIGHT * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, span, SIGNAL_LANE_HEIGHT);
    if (!reader) return;
    const h = SIGNAL_LANE_HEIGHT - 3;
    g.beginPath();
    g.moveTo(0, SIGNAL_LANE_HEIGHT);
    for (let px = 0; px <= span; px += 2) {
      const v = customSignalLevel(reader, def, null, (x0 + px) / zoom);
      g.lineTo(px, SIGNAL_LANE_HEIGHT - 1 - v * h);
    }
    g.lineTo(span, SIGNAL_LANE_HEIGHT);
    g.closePath();
    g.globalAlpha = 0.45;
    g.fillStyle = def.color;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = def.color;
    g.lineWidth = 1;
    g.stroke();
  }, [def, zoom, x0, x1, document, loaded]);
  return <canvas ref={ref} className="pointer-events-none absolute top-0" style={{ left: x0, width: Math.max(1, x1 - x0), height: SIGNAL_LANE_HEIGHT }} />;
});

/** An events signal's hits: ticks to drag, right-click away, or double-click the lane for a new one. */
function HitsLane({ def, zoom }: { def: Extract<SignalDef, { kind: "events" }>; zoom: number }) {
  const [x0, x1] = useVisibleWindow();
  const document = useEditor((s) => s.document);
  const loaded = useSignals((s) => s.data);
  // The song's beats, to snap to.
  const beats = useMemo(() => {
    const reader = currentSignalReader();
    return reader ? eventTimes(reader, null, MASTER, "beats", 0, projectDuration(document)) : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, loaded]);
  const write = (events: typeof def.events) => (p: Parameters<typeof setSignalEvents>[0]) => setSignalEvents(p, def.id, events);

  const onTickDown = (e: React.PointerEvent<HTMLDivElement>, index: number) => {
    e.stopPropagation();
    if (e.button === 2) {
      e.preventDefault();
      useEditor.getState().commit(write(removeEvents(def.events, new Set([index]))));
      return;
    }
    if (e.button !== 0) return;
    const base = def.events;
    const startX = e.clientX;
    const gesture = new EditGesture();
    startPointerDrag(e, {
      threshold: 2,
      cursor: "ew-resize",
      onStart: () => gesture.begin(),
      onMove: (ev) => {
        let time = base[index].time + (ev.clientX - startX) / zoom;
        if (useEditor.getState().snapping) time = snapToBeats(time, beats, SNAP_PX / zoom);
        gesture.apply(write(moveEvents(base, new Set([index]), time - base[index].time)));
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
    });
  };

  return (
    <div
      className="absolute inset-0"
      aria-label={`${def.name} hits`}
      role="group"
      onDoubleClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        let time = (e.clientX - box.left) / zoom;
        if (useEditor.getState().snapping) time = snapToBeats(time, beats, SNAP_PX / zoom);
        useEditor.getState().commit(write(addEvent(def.events, time)));
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {eventsBetween(def.events, x0 / zoom, x1 / zoom).map((i) => {
        const e = def.events[i];
        return (
          <div
            key={`${i}:${e.time}`}
            role="button"
            aria-label={`Hit at ${e.time.toFixed(2)} s (drag to move, right-click to delete)`}
            data-hit={e.time}
            onPointerDown={(ev) => onTickDown(ev, i)}
            onDoubleClick={(ev) => ev.stopPropagation()}
            className="absolute top-1 bottom-1 w-[3px] -translate-x-1/2 cursor-ew-resize rounded-[1px]"
            style={{ left: e.time * zoom, background: def.color, opacity: 0.35 + 0.65 * e.velocity }}
          />
        );
      })}
    </div>
  );
}
