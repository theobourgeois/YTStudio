/**
 * The music suite's document (a DAW project). It's a shell for now: a song has a name and its
 * timing, and tracks, clips and devices come next. Validated by `normalizeMusicProject`.
 */

export interface MusicSettings {
  /** Beats per minute. */
  tempo: number;
  /** Beats per bar, and the note that gets the beat ([4, 4], [6, 8]...). */
  timeSignature: [number, number];
}

export interface MusicProject {
  version: 1;
  name: string;
  settings: MusicSettings;
}
