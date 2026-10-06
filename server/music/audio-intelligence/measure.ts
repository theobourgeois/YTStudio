/** Full-resolution local measurements. No listening observations or inferred mix advice. */
import { createEvidence, refOf } from "../../../shared/music/audio-intelligence/evidence.ts";
import { passageFrames, useError } from "../../../shared/music/audio-intelligence/artifact.ts";
import type { AudioArtifact, Measurement } from "../../../shared/music/audio-intelligence/types.ts";
import type { WavData } from "../wav.ts";
import { setImmediate } from "node:timers/promises";
import { LOUDNESS_METHOD, TRUE_PEAK_METHOD, loudnessSummary } from "../../../shared/music/audio-intelligence/loudness.ts";
import { BANDS, CHANGE_METHOD, SPECTRUM_METHOD, describeTone, listen } from "../../../shared/music/audio-intelligence/spectrum.ts";

export async function measureAudio(artifact: AudioArtifact, audio: WavData, signal?: AbortSignal) {
  const denied = useError(artifact, "localAnalysis");
  if (denied) throw new Error(denied);
  const { sampleRate, channels } = audio;
  const frames = channels[0]?.length ?? 0;
  if (sampleRate !== artifact.format.sampleRate || channels.length !== artifact.format.channels || frames !== artifact.format.frames || channels.some(c => c.length !== frames)) throw new Error("Audio format does not match its artifact.");
  const range = passageFrames(artifact) ?? { first: 0, end: frames };
  const count = range.end - range.first;
  const span = { artifactId: artifact.id, startSeconds: range.first / sampleRate, endSeconds: range.end / sampleRate };
  const measurements: Measurement[] = [];
  const add = (name: string, value: number | null, unit: string, channel: string, method: string, note?: string) => measurements.push({ id: `m${measurements.length}`, name, value, unit, channel, span, method: { name: method, version: "1" }, ...((note || value === null) ? { note: note ?? "Undefined for silent or zero-energy signals." } : {}) });
  const db = (value: number) => value > 0 ? 20 * Math.log10(value) : null;
  let cross = 0, left2 = 0, right2 = 0, mid2 = 0, side2 = 0;
  for (let ch = 0; ch < channels.length; ch++) {
    const samples = channels[ch];
    let peak = 0, sum2 = 0, dc = 0, over = 0, first = -1, last = -1, low = 0, low2 = 0, high2 = 0;
    const alpha = 1 - Math.exp(-2 * Math.PI * 200 / sampleRate);
    const windows: number[] = [];
    const window = Math.max(1, Math.round(sampleRate * 0.05));
    let w2 = 0, wn = 0;
    for (let i = 0; i < range.end; i++) {
      if (i % 65536 === 0) { signal?.throwIfAborted(); await setImmediate(); }
      const x = samples[i];
      if (!Number.isFinite(x)) throw new Error("Audio contains non-finite samples.");
      low += alpha * (x - low);
      if (i < range.first) continue;
      peak = Math.max(peak, Math.abs(x)); sum2 += x*x; dc += x;
      low2 += low*low; high2 += (x-low)*(x-low);
      if (Math.abs(x) >= 1) over++;
      if (Math.abs(x) > 0.001) { if (first < 0) first = i; last = i; }
      w2 += x*x; wn++;
      if (wn === window || i === range.end - 1) { windows.push(Math.sqrt(w2/wn)); w2 = 0; wn = 0; }
      if (ch === 0 && channels.length === 2) {
        const y = channels[1][i]; cross += x*y; left2 += x*x; right2 += y*y;
        mid2 += ((x+y)/2)**2; side2 += ((x-y)/2)**2;
      }
    }
    const channel = channels.length === 1 ? "mono" : ch === 0 ? "left" : ch === 1 ? "right" : `channel${ch+1}`;
    const rms = Math.sqrt(sum2/count);
    add("peakDbfs", db(peak), "dBFS", channel, "sample-peak", peak === 0 ? "Silence has no finite dB value." : undefined);
    add("rmsDbfs", db(rms), "dBFS", channel, "unweighted-rms");
    add("crestDb", rms > 0 ? 20*Math.log10(peak/rms) : null, "dB", channel, "sample-peak-to-rms");
    add("dcOffset", dc/count, "amplitude", channel, "sample-mean");
    add("fullScaleSampleFraction", over/count, "fraction", channel, "absolute-sample-at-least-one", "Full-scale samples are not proof of audible clipping.");
    windows.sort((a,b) => a-b);
    const quiet = windows[Math.floor((windows.length-1)*0.1)], loud = windows[Math.floor((windows.length-1)*0.9)];
    add("rmsWindowSpreadDb", quiet > 0 && loud > 0 ? 20*Math.log10(loud/quiet) : null, "dB", channel, "50ms-rms-p90-minus-p10", "Unweighted window spread; not standardized loudness range.");
    add("lowBandRmsDbfs", db(Math.sqrt(low2/count)), "dBFS", channel, "200Hz-one-pole-lowpass-rms", "Broad overlapping filter energy estimate, not a spectral balance judgement.");
    add("highBandRmsDbfs", db(Math.sqrt(high2/count)), "dBFS", channel, "200Hz-one-pole-complement-rms");
    add("firstActivitySeconds", first < 0 ? null : (first-range.first)/sampleRate, "seconds", channel, "absolute-sample-above-minus60dBFS", "Relative to the inspected passage, not a beat/phrase detector.");
    add("lastActivitySeconds", last < 0 ? null : (last-range.first)/sampleRate, "seconds", channel, "absolute-sample-above-minus60dBFS");
  }
  // Loudness as streaming services measure it, the balance by band, and when loudness or tone moves.
  signal?.throwIfAborted(); await setImmediate();
  const body = channels.map(c => c.subarray(range.first, range.end)), at = range.first / sampleRate;
  const timed = (name: string, value: number | null, unit: string, from: number, to: number, method: { name: string; version: string }, note?: string) => measurements.push({ id: `m${measurements.length}`, name, value, unit, channel: "all",
    span: { artifactId: artifact.id, startSeconds: Math.max(span.startSeconds, at + from), endSeconds: Math.min(span.endSeconds, at + to) }, method: { ...method }, ...((note || value === null) ? { note: note ?? "Undefined for silent or zero-energy signals." } : {}) });
  if (count >= sampleRate * 0.4) {
    const loud = loudnessSummary(body, sampleRate);
    const whole = (name: string, value: number | null, unit: string, method: { name: string; version: string }, note?: string) => timed(name, value, unit, 0, count / sampleRate, method, note);
    whole("integratedLufs", loud.integratedLufs, "LUFS", LOUDNESS_METHOD, "ITU-R BS.1770-4: K-weighted, gated at -70 LUFS and 10 LU under the mean.");
    whole("loudnessRangeLu", loud.loudnessRangeLu, "LU", LOUDNESS_METHOD, "EBU Tech 3342 (short-term loudness, P95 − P10, gated). Needs at least a few seconds.");
    whole("truePeakDbtp", loud.truePeakDbtp, "dBTP", TRUE_PEAK_METHOD, "4x oversampled with a 12-tap-a-phase windowed sinc; within a few tenths of a dB of BS.1770 Annex 2.");
    whole("maxMomentaryLufs", loud.maxMomentaryLufs, "LUFS", LOUDNESS_METHOD);
    whole("maxShortTermLufs", loud.maxShortTermLufs, "LUFS", LOUDNESS_METHOD);
    loud.shortTerm.times.forEach((t, i) => { if (Number.isFinite(loud.shortTerm.lufs[i])) timed("shortTermLufs", loud.shortTerm.lufs[i], "LUFS", t - 1.5, t + 1.5, LOUDNESS_METHOD); });
    signal?.throwIfAborted(); await setImmediate();
    const heard = listen(body, sampleRate);
    for (const b of heard.balance) if (Number.isFinite(b.relativeToPinkDb)) whole(`bandBalanceDb.${b.band}`, b.relativeToPinkDb, "dB", SPECTRUM_METHOD,
      `${BANDS.find(x => x.id === b.band)!.label}: its share of the energy against pink noise's (equal energy per octave). + is more than pink noise has there; a reference, not a target.`);
    for (const c of heard.changes) timed(c.kind === "loudness" ? "loudnessChangeDb" : "toneChangeDb", c.deltaDb, "dB", c.at - 0.25, c.at + 0.25, CHANGE_METHOD,
      c.kind === "loudness" ? `Loudness ${c.deltaDb > 0 ? "rises" : "falls"} from ${c.before.toFixed(1)} to ${c.after.toFixed(1)} LUFS (two-second means either side)${c.gradual ? ", gradually" : ""}.`
        : `The balance moves: ${describeTone(c)} (each band's share, three seconds either side)${c.gradual ? ", gradually" : ""}.`);
  }
  if (channels.length === 2) {
    add("stereoCorrelation", left2 > 0 && right2 > 0 ? Math.max(-1, Math.min(1, cross/Math.sqrt(left2*right2))) : null, "coefficient", "all", "uncentered-stereo-correlation");
    add("sideToMidDb", mid2 > 0 && side2 > 0 ? 10*Math.log10(side2/mid2) : null, "dB", "all", "side-to-mid-energy-ratio");
  }
  return createEvidence({ snapshotId: artifact.snapshotId, task: "local passage measurements", artifactRefs: [refOf(artifact)], measurements, observations: [], hypotheses: [],
    limitations: [{ code: "supported-local-methods", text: "Loudness (BS.1770-4 LUFS, EBU loudness range), 4x true peak, band balance against pink noise and timed loudness/tone changes are measured; no musical judgement, beat alignment, or hosted listening is provided. A tonal change is a band's share of the energy moving, whether the music or processing moved it. Lead-in and tail are excluded from passage measurements.", affects: [] }, ...(artifact.render ? [{ code: "render-history", text: `Render started ${artifact.render.start}; lead-in is ${(artifact.passage?.leadInFrames ?? 0) / sampleRate} seconds. Lead-in is a warm-up policy, not proof of convergence. Notes beginning before the lead-in and prior processor history may be absent. Plugin load states and render block size may be unknown.`, affects: [] }] : []), ...(artifact.render?.missingPlugins.length ? [{ code: "missing-render-sources", text: `The engine could not render these sources: ${artifact.render.missingPlugins.join(", ")}`, affects: [] }] : [])],
    coverage: { inspected: [span], unavailable: ["hosted perception", "beat/phrase timing", "instrument identification"] }, createdAt: Date.now() });
}
