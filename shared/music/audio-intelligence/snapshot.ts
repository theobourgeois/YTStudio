/**
 * Snapshots (`types.ts`): the song as it was, by hash. `buildSnapshot` is pure: the server reads the files
 * (media, plugins' state) and hands their hashes in, so the tab could build the same record from the same
 * inputs. A capture says what it couldn't see (`coverage`) rather than looking complete.
 */
import { hashJson } from "../hash.ts";
import type { Automation, Channel, MixerEffect, MusicProject } from "../types.ts";
import {
  AUDIO_INTELLIGENCE_SCHEMA,
  COVERAGE_ASPECTS,
  COVERAGE_STATUSES,
  SNAPSHOT_PARTS,
  type CaptureProvenance,
  type CoverageEntry,
  type MediaRef,
  type MixSnapshot,
  type PluginStateRef,
  type RenderSettings,
  type SnapshotCoverage,
  type SnapshotPart,
  type Timing,
} from "./types.ts";
import {
  Problems,
  array,
  boolean,
  contentId,
  hash,
  nullableHash,
  nullableNumber,
  number,
  object,
  oneOf,
  optionalString,
  string,
  stringList,
  toValidation,
  unique,
  type Validation,
} from "./validation.ts";

export type SnapshotContent = Pick<MusicProject, SnapshotPart>;

/** What the server found when it looked for a file: nothing is assumed about one it couldn't read. */
export interface FileFacts {
  status: "hashed" | "missing" | "unreadable";
  sha256: string | null;
  bytes: number | null;
}

export interface SnapshotInputs {
  projectId: string;
  /** A normalised song (`normalizeMusicProject`): the snapshot is of what the engine would be given. */
  document: MusicProject;
  /** By media id: every sample id the song plays. A missing key is `missing`. */
  media: Readonly<Record<string, FileFacts>>;
  /** By channel or effect id: the plugin's state file. A missing key is `absent`. */
  pluginStates: Readonly<Record<string, FileFacts>>;
  /** By channel or effect id: the plugin's version, where the engine could say. A missing key is unknown. */
  pluginVersions?: Readonly<Record<string, string>>;
  render: RenderSettings;
  capture: CaptureProvenance;
  /** Epoch milliseconds. */
  now: number;
}

/** A snapshot with the content it hashes: the document's musical parts, stored beside it so a render can be repeated. */
export interface SnapshotBundle {
  snapshot: MixSnapshot;
  content: SnapshotContent;
}

/** What identifies a snapshot: everything but when it was made and where from. */
const NOT_IDENTITY = ["createdAt", "capture"] as const;

/** The parts of a song a snapshot hashes. The name and version are left out: renaming a song changes no sound. */
export function snapshotContent(doc: MusicProject): SnapshotContent {
  return {
    settings: doc.settings,
    channels: doc.channels,
    patterns: doc.patterns,
    playlist: doc.playlist,
    mixer: doc.mixer,
    automations: doc.automations,
    modulators: doc.modulators,
  };
}

/** The hash of each part and of the lot. */
export function documentHashes(content: SnapshotContent): MixSnapshot["document"] {
  const parts = Object.fromEntries(SNAPSHOT_PARTS.map((part) => [part, hashJson(content[part])])) as Record<SnapshotPart, string>;
  return { sha256: hashJson(parts), parts };
}

/** Which of our own effects this is: its settings are in the song, so there's no state file. */
export const BUILT_IN_SETTINGS = ["grossBeat", "echoBoy", "autoTune", "proQ", "ott", "proC", "panMan", "pitchWheel", "reverb"] as const;
export const isBuiltInEffect = (effect: MixerEffect): boolean => BUILT_IN_SETTINGS.some((key) => effect[key] !== undefined);

/** Each media id the song plays and the channels that play it, sorted by id. */
export function mediaUses(doc: MusicProject): { id: string; channels: string[] }[] {
  const uses = new Map<string, string[]>();
  for (const channel of doc.channels) if (channel.sampleId) uses.set(channel.sampleId, [...(uses.get(channel.sampleId) ?? []), channel.id]);
  return [...uses].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, channels]) => ({ id, channels }));
}

/** Every plugin in the song, in the rack's then the mixer's order: the instruments, then each track's effects. */
export function pluginOwners(doc: MusicProject): { owner: PluginStateRef["owner"]; plugin: PluginStateRef["plugin"]; builtIn: boolean }[] {
  const owners: ReturnType<typeof pluginOwners> = [];
  for (const channel of doc.channels as Channel[]) if (channel.plugin) owners.push({ owner: { kind: "channel", id: channel.id }, plugin: pluginOf(channel.plugin), builtIn: false });
  for (const track of doc.mixer.tracks)
    for (const effect of track.effects) if (effect) owners.push({ owner: { kind: "effect", id: effect.id }, plugin: pluginOf(effect.plugin), builtIn: isBuiltInEffect(effect) });
  return owners;
}

