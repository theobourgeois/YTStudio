/**
 * Every assistant tool, run in the editor tab (see `shared/assistant-tools.ts`
 * for what each one is, and `bridge.ts` for how calls arrive). A call acts on
 * its chat's video (`doc.ts`): when it's the open one, edits go through the
 * editor store like the user's own (one undo step each, the changed clips
 * highlighted); otherwise on a background copy of it. Looking and slower
 * actions use the same stores and API as the rest of the app.
 */
import type { VideoToolName } from "@shared/assistant-tools";
import { type ToolContent, type ToolResult, textResult } from "@shared/tool-spec";
import { type SignalSource, resolveSource, usesSignals } from "@shared/audio-signals";
import { beatMarkerCount, beatMarks, setBeatMarkers } from "@shared/beat-sync";
import { captionClips, captionSourceClips } from "@shared/captions";
import { isRemapped } from "@shared/effects";
import { clipMarkers } from "@shared/markers";
import { errorMessage } from "@shared/errors";
import { describeExport, exportFormat, exportSettings } from "@shared/export-formats";
import { formatBytes, formatDuration } from "@shared/format";
import { sameName, templateFromClips, templateFromSubclip } from "@shared/library";
import { clamp } from "@shared/math";
import { getSequence, writeSequence } from "@shared/sequences";
import { getSubclip } from "@shared/subclips";
import { placeTemplate } from "@shared/library";
import { clipEnd, getClip, projectDuration, timelineTime, outputSize } from "@shared/timeline";
import type { Clip, ExportJob, ExportResolution, Library, MediaAsset, Project, RenderJob, TranscriptionEngineId, TranscriptionJob } from "@shared/types";
import { layoutTexts } from "@/components/export/layout-texts";
import { clipsOnCanvas } from "@/components/preview/placement";
import { fontsSettled } from "@/stores/fonts";
import { describeLayout } from "./layout";
import { api } from "@/lib/api";
import { useAssistant } from "@/stores/assistant";
import { type CaptionOptions, captionsFor, useCaptions } from "@/stores/captions";
import { placeAssets, useEditor } from "@/stores/editor";
import { assetMarkedRange } from "@/stores/source-marks";
import { useLibrary } from "@/stores/library";
import { usePlayback } from "@/stores/playback";
import { useRenderFiles } from "@/stores/render-files";
import { RENDER_RESOLUTION } from "@shared/render-files";
import {
  type CatalogKind,
  describeCatalog,
  describeClips,
  describeLibrary,
  describeMedia,
  describeMusic,
  describeTimeline,
  describeTranscript,
} from "./describe";
import { type ToolDoc, docFor } from "./doc";
import { compileShader } from "@/lib/shader-compiler";
import { EDITS, clipChanges } from "./edits";
import { mediaFrames, offscreenFrames, programFrames } from "./frames";
import { describeSignals, eventTimes } from "./describe-signals";
import { contactSheet, plotSignals, readerFor } from "./signals";
import {
  type Input,
  ToolError,
  oneOf,
  optBoolean,
  optNumber,
  optNumbers,
  optString,
  optStrings,
  range,
  secs,
  string,
  strings,
} from "./input";
import { log } from "@/lib/log";
import { type Frame, LIVE_LOOKS, NO_FX, liveLook } from "@shared/live-looks";
import { type NowPlayingUnavailable, positionAt } from "@shared/now-playing";
import { EFFECTS_MODES } from "@/components/now-playing-view/effects-engine";
import { AUTO_SWITCHES, PACE, paceLabel, paceOf, useVisualizerPrefs } from "@/components/now-playing-view/prefs";
import { useLookRatings } from "@/components/now-playing-view/look-ratings";
import { useVisualizerMedia } from "@/components/now-playing-view/media-library";
import { useNowPlaying } from "@/stores/now-playing";

/** What the music player's `unavailable` means, for the model. */
const UNAVAILABLE: Record<NowPlayingUnavailable, string> = {
  off: "the user turned Now Playing off (Settings › General).",
  unsupported: "there's no music player this app can ask on this computer (Spotify on a Mac).",
  "not-running": "Spotify isn't open.",
  "not-allowed": "macOS hasn't allowed the app to control Spotify (System Settings › Privacy & Security › Automation).",
  error: "it didn't answer.",
};

const logger = log("assistant");

export interface ToolContext {
  /** The chat the call is for (its video's id), or null for an agent outside the app (the open video). */
  chat: string | null;
  /** The chat's assistant message it's part of. */
  turn: string | null;
  signal: AbortSignal;
  progress: (fraction: number | null, label?: string) => void;
}

interface HandlerContext extends ToolContext {
  /** The video the call acts on (loaded on first use: most tools need it, a few don't). */
  doc: () => Promise<ToolDoc>;
}

type Handler = (input: Input, ctx: HandlerContext) => ToolResult | Promise<ToolResult>;

const POLL_MS = 500;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const byId = (assets: readonly MediaAsset[]) => Object.fromEntries(assets.map((a) => [a.id, a]));

/** What a tool's `source` names, in the sequence the call is in. */
function signalSource(doc: ToolDoc, name: string | undefined): SignalSource {
  try {
    return resolveSource(doc.project, name);
  } catch (err) {
    throw new ToolError(errorMessage(err));
  }
}

/** Edits wait for the user to finish a drag, so neither loses theirs. */
function gesturesSettled(signal: AbortSignal): Promise<void> {
  if (!useEditor.getState().gestureBase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const off = useEditor.subscribe((s) => {
      if (s.gestureBase) return;
      off();
      resolve();
    });
    signal.addEventListener("abort", () => {
      off();
      reject(new ToolError("Stopped."));
    });
  });
}

/** Report an edit: highlight what changed (when it's on screen). */
function finishEdit(doc: ToolDoc, before: Project) {
  const after = doc.project;
  const changes = clipChanges(before, after);
  if (doc.isOpen) useAssistant.getState().highlight([...changes.added, ...changes.changed]);
  return changes;
}

/** Edits that place things on the sound or say what they do to it: they're given its signals. */
const HEARING_EDITS = new Set<string>(["link_param", "define_signal", "set_events"]);
const hears = (name: string, input: Input) =>
  HEARING_EDITS.has(name) || (name === "batch" && Array.isArray(input.steps) && input.steps.some((s) => HEARING_EDITS.has((s as Input | null)?.tool as string)));

/** An edit tool: its pure edit, committed as one undo step. */
const edit =
  (name: keyof typeof EDITS): Handler =>
  async (input, ctx) => {
    const doc = await ctx.doc();
    // The sound first (it may need analysing), then the edit on the video as it is then.
    const store = hears(name, input) ? (await readerFor(doc, ctx)).store : null;
    if (doc.isOpen) await gesturesSettled(ctx.signal);
    const before = doc.project;
    const signals = store && { store, document: (view: Project) => writeSequence(doc.document, doc.sequenceId, view) };
    const out = EDITS[name](before, input, {
      assets: byId(doc.assets),
      playhead: doc.playhead,
      sequenceId: doc.sequenceId,
      compile: compileShader,
      ...(signals && { signals }),
    });
    doc.commit(out.project);
    if (out.rename) doc.rename(out.rename);
    return textResult(out.text, finishEdit(doc, before));
  };

function clipsOf(project: Project, ids: string[]): Clip[] {
  return ids.map((id) => {
    const clip = getClip(project, id);
    if (!clip) throw new ToolError(`There's no clip "${id}". Call get_timeline for the current ids.`);
    return clip;
  });
}

