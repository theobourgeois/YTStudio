import { describe, expect, it } from "vitest";
import { createAutomation } from "../automation.ts";
import { setEffect } from "../mixer.ts";
import { PRO_C_PLUGIN } from "../pro-c-presets.ts";
import { createChannel, createMusicProject, createPluginChannel } from "../project.ts";
import type { MusicProject } from "../types.ts";
import { sha256 } from "../hash.ts";
import {
  buildSnapshot,
  contentMatches,
  coverageOf,
  diffSnapshots,
  documentHashes,
  isBuiltInEffect,
  mediaUses,
  pluginOwners,
  snapshotContent,
  snapshotId,
  timingOf,
  validateSnapshot,
  type FileFacts,
  type SnapshotInputs,
} from "./snapshot.ts";
import { AUDIO_INTELLIGENCE_SCHEMA, SNAPSHOT_PARTS, type MixSnapshot, type RenderSettings } from "./types.ts";

const RENDER: RenderSettings = { sampleRate: 48000, channelLayout: "stereo", resampling: "hermite", mode: "song", engineVersion: null };
const SYNTH = { id: "vst3:synth", name: "Synth", format: "VST3" };
const COMP = { id: "vst3:comp", name: "Comp", format: "VST3" };

const file = (text: string): FileFacts => ({ status: "hashed", sha256: sha256(text), bytes: text.length });
const MISSING: FileFacts = { status: "missing", sha256: null, bytes: null };

/** A vocal sampler, a beat sampler, a synth, an outside compressor and our own on the vocal's track. */
function song(): MusicProject {
  let s = createMusicProject("Song");
  s = { ...s, channels: [createChannel("Vocal", "media_vocal", "chan_vocal"), createChannel("Beat", "media_beat", "chan_beat"), createPluginChannel(SYNTH, "chan_synth")] };
  s = { ...s, channels: s.channels.map((c) => (c.id === "chan_vocal" ? { ...c, mixerTrack: "insert_1" } : c)) };
  s = setEffect(s, "insert_1", 0, COMP, "fx_comp");
  s = setEffect(s, "insert_1", 1, PRO_C_PLUGIN, "fx_proc");
  return s;
}

const inputs = (document: MusicProject, extra: Partial<SnapshotInputs> = {}): SnapshotInputs => ({
  projectId: "proj_1",
  document,
  media: { media_vocal: file("vocal"), media_beat: file("beat") },
  pluginStates: { chan_synth: file("synth state"), fx_comp: file("comp state") },
  pluginVersions: { chan_synth: "1.0.0", fx_comp: "2.1.0" },
  render: RENDER,
  capture: { origin: "live-document", unsavedEdits: false },
  now: 1000,
  ...extra,
});

describe("what a song is made of", () => {
  it("lists each media id once with the channels that play it, in id order", () => {
    const s = song();
    const shared = { ...s, channels: [...s.channels, createChannel("Beat 2", "media_beat", "chan_beat2")] };
    expect(mediaUses(shared)).toEqual([
      { id: "media_beat", channels: ["chan_beat", "chan_beat2"] },
      { id: "media_vocal", channels: ["chan_vocal"] },
    ]);
  });

  it("lists the plugins: instruments in the rack's order, then each track's effects, ours marked built in", () => {
    expect(pluginOwners(song()).map((o) => [o.owner.kind, o.owner.id, o.builtIn])).toEqual([
      ["channel", "chan_synth", false],
      ["effect", "fx_comp", false],
      ["effect", "fx_proc", true],
    ]);
  });

  it("knows our own effects by their settings", () => {
    const effects = song().mixer.tracks.flatMap((t) => t.effects.filter((e) => e !== null));
    expect(effects.map(isBuiltInEffect)).toEqual([false, true]);
  });

  it("says the tempo is automated only when a tempo clip is on the playlist", () => {
    const s = song();
    expect(timingOf(s)).toEqual({ tempo: s.settings.tempo, timeSignature: s.settings.timeSignature, swing: s.settings.swing, tempoAutomated: false });
    const made = createAutomation(s, { kind: "tempo" }, { start: 0, length: 384 }, { id: "auto_tempo" });
    expect(made.song.automations.some((a) => a.id === "auto_tempo")).toBe(true);
    expect(timingOf(made.song).tempoAutomated).toBe(true);
    // The curve exists but nothing plays it: the tempo doesn't move.
    const unplayed = { ...made.song, playlist: { ...made.song.playlist, clips: [] } };
    expect(timingOf(unplayed).tempoAutomated).toBe(false);
  });
});

