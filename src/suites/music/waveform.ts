/** A sample's waveform as the Channel Settings window draws it: the file's own samples, after the channel's precomputed effects. */
import type { Precomputed } from "@shared/music/types";

export interface WaveformColumns {
  /** The lowest and highest sample in each column of the picture, -1..1. */
  min: Float32Array;
  max: Float32Array;
}

/**
 * The waveform of `samples` (one channel, -1..1) drawn `columns` wide, after `precomputed`: what the
 * engine does to the sample (`engine/src/Song.cpp`, in the same order: trim, reverse, normalise,
 * fade), done here to what's drawn.
 */
export function waveformColumns(samples: Float32Array, precomputed: Precomputed, columns: number): WaveformColumns {
  const total = samples.length;
  const width = Math.max(0, Math.floor(columns));
  const min = new Float32Array(width);
  const max = new Float32Array(width);
  if (!total || !width) return { min, max };

  const first = Math.min(total - 1, Math.floor(precomputed.start * total));
  const kept = Math.max(1, Math.min(total - first, Math.ceil(precomputed.length * (total - first))));
  let gain = 1;
  if (precomputed.normalize) {
    let peak = 0;
    for (let i = first; i < first + kept; i++) peak = Math.max(peak, Math.abs(samples[i]));
    if (peak > 0) gain = 1 / peak;
  }
  const fadeIn = Math.min(kept, Math.floor(precomputed.fadeIn * kept));
  const fadeOut = Math.min(kept, Math.floor(precomputed.fadeOut * kept));

  for (let column = 0; column < width; column++) {
    const from = Math.floor((column * kept) / width);
    const to = Math.max(from + 1, Math.floor(((column + 1) * kept) / width));
    let low = Infinity;
    let high = -Infinity;
    for (let i = from; i < to && i < kept; i++) {
      // `i` counts along the prepared sample; reversed, it reads the kept part backwards.
      const value =
        samples[first + (precomputed.reverse ? kept - 1 - i : i)] * gain * (i < fadeIn ? i / fadeIn : 1) * (i >= kept - fadeOut ? (kept - i) / fadeOut : 1);
      if (value < low) low = value;
      if (value > high) high = value;
    }
    min[column] = low === Infinity ? 0 : low;
    max[column] = high === -Infinity ? 0 : high;
  }
  return { min, max };
}

/** Each file's samples (its channels mixed to one), decoded once: media files never change. */
const decoded = new Map<string, Promise<Float32Array>>();

/** Decode an audio file in the browser, for drawing. */
export function loadSamples(url: string): Promise<Float32Array> {
  let samples = decoded.get(url);
  if (!samples) {
    samples = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("The sample couldn't be read.");
      // A context that's never played: it only decodes.
      const audio = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(await response.arrayBuffer());
      const mixed = new Float32Array(audio.length);
      for (let channel = 0; channel < audio.numberOfChannels; channel++) {
        const data = audio.getChannelData(channel);
        for (let i = 0; i < data.length; i++) mixed[i] += data[i] / audio.numberOfChannels;
      }
      return mixed;
    })();
    samples.catch(() => decoded.delete(url));
    decoded.set(url, samples);
  }
  return samples;
}
