/**
 * What the Playlist's keys, menus and drags do (`docs/fl-studio/playlist.md`): each reads the stores and
 * makes one edit of the song, with the operations of `shared/music/playlist.ts`. As in FL Studio, a command
 * acts on the selected clips, or on all of them when none are selected.
 */
import { clamp } from "@shared/math";
import { clonePattern, movePatterns, removePattern, renamePattern, setPatternColor, updateChannel } from "@shared/music/edits";
import {
  type ClipContext,
  type NewClip,
  clipBounds,
  clipContext,
  clipLength,
  chopClips,
  clipsInTime,
  copyClips,
  deleteSpace,
  deleteTrack,
  duplicateClips,
  editClips,
  insertSpace,
  insertTrack,
  makeUnique,
  moveClips,
  moveTrack,
  orAllClips,
  pasteClips,
  quantizeClips,
  removeClips,
  setClipProps,
  soloTrack,
  songTicks,
  splitByChannel,
  updateTrack,
} from "@shared/music/playlist";
import { stepsPerBar } from "@shared/music/project";
import { type MusicProject, PPQ, type PlaylistClip, STEP_TICKS } from "@shared/music/types";
import { openPianoRoll } from "../piano/actions";
import { snapTicks } from "../piano/geometry";
import { positionNow } from "../playhead";
import { currentPattern, useMusic } from "../store";
import { switchMode, useTransport } from "../transport";
import { useMusicUi } from "../ui";
import { applyDrag, rectSelection } from "./drag";
import { fadeOutClips } from "./fades";
import { MAX_PX_PER_TICK, MIN_PX_PER_TICK, type TrackLayout, minPxPerTick, shownTracks, trackLayout, zoomAt, zoomToRange } from "./geometry";
import { type PickMode, pickPattern } from "./picks";
import { type ClipSource, type PlaylistTool, usePlaylist } from "./store";

export interface PlaylistContext {
  song: MusicProject;
  ctx: ClipContext;
  clips: PlaylistClip[];
  /** The selected clips that are still there (an undo may have taken some away). */
  selected: Set<number>;
  /** The snap's grid, in ticks. */
  grid: number;
  barTicks: number;
  beatTicks: number;
  /** How many tracks are shown, and where each is. */
  trackCount: number;
  layout: TrackLayout;
}

/** Everything a command needs, as things are now; null with no song. */
export function playlistContext(): PlaylistContext | null {
  const { history } = useMusic.getState();
  if (!history) return null;
  const song = history.doc;
  const playlist = usePlaylist.getState();
  const { view } = playlist;
  const ctx = clipContext(song);
  const { clips, tracks } = song.playlist;
  const [, unit] = song.settings.timeSignature;
  const trackCount = shownTracks(clips, tracks, view.trackHeight, view.scrollY, playlist.gridHeight);
  let selected = new Set<number>();
  if (playlist.selected.size) {
    const there = new Set(clips.map((c) => c.id));
    selected = new Set([...playlist.selected].filter((id) => there.has(id)));
  }
  return {
    song,
    ctx,
    clips,
    selected,
    grid: snapTicks(playlist.snap, view.pxPerTick, ctx.barTicks, (PPQ * 4) / unit),
    barTicks: stepsPerBar(song.settings.timeSignature) * STEP_TICKS,
    beatTicks: (PPQ * 4) / unit,
    trackCount,
    layout: trackLayout(tracks, trackCount, view.trackHeight),
  };
}

/** Make an edit of the clips (one undo step). */
function edit(update: (clips: PlaylistClip[], ctx: ClipContext) => PlaylistClip[]) {
  useMusic.getState().commit((song) => editClips(song, update));
}

/** Finish the drag in progress: its edit is made (one undo step), or its rectangle becomes the selection. */
export function commitDrag() {
  const playlist = usePlaylist.getState();
  const { drag } = playlist;
  const p = playlistContext();
  usePlaylist.setState({ drag: null });
  if (!drag || !p) return;
  if (drag.kind === "rect") return playlist.select(rectSelection(p.clips, drag, p.selected, p.ctx));
  if (drag.kind === "playback") return;
  const result = applyDrag(p.clips, drag, p.ctx);
  if (result.clips === p.clips) return;
  edit(() => result.clips);
  // Copies take the selection with them. (What's drawn isn't selected, as in the Piano roll: the next click draws again.)
  if (drag.kind === "move" && drag.clone) playlist.select(result.created);
  if (drag.kind === "erase") playlist.select([...p.selected].filter((id) => !drag.ids.has(id)));
}

export const cancelDrag = () => usePlaylist.setState({ drag: null });

