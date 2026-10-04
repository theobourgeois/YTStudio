/**
 * Audio artifacts (`types.ts`): rendered or registered audio, by the hash of its bytes and where it came from.
 * Audio is never named by a path the model could make up: it's a registered artifact, with its permissions.
 */
import {
  ARTIFACT_ROLES,
  AUDIO_INTELLIGENCE_SCHEMA,
  SAMPLE_FORMATS,
  type ArtifactRole,
  type ArtifactTransform,
  type AudioArtifact,
  type AudioFormat,
  type PassageTime,
  type RenderFacts,
  type UsePermissions,
} from "./types.ts";
import {
  Problems,
  array,
  boolean,
  contentId,
  hash,
  nullableNumber,
  number,
  object,
  oneOf,
  string,
  toValidation,
  type Validation,
} from "./validation.ts";

/** What isn't identity: when it was made and by which job (a retry makes the same artifact). */
const NOT_IDENTITY = ["createdAt", "jobId"] as const;

/** Roles that are a render of a song, and so name the snapshot they were rendered from. */
const RENDERED: readonly ArtifactRole[] = ["mix", "track-stem", "bus-stem", "candidate-render"];

export const artifactId = (artifact: Omit<AudioArtifact, "id">): string => contentId("art", artifact, NOT_IDENTITY);

export type NewArtifact = Omit<AudioArtifact, "schema" | "id">;

/** Makes the record, with the id its content gives it. */
export function createArtifact(input: NewArtifact): AudioArtifact {
  const record = { schema: AUDIO_INTELLIGENCE_SCHEMA, ...input } as Omit<AudioArtifact, "id">;
  return { ...record, id: artifactId(record) };
}

/** Frames of the artifact (lead-in and tail included) → seconds. */
export const framesToSeconds = (artifact: Pick<AudioArtifact, "format">, frames: number): number => frames / artifact.format.sampleRate;

/** The frames that are the passage itself: after the lead-in, before the tail. Null for a whole file. */
export function passageFrames(artifact: Pick<AudioArtifact, "format" | "passage">): { first: number; end: number } | null {
  const { passage, format } = artifact;
  return passage ? { first: passage.leadInFrames, end: format.frames - passage.tailFrames } : null;
}

/** The passage's length in seconds, or the whole file's. */
export function passageSeconds(artifact: Pick<AudioArtifact, "format" | "passage">): number {
  const range = passageFrames(artifact);
  return range ? (range.end - range.first) / artifact.format.sampleRate : artifact.format.frames / artifact.format.sampleRate;
}

/**
 * Where a frame of the artifact is in the song, in seconds from its start: so a measurement or an observation can be
 * pointed at the song. It's the song's own clock: a tempo clip on the playlist warps ticks, not seconds of audio, and
 * this doesn't undo that (`Timing.tempoAutomated` says when it matters). Null for audio that isn't a passage of a song.
 */
export function frameToSongSeconds(artifact: Pick<AudioArtifact, "format" | "passage">, frame: number): number | null {
  const { passage, format } = artifact;
  return passage ? passage.startSeconds + (frame - passage.leadInFrames) / format.sampleRate : null;
}

/** Whether the audio is as it was rendered, or at least as sampled and as wide: nothing resampled, mixed down or encoded since. */
export const isFullResolution = (artifact: Pick<AudioArtifact, "transforms">): boolean =>
  !artifact.transforms.some((t) => t.kind === "resample" || t.kind === "downmix" || t.kind === "encode");

/** What a use needs, said for an error message. */
const USES = {
  localAnalysis: "analysed on this computer",
  hostedAnalysis: "sent to a hosted service",
  retrievalDisplay: "shown as an example",
  training: "used for training",
} as const satisfies Record<keyof UsePermissions, string>;

/** Null when it may be used so, else why not. */
export function useError(artifact: Pick<AudioArtifact, "id" | "permissions">, use: keyof UsePermissions): string | null {
  return artifact.permissions[use] ? null : `Artifact ${artifact.id} may not be ${USES[use]}: its permissions don't allow it.`;
}

export interface Derivation {
  transform: ArtifactTransform;
  contentSha256: string;
  bytes: number;
  /** The new format, which has to agree with the transform (a resample's new rate...). */
  format: AudioFormat;
  jobId: string | null;
  now: number;
}

/**
 * A copy made from an artifact (resampled for a provider, mixed down...): its parent's provenance with the transform
 * added, so what was changed is on the record. A copy can never be allowed more than its parent was.
 */
