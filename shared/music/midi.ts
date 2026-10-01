/**
 * The song's notes as a Standard MIDI File (the export's MID): what `compileSong` makes of it, so it's
 * the notes as they're heard (swing, the playlist's arrangement, a time selection, mutes) on the same
 * ticks (`PPQ` to a quarter note). Type 1: the tempo and time signature, then a track per channel with
 * notes, named after it.
 */
import type { EngineSong } from "./compile.ts";

/** A number as MIDI's variable-length quantity. */
function variableLength(value: number): number[] {
  let n = Math.max(0, Math.round(value));
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

const text = (value: string) => [...new TextEncoder().encode(value.slice(0, 120))];

/** A track chunk from events at absolute ticks (sorted here: note-offs before note-ons on the same tick). */
function trackChunk(events: { tick: number; order: number; bytes: number[] }[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const event of events) {
    body.push(...variableLength(event.tick - last), ...event.bytes);
    last = event.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00);
  return [0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 0xff, (body.length >>> 16) & 0xff, (body.length >>> 8) & 0xff, body.length & 0xff, ...body];
}

/** `song` (compiled) as a MIDI file named `name`; `timeSignature` as the song's settings say. */
export function midiFile(song: Pick<EngineSong, "tempo" | "ppq" | "loopTicks" | "channels" | "notes">, name: string, timeSignature: [number, number]): Uint8Array {
  const [beats, unit] = timeSignature;
  const microseconds = Math.round(60_000_000 / song.tempo);
  const conductor = trackChunk([
    { tick: 0, order: 0, bytes: [0xff, 0x03, ...variableLength(text(name).length), ...text(name)] },
    { tick: 0, order: 1, bytes: [0xff, 0x51, 0x03, (microseconds >> 16) & 0xff, (microseconds >> 8) & 0xff, microseconds & 0xff] },
    { tick: 0, order: 2, bytes: [0xff, 0x58, 0x04, beats & 0xff, Math.max(0, Math.round(Math.log2(unit))), 24, 8] },
    // The song's end, so a sequencer reading it knows its length.
    { tick: Math.round(song.loopTicks), order: 3, bytes: [0xff, 0x01, ...variableLength(3), ...text("End")] },
  ]);

  const tracks: number[][] = [];
  song.channels.forEach((channel, index) => {
    const notes = song.notes.filter((n) => n.channel === index);
    if (!notes.length) return;
    const events = [{ tick: 0, order: 0, bytes: [0xff, 0x03, ...variableLength(text(channel.name).length), ...text(channel.name)] }];
    for (const note of notes) {
      const key = Math.max(0, Math.min(127, Math.round(note.key)));
      const velocity = Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
      const start = Math.max(0, Math.round(note.tick));
      const end = Math.max(start + 1, Math.round(note.tick + note.length));
      events.push({ tick: start, order: 2, bytes: [0x90, key, velocity] });
      events.push({ tick: end, order: 1, bytes: [0x80, key, 0] });
    }
    tracks.push(trackChunk(events));
  });

  const count = tracks.length + 1;
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (count >> 8) & 0xff, count & 0xff, (song.ppq >> 8) & 0xff, song.ppq & 0xff];
  return Uint8Array.from([...header, ...conductor, ...tracks.flat()]);
}
