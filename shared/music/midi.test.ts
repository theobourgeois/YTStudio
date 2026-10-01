import { describe, expect, it } from "vitest";
import { compileSong } from "./compile.ts";
import { addChannels, setChannelNotes, setSteps, setSwing } from "./edits.ts";
import { midiFile } from "./midi.ts";
import { addClips, editClips } from "./playlist.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "./project.ts";

const P = FIRST_PATTERN_ID;

/** A MIDI file read back: its header and each track's events at absolute ticks. */
function parse(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tracks: { tick: number; status: number; data: number[] }[][] = [];
  expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
  const header = { format: view.getUint16(8), count: view.getUint16(10), division: view.getUint16(12) };
  let at = 14;
  while (at < bytes.length) {
    expect(String.fromCharCode(...bytes.slice(at, at + 4))).toBe("MTrk");
    const end = at + 8 + view.getUint32(at + 4);
    at += 8;
    const events: { tick: number; status: number; data: number[] }[] = [];
    let tick = 0;
    const vlq = () => {
      let n = 0;
      for (;;) {
        const b = bytes[at++];
        n = (n << 7) | (b & 0x7f);
        if (!(b & 0x80)) return n;
      }
    };
    while (at < end) {
      tick += vlq();
      const status = bytes[at++];
      if (status === 0xff) {
        const type = bytes[at++];
        const length = vlq();
        events.push({ tick, status: 0xff00 | type, data: [...bytes.slice(at, at + length)] });
        at += length;
      } else {
        events.push({ tick, status, data: [bytes[at], bytes[at + 1]] });
        at += 2;
      }
    }
    tracks.push(events);
  }
  return { header, tracks };
}

const song = () =>
  setSteps(
    addChannels(createMusicProject("Beat", 120), [
      { id: "chan_kick", name: "Kick", sampleId: null },
      { id: "chan_hat", name: "Hat", sampleId: null },
    ]),
    P,
    "chan_kick",
    [0, 4, 8, 12],
    true,
  );

describe("midiFile", () => {
  it("writes a type 1 file: the tempo and time signature, then a named track per channel with notes", () => {
    const { header, tracks } = parse(midiFile(compileSong(song(), P), "Beat", [4, 4]));
    expect(header).toEqual({ format: 1, count: 2, division: 96 });
    const [conductor, kick] = tracks;
    // 120 BPM: 500 000 µs a beat; 4/4.
    expect(conductor.find((e) => e.status === 0xff51)?.data).toEqual([0x07, 0xa1, 0x20]);
    expect(conductor.find((e) => e.status === 0xff58)?.data).toEqual([4, 2, 24, 8]);
    expect(String.fromCharCode(...kick.find((e) => e.status === 0xff03)!.data)).toBe("Kick");
    // Each step a note on its tick, a step long, at C5 (60) and the default velocity.
    const ons = kick.filter((e) => (e.status & 0xf0) === 0x90);
    expect(ons.map((e) => e.tick)).toEqual([0, 96, 192, 288]);
    expect(ons[0].data).toEqual([60, Math.round(0.78 * 127)]);
    expect(kick.filter((e) => (e.status & 0xf0) === 0x80).map((e) => e.tick)).toEqual([24, 120, 216, 312]);
  });

  it("has the notes as they're heard: swung, arranged on the playlist, from a time selection on", () => {
    let swung = setSwing(setSteps(song(), P, "chan_hat", [1, 3], true), 1);
    swung = setChannelNotes(swung, P, "chan_kick", (notes) => notes.map((n) => ({ ...n, pitch: 48, velocity: 1 })));
    const pattern = parse(midiFile(compileSong(swung, P), "Beat", [4, 4]));
    // Every second step half a step late: 24 → 36, 72 → 84.
    expect(pattern.tracks[2].filter((e) => (e.status & 0xf0) === 0x90).map((e) => e.tick)).toEqual([36, 84]);
    expect(pattern.tracks[1].filter((e) => (e.status & 0xf0) === 0x90)[0].data).toEqual([48, 127]);

    // On the playlist in bars 1 and 3, exported from bar 2: the second clip's kicks, from tick 384 on.
    const arranged = editClips(song(), (clips) => addClips(clips, [{ kind: "pattern", ref: P, start: 0, track: 0 }, { kind: "pattern", ref: P, start: 768, track: 0 }]).clips);
    const part = parse(midiFile(compileSong(arranged, P, { start: 384, end: 1152 }, "song"), "Beat", [4, 4]));
    expect(part.tracks[1].filter((e) => (e.status & 0xf0) === 0x90).map((e) => e.tick)).toEqual([384, 480, 576, 672]);
  });
});