const pluginOf = (plugin: { id: string; name: string; format: string }) => ({ id: plugin.id, name: plugin.name, format: plugin.format, version: null });

/** How the song keeps time; an automation clip on the tempo that's on the playlist moves it. */
export function timingOf(doc: MusicProject): Timing {
  const tempoClips = new Set(doc.automations.filter((a: Automation) => a.target.kind === "tempo").map((a) => a.id));
  const tempoAutomated = doc.playlist.clips.some((clip) => clip.kind === "automation" && tempoClips.has(clip.ref));
  return { tempo: doc.settings.tempo, timeSignature: [doc.settings.timeSignature[0], doc.settings.timeSignature[1]], swing: doc.settings.swing, tempoAutomated };
}

/** What a capture saw and didn't, from what the server found. Nothing here guesses: a file it couldn't read is a gap. */
export function coverageOf(media: readonly MediaRef[], plugins: readonly PluginStateRef[], capture: CaptureProvenance): SnapshotCoverage {
  const captured: CoverageEntry = { status: "captured" };
  const document: CoverageEntry =
    capture.origin === "saved-document" && capture.unsavedEdits === true
      ? { status: "partial", note: "The song was captured from its saved file while the tab had edits that weren't saved yet: capture it from the tab to include them." }
      : captured;

  const files = plugins.filter((p) => p.storage === "file");
  return {
    document,
    media: tally(
      media.length,
      media.filter((m) => m.status === "hashed").length,
      "Some of the song's media couldn't be read, so a change to them wouldn't be noticed.",
    ),
    routing: captured,
    automation: captured,
    builtInEffects: plugins.some((p) => p.storage === "document") ? captured : { status: "notApplicable" },
    pluginIdentity: tally(
      files.length,
      files.filter((p) => p.plugin.version !== null).length,
      "A plugin's version and binary aren't recorded, so its saved state may not sound the same after an update, or on another computer.",
    ),
    pluginState: tally(
      files.length,
      files.filter((p) => p.state === "hashed").length,
      "Some plugins have no settings file yet (they're at their defaults, or what was set hasn't been saved) or it couldn't be read. A plugin's state is opaque: it can be restored, not read.",
      PLUGIN_STATE_LAGS,
    ),
    renderSettings: captured,
  };
}

/**
 * The engine writes a plugin's state to its file every few seconds (and on removal and quit), and a render
 * uses the live plugin: a setting changed in the last few seconds may not be in the file yet.
 */
const PLUGIN_STATE_LAGS = "A plugin's file is written every few seconds, so a setting changed just before the capture may not be in it.";

/** `notApplicable` with nothing to capture, `captured` (with `whenAll`'s caveat) with all of it, else `partial` (`unavailable` when none). */
function tally(total: number, got: number, note: string, whenAll?: string): CoverageEntry {
  if (total === 0) return { status: "notApplicable" };
  if (got === total) return whenAll ? { status: "captured", note: whenAll } : { status: "captured" };
  return { status: got === 0 ? "unavailable" : "partial", note };
}

const complete = (coverage: SnapshotCoverage): MixSnapshot["completeness"] =>
  COVERAGE_ASPECTS.every((aspect) => coverage[aspect].status === "captured" || coverage[aspect].status === "notApplicable") ? "complete" : "partial";

/** The id a snapshot must have: a hash of everything but when it was made and where from. */
export const snapshotId = (snapshot: Omit<MixSnapshot, "id">): string => contentId("snap", snapshot, NOT_IDENTITY);

/** Builds the record for a song and the facts found about its files. Deterministic: the same inputs give the same id. */
export function buildSnapshot(inputs: SnapshotInputs): SnapshotBundle {
  // A copy: the bundle is stored as it was, whatever happens to the song after.
  const content = structuredClone(snapshotContent(inputs.document));
  const media: MediaRef[] = mediaUses(inputs.document).map(({ id, channels }) => {
    const found = inputs.media[id] ?? { status: "missing", sha256: null, bytes: null };
    return { id, channels, ...clean(found) };
  });
  const plugins: PluginStateRef[] = pluginOwners(inputs.document).map(({ owner, plugin: unversioned, builtIn }) => {
    const plugin = { ...unversioned, version: inputs.pluginVersions?.[owner.id] ?? null };
    if (builtIn) return { owner, plugin, storage: "document", state: "inDocument", sha256: null, bytes: null };
    const found = inputs.pluginStates[owner.id];
    if (!found) return { owner, plugin, storage: "file", state: "absent", sha256: null, bytes: null };
    const { status, sha256, bytes } = clean(found);
    return { owner, plugin, storage: "file", state: status === "missing" ? "absent" : status, sha256, bytes };
  });
  const coverage = coverageOf(media, plugins, inputs.capture);
  const record: Omit<MixSnapshot, "id"> = {
    schema: AUDIO_INTELLIGENCE_SCHEMA,
    projectId: inputs.projectId,
    createdAt: inputs.now,
    capture: inputs.capture,
    document: documentHashes(content),
    timing: timingOf(inputs.document),
    media,
    plugins,
    render: inputs.render,
    coverage,
    completeness: complete(coverage),
  };
  return { snapshot: { ...record, id: snapshotId(record) }, content };
}

