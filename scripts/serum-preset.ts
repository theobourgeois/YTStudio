/**
 * Serum 2 presets from readable specs, and specs from presets (server/music/serum/, docs/serum/preset-format.md).
 *
 *   pnpm tsx scripts/serum-preset.ts read <file.SerumPreset | serum-state.bin> [--out spec.json]
 *   pnpm tsx scripts/serum-preset.ts write <spec.json> [--out file.SerumPreset]
 *   pnpm tsx scripts/serum-preset.ts verify [--roundtrip <file|folder>...] [--specs <spec.json|folder>...] [--reference <Serum's .SerumPreset>] --out <dir>
 *
 * `verify` checks against the real Serum 2, in the offline engine (silent, no window: scripts/serum-readout.ts;
 * EDITOR_ENGINE_PATH says which engine). Round trip: each preset or state is read into a spec, written back,
 * and both are loaded into Serum, which must show the same 541 controls and save the same settings again.
 * Specs: each is written as a preset into `--out`, loaded, and Serum's controls must show what the spec says.
 * With `--reference` (a preset Serum saved), each written file's layout is compared with it: the container, the
 * header's keys and formatting, the payload's version, the zstd frame, the hash, the settings' modules. Reports go
 * in `--out` as JSON. Serum's files (wavetables, samples) are only read, to say what Serum records
 * about them; nothing is written outside `--out`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { type CborMap, type CborValue, decodeCbor, encodeCbor, isPlainMap } from "../server/music/serum/cbor.ts";
import { optionText } from "../server/music/serum/catalogue.ts";
import { readXfer } from "../server/music/serum/container.ts";
import { presetAsState, stateSettings } from "../server/music/serum/plugin-state.ts";
import { finalize } from "../server/music/serum/body.ts";
import {
  type FileFacts,
  presetFile,
  readSerumFile,
  readSerumSettings,
  type SerumPresetSpec,
  specToBody,
  writeSerumPreset,
} from "../server/music/serum/preset.ts";
import { LFO_DIVISIONS } from "../server/music/serum/units.ts";
import { type SerumControl, withSerum } from "./serum-readout.ts";

const SERUM_FOLDER = "/Library/Audio/Presets/Xfer Records/Serum 2 Presets";

// ---- What Serum records about its files (read from their headers) ----

async function wavFacts(file: string): Promise<FileFacts | undefined> {
  const b = await fs.readFile(file).catch(() => null);
  if (!b || b.toString("latin1", 0, 4) !== "RIFF") return undefined;
  let channels = 0;
  let sampleRate = 0;
  let blockAlign = 0;
  for (let i = 12; i + 8 <= b.length; ) {
    const id = b.toString("latin1", i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === "fmt ") {
      channels = b.readUInt16LE(i + 10);
      sampleRate = b.readUInt32LE(i + 12);
      blockAlign = b.readUInt16LE(i + 20);
    }
    if (id === "data" && blockAlign) return { numFrames: Math.floor(size / blockAlign), numChannels: channels, sampleRate };
    i += 8 + size + (size & 1);
  }
  return undefined;
}

async function flacFacts(file: string): Promise<FileFacts | undefined> {
  const handle = await fs.open(file).catch(() => null);
  if (!handle) return undefined;
  try {
    const b = Buffer.alloc(42);
    await handle.read(b, 0, 42, 0);
    if (b.toString("latin1", 0, 4) !== "fLaC") return undefined;
    // STREAMINFO: 20 bits rate, 3 bits channels − 1, 5 bits bits − 1, 36 bits samples.
    const info = b.subarray(8);
    const sampleRate = (info[10] << 12) | (info[11] << 4) | (info[12] >> 4);
    const numChannels = ((info[12] >> 1) & 7) + 1;
    const numFrames = Number((BigInt(info[13] & 15) << 32n) | BigInt(info.readUInt32BE(14)));
    return { numFrames, numChannels, sampleRate };
  } finally {
    await handle.close();
  }
}

/** Facts for every file a spec or preset names, read ahead (the writer asks synchronously). */
async function factsFor(paths: { folder: "Tables" | "Samples"; path: string }[]) {
  const known = new Map<string, FileFacts | undefined>();
  for (const { folder, path: p } of paths) {
    const file = path.join(SERUM_FOLDER, folder, p.replace(/^\//, ""));
    known.set(`${folder}/${p}`, p.toLowerCase().endsWith(".flac") ? await flacFacts(file) : await wavFacts(file));
  }
  return (folder: "Tables" | "Samples", p: string) => known.get(`${folder}/${p}`);
}

/** The files a body names: its oscillators' wavetables and samples. */
function filesIn(body: CborMap): { folder: "Tables" | "Samples"; path: string }[] {
  const out: { folder: "Tables" | "Samples"; path: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const osc = body[`Oscillator${i}`];
    if (!isPlainMap(osc)) continue;
    const wt = osc[`WTOsc${i}`];
    if (isPlainMap(wt) && typeof wt.relativePathToWT === "string") out.push({ folder: "Tables", path: wt.relativePathToWT });
    for (const sub of ["SampleOsc", "GranularOsc", "SpectralOsc"]) {
      const s = osc[`${sub}${i}`];
      if (isPlainMap(s) && typeof s.samplePathRelative === "string") out.push({ folder: "Samples", path: s.samplePathRelative });
    }
  }
  return out;
}

function filesInSpec(spec: SerumPresetSpec) {
  const out: { folder: "Tables" | "Samples"; path: string }[] = [];
  for (const key of ["A", "B", "C"] as const) {
    const o = spec.oscillators?.[key];
    if (o?.wavetable) out.push({ folder: "Tables", path: o.wavetable });
    if (o?.sample) out.push({ folder: "Samples", path: o.sample });
  }
  return out;
}

// ---- Commands ----

/** A spec as JSON for reading: indented, but short lists of numbers (an LFO's points) on one line. */
export function specJson(spec: SerumPresetSpec): string {
  const lines = JSON.stringify(spec, null, 2);
  return lines.replace(/\[\s*(-?[\d.e+-]+(?:,\s*-?[\d.e+-]+)*)\s*\]/g, (all, inner: string) => (inner.length < 80 ? `[${inner.split(/,\s*/).join(", ")}]` : all));
}

async function read(file: string, out?: string) {
  const bytes = new Uint8Array(await fs.readFile(file));
  const facts = await factsFor(filesIn(readSerumSettings(bytes).body));
  const spec = readSerumFile(bytes, { fileFacts: facts });
  const text = `${specJson(spec)}\n`;
  if (out) await fs.writeFile(out, text);
  else process.stdout.write(text);
}

async function write(specFile: string, out?: string) {
  const spec = JSON.parse(await fs.readFile(specFile, "utf8")) as SerumPresetSpec;
  const facts = await factsFor(filesInSpec(spec));
  const bytes = writeSerumPreset(spec, { fileFacts: facts });
  const target = out ?? specFile.replace(/(\.spec)?\.json$/, "") + ".SerumPreset";
  await fs.writeFile(target, bytes);
  console.log(`${target} (${bytes.length} bytes)`);
}

/** Files under these paths (folders searched for `ext`). */
async function expand(inputs: string[], ext: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const input of inputs) {
    const stat = await fs.stat(input);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(input)).sort())
        if (!name.startsWith(".") && ext.some((e) => name.endsWith(e))) out.push(path.join(input, name));
    } else out.push(input);
  }
  return out;
}

