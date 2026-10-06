/**
 * The assistant's edits of links and the video's own signals (link_param, define_signal, delete_signal,
 * set_events): pure, like every edit tool (`edits.ts`), and saying what they did in terms the model can
 * check (how far a linked parameter moves, how often a signal is on, how many hits).
 */
import { type SignalReader, beatGridAt, countAt, createSignalReader, customSignalHits, customSignalLevel, resolveSource, sourceHits, withSignals } from "@shared/audio-signals";
import { atFrameRate, canExpress, effectValuesAt, setLink, storedValuesAt } from "@shared/effects";
import { createId } from "@shared/ids";
import {
  LINK_SIGNAL_NAMES,
  SIGNAL_COLORS,
  SIGNAL_ROLES,
  defineSignal,
  deleteSignal,
  findSignal,
  isHitSignal,
  normalizeLink,
  setSignalEvents,
} from "@shared/links";
import { isOnsetName } from "@shared/audio-signals";
import { errorMessage } from "@shared/errors";
import { projectDuration } from "@shared/timeline";
import type { Clip, ParamLink, Project, SignalDef, SignalEvent, SignalSource } from "@shared/types";
import { eventTimes } from "./describe-signals";
import type { EditEnv, EditOutcome } from "./edits";
import { type Input, ToolError, oneOf, optBoolean, optNumber, optObject, optString, range, secs, string, strings, value } from "./input";
import { clipOf, effectOf } from "./lookup";

const isObject = (v: unknown): v is Input => !!v && typeof v === "object" && !Array.isArray(v);

/** The video's signals, listed for a message. */
const signalList = (project: Project) => {
  const list = project.signals ?? [];
  return list.length ? `This video's signals: ${list.map((d) => `"${d.name}" (${d.id}, ${d.kind})`).join(", ")}.` : "This video has no signals of its own yet (define_signal makes one).";
};

/** A source named by the model, in `view`. */
function sourceOf(view: Project, text: string | number | undefined, self?: Clip): SignalSource {
  try {
    return resolveSource(view, text, self);
  } catch (err) {
    throw new ToolError(errorMessage(err));
  }
}

/** A reader of the video's sounds as `view` (edited) makes them, when the tab has them. */
const readerOf = (view: Project, env: EditEnv): SignalReader | null => (env.signals ? createSignalReader(env.signals.document(view), env.signals.store) : null);

const two = (v: number) => (Math.round(v * 100) / 100).toString();

// ---------------------------------------------------------------------------
// link_param
// ---------------------------------------------------------------------------

/** A link from the model's input, for a clip in `view` (`point`: a point parameter). */
function linkFrom(view: Project, raw: Input, clip: Clip, point: boolean): ParamLink {
  const name = typeof raw.signal === "string" ? raw.signal : "";
  if (!name) throw new ToolError("`link.signal` must name a signal.");
  const custom = LINK_SIGNAL_NAMES.includes(name) ? undefined : findSignal(view, name);
  if (!custom && !LINK_SIGNAL_NAMES.includes(name)) {
    throw new ToolError(`There's no signal "${name}". Built-in ones: ${LINK_SIGNAL_NAMES.join(", ")}. ${signalList(view)}`);
  }
  if (custom && raw.source !== undefined) throw new ToolError(`"${custom.name}" is one of the video's own signals: its source is its own (define_signal changes it), so leave out \`source\`.`);
  const source = custom ? undefined : sourceOf(view, typeof raw.source === "string" || typeof raw.source === "number" ? raw.source : undefined, clip);
  const mode = raw.mode ?? "add";
  if (mode !== "add" && mode !== "multiply" && mode !== "map") throw new ToolError('`link.mode` must be "add", "multiply" or "map".');
  const amount = mode === "map" ? (raw.amount ?? 0) : raw.amount;
  if (mode === "map" && raw.to === undefined) throw new ToolError("A map link needs `to`: the value at full signal.");
  const response = { threshold: raw.threshold, curve: raw.curve, attack: raw.attack, release: raw.release, invert: raw.invert };
  const hit = isObject(raw.hit) ? raw.hit : undefined;
  const link = normalizeLink(
    { signal: custom ? { id: custom.id } : { name, ...(source && source.kind !== "master" && { source }) }, mode, amount, to: raw.to, response, hit },
    point,
  );
  if (!link) throw new ToolError(`\`link.amount\` must be a number${point ? " or a point like [0.1, 0]" : ""}${mode === "map" ? " (and `to` too)" : ""}.`);
  if (hit && !custom && !isHitSignal(name)) throw new ToolError(`"${name}" isn't hits: \`hit\` is for onsets ("onset", "onsetLow"...), "beat", "downbeat" and events signals.`);
  return link;
}

