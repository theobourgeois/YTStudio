import { describe, expect, it } from "vitest";
import { sha256 } from "../hash.ts";
import {
  artifactId,
  createArtifact,
  deriveArtifact,
  frameToSongSeconds,
  framesToSeconds,
  isFullResolution,
  passageFrames,
  passageSeconds,
  useError,
  validateArtifact,
  type NewArtifact,
} from "./artifact.ts";
import { PRIVATE_USE, type AudioArtifact } from "./types.ts";

const RATE = 48000;

/** A 12-second render: 1 s of lead-in, a 10 s passage starting 20 s into the song, 1 s of tail. */
const base = (over: Partial<NewArtifact> = {}): NewArtifact => ({
  contentSha256: sha256("audio"),
  bytes: 12 * RATE * 8,
  role: "mix",
  format: { sampleRate: RATE, channels: 2, sampleFormat: "float32", frames: 12 * RATE },
  snapshotId: "snap_aaaaaaaaaaaaaaaaaaaa",
  tap: { kind: "master", id: null },
  passage: { startTick: 3840, endTick: 7680, startSeconds: 20, leadInFrames: RATE, tailFrames: RATE },
  render: { start: "cold", blockSize: 2048, latencySeconds: 0, tail: { mode: "none", maxSeconds: null }, plugins: [], missingPlugins: [] },
  derivedFrom: null,
  transforms: [],
  jobId: "job_1",
  recordingFamilyId: null,
  permissions: PRIVATE_USE,
  createdAt: 100,
  ...over,
});

const mix = () => createArtifact(base());