/** The first number in a control's text, in the unit given: "1.00 s" → 1000 ms, "-∞ dB" → -Infinity. */
function shownNumber(text: string): { value: number; step: number } | undefined {
  if (/-∞/.test(text)) return { value: -Infinity, step: 0 };
  const m = /([+-]?\d+(?:\.(\d+))?)\s*(ms|s\b|Hz|%|°|dB|st|L|R)?/.exec(text);
  if (!m) return undefined;
  let value = Number(m[1]);
  let step = 10 ** -(m[2]?.length ?? 0);
  if (m[3] === "s") {
    value *= 1000;
    step *= 1000;
  }
  return { value, step };
}

interface Expectation {
  from: string;
  control: string;
  /** A number (Serum's text read as one, within its rounding) or the exact text. */
  expect: number | string;
}

const percentShown = (v: number) => v;
const onOff = (b: boolean) => (b ? "On" : "Off");

/** What Serum's controls should show for a spec's named fields (those with a control). */
function expectations(spec: SerumPresetSpec, tableFrames: (osc: number) => number | undefined): Expectation[] {
  const out: Expectation[] = [];
  const add = (from: string, control: string, expect: number | string | undefined) => {
    if (expect !== undefined) out.push({ from, control, expect });
  };
  const g = spec.global;
  if (g) {
    add("global.volume", "Main Vol", g.volume);
    add("global.portamento", "Porta Time", g.portamento);
    add("global.bendUp", "Bend Up", g.bendUp);
    add("global.bendDown", "Bend Down", g.bendDown);
    add("global.modWheel", "Mod Wheel", g.modWheel);
    if (g.mono !== undefined) add("global.mono", "Mono Toggle", onOff(g.mono));
    if (g.legato !== undefined) add("global.legato", "Legato", onOff(g.legato));
    if (g.portaAlways !== undefined) add("global.portaAlways", "Porta Always", onOff(g.portaAlways));
    add("global.transpose", "Transpose", g.transpose);
    add("global.directVolume", "Direct Vol", g.directVolume);
    add("global.bus1Volume", "Bus 1 Vol", g.bus1Volume);
    add("global.bus2Volume", "Bus 2 Vol", g.bus2Volume);
  }
  (["A", "B", "C"] as const).forEach((key, i) => {
    const o = spec.oscillators?.[key];
    if (!o) return;
    const at = `oscillators.${key}`;
    if (o.enabled !== undefined) add(`${at}.enabled`, `${key} Enable`, onOff(o.enabled));
    add(`${at}.level`, `${key} Level`, o.level === undefined ? undefined : percentShown(o.level));
    add(`${at}.pan`, `${key} Pan`, o.pan);
    add(`${at}.octave`, `${key} Octave`, o.octave);
    add(`${at}.semi`, `${key} Semi`, o.semi);
    add(`${at}.fine`, `${key} Fine`, o.fine);
    add(`${at}.unison.voices`, `${key} Unison`, o.unison?.voices);
    add(`${at}.unison.detune`, `${key} Uni Detune`, o.unison?.detune);
    add(`${at}.unison.blend`, `${key} Uni Blend`, o.unison?.blend);
    add(`${at}.unison.width`, `${key} Uni Width`, o.unison?.width);
    if (o.unison?.stack) add(`${at}.unison.stack`, `${key} Uni Stack`, optionText("Oscillator.kParamUnisonStack", o.unison.stack));
    if (o.type === undefined || o.type === "wavetable") {
      const frames = tableFrames(i);
      if (o.position !== undefined && frames) add(`${at}.position`, `${key} WT Pos`, Math.round(1 + ((o.position - 1) / 255) * (frames - 1)));
      if (o.warp?.mode && key === "A") add(`${at}.warp.mode`, `${key} Warp Mode`, optionText("WTOsc.kParamWarpMenu", o.warp.mode));
      add(`${at}.phase`, `${key} Phase`, o.phase);
      add(`${at}.randomPhase`, `${key} Rand Phase`, o.randomPhase);
    }
  });
  const noise = spec.oscillators?.noise;
  if (noise) {
    if (noise.enabled !== undefined) add("oscillators.noise.enabled", "Noise Enable", onOff(noise.enabled));
    add("oscillators.noise.level", "Noise Level", noise.level);
    add("oscillators.noise.pan", "Noise Pan", noise.pan);
    if (!noise.pitchTrack) add("oscillators.noise.pitch", "Noise Pitch", noise.pitch);
  }
  const sub = spec.oscillators?.sub;
  if (sub) {
    if (sub.enabled !== undefined) add("oscillators.sub.enabled", "Sub Enable", onOff(sub.enabled));
    add("oscillators.sub.level", "Sub Level", sub.level);
    add("oscillators.sub.octave", "Sub Octave", sub.octave);
    if (sub.shape) add("oscillators.sub.shape", "Sub Shape", optionText("SubOsc.kParamShape", sub.shape));
  }
  for (const n of ["1", "2"] as const) {
    const f = spec.filters?.[n];
    if (!f) continue;
    const at = `filters.${n}`;
    if (f.enabled !== undefined) add(`${at}.enabled`, `Filter ${n} On`, onOff(f.enabled));
    if (f.type) add(`${at}.type`, `Filter ${n} Type`, optionText("VoiceFilter.kParamType", f.type) ?? f.type);
    add(`${at}.cutoff`, `Filter ${n} Freq`, f.cutoff === undefined ? undefined : Math.min(f.cutoff, 22050));
    add(`${at}.resonance`, `Filter ${n} Res`, f.resonance);
    add(`${at}.drive`, `Filter ${n} Drive`, f.drive);
    add(`${at}.var`, `Filter ${n} Var`, f.var);
    add(`${at}.mix`, `Filter ${n} Wet`, f.mix);
    add(`${at}.stereo`, `Filter ${n} Stereo`, f.stereo);
    add(`${at}.level`, `Filter ${n} Level`, f.level);
  }
  for (const [n, e] of Object.entries(spec.envelopes ?? {})) {
    if (!e) continue;
    const at = `envelopes.${n}`;
    add(`${at}.attack`, `Env ${n} Attack`, e.attack);
    add(`${at}.hold`, `Env ${n} Hold`, e.hold);
    add(`${at}.decay`, `Env ${n} Decay`, e.decay);
    add(`${at}.release`, `Env ${n} Release`, e.release);
    // Serum shows the sustain's gain, (v/100)²: in dB for Env 1, as a percentage for the others.
    if (e.sustain !== undefined) add(`${at}.sustain`, `Env ${n} Sustain`, n === "1" ? 40 * Math.log10(e.sustain / 100) : (e.sustain / 100) ** 2 * 100);
    add(`${at}.attackCurve`, `Env ${n} Atk Curve`, e.attackCurve);
    add(`${at}.decayCurve`, `Env ${n} Dec Curve`, e.decayCurve);
    add(`${at}.releaseCurve`, `Env ${n} Rel Curve`, e.releaseCurve);
  }
  for (const [n, l] of Object.entries(spec.lfos ?? {})) {
    if (!l) continue;
    const at = `lfos.${n}`;
    if (typeof l.rate === "string") add(`${at}.rate`, `LFO ${n} Rate`, LFO_DIVISIONS.has(l.rate) ? l.rate : undefined);
    else if (typeof l.rate === "number" && l.sync === false) add(`${at}.rate`, `LFO ${n} Rate`, l.rate * (l.rate10x ? 10 : 1));
    add(`${at}.smooth`, `LFO ${n} Smooth`, l.smooth);
    add(`${at}.phase`, `LFO ${n} Phase`, l.phase);
  }
  for (const [n, m] of Object.entries(spec.macros ?? {})) add(`macros.${n}.value`, `Macro ${n}`, m?.value);
  const labels: Record<string, string> = { A: "A", B: "B", C: "C", noise: "Noise", sub: "Sub Osc", filter1: "Filter 1", filter2: "Filter 2" };
  for (const [key, r] of Object.entries(spec.routing ?? {})) {
    if (!r) continue;
    if (key !== "filter1" && key !== "filter2") add(`routing.${key}.filterBalance`, `${labels[key]}>Filter Balance`, r.filterBalance);
    if (r.bus1) add(`routing.${key}.bus1`, `${labels[key]}>BUS1`, r.bus1);
    if (r.bus2) add(`routing.${key}.bus2`, `${labels[key]}>BUS2`, r.bus2);
  }
  // Mod slots fill from 1 in the order given unless placed.
  let next = 1;
  const placed = new Set((spec.modulation ?? []).map((m) => m.slot).filter((s): s is number => s !== undefined));
  for (const [i, m] of (spec.modulation ?? []).entries()) {
    let slot = m.slot;
    if (slot === undefined) {
      while (placed.has(next)) next++;
      slot = next++;
    }
    if (m.amount) add(`modulation[${i}].amount`, `Mod ${slot} Amount`, m.amount);
  }
  return out;
}

