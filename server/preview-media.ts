/** Small display assets derived from the rendered preview, shared by the home cards. */
import path from "node:path";
import type { ProjectPreview, WaveformData } from "../shared/types.ts";
import type { SuiteId } from "../shared/suites.ts";
import { makePoster, makeWaveform } from "./derivatives.ts";
import { probeMedia } from "./probe.ts";
import { readJson } from "./storage.ts";

export async function inspectPreview(file: string, folder: string, suite: SuiteId, signal: AbortSignal): Promise<Pick<ProjectPreview, "duration" | "peaks">> {
  const { duration } = await probeMedia(file);
  if (suite === "video") {
    await makePoster(file, path.join(folder, "poster.jpg"), duration);
    return { duration };
  }
  const waveform = path.join(folder, "waveform.json");
  await makeWaveform(file, waveform, signal);
  const data = await readJson<WaveformData>(waveform);
  const source = data?.peaks ?? [];
  const count = Math.min(240, source.length);
  const peaks = Array.from({ length: count }, (_, i) => {
    const from = Math.floor(i * source.length / count);
    const to = Math.max(from + 1, Math.floor((i + 1) * source.length / count));
    return Math.max(...source.slice(from, to));
  });
  return { duration, peaks };
}