export function deriveArtifact(parent: AudioArtifact, derivation: Derivation): AudioArtifact {
  const { transform, format } = derivation;
  return createArtifact({
    contentSha256: derivation.contentSha256,
    bytes: derivation.bytes,
    role: parent.role,
    format,
    snapshotId: parent.snapshotId,
    tap: parent.tap,
    passage: parent.passage && shiftedPassage(parent, transform, format),
    render: parent.render,
    derivedFrom: parent.id,
    transforms: [...parent.transforms, transform],
    jobId: derivation.jobId,
    recordingFamilyId: parent.recordingFamilyId,
    permissions: { ...parent.permissions },
    createdAt: derivation.now,
  });
}

/** A passage's frame counts follow a resample or a trim; the song's time doesn't move. */
function shiftedPassage(parent: AudioArtifact, transform: ArtifactTransform, format: AudioFormat): PassageTime {
  const passage = parent.passage as PassageTime;
  if (transform.kind === "resample") {
    const ratio = transform.toRate / transform.fromRate;
    return { ...passage, leadInFrames: Math.round(passage.leadInFrames * ratio), tailFrames: Math.round(passage.tailFrames * ratio) };
  }
  if (transform.kind === "trim") {
    // Frames cut off the front shorten the lead-in first, then take from the passage (moving where it starts).
    const cutFront = transform.fromFrame;
    const fromLead = Math.min(cutFront, passage.leadInFrames);
    const intoPassage = cutFront - fromLead;
    const cutBack = Math.max(0, parent.format.frames - transform.toFrame);
    const fromTail = Math.min(cutBack, passage.tailFrames);
    return {
      ...passage,
      startSeconds: passage.startSeconds + intoPassage / parent.format.sampleRate,
      leadInFrames: passage.leadInFrames - fromLead,
      tailFrames: Math.min(passage.tailFrames - fromTail, format.frames),
    };
  }
  return passage;
}

// ---------------------------------------------------------------------------------------------------------
// Reading one off the disk

const TRANSFORM_KINDS = ["resample", "downmix", "gain", "trim", "encode"] as const;

function readTransform(input: unknown, at: string, p: Problems): ArtifactTransform {
  const o = object(input, at, p);
  const kind = oneOf(o.kind, TRANSFORM_KINDS, `${at}.kind`, p);
  switch (kind) {
    case "resample":
      return { kind, fromRate: number(o.fromRate, `${at}.fromRate`, p, { min: 1, int: true }), toRate: number(o.toRate, `${at}.toRate`, p, { min: 1, int: true }) };
    case "downmix":
      return { kind, toChannels: number(o.toChannels, `${at}.toChannels`, p, { min: 1, int: true }) };
    case "gain":
      return { kind, db: number(o.db, `${at}.db`, p) };
    case "trim":
      return { kind, fromFrame: number(o.fromFrame, `${at}.fromFrame`, p, { min: 0, int: true }), toFrame: number(o.toFrame, `${at}.toFrame`, p, { min: 0, int: true }) };
    case "encode":
      return { kind, codec: string(o.codec, `${at}.codec`, p, { nonEmpty: true }) };
  }
}

function readRender(input: unknown, p: Problems): RenderFacts | null {
  if (input === null) return null;
  const o = object(input, "render", p);
  const tail = o.tail === null ? null : object(o.tail, "render.tail", p);
  return {
    start: oneOf(o.start, ["cold", "warm"], "render.start", p),
    blockSize: nullableNumber(o.blockSize, "render.blockSize", p, { min: 1, int: true }),
    latencySeconds: nullableNumber(o.latencySeconds, "render.latencySeconds", p, { min: 0 }),
    tail: tail && { mode: string(tail.mode, "render.tail.mode", p), maxSeconds: nullableNumber(tail.maxSeconds, "render.tail.maxSeconds", p, { min: 0 }) },
    plugins: array(o.plugins, "render.plugins", p).map((item, i) => {
      const x = object(item, `render.plugins[${i}]`, p);
      return { ownerId: string(x.ownerId, `render.plugins[${i}].ownerId`, p, { nonEmpty: true }), load: oneOf(x.load, ["loaded", "loading", "failed", "unknown"], `render.plugins[${i}].load`, p) };
    }),
    missingPlugins: array(o.missingPlugins, "render.missingPlugins", p).map((m, i) => string(m, `render.missingPlugins[${i}]`, p)),
  };
}