/**
 * Whether Serum's text shows the expectation, within the text's rounding. Serum shows 0 as "--" on some controls,
 * truncates a pan toward 0 from its knob's 32-bit position (-10 can read "-9 L"), so a pan may be 1 off, and
 * shows a filter's level up to 0.1 dB low.
 */
function shows(text: string, expect: number | string, control = ""): boolean {
  if (typeof expect === "string") return text.trim() === expect;
  if (text.trim() === "--") return expect === 0 || expect === -Infinity;
  const shown = shownNumber(text);
  if (!shown) return false;
  if (!Number.isFinite(expect) || !Number.isFinite(shown.value)) return expect === shown.value;
  // A filter's level text reads up to 0.1 dB low (Serum doesn't round it to the nearest tenth).
  const slack = / Pan$/.test(control) ? 1 : /^Filter \d Level$/.test(control) ? 0.1 : shown.step / 2;
  return Math.abs(shown.value - expect) <= slack + 1e-9 + Math.abs(expect) * 1e-9;
}

/** Leaves of a value as "path = value" pairs, for comparing what Serum saved. */
function leaves(value: CborValue, at = "", out = new Map<string, CborValue>()): Map<string, CborValue> {
  if (isPlainMap(value)) for (const [k, v] of Object.entries(value)) leaves(v, at ? `${at}/${k}` : k, out);
  else if (Array.isArray(value) && value.length <= 64) value.forEach((v, i) => leaves(v, `${at}[${i}]`, out));
  else out.set(at, value);
  return out;
}