/** The first transcription engine that's ready (or the one asked for, if it is). */
async function readyEngine(asked?: TranscriptionEngineId): Promise<TranscriptionEngineId> {
  const engines = await api.listTranscriptionEngines();
  const pick = asked ? engines.find((e) => e.id === asked) : engines.find((e) => e.status === "ready");
  if (pick?.status === "ready") return pick.id;
  if (asked && pick) throw new ToolError(`The ${pick.label} transcription engine isn't set up: ${pick.message ?? pick.status}.`);
  throw new ToolError(
    "No transcription engine is set up yet. Ask the user to set one up: Captions tab > Auto captions (on this computer, or with an OpenAI or Groq key).",
  );
}

/** Transcribe clips' sound (waiting for it, with progress). */
async function transcribe(clips: readonly Clip[], engine: TranscriptionEngineId, language: string, ctx: ToolContext): Promise<TranscriptionJob> {
  let job = await api.startTranscription({ engine, language, sources: clips.map((c) => ({ assetId: c.assetId, in: c.in, out: c.out })) });
  ctx.signal.addEventListener("abort", () => void api.cancelTranscription(job.id).catch(() => {}));
  while (job.status === "queued" || job.status === "running") {
    ctx.progress(job.progress, "Transcribing");
    await sleep(POLL_MS);
    if (ctx.signal.aborted) throw new ToolError("Stopped.");
    job = await api.getTranscription(job.id);
  }
  if (job.status !== "done" || !job.transcripts) throw new ToolError(job.error ?? "Transcription failed.");
  return job;
}

async function libraryNow(): Promise<Library> {
  await useLibrary.getState().load();
  const { folders, items, assets } = useLibrary.getState();
  return { folders, items, media: assets };
}

