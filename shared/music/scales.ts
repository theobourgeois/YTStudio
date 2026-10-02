/**
 * Scales and chords (`docs/fl-studio/piano-roll.md`): the song's scale, which the Piano roll highlights
 * and snaps new and moved notes to (FL's scale highlighting and Snap to scale), and the chords FL's
 * Stamp tool places with one click. Pure, so it's tested.
 */

/** The scales a song can be in, by the semitones of each degree above the root. */
export const SCALES = [
  { id: "major", name: "Major (ionian)", steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", name: "Minor (aeolian)", steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: "harmonicMinor", name: "Harmonic minor", steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodicMinor", name: "Melodic minor", steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: "dorian", name: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian", name: "Phrygian", steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian", name: "Lydian", steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: "mixolydian", name: "Mixolydian", steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: "locrian", name: "Locrian", steps: [0, 1, 3, 5, 6, 8, 10] },
  { id: "phrygianDominant", name: "Phrygian dominant", steps: [0, 1, 4, 5, 7, 8, 10] },
  { id: "majorPentatonic", name: "Major pentatonic", steps: [0, 2, 4, 7, 9] },
  { id: "minorPentatonic", name: "Minor pentatonic", steps: [0, 3, 5, 7, 10] },
  { id: "blues", name: "Blues", steps: [0, 3, 5, 6, 7, 10] },
  { id: "wholeTone", name: "Whole tone", steps: [0, 2, 4, 6, 8, 10] },
] as const;
export type ScaleId = (typeof SCALES)[number]["id"];
export const isScaleId = (value: unknown): value is ScaleId => SCALES.some((s) => s.id === value);

/** A song's scale: its root (0 is C .. 11 is B) and its kind. */
export interface SongScale {
  root: number;
  type: ScaleId;
}

/** The notes' names in an octave, from C. */
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const stepsOf = (scale: SongScale): readonly number[] => SCALES.find((s) => s.id === scale.type)?.steps ?? SCALES[0].steps;
const degree = (scale: SongScale, pitch: number) => (((pitch - scale.root) % 12) + 12) % 12;

/** Its name: "A Minor (aeolian)". */
export const scaleName = (scale: SongScale) => `${NOTE_NAMES[scale.root]} ${SCALES.find((s) => s.id === scale.type)?.name ?? scale.type}`;

/** Whether a pitch is one of the scale's notes. */
export const inScale = (scale: SongScale, pitch: number) => stepsOf(scale).includes(degree(scale, pitch));

/** Whether a pitch is the scale's root. */
export const isRoot = (scale: SongScale, pitch: number) => degree(scale, pitch) === 0;

/** The nearest of the scale's notes to a pitch (the lower one when two are as near), within MIDI's range. */
export function snapToScale(scale: SongScale, pitch: number): number {
  for (let distance = 0; distance < 12; distance++) {
    if (pitch - distance >= 0 && inScale(scale, pitch - distance)) return pitch - distance;
    if (pitch + distance <= 127 && inScale(scale, pitch + distance)) return pitch + distance;
  }
  return pitch;
}

/** The chords the Stamp places (FL's Stamp: chords, by semitones above the note clicked), then chords made of the scale's own notes. */
export const CHORDS = [
  { id: "major", name: "Major", intervals: [0, 4, 7] },
  { id: "minor", name: "Minor", intervals: [0, 3, 7] },
  { id: "diminished", name: "Diminished", intervals: [0, 3, 6] },
  { id: "augmented", name: "Augmented", intervals: [0, 4, 8] },
  { id: "sus2", name: "Sus2", intervals: [0, 2, 7] },
  { id: "sus4", name: "Sus4", intervals: [0, 5, 7] },
  { id: "power", name: "Power (5th)", intervals: [0, 7] },
  { id: "octave", name: "Octave", intervals: [0, 12] },
  { id: "major6", name: "Major 6th", intervals: [0, 4, 7, 9] },
  { id: "minor6", name: "Minor 6th", intervals: [0, 3, 7, 9] },
  { id: "dominant7", name: "Dominant 7th", intervals: [0, 4, 7, 10] },
  { id: "major7", name: "Major 7th", intervals: [0, 4, 7, 11] },
  { id: "minor7", name: "Minor 7th", intervals: [0, 3, 7, 10] },
  { id: "minorMajor7", name: "Minor major 7th", intervals: [0, 3, 7, 11] },
  { id: "halfDiminished", name: "Half-diminished (m7♭5)", intervals: [0, 3, 6, 10] },
  { id: "diminished7", name: "Diminished 7th", intervals: [0, 3, 6, 9] },
  { id: "add9", name: "Add 9", intervals: [0, 4, 7, 14] },
  { id: "minorAdd9", name: "Minor add 9", intervals: [0, 3, 7, 14] },
  { id: "dominant9", name: "Dominant 9th", intervals: [0, 4, 7, 10, 14] },
  { id: "major9", name: "Major 9th", intervals: [0, 4, 7, 11, 14] },
  { id: "minor9", name: "Minor 9th", intervals: [0, 3, 7, 10, 14] },
  { id: "minor11", name: "Minor 11th", intervals: [0, 3, 7, 10, 14, 17] },
  { id: "dominant13", name: "Dominant 13th", intervals: [0, 4, 7, 10, 14, 21] },
] as const;

/** What the Stamp can place: a chord, or a triad or seventh of the song's scale (FL's Melodic scales) from the note clicked. */
export const SCALE_STAMPS = [
  { id: "scaleTriad", name: "Triad of the scale" },
  { id: "scaleSeventh", name: "Seventh of the scale" },
] as const;
export type StampId = (typeof CHORDS)[number]["id"] | (typeof SCALE_STAMPS)[number]["id"];
export const isStampId = (value: unknown): value is StampId => CHORDS.some((c) => c.id === value) || SCALE_STAMPS.some((s) => s.id === value);
export const stampName = (id: StampId) => (CHORDS.find((c) => c.id === id) ?? SCALE_STAMPS.find((s) => s.id === id))?.name ?? id;

/**
 * The pitches a stamp places from `pitch` (its lowest note, FL's bottom-up), within MIDI's range. A
 * scale's triad or seventh stacks every other note of the song's scale from the scale note nearest the
 * one clicked (the major scale on it, when the song has none).
 */
export function stampPitches(stamp: StampId, pitch: number, scale: SongScale | null | undefined): number[] {
  const chord = CHORDS.find((c) => c.id === stamp);
  if (chord) return chord.intervals.map((i) => pitch + i).filter((p) => p >= 0 && p <= 127);
  const key = scale ?? { root: ((pitch % 12) + 12) % 12, type: "major" as const };
  const notes = stamp === "scaleSeventh" ? 4 : 3;
  const pitches: number[] = [];
  let at = snapToScale(key, pitch);
  for (let i = 0; i < notes && at <= 127; i++) {
    pitches.push(at);
    // Two scale notes up: the next third of the scale.
    for (let skip = 0; skip < 2; skip++) {
      at++;
      while (at <= 127 && !inScale(key, at)) at++;
    }
  }
  return pitches;
}
