/**
 * The assistant's Pro-C (`shared/music/tools.ts`: get_pro_c, update_pro_c, set_pro_c_sidechain,
 * set_pro_c_bands, add_vocal_compression): pure `(song, input) => { song, text }` edits like the rest of
 * `tool-edits.ts`, and what get_pro_c says. Times in milliseconds and ratios as ratios, as the tools
 * describe them; errors say what's wrong and what would work.
 */
import { createId } from "@shared/ids";
import { isFiniteNumber } from "@shared/math";
import type { EngineProCState } from "@shared/music/engine";
import { setEffect } from "@shared/music/mixer";
import {
  type ProCPatch,
  addSidechainBand,
  chooseProCPreset,
  copyProCAB,
  editSidechainBands,
  engineProC,
  findProC,
  formatRatio,
  formatTime,
  proCs,
  setProCSidechain,
  sidechainConnected,
  staticReduction,
  switchProCAB,
  updateProC,
} from "@shared/music/pro-c";
import {
  PRO_C_ATTACK_RANGE,
  PRO_C_BANDS,
  PRO_C_CEILING_RANGE,
  PRO_C_GAIN_RANGE,
  PRO_C_GATE_RANGE,
  PRO_C_LIMITER_RANGE,
  PRO_C_MAX_EMPHASIS,
  PRO_C_MAX_HOLD,
  PRO_C_MAX_KNEE,
  PRO_C_MAX_LOOKAHEAD,
  PRO_C_MAX_MIX,
  PRO_C_MAX_RANGE,
  PRO_C_PLUGIN,
  PRO_C_PRESETS,
  PRO_C_RELEASE_RANGE,
  PRO_C_STYLE_INFO,
  PRO_C_THRESHOLD_RANGE,
  isVintage,
  ratioOf,
  slopeOf,
} from "@shared/music/pro-c-presets";
import { AUTO_TUNE_PLUGIN } from "@shared/music/auto-tune-presets";
import { PRO_Q_PLUGIN } from "@shared/music/pro-q-presets";
import { EFFECT_SLOTS } from "@shared/music/project";
import {
  EQ_SHAPES,
  EQ_SLOPES,
  type EqBand,
  type EqShape,
  type EqSlope,
  type MusicProject,
  PRO_C_AUDIO_MODES,
  PRO_C_CHARACTERS,
  PRO_C_DETECTORS,
  PRO_C_LINK_MODES,
  PRO_C_RECOVERIES,
  PRO_C_STYLES,
  PRO_C_SYNC_NOTES,
  PRO_C_TIME_MODES,
  type ProCOptions,
  type ProCStyle,
} from "@shared/music/types";
import { findTrack, trackLabel } from "../mixer/tool-edits";
import type { EditResult } from "../tool-edits";

type Input = Record<string, unknown>;

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const db = (v: number) => `${v > 0 ? "+" : ""}${round(v)} dB`;
const percent = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The Pro-C an input names: by `effect` (its id), by `track` (the track's Pro-C; with `effectSlot`, the one
 * in that slot), or the song's only one. The error lists the song's.
 */
export function findProCRef(song: MusicProject, input: Input) {
  const all = proCs(song);
  const list = () =>
    all.length ? `The song's Pro-Cs: ${all.map((p) => `${p.effect.id} (${trackLabel(song, p.track)}, slot ${p.slot + 1})`).join(", ")}.` : 'The song has none: add_mixer_effect with plugin "Pro-C" puts one on a track, add_vocal_compression sets up a vocal\'s.';
  if (typeof input.effect === "string" && input.effect.trim()) {
    const found = findProC(song, input.effect.trim());
    if (!found) throw new Error(`There's no Pro-C "${input.effect}". ${list()}`);
    return found;
  }
  if (input.track !== undefined && input.track !== "") {
    const track = findTrack(song, input.track);
    const on = all.filter((p) => p.track.id === track.id && (!Number.isInteger(input.effectSlot) || p.slot === (input.effectSlot as number) - 1));
    if (!on.length) throw new Error(`${trackLabel(song, track)} has no Pro-C${Number.isInteger(input.effectSlot) ? ` in slot ${String(input.effectSlot)}` : ""}. ${list()}`);
    return on[0];
  }
  if (all.length === 1) return all[0];
  throw new Error(all.length ? `Say which Pro-C ("effect", or "track"). ${list()}` : list());
}

