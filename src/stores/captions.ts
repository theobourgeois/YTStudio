/**
 * Auto captions in the app: the options (remembered between sessions), the
 * dialog, the transcription engines and their setup, and a run: transcribe
 * the clips' speech on the server, lay the words out as captions that fit the
 * canvas in the chosen style, and add them as one undo step.
 */
import { create } from "zustand";
import { toast } from "sonner";
import type { Clip, ParamValues, TranscriptionEngineId, TranscriptionEngineInfo, TranscriptionJob } from "@shared/types";
import {
  CAPTION_LENGTHS,
  type CaptionAnimation,
  type CaptionLength,
  type CaptionStyle,
  DEFAULT_CAPTION_LENGTH,
  DEFAULT_CAPTION_PRESET,
  addCaptions,
  captionAnimation,
  captionClips,
  captionCues,
  captionPreset,
  captionSourceClips,
  captionStyleOf,
  isCaptionLanguage,
  presetPosition,
  presetStyle,
  timelineWords,
} from "@shared/captions";
import { APPEARANCE, textEffects, textStyleAt } from "@shared/effects";
import { errorMessage } from "@shared/errors";
import { sanitizeParams } from "@shared/params";
import { clipEnd, getClip, outputSize } from "@shared/timeline";
import { api } from "@/lib/api";
import { layoutText, textFont } from "@/lib/text-render";
import { useEditor } from "./editor";
import { fontsSettled } from "./fonts";
import { useLayout } from "./layout";

const SETTINGS_KEY = "editor-auto-captions";
const POLL_MS = 400;
const ENGINE_POLL_MS = 700;
/** A caption line may take up this much of the canvas width, and hold this many characters. */
const MAX_LINE_WIDTH = 0.86;
const MAX_LINE_CHARS = 42;

export interface CaptionOptions {
  engine: TranscriptionEngineId;
  /** "auto" or an ISO 639-1 code. */
  language: string;
  /** A preset id, or "current": the look of the captions already there. */
  style: string;
  length: CaptionLength;
  /** A transition type, or "none". */
  animation: string;
  punctuation: boolean;
}

const DEFAULTS: CaptionOptions = {
  engine: "local",
  language: "auto",
  style: DEFAULT_CAPTION_PRESET,
  length: DEFAULT_CAPTION_LENGTH,
  animation: "pop",
  punctuation: true,
};

function loadOptions(): CaptionOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<CaptionOptions>;
    const o = { ...DEFAULTS, ...saved };
    return {
      engine: ["local", "openai", "groq"].includes(o.engine) ? o.engine : DEFAULTS.engine,
      language: isCaptionLanguage(o.language) ? o.language : DEFAULTS.language,
      style: captionPreset(o.style) ? o.style : DEFAULTS.style,
      length: CAPTION_LENGTHS.some((l) => l.value === o.length) ? o.length : DEFAULTS.length,
      animation: o.animation === "none" || captionAnimation(o.animation) ? o.animation : DEFAULTS.animation,
      punctuation: o.punctuation !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

/** What to caption: the selected clips, or every clip that's heard. */
export type CaptionScope = "selection" | "timeline";

export type CaptionRun =
  | { status: "idle" }
  | { status: "running"; projectId: string; jobId: string | null; progress: number; clips: number }
  | { status: "error"; message: string };

interface CaptionsState {
  /** The options last used (the dialog starts from them). */
  options: CaptionOptions;
  dialogOpen: boolean;
  /** Clips selected when the dialog was opened, to caption instead of the whole timeline. */
  dialogClipIds: string[];
  openDialog: (clipIds?: string[]) => void;
  closeDialog: () => void;

  engines: TranscriptionEngineInfo[] | null;
  enginesError: string | null;
  /** Fetch the engines (and keep polling while one is being set up). */
  loadEngines: () => Promise<void>;
  /** Local: install what's missing. Cloud: check and save the key. Throws with the reason on failure. */
  setUpEngine: (id: TranscriptionEngineId, apiKey?: string) => Promise<void>;
  forgetKey: (id: TranscriptionEngineId) => Promise<void>;

  run: CaptionRun;
  /** Transcribe the clips and add their captions (`clipIds`: the selection's, default the dialog's). */
  generate: (options: CaptionOptions, scope: CaptionScope, clipIds?: string[]) => Promise<void>;
  cancel: () => void;
}

let enginePoll: ReturnType<typeof setTimeout> | undefined;
let runToken = 0;

export const useCaptions = create<CaptionsState>((set, get) => ({
  options: loadOptions(),
  dialogOpen: false,
  dialogClipIds: [],

  openDialog(clipIds) {
    set({ dialogOpen: true, dialogClipIds: clipIds ?? useEditor.getState().selectedClipIds });
    void get().loadEngines();
  },

  closeDialog() {
    set({ dialogOpen: false });
  },

  engines: null,
  enginesError: null,

  async loadEngines() {
    clearTimeout(enginePoll);
    try {
      const engines = await api.listTranscriptionEngines();
      set({ engines, enginesError: null });
      if (engines.some((e) => e.status === "installing")) enginePoll = setTimeout(() => void get().loadEngines(), ENGINE_POLL_MS);
    } catch (err) {
      set({ enginesError: errorMessage(err) });
    }
  },

  async setUpEngine(id, apiKey) {
    const info = await api.setUpTranscriptionEngine(id, apiKey === undefined ? {} : { apiKey });
    set({ engines: (get().engines ?? []).map((e) => (e.id === id ? info : e)) });
    if (info.status === "installing") await get().loadEngines();
  },

  async forgetKey(id) {
    const info = await api.forgetTranscriptionKey(id);
    set({ engines: (get().engines ?? []).map((e) => (e.id === id ? info : e)) });
  },

  run: { status: "idle" },

  async generate(options, scope, clipIds = get().dialogClipIds) {
    const editor = useEditor.getState();
    const projectId = editor.projectId;
    if (!projectId || get().run.status === "running") return;
    const assets = Object.fromEntries(editor.assets.map((a) => [a.id, a]));
    const sources = captionSourceClips(editor.project, assets, scope === "selection" ? clipIds : undefined);
    if (sources.length === 0) {
      set({ run: { status: "error", message: "There's no sound to caption in those clips." } });
      return;
    }
    // "current" only means something while there are captions; remember the last preset instead.
    const saved = { ...options, style: options.style === "current" ? get().options.style : options.style };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
    const token = ++runToken;
    const alive = () => token === runToken && useEditor.getState().projectId === projectId;
    set({ options: saved, run: { status: "running", projectId, jobId: null, progress: 0, clips: sources.length } });

    try {
      let job = await api.startTranscription({
        engine: options.engine,
        language: options.language,
        sources: sources.map((c) => ({ assetId: c.assetId, in: c.in, out: c.out })),
      });
      if (!alive()) {
        api.cancelTranscription(job.id).catch(() => {});
        return;
      }
      while (job.status === "queued" || job.status === "running") {
        set({ run: { status: "running", projectId, jobId: job.id, progress: job.progress, clips: sources.length } });
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive()) return;
        job = await api.getTranscription(job.id);
        if (!alive()) return;
      }
      if (job.status === "cancelled") return set({ run: { status: "idle" } });
      if (job.status === "error" || !job.transcripts) throw new Error(job.error ?? "Transcription failed.");
      const added = await placeCaptions(job, sources.map((c) => c.id), options);
      if (!alive()) return;
      set({ run: { status: "idle" }, dialogOpen: false });
      if (added === 0) {
        toast("No speech found", { description: "There were no words to caption in those clips." });
        return;
      }
      useLayout.getState().setLeftPanel("captions");
      toast.success(`Added ${added} caption${added === 1 ? "" : "s"}`, {
        description: "Edit their words and style in the Captions tab.",
        action: { label: "Undo", onClick: () => useEditor.getState().undo() },
      });
    } catch (err) {
      if (!alive()) return;
      const message = errorMessage(err);
      set({ run: { status: "error", message } });
      if (!get().dialogOpen) toast.error("Auto captions failed", { description: message });
    }
  },

  cancel() {
    const run = get().run;
    runToken++;
    if (run.status === "running" && run.jobId) api.cancelTranscription(run.jobId).catch(() => {});
    set({ run: { status: "idle" } });
  },
}));