/** How far a parameter moves over a clip: `0.8–1.3, highest at 12.4s`. */
function movement(reader: SignalReader, view: Project, clipId: string, effectId: string, key: string): string {
  const clip = clipOf(view, clipId);
  const effect = clip.effects.find((e) => e.id === effectId)!;
  const { def } = effectOf(clip, effectId);
  const n = 160;
  let lo: number[] | null = null;
  let hi: number[] | null = null;
  let peak = clip.in;
  let peakValue = -Infinity;
  withSignals(reader, () =>
    atFrameRate(view.settings.fps, () => {
      for (let i = 0; i < n; i++) {
        const s = clip.in + ((clip.out - clip.in) * (i + 0.5)) / n;
        const v = effectValuesAt(def, effect, s, clip)[key];
        const own = storedValuesAt(def, effect, s)[key];
        const parts = typeof v === "number" ? [v] : Array.isArray(v) ? (v as number[]) : [];
        const base = typeof own === "number" ? [own] : Array.isArray(own) ? (own as number[]) : [];
        if (!parts.length) continue;
        lo = lo ? lo.map((x, k) => Math.min(x, parts[k])) : [...parts];
        hi = hi ? hi.map((x, k) => Math.max(x, parts[k])) : [...parts];
        // Furthest from where it would be without the link.
        const size = parts.reduce((a, b, k) => a + Math.abs(b - (base[k] ?? 0)), 0);
        if (size > peakValue) {
          peakValue = size;
          peak = s;
        }
      }
    }),
  );
  if (!lo || !hi) return "";
  const [l, h] = [lo as number[], hi as number[]];
  const span = l.length === 1 ? `${value(l[0])}–${value(h[0])}` : `[${l.map(value).join(", ")}]–[${h.map(value).join(", ")}]`;
  const still = l.every((x, k) => Math.abs(h[k] - x) < 1e-6);
  const at = clip.start + (clip.reversed ? clip.out - peak : peak - clip.in) / (clip.speed ?? 1);
  return still ? `stays at ${span.split("–")[0]} (the signal is silent over it)` : `moves ${span}, furthest at ${secs(at)}s`;
}

export function linkParamTool(project: Project, input: Input, env: EditEnv): EditOutcome {
  const ids = strings(input, "clipIds");
  const effectId = string(input, "effect");
  const key = string(input, "param");
  const raw = input.link;
  if (raw !== null && !isObject(raw)) throw new ToolError("`link` must be an object, or null to unlink.");
  let p = project;
  const done: { id: string; effect: string }[] = [];
  for (const id of ids) {
    const clip = clipOf(p, id);
    const { effect, def } = effectOf(clip, effectId);
    const spec = def.params.find((s) => s.key === key);
    if (!spec) throw new ToolError(`${def.label} has no parameter "${key}". Its parameters: ${def.params.map((s) => s.key).join(", ")}.`);
    if (!canExpress(def, spec)) {
      const ok = def.params.filter((s) => canExpress(def, s)).map((s) => s.key);
      throw new ToolError(`${def.label} "${key}" can't be linked${ok.length ? ` (its numbers and points can: ${ok.join(", ")})` : " (none of its parameters can)"}.`);
    }
    p = setLink(p, id, effect.id, key, raw === null ? null : linkFrom(p, raw, clip, spec.kind === "vec2"));
    done.push({ id, effect: effect.id });
  }
  if (raw === null) return { project: p, text: p === project ? `${key} had no link.` : `Unlinked ${key} (${effectId}) of ${ids.join(", ")}.` };
  const reader = readerOf(p, env);
  const moves = reader
    ? done.map(({ id, effect }) => `${id} ${movement(reader, p, id, effect, key)}`).join("; ")
    : "(the sound isn't loaded, so how far it moves isn't known yet)";
  return { project: p, text: `${key} (${effectId}) now follows ${typeof raw.signal === "string" ? `"${raw.signal}"` : "the signal"}: ${moves}.` };
}

// ---------------------------------------------------------------------------
// define_signal, delete_signal
// ---------------------------------------------------------------------------

