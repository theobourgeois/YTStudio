import { patternTickInSong } from "@shared/music/playlist";
import { PPQ } from "@shared/music/types";
import { currentPattern, useMusic } from "./store";
import { patternTickNow, useTransport } from "./transport";

/**
 * Where play is now in the mode playing (the pattern's ticks, or the song's), or null when it isn't playing.
 * What the toolbar's position and the Playlist's playhead show.
 */
export function positionNow(now = performance.now()): number | null {
  const song = useMusic.getState().history?.doc;
  return song ? patternTickNow(useTransport.getState(), now, song.settings.tempo, PPQ) : null;
}

/**
 * Where the pattern shown is playing now, in its own ticks: in pattern mode, where the loop is; in song
 * mode, inside the clip of it the song is playing (null where none is). What the rack's lights and the
 * Piano roll's playhead follow.
 */
export function patternPositionNow(now = performance.now()): number | null {
  const { history, patternId } = useMusic.getState();
  const playMode = useTransport.getState().mode;
  const tick = positionNow(now);
  if (!history || tick === null) return null;
  if (playMode === "pattern") return tick;
  return patternTickInSong(history.doc, currentPattern(history.doc, patternId).id, tick);
}