/** Checks an artifact read from a manifest: well-formed, consistent with itself, and carrying the id its content gives it. */
export function validateArtifact(input: unknown): Validation<AudioArtifact> {
  const p = new Problems();
  const o = object(input, "", p);
  if (o.schema !== AUDIO_INTELLIGENCE_SCHEMA) p.add("schema", `must be ${AUDIO_INTELLIGENCE_SCHEMA}`);

  const role = oneOf(o.role, ARTIFACT_ROLES, "role", p);
  const f = object(o.format, "format", p);
  const format: AudioFormat = {
    sampleRate: number(f.sampleRate, "format.sampleRate", p, { min: 8000, max: 384000, int: true }),
    channels: number(f.channels, "format.channels", p, { min: 1, max: 64, int: true }),
    sampleFormat: oneOf(f.sampleFormat, SAMPLE_FORMATS, "format.sampleFormat", p),
    frames: number(f.frames, "format.frames", p, { min: 1, int: true }),
  };

  const tapIn = object(o.tap, "tap", p);
  const tapKind = oneOf(tapIn.kind, ["master", "track", "channel", "media"], "tap.kind", p);
  const tapId = tapIn.id === null ? null : string(tapIn.id, "tap.id", p, { nonEmpty: true });
  if ((tapKind === "master") !== (tapId === null)) p.add("tap", tapKind === "master" ? "the master has no id" : `a ${tapKind} tap needs an id`);

  const snapshotId = o.snapshotId === null ? null : string(o.snapshotId, "snapshotId", p, { nonEmpty: true });
  if (RENDERED.includes(role) && snapshotId === null) p.add("snapshotId", `a ${role} is a render of a song and must name the snapshot it came from`);

  let passage: PassageTime | null = null;
  if (o.passage !== null) {
    const x = object(o.passage, "passage", p);
    passage = {
      startTick: number(x.startTick, "passage.startTick", p, { min: 0, int: true }),
      endTick: number(x.endTick, "passage.endTick", p, { min: 0, int: true }),
      startSeconds: number(x.startSeconds, "passage.startSeconds", p, { min: 0 }),
      leadInFrames: number(x.leadInFrames, "passage.leadInFrames", p, { min: 0, int: true }),
      tailFrames: number(x.tailFrames, "passage.tailFrames", p, { min: 0, int: true }),
    };
    if (passage.endTick <= passage.startTick) p.add("passage", "must end after it starts");
    if (passage.leadInFrames + passage.tailFrames >= format.frames) p.add("passage", "has no frames of its own between its lead-in and its tail");
  }

  const transforms = array(o.transforms, "transforms", p, 64).map((t, i) => readTransform(t, `transforms[${i}]`, p));
  const derivedFrom = o.derivedFrom === null ? null : string(o.derivedFrom, "derivedFrom", p, { nonEmpty: true });
  if (derivedFrom === null && transforms.length > 0) p.add("transforms", "can only be on a copy: it names no artifact it was made from");
  if (derivedFrom !== null && transforms.length === 0) p.add("derivedFrom", "names an artifact it was made from, but no transform says what was done");
  const lastResample = [...transforms].reverse().find((t) => t.kind === "resample");
  if (lastResample && lastResample.toRate !== format.sampleRate) p.add("format.sampleRate", `is ${format.sampleRate}, but its last resample went to ${lastResample.toRate}`);
  const lastDownmix = [...transforms].reverse().find((t) => t.kind === "downmix");
  if (lastDownmix && lastDownmix.toChannels !== format.channels) p.add("format.channels", `is ${format.channels}, but its last downmix went to ${lastDownmix.toChannels}`);

  const perms = object(o.permissions, "permissions", p);
  const permissions: UsePermissions = {
    localAnalysis: boolean(perms.localAnalysis, "permissions.localAnalysis", p),
    hostedAnalysis: boolean(perms.hostedAnalysis, "permissions.hostedAnalysis", p),
    retrievalDisplay: boolean(perms.retrievalDisplay, "permissions.retrievalDisplay", p),
    training: boolean(perms.training, "permissions.training", p),
  };

  const artifact: AudioArtifact = {
    schema: AUDIO_INTELLIGENCE_SCHEMA,
    id: string(o.id, "id", p, { nonEmpty: true }),
    contentSha256: hash(o.contentSha256, "contentSha256", p),
    bytes: number(o.bytes, "bytes", p, { min: 1, int: true }),
    role,
    format,
    snapshotId,
    tap: { kind: tapKind, id: tapId },
    passage,
    render: readRender(o.render, p),
    derivedFrom,
    transforms,
    jobId: o.jobId === null ? null : string(o.jobId, "jobId", p, { nonEmpty: true }),
    recordingFamilyId: o.recordingFamilyId === null ? null : string(o.recordingFamilyId, "recordingFamilyId", p, { nonEmpty: true }),
    permissions,
    createdAt: number(o.createdAt, "createdAt", p, { min: 0 }),
  };
  if (!p.any && artifact.id !== artifactId(artifact)) p.add("id", "is not the hash of what the artifact holds");
  return toValidation(p, artifact);
}