/** What a signal does over the main timeline, for the model: how often it's on, its hits. */
function signalReport(reader: SignalReader, def: SignalDef): string {
  const length = projectDuration(reader.document);
  if (!(length > 0)) return "";
  const step = Math.max(0.05, length / 4000);
  let sum = 0;
  let on = 0;
  let max = 0;
  let count = 0;
  for (let t = 0; t < length; t += step, count++) {
    const v = withSignals(reader, () => customSignalLevel(reader, def, null, t));
    sum += v;
    max = Math.max(max, v);
    if (v > 0.5) on++;
  }
  const parts = [`over the video it averages ${two(sum / Math.max(1, count))}, peaks at ${two(max)}, is over 0.5 ${Math.round((on / Math.max(1, count)) * 100)}% of the time`];
  const hits = customSignalHits(reader, def, 0, length);
  if (def.kind === "events" || (def.kind === "band" && def.onsets)) {
    parts.push(`${hits.length} hits${hits.length ? `: ${hits.slice(0, 24).map(([t]) => secs(t)).join(", ")}${hits.length > 24 ? ", …" : ""}` : ""}`);
  }
  return parts.join("; ");
}

export function defineSignalTool(project: Project, input: Input, env: EditEnv): EditOutcome {
  const which = optString(input, "signal");
  const existing = which ? findSignal(project, which) : undefined;
  if (which && !existing) throw new ToolError(`There's no signal "${which}". ${signalList(project)}`);
  const name = string(input, "name").trim();
  const clash = findSignal(project, name);
  if (clash && clash.id !== existing?.id) throw new ToolError(`There's already a signal "${clash.name}" (${clash.id}): give \`signal: "${clash.id}"\` to change it, or another name.`);
  const kind = oneOf(input, "kind", ["band", "events", "curve"] as const) ?? existing?.kind;
  if (!kind) throw new ToolError('Give `kind`: "band" (frequencies of a sound), "events" (hits) or "curve".');
  const keep = existing && existing.kind === kind ? existing : undefined;
  const raw: Record<string, unknown> = {
    ...(keep ?? {}),
    id: existing?.id ?? createId("sig"),
    name,
    kind,
    color: optString(input, "color") ?? existing?.color ?? SIGNAL_COLORS[(project.signals?.length ?? 0) % SIGNAL_COLORS.length],
  };
  const role = oneOf(input, "role", SIGNAL_ROLES);
  if (role) raw.role = role;
  if (kind === "band") {
    const source = optString(input, "source");
    if (source !== undefined) raw.source = sourceOf(project, source);
    for (const field of ["low", "high", "gain", "threshold", "attack", "release", "curve"]) {
      const v = optNumber(input, field);
      if (v !== undefined) raw[field] = v;
    }
    for (const field of ["autoGain", "onsets"]) {
      const v = optBoolean(input, field);
      if (v !== undefined) raw[field] = v;
    }
    if (!keep && (raw.low === undefined || raw.high === undefined)) throw new ToolError("A band needs `low` and `high` (Hz): a kick is about 40–120, a snare's crack 2000–5000, hats 8000–16000.");
  }
  if (kind === "events" && input.events !== undefined) raw.events = input.events;
  if (kind === "curve" && input.points !== undefined) raw.points = input.points;
  const p = defineSignal(project, raw as SignalDef);
  const def = p.signals?.find((d) => d.id === raw.id);
  if (!def) throw new ToolError(`The video has as many signals as it can hold. ${signalList(project)}`);
  const what =
    def.kind === "band"
      ? `a band, ${def.low}–${def.high} Hz of ${def.source.kind === "master" ? "the mix" : def.source.kind === "track" ? `track ${def.source.trackId}` : `clip ${def.source.clipId}`}${def.onsets ? ", with onsets" : ""}`
      : def.kind === "events"
        ? `${def.events.length} hits`
        : `a curve of ${def.points.length} points`;
  const reader = readerOf(p, env);
  const report = reader ? signalReport(reader, def) : "";
  return { project: p, text: `${existing ? "Changed" : "Made"} "${def.name}" (${def.id}): ${what}${report ? `; ${report}` : ""}.` };
}

export function deleteSignalTool(project: Project, input: Input): EditOutcome {
  let p = project;
  const gone: string[] = [];
  for (const name of strings(input, "signals")) {
    const def = findSignal(p, name);
    if (!def) throw new ToolError(`There's no signal "${name}". ${signalList(p)}`);
    p = deleteSignal(p, def.id);
    gone.push(`"${def.name}"`);
  }
  return { project: p, text: `Deleted ${gone.join(", ")}, and the links to ${gone.length === 1 ? "it" : "them"}.` };
}