/** get_pro_c: its style, knobs, curve, side chain, latency; and, while the song plays, what it's doing. */
export function describeProC(song: MusicProject, input: Input, live?: EngineProCState | null): string {
  const { effect, track, slot, proC } = findProCRef(song, input);
  const engine = engineProC(proC);
  const style = PRO_C_STYLE_INFO[proC.style];
  const vintage = isVintage(proC.style);
  const lines = [
    `Pro-C ${effect.id} on ${trackLabel(song, track)}, slot ${slot + 1}${effect.enabled ? "" : " (bypassed)"}${proC.preset ? `, preset "${proC.preset}"` : ""}${effect.mix < 1 ? `, slot mix ${percent(effect.mix)}` : ""}, A/B on ${proC.slot.toUpperCase()}.`,
    `Style ${proC.style} (${style.name}): ${style.detail}.`,
  ];
  const knobs = [
    proC.style === "vox"
      ? `Compression ${db(proC.threshold)}`
      : proC.style === "opto2a"
        ? `Peak Reduction ${Math.round(-proC.threshold / 0.4)} (threshold ${db(proC.threshold)})`
        : vintage
          ? `Input ${round(-proC.threshold)} (threshold ${db(proC.threshold)})`
          : `threshold ${db(proC.threshold)}${proC.autoThreshold ? " (Auto)" : ""}`,
    proC.style === "vocal" || proC.style === "vox" || proC.style === "opto2a" ? "ratio automatic" : `ratio ${formatRatio(proC.slope)}${proC.options.allButtons && proC.style === "fet" ? " (all buttons)" : ""}`,
    `knee ${round(proC.knee)} dB`,
    `range ${round(proC.range)} dB`,
    `attack ${formatTime(proC.attack)}`,
    `release ${formatTime(proC.release)}${proC.autoRelease ? " (Auto)" : ""}`,
    `hold ${formatTime(proC.hold)}`,
    `wet ${db(proC.wet)}${proC.autoGain ? ` + Auto Gain (${db(engine.makeup - proC.wet)})` : ""}`,
    `dry ${proC.dry === null ? "off" : db(proC.dry)}`,
    `mix ${percent(proC.mix)}`,
    `input ${db(proC.input)}`,
    `output ${db(proC.output)}`,
    `character ${proC.character.mode}${proC.character.mode === "off" ? "" : ` (drive ${percent(proC.character.drive)}, ${proC.character.post ? "post" : "pre"})`}`,
    `oversampling ${proC.oversampling === 1 ? "off" : `${proC.oversampling}×`}`,
    `lookahead ${formatTime(proC.lookahead)} of ${proC.maxLookahead ? formatTime(proC.maxLookahead) : "off"}`,
  ];
  lines.push(`Knobs: ${knobs.join(", ")}.`);
  const o = proC.options;
  const own: Partial<Record<ProCStyle, string>> = {
    fet: `all buttons ${o.allButtons ? "in" : "out"}, output ${o.link ? "linked" : "not linked"} to input`,
    opto2a: `${o.limit ? "Limit" : "Compress"}, emphasis ${round(o.emphasis)} dB`,
    optoTube: `time mode ${o.timeMode}`,
    distress: `detector ${o.detector}, audio ${o.audio}, British ${o.british ? "on" : "off"}`,
    vca160: `${o.overEasy ? "Over Easy" : "hard knee"}, ${o.auto ? "Auto times" : "manual times"}`,
    diode609: `recovery ${o.recovery}, limiter ${o.limiter === null ? "off" : db(o.limiter)}`,
    vox: `gate ${o.gate === null ? "off" : db(o.gate)}, ceiling ${db(o.ceiling)}`,
  };
  if (own[proC.style]) lines.push(`Its own switches: ${own[proC.style]}.`);
  const curve = [-40, -30, -20, -10, 0].map((level) => `${level} → ${round(level - staticReduction(engine, level) + engine.makeup)}`).join(", ");
  lines.push(`Its curve (a steady level in, dB → out, make-up in): ${curve}.`);
  const sc = proC.sidechain;
  const source = sc.track ? song.mixer.tracks.find((t) => t.id === sc.track) : null;
  const trigger =
    sc.trigger === "external"
      ? `external from ${source ? trackLabel(song, source) : "a track that's gone"}${source && !sidechainConnected(song, effect.id) ? " (it doesn't send here: set_pro_c_sidechain makes the send)" : ""}`
      : sc.trigger === "sync"
        ? `Host Sync, a pulse every 1/${sc.sync.note}${sc.sync.offset !== 1 ? ` × ${sc.sync.offset}` : ""}, ${percent(sc.sync.length)} long`
        : "internal";
  const bands = sc.bands.length ? sc.bands.map((b) => `${b.id}: ${b.shape} ${Math.round(b.frequency)} Hz${b.gain ? ` ${db(b.gain)}` : ""}${b.placement !== "stereo" ? ` (${b.placement})` : ""}${b.enabled ? "" : " (off)"}`).join("; ") : "none";
  lines.push(`Side chain: ${trigger}, level ${db(sc.level)}, link ${percent(Math.min(1, sc.link))}${sc.link > 1 ? ` then ${percent(sc.link - 1)} towards ${sc.linkMode}` : ""}. Its EQ: ${bands}.`);
  lines.push(`Latency: ${proC.maxLookahead || proC.oversampling > 1 ? `${formatTime(proC.maxLookahead)} of lookahead${proC.oversampling > 1 ? ` plus the ${proC.oversampling}× oversampling's filters` : ""}` : "none (it can be recorded through)"}.`);
  if (live) lines.push(`Now (while it plays): ${db(-live.reduction)} of gain change, its key at ${db(live.key)}, the threshold at ${db(live.threshold)}.`);
  lines.push(`Styles: ${PRO_C_STYLES.map((s) => `${s} (${PRO_C_STYLE_INFO[s].name})`).join(", ")}.`);
  lines.push(`Presets: ${PRO_C_PRESETS.map((p) => p.name).join(", ")}.`);
  return lines.join("\n");
}