// ---------------------------------------------------------------------------
// The clip source
// ---------------------------------------------------------------------------

/** What Draw and Paint add: the source chosen, else the pattern shown (if it's still there). */
export function clipSource(song: MusicProject): ClipSource {
  const { source } = usePlaylist.getState();
  const there = source && (source.kind === "pattern" ? song.patterns.some((p) => p.id === source.ref) : song.channels.some((c) => c.id === source.ref && c.kind === "audio"));
  if (source && there) return source;
  return { kind: "pattern", ref: currentPattern(song, useMusic.getState().patternId).id };
}

/** Choose what Draw and Paint add; a pattern also becomes the pattern shown (the rack and the Piano roll), as in FL Studio. */
export function chooseSource(source: ClipSource) {
  usePlaylist.setState({ source });
  if (source.kind === "pattern" && useMusic.getState().patternId !== source.ref) useMusic.getState().selectPattern(source.ref);
}

/** A new clip of the source at a tick and track, as long as it is (a pattern clip follows its pattern). */
export function newClip(song: MusicProject, source: ClipSource, start: number, track: number): NewClip {
  if (source.kind === "pattern") return { kind: "pattern", ref: source.ref, track, start, length: null };
  // An audio clip as long as the last one of its channel, or its file.
  const ctx = clipContext(song);
  const like = song.playlist.clips.find((c) => c.kind === "audio" && c.ref === source.ref);
  const asset = useMusic.getState().assets.find((a) => a.id === song.channels.find((c) => c.id === source.ref)?.sampleId);
  const length = like ? clipLength(like, ctx) : Math.max(STEP_TICKS, Math.round((asset?.duration ?? 2) / ctx.secondsPerTick));
  return { kind: "audio", ref: source.ref, track, start, length, offset: like?.offset ?? 0 };
}

// ---------------------------------------------------------------------------
// Selecting
// ---------------------------------------------------------------------------

export function selectAll() {
  const p = playlistContext();
  if (p) usePlaylist.getState().select(p.clips.map((c) => c.id));
}

/** Deselect: the clips, and the time selection with them. */
export const deselect = () => usePlaylist.setState({ selected: new Set(), time: null });

export function invertSelection() {
  const p = playlistContext();
  if (p) usePlaylist.getState().select(p.clips.filter((c) => !p.selected.has(c.id)).map((c) => c.id));
}

/** Select a range of time (the red range on the ruler) and the clips in it. */
export function selectTime(start: number, end: number) {
  const p = playlistContext();
  if (!p) return;
  const range = { start: Math.max(0, Math.min(start, end)), end: Math.max(start, end) };
  if (range.end <= range.start) return usePlaylist.setState({ time: null });
  usePlaylist.setState({ time: range, selected: new Set(clipsInTime(p.clips, range.start, range.end, p.ctx)) });
}

/** Ctrl+Enter: the time selection becomes what the selected clips span. */
export function selectTimeAroundClips() {
  const p = playlistContext();
  const bounds = p && clipBounds(p.clips, p.ctx, orAllClips(p.clips, p.selected));
  if (bounds) usePlaylist.setState({ time: { start: bounds.start, end: bounds.end } });
}

/** Ctrl+← / →: the time selection moves by its own length. */
export function shiftTime(direction: -1 | 1) {
  const { time } = usePlaylist.getState();
  if (!time) return;
  const by = (time.end - time.start) * direction;
  if (time.start + by >= 0) selectTime(time.start + by, time.end + by);
}