/** A caption style and position from the options (or the captions already there). */
function chosenLook(options: CaptionOptions): { style: CaptionStyle; motion: ParamValues } {
  const { project } = useEditor.getState();
  const existing = captionClips(project)[0];
  if (options.style === "current" && existing) return captionStyleOf(existing);
  const preset = captionPreset(options.style) ?? captionPreset(DEFAULT_CAPTION_PRESET)!;
  const aspect = project.settings.aspectRatio;
  return { style: presetStyle(preset, aspect), motion: { position: presetPosition(preset, aspect) } };
}

/** Turn a finished transcription into captions over the clips (where they are now). Returns how many. */
async function placeCaptions(job: TranscriptionJob, clipIds: string[], options: CaptionOptions): Promise<number> {
  const editor = useEditor.getState();
  const clips = clipIds.map((id) => getClip(editor.project, id)).filter((c): c is Clip => !!c);
  const { style, motion } = chosenLook(options);

  // Lay lines out in the captions' font to see what fits across the canvas.
  const effects = textEffects(style.text).map((e) =>
    e.type === APPEARANCE.type ? { ...e, params: sanitizeParams(APPEARANCE.params, style.appearance) } : e,
  );
  const look = textStyleAt({ id: "", assetId: "", trackId: "", start: 0, in: 0, out: 1, effects }, 0);
  await fontsSettled();
  await document.fonts.load(textFont(look, 1), "Hg").catch(() => {});
  const canvas = outputSize(editor.project.settings.aspectRatio, "1080p");
  const scale = typeof motion.scale === "number" ? motion.scale : 1;
  const fits = (line: string) =>
    line.length <= MAX_LINE_CHARS && layoutText({ ...look, text: line }, 1).blockWidth * scale <= canvas.width * MAX_LINE_WIDTH;

  const length = CAPTION_LENGTHS.find((l) => l.value === options.length) ?? CAPTION_LENGTHS[1];
  const cues = captionCues(timelineWords(clips, job.transcripts ?? []), {
    maxWords: length.maxWords,
    lines: length.lines,
    fits,
    punctuation: options.punctuation,
  });
  if (cues.length === 0) return 0;
  const animation: CaptionAnimation | null = options.animation === "none" ? null : captionAnimation(options.animation);
  useEditor.getState().commit(
    (p) =>
      addCaptions(p, cues, {
        style,
        motion,
        animation,
        replace: clips.map((c) => ({ start: c.start, end: clipEnd(c) })),
      }).project,
  );
  return cues.length;
}
