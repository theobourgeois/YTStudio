import { useEffect, useState } from "react";
import { SONG_CHARACTERS, type Section } from "@shared/signals/mood";
import { cn } from "cn";
import { useNowPlaying } from "@/stores/now-playing";

const SECTIONS: Record<Section, string> = { intro: "the start", steady: "going along", build: "a build-up", drop: "the drop", breakdown: "a breakdown" };

/** An arrow for a band's presence: rising, falling or level. */
const arrow = (v: number) => (v >= 0.25 ? "↑" : v <= -0.25 ? "↓" : "·");

/**
 * What the visualizer hears (I): the song's character and how sure it is, the intensity, where the song is and what
 * it's done lately, each band rising or falling, and the measurements under them (`LiveMood`). For checking its
 * reading against one's ears (step 2 of the plan).
 */
export function MoodReadout({ now, choices }: { now: () => number; choices: () => readonly { time: number; why: string }[] }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  const live = useNowPlaying.getState().live?.signals;
  if (!live) return null;
  const m = live.mood;
  const t = now();
  const ago = (time: number) => `${Math.max(0, Math.round(t - time))} s ago`;
  return (
    <div data-mood className="pointer-events-none absolute top-24 left-6 w-80 rounded-md bg-black/70 px-3 py-2.5 text-[12px] leading-5 text-white/85 ring-1 ring-white/10">
      <div className="flex items-baseline justify-between">
        <span className="text-base font-semibold">{m.character ?? "listening…"}</span>
        <span className="text-white/55">sure {Math.round(m.sure * 100)}%</span>
      </div>
      <div className="mb-1.5 flex gap-2 font-mono text-[10px] text-white/55">
        {SONG_CHARACTERS.map((c) => (
          <span key={c} className={cn(c === m.character && "text-white")}>
            {c} {m.scores[c].toFixed(2)}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-16 text-white/60">intensity</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
          <span className="block h-full rounded-full bg-white" style={{ width: `${m.intensity * 100}%` }} />
        </span>
        <span className="w-9 text-right font-mono">{m.intensity.toFixed(2)}</span>
      </div>
      <div>
        <span className="text-white/60">in</span> {SECTIONS[m.section]} <span className="text-white/45">for {Math.max(0, Math.round(t - m.sectionSince))} s</span>
      </div>
      <div className="text-white/70">
        {m.events.length ? m.events.slice(-3).map((e) => `${e.kind} ${ago(e.time)}`).join(" · ") : "no build-ups, drops or breakdowns yet"}
      </div>
      <div className="font-mono text-[11px]">
        low {arrow(m.presence.low)} · mid {arrow(m.presence.mid)} · high {arrow(m.presence.high)}
      </div>
      {choices().length > 0 && (
        <div className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] leading-4 text-white/75">
          {choices()
            .slice(-3)
            .map((c) => (
              <div key={c.time}>
                <span className="text-white/45">{ago(c.time)}:</span> {c.why}
              </div>
            ))}
        </div>
      )}
      <div className="font-mono text-[10px] text-white/50">
        {m.heard.loudness.toFixed(1)} dB · {m.heard.hits.toFixed(1)} hits/s · {m.heard.kicks.toFixed(1)} kicks/s · sub {m.heard.sub.toFixed(2)} · {m.heard.brightness} Hz
        {live.bpm ? ` · ${live.bpm.toFixed(1)} BPM` : ""}
      </div>
    </div>
  );
}