function number(input: Input, key: string, min: number, max: number): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!isFiniteNumber(value) || value < min || value > max) throw new Error(`"${key}" must be a number from ${min} to ${max}.`);
  return value;
}
function choice<T extends string | number>(input: Input, key: string, list: readonly T[]): T | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!list.includes(value as T)) throw new Error(`"${key}" must be one of: ${list.join(", ")}.`);
  return value as T;
}
/** A dB value or "off". */
function orOff(input: Input, key: string, min: number, max: number): number | null | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (value === null || value === "off" || value === false) return null;
  if (!isFiniteNumber(value) || value < min || value > max) throw new Error(`"${key}" must be dB from ${min} to ${max}, or "off".`);
  return value;
}
const ms = (input: Input, key: string, min: number, max: number) => {
  const v = number(input, key, min * 1000, max * 1000);
  return v === undefined ? undefined : v / 1000;
};

/** update_pro_c: a preset, a style, knobs, the style's own switches, A/B. */
export function updateProCTool(song: MusicProject, input: Input): EditResult {
  const { effect } = findProCRef(song, input);
  const id = effect.id;
  let next = song;
  const done: string[] = [];
  if (input.preset !== undefined) {
    const preset = PRO_C_PRESETS.find((p) => p.name.toLowerCase() === String(input.preset).toLowerCase());
    if (!preset) throw new Error(`There's no preset "${String(input.preset)}". The presets: ${PRO_C_PRESETS.map((p) => p.name).join(", ")}.`);
    next = chooseProCPreset(next, id, preset.name);
    done.push(`loaded "${preset.name}"`);
  }
  const patch: ProCPatch = {};
  const style = choice(input, "style", PRO_C_STYLES);
  if (style) patch.style = style;
  const set = <K extends keyof ProCPatch>(key: K, value: ProCPatch[K] | undefined) => {
    if (value !== undefined) patch[key] = value;
  };
  set("threshold", number(input, "threshold", PRO_C_THRESHOLD_RANGE[0], PRO_C_THRESHOLD_RANGE[1]));
  const ratio = number(input, "ratio", 1, 1e9);
  if (ratio !== undefined) patch.slope = ratio >= 100 ? 1 : slopeOf(ratio);
  set("knee", number(input, "knee", 0, PRO_C_MAX_KNEE));
  set("range", number(input, "range", 0, PRO_C_MAX_RANGE));
  set("attack", ms(input, "attack", PRO_C_ATTACK_RANGE[0], PRO_C_ATTACK_RANGE[1]));
  set("release", ms(input, "release", PRO_C_RELEASE_RANGE[0], PRO_C_RELEASE_RANGE[1]));
  set("hold", ms(input, "hold", 0, PRO_C_MAX_HOLD));
  const maxLookahead = ms(input, "maxLookahead", 0, PRO_C_MAX_LOOKAHEAD);
  const lookahead = ms(input, "lookahead", 0, PRO_C_MAX_LOOKAHEAD);
  if (maxLookahead !== undefined) patch.maxLookahead = maxLookahead;
  if (lookahead !== undefined) {
    patch.lookahead = lookahead;
    // Lookahead needs room for it: the maximum is made at least as long.
    const most = maxLookahead ?? findProC(next, id)!.proC.maxLookahead;
    if (lookahead > most) patch.maxLookahead = Math.ceil(lookahead * 1000) / 1000;
  }
  for (const key of ["autoRelease", "autoThreshold", "autoGain"] as const) if (typeof input[key] === "boolean") patch[key] = input[key] as boolean;
  set("wet", number(input, "wet", PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1]));
  const dry = orOff(input, "dry", PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1]);
  if (dry !== undefined) patch.dry = dry;
  set("mix", number(input, "mix", 0, PRO_C_MAX_MIX));
  set("input", number(input, "input", PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1]));
  set("output", number(input, "output", PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1]));
  const oversampling = choice(input, "oversampling", [1, 2, 4, 8, 16] as const);
  if (oversampling !== undefined) patch.oversampling = oversampling;
  if (input.character !== undefined) {
    const c = (input.character && typeof input.character === "object" ? input.character : {}) as Input;
    const character: ProCPatch["character"] = {};
    const mode = choice(c, "mode", PRO_C_CHARACTERS);
    if (mode) character.mode = mode;
    const drive = number(c, "drive", 0, 1);
    if (drive !== undefined) character.drive = drive;
    if (typeof c.post === "boolean") character.post = c.post;
    patch.character = character;
  }
  if (input.options !== undefined) {
    const raw = (input.options && typeof input.options === "object" ? input.options : {}) as Input;
    const options: Partial<ProCOptions> = {};
    for (const key of ["link", "allButtons", "limit", "british", "overEasy", "auto"] as const) if (typeof raw[key] === "boolean") options[key] = raw[key] as boolean;
    const emphasis = number(raw, "emphasis", 0, PRO_C_MAX_EMPHASIS);
    if (emphasis !== undefined) options.emphasis = emphasis;
    const timeMode = choice(raw, "timeMode", PRO_C_TIME_MODES);
    if (timeMode) options.timeMode = timeMode;
    const detector = choice(raw, "detector", PRO_C_DETECTORS);
    if (detector) options.detector = detector;
    const audio = choice(raw, "audio", PRO_C_AUDIO_MODES);
    if (audio) options.audio = audio;
    const recovery = choice(raw, "recovery", PRO_C_RECOVERIES);
    if (recovery) options.recovery = recovery;
    const limiter = orOff(raw, "limiter", PRO_C_LIMITER_RANGE[0], PRO_C_LIMITER_RANGE[1]);
    if (limiter !== undefined) options.limiter = limiter;
    const gate = orOff(raw, "gate", PRO_C_GATE_RANGE[0], PRO_C_GATE_RANGE[1]);
    if (gate !== undefined) options.gate = gate;
    const ceiling = number(raw, "ceiling", PRO_C_CEILING_RANGE[0], PRO_C_CEILING_RANGE[1]);
    if (ceiling !== undefined) options.ceiling = ceiling;
    patch.options = options;
  }
  if (Object.keys(patch).length) {
    next = updateProC(next, id, patch);
    done.push(Object.keys(patch).join(", "));
  }
  if (input.ab !== undefined) {
    if (input.ab !== "switch" && input.ab !== "copy") throw new Error('"ab" must be "switch" or "copy".');
    next = input.ab === "switch" ? switchProCAB(next, id) : copyProCAB(next, id);
    done.push(input.ab === "switch" ? "switched A/B" : "copied to the other side of A/B");
  }
  if (!done.length) throw new Error("Nothing to change: give a preset, a style, a knob (threshold, ratio, attack, release...), options, or ab.");
  return { song: next, text: `Pro-C ${id}: ${done.join("; ")}.\n${describeProC(next, { effect: id })}` };
}

