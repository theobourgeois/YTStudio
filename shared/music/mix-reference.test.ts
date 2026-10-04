import { describe, expect, it } from "vitest";
import {
  REJECTION_REASONS,
  normaliseKey,
  parseRatio,
  recordingFamilyId,
  selectReferenceSubset,
  splitByRecordingFamily,
  type MixReferenceRow,
  type RejectionReason,
} from "./mix-reference.ts";

// Invented rows: the dataset's own aren't kept in the repository (no licence).
const strip = { name: "Channel Strip", attack: 2.5, release: 120, thresh: -18.2, depth: -6, gain: 1.5, ratio: "3.0:1", knee: 4 };

const row = (over: Partial<MixReferenceRow> = {}, compression: unknown[] = [strip]): MixReferenceRow => ({
  song_name: "Song A",
  mix_name: "MIX-1",
  track_name: "LeadVox",
  track_instrument_type: "VOCALS",
  track_instrument_subtype: "LEAD",
  genre: "POP",
  split: "train",
  parameters: JSON.stringify({ gain: 0, pan: [0], compression }),
  ...over,
});

const reasonsOf = (rows: MixReferenceRow[]) => selectReferenceSubset(rows).rejected.flatMap((r) => r.reasons);

describe("selectReferenceSubset", () => {
  it("keeps a lead vocal compressor and everything annotated, unconverted", () => {
    const { records, rejected } = selectReferenceSubset([row()]);
    expect(rejected).toEqual([]);
    const [record] = records;
    expect(record.role).toBe("leadVocal");
    expect(record.plugin).toBe("Channel Strip");
    expect(record.nativeValues.ratio).toEqual({ sourceKey: "ratio", key: "ratio", value: "3.0:1", readability: "annotated" });
    expect(record.nativeValues.attack.value).toBe(2.5);
    expect(record.nativeValues.release.value).toBe(120);
    expect(record.nativeValues.depth.value).toBe(-6);
    expect(record.settings).toEqual({ threshold: -18.2, ratio: 3, attack: 2.5, release: 120, gain: 1.5, knee: 4 });
    expect(record.missing).toEqual([]);
  });

  it("normalises thresh / thres / threshold and keeps the spelling it came with", () => {
    for (const spelling of ["thresh", "thres", "threshold", "Thresh"]) {
      const { name, thresh, ...rest } = strip;
      const [record] = selectReferenceSubset([row({}, [{ name, ...rest, [spelling]: -20 }])]).records;
      expect(record.nativeValues.threshold).toMatchObject({ sourceKey: spelling, key: "threshold", value: -20 });
      expect(record.settings.threshold).toBe(-20);
    }
    expect(normaliseKey("Attack")).toBe("attack");
    expect(normaliseKey("ratio")).toBe("ratio");
  });

  it("never marks anything exact or estimated, never executable, never for training, units always unverified", () => {
    const { records } = selectReferenceSubset([row(), row({ mix_name: "MIX-2" }, [strip, { ...strip, ratio: "2:1" }])]);
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.eligibility.executableProposal).toBe(false);
      expect(record.eligibility.training).toBe(false);
      expect(record.eligibility.retrievalDisplay).toBe(true);
      expect(record.eligibility.reasons.join(" ")).toMatch(/licence/);
      expect(record.unitStatus).toBe("unverified");
      for (const value of Object.values(record.nativeValues)) expect(["annotated", "unavailable"]).toContain(value.readability);
    }
  });

  it("keeps a key with no value as unavailable and lists absent fields as missing", () => {
    const { name, release, knee, ...rest } = strip;
    const [record] = selectReferenceSubset([row({}, [{ name, ...rest, release: null }])]).records;
    expect(record.nativeValues.release).toMatchObject({ value: null, readability: "unavailable" });
    expect(record.missing).toEqual(["release", "knee"]);
  });

  it("keeps the extra fields of a plugin as annotated (input and output of a different plugin are not renamed)", () => {
    const [record] = selectReferenceSubset([row({}, [{ ...strip, name: "Compressor", output: 3, send: "True", pan: [10] }])]).records;
    expect(record.nativeValues.output.value).toBe(3);
    expect(record.nativeValues.send.value).toBe("True");
    expect(record.nativeValues.pan.value).toEqual([10]);
  });

  it("gives every rejection reason somewhere", () => {
    const cases: [RejectionReason, MixReferenceRow[]][] = [
      ["missingIdentity", [row({ track_name: " " })]],
      ["notVocal", [row({ track_instrument_type: "DRUMS", track_instrument_subtype: "KICK" })]],
      ["inconsistentSubtype", [row({ track_instrument_subtype: "ELECTRIC" })]],
      ["roleNotSelected", [row({ track_instrument_subtype: "BACKGROUND" })]],
      ["invalidParameters", [row({ parameters: "{not json" }), row({ parameters: "[1]" }), row({ parameters: null })]],
      ["noCompression", [row({}, []), row({ parameters: JSON.stringify({ gain: 0 }) })]],
      ["invalidEntry", [row({}, [null]), row({}, [{ attack: 1 }]), row({}, [{ ...strip, pan: { x: 1 } }])]],
      ["unrecognisedPlugin", [row({}, [{ ...strip, name: "Maxim" }])]],
      ["missingThreshold", [row({}, [{ name: "BF-76", attack: 3, release: 5, input: 18, output: 24, ratio: "4:1" }])]],
      ["missingRatio", [row({}, [{ name: "Compressor", thresh: -10, attack: 1, release: 2 }])]],
      ["nonFiniteValue", [row({}, [{ ...strip, thresh: "-18 dB" }]), row({}, [{ ...strip, attack: "fast" }])]],
      ["ratioNotNumeric", [row({}, [{ ...strip, ratio: "LMTR" }]), row({}, [{ ...strip, ratio: "None" }]), row({}, [{ ...strip, ratio: 0 }])]],
      ["conflictingKeys", [row({}, [{ name: "Compressor", thresh: -10, thres: -12, ratio: "2:1" }])]],
    ];
    for (const [reason, rows] of cases) for (const one of rows) expect(reasonsOf([one])).toContain(reason);

    // The duplicate: the same song, mix and track, with identical settings.
    const duplicate = selectReferenceSubset([row(), row()]);
    expect(duplicate.records).toHaveLength(1);
    expect(duplicate.rejected.flatMap((r) => r.reasons)).toEqual(["duplicate"]);

    expect(REJECTION_REASONS.filter((reason) => !cases.some(([r]) => r === reason) && reason !== "duplicate")).toEqual([]);
  });

  it("accepts rows whose parameters are already an object", () => {
    const { records } = selectReferenceSubset([row({ parameters: { compression: [strip] } })]);
    expect(records).toHaveLength(1);
  });

  it("keeps the good compressor of a chain and rejects the bad one by its place", () => {
    const { records, rejected, summary } = selectReferenceSubset([row({}, [strip, { name: "BF-3A" }, { ...strip, ratio: "8:1" }])]);
    expect(records.map((r) => [r.source.chainIndex, r.source.chainLength])).toEqual(expect.arrayContaining([[0, 3], [2, 3]]));
    expect(rejected.map((r) => r.rowKey)).toEqual(["Song A | MIX-1 | LeadVox#c1"]);
    expect(rejected[0].reasons).toEqual(expect.arrayContaining(["missingThreshold", "missingRatio"]));
    expect(summary.rows).toBe(1);
    expect(summary.rowsWithRecords).toBe(1);
    expect(summary.records).toBe(2);
  });

  it("can include backing vocals when asked, and says what it kept", () => {
    const rows = [row(), row({ track_name: "BGV", track_instrument_subtype: "BACKGROUND" })];
    expect(selectReferenceSubset(rows).records).toHaveLength(1);
    const both = selectReferenceSubset(rows, { roles: ["leadVocal", "backingVocal"] });
    expect(both.records.map((r) => r.role).sort()).toEqual(["backingVocal", "leadVocal"]);
    expect(both.summary.byRole).toEqual({ leadVocal: 1, backingVocal: 1 });
    expect(both.summary.byReadability.annotated).toBe(14);
  });

  it("gives the same id to the same compressor wherever it comes and different ids to different ones", () => {
    const a = selectReferenceSubset([row()]).records[0];
    const b = selectReferenceSubset([row({ genre: "ROCK", split: "test" })]).records[0];
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^mxp_[0-9a-f]{16}$/);
    const others = [row({ mix_name: "MIX-2" }), row({ track_name: "LeadVox2" }), row({ song_name: "Song B" }), row({}, [{ ...strip, ratio: "2:1" }])];
    const ids = new Set([a.id, ...selectReferenceSubset(others).records.map((r) => r.id)]);
    expect(ids.size).toBe(5);
    expect(a.recordingFamilyId).toBe("song_song-a");
  });

  it("is the same in any order of the rows", () => {
    const rows = ["A", "B", "C", "D", "E"].flatMap((song) => [row({ song_name: song }), row({ song_name: song, mix_name: "MIX-2" }, [strip, { ...strip, ratio: "5:1" }])]);
    const forward = selectReferenceSubset(rows);
    const backward = selectReferenceSubset([...rows].reverse());
    expect(backward.records).toEqual(forward.records);
    expect(backward.summary).toEqual(forward.summary);
  });

  it("handles no rows", () => {
    const { records, rejected, summary } = selectReferenceSubset([]);
    expect(records).toEqual([]);
    expect(rejected).toEqual([]);
    expect(summary).toMatchObject({ rows: 0, rowsWithRecords: 0, records: 0, rejected: 0, rejectedByReason: {}, bySong: {} });
    expect(splitByRecordingFamily([], { seed: "x", testFraction: 0.3 }).counts.train).toEqual({ families: 0, records: 0 });
  });
});

