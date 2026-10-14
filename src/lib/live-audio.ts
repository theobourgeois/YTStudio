/**
 * Listening to what the computer plays (Now Playing's visualizer, docs/now-playing.md): its sound is captured as a
 * screen share's audio and measured as it arrives (`LiveSignals`); nothing is played back or kept. The desktop app
 * grants the system's sound, with its own page as the picture, so it's never asked to record the screen
 * (electron/main.ts). In a browser, the share picker asks: share a screen with its sound, or Spotify's web player's
 * tab. A made-up player (the tests) has no sound to share: a made-up song is measured instead (`demoSong`).
 */
import { demoSong } from "@shared/signals/demo-sound";
import { createId } from "@shared/ids";
import { LiveSignals } from "@shared/signals/live";
import { isDesktop } from "@/lib/desktop";

export interface LiveAudio {
  /** What's been heard this session (`restart` starts another: its time starts at 0 again). */
  readonly signals: LiveSignals;
  /** The session's id: the same sound throughout (`SignalReader.live`). */
  readonly session: string;
  /** The computer's sound, or a made-up song. */
  readonly source: "system" | "demo";
  /** Keep listening, measuring from nothing (long sessions grow: about 50 kB a second). */
  restart(): void;
  stop(): void;
}

/** What's heard goes to the session of the moment. */
class Listening implements LiveAudio {
  signals = new LiveSignals(SAMPLE_RATE);
  session = createId("live");
  constructor(
    readonly source: "system" | "demo",
    readonly stop: () => void,
  ) {}
  restart() {
    this.signals = new LiveSignals(SAMPLE_RATE);
    this.session = createId("live");
  }
}

const SAMPLE_RATE = 48_000;
/** Frames each message from the audio thread carries: one render quantum (under 3 ms), so nothing waits for more. */
const CHUNK = 128;
/** Seconds of sound each message carries. */
export const CHUNK_SECONDS = CHUNK / SAMPLE_RATE;

/** Copies what it hears to the page, stereo interleaved, a chunk at a time (an audio worklet, loaded from a blob). */
const TAP = `
class LiveTap extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(${CHUNK * 2}); this.length = 0; }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const l = input[0];
      const r = input[1] || input[0];
      for (let i = 0; i < l.length; i++) {
        this.buffer[this.length++] = l[i];
        this.buffer[this.length++] = r[i];
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(${CHUNK * 2});
          this.length = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("live-tap", LiveTap);
`;

/**
 * A sound file the made-up player plays instead of the made-up song (a URL, in localStorage): scripts trying looks
 * on real music (`scripts/now-playing-sheet.ts`).
 */
export const DEMO_FILE_KEY = "editor-now-playing-demo";

/** Listen to the computer's sound (asking, the first time), or to a made-up song. `onEnded`: sharing stopped. */
export async function startListening(demo: boolean, onEnded: () => void): Promise<LiveAudio> {
  return demo ? demoListening(await demoFile()) : systemListening(onEnded);
}

/** The demo file's sound, stereo interleaved at our rate (null: none, or it couldn't be read). */
async function demoFile(): Promise<Float32Array | null> {
  const url = localStorage.getItem(DEMO_FILE_KEY);
  if (!url) return null;
  try {
    const decoded = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(await (await fetch(url)).arrayBuffer());
    const left = decoded.getChannelData(0);
    const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;
    const out = new Float32Array(left.length * 2);
    for (let i = 0; i < left.length; i++) {
      out[i * 2] = left[i];
      out[i * 2 + 1] = right[i];
    }
    return out;
  } catch {
    return null;
  }
}

async function systemListening(onEnded: () => void): Promise<LiveAudio> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("This browser can't share the computer's sound.");
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // Chrome's picker: offer the system's sound, and this tab too (Spotify's web player can be a tab).
    systemAudio: "include",
    selfBrowserSurface: isDesktop ? "include" : "exclude",
  } as DisplayMediaStreamOptions);
  // Only the sound is wanted.
  for (const track of stream.getVideoTracks()) track.stop();
  const [track] = stream.getAudioTracks();
  if (!track) {
    throw new Error(isDesktop ? "The computer's sound couldn't be captured." : "No sound was shared: share a screen or tab with its audio.");
  }
  const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const tap = new AudioWorkletNode(context, "live-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: "explicit" });
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => listening.signals.push(e.data);
  // The tap only runs while something pulls it: into silence, so nothing is heard twice.
  const silence = context.createGain();
  silence.gain.value = 0;
  source.connect(tap).connect(silence).connect(context.destination);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    track.onended = null;
    track.stop();
    tap.port.onmessage = null;
    void context.close();
  };
  track.onended = () => {
    stop();
    onEnded();
  };
  const listening = new Listening("system", stop);
  return listening;
}

/** A made-up song (or the demo file, round and round), measured as if heard (never played). */
function demoListening(file: Float32Array | null): LiveAudio {
  let at = 0;
  const song = file
    ? {
        next(frames: number) {
          const out = new Float32Array(frames * 2);
          for (let k = 0; k < out.length; k++, at = (at + 1) % file.length) out[k] = file[at];
          return out;
        },
      }
    : demoSong(SAMPLE_RATE);
  const started = performance.now();
  let made = 0;
  const timer = setInterval(() => {
    const due = Math.floor(((performance.now() - started) / 1000) * SAMPLE_RATE);
    // Never more than a second at once (a tab that slept doesn't measure the gap all at once).
    const frames = Math.min(due - made, SAMPLE_RATE);
    if (frames <= 0) return;
    made = due;
    listening.signals.push(song.next(frames));
  }, 15);
  const listening = new Listening("demo", () => clearInterval(timer));
  return listening;
}
