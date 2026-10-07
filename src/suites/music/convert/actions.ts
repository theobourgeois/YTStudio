/**
 * Convert to notes in the tab (docs/fl-studio/stems-and-notes.md): its window's state, what the server heard in
 * the file (asked once, then picked again at every setting), the notes heard as a song the engine can play while
 * Preview is on (with the clip, in its time), and the conversion itself, one undo step, for the window and the
 * assistant.
 */
import { toast } from "sonner";
import { create } from "zustand";
import { createId } from "@shared/ids";
import { errorMessage } from "@shared/errors";
import { type ConvertSettings, type ConvertWindow, DEFAULT_CONVERT, addConvertedPattern, convertedParts } from "@shared/music/convert";
import { clipContext, clipLength } from "@shared/music/playlist";
import { stemOf } from "@shared/music/stems";
import { type HeardAudio, heardFromJson } from "@shared/music/transcribe";
import type { MusicProject, PlaylistClip } from "@shared/music/types";
import { musicApi } from "../api";
import { type AudioTarget, type KitSound, downloadModel, kitSample, modelStatus, targetIn } from "../ml";
import { openPianoRoll } from "../piano/actions";
import { usePiano } from "../piano/store";
import { useMusic } from "../store";
import { cancelPlayWhenSent, playWhenSent, useTransport } from "../transport";
import { useMusicWindows } from "../ui";

interface ConvertState {
  /** What the window converts, or null while it's closed. */
  target: AudioTarget | null;
  /** Its settings (kept from one conversion to the next; the kind is chosen again for each file). */
  settings: ConvertSettings;
  /** What the server heard in the target's file, once it's here. */
  heard: HeardAudio | null;
  /** The media `heard` is of. */
  heardOf: string | null;
  hearing: boolean;
  error: string | null;
  /** Preview is on: the engine plays the clip and its notes, looping. */
  previewing: boolean;
  /** Ids for what the conversion makes, the same while the window's open (so the preview's song is steady). */
  ids: { pattern: string; channels: Record<"melodic" | "kick" | "snare" | "hat", string> };
  /** The kit sounds' media (the samplers' samples), once they're the song's. */
  samples: Partial<Record<KitSound, string>>;
}

const freshIds = (): ConvertState["ids"] => ({
  pattern: createId("pat"),
  channels: { melodic: createId("chan"), kick: createId("chan"), snare: createId("chan"), hat: createId("chan") },
});

export const useConvert = create<ConvertState>(() => ({
  target: null,
  settings: DEFAULT_CONVERT,
  heard: null,
  heardOf: null,
  hearing: false,
  error: null,
  previewing: false,
  ids: freshIds(),
  samples: {},
}));

// What's kept is the open song's (its media, its clips): another song starts afresh, the window closed.
useMusic.subscribe((state, prev) => {
  if (state.projectId === prev.projectId) return;
  if (useConvert.getState().previewing) stopConvertPreview();
  useConvert.setState({ target: null, heard: null, heardOf: null, hearing: false, error: null, samples: {} });
});

/** The sounds a conversion's samplers play: the tone, or the kit's drums. */
const soundsFor = (kind: ConvertSettings["kind"]): KitSound[] => (kind === "drums" ? ["kick", "snare", "hat"] : ["tone"]);

/** Convert to notes… (an audio clip's menu, an audio channel's in the rack): its window, on the file. A drum stem starts as Drums. */
export function openConvert(target: AudioTarget) {
  const { history, assets } = useMusic.getState();
  const found = history && targetIn(history.doc, target);
  const asset = found && !("error" in found) ? assets.find((a) => a.id === found.sampleId) : undefined;
  const kind = stemOf(asset) === "drums" ? "drums" : stemOf(asset) ? "melodic" : useConvert.getState().settings.kind;
  const scale = Boolean(history?.doc.settings.scale);
  const sampleId = found && !("error" in found) ? found.sampleId : null;
  if (useConvert.getState().previewing) stopConvertPreview();
  useConvert.setState((s) => ({
    target,
    settings: { ...s.settings, kind, snapToScale: scale && s.settings.snapToScale },
    previewing: false,
    ids: freshIds(),
    error: null,
    ...(s.heardOf === sampleId ? {} : { heard: null, heardOf: null }),
  }));
  useMusicWindows.getState().focus("to-notes");
  void hearTarget();
}