/** set_pro_c_sidechain: the trigger, its source track, Host Sync's pulse, level and link. */
export function setProCSidechainTool(song: MusicProject, input: Input): EditResult {
  const { effect, track } = findProCRef(song, input);
  const id = effect.id;
  let next = song;
  const done: string[] = [];
  const trigger = choice(input, "trigger", ["internal", "external", "sync"] as const);
  if (input.source !== undefined && input.source !== "") {
    const source = findTrack(song, input.source);
    if (source.id === track.id) throw new Error(`${trackLabel(song, source)} is the Pro-C's own track: key it from another one.`);
    const keyed = setProCSidechain(next, id, source.id);
    if (findProC(keyed, id)!.proC.sidechain.track !== source.id) throw new Error(`${trackLabel(song, source)} can't send to ${trackLabel(song, track)}: ${trackLabel(song, track)}'s sound already reaches it (a loop).`);
    next = keyed;
    done.push(`keyed from ${trackLabel(song, source)}`);
  } else if (trigger === "external" && !findProC(next, id)!.proC.sidechain.track) throw new Error('External needs a "source": the mixer track whose sound is the key.');
  const sidechain: ProCPatch["sidechain"] = {};
  if (trigger) sidechain.trigger = trigger;
  const level = number(input, "level", PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1]);
  if (level !== undefined) sidechain.level = level;
  const link = number(input, "link", 0, 2);
  if (link !== undefined) sidechain.link = link;
  const linkMode = choice(input, "linkMode", PRO_C_LINK_MODES);
  if (linkMode) sidechain.linkMode = linkMode;
  const note = choice(input, "note", PRO_C_SYNC_NOTES);
  const offset = number(input, "offset", 0.5, 2);
  const length = number(input, "length", 0.05, 1);
  if (note !== undefined || offset !== undefined || length !== undefined) sidechain.sync = { ...(note !== undefined && { note }), ...(offset !== undefined && { offset }), ...(length !== undefined && { length }) };
  if (Object.keys(sidechain).length) {
    next = updateProC(next, id, { sidechain });
    done.push(Object.keys(sidechain).join(", "));
  }
  if (!done.length) throw new Error("Nothing to change: give trigger, source, level, link, linkMode, or Host Sync's note, offset and length.");
  return { song: next, text: `Pro-C ${id}'s side chain: ${done.join("; ")}.\n${describeProC(next, { effect: id })}` };
}

