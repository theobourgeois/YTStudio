/**
 * Writes the audio-intelligence fixtures (`shared/music/audio-intelligence/fixtures.ts`) as WAV files and a manifest,
 * for trying the hearing tools against by hand. Tests render them in memory and don't need this.
 *
 *   pnpm tsx scripts/make-audio-fixtures.ts [--out data/audio-fixtures]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { FIXTURES, renderFixture } from "../shared/music/audio-intelligence/fixtures.ts";
import { sha256 } from "../shared/music/hash.ts";
import { writeWavChannels } from "../server/music/wav.ts";

const flag = process.argv.indexOf("--out");
const out = path.resolve(flag >= 0 ? process.argv[flag + 1] : "data/audio-fixtures");
await fs.mkdir(out, { recursive: true });

const manifest = [];
for (const spec of FIXTURES) {
  const audio = renderFixture(spec, FIXTURES);
  const file = path.join(out, `${spec.id}.wav`);
  await writeWavChannels(file, audio.channels, audio.sampleRate);
  manifest.push({ ...spec, file: path.basename(file), sha256: sha256(await fs.readFile(file)) });
  console.log(`${spec.id}  ${spec.seconds} s  ${spec.channels} ch  ${spec.role}`);
}
await fs.writeFile(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${manifest.length} fixtures in ${out}`);