export function closeConvert() {
  stopConvertPreview();
  useConvert.setState({ target: null });
}

export const setConvertSettings = (patch: Partial<ConvertSettings>) => {
  useConvert.setState((s) => ({ settings: { ...s.settings, ...patch } }));
  if (patch.kind) void readySamples(patch.kind).catch(() => {});
};

/** The window's file heard (once its model's here; the window asks for the download first). */
export async function hearTarget(): Promise<void> {
  const { target, heardOf } = useConvert.getState();
  const { projectId, history } = useMusic.getState();
  if (!target || !projectId || !history) return;
  const found = targetIn(history.doc, target);
  if ("error" in found) return void useConvert.setState({ error: found.error });
  void readySamples(useConvert.getState().settings.kind).catch(() => {});
  if (heardOf === found.sampleId) return;
  try {
    const status = await modelStatus("notes");
    if (status.status !== "ready" && !status.standIn) return;
    useConvert.setState({ hearing: true, error: null, heard: null, heardOf: null });
    const heard = heardFromJson(await musicApi.hearNotes({ projectId, sampleId: found.sampleId }));
    if (useConvert.getState().target === target) useConvert.setState({ heard, heardOf: found.sampleId });
  } catch (err) {
    useConvert.setState({ error: errorMessage(err) });
  } finally {
    useConvert.setState({ hearing: false });
  }
}

/** The window's Download: Convert to notes' model, then the file heard. */
export async function downloadConvertModel() {
  try {
    await downloadModel("notes");
    await hearTarget();
  } catch (err) {
    useConvert.setState({ error: errorMessage(err) });
  }
}

/** The kit's sounds for a kind of conversion, as the song's media (uploaded once). */
async function readySamples(kind: ConvertSettings["kind"]): Promise<Partial<Record<KitSound, string>>> {
  const samples = { ...useConvert.getState().samples };
  const assets = useMusic.getState().assets;
  for (const sound of soundsFor(kind)) if (!samples[sound] || !assets.some((a) => a.id === samples[sound])) samples[sound] = (await kitSample(sound)).id;
  useConvert.setState({ samples });
  return samples;
}

/** The part of the file a target converts, and how its seconds become the song's ticks. */
export function convertWindow(song: MusicProject, target: AudioTarget, duration: number): ConvertWindow | null {
  const found = targetIn(song, target);
  if ("error" in found) return null;
  const ctx = clipContext(song);
  if (found.clip) {
    const secondsPerTick = ctx.fileSecondsPerTick(found.clip);
    return { from: found.clip.offset, to: found.clip.offset + clipLength(found.clip, ctx) * secondsPerTick, secondsPerTick };
  }
  return { from: 0, to: duration, secondsPerTick: ctx.fileSecondsPerTick({ ref: found.channel.id, stretch: undefined }) };
}

/** What a conversion would make: each part's channel and notes (named after the source). */
export function conversion(song: MusicProject, target: AudioTarget, heard: HeardAudio, settings: ConvertSettings, ids: ConvertState["ids"], samples: Partial<Record<KitSound, string>>) {
  const found = targetIn(song, target);
  const window = convertWindow(song, target, heard.duration);
  if ("error" in found || !window) return null;
  const parts = convertedParts(heard, settings, window, song.settings.scale);
  const name = `${found.channel.name} notes`;
  const channelOf = (drum: (typeof parts)[number]["drum"]) =>
    drum === null
      ? { id: ids.channels.melodic, name, sampleId: samples.tone ?? null }
      : { id: ids.channels[drum], name: drum === "hat" ? "Hat" : drum === "kick" ? "Kick" : "Snare", sampleId: samples[drum] ?? null };
  return { pattern: { id: ids.pattern, name }, parts: parts.map((p) => ({ channel: channelOf(p.drum), notes: p.notes })), clip: found.clip, channelId: found.channel.id };
}

/**
 * While Preview is on: a song of the clip (playing, whatever its mute) and its notes' pattern under it, looping
 * over the clip's time (for a channel's whole file, the file from the start). Null when it's off.
 */