/** set_pro_c_bands: the side chain EQ's bands, added, changed or removed. */
export function setProCBandsTool(song: MusicProject, input: Input): EditResult {
  const { effect } = findProCRef(song, input);
  const id = effect.id;
  let next = input.clear === true ? updateProC(song, id, { sidechain: { bands: [] } }) : song;
  const done: string[] = input.clear === true ? ["cleared its bands"] : [];
  if (input.bands !== undefined && !Array.isArray(input.bands)) throw new Error('"bands" must be a list of bands ({ shape, frequency, gain, q, slope, placement }; with "band" to change one).');
  for (const raw of (input.bands as unknown[] | undefined) ?? []) {
    const b = (raw && typeof raw === "object" ? raw : {}) as Input;
    const fields: Partial<Omit<EqBand, "id">> = {};
    const shape = choice(b, "shape", EQ_SHAPES);
    if (shape) fields.shape = shape as EqShape;
    const frequency = number(b, "frequency", 10, 30000);
    if (frequency !== undefined) fields.frequency = frequency;
    const gain = number(b, "gain", -30, 30);
    if (gain !== undefined) fields.gain = gain;
    const q = number(b, "q", 0.025, 40);
    if (q !== undefined) fields.q = q;
    if (b.slope !== undefined) {
      if (!EQ_SLOPES.includes(b.slope as EqSlope)) throw new Error(`"slope" must be one of: ${EQ_SLOPES.join(", ")}.`);
      fields.slope = b.slope as EqSlope;
    }
    const placement = choice(b, "placement", ["stereo", "mid", "side"] as const);
    if (placement) fields.placement = placement;
    if (typeof b.enabled === "boolean") fields.enabled = b.enabled;
    const bands = findProC(next, id)!.proC.sidechain.bands;
    if (b.band !== undefined) {
      const band = bands.find((x) => x.id === b.band);
      if (!band) throw new Error(`There's no side chain band ${String(b.band)}: it has ${bands.map((x) => x.id).join(", ") || "none"}.`);
      if (b.remove === true) {
        next = editSidechainBands(next, id, [band.id], null);
        done.push(`removed band ${band.id}`);
      } else {
        next = editSidechainBands(next, id, [band.id], (x) => ({ ...x, ...fields }));
        done.push(`band ${band.id}: ${Object.keys(fields).join(", ")}`);
      }
      continue;
    }
    if (fields.frequency === undefined) throw new Error('A new band needs its "frequency".');
    const added = addSidechainBand(next, id, { shape: "bell", slope: 12, q: 1, gain: 0, placement: "stereo", enabled: true, ...fields });
    if (added.id === null) throw new Error(`The side chain EQ has ${PRO_C_BANDS} bands already (its most): remove one first.`);
    next = added.song;
    done.push(`added band ${added.id} (${fields.shape ?? "bell"} at ${Math.round(fields.frequency)} Hz)`);
  }
  if (!done.length) throw new Error('Nothing to change: give "bands" (or "clear").');
  return { song: next, text: `Pro-C ${id}'s side chain EQ: ${done.join("; ")}.\n${describeProC(next, { effect: id })}` };
}