describe("buildSnapshot", () => {
  it("is deterministic: the same song and files give the same id", () => {
    expect(buildSnapshot(inputs(song())).snapshot).toEqual(buildSnapshot(inputs(song())).snapshot);
  });

  it("leaves when it was made, where from, and the song's name out of its identity", () => {
    const a = buildSnapshot(inputs(song())).snapshot;
    const b = buildSnapshot(inputs({ ...song(), name: "Renamed" }, { now: 99_999, capture: { origin: "saved-document", unsavedEdits: null } })).snapshot;
    expect(b.id).toBe(a.id);
    expect(b.createdAt).not.toBe(a.createdAt);
  });

  it("changes the id for a different project, even with the same song", () => {
    expect(buildSnapshot(inputs(song(), { projectId: "proj_2" })).snapshot.id).not.toBe(buildSnapshot(inputs(song())).snapshot.id);
  });

  it("hashes the document by part, so an edit names the part it changed", () => {
    const base = buildSnapshot(inputs(song())).snapshot;
    const edited = { ...song(), settings: { ...song().settings, tempo: 91 } };
    const next = buildSnapshot(inputs(edited)).snapshot;
    expect(next.id).not.toBe(base.id);
    expect(diffSnapshots(base, next)).toEqual({ identical: false, parts: ["settings"], media: [], plugins: [], render: false });

    const rerouted = { ...song(), channels: song().channels.map((c) => (c.id === "chan_beat" ? { ...c, mixerTrack: "insert_2" } : c)) };
    expect(diffSnapshots(base, buildSnapshot(inputs(rerouted)).snapshot).parts).toEqual(["channels"]);

    const mixed = setEffect(song(), "insert_2", 0, COMP, "fx_other");
    expect(diffSnapshots(base, buildSnapshot(inputs(mixed)).snapshot).parts).toEqual(["mixer"]);
  });

  it("records every media file by hash, and a file it couldn't see as missing with no hash", () => {
    const { snapshot } = buildSnapshot(inputs(song(), { media: { media_vocal: file("vocal") } }));
    expect(snapshot.media).toEqual([
      { id: "media_beat", channels: ["chan_beat"], status: "missing", sha256: null, bytes: null },
      { id: "media_vocal", channels: ["chan_vocal"], status: "hashed", sha256: sha256("vocal"), bytes: 5 },
    ]);
  });

  it("never keeps a hash for a file that wasn't hashed, whatever the caller passed", () => {
    const liar: FileFacts = { status: "unreadable", sha256: sha256("x"), bytes: 1 };
    const { snapshot } = buildSnapshot(inputs(song(), { media: { media_vocal: liar, media_beat: file("beat") } }));
    expect(snapshot.media.find((m) => m.id === "media_vocal")).toMatchObject({ status: "unreadable", sha256: null, bytes: null });
  });

  it("keeps our own effects' settings in the document, with no state file", () => {
    const { snapshot } = buildSnapshot(inputs(song(), { pluginStates: { fx_proc: file("ignored") } }));
    expect(snapshot.plugins.find((p) => p.owner.id === "fx_proc")).toMatchObject({ storage: "document", state: "inDocument", sha256: null, bytes: null });
  });

  it("hashes a plugin's state file, and says absent for one with none", () => {
    const { snapshot } = buildSnapshot(inputs(song(), { pluginStates: { chan_synth: file("synth state") } }));
    expect(snapshot.plugins.find((p) => p.owner.id === "chan_synth")).toMatchObject({ state: "hashed", sha256: sha256("synth state") });
    expect(snapshot.plugins.find((p) => p.owner.id === "fx_comp")).toMatchObject({ state: "absent", sha256: null });
  });

  it("a plugin whose state file is gone is absent, not hashed", () => {
    const { snapshot } = buildSnapshot(inputs(song(), { pluginStates: { chan_synth: MISSING, fx_comp: file("c") } }));
    expect(snapshot.plugins.find((p) => p.owner.id === "chan_synth")).toMatchObject({ state: "absent", sha256: null });
  });

  it("sees a change to a plugin's state, a media file and the render settings", () => {
    const base = buildSnapshot(inputs(song())).snapshot;
    const state = buildSnapshot(inputs(song(), { pluginStates: { chan_synth: file("changed"), fx_comp: file("comp state") } })).snapshot;
    expect(diffSnapshots(base, state)).toMatchObject({ identical: false, plugins: ["chan_synth"], parts: [], media: [] });
    const media = buildSnapshot(inputs(song(), { media: { media_vocal: file("vocal 2"), media_beat: file("beat") } })).snapshot;
    expect(diffSnapshots(base, media)).toMatchObject({ identical: false, media: ["media_vocal"] });
    const render = buildSnapshot(inputs(song(), { render: { ...RENDER, resampling: "sinc" } })).snapshot;
    expect(diffSnapshots(base, render)).toMatchObject({ identical: false, render: true });
  });

  it("returns the content it hashed, and that content matches the snapshot", () => {
    const { snapshot, content } = buildSnapshot(inputs(song()));
    expect(content).toEqual(snapshotContent(song()));
    expect(contentMatches(snapshot, content)).toBe(true);
    expect(contentMatches(snapshot, { ...content, settings: { ...content.settings, tempo: 70 } })).toBe(false);
  });

  it("leaves the song's name and version out of the content", () => {
    expect(Object.keys(snapshotContent(song())).sort()).toEqual([...SNAPSHOT_PARTS].sort());
  });

  it("is a record that survives JSON and reads back identical", () => {
    const { snapshot } = buildSnapshot(inputs(song()));
    const read = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(read.ok && read.value).toEqual(snapshot);
  });
});