// ---------------------------------------------------------------------------
// set_events
// ---------------------------------------------------------------------------

/** Events from the model's list. */
function eventsFrom(raw: unknown): SignalEvent[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((e) => !isObject(e) || typeof e.time !== "number")) throw new ToolError("`add` must be a list of { time, velocity?, length?, key? }.");
  return raw.map((e: Input) => ({ time: e.time as number, velocity: typeof e.velocity === "number" ? e.velocity : 1, ...(typeof e.length === "number" && { length: e.length }), ...(typeof e.key === "number" && { key: e.key }) }));
}

/** A time snapped to `divisions` of the beat playing then. */
function quantized(reader: SignalReader, t: number, divisions: number): number {
  const grid = beatGridAt(reader, null, t);
  if (!grid || grid.beats.length < 2) throw new ToolError(`There's no beat at ${secs(t)}s to quantise to (get_signals shows where the song's beat is).`);
  const beats = grid.beats;
  const at = Math.round(countAt(beats, t) * divisions) / divisions;
  const i = Math.max(0, Math.min(beats.length - 2, Math.floor(at)));
  return beats[i] + (at - i) * (beats[i + 1] - beats[i]);
}

export function setEventsTool(project: Project, input: Input, env: EditEnv): EditOutcome {
  const which = string(input, "signal");
  let def = findSignal(project, which);
  if (def && def.kind !== "events") throw new ToolError(`"${def.name}" is a ${def.kind} signal: set_events edits events signals. ${signalList(project)}`);
  let p = project;
  if (!def) {
    const id = createId("sig");
    p = defineSignal(p, { id, name: which, color: SIGNAL_COLORS[(p.signals?.length ?? 0) % SIGNAL_COLORS.length], kind: "events", events: [] });
    def = p.signals?.find((d) => d.id === id);
    if (!def) throw new ToolError(`The video has as many signals as it can hold. ${signalList(project)}`);
  }
  let events = def.kind === "events" ? [...def.events] : [];
  if (optBoolean(input, "clear")) events = [];
  const remove = optObject(input, "remove");
  if (remove) {
    const [from, to] = [Number(remove.from), Number(remove.to)];
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new ToolError("`remove` needs `from` and `to`.");
    events = events.filter((e) => e.time < Math.min(from, to) || e.time > Math.max(from, to));
  }
  events.push(...eventsFrom(input.add));
  const at = oneOf(input, "at", ["beats", "bars", "drops", "onset", "onsetLow", "onsetMid", "onsetHigh"] as const);
  const divisions = optNumber(input, "quantize", { min: 1, max: 16 });
  const reader = at || divisions ? readerOf(p, env) : null;
  if ((at || divisions) && !reader) throw new ToolError("The video's sound isn't loaded, so `at` and `quantize` can't be used yet.");
  if (at && reader) {
    const length = projectDuration(reader.document);
    const from = optNumber(input, "from", { min: 0 }) ?? 0;
    const to = optNumber(input, "to", { min: 0 }) ?? length;
    const source = sourceOf(reader.document, optString(input, "source"));
    const every = Math.max(1, Math.round(optNumber(input, "every", { min: 1 }) ?? 1));
    const velocity = optNumber(input, "velocity", { min: 0, max: 1 });
    const found: [number, number][] = isOnsetName(at)
      ? sourceHits(reader, null, source, at).filter(([t]) => t >= from && t <= to)
      : eventTimes(reader, null, source, at, from, to).map((t) => [t, 1]);
    if (!found.length) throw new ToolError(`There are no ${at} between ${secs(from)}s and ${secs(to)}s. Look at get_signals.`);
    events.push(...found.filter((_, i) => i % every === 0).map(([time, v]) => ({ time, velocity: velocity ?? v })));
  }
  if (divisions && reader) events = events.map((e) => ({ ...e, time: Math.max(0, quantized(reader, e.time, Math.round(divisions))) }));
  p = setSignalEvents(p, def.id, events);
  const after = p.signals?.find((d) => d.id === def.id);
  const list = after?.kind === "events" ? after.events : [];
  const span = list.length ? ` (${range(list[0].time, list.at(-1)!.time)}s)` : "";
  return { project: p, text: `"${def.name}" (${def.id}) has ${list.length} hit${list.length === 1 ? "" : "s"}${span}.` };
}