/** How hard each chain of add_vocal_compression is set: thresholds (dB) for light, medium and heavy. */
const AMOUNTS = { light: 0, medium: 1, heavy: 2 } as const;
const pick = (amount: number, list: [number, number, number]) => list[amount];

/**
 * add_vocal_compression: the engineers' vocal compression on a track in one step, in its first free slots
 * after an Auto-Tune or Pro-Q already there. `ids` are the Pro-Cs made (for its text and its tests).
 */
export function addVocalCompressionTool(song: MusicProject, input: Input, ids: string[] = []): EditResult {
  const track = findTrack(song, input.track);
  const kind = choice(input, "kind", ["twoStage", "tracking", "rough", "vox", "parallel"] as const) ?? "twoStage";
  const amount = AMOUNTS[choice(input, "amount", ["light", "medium", "heavy"] as const) ?? "medium"];
  const chain: { preset: string; patch: ProCPatch }[] =
    kind === "tracking"
      ? [{ preset: "Vocal – Tracking Opto", patch: { threshold: pick(amount, [-20, -24, -30]) } }]
      : kind === "rough"
        ? [{ preset: "Vocal – Rough Mix", patch: { threshold: pick(amount, [-22, -26, -32]) } }]
        : kind === "vox"
          ? [{ preset: "Vocal – Vox", patch: { threshold: pick(amount, [-12, -18, -26]) } }]
          : [
              { preset: "Vocal – FET Catch", patch: { threshold: pick(amount, [-18, -22, -28]) } },
              { preset: "Vocal – Opto Level", patch: { threshold: pick(amount, [-12, -16, -22]) } },
              ...(kind === "parallel" ? [{ preset: "Vocal – Parallel Crush", patch: {} }] : []),
            ];
  // After the tuning and EQ: the slot after the last Auto-Tune or Pro-Q, then the first free ones from there.
  const after = track.effects.reduce((last, e, i) => (e && (e.plugin.id === AUTO_TUNE_PLUGIN.id || e.plugin.id === PRO_Q_PLUGIN.id) ? i : last), -1);
  const free: number[] = [];
  for (let i = after + 1; i < EFFECT_SLOTS && free.length < chain.length; i++) if (!track.effects[i]) free.push(i);
  if (free.length < chain.length) throw new Error(`${trackLabel(song, track)} needs ${chain.length} free effect slot${chain.length === 1 ? "" : "s"} after its tuning and EQ, and has ${free.length}: free some with update_mixer_effect or add_mixer_effect.`);
  let next = song;
  const made: string[] = [];
  chain.forEach(({ preset, patch }, k) => {
    const id = ids[k] ?? createId("fx");
    next = setEffect(next, track.id, free[k], PRO_C_PLUGIN, id);
    next = chooseProCPreset(next, id, preset);
    if (Object.keys(patch).length) next = updateProC(next, id, patch);
    made.push(`${id} in slot ${free[k] + 1} (${preset})`);
  });
  const what =
    kind === "twoStage" || kind === "parallel"
      ? "FET 76 catching the peaks (4:1, attack 3, release 7), then Opto 2A levelling the phrase" + (kind === "parallel" ? ", and FET all buttons crushing under it (blend its Wet)" : "")
      : kind === "tracking"
        ? "one Opto Tube (the CL 1B's sound), zero latency"
        : kind === "rough"
          ? "one Vocal style, dense and upfront"
          : "Vox: one Compression fader, a ceiling";
  return {
    song: next,
    text: `On ${trackLabel(next, track)}: ${made.join(", ")}. ${what}. Aim for 3 to 6 dB of reduction on the loud words (get_pro_c reads it while it plays); update_pro_c changes any of them.`,
  };
}

/** A ratio said for the model, or ∞. */
export const describeRatio = (slope: number) => (Number.isFinite(ratioOf(slope)) ? round(ratioOf(slope), 2) : "∞");
