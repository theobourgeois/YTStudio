/** The Browser's waveforms (a file's, or an online clip's): its loudest points in a few hundred columns, decoded in the tab and kept small. */
import { sampleUrl } from "./online";
import { METER_COLOUR_STOPS } from "../mixer/meter";

export const PEAK_COLUMNS = 400;
/** Bigger files aren't decoded for a picture (a whole song would take a lot of memory to): they play without one. */
const MAX_BYTES = 60 * 1024 * 1024;
/** Waveforms kept, the least recently drawn going first. */
const KEPT = 200;

export interface Peaks {
  /** The lowest and highest sample in each column, -1..1, its channels mixed. */
  min: Float32Array;
  max: Float32Array;
  /** Seconds. */
  duration: number;
}

const cache = new Map<string, Promise<Peaks>>();

/** A sample's peaks: a file's path, or an online clip's URL (downloaded first, if it isn't yet). */
export function loadPeaks(path: string): Promise<Peaks> {
  const known = cache.get(path);
  if (known) {
    // Most recently used: to the end.
    cache.delete(path);
    cache.set(path, known);
    return known;
  }
  const peaks = (async () => {
    const response = await fetch(sampleUrl(path));
    if (!response.ok) throw new Error("The file couldn't be read.");
    if (Number(response.headers.get("Content-Length")) > MAX_BYTES) {
      void response.body?.cancel();
      throw new Error("Too long to draw.");
    }
    // A context that's never played: it only decodes.
    const audio = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(await response.arrayBuffer());
    return columns(
      Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c)),
      audio.duration,
    );
  })();
  peaks.catch(() => cache.delete(path));
  cache.set(path, peaks);
  while (cache.size > KEPT) cache.delete(cache.keys().next().value!);
  return peaks;
}

/** The peaks of some channels' samples, `PEAK_COLUMNS` wide. */
export function columns(channels: Float32Array[], duration: number, count = PEAK_COLUMNS): Peaks {
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  const length = channels[0]?.length ?? 0;
  for (let column = 0; column < count && length; column++) {
    const from = Math.floor((column * length) / count);
    const to = Math.max(from + 1, Math.floor(((column + 1) * length) / count));
    let low = Infinity;
    let high = -Infinity;
    for (let i = from; i < to && i < length; i++) {
      let value = 0;
      for (const data of channels) value += data[i];
      value /= channels.length;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    min[column] = low === Infinity ? 0 : low;
    max[column] = high === -Infinity ? 0 : high;
  }
  return { min, max, duration };
}

/**
 * The waveform's colours, the mixer meters' (green, amber, red at 0 dB) by how far from the middle a point
 * is: as SVG gradient stops down a picture `height` tall whose ±1 is `scale` from its middle. Each is an
 * offset (0..1, top to bottom) and a theme variable.
 */
export function waveformStops(height: number, scale: number): { offset: number; colour: string }[] {
  const at = (amplitude: number, side: 1 | -1) => Math.max(0, Math.min(1, (height / 2 - side * amplitude * scale) / height));
  const colour = (name: string) => `var(--meter-${name})`;
  const half = [{ amplitude: 0, colour: colour("low") }, ...METER_COLOUR_STOPS.map((s) => ({ amplitude: s.level, colour: colour(s.colour) }))];
  // The top half from its peak down to the middle, then the bottom half from the middle down to its trough.
  return [...[...half].reverse().map((s) => ({ offset: at(s.amplitude, 1), colour: s.colour })), ...half.map((s) => ({ offset: at(s.amplitude, -1), colour: s.colour }))];
}