describe("what a capture says it couldn't see", () => {
  it("is complete for a song with nothing outside it to read", () => {
    const { snapshot } = buildSnapshot(inputs(createMusicProject("Empty"), { media: {}, pluginStates: {} }));
    expect(snapshot.completeness).toBe("complete");
    expect(snapshot.coverage.media.status).toBe("notApplicable");
    expect(snapshot.coverage.pluginState.status).toBe("notApplicable");
    expect(snapshot.coverage.builtInEffects.status).toBe("notApplicable");
  });

  it("is complete when the media and every plugin's state were hashed, and still says the plugin files lag", () => {
    const { snapshot } = buildSnapshot(inputs(song()));
    expect(snapshot.coverage.media).toEqual({ status: "captured" });
    expect(snapshot.coverage.pluginState.status).toBe("captured");
    expect(snapshot.coverage.pluginState.note).toMatch(/every few seconds/);
    expect(snapshot.coverage.builtInEffects).toEqual({ status: "captured" });
    expect(snapshot.completeness).toBe("complete");
  });

  it("is partial with some media missing, and unavailable with all of it", () => {
    const some = buildSnapshot(inputs(song(), { media: { media_beat: file("beat") } })).snapshot;
    expect(some.coverage.media.status).toBe("partial");
    expect(some.completeness).toBe("partial");
    const none = buildSnapshot(inputs(song(), { media: {} })).snapshot;
    expect(none.coverage.media.status).toBe("unavailable");
    expect(none.coverage.media.note).toMatch(/media/);
  });

  it("says a plugin whose version isn't known is a gap: its saved state can't be tied to a build", () => {
    const { snapshot } = buildSnapshot(inputs(song(), { pluginVersions: { chan_synth: "1.0.0" } }));
    expect(snapshot.coverage.pluginIdentity.status).toBe("partial");
    expect(snapshot.coverage.pluginIdentity.note).toMatch(/version/);
    expect(snapshot.completeness).toBe("partial");
    const none = buildSnapshot(inputs(song(), { pluginVersions: {} })).snapshot;
    expect(none.coverage.pluginIdentity.status).toBe("unavailable");
    expect(none.plugins.every((p) => p.plugin.version === null)).toBe(true);
  });

  it("records a plugin's version, and sees an update as a difference", () => {
    const a = buildSnapshot(inputs(song())).snapshot;
    expect(a.plugins.find((p) => p.owner.id === "chan_synth")?.plugin.version).toBe("1.0.0");
    const b = buildSnapshot(inputs(song(), { pluginVersions: { chan_synth: "1.0.1", fx_comp: "2.1.0" } })).snapshot;
    expect(diffSnapshots(a, b).plugins).toEqual(["chan_synth"]);
  });

  it("asks no identity of our own effects: they're the app's, with their settings in the document", () => {
    const ours = setEffect(createMusicProject("Ours"), "insert_1", 0, PRO_C_PLUGIN, "fx_proc");
    const { snapshot } = buildSnapshot(inputs(ours, { media: {}, pluginStates: {}, pluginVersions: {} }));
    expect(snapshot.coverage.pluginIdentity.status).toBe("notApplicable");
    expect(snapshot.coverage.pluginState.status).toBe("notApplicable");
    expect(snapshot.coverage.builtInEffects.status).toBe("captured");
    expect(snapshot.completeness).toBe("complete");
  });

  it("says a plugin with no state file is a gap, in words that say what it means", () => {
    const { snapshot } = buildSnapshot(inputs(song(), { pluginStates: { chan_synth: file("a") } }));
    expect(snapshot.coverage.pluginState.status).toBe("partial");
    expect(snapshot.coverage.pluginState.note).toMatch(/opaque/);
    expect(snapshot.completeness).toBe("partial");
  });

  it("says a song captured from its saved file, while the tab had unsaved edits, isn't the song the user sees", () => {
    const saved = buildSnapshot(inputs(createMusicProject("Empty"), { media: {}, pluginStates: {}, capture: { origin: "saved-document", unsavedEdits: true } })).snapshot;
    expect(saved.coverage.document.status).toBe("partial");
    expect(saved.completeness).toBe("partial");
    const live = buildSnapshot(inputs(createMusicProject("Empty"), { media: {}, pluginStates: {}, capture: { origin: "live-document", unsavedEdits: true } })).snapshot;
    expect(live.coverage.document.status).toBe("captured");
  });

  it("coverageOf says every aspect", () => {
    const coverage = coverageOf([], [], { origin: "live-document", unsavedEdits: false });
    expect(Object.keys(coverage).sort()).toEqual(["automation", "builtInEffects", "document", "media", "pluginIdentity", "pluginState", "renderSettings", "routing"]);
  });
});

