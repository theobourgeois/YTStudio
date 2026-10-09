/**
 * Where a Serum channel's envelopes and LFOs are while it plays, as Serum's own window draws it (a line running
 * through the shape), pure. Serum doesn't tell a host, so it's worked out from what the engine does say: when the
 * channel's last note went down and when all were let go (`EngineScopeNotes`), with each LFO's rate, mode and phase
 * and the song's tempo. Close, not exact: Serum's own clock is its own.
 */
import { clamp } from "@shared/math";
import type { EngineScopeNotes } from "@shared/music/engine";
import { envelopeSeconds, lfoDivision, type SerumEnvelope, type SerumLfo } from "@shared/music/serum-sound";

/** A synced division ("1/4", "1/8.", "1/16 t", "bar", "2 bar") in beats (a bar is 4). */
export function divisionBeats(division: string): number | null {
  const triplet = division.endsWith(" t");
  const name = triplet ? division.slice(0, -2) : division;
  const scale = triplet ? 2 / 3 : 1;
  const bars = /^(?:(\d+(?:\.\d+)?) )?bar$/.exec(name);
  if (bars) return 4 * Number(bars[1] ?? 1) * scale;
  const note = /^1\/(\d+)(\.)?$/.exec(name);
  if (note) return (4 / Number(note[1])) * (note[2] ? 1.5 : 1) * scale;
  return null;
}

/** An LFO's cycle in seconds at `tempo`, or null if it doesn't move. */
export function lfoPeriod(lfo: Pick<SerumLfo, "sync" | "dotted" | "triplets" | "rate10x" | "controls">, tempo: number): number | null {
  const v = lfo.controls.rate.value;
  if (lfo.sync) {
    const beats = divisionBeats(lfoDivision(v, lfo));
    return beats && tempo > 0 ? (beats * 60) / tempo : null;
  }
  const hz = 100 * clamp(v, 0, 1) ** 4 * (lfo.rate10x ? 10 : 1);
  return hz > 0 ? 1 / hz : null;
}

/** The notes as they are now: `notes` was said `ago` seconds ago, and its clocks have run on since. */
export function notesNow(notes: EngineScopeNotes, ago: number): EngineScopeNotes {
  const on = (s: number) => (s < 0 ? s : s + Math.max(0, ago));
  return { held: notes.held, sinceOn: on(notes.sinceOn), sinceOff: on(notes.sinceOff) };
}

/** Whether a voice still sounds: a key is down, or the last was let go less than `release` seconds ago. */
export function sounding(notes: EngineScopeNotes, release: number): boolean {
  if (notes.sinceOn < 0) return false;
  if (notes.held > 0) return true;
  return notes.sinceOff >= 0 && notes.sinceOff < release;
}

/**
 * Where an LFO is in its shape (0 to 1), or null while no voice plays. Retrigger starts at its phase with each note;
 * Envelope runs once from there and stays at the end; Free runs on regardless (with the song's beats when it's
 * synced and the song plays, else a clock).
 */
export function lfoPosition(
  lfo: Pick<SerumLfo, "mode" | "sync" | "dotted" | "triplets" | "rate10x" | "controls">,
  notes: EngineScopeNotes,
  { tempo, release, songBeats, clock }: { tempo: number; release: number; songBeats: number | null; clock: number },
): number | null {
  if (!sounding(notes, release)) return null;
  const period = lfoPeriod(lfo, tempo);
  const phase = lfo.controls.phase.value;
  if (!period) return phase;
  // A free LFO's delay is seconds (4 × its knob); a synced one's is in Serum's own bands, left out.
  const delay = lfo.sync ? 0 : lfo.controls.delay.value * 4;
  const since = Math.max(0, notes.sinceOn - delay);
  const wrap = (x: number) => ((x % 1) + 1) % 1;
  switch (lfo.mode) {
    case "retrigger":
      return wrap(phase + since / period);
    case "envelope":
      return Math.min(1, phase + since / period);
    case "free": {
      const beats = lfo.sync ? divisionBeats(lfoDivision(lfo.controls.rate.value, lfo)) : null;
      if (beats && songBeats !== null) return wrap(phase + songBeats / beats);
      return wrap(phase + clock / period);
    }
  }
}

/** The envelope's stages in seconds: attack, hold, decay, release. */
export function envelopeTimes(env: Pick<SerumEnvelope, "controls">) {
  const c = env.controls;
  return { attack: envelopeSeconds(c.attack.value), hold: envelopeSeconds(c.hold.value), decay: envelopeSeconds(c.decay.value), release: envelopeSeconds(c.release.value) };
}

/**
 * Where a voice is in the envelope, in seconds along its drawn line (attack, hold, decay, then release from the
 * decay's end, as Serum draws it), or null while none plays. A held note waits at the decay's end (its sustain).
 */
export function envelopePosition(env: Pick<SerumEnvelope, "controls">, notes: EngineScopeNotes): number | null {
  const { attack, hold, decay, release } = envelopeTimes(env);
  if (!sounding(notes, release)) return null;
  const held = attack + hold + decay;
  if (notes.held > 0) return Math.min(notes.sinceOn, held);
  // Let go before the decay ended: the release starts from where it was (drawn from the decay's end).
  return held + Math.min(notes.sinceOff, release);
}
