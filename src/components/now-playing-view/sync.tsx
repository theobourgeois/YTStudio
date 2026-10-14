import { type RefObject, useEffect, useImperativeHandle, useState } from "react";
import { useNowPlaying } from "@/stores/now-playing";
import type { LiveSource } from "./live-source";

/** Taps measured to find the headphones' delay (the first two only find the beat). */
const TAPS = 8;
const WARM_UP = 2;
/** The most a delay can be (ms): longer is a tap off the beat, not headphones. */
const MOST_DELAY = 400;

/** What the visualizer's keys do while tapping along: Space taps, Escape stops. */
export interface Tapper {
  tap(): void;
  cancel(): void;
}

/**
 * Tapping along to find how late the ears hear the sound (Bluetooth headphones play it ~150-250 ms after the
 * computer sends it): each tap is matched to its nearest beat, the delay is the taps' median, kept in Settings
 * (`useNowPlaying.offset`). A tap a little early is fine: a picture slightly ahead is hard to see; behind isn't.
 */
export function TapSync({ source, tapper, onDone }: { source: LiveSource; tapper: RefObject<Tapper | null>; onDone: () => void }) {
  const [delays, setDelays] = useState<number[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);

  const tap = () => {
    if (result !== null) return;
    const delay = source.tap(performance.now());
    if (delay === null) {
      setProblem("There's no steady beat to tap along to yet.");
      return;
    }
    setProblem(null);
    const next = [...delays, delay];
    setDelays(next);
    if (next.length < TAPS) return;
    const kept = next.slice(WARM_UP).sort((a, b) => a - b);
    const ms = Math.round(Math.min(MOST_DELAY, Math.max(0, kept[Math.floor(kept.length / 2)] * 1000)));
    useNowPlaying.getState().setOffset(ms);
    setResult(ms);
  };
  useImperativeHandle(tapper, () => ({ tap, cancel: onDone }));

  useEffect(() => {
    if (result === null) return;
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [result, onDone]);

  return (
    <div className="absolute inset-0 grid place-items-center bg-black/30" onPointerDown={tap}>
      <div data-tap-sync className="flex w-[min(90vw,380px)] flex-col items-center gap-3 rounded-xl bg-black/75 px-7 py-6 text-center ring-1 ring-white/10 backdrop-blur-md">
        {result === null ? (
          <>
            <p className="text-sm font-medium">Tap Space on the beat</p>
            <p className="text-xs leading-relaxed text-white/65">Along with the kick, as you hear it, {TAPS} times. It finds how late your headphones play.</p>
            <div className="flex gap-1.5 py-1">
              {Array.from({ length: TAPS }, (_, i) => (
                <span key={i} className={i < delays.length ? "size-2.5 rounded-full bg-white" : "size-2.5 rounded-full bg-white/20"} />
              ))}
            </div>
            {problem && <p className="text-xs text-amber-300">{problem}</p>}
            <p className="text-[11px] text-white/45">Esc to stop</p>
          </>
        ) : (
          <p className="text-sm leading-relaxed">
            {result < 20 ? "You hear it as the computer plays it: nothing to wait for." : `Your sound plays ${result} ms late: the pictures now wait for it.`}
          </p>
        )}
      </div>
    </div>
  );
}

/** How late the picture is, and what makes it so (L). */
export function LatencyReadout({ source }: { source: LiveSource }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  const l = source.latency;
  const live = useNowPlaying.getState().live?.signals;
  const ms = (s: number) => `${Math.round(s * 1000)}`;
  return (
    <div data-latency className="pointer-events-none absolute top-20 right-6 rounded-md bg-black/70 px-3 py-2 font-mono text-[11px] leading-5 text-white/85 ring-1 ring-white/10">
      <div>
        picture {ms(l.total + l.ears)} ms after the sound is sent · ears {ms(l.ears)} ms
      </div>
      <div className="text-white/55">
        analysis {ms(l.analysis)} · chunks {ms(l.chunks / 2)} · drawing {ms(l.drawing)} · capture ~{ms(l.capture)}
      </div>
      <div>{l.wait > 0 ? `waits ${ms(l.wait)} ms for the ears` : `beat shown ${ms(l.lead)} ms early`}</div>
      <div className="text-white/55">
        {live?.bpm ? `${live.bpm.toFixed(1)} BPM` : "no beat yet"}
        {live?.expectingKicks ? " · kicks expected on the beat" : ""}
      </div>
    </div>
  );
}