/** A file that wasn't hashed has no hash, whatever the caller put there. */
function clean(facts: FileFacts): FileFacts {
  return facts.status === "hashed" ? { status: "hashed", sha256: facts.sha256, bytes: facts.bytes } : { status: facts.status, sha256: null, bytes: null };
}

// ---------------------------------------------------------------------------------------------------------
// What changed

export interface SnapshotDiff {
  identical: boolean;
  /** Parts of the document that differ. */
  parts: SnapshotPart[];
  /** Media ids whose file differs, appeared or went. */
  media: string[];
  /** Owners (channel or effect ids) of plugins whose state, or whose presence, differs. */
  plugins: string[];
  /** The render settings differ. */
  render: boolean;
}

/**
 * What differs between two snapshots, which is what a stale check needs: accepting a change made against `base`
 * is safe when what it touches is the same in `current`. The song's name, when the capture was made and where
 * from are not differences.
 */
export function diffSnapshots(base: MixSnapshot, current: MixSnapshot): SnapshotDiff {
  const parts = SNAPSHOT_PARTS.filter((part) => base.document.parts[part] !== current.document.parts[part]);
  const media = differing(base.media, current.media, (m) => m.id, (m) => `${m.status}:${m.sha256}`);
  const plugins = differing(base.plugins, current.plugins, (p) => p.owner.id, (p) => `${p.plugin.id}:${p.plugin.version}:${p.state}:${p.sha256}`);
  const render = hashJson(base.render) !== hashJson(current.render);
  return { identical: parts.length + media.length + plugins.length === 0 && !render, parts, media, plugins, render };
}

function differing<T>(a: readonly T[], b: readonly T[], key: (item: T) => string, value: (item: T) => string): string[] {
  const before = new Map(a.map((item) => [key(item), value(item)]));
  const after = new Map(b.map((item) => [key(item), value(item)]));
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k)).sort();
}

/** Whether `content` is what `snapshot` hashed: a stored bundle that was changed, or mixed up with another, fails. */
export function contentMatches(snapshot: MixSnapshot, content: SnapshotContent): boolean {
  const { sha256, parts } = documentHashes(content);
  return sha256 === snapshot.document.sha256 && SNAPSHOT_PARTS.every((part) => parts[part] === snapshot.document.parts[part]);
}

// ---------------------------------------------------------------------------------------------------------
// Reading one off the disk