const TOOLS: Record<VideoToolName, Handler> = {
  // -------------------------------------------------------------------------
  // Looking
  // -------------------------------------------------------------------------
  async get_timeline(input, ctx) {
    const doc = await ctx.doc();
    const trackId = optString(input, "trackId");
    return textResult(
      describeTimeline(
        doc.project,
        byId(doc.assets),
        { playhead: doc.playhead, selectedClipIds: [...doc.selectedClipIds], sequenceId: doc.sequenceId },
        {
          from: optNumber(input, "from"),
          to: optNumber(input, "to"),
          ...(trackId && { trackId }),
          captions: optBoolean(input, "captions") ?? false,
        },
      ),
    );
  },
  async get_clips(input, ctx) {
    const doc = await ctx.doc();
    return textResult(describeClips(doc.project, byId(doc.assets), strings(input, "clipIds")));
  },
  async list_media(_input, ctx) {
    const doc = await ctx.doc();
    return textResult(describeMedia(doc.project, [...doc.assets], (a) => assetMarkedRange(a)));
  },
  async view_frames(input, ctx) {
    const doc = await ctx.doc();
    const duration = projectDuration(doc.project);
    if (duration <= 0) throw new ToolError("The timeline is empty: there's nothing to look at.");
    // What reacts to sound needs its files heard first (the open video's are then in its reader too).
    const reader = usesSignals(doc.document) || optString(input, "at") ? await readerFor(doc, ctx) : null;
    let times = optNumbers(input, "times");
    if (times && (times.length === 0 || times.length > 16)) throw new ToolError("`times` must have 1 to 16 times.");
    if (!times) {
      const from = clamp(optNumber(input, "from") ?? 0, 0, duration);
      const to = clamp(optNumber(input, "to") ?? duration, from, duration);
      const count = clamp(Math.round(optNumber(input, "count") ?? 8), 1, 16);
      const at = optString(input, "at");
      if (at) {
        const source = signalSource(doc, optString(input, "source"));
        const moments = eventTimes(reader!, doc.sequenceId, source, at, from, to);
        if (!moments.length) throw new ToolError(`There are no ${at} between ${secs(from)}s and ${secs(to)}s. Look at get_signals.`);
        const offset = optNumber(input, "offset") ?? 0;
        times = moments.slice(0, count).map((t) => t + offset);
      } else times = Array.from({ length: count }, (_, i) => (count === 1 ? from : from + (i * (to - from)) / count));
    }
    const sheet = optBoolean(input, "sheet") ?? times.length > 4;
    const width = clamp(optNumber(input, "width") ?? (sheet ? 240 : 480), 64, 960);
    const at = times.map((t) => clamp(t, 0, Math.max(0, duration - 0.001)));
    const content = doc.isOpen ? await programFrames(at, width, ctx.signal) : await offscreenFrames(doc, at, width, ctx.signal, reader);
    return { content: sheet ? await contactSheet(content, at, width) : content };
  },
  async get_layout(input, ctx) {
    const doc = await ctx.doc();
    const time = optNumber(input, "time", { min: 0 }) ?? doc.playhead;
    const only = optStrings(input, "clipIds");
    if (only) clipsOf(doc.project, only);
    // Texts are measured in their real fonts.
    await fontsSettled();
    const canvas = outputSize(doc.project.settings.aspectRatio, "1080p");
    return textResult(describeLayout(clipsOnCanvas(doc.project, [...doc.assets], canvas, time), byId(doc.assets), canvas, time, only));
  },
  async view_media(input, ctx) {
    const doc = await ctx.doc();
    const assetId = string(input, "assetId");
    const asset = doc.asset(assetId);
    if (!asset) throw new ToolError(`There's no media "${assetId}" in this video. Call list_media.`);
    if (!asset.hasVideo) throw new ToolError(`"${asset.name}" is sound only: there's nothing to see. Try get_transcript or analyze_audio.`);
    const width = clamp(optNumber(input, "width") ?? 320, 64, 960);
    let times = optNumbers(input, "times");
    if (!times?.length) {
      const count = clamp(Math.round(optNumber(input, "count") ?? 6), 1, 16);
      const from = clamp(optNumber(input, "from") ?? 0, 0, asset.duration);
      const to = clamp(optNumber(input, "to") ?? asset.duration, from, asset.duration);
      // The middle of each of `count` equal slices.
      times = asset.kind === "image" ? [0] : Array.from({ length: count }, (_, i) => from + ((i + 0.5) * (to - from)) / count);
    }
    if (times.length > 16) throw new ToolError("At most 16 frames at once.");
    const content = await mediaFrames(assetId, times, width, ctx.signal);
    return { content: [{ type: "text", text: `"${asset.name}" (${asset.kind}, ${secs(asset.duration)}s):` }, ...content] };
  },
  async get_transcript(input, ctx) {
    const doc = await ctx.doc();
    const project = doc.project;
    const assets = byId(doc.assets);
    const assetId = optString(input, "assetId");
    if (assetId) {
      // A whole file: as a clip of all of it from 0, its timeline times are its source times.
      const asset = assets[assetId];
      if (!asset) throw new ToolError(`There's no media "${assetId}" in this video. Call list_media.`);
      if (!asset.hasAudio || !(asset.duration > 0)) throw new ToolError(`"${asset.name}" has no sound to transcribe.`);
      const whole: Clip = { id: asset.id, assetId, trackId: "", start: 0, in: 0, out: asset.duration, effects: [] };
      const engine = await readyEngine(oneOf(input, "engine", ["local", "openai", "groq"] as const));
      const job = await transcribe([whole], engine, optString(input, "language") ?? "auto", ctx);
      return textResult(describeTranscript([whole], job.transcripts!, assets, "source"));
    }
    const ids = optStrings(input, "clipIds");
    const clips = ids ? clipsOf(project, ids) : captionSourceClips(project, assets);
    const heard = clips.filter((c) => assets[c.assetId]?.hasAudio);
    if (heard.length === 0) throw new ToolError(ids ? "None of those clips have sound." : "No clip on the timeline has sound.");
    const engine = await readyEngine(oneOf(input, "engine", ["local", "openai", "groq"] as const));
    const job = await transcribe(heard, engine, optString(input, "language") ?? "auto", ctx);
    return textResult(describeTranscript(heard, job.transcripts!, assets));
  },
  async analyze_audio(input, ctx) {
    const doc = await ctx.doc();
    const project = doc.project;
    const assets = byId(doc.assets);
    const ids = optStrings(input, "clipIds");
    const clips = (ids ? clipsOf(project, ids) : project.clips).filter((c) => assets[c.assetId]?.hasAudio);
    if (clips.length === 0) throw new ToolError(ids ? "None of those clips have sound." : "No clip on the timeline has sound.");
    const threshold = clamp(optNumber(input, "threshold") ?? -35, -90, 0);
    const min = clamp(optNumber(input, "minSilence") ?? 0.4, 0.05, 60);
    const lines = [`Silences quieter than ${threshold} dB for at least ${min}s (timeline times):`];
    for (const [i, clip] of clips.entries()) {
      ctx.progress(i / clips.length, "Listening");
      const asset = assets[clip.assetId]!;
      const sound = await api.analyseSound(asset.id, { from: clip.in, to: clip.out, threshold, min }, ctx.signal);
      const at = (s: number) => timelineTime(clip, s);
      const level = sound.meanVolume === null ? "no sound" : `mean ${Math.round(sound.meanVolume * 10) / 10} dB, peak ${Math.round((sound.maxVolume ?? 0) * 10) / 10} dB`;
      // A reversed clip plays a silence's end first; a retimed one makes it longer or shorter.
      const silences = sound.silences
        .map((s) => [at(s.start), at(s.end)].sort((a, b) => a - b))
        .sort((a, b) => a[0] - b[0])
        .map(([from, to]) => `${range(from, to)} (${secs(to - from)}s)`);
      lines.push(`${clip.id} "${asset.name}" ${range(clip.start, clipEnd(clip))} · ${level}`);
      lines.push(`  ${silences.length ? `silences: ${silences.join(", ")}` : "no silences"}`);
    }
    return textResult(lines.join("\n"));
  },
  async get_signals(input, ctx) {
    const doc = await ctx.doc();
    const reader = await readerFor(doc, ctx);
    const length = projectDuration(doc.project);
    const from = clamp(optNumber(input, "from") ?? 0, 0, length);
    const to = clamp(optNumber(input, "to") ?? length, from, length);
    if (!(to > from)) throw new ToolError("The stretch is empty: `to` must be after `from` (the sequence is " + secs(length) + "s long).");
    const sourceName = optString(input, "source");
    const source = signalSource(doc, sourceName);
    const assets = byId(doc.assets);
    return textResult(
      describeSignals(reader, doc.sequenceId, {
        source,
        label: source.kind === "master" ? "The whole mix" : `"${sourceName}"`,
        from,
        to,
        signals: optStrings(input, "signals") ?? [],
        step: optNumber(input, "step", { min: 0.01 }),
        hasAudio: (id) => !!assets[id]?.hasAudio,
      }),
    );
  },
  async plot_signals(input, ctx) {
    const doc = await ctx.doc();
    const reader = await readerFor(doc, ctx);
    const length = projectDuration(doc.project);
    const from = clamp(optNumber(input, "from") ?? 0, 0, length);
    const to = clamp(optNumber(input, "to") ?? length, from, length);
    if (!(to > from)) throw new ToolError("The stretch is empty: `to` must be after `from`.");
    const names = optStrings(input, "signals") ?? ["level", "bass", "onsetLow", "onsetHigh"];
    const width = clamp(Math.round(optNumber(input, "width") ?? 960), 320, 1600);
    return { content: plotSignals(reader, doc.sequenceId, signalSource(doc, optString(input, "source")), names, from, to, width) };
  },
  async analyze_music(input, ctx) {
    const doc = await ctx.doc();
    const project = doc.project;
    const clipId = optString(input, "clipId");
    const assetId = optString(input, "assetId");
    if (!clipId === !assetId) throw new ToolError("Give exactly one of `clipId` and `assetId`.");
    ctx.progress(null, "Listening for the beat");
    if (clipId) {
      const [clip] = clipsOf(project, [clipId]);
      const asset = doc.asset(clip.assetId);
      if (!asset?.hasAudio) throw new ToolError(`${clipId} has no sound.`);
      const music = await api.analyseMusic(asset.id, { from: clip.in, to: clip.out }, ctx.signal);
      return textResult(describeMusic(`${clip.id} "${asset.name}"`, music, clip.start - clip.in, { start: clip.start, end: clipEnd(clip) }, true));
    }
    const asset = doc.asset(assetId!);
    if (!asset) throw new ToolError(`There's no media "${assetId}" in this video. Call list_media.`);
    if (!asset.hasAudio) throw new ToolError(`"${asset.name}" has no sound.`);
    const from = clamp(optNumber(input, "from") ?? 0, 0, asset.duration);
    const to = clamp(optNumber(input, "to") ?? asset.duration, from, asset.duration);
    const music = await api.analyseMusic(asset.id, { from, to }, ctx.signal);
    return textResult(describeMusic(`"${asset.name}" (${asset.id})`, music, 0, { start: from, end: to }, false));
  },
  async mark_beats(input, ctx) {
    const doc = await ctx.doc();
    const clipId = string(input, "clipId");
    const [clip] = clipsOf(doc.project, [clipId]);
    const before = doc.project;
    if (optBoolean(input, "clear")) {
      const had = beatMarkerCount(clip);
      if (doc.isOpen) await gesturesSettled(ctx.signal);
      doc.commit(setBeatMarkers(doc.project, clipId, []));
      return textResult(had ? `Removed ${had} beat markers from ${clipId}.` : `${clipId} has no beat markers.`, finishEdit(doc, before));
    }
    const asset = doc.asset(clip.assetId);
    if (!asset?.hasAudio) throw new ToolError(`${clipId} has no sound. Give the clip with the music.`);
    if (isRemapped(clip)) throw new ToolError(`${clipId} is time-remapped, so its beats aren't steady. Use analyze_music and set_markers instead.`);
    const which = oneOf(input, "marks", ["beats", "bars", "drops"] as const) ?? "beats";
    ctx.progress(null, "Listening for the beat");
    const music = await api.analyseMusic(asset.id, { from: clip.in, to: clip.out }, ctx.signal);
    const marks = beatMarks(music, which);
    if (!marks.length) {
      throw new ToolError(which === "drops" ? `No drops were found in ${clipId}. Try marks "bars".` : `No steady beat was found in ${clipId}: it may not be music. Place markers yourself with set_markers.`);
    }
    if (doc.isOpen) await gesturesSettled(ctx.signal);
    // (Its clip as it is now: the listening took a while.)
    if (!getClip(doc.project, clipId)) throw new ToolError(`${clipId} was deleted meanwhile.`);
    doc.commit(setBeatMarkers(doc.project, clipId, marks));
    const now = getClip(doc.project, clipId)!;
    const times = clipMarkers(now).filter((m) => m.marker.beat).map((m) => m.time);
    return textResult(
      `Marked ${times.length} ${which} on ${clipId} "${asset.name}" ${music.bpm ? ` (${Math.round(music.bpm)} BPM${music.confidence < 0.4 ? ", a weak beat: check by ear" : ""})` : ""}. ` +
        `Timeline times: ${times.slice(0, 200).map(secs).join(", ")}${times.length > 200 ? `, … ${times.length - 200} more` : ""}.\n` +
        "They're markers on the clip now (they move with it). cut_to_markers ends clips on them.",
      finishEdit(doc, before),
    );
  },
  async detect_scenes(input, ctx) {
    const doc = await ctx.doc();
    const asset = doc.asset(string(input, "assetId"));
    if (!asset) throw new ToolError("There's no such media in this video. Call list_media.");
    if (asset.kind !== "video") throw new ToolError(`"${asset.name}" isn't a video.`);
    ctx.progress(null, "Watching for cuts");
    const { cuts } = await api.detectScenes(asset.id, clamp(optNumber(input, "threshold") ?? 0.3, 0.05, 1), ctx.signal);
    if (cuts.length === 0) return textResult(`No shot changes found in "${asset.name}" (${secs(asset.duration)}s): it's one continuous shot, or try a lower threshold.`);
    return textResult(
      `Shot changes in "${asset.name}" (${secs(asset.duration)}s), source seconds: ${cuts.map(secs).join(", ")}.\n` +
        "Shots are the stretches between them (and the file's start and end). Use them as add_clips in/out points.",
    );
  },
  async get_catalog(input) {
    const kind = oneOf(input, "kind", ["video_effects", "masks_and_shapes", "text_animators", "expressions", "presets", "transitions", "clip_properties", "caption_styles", "shader_api", "fonts"] as const) as CatalogKind | undefined;
    if (!kind) throw new ToolError("`kind` is required.");
    const fonts = kind === "fonts" ? await api.listFonts() : [];
    return textResult(describeCatalog(kind, optString(input, "query"), fonts));
  },
  async search_online(input, ctx) {
    const query = string(input, "query");
    const limit = clamp(Math.round(optNumber(input, "limit") ?? 8), 1, 20);
    ctx.progress(null, "Searching");
    const clips = (await api.searchWeb(query, ctx.signal)).clips.slice(0, limit);
    if (clips.length === 0) return textResult(`Nothing found for "${query}".`);
    return textResult(
      [
        `Results for "${query}":`,
        ...clips.map(
          (c, i) =>
            `${i + 1}. "${c.title}" by ${c.channel}${c.verified ? " ✓ verified" : ""} · ${c.duration ? `${secs(c.duration)}s` : "length unknown"} · ${c.site} · ${c.url}`,
        ),
        'Import one with import_media { urls: [url], urlKind: "audio" } (or "video").',
      ].join("\n"),
    );
  },
  async get_library(input) {
    return textResult(describeLibrary(await libraryNow(), optString(input, "query"), optString(input, "folderId")));
  },

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------
  add_clips: edit("add_clips"),
  add_text: edit("add_text"),
  add_layer: edit("add_layer"),
  set_parent: edit("set_parent"),
  set_markers: edit("set_markers"),
  cut_to_markers: edit("cut_to_markers"),
  set_expression: edit("set_expression"),
  link_param: edit("link_param"),
  set_shader: edit("set_shader"),
  define_signal: edit("define_signal"),
  delete_signal: edit("delete_signal"),
  set_events: edit("set_events"),
  nest_clips: edit("nest_clips"),
  break_apart: edit("break_apart"),
  edit_sequence: edit("edit_sequence"),
  remap_time: edit("remap_time"),
  apply_preset: edit("apply_preset"),
  move_clips: edit("move_clips"),
  trim_clip: edit("trim_clip"),
  set_speed: edit("set_speed"),
  split_clips: edit("split_clips"),
  delete_clips: edit("delete_clips"),
  close_gaps: edit("close_gaps"),
  duplicate_clips: edit("duplicate_clips"),
  set_properties: edit("set_properties"),
  set_keyframes: edit("set_keyframes"),
  add_effect: edit("add_effect"),
  edit_effect: edit("edit_effect"),
  copy_effects: edit("copy_effects"),
  set_transition: edit("set_transition"),
  add_track: edit("add_track"),
  edit_track: edit("edit_track"),
  set_project: edit("set_project"),
  style_captions: edit("style_captions"),
  merge_captions: edit("merge_captions"),
  make_subclips: edit("make_subclips"),
  edit_subclips: edit("edit_subclips"),
  batch: edit("batch"),

  // -------------------------------------------------------------------------
  // Other actions
  // -------------------------------------------------------------------------
  async generate_captions(input, ctx) {
    const doc = await ctx.doc();
    const project = doc.project;
    const ids = optStrings(input, "clipIds");
    if (ids) clipsOf(project, ids);
    const captions = useCaptions.getState();
    const engine = await readyEngine(oneOf(input, "engine", ["local", "openai", "groq"] as const) ?? captions.options.engine);
    const options: CaptionOptions = {
      ...captions.options,
      engine,
      ...(optString(input, "language") && { language: optString(input, "language")! }),
      ...(optString(input, "preset") && { style: optString(input, "preset")! }),
      ...(oneOf(input, "length", ["word", "short", "line", "lines"] as const) && { length: oneOf(input, "length", ["word", "short", "line", "lines"] as const)! }),
      ...(optString(input, "animation") && { animation: optString(input, "animation")! }),
      ...(optBoolean(input, "punctuation") !== undefined && { punctuation: optBoolean(input, "punctuation")! }),
    };
    const before = project;
    const had = captionClips(project).length;
    if (doc.isOpen) {
      // The Captions tab's own run, so its progress shows there too.
      if (captions.run.status === "running") throw new ToolError("Captions are already being made.");
      ctx.signal.addEventListener("abort", () => useCaptions.getState().cancel());
      const running = captions.generate(options, ids ? "selection" : "timeline", ids);
      const watch = setInterval(() => {
        const run = useCaptions.getState().run;
        if (run.status === "running") ctx.progress(run.progress, "Transcribing");
      }, POLL_MS);
      try {
        await running;
      } finally {
        clearInterval(watch);
      }
      const run = useCaptions.getState().run;
      if (run.status === "error") throw new ToolError(run.message);
      if (ctx.signal.aborted) throw new ToolError("Stopped.");
    } else {
      const sources = captionSourceClips(project, byId(doc.assets), ids);
      if (sources.length === 0) throw new ToolError("There's no sound to caption in those clips.");
      const job = await transcribe(sources, engine, options.language, ctx);
      const { added, apply } = await captionsFor(doc.project, job, sources.map((c) => c.id), options);
      if (added) doc.commit(apply(doc.project));
    }
    const changes = finishEdit(doc, before);
    const now = captionClips(doc.project);
    if (changes.added.length === 0) return textResult("No speech was found in those clips, so no captions were added.", changes);
    return textResult(
      `Added ${changes.added.length} captions (${now.length} in all, ${had ? "replacing the ones over those clips" : "on a Captions track"}) with the "${options.style}" style, "${options.length}" length and "${options.animation}" animation. Restyle them with style_captions; edit one's words with set_properties (effect "text").`,
      changes,
    );
  },
  async import_media(input, ctx) {
    const doc = await ctx.doc();
    const { projectId } = doc;
    const paths = optStrings(input, "paths") ?? [];
    const urls = optStrings(input, "urls") ?? [];
    if (paths.length + urls.length === 0) throw new ToolError("Give `paths` and/or `urls`.");
    const kind = oneOf(input, "urlKind", ["video", "audio"] as const) ?? "video";
    const lines: string[] = [];
    const failed: string[] = [];
    const imported: MediaAsset[] = [];
    const total = paths.length + urls.length;
    const describe = (a: MediaAsset) =>
      `${a.id} "${a.name}" (${a.kind}${a.width ? ` ${a.width}×${a.height}` : ""}, ${a.kind === "image" ? "still" : `${secs(a.duration)}s`})`;
    for (const [i, path] of paths.entries()) {
      ctx.progress(i / total, `Importing ${path.split("/").pop()}`);
      try {
        const asset = await api.importFile({ projectId, path });
        imported.push(asset);
        lines.push(`Imported ${describe(asset)}`);
      } catch (err) {
        failed.push(`${path}: ${errorMessage(err)}`);
      }
    }
    for (const [i, url] of urls.entries()) {
      ctx.progress((paths.length + i) / total, "Downloading");
      try {
        const clip = await api.resolveWebLink(url, ctx.signal);
        const asset = await api.importWebMedia({ projectId, url: clip.url, title: clip.title, kind });
        imported.push(asset);
        lines.push(`Imported ${describe(asset)}`);
      } catch (err) {
        failed.push(`${url}: ${errorMessage(err)}`);
      }
    }
    doc.addAssets(imported);
    if (imported.length === 0) throw new ToolError(`Nothing was imported. ${failed.join("; ")}`);
    return textResult([...lines, ...failed.map((f) => `Failed: ${f}`), "Put them on the timeline with add_clips."].join("\n"));
  },
  async delete_media(input, ctx) {
    let doc = await ctx.doc();
    const asset = doc.asset(string(input, "assetId"));
    if (!asset) throw new ToolError("There's no such media in this video. Call list_media.");
    const uses = doc.project.clips.filter((c) => c.assetId === asset.id).length;
    const ok = await useAssistant
      .getState()
      .confirm(
        `Delete “${asset.name}”?`,
        uses ? `Its ${uses} clip${uses === 1 ? "" : "s"} will be removed from the timeline too. This can't be undone.` : "This can't be undone.",
        doc.projectId,
        ctx.signal,
      );
    if (!ok) throw new ToolError("The user said no. Don't delete it.");
    // The user may have switched videos while deciding.
    doc = await docFor(doc.projectId);
    const before = doc.project;
    if (doc.isOpen) {
      await useEditor.getState().deleteAsset(asset.id);
      if (doc.asset(asset.id)) throw new ToolError("It couldn't be deleted.");
    } else {
      await api.deleteMedia(asset.id);
      doc.assetDeleted(asset.id);
    }
    return textResult(`Deleted "${asset.name}"${uses ? ` and its ${uses} clip${uses === 1 ? "" : "s"}` : ""}.`, finishEdit(doc, before));
  },
  async library_create_folder(input) {
    const folder = await api.createLibraryFolder({ name: string(input, "name"), parentId: optString(input, "parentId") ?? null });
    await useLibrary.getState().refresh();
    return textResult(`Created folder ${folder.id} "${folder.name}".`);
  },
  async library_update(input) {
    const folderId = optString(input, "folderId");
    const itemId = optString(input, "itemId");
    if (!folderId === !itemId) throw new ToolError("Give exactly one of `folderId` and `itemId`.");
    const name = optString(input, "name");
    const parentId = input.parentId === null ? null : optString(input, "parentId");
    const favorite = optBoolean(input, "favorite");
    let text: string;
    if (folderId) {
      if (favorite !== undefined) throw new ToolError("Only items can be starred.");
      const folder = await api.updateLibraryFolder(folderId, { ...(name && { name }), ...(parentId !== undefined && { parentId }) });
      text = `Folder ${folder.id} is "${folder.name}", in ${folder.parentId ?? "the top level"}.`;
    } else {
      const item = await api.updateLibraryItem(itemId!, { ...(name && { name }), ...(parentId !== undefined && { folderId: parentId }), ...(favorite !== undefined && { favorite }) });
      text = `Item ${item.id} is "${item.name}", in ${item.folderId ?? "the top level"}${item.favorite ? ", starred" : ""}.`;
    }
    await useLibrary.getState().refresh();
    return textResult(text);
  },
  async library_delete(input, ctx) {
    const folderId = optString(input, "folderId");
    const itemId = optString(input, "itemId");
    if (!folderId === !itemId) throw new ToolError("Give exactly one of `folderId` and `itemId`.");
    const library = await libraryNow();
    if (folderId) {
      const folder = library.folders.find((f) => f.id === folderId);
      if (!folder) throw new ToolError(`There's no folder "${folderId}". Call get_library.`);
      const ok = await useAssistant.getState().confirm(`Delete the folder “${folder.name}”?`, "Everything in it goes too. Videos keep their own copies of its media. This can't be undone.", ctx.chat, ctx.signal);
      if (!ok) throw new ToolError("The user said no. Don't delete it.");
      await api.deleteLibraryFolder(folderId);
      await useLibrary.getState().refresh();
      return textResult(`Deleted the folder "${folder.name}" and everything in it.`);
    }
    const item = library.items.find((i) => i.id === itemId);
    if (!item) throw new ToolError(`There's no item "${itemId}". Call get_library.`);
    const ok = await useAssistant.getState().confirm(`Delete “${item.name}” from the Library?`, "Videos keep their own copies. This can't be undone.", ctx.chat, ctx.signal);
    if (!ok) throw new ToolError("The user said no. Don't delete it.");
    await api.deleteLibraryItem(item.id);
    await useLibrary.getState().refresh();
    return textResult(`Deleted "${item.name}" from the Library.`);
  },
  async library_save(input, ctx) {
    const { projectId, project } = await ctx.doc();
    const assetIds = optStrings(input, "assetIds") ?? [];
    const subclipIds = optStrings(input, "subclipIds") ?? [];
    const clipIds = optStrings(input, "clipIds") ?? [];
    const folderId = optString(input, "folderId") ?? null;
    if (assetIds.length + subclipIds.length + clipIds.length === 0) throw new ToolError("Give `assetIds`, `subclipIds` and/or `clipIds`.");
    const assets = byId((await ctx.doc()).assets);
    const subclips = subclipIds.map((id) => {
      const subclip = getSubclip(project, id);
      if (!subclip || !assets[subclip.assetId]) throw new ToolError(`There's no subclip "${id}" in this video. Call list_media. Nothing was saved.`);
      return subclip;
    });
    const lines: string[] = [];
    for (const assetId of assetIds) {
      const { item } = await api.saveMediaToLibrary({ assetId, folderId });
      lines.push(`Saved media as item ${item.id} "${item.name}".`);
    }
    for (const subclip of subclips) {
      const template = templateFromSubclip(subclip, assets[subclip.assetId]!);
      const { item } = await api.saveClipsToLibrary({ projectId, name: subclip.name, folderId, ...template });
      lines.push(`Saved subclip ${subclip.id} as item ${item.id} "${item.name}".`);
    }
    if (clipIds.length) {
      clipsOf(project, clipIds);
      const name = optString(input, "name")?.trim();
      if (!name) throw new ToolError("Saved clips need a `name`.");
      const { item } = await api.saveClipsToLibrary({ projectId, name, folderId, ...templateFromClips(project, clipIds) });
      lines.push(`Saved ${clipIds.length} clip${clipIds.length === 1 ? "" : "s"} as item ${item.id} "${item.name}".`);
    }
    await useLibrary.getState().refresh();
    return textResult(lines.join("\n"));
  },
  async library_use(input, ctx) {
    const doc = await ctx.doc();
    const itemId = string(input, "itemId");
    const before = doc.project;
    const opts = { at: optNumber(input, "start") ?? doc.playhead, ...(optString(input, "trackId") && { trackId: optString(input, "trackId") }) };
    let item;
    if (doc.isOpen) {
      // Whole files, as for a video that isn't open (not the user's In/Out marks).
      item = await useEditor.getState().addLibraryItem(itemId, { ...opts, ranges: {}, ripple: false });
      if (!item) throw new ToolError("It couldn't be added (see the message in the app). Check the id with get_library.");
    } else {
      const used = await api.useLibraryItem(itemId, { projectId: doc.projectId });
      doc.addAssets(used.assets);
      const placed = used.template
        ? placeTemplate(doc.project, used.template, opts)
        : placeAssets(doc.project, used.assets.filter((a) => a.duration > 0), opts);
      doc.commit(placed.project);
      item = used.item;
    }
    await useLibrary.getState().refresh();
    const changes = finishEdit(doc, before);
    const project = doc.project;
    const placed = changes.added.map((id) => getClip(project, id)!).map((c) => `${c.id} ${range(c.start, clipEnd(c))}`);
    return textResult(`Added "${item.name}": ${placed.join(", ")}.`, changes);
  },
  async export_video(input, ctx) {
    const { project } = await ctx.doc();
    if (project.clips.length === 0) throw new ToolError("The timeline is empty: there's nothing to export.");
    const resolution: ExportResolution = oneOf(input, "resolution", ["720p", "1080p", "4k"] as const) ?? "1080p";
    const settings = exportSettings({ format: input.format ?? undefined, quality: input.quality ?? undefined, alpha: input.alpha ?? undefined });
    if ("error" in settings) throw new ToolError(settings.error);
    const formats = await api.exportFormats();
    if (!formats.includes(settings.format)) {
      throw new ToolError(`This computer's ffmpeg can't make ${exportFormat(settings.format).label}. It can make: ${formats.join(", ")}.`);
    }
    ctx.progress(null, "Preparing");
    const texts = await layoutTexts(project, resolution);
    let job: ExportJob = await api.startExport({
      project,
      resolution,
      fileName: optString(input, "fileName"),
      excludeAudioTracks: optBoolean(input, "excludeAudio") ?? false,
      texts,
      ...settings,
    });
    ctx.signal.addEventListener("abort", () => void api.cancelExport(job.id).catch(() => {}));
    while (job.status === "queued" || job.status === "rendering") {
      ctx.progress(job.progress, "Rendering");
      await sleep(POLL_MS);
      if (ctx.signal.aborted) throw new ToolError("Stopped.");
      job = await api.getExport(job.id);
    }
    if (job.status !== "done" || !job.url) throw new ToolError(job.error ?? "The export failed.");
    const size = job.bytes ? `, ${formatBytes(job.bytes)}` : "";
    return textResult(
      `Exported "${job.fileName}.${job.extension}" (${describeExport(job)}, ${job.width}×${job.height}, ${secs(job.duration)}s${size}): ${location.origin}${job.downloadUrl ?? job.url}`,
    );
  },
  async render_effects(input, ctx) {
    const doc = await ctx.doc();
    const store = useRenderFiles.getState;
    if (optBoolean(input, "delete")) {
      if (doc.isOpen) await store().deleteAll();
      else await api.deleteRenderFiles(doc.projectId);
      return textResult("Deleted the video's render files: its heavy parts are red again (Enter renders them).");
    }
    const document = doc.document;
    if (document.clips.length === 0) throw new ToolError("The timeline is empty: there's nothing to render.");
    ctx.progress(null, "Preparing");
    const started = Date.now();
    // The open video's through its store, so the bar over the ruler turns green as it goes.
    let job = doc.isOpen
      ? await store().render()
      : await api.renderEffects(doc.projectId, { project: document, texts: await layoutTexts(document, RENDER_RESOLUTION) });
    if (!job) throw new ToolError(store().error ?? "The render couldn't start.");
    const id = job.id;
    ctx.signal.addEventListener("abort", () => void api.cancelRender(id).catch(() => {}));
    while (job.status === "queued" || job.status === "rendering") {
      ctx.progress(job.progress, "Rendering");
      await sleep(POLL_MS);
      if (ctx.signal.aborted) throw new ToolError("Stopped.");
      const now: RenderJob | null = doc.isOpen ? store().job : (await api.renderFiles(doc.projectId)).job;
      if (!now || now.id !== id) throw new ToolError("The render was replaced by another (started again, or its files deleted).");
      job = now;
    }
    if (job.status !== "done") throw new ToolError(job.error ?? `The render was ${job.status}.`);
    if (job.segments === 0) return textResult("Nothing to render: the heavy parts were rendered already (green), or there are none.");
    return textResult(`Rendered ${job.segments} part${job.segments === 1 ? "" : "s"} in ${secs((Date.now() - started) / 1000)}s: they play back smoothly now.`);
  },
  async now_playing() {
    await useLookRatings.getState().load();
    if (!useVisualizerMedia.getState().loaded) await useVisualizerMedia.getState().load();
    const { status, visualizer, listening } = useNowPlaying.getState();
    const prefs = useVisualizerPrefs.getState();
    const lines: string[] = [];
    if (!status) lines.push("The music player hasn't been asked yet: try again in a second.");
    else if (status.unavailable) lines.push(`Nothing to read from ${status.player}: ${status.message ?? UNAVAILABLE[status.unavailable]}`);
    else if (!status.track) lines.push(`${status.player} is open but not playing anything.`);
    else {
      const t = status.track;
      lines.push(
        `${status.player} is ${status.state === "playing" ? "playing" : "paused on"} "${t.name}"${t.artist ? ` by ${t.artist}` : ""}${t.album ? ` (${t.album})` : ""}, ` +
          `${formatDuration(Math.floor(positionAt(status, Date.now())))} of ${formatDuration(Math.floor(t.duration))}.`,
      );
    }
    const mood = useNowPlaying.getState().live?.signals.mood;
    if (mood?.character) {
      lines.push(
        `It sounds ${mood.character} (${Math.round(mood.sure * 100)}% sure), intensity ${mood.intensity.toFixed(2)} of 1, in ${mood.section === "build" ? "a build-up" : mood.section === "steady" ? "a steady part" : `the ${mood.section}`}.`,
      );
    }
    if (mood?.vibe) {
      // What CLAP hears (its axes: -1 the first end, 1 the second, against the music they were centred on).
      const ends = { energy: "calm–intense", mood: "dark–bright", force: "soft–harsh", pace: "slow–fast", space: "dry–dreamy", dance: "free–groove" };
      const axes = (Object.keys(ends) as (keyof typeof ends)[]).map((a) => `${ends[a]} ${mood.vibe!.axes[a]}`).join(", ");
      lines.push(`Its vibe (CLAP): like ${mood.vibe.genres.map((g) => g.name).join(", ")}; ${axes}.`);
    } else if (useNowPlaying.getState().vibeModel?.status !== "ready") {
      lines.push("Its vibe isn't heard: the vibe's model (CLAP) isn't downloaded; the user downloads it from the visualizer's offer.");
    }
    const auto = AUTO_SWITCHES.find((a) => a.id === prefs.auto)!;
    lines.push(
      visualizer
        ? `The visualizer is open, showing ${liveLook(prefs.look)?.name ?? prefs.look} (${prefs.look}); looks change: ${auto.label.toLowerCase()} (${auto.id}); speed: ${paceLabel(prefs.pace).toLowerCase()} (pace ${prefs.pace}); listening: ${listening}.`
        : `The visualizer is closed (its look is ${prefs.look}; looks change: ${auto.id}; pace ${prefs.pace}).`,
    );
    const fxSet = (Object.keys(NO_FX) as (keyof typeof NO_FX)[]).filter((k) => prefs.fx[k] !== NO_FX[k]);
    const effectsBy = EFFECTS_MODES.find((m) => m.id === prefs.effects)!;
    lines.push(
      prefs.effects === "hand"
        ? `Effects over the looks by hand: ${fxSet.length ? fxSet.map((k) => `${k} ${prefs.fx[k]}`).join(", ") : "none"}.`
        : `Effects over the looks: played by the engine (${effectsBy.label.toLowerCase()}, ${effectsBy.id}).`,
    );
    // The user's taste (their ratings: docs/now-playing.md, "Your taste"), for the kind of song playing.
    const { taste, rating } = useLookRatings.getState();
    const character = mood?.character ?? null;
    const counts = taste.counts();
    const verdictOf = (id: string) => {
      const { verdict, here } = taste.verdict(id, character);
      return verdict === "love" ? (here ? "loved" : "loved on other kinds of song") : verdict === "bin" ? "binned" : null;
    };
    lines.push(
      `The user's ratings: ${counts.loved} looks loved, ${counts.binned} binned (${counts.ratings} ratings, skips included); ` +
        `the look shown is ${verdictOf(prefs.look) ?? "not rated"}${character ? ` for ${character} songs` : ""}. ` +
        (rating ? `The rating mode is on: ${rating.left} looks nobody has judged yet.` : "The rating mode is off."),
    );
    // The user's clips and pictures, melting into MilkDrop's feedback, from one of their sets.
    const { media, feeding, sets, setId } = useVisualizerMedia.getState();
    const fed = media.find((m) => m.asset.id === feeding)?.asset.name;
    const inUse = sets.find((s) => s.id === setId);
    if (sets.length > 1) lines.push(`The user's sets of clips (mediaSet): ${sets.map((s) => `${s.name} (${s.media.length}${s.id === setId ? ", in use" : ""})`).join(", ")}.`);
    lines.push(
      media.length
        ? `The user's clips and pictures${inUse ? ` in ${inUse.name}` : ""} (${media.length}: ${media.map((m) => `${m.asset.name} (${m.asset.kind})`).join(", ")}) melt into MilkDrop's feedback: ${prefs.media ? (fed ? `${fed} now` : "on, none in the look shown") : "turned off"}.`
        : inUse
          ? `The user's set of clips in use (${inUse.name}) is empty: they add clips to it from the visualizer's media panel.`
          : "The user has no clips or pictures in the visualizer (they add them from its media panel, or drop them on it).",
    );
    // What each suits (step 5 of docs/now-playing.md), so a look can be picked for the music.
    const suits = (l: (typeof LIVE_LOOKS)[number]) => `${l.suits.characters.join("/")}, intensity ${l.suits.energy[0]}–${l.suits.energy[1]}${l.suits.minimal ? ", minimal" : ""}`;
    lines.push(
      `Looks (id: name, kind, what it suits, the user's rating): ${LIVE_LOOKS.map((l) => {
        const said = verdictOf(l.id);
        return `${l.id} (${l.name}, ${l.kind}, ${suits(l)}${said ? `, ${said}` : ""})`;
      }).join("; ")}.`,
    );
    return textResult(lines.join("\n"));
  },
  async control_now_playing(input) {
    const np = useNowPlaying.getState();
    const action = optString(input, "action");
    const seek = optNumber(input, "seek", { min: 0 });
    const visualizer = optString(input, "visualizer");
    const look = optString(input, "look");
    const auto = optString(input, "auto");
    const roll = optString(input, "roll");
    const effectsMode = optString(input, "effects");
    const effects = effectsMode === undefined ? undefined : EFFECTS_MODES.find((m) => m.id === effectsMode);
    if (effectsMode !== undefined && !effects) throw new ToolError(`\`effects\` is one of ${EFFECTS_MODES.map((m) => m.id).join(", ")}.`);
    const pace = optNumber(input, "pace", { min: PACE.min, max: PACE.max });
    const rate = optString(input, "rate");
    if (rate !== undefined && rate !== "love" && rate !== "bin" && rate !== "clear") throw new ToolError("`rate` is love, bin or clear.");
    const ratingMode = optString(input, "rating");
    const mediaAsk = optString(input, "media");
    if (mediaAsk !== undefined && mediaAsk !== "on" && mediaAsk !== "off" && mediaAsk !== "next") throw new ToolError("`media` is on, off or next.");
    const mediaSetName = optString(input, "mediaSet");
    if (ratingMode !== undefined && ratingMode !== "start" && ratingMode !== "stop") throw new ToolError("`rating` is start or stop.");
    const rawFrame = input.frame;
    if (rawFrame !== undefined && (typeof rawFrame !== "object" || rawFrame === null || Array.isArray(rawFrame))) throw new ToolError("`frame` is an object: repeat, mirror, spin, zoom or reset.");
    const frameIn = (rawFrame ?? {}) as Record<string, unknown>;
    const frame: Partial<Frame> = {};
    if (frameIn.repeat !== undefined) {
      if (![1, 2, 3, 4].includes(frameIn.repeat as number)) throw new ToolError("`frame.repeat` is 1, 2, 3 or 4.");
      frame.repeat = frameIn.repeat as Frame["repeat"];
    }
    if (frameIn.mirror !== undefined) frame.mirror = frameIn.mirror === true;
    if (frameIn.spin !== undefined) frame.spin = Math.max(-90, Math.min(90, Number(frameIn.spin) || 0));
    if (frameIn.zoom !== undefined) frame.zoom = Math.max(0.4, Math.min(2, Number(frameIn.zoom) || 1));
    if (roll !== undefined && roll !== "chaos" && roll !== "mutate") throw new ToolError("`roll` is chaos or mutate.");
    if (action !== undefined && !["play", "pause", "toggle", "next", "previous"].includes(action)) throw new ToolError("`action` is one of play, pause, toggle, next, previous.");
    if (visualizer !== undefined && visualizer !== "open" && visualizer !== "close") throw new ToolError("`visualizer` is open or close.");
    if (look !== undefined && !liveLook(look)) throw new ToolError(`There's no look "${look}". Looks: ${LIVE_LOOKS.map((l) => l.id).join(", ")}.`);
    const autoSwitch = auto === undefined ? undefined : AUTO_SWITCHES.find((a) => a.id === auto);
    if (auto !== undefined && !autoSwitch) throw new ToolError(`\`auto\` is one of ${AUTO_SWITCHES.map((a) => a.id).join(", ")}.`);
    if ((action !== undefined || seek !== undefined) && (!np.status || np.status.unavailable)) {
      throw new ToolError(`The music player can't be controlled: ${np.status?.message ?? (np.status?.unavailable ? UNAVAILABLE[np.status.unavailable] : "it hasn't answered yet")}`);
    }
    const done: string[] = [];
    if (action) {
      await np.command({ action: action as "play" });
      done.push(`told ${np.status?.player ?? "the player"} to ${action}`);
    }
    if (seek !== undefined) {
      await np.command({ action: "seek", position: seek });
      done.push(`went to ${formatDuration(seek)} in the song`);
    }
    if (effects) {
      useVisualizerPrefs.getState().setEffects(effects.id);
      done.push(`effects: ${effects.label.toLowerCase()}`);
    }
    if (autoSwitch) {
      useVisualizerPrefs.getState().setAuto(autoSwitch.id);
      done.push(`looks change: ${autoSwitch.label.toLowerCase()}`);
    }
    if (pace !== undefined) {
      useVisualizerPrefs.getState().setPace(pace);
      done.push(`speed: ${paceLabel(paceOf(pace)).toLowerCase()}`);
    }
    if (rate) {
      const ratings = useLookRatings.getState();
      await ratings.load();
      const target = look ?? useVisualizerPrefs.getState().look;
      const name = liveLook(target)?.name ?? target;
      if (np.visualizer) useVisualizerPrefs.getState().requestRate(rate, look);
      else {
        // Closed: rated as it is (the visualizer, opening, shows what it's told next).
        const was = ratings.taste.verdict(target, null);
        if (rate === "clear" && !was.here) throw new ToolError(`${name} has no rating to take back.`);
        const track = np.status?.track;
        ratings.rate({ look: target, verdict: rate, seconds: 0, song: track ? { id: track.id, name: track.name, artist: track.artist } : null, mood: null });
      }
      done.push(rate === "love" ? `loved ${name}` : rate === "bin" ? `binned ${name} (it won't be picked again)` : `took back the rating of ${name}`);
    }
    if (mediaSetName !== undefined) {
      const vis = useVisualizerMedia.getState();
      if (!vis.loaded) await vis.load();
      const { sets } = useVisualizerMedia.getState();
      const wanted = sets.find((s) => sameName(s.name, mediaSetName));
      if (!wanted) {
        throw new ToolError(
          sets.length
            ? `There's no set of clips called "${mediaSetName}". Sets: ${sets.map((s) => s.name).join(", ")}.`
            : "The user has no sets of clips yet: they make them in the visualizer's media panel.",
        );
      }
      useVisualizerMedia.getState().useSet(wanted.id);
      if (mediaAsk !== "off") {
        useVisualizerPrefs.getState().setMedia(true);
        if (!useNowPlaying.getState().visualizer) np.openVisualizer();
      }
      done.push(`feeding from the ${wanted.name} clips (${wanted.media.length})`);
    }
    if (mediaAsk) {
      const vis = useVisualizerMedia.getState();
      if (!vis.loaded) await vis.load();
      if (mediaAsk !== "off" && !useVisualizerMedia.getState().media.length) throw new ToolError("The user has no clips or pictures in the visualizer yet: they add them from its media panel (or drop them on it).");
      const prefs = useVisualizerPrefs.getState();
      if (mediaAsk === "next") {
        if (!prefs.media) prefs.setMedia(true);
        else prefs.requestNextMedia();
      } else prefs.setMedia(mediaAsk === "on");
      if (mediaAsk !== "off" && !useNowPlaying.getState().visualizer) np.openVisualizer();
      done.push(mediaAsk === "next" ? "brought in another clip" : mediaAsk === "on" ? "melting the user's clips into MilkDrop's looks" : "took the user's clips out of the visualizer");
    }
    if (ratingMode) {
      useLookRatings.getState().ask(ratingMode === "start");
      if (ratingMode === "start" && !useNowPlaying.getState().visualizer) np.openVisualizer();
      done.push(ratingMode === "start" ? "started the rating mode (the looks one after another: L loves, B bins, → next)" : "stopped the rating mode");
    }
    if (look && !rate) {
      useVisualizerPrefs.getState().request(look);
      if (!useNowPlaying.getState().visualizer) np.openVisualizer();
      done.push(`showing ${liveLook(look)!.name}`);
    } else if (input.fx !== undefined) {
      if (typeof input.fx !== "object" || input.fx === null || Array.isArray(input.fx)) throw new ToolError("`fx` is an object: warp, swirl, ripple, kaleido, pixelate, lens, fold, feedback, trails, echoZoom, echoSpin, echoHue, or wash.");
      const given = input.fx as Record<string, unknown>;
      const prefs = useVisualizerPrefs.getState();
      // Set by hand: the engine stops playing them.
      prefs.setEffects("hand");
      if (given.wash === true) {
        prefs.setFx("wash");
        prefs.requestFrame("reset");
      } else prefs.setFx(Object.fromEntries(Object.entries(given).filter(([k, v]) => k in NO_FX && typeof v === "number")));
      if (!useNowPlaying.getState().visualizer) np.openVisualizer();
      done.push(given.wash === true ? "washed the distortions, feedback and frame" : `set ${Object.keys(given).join(", ")}`);
    } else if (rawFrame !== undefined) {
      useVisualizerPrefs.getState().requestFrame(frameIn.reset === true ? "reset" : frame);
      if (!useNowPlaying.getState().visualizer) np.openVisualizer();
      done.push(frameIn.reset === true ? "put the frame back as it was" : `reframed the picture (${Object.entries(frame).map(([k, v]) => `${k} ${v}`).join(", ")})`);
    } else if (roll) {
      useVisualizerPrefs.getState().requestRoll(roll);
      if (!useNowPlaying.getState().visualizer) np.openVisualizer();
      done.push(roll === "chaos" ? "rolled chaos" : "mutated the chaos look");
    } else if (visualizer === "open") {
      np.openVisualizer();
      done.push("opened the visualizer");
    }
    if (visualizer === "close") {
      np.closeVisualizer();
      done.push("closed the visualizer");
    }
    if (!done.length) throw new ToolError("Nothing to do: give `action`, `seek`, `visualizer`, `look`, `frame`, `fx`, `roll`, `auto`, `effects`, `pace`, `rate`, `rating` or `media`.");
    return textResult(`Done: ${done.join(", ")}.`);
  },
  async open_sequence(input, ctx) {
    const doc = await ctx.doc();
    const raw = input.sequenceId;
    if (raw !== null && typeof raw !== "string") throw new ToolError("`sequenceId` must be a nested sequence's id, or null for the main sequence.");
    if (raw !== null && !getSequence(doc.document, raw)) {
      const ids = (doc.document.sequences ?? []).map((s) => `${s.id} (${s.name})`);
      throw new ToolError(`There's no sequence "${raw}". ${ids.length ? `Nested sequences: ${ids.join(", ")}.` : "This video has no nested sequences (nest_clips makes one)."}`);
    }
    doc.openSequence(raw);
    const name = raw === null ? "the main sequence" : `nested sequence ${raw} (${getSequence(doc.document, raw)!.name})`;
    return textResult(`Now working on ${name}: ${doc.project.clips.length} clips, ${secs(projectDuration(doc.project))}s. Call get_timeline to see it.`);
  },
  async focus(input, ctx) {
    const doc = await ctx.doc();
    const time = optNumber(input, "time", { min: 0 });
    const clipIds = optStrings(input, "clipIds");
    if (time === undefined && !clipIds) throw new ToolError("Give `time` and/or `clipIds`.");
    if (clipIds) clipsOf(doc.project, clipIds);
    if (!doc.isOpen) return textResult("The user is looking at another video right now, so there's nothing to show them. Carry on.");
    if (time !== undefined) {
      usePlayback.getState().pause();
      usePlayback.getState().seek(time);
    }
    if (clipIds) useEditor.getState().setSelection(clipIds);
    return textResult(
      [time !== undefined && `Playhead at ${secs(usePlayback.getState().time)}`, clipIds && `selected ${clipIds.length ? clipIds.join(", ") : "nothing"}`]
        .filter(Boolean)
        .join("; ") + ".",
    );
  },
};