describe("parseRatio", () => {
  it("reads N:1 and numbers, and nothing else", () => {
    expect(parseRatio("3.0:1")).toBe(3);
    expect(parseRatio("4:1")).toBe(4);
    expect(parseRatio(2.5)).toBe(2.5);
    for (const bad of ["LMTR", "None", "1:4", "", "3", null, undefined, Number.NaN, 0, -2]) expect(parseRatio(bad)).toBeNull();
  });
});

describe("splitByRecordingFamily", () => {
  const songs = Array.from({ length: 13 }, (_, i) => `Song ${i}`);
  const rows = songs.flatMap((song, i) => Array.from({ length: 1 + (i % 4) }, (_, k) => row({ song_name: song, mix_name: `MIX-${k}` })));
  const { records } = selectReferenceSubset(rows);

  it("puts each song in one split, and every record with its song", () => {
    const { assignment, counts } = splitByRecordingFamily(records, { seed: "s", testFraction: 0.25, devFraction: 0.15 });
    expect(Object.keys(assignment)).toHaveLength(13);
    expect(counts.test.families).toBe(3);
    expect(counts.dev.families).toBe(2);
    expect(counts.train.families).toBe(8);
    expect(counts.train.records + counts.dev.records + counts.test.records).toBe(records.length);
    const splitsPerFamily = new Map<string, Set<string>>();
    for (const record of records) {
      const set = splitsPerFamily.get(record.recordingFamilyId) ?? new Set();
      set.add(assignment[record.recordingFamilyId]);
      splitsPerFamily.set(record.recordingFamilyId, set);
    }
    for (const set of splitsPerFamily.values()) expect(set.size).toBe(1);
  });

  it("is stable under the order of the records and under repeats, and the seed changes it", () => {
    const options = { seed: "seed-1", testFraction: 0.3 };
    const first = splitByRecordingFamily(records, options);
    expect(splitByRecordingFamily([...records].reverse(), options)).toEqual(first);
    expect(splitByRecordingFamily(records, options)).toEqual(first);
    const shuffled = [...records].sort((a, b) => (a.id.charCodeAt(5) % 7) - (b.id.charCodeAt(5) % 7));
    expect(splitByRecordingFamily(shuffled, options).assignment).toEqual(first.assignment);
    const others = Array.from({ length: 8 }, (_, i) => splitByRecordingFamily(records, { ...options, seed: `other-${i}` }).assignment);
    expect(others.some((assignment) => JSON.stringify(assignment) !== JSON.stringify(first.assignment))).toBe(true);
  });

  it("keeps a song in train when there's one, and holds out at least one when asked and possible", () => {
    const one = records.filter((r) => r.recordingFamilyId === "song_song-0");
    expect(splitByRecordingFamily(one, { seed: "s", testFraction: 0.5 }).counts.train.families).toBe(1);
    const two = records.filter((r) => ["song_song-0", "song_song-1"].includes(r.recordingFamilyId));
    const result = splitByRecordingFamily(two, { seed: "s", testFraction: 0.1, devFraction: 0.9 });
    expect(result.counts.train.families).toBe(1);
    expect(result.counts.dev.families + result.counts.test.families).toBe(1);
    expect(splitByRecordingFamily(records, { seed: "s", testFraction: 0 }).counts.test.families).toBe(0);
    expect(splitByRecordingFamily(records, { seed: "s", testFraction: 1 }).counts.train.families).toBe(1);
  });
});

describe("recordingFamilyId", () => {
  it("is the song, however it's spelled in the mix", () => {
    expect(recordingFamilyId("You & Me & the Radio")).toBe("song_you-me-the-radio");
    expect(recordingFamilyId("I'd Like To Know")).toBe("song_i-d-like-to-know");
    expect(recordingFamilyId("???")).toMatch(/^song_[0-9a-f]{16}$/);
  });
});