function close(a: CborValue | undefined, b: CborValue | undefined): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return JSON.stringify(a, (_, v) => (typeof v === "bigint" ? String(v) : v)) === JSON.stringify(b, (_, v) => (typeof v === "bigint" ? String(v) : v));
}

/** Where two of Serum's saves differ (at most `limit` paths). */
function differences(a: CborValue, b: CborValue, limit = 12): string[] {
  const la = leaves(a);
  const lb = leaves(b);
  const out: string[] = [];
  for (const key of new Set([...la.keys(), ...lb.keys()])) {
    if (close(la.get(key), lb.get(key))) continue;
    out.push(`${key}: ${String(JSON.stringify(la.get(key)) ?? "absent").slice(0, 60)} → ${String(JSON.stringify(lb.get(key)) ?? "absent").slice(0, 60)}`);
    if (out.length >= limit) break;
  }
  return out;
}

const texts = (controls: SerumControl[]) => controls.map((c) => c.text.trim());

/** How a preset file is laid out: what must match between ours and Serum's own. */
function layoutOf(bytes: Uint8Array) {
  const buf = Buffer.from(bytes);
  const jsonLength = Number(buf.readBigUInt64LE(9));
  const json = buf.subarray(17, 17 + jsonLength).toString("utf8");
  const meta = JSON.parse(json) as Record<string, unknown>;
  const payload = 17 + jsonLength;
  const zstd = buf.subarray(payload + 8);
  const body = decodeCbor(readXfer(bytes).settings);
  // Serum writes the JSON compact, keys sorted, whole numbers as "4.0" (nlohmann::json).
  const sorted = Object.keys(meta).join(",") === Object.keys(meta).sort().join(",");
  return {
    magic: buf.toString("latin1", 0, 9) === "XferJson\0",
    headerKeys: Object.keys(meta).sort(),
    headerCompactSorted: sorted && !/[\n ]"|": |, "/.test(json) && /"version":\d+\.\d/.test(json),
    payloadVersion: buf.readUInt32LE(payload + 4),
    sizeMatches: buf.readUInt32LE(payload) === readXfer(bytes).settings.length,
    zstdFrame: zstd.subarray(0, 4).toString("hex") === "28b52ffd" ? { singleSegment: !!(zstd[4] & 0x20), contentSize: zstd[4] >> 6 > 0 || !!(zstd[4] & 0x20), checksum: !!(zstd[4] & 0x04) } : null,
    hashIsMd5OfZstd: meta.hash === createHash("md5").update(zstd).digest("hex"),
    bodyKeys: isPlainMap(body) ? Object.keys(body).map((k) => k.replace(/\d+$/, "#")).filter((k, i, all) => all.indexOf(k) === i).sort() : [],
    headerMatchesBody: isPlainMap(body) && ["presetName", "presetAuthor", "presetDescription", "productVersion", "version"].every((k) => JSON.stringify(body[k]) === JSON.stringify(meta[k])),
  };
}