describe("diffSnapshots", () => {
  it("is empty for the same song, whenever and however it was captured", () => {
    const a = buildSnapshot(inputs(song())).snapshot;
    const b = buildSnapshot(inputs(song(), { now: 5, capture: { origin: "saved-document", unsavedEdits: false } })).snapshot;
    expect(diffSnapshots(a, b)).toEqual({ identical: true, parts: [], media: [], plugins: [], render: false });
  });

  it("is the same differences either way round", () => {
    const a = buildSnapshot(inputs(song())).snapshot;
    const b = buildSnapshot(inputs({ ...song(), settings: { ...song().settings, swing: 0.3 } }, { media: { media_vocal: file("v2"), media_beat: file("beat") } })).snapshot;
    expect(diffSnapshots(a, b)).toEqual(diffSnapshots(b, a));
  });

  it("sees a plugin that was added or removed", () => {
    const a = buildSnapshot(inputs(song())).snapshot;
    const more = setEffect(song(), "insert_2", 0, COMP, "fx_new");
    expect(diffSnapshots(a, buildSnapshot(inputs(more)).snapshot).plugins).toEqual(["fx_new"]);
  });
});

describe("documentHashes", () => {
  it("is the same for equal content built in another key order", () => {
    const a = snapshotContent(song());
    const b = JSON.parse(JSON.stringify(a, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)));
    expect(documentHashes(b)).toEqual(documentHashes(a));
  });
});