/** Shift+C: every clip of the same source as the selected ones. */
export function selectSimilar() {
  const p = playlistContext();
  if (!p) return;
  const sources = new Set(p.clips.filter((c) => p.selected.has(c.id)).map((c) => `${c.kind}:${c.ref}`));
  if (!sources.size) {
    const source = clipSource(p.song);
    sources.add(`${source.kind}:${source.ref}`);
  }
  usePlaylist.getState().select(p.clips.filter((c) => sources.has(`${c.kind}:${c.ref}`)).map((c) => c.id));
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** Delete: the selection, or every clip when nothing is selected (as FL Studio does). */
export function deleteSelected() {
  const p = playlistContext();
  if (!p?.clips.length) return;
  const gone = orAllClips(p.clips, p.selected);
  fadeOutClips(p.clips.filter((c) => gone.has(c.id)), p.selected);
  edit((clips) => removeClips(clips, gone));
  usePlaylist.getState().select([]);
}

export function copy() {
  const p = playlistContext();
  if (p) usePlaylist.setState({ copied: copyClips(p.clips, orAllClips(p.clips, p.selected)) });
}

export function cut() {
  copy();
  deleteSelected();
}

/** Paste at the first bar in view, on the clips' own tracks; what's pasted is selected. */
export function paste() {
  const p = playlistContext();
  const { copied, view } = usePlaylist.getState();
  if (!p || !copied?.length) return;
  const at = Math.ceil(view.scrollTick / p.barTicks - 1e-9) * p.barTicks;
  const result = pasteClips(p.clips, copied, at);
  if (!result.created.length) return;
  edit(() => result.clips);
  usePlaylist.getState().select(result.created);
}

/** Ctrl+B: duplicate to the right; the copies are selected, and the time selection moves with them. */
export function duplicate() {
  const p = playlistContext();
  if (!p) return;
  const { time } = usePlaylist.getState();
  const result = duplicateClips(p.clips, p.selected, p.grid, p.ctx, time ? time.end - time.start : undefined);
  if (!result.created.length) return;
  edit(() => result.clips);
  usePlaylist.setState({ selected: new Set(result.created), time: time && { start: time.start + result.interval, end: time.end + result.interval } });
}

/** Shift+← / →: a snap unit along; Shift+↑ / ↓: a track up or down. Every clip, if none is selected. */
export function nudge(snaps: number, tracks: number) {
  const p = playlistContext();
  if (p) edit((clips, ctx) => moveClips(clips, orAllClips(clips, p.selected), snaps * p.grid, tracks, ctx));
}

export function setMuted(muted: boolean) {
  const p = playlistContext();
  if (p) edit((clips) => setClipProps(clips, orAllClips(clips, p.selected), { muted }));
}

/** Quick quantize: the clips' starts onto the snap's grid (a step, when snap is off). */
export function quantize() {
  const p = playlistContext();
  if (p) edit((clips) => quantizeClips(clips, p.selected, p.grid > 1 ? p.grid : STEP_TICKS));
}

/** Ctrl+Ins (`slice`: Ctrl+Alt+Ins): space the time selection's length, at its start. */
export function insertTimeSpace(slice: boolean) {
  const { time } = usePlaylist.getState();
  if (time) edit((clips, ctx) => insertSpace(clips, time.start, time.end, ctx, slice));
}

/** Ctrl+Del: what's in the time selection goes, and the rest closes up. */
export function deleteTimeSpace() {
  const { time } = usePlaylist.getState();
  if (!time) return;
  edit((clips, ctx) => deleteSpace(clips, time.start, time.end, ctx));
  usePlaylist.setState({ selected: new Set() });
}

/** The clip's menu: Make unique (a pattern of its own). */
export function makeClipUnique(clipId: number) {
  useMusic.getState().commit((song) => makeUnique(song, clipId));
}

/** The clip menu's Chop: the clip cut at every `every` ticks of the song (a bar, a beat...); the pieces are selected. */
export function chopClip(clipId: number, every: number) {
  const p = playlistContext();
  if (!p) return;
  const result = chopClips(p.clips, new Set([clipId]), every, p.ctx);
  if (!result.created.length) return;
  edit(() => result.clips);
  usePlaylist.getState().select([clipId, ...result.created]);
}

/** Rename a clip's source (its pattern, or its audio clip's channel): every clip of it shows the name. */
export function renameSource(source: ClipSource, name: string) {
  useMusic.getState().commit((song) => (source.kind === "pattern" ? renamePattern(song, source.ref, name) : updateChannel(song, source.ref, { name })));
}

/** Colour a clip's source ("#rrggbb", or null for the usual): every clip of it takes the colour. */
export function recolorSource(source: ClipSource, color: string | null) {
  useMusic.getState().commit((song) => (source.kind === "pattern" ? setPatternColor(song, source.ref, color) : updateChannel(song, source.ref, { color })));
}

/** Split by channel (the pattern's menu, the Picker's): one pattern per channel, its clips with it. One undo step. */
export function splitPattern(patternId: string) {
  const before = useMusic.getState().history?.doc;
  useMusic.getState().commit((song) => splitByChannel(song, patternId));
  const after = useMusic.getState().history?.doc;
  if (!before || !after || after === before) return;
  // The pattern shown was split: show its first part.
  const first = after.patterns.find((p) => !before.patterns.some((b) => b.id === p.id));
  if (first && useMusic.getState().patternId === patternId) useMusic.getState().selectPattern(first.id);
  usePlaylist.setState({ source: null, selected: new Set() });
}

/** The clips of these patterns fade out (the patterns are going, and their clips with them). */
function fadeClipsOf(patternIds: string[]) {
  const p = playlistContext();
  const ids = new Set(patternIds);
  if (p) fadeOutClips(p.clips.filter((c) => c.kind === "pattern" && ids.has(c.ref)), p.selected);
}

/** Delete a pattern from the Picker: it and its clips (a song keeps one pattern). */
export function deletePattern(patternId: string) {
  fadeClipsOf([patternId]);
  useMusic.getState().commit((song) => removePattern(song, patternId));
}

// ---------------------------------------------------------------------------
// The Picker's patterns
// ---------------------------------------------------------------------------

/**
 * The patterns selected in the Picker that are still there, in the song's order; with none selected,
 * the clip source's pattern (what a plain click picks), so its menu and keys always have something.
 */
export function pickedPatterns(song: MusicProject): string[] {
  const { patternSelection } = usePlaylist.getState();
  const picked = song.patterns.filter((p) => patternSelection.has(p.id)).map((p) => p.id);
  if (picked.length) return picked;
  const source = clipSource(song);
  return source.kind === "pattern" ? [source.ref] : [];
}

/** A click on a pattern in the Picker: alone it's the clip source too; ⌘ toggles it, Shift takes a range. */
export function clickPattern(patternId: string, mode: PickMode) {
  const song = useMusic.getState().history?.doc;
  if (!song) return;
  const { patternAnchor } = usePlaylist.getState();
  const order = song.patterns.map((p) => p.id);
  const pick = pickPattern(order, new Set(pickedPatterns(song)), patternAnchor, patternId, mode);
  usePlaylist.setState({ patternSelection: pick.selection, patternAnchor: pick.anchor });
  if (mode === "only") chooseSource({ kind: "pattern", ref: patternId });
}

/**
 * A double-click in the Picker: the Channel rack, in front, showing the pattern (it's the pattern shown,
 * as a click made it), or an audio clip's channel selected in the rack's Audio group.
 */
export function showInRack(kind: ClipSource["kind"], ref: string) {
  const ui = useMusicUi.getState();
  if (kind === "pattern") {
    useMusic.getState().selectPattern(ref);
    // Its channels, not the audio clips'.
    if (ui.rackGroup === "audio") ui.setRackGroup("unsorted");
  } else {
    ui.setSelection([ref]);
    ui.setRackGroup("audio");
  }
  ui.setRackOpen(true);
}

/** A right-click on a pattern that isn't selected: it alone is, for its menu (as lists do). */
export function pickForMenu(patternId: string) {
  const song = useMusic.getState().history?.doc;
  if (song && !pickedPatterns(song).includes(patternId)) usePlaylist.setState({ patternSelection: new Set([patternId]), patternAnchor: patternId });
}

/** Alt+↑ / ↓ (while the Picker shows), its menu's Move up / down: the selected patterns a place along the list (one undo step). */
export function movePickedPatterns(direction: -1 | 1) {
  const song = useMusic.getState().history?.doc;
  if (song && usePlaylist.getState().pickerOpen) useMusic.getState().commit((s) => movePatterns(s, pickedPatterns(song), direction));
}

/** The Picker's Transpose selected: the Transpose window, for the selected patterns. */
export function transposePickedPatterns() {
  const song = useMusic.getState().history?.doc;
  const ids = song ? pickedPatterns(song) : [];
  if (!ids.length) return;
  usePlaylist.setState({ transposing: ids });
  useMusicUi.getState().setTransposeOpen(true);
}

/** Clone the selected patterns, each copy after its original (one undo step). */
export function clonePickedPatterns() {
  const song = useMusic.getState().history?.doc;
  if (song) useMusic.getState().commit((s) => pickedPatterns(song).reduce((next, id) => clonePattern(next, id), s));
}

/** Delete the selected patterns and their clips (one undo step; a song keeps one pattern). */
export function deletePickedPatterns() {
  const song = useMusic.getState().history?.doc;
  if (!song) return;
  fadeClipsOf(pickedPatterns(song));
  useMusic.getState().commit((s) => pickedPatterns(song).reduce((next, id) => removePattern(next, id), s));
  usePlaylist.setState({ patternSelection: new Set() });
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export const renameTrack = (index: number, name: string) => useMusic.getState().commit((song) => updateTrack(song, index, { name }));
export const setTrackColor = (index: number, color: string | null) => useMusic.getState().commit((song) => updateTrack(song, index, { color }));
export const setTrackSize = (index: number, size: number) => useMusic.getState().commit((song) => updateTrack(song, index, { size }));

export function toggleTrackMute(index: number) {
  const song = useMusic.getState().history?.doc;
  if (song) useMusic.getState().commit((s) => updateTrack(s, index, { muted: !(song.playlist.tracks[index]?.muted ?? false) }));
}

export const soloPlaylistTrack = (index: number) => useMusic.getState().commit((song) => soloTrack(song, index));
export const insertPlaylistTrack = (index: number) => useMusic.getState().commit((song) => insertTrack(song, index));
export function deletePlaylistTrack(index: number) {
  const p = playlistContext();
  if (p) fadeOutClips(p.clips.filter((c) => c.track === index), p.selected);
  useMusic.getState().commit((song) => deleteTrack(song, index));
}
export const movePlaylistTrack = (index: number, direction: -1 | 1) => useMusic.getState().commit((song) => moveTrack(song, index, direction));

/** Mute or unmute every clip on a track (its menu's Mute all clips / Unmute all clips). */
export function muteTrackClips(index: number, muted: boolean) {
  edit((clips) => setClipProps(clips, new Set(clips.filter((c) => c.track === index).map((c) => c.id)), { muted }));
}

export function selectTrackClips(index: number) {
  const p = playlistContext();
  if (p) usePlaylist.getState().select(p.clips.filter((c) => c.track === index).map((c) => c.id));
}

// ---------------------------------------------------------------------------
// The view and the window
// ---------------------------------------------------------------------------

export const setTool = (tool: PlaylistTool) => usePlaylist.getState().setTool(tool);

/** F5, the toolbar's button: the Playlist, in front. */
export function openPlaylist() {
  useMusicUi.getState().setPlaylistOpen(true);
}

/**
 * Open what a pattern clip plays (a double-click): the Piano roll on the channel with the most notes in it,
 * or the rack if it's only steps (FL's Automatic). Its pattern becomes the one shown.
 */
export function openClip(clip: PlaylistClip) {
  const song = useMusic.getState().history?.doc;
  if (!song) return;
  // An audio clip: its channel's settings (FL's double-click on one).
  if (clip.kind === "audio") return useMusicUi.getState().openChannelWindow(clip.ref);
  const pattern = song.patterns.find((p) => p.id === clip.ref);
  if (!pattern) return;
  useMusic.getState().selectPattern(pattern.id);
  const lists = Object.entries(pattern.notes);
  const steps = lists.every(([, notes]) => notes.every((n) => n.start % STEP_TICKS === 0 && n.length === STEP_TICKS));
  if (steps) return useMusicUi.getState().setRackOpen(true);
  const [channelId] = lists.reduce((best, entry) => (entry[1].length > best[1].length ? entry : best));
  openPianoRoll(channelId);
}

/** How far out the Playlist may zoom now: the whole song and some room, 32 bars at least (`minPxPerTick`). */
export function zoomFloor(): number {
  const song = useMusic.getState().history?.doc;
  return song ? minPxPerTick(songTicks(song), clipContext(song).barTicks, usePlaylist.getState().gridWidth) : MIN_PX_PER_TICK;
}

/** Page Up / Down: zoom about the middle of the grid. */
export function zoomBy(factor: number) {
  const { view, gridWidth, setView } = usePlaylist.getState();
  const min = zoomFloor();
  setView(zoomAt(view, gridWidth / 2, clamp(view.pxPerTick * factor, min, MAX_PX_PER_TICK), min));
}

/** Shift+1…3: four, sixteen and sixty-four bars across. Shift+4: the whole song. Shift+5: the time selection. */
export function zoomPreset(preset: 1 | 2 | 3 | 4 | 5) {
  const p = playlistContext();
  const { view, gridWidth, time, setView } = usePlaylist.getState();
  if (!p) return;
  const min = zoomFloor();
  if (preset === 5) return time ? setView(zoomToRange(view, time.start, time.end, gridWidth, min)) : undefined;
  if (preset === 4) return setView(zoomToRange(view, 0, songTicks(p.song), gridWidth, min));
  const bars = [4, 16, 64][preset - 1];
  const from = Math.floor(view.scrollTick / p.barTicks) * p.barTicks;
  setView(zoomToRange(view, from, from + bars * p.barTicks, gridWidth, min));
}

/** Shift+0: scroll so the playhead (or where play starts) is in the middle. */
export function centreOnPlayhead() {
  const { view, gridWidth, setView } = usePlaylist.getState();
  const tick = (useTransport.getState().mode === "song" ? positionNow() : null) ?? useTransport.getState().songStartTick;
  setView({ ...view, scrollTick: Math.max(0, tick - gridWidth / view.pxPerTick / 2) });
}

/** Home: play starts at the song's start (song mode). */
export const toSongStart = () => useTransport.getState().jumpSongTo(0);

/** Play from a tick of the song (the playback tool): song mode, from there. */
export function playFrom(tick: number) {
  useTransport.getState().setSongStartTick(tick);
  switchMode("song", true);
}
