/**
 * Simulations (V8): looks whose frame follows from the one before (a feedback trail, a 3D world whose
 * angles and orbits are integrated). Their state at frame `f` of a clip is a step applied `f + 1` times
 * from nothing, at the sequence's frame step, never by the wall clock, so a frame is the same whether it's
 * reached by playing, scrubbing or exporting.
 *
 * Two kinds: an effect whose GLSL reads its own output a frame ago (`EffectShader.simulation`: its state
 * is a texture, kept and replayed by the compositor), and a 3D scene (`EffectShader.scene`), whose state
 * is numbers stepped here, in TypeScript, the same in the tab and in the export's plan (`steppedState`).
 */
import { type SignalReader, currentSignalReader } from "./audio-signals.ts";
import { sourceTime, timelineTime } from "./timeline.ts";
import type { Clip } from "./types.ts";

/** Frames between the checkpoints a seek replays from. */
export const CHECKPOINT_EVERY = 30;

/** Which frame of its clip source time `time` is (its first is 0), at `fps`. */
export function simulationFrame(clip: Clip, time: number, fps: number): number {
  return Math.max(0, Math.round((timelineTime(clip, time) - clip.start) * fps));
}

/** The source time of frame `frame` of a clip, at `fps`. */
export function frameSourceTime(clip: Clip, frame: number, fps: number): number {
  return sourceTime(clip, clip.start + frame / fps);
}

/** A 64-bit hash of a text (cyrb53, twice), in hex. */
export function textHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

const clipHashes = new WeakMap<Clip, string>();
const readerHashes = new WeakMap<SignalReader, string>();
const storeIds = new WeakMap<object, number>();
let nextStoreId = 1;

/**
 * What a reader's sound depends on: which analyses it has, and where the clips that sound are (moving
 * the song changes what every simulation heard).
 */
function hearingHash(reader: SignalReader): string {
  // A sound heard live is its session's, whatever the document holds (it never plays media of its own).
  if (reader.live !== undefined) return `live:${reader.live}`;
  let hash = readerHashes.get(reader);
  if (hash === undefined) {
    let store = storeIds.get(reader.store);
    if (store === undefined) storeIds.set(reader.store, (store = nextStoreId++));
    const doc = reader.document;
    const timing = (doc.sequences ?? []).map((s) => s.clips).concat([doc.clips]);
    const sounding = timing.map((clips) =>
      clips.filter((c) => c.assetId).map((c) => [c.id, c.assetId, c.trackId, c.start, c.in, c.out, c.speed ?? 1, !!c.reversed]),
    );
    hash = `${store}:${textHash(JSON.stringify([sounding, doc.tracks.map((t) => [t.id, !!t.muted]), doc.signals ?? null, doc.tempo ?? null]))}`;
    readerHashes.set(reader, hash);
  }
  return hash;
}

/**
 * What a clip's simulations were made from: the clip itself (its effects, timing, everything), the
 * frame rate and the sound it hears. A change makes their kept states stale. Heard live (Now Playing),
 * only the clip's id counts: time only goes forward there, nothing's replayed, and a setting changed
 * mid-song (the frame, the feedback) carries on from the picture as it was, as vaudio's does, rather than
 * wiping its trails.
 */
export function simulationVersion(clip: Clip, fps: number): string {
  const live = currentSignalReader();
  if (live?.live !== undefined) return `${clip.id}:${fps}:${hearingHash(live)}`;
  let hash = clipHashes.get(clip);
  if (hash === undefined) clipHashes.set(clip, (hash = textHash(JSON.stringify(clip))));
  const reader = currentSignalReader();
  return `${hash}:${fps}:${reader ? hearingHash(reader) : "-"}`;
}

/** A run of numeric states, stepped in order and checkpointed (see `steppedState`). */
interface Run<S> {
  version: string;
  frame: number;
  state: S;
  checkpoints: Map<number, S>;
}

const runs = new WeakMap<object, Map<string, Run<unknown>>>();
/** Most checkpoints a run keeps (beyond that, the farthest from where it's being read go). */
const MAX_CHECKPOINTS = 2000;

/**
 * A state at frame `frame` (0 is the first), stepped from `init()` by `step(state, k)` for every frame
 * `k` from 0 to `frame`, in order: kept per `owner` (a clip) and `key` (its effect) while `version` stays,
 * so playing forward steps once a frame and a seek starts from the nearest checkpoint before it. `step`
 * changes the state it's given; `clone` copies one (for checkpoints). The state returned is the run's
 * own, changed by the next call: read what's needed from it at once.
 */
export function steppedState<S>(
  owner: object,
  key: string,
  version: string,
  frame: number,
  init: () => S,
  step: (state: S, frame: number) => void,
  clone: (state: S) => S,
): S {
  let byKey = runs.get(owner);
  if (!byKey) runs.set(owner, (byKey = new Map()));
  let run = byKey.get(key) as Run<S> | undefined;
  if (!run || run.version !== version) {
    run = { version, frame: -1, state: init(), checkpoints: new Map() };
    byKey.set(key, run as Run<unknown>);
  }
  frame = Math.max(0, Math.floor(frame));
  if (run.frame === frame) return run.state;
  if (run.frame > frame) {
    // Back to the nearest checkpoint at or before the frame, or the start.
    let best = -1;
    for (const k of run.checkpoints.keys()) if (k <= frame && k > best) best = k;
    run.state = best >= 0 ? clone(run.checkpoints.get(best)!) : init();
    run.frame = best;
  }
  for (let k = run.frame + 1; k <= frame; k++) {
    step(run.state, k);
    if (k > 0 && k % CHECKPOINT_EVERY === 0 && !run.checkpoints.has(k)) {
      run.checkpoints.set(k, clone(run.state));
      if (run.checkpoints.size > MAX_CHECKPOINTS) {
        let far = -1;
        for (const c of run.checkpoints.keys()) if (far < 0 || Math.abs(c - frame) > Math.abs(far - frame)) far = c;
        run.checkpoints.delete(far);
      }
    }
  }
  run.frame = frame;
  return run.state;
}
