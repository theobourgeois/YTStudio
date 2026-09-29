/**
 * Every assistant tool, run in the editor tab (see `shared/assistant-tools.ts`
 * for what each one is, and `bridge.ts` for how calls arrive). Edits go
 * through the editor store like the user's own: one undo step each, the
 * changed clips highlighted. Looking and slower actions use the same stores
 * and API as the rest of the app.
 */
import { type ToolContent, type ToolName, type ToolResult, textResult } from "@shared/assistant-tools";
import { captionClips, captionSourceClips } from "@shared/captions";
import { errorMessage } from "@shared/errors";
import { templateFromClips } from "@shared/library";
import { clamp } from "@shared/math";
import { clipEnd, getClip, timelineTime } from "@shared/timeline";
import type { Clip, ExportJob, ExportResolution, Library, MediaAsset, Project, TranscriptionEngineId } from "@shared/types";
import { drawTexts } from "@/components/export/draw-texts";
import { api } from "@/lib/api";
import { useAssistant } from "@/stores/assistant";
import { type CaptionOptions, useCaptions } from "@/stores/captions";
import { useEditor } from "@/stores/editor";
import { useLibrary } from "@/stores/library";
import { usePlayback } from "@/stores/playback";
import { type CatalogKind, describeCatalog, describeClips, describeLibrary, describeMedia, describeTimeline, describeTranscript } from "./describe";
import { EDITS, clipChanges } from "./edits";
import { mediaFrames, programFrames } from "./frames";
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

export interface ToolContext {
  /** The chat the call is for (its video's id), or null for an agent outside the app. */
  chat: string | null;
  signal: AbortSignal;
  progress: (fraction: number | null, label?: string) => void;
}

type Handler = (input: Input, ctx: ToolContext) => ToolResult | Promise<ToolResult>;

const POLL_MS = 500;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function openProject(): { projectId: string; project: Project } {
  const { projectId, project } = useEditor.getState();
  if (!projectId) throw new ToolError("No video is open in the editor.");
  return { projectId, project };
}

const assetsById = () => Object.fromEntries(useEditor.getState().assets.map((a) => [a.id, a]));

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

/** Report an edit made some other way (captions, the Library): highlight it and remember it for the turn. */
function finishEdit(before: Project, ctx: ToolContext) {
  const after = useEditor.getState().project;
  const changes = clipChanges(before, after);
  useAssistant.getState().highlight([...changes.added, ...changes.changed]);
  useAssistant.getState().recordEdit(ctx.chat, before, after);
  return changes;
}