/** Where a layout differs from the reference's (the hash, sizes and names differ by nature). */
function layoutDifferences(ours: ReturnType<typeof layoutOf>, reference: ReturnType<typeof layoutOf>): string[] {
  const out: string[] = [];
  for (const key of Object.keys(ours) as (keyof typeof ours)[]) {
    if (JSON.stringify(ours[key]) !== JSON.stringify(reference[key])) out.push(`${key}: ours ${JSON.stringify(ours[key])}, Serum's ${JSON.stringify(reference[key])}`);
  }
  return out;
}

async function verify(roundtrip: string[], specs: string[], outDir: string, reference?: string) {
  await fs.mkdir(outDir, { recursive: true });
  const sources = await expand(roundtrip, [".SerumPreset", ".bin"]);
  const specFiles = await expand(specs, [".json"]);
  const started = Date.now();
  await withSerum(async (load) => {
    const template = (await load(null)).resaved;
    const asState = (presetBytes: Uint8Array) => presetAsState(template, readXfer(presetBytes).settings);
    const savedSettings = (state: Uint8Array) => decodeCbor(stateSettings(state));

    // Round trip.
    if (sources.length) {
      const rows = [];
      for (const file of sources) {
        const bytes = new Uint8Array(await fs.readFile(file));
        const name = path.basename(file).replace(/\.(SerumPreset|bin)$/, "");
        try {
          const { kind, body } = readSerumSettings(bytes);
          const fileFacts = await factsFor(filesIn(body));
          const spec = JSON.parse(JSON.stringify(readSerumFile(bytes, { fileFacts }))) as SerumPresetSpec;
          const written = writeSerumPreset(spec, { fileFacts });
          const writtenBody = decodeCbor(readXfer(written).settings);
          const bodyExact = Buffer.from(encodeCbor(writtenBody)).equals(Buffer.from(encodeCbor(body)));
          const original = await load(kind === "preset" ? asState(bytes) : bytes);
          const again = await load(asState(written));
          const a = texts(original.controls);
          const b = texts(again.controls);
          let controlDiffs = a.flatMap((t, i) => (t === b[i] ? [] : [i]));
          // Some of Serum's texts depend on what it loaded before (a scale's name reads "-" the first time, then
          // "---"): load both again, and a control the original itself shows two ways isn't a difference.
          const unstable: string[] = [];
          if (controlDiffs.length) {
            const a2 = texts((await load(kind === "preset" ? asState(bytes) : bytes)).controls);
            const b2 = texts((await load(asState(written))).controls);
            for (const i of controlDiffs) if (a2[i] !== a[i] || b2[i] !== b[i]) unstable.push(`${original.controls[i].name}: ${a[i]} / ${a2[i]} → ${b[i]} / ${b2[i]}`);
            controlDiffs = controlDiffs.filter((i) => a2[i] === a[i] && b2[i] === b[i]);
          }
          let saveDiffs = differences(savedSettings(original.resaved), savedSettings(again.resaved));
          // A multisample's files load in the background, so a save may catch some of them unloaded: load both again
          // after a moment, and a difference that doesn't come back isn't one.
          const unstableSave: string[] = [];
          if (saveDiffs.length) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const a2 = await load(kind === "preset" ? asState(bytes) : bytes);
            const b2 = await load(asState(written));
            const second = differences(savedSettings(a2.resaved), savedSettings(b2.resaved));
            unstableSave.push(...saveDiffs.filter((d) => !second.includes(d)));
            saveDiffs = saveDiffs.filter((d) => second.includes(d));
          }
          const rawKeys = Object.keys(spec.raw ?? {});
          rows.push({
            name,
            kind,
            bodyExact,
            controls: a.length,
            controlsSame: a.length - controlDiffs.length - unstable.length,
            controlDiffs: controlDiffs.map((i) => `${original.controls[i].name}: ${a[i]} → ${b[i]}`),
            unstable,
            resaveSame: !saveDiffs.length,
            saveDiffs,
            unstableSave,
            rawKeys,
          });
          const row = rows[rows.length - 1] as { controlDiffs: string[] };
          console.log(
            `${controlDiffs.length || saveDiffs.length || !bodyExact ? "DIFF" : "same"}  ${name}${row.controlDiffs.length ? `  controls: ${row.controlDiffs.slice(0, 3).join("; ")}` : ""}${unstable.length ? `  unstable in Serum: ${unstable.join("; ")}` : ""}${saveDiffs.length ? `  save: ${saveDiffs.slice(0, 2).join("; ")}` : ""}${unstableSave.length ? `  save unstable in Serum: ${unstableSave.slice(0, 2).join("; ")}` : ""}`,
          );
        } catch (e) {
          rows.push({ name, error: String(e) });
          console.log(`FAIL  ${name}: ${String(e).slice(0, 300)}`);
        }
      }
      const ok = rows.filter((r) => "controlDiffs" in r);
      const summary = {
        sources: rows.length,
        failed: rows.length - ok.length,
        bodyExact: ok.filter((r) => r.bodyExact).length,
        allControlsSame: ok.filter((r) => !r.controlDiffs!.length).length,
        controlsCompared: ok.reduce((n, r) => n + r.controls!, 0),
        controlsSame: ok.reduce((n, r) => n + r.controlsSame!, 0),
        controlsUnstableInSerum: ok.reduce((n, r) => n + r.unstable!.length, 0),
        resaveSame: ok.filter((r) => r.resaveSame).length,
        resaveUnstableInSerum: ok.filter((r) => r.unstableSave!.length).length,
      };
      await fs.writeFile(path.join(outDir, "roundtrip-report.json"), JSON.stringify({ summary, rows }, null, 2));
      console.log("round trip:", summary);
    }

    // Specs written from scratch.
    const referenceLayout = reference ? layoutOf(new Uint8Array(await fs.readFile(reference))) : undefined;
    if (specFiles.length) {
      const rows = [];
      for (const file of specFiles) {
        const name = path.basename(file).replace(/(\.spec)?\.json$/, "");
        try {
          const spec = JSON.parse(await fs.readFile(file, "utf8")) as SerumPresetSpec;
          const fileFacts = await factsFor(filesInSpec(spec));
          const body = specToBody(spec, { fileFacts });
          const bytes = presetFile(body);
          await fs.writeFile(path.join(outDir, `${name}.SerumPreset`), bytes);
          const layout = layoutOf(bytes);
          const layoutDiffs = referenceLayout ? layoutDifferences(layout, referenceLayout) : [];
          const loaded = await load(asState(bytes));
          const saved = savedSettings(loaded.resaved);
          finalize(saved);
          const frames = (i: number) => {
            const osc = isPlainMap(saved) ? saved[`Oscillator${i}`] : undefined;
            const wt = isPlainMap(osc) ? osc[`WTOsc${i}`] : undefined;
            return isPlainMap(wt) && typeof wt.numFrames === "number" ? wt.numFrames / 2048 : undefined;
          };
          const checks = expectations(spec, frames).map((e) => {
            const control = loaded.controls.find((c) => c.name === e.control);
            const text = control?.text.trim() ?? "(no such control)";
            return { ...e, shown: text, ok: control ? shows(text, e.expect, e.control) : false };
          });
          // What was written that Serum didn't save back as written: a value it doesn't store because it's the
          // default, what its controller keeps rather than its processor (names) or works out itself (tags), and
          // anything else, which would be news.
          const written = leaves(body);
          const kept = leaves(saved);
          const notKept = { defaults: [] as string[], controllerOrMetadata: [] as string[], changed: [] as string[] };
          for (const key of written.keys()) {
            if (/^(ClipPlayer|Filter|GranularOsc|MultiSampleOsc|Osc|SerumGUI|SpectralOsc|WTOsc)\b|^(arpBankDisplayName|clipBankDisplayName|fileType|preset\w+)$/.test(key)) continue;
            if (close(written.get(key), kept.get(key))) continue;
            const line = `${key}: ${JSON.stringify(written.get(key))} → ${JSON.stringify(kept.get(key)) ?? "absent"}`;
            if (/(^|\/)(name|displayName|curveDisplayName)$|^tags\[/.test(key)) notKept.controllerOrMetadata.push(line);
            else if (!kept.has(key) && /\/plainParams(\/|$)/.test(key)) notKept.defaults.push(line);
            else notKept.changed.push(line);
          }
          const dropped = notKept.changed;
          const tables = [0, 1, 2].map((i) => ({ oscillator: "ABC"[i], frames: frames(i) ?? null }));
          rows.push({ name, file: `${name}.SerumPreset`, layout, layoutDiffs, checks, passed: checks.filter((c) => c.ok).length, total: checks.length, notKeptAsWritten: notKept, tables });
          console.log(`${name}: ${checks.filter((c) => c.ok).length}/${checks.length} controls as intended${checks.some((c) => !c.ok) ? `; not: ${checks.filter((c) => !c.ok).map((c) => `${c.control} shows ${c.shown}, wanted ${c.expect}`).join("; ")}` : ""}`);
          console.log(`  Serum saved it back: ${notKept.defaults.length} defaults left out, ${notKept.controllerOrMetadata.length} names/tags kept elsewhere, ${dropped.length} changed${dropped.length ? `: ${dropped.slice(0, 6).join("; ")}` : ""}`);
          if (referenceLayout) console.log(`  layout ${layoutDiffs.length ? `differs from Serum's: ${layoutDiffs.join("; ")}` : "as Serum's"}`);
        } catch (e) {
          rows.push({ name, error: String(e) });
          console.log(`FAIL  ${name}: ${String(e).slice(0, 500)}`);
        }
      }
      await fs.writeFile(path.join(outDir, "specs-report.json"), JSON.stringify(rows, null, 2));
    }
  });
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s; reports in ${outDir}`);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    roundtrip: { type: "string", multiple: true, default: [] },
    specs: { type: "string", multiple: true, default: [] },
    reference: { type: "string" },
  },
});
const [command, input] = positionals;
if (command === "read" && input) await read(input, values.out);
else if (command === "write" && input) await write(input, values.out);
else if (command === "verify" && values.out && (values.roundtrip.length || values.specs.length)) await verify(values.roundtrip, values.specs, values.out, values.reference);
else {
  console.error(`Usage:
  pnpm tsx scripts/serum-preset.ts read <file.SerumPreset | state.bin> [--out spec.json]
  pnpm tsx scripts/serum-preset.ts write <spec.json> [--out file.SerumPreset]
  pnpm tsx scripts/serum-preset.ts verify [--roundtrip <file|folder>]... [--specs <spec.json|folder>]... [--reference <a Serum .SerumPreset>] --out <dir>`);
  process.exit(1);
}
