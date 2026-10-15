/**
 * Hearing the vibe while the visualizer listens (`shared/signals/vibe.ts`, docs/now-playing.md): every few seconds
 * the newest ten seconds of the sound go to a worker (`vibe-worker.ts`: CLAP, on the CPU), and what it hears goes
 * into the mood (`LiveSignals.hearVibe`), whose song's kind it mostly says. One reading at a time: a slow computer
 * hears less often. With the tests' stand-in (no model), the vibe is made up from the mood instead.
 */
import { CLAP_RATE, CLAP_SAMPLES } from "@shared/signals/clap";
import type { LiveSignals } from "@shared/signals/live";
import type { Vibe } from "@shared/signals/vibe";
import { log } from "@/lib/log";
import type { VibeAnswer, VibeRequest } from "./vibe-worker";

const logger = log("now-playing");

/** How often it hears (ms). */
const EVERY_MS = 5000;
/** Seconds of sound before the first reading (less than ten is repeated to fill them, as CLAP does). */
const FIRST_AFTER = 4;
/** Readings that failed in a row before it stops trying. */
const MOST_FAILURES = 3;
const MODEL_URL = "/api/now-playing/vibe/file";

/** The tests' stand-in's vibe: the mood's intensity as the energy, a made-up genre. */
const standInVibe = (signals: LiveSignals): Vibe => {
  const energy = Math.round((signals.mood.intensity * 2 - 1) * 100) / 100;
  return { axes: { energy, mood: 0, force: energy / 2, pace: 0, space: 0, dance: 0.3 }, genres: [{ name: "stand-in", likeness: 1 }] };
};

export class VibeHearing {
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private waiting = false;
  private failures = 0;
  private asked = 0;
  private heard = 0;

  constructor(
    /** The session's signals of the moment (a new session is new signals). */
    private readonly signals: () => LiveSignals | null,
    private readonly standIn: boolean,
  ) {}

  start(): void {
    this.timer ??= setInterval(() => this.hear(), EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private hear(): void {
    const signals = this.signals();
    if (!signals || this.waiting) return;
    if (this.standIn) return signals.hearVibe(standInVibe(signals), signals.seconds);
    const sound = new Float32Array(CLAP_SAMPLES);
    const end = signals.lastSound(sound);
    if (end < FIRST_AFTER) return;
    // Less than ten seconds heard: what there is (CLAP repeats it).
    const have = Math.min(CLAP_SAMPLES, Math.floor(end * CLAP_RATE));
    const heard = have < CLAP_SAMPLES ? sound.slice(CLAP_SAMPLES - have) : sound;
    this.worker ??= new Worker(new URL("./vibe-worker.ts", import.meta.url), { type: "module" });
    const id = ++this.asked;
    this.waiting = true;
    // (Its answer's for the signals it was asked of: a new session's are another's.)
    this.worker.onmessage = ({ data }: MessageEvent<VibeAnswer>) => data.id === id && this.answered(data, signals, end);
    this.worker.postMessage({ id, sound: heard, url: MODEL_URL } satisfies VibeRequest, [heard.buffer]);
  }

  private answered(answer: VibeAnswer, signals: LiveSignals, end: number): void {
    this.waiting = false;
    if ("error" in answer) {
      this.failures++;
      logger.warn(`couldn't hear the vibe: ${answer.error}`);
      if (this.failures >= MOST_FAILURES) {
        logger.warn("the vibe's not heard any more (it kept failing)");
        this.stop();
      }
      return;
    }
    this.failures = 0;
    if (this.signals() !== signals) return;
    signals.hearVibe(answer.vibe, end);
    const said = `${answer.vibe.genres.map((g) => g.name).join(", ")}; energy ${answer.vibe.axes.energy}, force ${answer.vibe.axes.force}`;
    if (this.heard++ === 0) logger.info(`hearing the vibe (${answer.ms} ms a reading): ${said}`);
    else logger.debug(`vibe: ${said}`);
  }
}