/** An edit tool: its pure edit, committed as one undo step. */
const edit =
  (name: keyof typeof EDITS): Handler =>
  async (input, ctx) => {
    await gesturesSettled(ctx.signal);
    const editor = useEditor.getState();
    openProject();
    const before = editor.project;
    const out = EDITS[name](before, input, { assets: assetsById(), playhead: usePlayback.getState().time });
    if (out.project !== before) editor.commit(() => out.project);
    if (out.rename) useEditor.getState().renameProject(out.rename);
    return textResult(out.text, finishEdit(before, ctx));
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

async function libraryNow(): Promise<Library> {
  await useLibrary.getState().load();
  const { folders, items, assets } = useLibrary.getState();
  return { folders, items, media: assets };
}

const TOOLS: Record<ToolName, Handler> = {
  // -------------------------------------------------------------------------
  // Looking
  // -------------------------------------------------------------------------
  get_timeline(input) {
    const { project } = openProject();
    const trackId = optString(input, "trackId");
    return textResult(
      describeTimeline(
        project,
        assetsById(),
        { playhead: usePlayback.getState().time, selectedClipIds: useEditor.getState().selectedClipIds },
        {
          from: optNumber(input, "from"),
          to: optNumber(input, "to"),
          ...(trackId && { trackId }),
          captions: optBoolean(input, "captions") ?? false,
        },
      ),
    );
  },
  get_clips(input) {
    const { project } = openProject();
    return textResult(describeClips(project, assetsById(), strings(input, "clipIds")));
  },
  list_media() {
    const { project } = openProject();
    return textResult(describeMedia(project, useEditor.getState().assets));
  },
  async view_frames(input, ctx) {
    openProject();
    const times = optNumbers(input, "times") ?? [];
    if (times.length === 0 || times.length > 8) throw new ToolError("`times` must have 1 to 8 times.");
    const width = clamp(optNumber(input, "width") ?? 480, 64, 960);
    const duration = usePlayback.getState().duration;
    if (duration <= 0) throw new ToolError("The timeline is empty: there's nothing to look at.");
    const content = await programFrames(times.map((t) => clamp(t, 0, Math.max(0, duration - 0.001))), width, ctx.signal);
    return { content };
  },
  async view_media(input, ctx) {
    openProject();
    const assetId = string(input, "assetId");
    const asset = useEditor.getState().getAsset(assetId);
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
    const { project } = openProject();
    const assets = assetsById();
    const ids = optStrings(input, "clipIds");
    const clips = ids ? clipsOf(project, ids) : captionSourceClips(project, assets);
    const heard = clips.filter((c) => assets[c.assetId]?.hasAudio);
    if (heard.length === 0) throw new ToolError(ids ? "None of those clips have sound." : "No clip on the timeline has sound.");
    const engine = await readyEngine(oneOf(input, "engine", ["local", "openai", "groq"] as const));
    const language = optString(input, "language") ?? "auto";
    let job = await api.startTranscription({ engine, language, sources: heard.map((c) => ({ assetId: c.assetId, in: c.in, out: c.out })) });
    ctx.signal.addEventListener("abort", () => void api.cancelTranscription(job.id).catch(() => {}));
    while (job.status === "queued" || job.status === "running") {
      ctx.progress(job.progress, "Transcribing");
      await sleep(POLL_MS);
      if (ctx.signal.aborted) throw new ToolError("Stopped.");
      job = await api.getTranscription(job.id);
    }
    if (job.status !== "done" || !job.transcripts) throw new ToolError(job.error ?? "Transcription failed.");
    return textResult(describeTranscript(heard, job.transcripts, assets));
  },
  async analyze_audio(input, ctx) {
    const { project } = openProject();
    const assets = assetsById();
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
  async detect_scenes(input, ctx) {
    openProject();
    const asset = useEditor.getState().getAsset(string(input, "assetId"));
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
    const kind = oneOf(input, "kind", ["video_effects", "transitions", "clip_properties", "caption_styles", "fonts"] as const) as CatalogKind | undefined;
    if (!kind) throw new ToolError("`kind` is required.");
    const fonts = kind === "fonts" ? await api.listFonts() : [];
    return textResult(describeCatalog(kind, optString(input, "query"), fonts));
  },
  async search_online(input, ctx) {
    const query = string(input, "query");
    const limit = clamp(Math.round(optNumber(input, "limit") ?? 8), 1, 20);
    ctx.progress(null, "Searching");
    const clips = (await api.searchWeb(query, ctx.signal)).slice(0, limit);
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
  batch: edit("batch"),

  // -------------------------------------------------------------------------
  // Other actions
  // -------------------------------------------------------------------------
  async generate_captions(input, ctx) {
    const { project } = openProject();
    const ids = optStrings(input, "clipIds");
    if (ids) clipsOf(project, ids);
    const captions = useCaptions.getState();
    if (captions.run.status === "running") throw new ToolError("Captions are already being made.");
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
    const changes = finishEdit(before, ctx);
    const now = captionClips(useEditor.getState().project);
    if (changes.added.length === 0) return textResult("No speech was found in those clips, so no captions were added.", changes);
    return textResult(
      `Added ${changes.added.length} captions (${now.length} in all, ${had ? "replacing the ones over those clips" : "on a Captions track"}) with the "${options.style}" style, "${options.length}" length and "${options.animation}" animation. Restyle them with style_captions; edit one's words with set_properties (effect "text").`,
      changes,
    );
  },
  async import_media(input, ctx) {
    const { projectId } = openProject();
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
    if (useEditor.getState().projectId === projectId) useEditor.getState().addImportedAssets(imported);
    if (imported.length === 0) throw new ToolError(`Nothing was imported. ${failed.join("; ")}`);
    return textResult([...lines, ...failed.map((f) => `Failed: ${f}`), "Put them on the timeline with add_clips."].join("\n"));
  },
  async delete_media(input, ctx) {
    const { project } = openProject();
    const asset = useEditor.getState().getAsset(string(input, "assetId"));
    if (!asset) throw new ToolError("There's no such media in this video. Call list_media.");
    const uses = project.clips.filter((c) => c.assetId === asset.id).length;
    const ok = await useAssistant
      .getState()
      .confirm(`Delete “${asset.name}”?`, uses ? `Its ${uses} clip${uses === 1 ? "" : "s"} will be removed from the timeline too. This can't be undone.` : "This can't be undone.", ctx.signal);
    if (!ok) throw new ToolError("The user said no. Don't delete it.");
    const before = useEditor.getState().project;
    await useEditor.getState().deleteAsset(asset.id);
    if (useEditor.getState().getAsset(asset.id)) throw new ToolError("It couldn't be deleted.");
    return textResult(`Deleted "${asset.name}"${uses ? ` and its ${uses} clip${uses === 1 ? "" : "s"}` : ""}.`, finishEdit(before, ctx));
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
      const ok = await useAssistant.getState().confirm(`Delete the folder “${folder.name}”?`, "Everything in it goes too. Videos keep their own copies of its media. This can't be undone.", ctx.signal);
      if (!ok) throw new ToolError("The user said no. Don't delete it.");
      await api.deleteLibraryFolder(folderId);
      await useLibrary.getState().refresh();
      return textResult(`Deleted the folder "${folder.name}" and everything in it.`);
    }
    const item = library.items.find((i) => i.id === itemId);
    if (!item) throw new ToolError(`There's no item "${itemId}". Call get_library.`);
    const ok = await useAssistant.getState().confirm(`Delete “${item.name}” from the Library?`, "Videos keep their own copies. This can't be undone.", ctx.signal);
    if (!ok) throw new ToolError("The user said no. Don't delete it.");
    await api.deleteLibraryItem(item.id);
    await useLibrary.getState().refresh();
    return textResult(`Deleted "${item.name}" from the Library.`);
  },
  async library_save(input) {
    const { projectId, project } = openProject();
    const assetIds = optStrings(input, "assetIds") ?? [];
    const clipIds = optStrings(input, "clipIds") ?? [];
    const folderId = optString(input, "folderId") ?? null;
    if (assetIds.length + clipIds.length === 0) throw new ToolError("Give `assetIds` and/or `clipIds`.");
    const lines: string[] = [];
    for (const assetId of assetIds) {
      const { item } = await api.saveMediaToLibrary({ assetId, folderId });
      lines.push(`Saved media as item ${item.id} "${item.name}".`);
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
    openProject();
    const itemId = string(input, "itemId");
    const before = useEditor.getState().project;
    const item = await useEditor.getState().addLibraryItem(itemId, {
      at: optNumber(input, "start") ?? usePlayback.getState().time,
      ...(optString(input, "trackId") && { trackId: optString(input, "trackId") }),
    });
    if (!item) throw new ToolError("It couldn't be added (see the message in the app). Check the id with get_library.");
    await useLibrary.getState().refresh();
    const changes = finishEdit(before, ctx);
    const project = useEditor.getState().project;
    const placed = changes.added.map((id) => getClip(project, id)!).map((c) => `${c.id} ${range(c.start, clipEnd(c))}`);
    return textResult(`Added "${item.name}": ${placed.join(", ")}.`, changes);
  },
  async export_video(input, ctx) {
    const { project } = openProject();
    if (project.clips.length === 0) throw new ToolError("The timeline is empty: there's nothing to export.");
    const resolution: ExportResolution = oneOf(input, "resolution", ["720p", "1080p", "4k"] as const) ?? "1080p";
    ctx.progress(null, "Preparing");
    const texts = await drawTexts(project, resolution);
    let job: ExportJob = await api.startExport({
      project,
      resolution,
      fileName: optString(input, "fileName"),
      excludeAudioTracks: optBoolean(input, "excludeAudio") ?? false,
      texts,
    });
    ctx.signal.addEventListener("abort", () => void api.cancelExport(job.id).catch(() => {}));
    while (job.status === "queued" || job.status === "rendering") {
      ctx.progress(job.progress, "Rendering");
      await sleep(POLL_MS);
      if (ctx.signal.aborted) throw new ToolError("Stopped.");
      job = await api.getExport(job.id);
    }
    if (job.status !== "done" || !job.url) throw new ToolError(job.error ?? "The export failed.");
    return textResult(`Exported "${job.fileName}" (${job.width}×${job.height}, ${secs(job.duration)}s): ${location.origin}${job.downloadUrl ?? job.url}`);
  },
  focus(input) {
    openProject();
    const time = optNumber(input, "time", { min: 0 });
    const clipIds = optStrings(input, "clipIds");
    if (time === undefined && !clipIds) throw new ToolError("Give `time` and/or `clipIds`.");
    if (clipIds) clipsOf(useEditor.getState().project, clipIds);
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

/** Run a tool call. Failures become error results with a message for the model. */
export async function runTool(name: string, input: Input, ctx: ToolContext): Promise<ToolResult> {
  const handler = (TOOLS as Record<string, Handler | undefined>)[name];
  if (!handler) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  if (ctx.signal.aborted) return { content: [{ type: "text", text: "Stopped: the user switched to another video." }], isError: true };
  try {
    return await handler(input, ctx);
  } catch (err) {
    if (err instanceof ToolError) return { content: [{ type: "text", text: err.message }], isError: true };
    if ((err as { name?: string })?.name === "AbortError") return { content: [{ type: "text", text: "Stopped." }], isError: true };
    console.error(`[assistant] ${name} failed`, err);
    const content: ToolContent[] = [{ type: "text", text: `${name} failed: ${errorMessage(err)}` }];
    return { content, isError: true };
  }
}

/** Access for tests: every tool has a handler. */
export const toolNames = () => Object.keys(TOOLS);
