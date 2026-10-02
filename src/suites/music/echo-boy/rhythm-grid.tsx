import { useRef, useState } from "react";
import { addTap, echoTempo, editTaps, heardTaps, moveTap, updateRhythm } from "@shared/music/echo-boy";
import { maxTapSeconds } from "@shared/music/echo-boy-presets";
import type { EchoBoy, RhythmTap } from "@shared/music/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { songGesture, useMusic, useSong } from "../store";
import { BOTTOM, EDGE, type GridBox, beatX, gridLines, levelY, placeBeat, tapAt, tapReadout, yLevel } from "./rhythm-geometry";

const WIDTH = 210;
const HEIGHT = 76;

/**
 * Rhythm Echo's editor (`docs/soundtoys/echoboy-manual.md`, Editing taps): its taps as bars, left to
 * right in time, their height their level; the "One" (a tap on beat one) yellow. A click adds a tap on
 * the nearest grid line; a tap dragged moves on the grid (⌘ or ⇧: off it, its place and level read out)
 * and up and down; ⌥-click or right-click deletes one; a click on the left edge puts the One back. Taps
 * past what the delay holds at this tempo are grey and silent. Bars show each tap's level, and inside it,
 * brighter, what Shape makes it.
 */
export function RhythmGrid({ effectId, eb }: { effectId: string; eb: EchoBoy }) {
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef(songGesture()).current;
  const tempo = useSong((s) => s.settings.tempo);
  const [readout, setReadout] = useState<RhythmTap | null>(null);
  const r = eb.rhythm;
  const bpm = echoTempo(eb, tempo);
  const box: GridBox = { width: WIDTH, height: HEIGHT, length: r.length };
  // What Shape, Accent and Double make each tap (the One isn't shaped; taps Double drops are silent).
  const heard = heardTaps(eb, bpm);
  const echoes = heard.filter((h) => !h.one);
  let n = 0;
  const played = r.taps.map((tap) => (tap.beat === 0 ? tap.level : (echoes[n++]?.level ?? 0)));
  const tooLate = (beat: number) => (beat * 60) / bpm > maxTapSeconds;
  const commit = (change: (taps: RhythmTap[]) => RhythmTap[]) => useMusic.getState().commit((s) => updateRhythm(s, effectId, (rr) => editTaps(rr, change(rr.taps))));

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * WIDTH, y: ((e.clientY - rect.top) / rect.height) * HEIGHT };
  };

  return (
    <div className="relative">
      <svg
        ref={svg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        className="lcd block cursor-crosshair touch-none rounded"
        role="application"
        aria-label="Rhythm editor: click to add a tap, drag one to move it, Alt-click or right-click to delete it"
        data-testid="echo-rhythm-grid"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          const { x, y } = local(e);
          const index = tapAt(box, r.taps, x);
          // Right-click or ⌥-click: delete.
          if (e.button === 2 || (e.button === 0 && e.altKey)) {
            if (index !== null) commit((taps) => taps.filter((_, i) => i !== index));
            return;
          }
          if (e.button !== 0) return;
          if (index === null) {
            // The left edge: the One back; elsewhere, a tap.
            if (x <= EDGE) commit((taps) => addTap(taps, 0, 1));
            else commit((taps) => addTap(taps, placeBeat(box, x, r.grid, e.metaKey || e.shiftKey), yLevel(box, y)));
            return;
          }
          const base = r.taps;
          startPointerDrag(e, {
            threshold: 2,
            cursor: "grabbing",
            onStart: () => gesture.begin(),
            onMove: (ev) => {
              const p = local(ev);
              const free = ev.metaKey || ev.shiftKey;
              const beat = placeBeat(box, p.x, r.grid, free);
              const level = yLevel(box, p.y);
              gesture.apply((s) => updateRhythm(s, effectId, (rr) => editTaps(rr, moveTap(base, index, beat, level))));
              setReadout(free ? { beat, level } : null);
            },
            onEnd: () => {
              gesture.end();
              setReadout(null);
            },
            onCancel: () => {
              gesture.cancel();
              setReadout(null);
            },
          });
        }}
      >
        {gridLines(box, r.grid).map((line) => (
          <line key={line.x} x1={line.x} x2={line.x} y1={0} y2={HEIGHT - BOTTOM} stroke="var(--lcd-dim)" strokeOpacity={line.beat ? 0.55 : 0.2} />
        ))}
        <line x1={0} x2={WIDTH} y1={HEIGHT - BOTTOM} y2={HEIGHT - BOTTOM} stroke="var(--lcd-dim)" strokeOpacity={0.45} />
        {Array.from({ length: Math.ceil(r.length - 1e-9) }, (_, b) => (
          <text key={b} x={beatX(box, b) + 3} y={HEIGHT - 2.5} fontSize={8} fill="var(--lcd-dim)" className="font-mono select-none">
            {b + 1}
          </text>
        ))}
        {r.taps.map((tap, i) => {
          const x = Math.max(2, beatX(box, tap.beat));
          const one = tap.beat === 0;
          const colour = tooLate(tap.beat) ? "var(--lcd-dim)" : one ? "var(--echo-one)" : "var(--brand)";
          const level = Math.min(tap.level, played[i]);
          return (
            <g key={`${tap.beat}-${i}`} data-tap={tap.beat}>
              <rect x={x - 1.5} y={levelY(box, tap.level)} width={3} height={HEIGHT - BOTTOM - levelY(box, tap.level)} fill={colour} opacity={0.35} />
              <rect x={x - 1.5} y={levelY(box, level)} width={3} height={HEIGHT - BOTTOM - levelY(box, level)} fill={colour} />
            </g>
          );
        })}
      </svg>
      {readout && (
        <div className="pointer-events-none absolute top-1 right-1 rounded-sm bg-popover/90 px-1 py-0.5 font-mono text-[9px] text-popover-foreground" data-testid="echo-tap-readout">
          {tapReadout(readout).at} · {tapReadout(readout).level}
        </div>
      )}
    </div>
  );
}