describe("createArtifact", () => {
  it("gives the id its content gives it: art_ and 20 hex digits", () => {
    expect(mix().id).toMatch(/^art_[0-9a-f]{20}$/);
    expect(mix().id).toBe(artifactId({ schema: 1, ...base() }));
  });

  it("is the same artifact however and whenever it was made, whichever job made it", () => {
    expect(createArtifact(base({ createdAt: 9999, jobId: "job_2" })).id).toBe(mix().id);
  });

  it("is a different artifact for different audio, snapshot, tap, passage or format", () => {
    const ids = [
      mix().id,
      createArtifact(base({ contentSha256: sha256("other") })).id,
      createArtifact(base({ snapshotId: "snap_bbbbbbbbbbbbbbbbbbbb" })).id,
      createArtifact(base({ role: "track-stem", tap: { kind: "track", id: "insert_1" } })).id,
      createArtifact(base({ passage: { startTick: 0, endTick: 3840, startSeconds: 0, leadInFrames: 0, tailFrames: RATE } })).id,
      createArtifact(base({ format: { sampleRate: 44100, channels: 2, sampleFormat: "float32", frames: 12 * RATE } })).id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("where a passage is in the artifact and in the song", () => {
  it("finds the passage's frames between the lead-in and the tail", () => {
    expect(passageFrames(mix())).toEqual({ first: RATE, end: 11 * RATE });
    expect(passageSeconds(mix())).toBe(10);
  });

  it("is the whole file when it isn't a passage", () => {
    const whole = createArtifact(base({ passage: null, role: "fixture", snapshotId: null, render: null }));
    expect(passageFrames(whole)).toBeNull();
    expect(passageSeconds(whole)).toBe(12);
    expect(frameToSongSeconds(whole, 100)).toBeNull();
  });

  it("maps a frame to the song's seconds: the passage's first frame is where the passage starts, the lead-in before it", () => {
    const a = mix();
    expect(frameToSongSeconds(a, RATE)).toBe(20);
    expect(frameToSongSeconds(a, 0)).toBe(19);
    expect(frameToSongSeconds(a, RATE + RATE / 2)).toBe(20.5);
    expect(framesToSeconds(a, 6 * RATE)).toBe(6);
  });
});

describe("deriveArtifact", () => {
  const derive = (parent: AudioArtifact, transform: Parameters<typeof deriveArtifact>[1]["transform"], format: AudioArtifact["format"]) =>
    deriveArtifact(parent, { transform, format, contentSha256: sha256(JSON.stringify(transform)), bytes: 10, jobId: null, now: 200 });

  it("records what was done, keeps the provenance and names its parent", () => {
    const parent = mix();
    const copy = derive(parent, { kind: "downmix", toChannels: 1 }, { ...parent.format, channels: 1 });
    expect(copy).toMatchObject({ derivedFrom: parent.id, snapshotId: parent.snapshotId, role: "mix", transforms: [{ kind: "downmix", toChannels: 1 }], createdAt: 200 });
    expect(copy.id).not.toBe(parent.id);
    expect(validateArtifact(copy).ok).toBe(true);
  });

  it("stacks transforms, and a copy of a copy is no longer full resolution", () => {
    const parent = mix();
    expect(isFullResolution(parent)).toBe(true);
    const mono = derive(parent, { kind: "downmix", toChannels: 1 }, { ...parent.format, channels: 1 });
    const low = derive(mono, { kind: "resample", fromRate: RATE, toRate: 16000 }, { ...mono.format, channels: 1, sampleRate: 16000, frames: 12 * 16000 });
    expect(low.transforms.map((t) => t.kind)).toEqual(["downmix", "resample"]);
    expect(isFullResolution(mono)).toBe(false);
    expect(isFullResolution(low)).toBe(false);
    expect(validateArtifact(low).ok).toBe(true);
  });

  it("a gain or a trim leaves it full resolution", () => {
    const parent = mix();
    const quieter = derive(parent, { kind: "gain", db: -6 }, parent.format);
    expect(isFullResolution(quieter)).toBe(true);
    expect(quieter.transforms).toEqual([{ kind: "gain", db: -6 }]);
  });

  it("moves a passage's frame counts with a resample, and its time not at all", () => {
    const parent = mix();
    const copy = derive(parent, { kind: "resample", fromRate: RATE, toRate: 16000 }, { ...parent.format, sampleRate: 16000, frames: 12 * 16000 });
    expect(copy.passage).toMatchObject({ leadInFrames: 16000, tailFrames: 16000, startSeconds: 20 });
    expect(frameToSongSeconds(copy, 16000)).toBe(20);
    expect(passageSeconds(copy)).toBe(10);
  });

  it("a trim of the lead-in shortens it, and one into the passage moves where the passage starts", () => {
    const parent = mix();
    const noLead = derive(parent, { kind: "trim", fromFrame: RATE, toFrame: 12 * RATE }, { ...parent.format, frames: 11 * RATE });
    expect(noLead.passage).toMatchObject({ leadInFrames: 0, startSeconds: 20, tailFrames: RATE });
    const into = derive(parent, { kind: "trim", fromFrame: RATE + RATE / 2, toFrame: 12 * RATE }, { ...parent.format, frames: 10.5 * RATE });
    expect(into.passage).toMatchObject({ leadInFrames: 0, startSeconds: 20.5 });
    // The song's time of the first frame of the copy is the same as the parent's frame it came from.
    expect(frameToSongSeconds(into, 0)).toBe(frameToSongSeconds(parent, RATE + RATE / 2));
  });

  it("never allows a copy more than its parent was", () => {
    const parent = createArtifact(base({ permissions: { ...PRIVATE_USE, hostedAnalysis: true } }));
    const copy = derive(parent, { kind: "downmix", toChannels: 1 }, { ...parent.format, channels: 1 });
    expect(copy.permissions).toEqual(parent.permissions);
    // The permissions are a copy, not shared.
    expect(copy.permissions).not.toBe(parent.permissions);
  });
});

describe("useError", () => {
  it("says no to a use that isn't allowed, naming the artifact, and null to one that is", () => {
    const a = mix();
    expect(useError(a, "localAnalysis")).toBeNull();
    expect(useError(a, "hostedAnalysis")).toMatch(new RegExp(`${a.id}.*sent to a hosted service`));
    expect(useError(a, "training")).toMatch(/training/);
    expect(useError(createArtifact(base({ permissions: { ...PRIVATE_USE, hostedAnalysis: true } })), "hostedAnalysis")).toBeNull();
  });

  it("starts private: only local analysis", () => {
    expect(PRIVATE_USE).toEqual({ localAnalysis: true, hostedAnalysis: false, retrievalDisplay: false, training: false });
  });
});

describe("validateArtifact", () => {
  const errorsOf = (value: unknown) => {
    const read = validateArtifact(value);
    return read.ok ? [] : read.errors;
  };
  const reId = (a: AudioArtifact): AudioArtifact => ({ ...a, id: artifactId(a) });

  it("accepts what createArtifact makes, and it survives JSON", () => {
    const a = mix();
    const read = validateArtifact(JSON.parse(JSON.stringify(a)));
    expect(read.ok && read.value).toEqual(a);
  });

  it("accepts audio that isn't a render: a fixture, with no snapshot, passage or render facts", () => {
    const f = createArtifact(base({ role: "fixture", snapshotId: null, passage: null, render: null, tap: { kind: "media", id: "media_x" }, recordingFamilyId: "family_1", jobId: null }));
    expect(validateArtifact(f).ok).toBe(true);
  });

  it("refuses an id that isn't the hash of the content", () => {
    expect(errorsOf({ ...mix(), bytes: 5 })).toContain("id: is not the hash of what the artifact holds");
  });

  it("refuses junk and the wrong schema", () => {
    for (const junk of [null, 3, "x", [], {}]) expect(errorsOf(junk).length).toBeGreaterThan(0);
    expect(errorsOf({ ...mix(), schema: 9 })).toContain("schema: must be 1");
  });

  it("requires a render to name its snapshot", () => {
    for (const role of ["mix", "track-stem", "bus-stem", "candidate-render"] as const) {
      const tap = role === "mix" ? ({ kind: "master", id: null } as const) : ({ kind: "track", id: "insert_1" } as const);
      expect(errorsOf(reId({ ...mix(), role, tap, snapshotId: null })).join(), role).toMatch(/must name the snapshot/);
    }
  });

  it("refuses a master tap with an id and a track tap without one", () => {
    expect(errorsOf(reId({ ...mix(), tap: { kind: "master", id: "x" } })).join()).toMatch(/the master has no id/);
    expect(errorsOf(reId({ ...mix(), tap: { kind: "track", id: null } })).join()).toMatch(/needs an id/);
  });

  it("refuses a passage that ends before it starts or leaves no frames of its own", () => {
    const a = mix();
    expect(errorsOf(reId({ ...a, passage: { ...a.passage!, endTick: a.passage!.startTick } })).join()).toMatch(/must end after it starts/);
    expect(errorsOf(reId({ ...a, passage: { ...a.passage!, leadInFrames: 6 * RATE, tailFrames: 6 * RATE } })).join()).toMatch(/no frames of its own/);
  });

  it("refuses transforms with no parent, a parent with no transforms, and a format that disagrees with them", () => {
    const a = mix();
    expect(errorsOf(reId({ ...a, transforms: [{ kind: "gain", db: 1 }] })).join()).toMatch(/can only be on a copy/);
    expect(errorsOf(reId({ ...a, derivedFrom: "art_x" })).join()).toMatch(/no transform says what was done/);
    const resampled = { ...a, derivedFrom: "art_x", transforms: [{ kind: "resample", fromRate: RATE, toRate: 16000 } as const] };
    expect(errorsOf(reId(resampled)).join()).toMatch(/format.sampleRate: is 48000, but its last resample went to 16000/);
    const mixed = { ...a, derivedFrom: "art_x", transforms: [{ kind: "downmix", toChannels: 1 } as const] };
    expect(errorsOf(reId(mixed)).join()).toMatch(/format.channels: is 2, but its last downmix went to 1/);
  });

  it("refuses an unknown role, sample format or transform, and bad numbers, naming where", () => {
    const a = mix();
    expect(errorsOf({ ...a, role: "song" }).join()).toMatch(/role: must be one of/);
    expect(errorsOf({ ...a, format: { ...a.format, sampleFormat: "pcm8" } }).join()).toMatch(/format.sampleFormat/);
    expect(errorsOf({ ...a, format: { ...a.format, frames: 0 } }).join()).toMatch(/format.frames: must be at least 1/);
    expect(errorsOf({ ...a, format: { ...a.format, sampleRate: 100 } }).join()).toMatch(/format.sampleRate/);
    expect(errorsOf({ ...a, transforms: [{ kind: "echo" }] }).join()).toMatch(/transforms\[0\].kind/);
    expect(errorsOf({ ...a, contentSha256: "abc" }).join()).toMatch(/contentSha256/);
  });

  it("requires every permission to be said, true or false", () => {
    const a = mix();
    expect(errorsOf({ ...a, permissions: { localAnalysis: true } }).join()).toMatch(/permissions.hostedAnalysis: must be true or false/);
  });

  it("drops fields it doesn't know", () => {
    const read = validateArtifact({ ...mix(), path: "/etc/passwd" });
    expect(read.ok && "path" in read.value).toBe(false);
  });

  it("reads the render facts, and refuses a bad plugin load state", () => {
    const a = mix();
    expect(errorsOf({ ...a, render: { ...a.render!, plugins: [{ ownerId: "fx_1", load: "asleep" }] } }).join()).toMatch(/render.plugins\[0\].load/);
    const withPlugins = reId({ ...a, render: { ...a.render!, plugins: [{ ownerId: "fx_1", load: "failed" }], missingPlugins: ["vst3:gone"] } });
    expect(validateArtifact(withPlugins).ok).toBe(true);
  });

  it("never throws on junk", () => {
    for (const junk of [{ format: 3 }, { passage: "x" }, { tap: null }, { transforms: [null] }, { render: 4 }, { permissions: [] }]) expect(() => validateArtifact(junk)).not.toThrow();
  });
});