/** The video a call acts on: its chat's, or (for an agent outside the app) the open one. */
function callDoc(ctx: ToolContext): () => Promise<ToolDoc> {
  let doc: Promise<ToolDoc> | null = null;
  return () => {
    const projectId = ctx.chat ?? useEditor.getState().projectId;
    if (!projectId) return Promise.reject(new ToolError("No video is open in the editor. Ask the user to open one."));
    doc ??= docFor(projectId);
    return doc;
  };
}

/** Run a tool call. Failures become error results with a message for the model. */
export async function runTool(name: string, input: Input, ctx: ToolContext): Promise<ToolResult> {
  const handler = (TOOLS as Record<string, Handler | undefined>)[name];
  if (!handler) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  if (ctx.signal.aborted) return { content: [{ type: "text", text: "Stopped: the user switched to another video." }], isError: true };
  try {
    return await handler(input, { ...ctx, doc: callDoc(ctx) });
  } catch (err) {
    if (err instanceof ToolError) return { content: [{ type: "text", text: err.message }], isError: true };
    if ((err as { name?: string })?.name === "AbortError") return { content: [{ type: "text", text: "Stopped." }], isError: true };
    logger.error(`${name} failed`, err);
    const content: ToolContent[] = [{ type: "text", text: `${name} failed: ${errorMessage(err)}` }];
    return { content, isError: true };
  }
}

/** Access for tests: every tool has a handler. */
export const toolNames = () => Object.keys(TOOLS);