describe("validateSnapshot", () => {
  /** Partial: one plugin has no state file yet. */
  const good = () => buildSnapshot(inputs(song(), { pluginStates: { chan_synth: file("synth state") } })).snapshot;
  const errorsOf = (value: unknown) => {
    const read = validateSnapshot(value);
    return read.ok ? [] : read.errors;
  };
  /** Changes a field and makes the id match again, so only that fault is left. */
  const reId = (s: MixSnapshot): MixSnapshot => ({ ...s, id: snapshotId(s) });

  it("accepts what buildSnapshot makes", () => {
    expect(validateSnapshot(good()).ok).toBe(true);
  });

  it("refuses what isn't an object, and a wrong schema", () => {
    expect(errorsOf(null).length).toBeGreaterThan(0);
    expect(errorsOf([]).length).toBeGreaterThan(0);
    expect(errorsOf({ ...good(), schema: 2 })).toContain(`schema: must be ${AUDIO_INTELLIGENCE_SCHEMA}`);
  });

  it("refuses a record whose id isn't the hash of what it holds (edited by hand, or mixed up)", () => {
    const tampered = { ...good(), projectId: "proj_other" };
    expect(errorsOf(tampered)).toContain("id: is not the hash of what the snapshot holds");
  });

  it("refuses a document hash that isn't the hash of its parts", () => {
    const s = good();
    expect(errorsOf({ ...s, document: { ...s.document, sha256: sha256("nope") } })).toContain("document.sha256: is not the hash of its parts");
  });

  it("names the path of each fault", () => {
    const s = good();
    const bad = { ...s, media: [{ ...s.media[0], sha256: "nothex" }], timing: { ...s.timing, tempo: "fast" } };
    const errors = errorsOf(bad);
    expect(errors).toContain("media[0].sha256: must be a SHA-256 as 64 lower-case hex digits");
    expect(errors).toContain("timing.tempo: must be a finite number");
  });

  it("refuses a hashed file with no hash, and an unhashed one with a hash", () => {
    const s = good();
    const noHash = reId({ ...s, media: s.media.map((m, i) => (i === 0 ? { ...m, sha256: null } : m)) });
    expect(errorsOf(noHash).join()).toMatch(/is hashed but has no hash or size/);
    const missingWithHash = reId({ ...s, media: s.media.map((m, i) => (i === 0 ? { ...m, status: "missing" as const } : m)) });
    expect(errorsOf(missingWithHash).join()).toMatch(/is missing but has a hash or size/);
  });

  it("refuses a plugin whose state and storage disagree", () => {
    const s = good();
    const synth = s.plugins.findIndex((p) => p.owner.id === "chan_synth");
    const wrong = reId({ ...s, plugins: s.plugins.map((p, i) => (i === synth ? { ...p, state: "inDocument" as const } : p)) });
    expect(errorsOf(wrong).join()).toMatch(/has a state file, so it can't be inDocument/);
    const builtIn = s.plugins.findIndex((p) => p.owner.id === "fx_proc");
    const wrong2 = reId({ ...s, plugins: s.plugins.map((p, i) => (i === builtIn ? { ...p, state: "absent" as const } : p)) });
    expect(errorsOf(wrong2).join()).toMatch(/keeps its settings in the document/);
  });

  it("refuses a hash on a plugin that isn't hashed, and none on one that is", () => {
    const s = good();
    const synth = s.plugins.findIndex((p) => p.owner.id === "chan_synth");
    const comp = s.plugins.findIndex((p) => p.owner.id === "fx_comp");
    expect(s.plugins[synth].state).toBe("hashed");
    expect(s.plugins[comp].state).toBe("absent");
    const hashedWithout = reId({ ...s, plugins: s.plugins.map((p, j) => (j === synth ? { ...p, sha256: null, bytes: null } : p)) });
    expect(errorsOf(hashedWithout).join()).toMatch(/has a hash exactly when its state is hashed/);
    const absentWith = reId({ ...s, plugins: s.plugins.map((p, j) => (j === comp ? { ...p, sha256: sha256("x"), bytes: 1 } : p)) });
    expect(errorsOf(absentWith).join()).toMatch(/has a hash exactly when its state is hashed/);
  });

  it("refuses two media or two plugins with the same id", () => {
    const s = good();
    expect(errorsOf(reId({ ...s, media: [s.media[0], s.media[0]] })).join()).toMatch(/appears twice/);
    expect(errorsOf(reId({ ...s, plugins: [s.plugins[0], s.plugins[0]] })).join()).toMatch(/appears twice/);
  });

  it("refuses a completeness its own coverage contradicts", () => {
    const s = good();
    expect(s.completeness).toBe("partial");
    expect(errorsOf(reId({ ...s, completeness: "complete" })).join()).toMatch(/completeness: must be partial/);
  });

  it("refuses an unknown coverage status or a missing aspect", () => {
    const s = good();
    expect(errorsOf({ ...s, coverage: { ...s.coverage, media: { status: "great" } } }).join()).toMatch(/coverage.media.status/);
    const { routing: _routing, ...rest } = s.coverage;
    expect(errorsOf({ ...s, coverage: rest }).join()).toMatch(/coverage.routing/);
  });

  it("refuses a bad time signature, a render setting out of range, and an unknown resampling", () => {
    const s = good();
    expect(errorsOf({ ...s, timing: { ...s.timing, timeSignature: [4] } }).join()).toMatch(/timeSignature/);
    expect(errorsOf({ ...s, render: { ...s.render, sampleRate: 3 } }).join()).toMatch(/render.sampleRate/);
    expect(errorsOf({ ...s, render: { ...s.render, resampling: "cubic" } }).join()).toMatch(/render.resampling/);
  });

  it("drops fields it doesn't know, so what's kept is what was hashed", () => {
    const read = validateSnapshot({ ...good(), extra: "ignored", capture: { ...good().capture, secret: 1 } });
    expect(read.ok && "extra" in read.value).toBe(false);
    expect(read.ok && "secret" in read.value.capture).toBe(false);
  });

  it("never throws on junk", () => {
    for (const junk of [undefined, 0, "x", [], {}, { media: 3 }, { plugins: [null] }, { document: { parts: 4 } }]) expect(() => validateSnapshot(junk)).not.toThrow();
  });
});

describe("snapshotId", () => {
  it("has the prefix and 20 hex digits", () => {
    expect(buildSnapshot(inputs(song())).snapshot.id).toMatch(/^snap_[0-9a-f]{20}$/);
  });
});

describe("a snapshot stays as it was when the song is edited afterwards", () => {
  it("keeps a copy of the content, so changing the song in place changes neither it nor its hashes", () => {
    const original = song();
    const { snapshot, content } = buildSnapshot(inputs(original));
    const frozen = JSON.stringify({ snapshot, content });
    original.settings.tempo = 70;
    original.channels[0].name = "Changed";
    original.mixer.tracks[1].effects[0] = null;
    expect(JSON.stringify({ snapshot, content })).toBe(frozen);
    expect(contentMatches(snapshot, content)).toBe(true);
  });

  it("leaves the song it was given alone", () => {
    const original = song();
    const before = JSON.stringify(original);
    buildSnapshot(inputs(original));
    expect(JSON.stringify(original)).toBe(before);
  });

  it("is made of plain data: it survives structuredClone and JSON alike", () => {
    const bundle = buildSnapshot(inputs(song()));
    expect(structuredClone(bundle)).toEqual(JSON.parse(JSON.stringify(bundle)));
  });
});

describe("an unset id is never trusted", () => {
  it("a snapshot with no id is refused", () => {
    const { id: _id, ...rest } = buildSnapshot(inputs(song())).snapshot;
    expect(validateSnapshot(rest).ok).toBe(false);
  });
});