/** Checks a snapshot read from a manifest. It must be what its own id says it is. */
export function validateSnapshot(input: unknown): Validation<MixSnapshot> {
  const p = new Problems();
  const o = object(input, "", p);
  if (o.schema !== AUDIO_INTELLIGENCE_SCHEMA) p.add("schema", `must be ${AUDIO_INTELLIGENCE_SCHEMA}`);

  const capture = object(o.capture, "capture", p);
  const doc = object(o.document, "document", p);
  const partsIn = object(doc.parts, "document.parts", p);
  const parts = Object.fromEntries(SNAPSHOT_PARTS.map((part) => [part, hash(partsIn[part], `document.parts.${part}`, p)])) as Record<SnapshotPart, string>;
  const documentSha = hash(doc.sha256, "document.sha256", p);
  if (!p.any && hashJson(parts) !== documentSha) p.add("document.sha256", "is not the hash of its parts");

  const timing = object(o.timing, "timing", p);
  const signature = array(timing.timeSignature, "timing.timeSignature", p, 2);
  if (signature.length !== 2) p.add("timing.timeSignature", "must be [beats, unit]");

  const media = array(o.media, "media", p).map((item, i): MediaRef => {
    const at = `media[${i}]`;
    const m = object(item, at, p);
    const status = oneOf(m.status, ["hashed", "missing", "unreadable"], `${at}.status`, p);
    const sha256 = nullableHash(m.sha256, `${at}.sha256`, p);
    const bytes = nullableNumber(m.bytes, `${at}.bytes`, p, { min: 0, int: true });
    if (status === "hashed" && (sha256 === null || bytes === null)) p.add(at, "is hashed but has no hash or size");
    if (status !== "hashed" && (sha256 !== null || bytes !== null)) p.add(at, `is ${status} but has a hash or size`);
    return { id: string(m.id, `${at}.id`, p, { nonEmpty: true }), channels: stringList(m.channels, `${at}.channels`, p), status, sha256, bytes };
  });
  unique(media, (m) => m.id, "media", p);

  const plugins = array(o.plugins, "plugins", p).map((item, i): PluginStateRef => {
    const at = `plugins[${i}]`;
    const x = object(item, at, p);
    const owner = object(x.owner, `${at}.owner`, p);
    const plugin = object(x.plugin, `${at}.plugin`, p);
    const storage = oneOf(x.storage, ["file", "document"], `${at}.storage`, p);
    const state = oneOf(x.state, ["hashed", "absent", "unreadable", "inDocument"], `${at}.state`, p);
    const sha256 = nullableHash(x.sha256, `${at}.sha256`, p);
    const bytes = nullableNumber(x.bytes, `${at}.bytes`, p, { min: 0, int: true });
    if (storage === "document" && state !== "inDocument") p.add(at, "keeps its settings in the document, so its state is inDocument");
    if (storage === "file" && state === "inDocument") p.add(at, "has a state file, so it can't be inDocument");
    if (state === "hashed" ? sha256 === null || bytes === null : sha256 !== null || bytes !== null) p.add(at, "has a hash exactly when its state is hashed");
    return {
      owner: { kind: oneOf(owner.kind, ["channel", "effect"], `${at}.owner.kind`, p), id: string(owner.id, `${at}.owner.id`, p, { nonEmpty: true }) },
      plugin: {
        id: string(plugin.id, `${at}.plugin.id`, p),
        name: string(plugin.name, `${at}.plugin.name`, p),
        format: string(plugin.format, `${at}.plugin.format`, p),
        version: plugin.version === null ? null : string(plugin.version, `${at}.plugin.version`, p),
      },
      storage,
      state,
      sha256,
      bytes,
    };
  });
  unique(plugins, (x) => `${x.owner.kind}:${x.owner.id}`, "plugins", p);

  const render = object(o.render, "render", p);
  const coverageIn = object(o.coverage, "coverage", p);
  const coverage = Object.fromEntries(
    COVERAGE_ASPECTS.map((aspect) => {
      const entry = object(coverageIn[aspect], `coverage.${aspect}`, p);
      const note = optionalString(entry.note, `coverage.${aspect}.note`, p);
      const status = oneOf(entry.status, COVERAGE_STATUSES, `coverage.${aspect}.status`, p);
      return [aspect, note === undefined ? { status } : { status, note }];
    }),
  ) as SnapshotCoverage;

  const completeness = oneOf(o.completeness, ["complete", "partial"], "completeness", p);
  if (!p.any && completeness !== complete(coverage)) p.add("completeness", `must be ${complete(coverage)}, as its coverage says`);

  const snapshot: MixSnapshot = {
    schema: AUDIO_INTELLIGENCE_SCHEMA,
    id: string(o.id, "id", p, { nonEmpty: true }),
    projectId: string(o.projectId, "projectId", p, { nonEmpty: true }),
    createdAt: number(o.createdAt, "createdAt", p, { min: 0 }),
    capture: {
      origin: oneOf(capture.origin, ["saved-document", "live-document"], "capture.origin", p),
      unsavedEdits: capture.unsavedEdits === null ? null : boolean(capture.unsavedEdits, "capture.unsavedEdits", p),
      ...(capture.editCount === undefined ? {} : { editCount: number(capture.editCount, "capture.editCount", p, { min: 0, int: true }) }),
    },
    document: { sha256: documentSha, parts },
    timing: {
      tempo: number(timing.tempo, "timing.tempo", p, { min: 1 }),
      timeSignature: [number(signature[0], "timing.timeSignature[0]", p, { min: 1, int: true }), number(signature[1], "timing.timeSignature[1]", p, { min: 1, int: true })],
      swing: number(timing.swing, "timing.swing", p, { min: 0, max: 1 }),
      tempoAutomated: boolean(timing.tempoAutomated, "timing.tempoAutomated", p),
    },
    media,
    plugins,
    render: {
      sampleRate: number(render.sampleRate, "render.sampleRate", p, { min: 8000, max: 384000, int: true }),
      channelLayout: oneOf(render.channelLayout, ["stereo"], "render.channelLayout", p),
      resampling: oneOf(render.resampling, ["linear", "hermite", "sinc"], "render.resampling", p),
      mode: oneOf(render.mode, ["pattern", "song"], "render.mode", p),
      engineVersion: render.engineVersion === null ? null : string(render.engineVersion, "render.engineVersion", p),
    },
    coverage,
    completeness,
  };
  if (!p.any && snapshot.id !== snapshotId(snapshot)) p.add("id", "is not the hash of what the snapshot holds");
  return toValidation(p, snapshot);
}