export function convertPreview(song: MusicProject) {
  const { target, heard, settings, ids, samples, previewing } = useConvert.getState();
  if (!previewing || !target || !heard) return null;
  const made = conversion(song, target, heard, settings, ids, samples);
  if (!made) return null;
  const ctx = clipContext(song);
  const source: PlaylistClip = made.clip
    ? { ...made.clip, muted: false }
    : { id: 1, kind: "audio", ref: made.channelId, track: 0, start: 0, length: Math.max(1, Math.round(heard.duration / ctx.fileSecondsPerTick({ ref: made.channelId, stretch: undefined }))), offset: 0, muted: false };
  const alone: MusicProject = { ...song, playlist: { tracks: [], clips: [source] } };
  const withNotes = addConvertedPattern(alone, made.pattern, made.parts, { clipId: source.id });
  const start = source.start;
  return { song: withNotes, loop: { start, end: start + clipLength(source, ctx) }, mode: "song" as const };
}

export function toggleConvertPreview() {
  if (useConvert.getState().previewing) return stopConvertPreview();
  useConvert.setState({ previewing: true });
  playWhenSent();
}

export function stopConvertPreview() {
  if (!useConvert.getState().previewing) return;
  cancelPlayWhenSent();
  useTransport.getState().stop();
  useConvert.setState({ previewing: false });
}

/** What a conversion made: its pattern and channels, and how many notes, or why it couldn't. */
export type ConvertResult = { patternId: string; channelIds: string[]; notes: number; name: string; highest: number } | { error: string };

/**
 * Converts a target's file with `settings` (its model must be downloaded: `downloadModel`): a pattern of the notes
 * on new samplers, placed under the clip (a channel's whole file isn't placed). One undo step.
 */
export async function convertToNotes(target: AudioTarget, settings: ConvertSettings, heard?: HeardAudio): Promise<ConvertResult> {
  const { projectId, history } = useMusic.getState();
  if (!projectId || !history) return { error: "No song is open." };
  const found = targetIn(history.doc, target);
  if ("error" in found) return found;
  try {
    const audio = heard ?? heardFromJson(await musicApi.hearNotes({ projectId, sampleId: found.sampleId }));
    const samples = await readySamples(settings.kind);
    const ids = freshIds();
    const made = conversion(history.doc, target, audio, settings, ids, samples);
    if (!made) return { error: "The clip is gone." };
    const notes = made.parts.reduce((sum, p) => sum + p.notes.length, 0);
    if (!notes) return { error: settings.kind === "drums" ? "No drum hits were heard: try more sensitivity, or Melodic." : "No notes were heard: try more sensitivity, or a stem with one instrument." };
    useMusic.getState().commit((song) => {
      const now = conversion(song, target, audio, settings, ids, samples);
      return now ? addConvertedPattern(song, now.pattern, now.parts, now.clip ? { clipId: now.clip.id } : null) : song;
    });
    const channelIds = made.parts.filter((p) => p.notes.length).map((p) => p.channel.id);
    const highest = Math.max(...made.parts.flatMap((p) => p.notes.map((n) => n.pitch)));
    return { patternId: ids.pattern, channelIds, notes, name: made.pattern.name, highest };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** The window's Convert: the notes made, their pattern shown in the Piano roll. */
export async function acceptConvert() {
  const { target, settings, heard } = useConvert.getState();
  if (!target || !heard) return;
  stopConvertPreview();
  const result = await convertToNotes(target, settings, heard);
  if ("error" in result) return void toast.error("Couldn't convert to notes", { description: result.error });
  closeConvert();
  useMusic.getState().selectPattern(result.patternId);
  openPianoRoll(result.channelIds[0]);
  // The notes in view: the highest a few rows under the top, from the pattern's start.
  const piano = usePiano.getState();
  piano.setView({ ...piano.view, scrollTick: 0, topPitch: Math.min(128, result.highest + 4) });
  toast.success(`${result.name}: ${result.notes} note${result.notes === 1 ? "" : "s"}`, {
    description: target.clipId === null ? "In a new pattern, on a sampler: replace it with any instrument." : "In a new pattern under the clip, on a sampler: replace it with any instrument.",
  });
}
