import { useEffect, useMemo, useState } from "react";
import { PiWaveform, PiX } from "react-icons/pi";
import { EQ_BANDS } from "@shared/music/pro-q-presets";
import { addBand } from "@shared/music/pro-q";
import type { ProQ } from "@shared/music/types";
import { useTransport } from "../transport";
import { editEq, selectBands } from "./actions";
import { Average, matchBands, matchDifference } from "./match";
import { useEqUi } from "./store";

/** The engine reports about 25 frames a second. */
const FRAME_SECONDS = 0.04;
/** Seconds of sound each side needs before matching. */
const ENOUGH = 3;

/** What's been heard so far, by Pro-Q: its input (before it) and the reference (another's, after it). */
const heard = new Map<string, { input: Average; reference: Average }>();
export const matchHeard = (effectId: string) => heard.get(effectId) ?? null;

// While EQ Match listens, each frame the engine says goes into the averages.
let lastFrame: unknown = null;
useTransport.subscribe((state) => {
  const match = useEqUi.getState().match;
  if (!match || match.step !== "analyze") return;
  const own = state.eq[match.effectId];
  if (!own || own === lastFrame) return;
  lastFrame = own;
  const data = heard.get(match.effectId);
  if (!data) return;
  data.input.add(own.pre);
  const reference = useEqUi.getState().matchReference;
  if (reference) data.reference.add(state.eq[reference]?.post ?? null);
});

/** Start EQ Match on a Pro-Q against another's sound. */
export function startMatch(effectId: string, reference: string) {
  heard.set(effectId, { input: new Average(), reference: new Average() });
  useEqUi.setState({ match: { effectId, step: "analyze", count: 6 }, matchReference: reference });
}
export const stopMatch = () => useEqUi.setState({ match: null, matchReference: null });

/** The difference asked for and the bands proposed (null until there's enough of both). */
export function useMatch(effectId: string) {
  const match = useEqUi((s) => (s.match?.effectId === effectId ? s.match : null));
  // Re-read as frames arrive while it listens.
  const tick = useTransport((s) => (match?.step === "analyze" ? s.eq[effectId] : null));
  const data = heard.get(effectId);
  const ready = !!data && data.input.frames * FRAME_SECONDS >= ENOUGH && data.reference.frames * FRAME_SECONDS >= ENOUGH;
  const difference = useMemo(() => (match && ready && data ? matchDifference(data.input.levels(), data.reference.levels()) : null), [match?.step, ready, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const proposal = useMemo(() => (match?.step === "match" && difference ? matchBands(difference, match.count) : []), [match?.step, match?.count, difference]);
  return { match, data, ready, difference, proposal };
}

/**
 * EQ Match (Pro-Q's), along the bottom of the display: it listens to the sound going in and the reference
 * while the song plays (the difference drawn as a thick white line once there's enough), then proposes
 * bands, as many as the slider says; Finish adds them.
 */
export function MatchPanel({ effectId, pq }: { effectId: string; pq: ProQ }) {
  const { match, data, ready, proposal } = useMatch(effectId);
  const playing = useTransport((s) => s.playing);
  const [, redraw] = useState(0);
  useEffect(() => {
    if (match?.step !== "analyze") return;
    const timer = setInterval(() => redraw((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, [match?.step]);
  if (!match || !data) return null;
  const free = EQ_BANDS - pq.bands.length;
  const seconds = (frames: number) => `${Math.round(frames * FRAME_SECONDS)} s`;
  const finish = () => {
    const made: number[] = [];
    editEq(effectId, (current) => {
      let next = current;
      for (const band of proposal.slice(0, free)) {
        const added = addBand(next, band);
        if (!added) break;
        next = added.proQ;
        made.push(added.id);
      }
      return next;
    });
    selectBands(effectId, made);
    stopMatch();
  };
  const button = "rounded-md border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] hover:bg-black/50 disabled:opacity-40";
  return (
    <div className="absolute inset-x-6 bottom-6 z-20 flex items-center gap-4 rounded-xl border border-[var(--eq-panel-edge)] bg-[var(--eq-panel)]/95 px-4 py-2.5 text-[11px] text-[var(--eq-text)] shadow-xl" data-testid="pro-q-match">
      <PiWaveform className="size-5 shrink-0 text-[var(--eq-curve)]" />
      {match.step === "analyze" ? (
        <>
          <div className="flex-1">
            <div className="font-semibold">EQ Match: listening{playing ? "" : " (play the song)"}</div>
            <div className="text-[var(--eq-label)]">
              Input {seconds(data.input.frames)} · Reference {seconds(data.reference.frames)}
              {ready ? " · the white line is the difference" : ` · ${ENOUGH} s of each to match`}
            </div>
          </div>
          <button type="button" className={button} disabled={!ready} onClick={() => useEqUi.setState({ match: { ...match, step: "match" } })}>
            Match &gt;
          </button>
        </>
      ) : (
        <>
          <button type="button" className={button} onClick={() => useEqUi.setState({ match: { ...match, step: "analyze" } })}>
            &lt; Analyze
          </button>
          <label className="flex flex-1 items-center gap-3">
            <span className="text-[var(--eq-label)]">Bands</span>
            <input
              type="range"
              aria-label="Bands to match with"
              min={1}
              max={Math.max(1, Math.min(12, free))}
              value={Math.min(match.count, Math.max(1, free))}
              onChange={(e) => useEqUi.setState({ match: { ...match, count: Number(e.target.value) } })}
              className="flex-1 accent-[var(--eq-curve)]"
            />
            <span className="w-5 text-right font-semibold text-[var(--eq-curve)] tabular-nums">{Math.min(match.count, free)}</span>
          </label>
          <button type="button" className={button} disabled={!proposal.length || free === 0} onClick={finish}>
            Finish
          </button>
        </>
      )}
      <button type="button" aria-label="Close EQ Match" className="text-[var(--eq-label)] hover:text-[var(--eq-text)]" onClick={stopMatch}>
        <PiX className="size-3.5" />
      </button>
    </div>
  );
}
