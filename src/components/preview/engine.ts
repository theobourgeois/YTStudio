import { type Hearing, type SignalReader, currentSignalReader, nestedHearing, usesSignals, withHearing, withSignals } from "@shared/audio-signals";
import { useSignals } from "@/stores/signals";
import type { Clip, MediaAsset, Project } from "@shared/types";
import { atFrameRate, clipKind, definitionOf, isRemapped, lookAt, motionAt, solidColorAt, textStyleAt, volumeAt } from "@shared/effects";
import { nestedSequence, sequenceDuration, sequenceSize, sequenceView } from "@shared/sequences";
import { mediaTime, remapSpeed } from "@shared/time-remap";
import { type Compositor, type Placed, createCompositor, matteIndex } from "@shared/compositor";
import { effectPasses } from "@shared/effect-gl";
import { frameSourceTime } from "@shared/simulation";
import { PREVIEW_SAMPLES, clipLayer, placer, projectCamera, sortByDepth, withTrackMattes } from "@shared/layers";
import { parentAt } from "@shared/parenting";
import { type Shown, type TransitionPlan, planTrack, planTransition } from "@shared/scene";
import { shapeDrawingAt } from "@shared/shapes";
import { clipEnd, clipSourceRange, clipSpeed, fileTime, outputSize, sourceTime, videoTracks } from "@shared/timeline";
import { transitionShader, transitionUniforms } from "@shared/transition-gl";
import { type TransitionWindow, trackTransitions } from "@shared/transition-windows";
import { textDrawing, textUnit } from "@shared/text-drawing";
import { type Size, fittedSize } from "@shared/transform";
import { useEditor } from "@/stores/editor";
import { useFonts } from "@/stores/fonts";
import { usePlayback } from "@/stores/playback";
import { SETTLE_MS, nextAdaptiveLevel } from "./adaptive";
import { ImageSlot, MediaSlot } from "./media-slot";
import { placeOnCanvas } from "./placement";
// Also has the user's shaders compiled before they're drawn (`provideShaderCheck`).
import { recoverFromLostContext } from "./shader-recovery";
import { type SlotIds, assignSlots } from "./sync";

/**
 * The hidden elements that decode one video track's pictures: an A/B pair
 * for video clips, and one for still images. (Text, solids and shapes have
 * none: the compositor draws them itself.)
 */
interface VideoLayer {
  videos: [MediaSlot | null, MediaSlot | null];
  videoIds: SlotIds;
  images: [ImageSlot | null, ImageSlot | null];
  imageIds: SlotIds;
}

/** The hidden pair of elements that play one audio track (see `VideoLayer`). */
interface AudioLayer {
  slots: [MediaSlot | null, MediaSlot | null];
  ids: SlotIds;
}

type ClipKind = "video" | "image" | "text" | "solid" | "shape" | "adjustment" | "camera" | "null" | "sequence";

/** A picture to draw: the element it comes from (none for what the compositor draws itself: text, solids, shapes), and when in its clip. */
interface Picture {
  key: string;
  source: HTMLVideoElement | HTMLImageElement | null;
  shown: Shown;
  /**
   * A time-interpolated video (`Clip.timeInterpolation`): its slot (whose frames are counted),
   * the file time wanted, and whether to use optical flow. It plays a frame ahead, so the
   * frame before is kept (under `${key}~`) and the moment wanted is between the two.
   */
  interp?: { slot: MediaSlot; target: number; flow: boolean };
  /**
   * A nested sequence: its level and layers, drawn into a group picture (`key`) before it's placed.
   * `settled`: everything in it shows what it should for its time, so the frame can be kept.
   */
  nest?: { level: Level; layers: Layer[]; settled: boolean };
}

/**
 * One sequence being shown: the main one, or one a nested clip plays. Its tracks' media
 * elements are the engine's under `prefix` + track id; it plays at `rate` times its clips'
 * own speeds, `gain` times their volumes, on a canvas of `canvas` CSS px.
 */
interface Level {
  view: Project;
  prefix: string;
  time: number;
  playing: boolean;
  rate: number;
  muted: boolean;
  gain: number;
  canvas: Size;
  depth: number;
  /** What "the mix" is inside it (a nest hears the sequence it's placed in), null at the top. */
  hearing: Hearing | null;
}

/** What planning found out: media missing, or anything not yet showing what its time says (see `Picture.nest`). */
interface PlanStatus {
  offline: boolean;
  unsettled: boolean;
  /** Something shown carries pictures on the GPU from frame to frame (see `carriesState`): drawn at one size. */
  stateful: boolean;
}

/**
 * Whether a clip has an effect that keeps pictures from frame to frame on the GPU (a time effect's earlier
 * frames, a simulation's state): what it shows depends on the size its earlier frames were drawn at, so it
 * isn't drawn at fewer pixels while moving (`adaptive.ts`). (A 3D scene steps in TypeScript: it can be.)
 */
const carriesState = (clip: Clip) =>
  clip.effects.some((e) => {
    const shader = e.enabled ? definitionOf(e)?.shader : undefined;
    return !!(shader?.history || shader?.simulation);
  });

/** Whether a clip has a time effect on (see `EffectShader.history`), or a simulation or 3D scene, which step from frame to frame. */
const hasTimeEffects = (clip: Clip) =>
  clip.effects.some((e) => {
    const shader = e.enabled ? definitionOf(e)?.shader : undefined;
    return !!(shader?.history || shader?.simulation || shader?.scene);
  });

/**
 * How long a draw may spend catching simulations up to the frame shown (stepping them from their newest
 * checkpoint), playing and paused: what's left is done by the next draws, the frame meanwhile close.
 */
const CATCH_UP_MS = { playing: 8, paused: 40 };

/** Nested sequences deeper than this aren't drawn (a guard; loops are never saved). */
const MAX_NESTING = 8;

/**
 * Frames the GPU may have queued: two, as a swap chain has, so the next is made while the last is drawn,
 * and no more, so the newest time is never far behind (see `PreviewEngine.inFlight`).
 */
const MAX_IN_FLIGHT = 2;

/** A frame sent to the GPU (see `PreviewEngine.inFlight`). */
interface Flight {
  sync: WebGLSync;
  sentAt: number;
  level: number;
  query: WebGLQuery | null;
}

/** GPU memory nested sequences' kept frames may take (bytes). */
const NEST_CACHE_BYTES = 384 * 1024 * 1024;

const viewKeys = new WeakMap<Project, number>();
let nextViewKey = 1;
/** A number for each sequence view: a new one whenever anything in it (or in what it nests) changes. */
function viewKey(view: Project): number {
  let key = viewKeys.get(view);
  if (key === undefined) viewKeys.set(view, (key = nextViewKey++));
  return key;
}

/** A clip's own playback rate times its level's, or null when it can't play (see `mediaOf`). */
function scaledRate(rate: number | null, levelRate: number): number | null {
  if (rate === null) return null;
  const r = rate * levelRate;
  return r >= MIN_PLAYBACK_RATE && r <= MAX_PLAYBACK_RATE ? r : null;
}

/** What the engine shows and when: the editor's video and playhead, or (for the assistant) another video at a time. */
export interface PreviewSource {
  get(): { project: Project; assets: MediaAsset[]; time: number; playing: boolean };
  /** Be told when any of it changes. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Where its sound's signals are read from; absent: the open video's (`setSignalReader`). */
  signals?(): SignalReader | null;
}

/** The Program monitor's source: the open video at the playback clock. */
export const editorSource: PreviewSource = {
  get() {
    const { project, assets } = useEditor.getState();
    const { time, playing } = usePlayback.getState();
    return { project, assets, time, playing };
  },
  subscribe(listener) {
    const offPlayback = usePlayback.subscribe(listener);
    const offEditor = useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.assets !== prev.assets) listener();
    });
    return () => {
      offPlayback();
      offEditor();
    };
  },
};

/** A track matte to draw a layer through: the picture on the track above, and how (`MATTE_MODES`). */
type LayerMatte = { mode: number; picture: Picture };

/** What one track draws, bottom track first. */
type Layer =
  | { kind: "picture"; trackId: string; picture: Picture; matte?: LayerMatte }
  | { kind: "adjustment"; trackId: string; shown: Shown; matte?: LayerMatte }
  | { kind: "transition"; trackId: string; plan: TransitionPlan; from: Picture | null; to: Picture | null };

/**
 * Drives the preview outside React: it subscribes to its source (the playback
 * clock and the project), keeps the media elements playing (or parked) in step, and
 * draws every frame with the compositor (`shared/compositor.ts`) on one
 * WebGL canvas, the same way the export does.
 *
 * - Each video track has two <video> elements that double-buffer it: one shows
 *   the clip under the playhead, the other is parked on the next clip's first
 *   frame. Two <img> elements do the same for still images. The elements are
 *   hidden: they're only the compositor's sources. Text is laid out here and
 *   drawn by the compositor, like solids and shapes.
 * - What each track shows comes from `shared/scene.ts` (like the export): the
 *   clip under the playhead, placed where its Motion puts it and faded by its
 *   Opacity, read at the current time (so they follow keyframes), or a
 *   transition mixing both of its clips with its shader. Tracks are drawn
 *   bottom first over the black canvas.
 * - While a transition plays, both of its clips play (past their edges into
 *   their media's handles if need be, silent outside the clip itself).
 * - A clip at another speed plays its element at that rate (keeping its pitch
 *   unless told not to); one played backwards plays its media's reversed copy
 *   forwards (`MediaAsset.reversed`), since media elements only play forwards.
 * - Each audio track has an A/B pair of <audio> elements too: one plays the
 *   clip under the playhead, the other is parked on the next clip's in-point.
 *   (A pair per track, not an element per clip, so a voiceover cut into
 *   hundreds of pieces doesn't load its file hundreds of times.)
 * - Frames are drawn on every clock tick while playing, and otherwise when
 *   anything changes, including a video presenting a new frame after a seek.
 *   No more than two are ever queued on the GPU (a heavy edit scrubbed shows
 *   the newest time it can, never a backlog), and the Program monitor draws
 *   moving frames at fewer pixels when they're heavy (`adaptive.ts`).
 */
export class PreviewEngine {
  private layers = new Map<string, VideoLayer>();
  private audio = new Map<string, AudioLayer>();
  private unsubscribe: (() => void) | null = null;
  private offline = false;
  private indexedAssets: MediaAsset[] | null = null;
  private assetById = new Map<string, MediaAsset>();
  /** The canvas size in CSS px (where clips are placed). */
  private size: Size = { width: 0, height: 0 };
  /** Transition windows per track, for `planTransitionOf`. */
  private windows = new Map<string, TransitionWindow[]>();
  private windowsOf: Project | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private compositor: Compositor | null = null;
  /** When this draw stops catching simulations up, and whether it caught them all up. */
  private catchUpUntil = 0;
  private caughtUp = true;
  /** What each stored picture was made from (to know when it has to be uploaded again). */
  private uploaded = new Map<string, string>();
  /** Time-interpolated videos' frames: how many the slot had shown, and the media times of the newest two. */
  private frames = new Map<string, { count: number; src: string; time: number; before: number }>();
  private drawQueued = false;
  /** Preview resolution (Premiere's Playback Resolution): 1 full, 0.5 half, 0.25 quarter. */
  private resolution = 1;
  /**
   * Nested sequences' frames kept on the GPU (by the compositor's picture key, least
   * recently used first) with their size in bytes: a nest showing a frame it has drawn
   * before (paused, scrubbing back, a freeze, playing again) isn't drawn again.
   */
  private nestFrames = new Map<string, number>();
  /** Bumped when what's drawn can change without the project changing (media updated, fonts found). */
  private contentVersion = 0;
  /**
   * The frames the GPU is drawing, oldest first: a fence it signals when each is done, when it was sent
   * and at what adaptive level. At most `MAX_IN_FLIGHT`: a frame asked for meanwhile (`waiting`) is drawn
   * when one is done, at the newest time, so a scrub never queues up more work than the GPU can do.
   */
  private inFlight: Flight[] = [];
  /** The GPU's own timer (Chromium's), for what a frame cost; without it, the fence's wait says roughly. */
  private timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private waiting = false;
  private watchQueued = false;
  private lastFinished = 0;
  /** The adaptive level moving frames are drawn at, and when the picture last changed (see `FRAME_BUDGET_MS`). */
  private adaptive = 1;
  private movedAt = -Infinity;
  private lastShown: { project: Project; time: number } | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onStatusChange: (status: { offline: boolean; noWebGl: boolean }) => void,
    private readonly source: PreviewSource = editorSource,
    /** Draw moving frames at fewer pixels when they're heavy (the Program monitor; not the assistant's pictures). */
    private readonly adaptiveResolution = false,
  ) {}

  /** The Program monitor's engine (the open video's) turns off a shader that loses the GPU. */
  private get recovers() {
    return this.source === editorSource;
  }

  start() {
    if (this.unsubscribe) return;
    const offSource = this.source.subscribe(this.update);
    // Knowing the installed fonts can change which style a text is drawn in (so kept nest frames are stale).
    const offFonts = useFonts.subscribe(() => {
      this.contentVersion++;
      this.clearNestFrames();
      this.update();
    });
    // So do a sound's signals arriving: whatever reacts to it changes.
    const offSignals = useSignals.subscribe((s, prev) => {
      if (s.data === prev.data) return;
      this.contentVersion++;
      this.clearNestFrames();
      this.update();
    });
    this.unsubscribe = () => {
      offSource();
      offFonts();
      offSignals();
    };
    this.update();
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    for (const layer of this.layers.values()) for (const slot of layer.videos) slot?.pause();
    for (const layer of this.audio.values()) for (const slot of layer.slots) slot?.pause();
  }

  /** Draw at a fraction of the canvas' pixels (1, 0.5 or 0.25): less work for heavy edits. */
  setResolution(resolution: number) {
    const r = Math.min(1, Math.max(0.125, resolution));
    if (r === this.resolution) return;
    this.resolution = r;
    this.clearNestFrames();
    this.update();
  }

  /** The canvas size in CSS px. */
  setCanvasSize(size: Size) {
    if (size.width === this.size.width && size.height === this.size.height) return;
    this.size = size;
    this.update();
  }

  /** Ref-callback helper: the WebGL canvas everything is drawn on. Returns the cleanup. */
  attachCanvas(el: HTMLCanvasElement) {
    this.canvas = el;
    const lost = (e: Event) => {
      e.preventDefault(); // lets the context be restored
      this.releaseCompositor(false);
      // The user's shader that hung the GPU, if one did: off before the context comes back.
      if (this.recovers) recoverFromLostContext();
    };
    const restored = () => {
      this.createCompositor();
      this.update();
    };
    el.addEventListener("webglcontextlost", lost);
    el.addEventListener("webglcontextrestored", restored);
    this.createCompositor();
    this.update();
    return () => {
      el.removeEventListener("webglcontextlost", lost);
      el.removeEventListener("webglcontextrestored", restored);
      if (this.canvas !== el) return;
      this.releaseCompositor(true);
      this.canvas = null;
    };
  }

  private createCompositor() {
    const gl = this.canvas?.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      // Keeps the last frame readable between draws (screenshots, tests); cheap at preview size.
      preserveDrawingBuffer: true,
    });
    this.compositor = gl && !gl.isContextLost() ? createCompositor(gl) : null;
    this.timer = this.adaptiveResolution ? (gl?.getExtension("EXT_disjoint_timer_query_webgl2") ?? null) : null;
    if (!gl) console.warn("WebGL 2 isn't available, so the preview can't be drawn.");
    this.uploaded.clear();
    this.nestFrames.clear();
    this.reportStatus();
  }

  private releaseCompositor(dispose: boolean) {
    for (const flight of this.inFlight) this.forget(flight);
    this.inFlight = [];
    if (dispose && !this.compositor?.gl.isContextLost()) this.compositor?.dispose();
    this.compositor = null;
    this.uploaded.clear();
    this.nestFrames.clear();
  }

  /** Ref-callback helper: returns the cleanup that releases the element. */
  attachVideo(trackId: string, index: 0 | 1, el: HTMLVideoElement) {
    const slot = new MediaSlot(el, this.update, this.requestDraw);
    const layer = this.layer(trackId);
    layer.videos[index] = slot;
    layer.videoIds = withId(layer.videoIds, index, null);
    this.update();
    return () => {
      slot.dispose();
      if (layer.videos[index] !== slot) return;
      layer.videos[index] = null;
      layer.videoIds = withId(layer.videoIds, index, null);
      this.dropIfEmpty(trackId, layer);
    };
  }

  attachImage(trackId: string, index: 0 | 1, el: HTMLImageElement) {
    const slot = new ImageSlot(el, this.update);
    const layer = this.layer(trackId);
    layer.images[index] = slot;
    layer.imageIds = withId(layer.imageIds, index, null);
    this.update();
    return () => {
      slot.dispose();
      if (layer.images[index] !== slot) return;
      layer.images[index] = null;
      layer.imageIds = withId(layer.imageIds, index, null);
      this.dropIfEmpty(trackId, layer);
    };
  }

  attachAudio(trackId: string, index: 0 | 1, el: HTMLAudioElement) {
    const slot = new MediaSlot(el, this.update);
    let layer = this.audio.get(trackId);
    if (!layer) this.audio.set(trackId, (layer = { slots: [null, null], ids: [null, null] }));
    layer.slots[index] = slot;
    layer.ids = withId(layer.ids, index, null);
    this.update();
    return () => {
      slot.dispose();
      if (layer.slots[index] !== slot) return;
      layer.slots[index] = null;
      layer.ids = withId(layer.ids, index, null);
      if (!layer.slots.some(Boolean) && this.audio.get(trackId) === layer) this.audio.delete(trackId);
    };
  }

  private layer(trackId: string): VideoLayer {
    let layer = this.layers.get(trackId);
    if (!layer) {
      layer = {
        videos: [null, null],
        videoIds: [null, null],
        images: [null, null],
        imageIds: [null, null],
      };
      this.layers.set(trackId, layer);
    }
    return layer;
  }

  private dropIfEmpty(trackId: string, layer: VideoLayer) {
    if ([...layer.videos, ...layer.images].some(Boolean)) return;
    if (this.layers.get(trackId) === layer) this.layers.delete(trackId);
  }

  /** Draw again soon (once per animation frame at most), e.g. when a paused video has a new frame. */
  private requestDraw = () => {
    if (this.drawQueued || this.source.get().playing) return; // playing: every tick draws anyway
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.update();
    });
  };

  private update = () => {
    if (!this.unsubscribe) return;
    const { project, assets, time, playing } = this.source.get();
    if (project !== this.lastShown?.project || time !== this.lastShown.time) {
      this.lastShown = { project, time };
      this.movedAt = performance.now();
    }
    this.indexAssets(assets);
    if (project !== this.windowsOf) {
      this.windowsOf = project;
      this.windows.clear();
    }
    const status = { offline: false, unsettled: false, stateful: false };
    // Expressions hear the source's sound (the open video's unless it says otherwise).
    withSignals(this.source.signals?.() ?? null, () => {
      const layers = this.planLevel({ view: project, prefix: "", time, playing, rate: 1, muted: false, gain: 1, canvas: this.size, depth: 0, hearing: null }, status);
      this.draw(project, layers, status.stateful);
    });
    if (status.offline !== this.offline) {
      this.offline = status.offline;
      this.reportStatus();
    }
  };

  /**
   * What one sequence shows at its time (the main one, or one nested in a clip, see `Level`),
   * bottom track first, keeping its tracks' media elements playing (or parked) in step. A
   * nested clip's sequence is planned the same way, into a group picture of its own.
   */
  private planLevel(level: Level, status: PlanStatus): Layer[] {
    // Expressions are told this sequence's frame rate, and a nest's links and expressions hear where it's placed.
    return withHearing(level.hearing, () => atFrameRate(level.view.settings.fps, () => this.planTracks(level, status)));
  }

  private planTracks(level: Level, status: PlanStatus): Layer[] {
    const { view: project, prefix, time, playing, depth } = level;
    const trackMuted = new Map(project.tracks.map((t) => [t.id, t.muted]));
    const kindOf = (clip: Clip): ClipKind => {
      const kind = clipKind(clip);
      if (kind !== "media") return kind;
      const asset = this.assetById.get(clip.assetId);
      return asset?.sequence ? "sequence" : asset?.kind === "image" ? "image" : "video";
    };
    const drawn: Layer[] = [];

    // Video tracks, bottom first: an A/B pair of elements for video clips, another for stills, canvases for text.
    for (const track of [...videoTracks(project)].reverse()) {
      const trackId = track.id;
      const slotId = prefix + trackId;
      const layer = this.layers.get(slotId);
      const muted = level.muted || (trackMuted.get(trackId) ?? false);
      const { current, next } = planTrack(project, trackId, time);
      const transition = this.planTransitionOf(project, slotId, trackId, time);
      // What's on screen: both sides of a transition, or the clip under the playhead.
      const shown: Shown[] = transition
        ? [transition.from, transition.to].filter((s): s is Shown => !!s)
        : current
          ? [current]
          : [];
      /** The picture showing each clip on screen, by clip id. */
      const pictures = new Map<string, Picture>();

      // Text, solids and shape layers are drawn by the compositor itself.
      for (const side of shown) {
        const kind = kindOf(side.clip);
        if (kind === "solid" || kind === "shape" || kind === "text") pictures.set(side.clip.id, { key: "", source: null, shown: side });
      }

      // Nested sequences: planned as a level of their own, drawn into a group.
      shown.forEach((side, i) => {
        if (kindOf(side.clip) !== "sequence") return;
        const nest = this.nestLevel(level, trackId, side, muted);
        if (!nest) return;
        const inner: PlanStatus = { offline: false, unsettled: false, stateful: false };
        const layers = depth < MAX_NESTING ? this.planLevel(nest, inner) : [];
        status.offline ||= inner.offline;
        status.unsettled ||= inner.unsettled;
        status.stateful ||= inner.stateful;
        pictures.set(side.clip.id, { key: `nest:${slotId}:${i}`, source: null, shown: side, nest: { layers, level: nest, settled: !inner.unsettled } });
      });
      // Time effects remember earlier frames: what they show isn't the time's alone.
      if (shown.some((side) => hasTimeEffects(side.clip))) status.unsettled = true;
      if (shown.some((side) => carriesState(side.clip))) status.stateful = true;

      if (layer) {
        const ids = (want: ClipKind) => {
          const on = shown.filter((s) => kindOf(s.clip) === want).map((s) => s.clip.id);
          const upcoming = next && kindOf(next) === want && !shown.some((s) => s.clip.id === next.id) ? next.id : null;
          return [on[0] ?? null, on[1] ?? upcoming] as const;
        };
        layer.videoIds = assignSlots(layer.videoIds, ...ids("video"));
        layer.imageIds = assignSlots(layer.imageIds, ...ids("image"));

        layer.videos.forEach((slot, i) => {
          if (!slot) return;
          const id = layer.videoIds[i];
          const el = slot.el as HTMLVideoElement;
          const on = shown.find((s) => s.clip.id === id && kindOf(s.clip) === "video");
          setShown(el, !!on);
          if (on) {
            const media = this.mediaOf(on.clip);
            slot.setSrc(media.src);
            // A transition may show a clip past its edges; it's only heard inside them.
            const audible = time >= on.clip.start - 1e-6 && time < clipEnd(on.clip) - 1e-6;
            const rate = scaledRate(media.rate(on.time), level.rate);
            slot.setAudio(
              volumeAt(on.clip, on.time) * level.gain,
              muted || (!!transition && !audible) || !media.plays || rate === null,
              on.clip.keepPitch !== false,
            );
            // Time interpolation plays a frame ahead, keeping the one before: the moment wanted is between them.
            const fps = this.assetById.get(on.clip.assetId)?.fps ?? 0;
            const interp = on.clip.timeInterpolation && fps > 0 && media.plays ? on.clip.timeInterpolation : undefined;
            const lead = interp && playing ? 1 / fps : 0;
            if (playing && media.plays && rate !== null) slot.follow(media.at(on.time) + lead, rate);
            else slot.hold(media.at(on.time));
            // Showing the frame of its moment yet? (A frame's slack either way, as media elements land.)
            const slack = 1 / Math.max(24, fps || 30);
            if (interp || el.seeking || el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || Math.abs(el.currentTime - media.at(on.time)) > slack) {
              status.unsettled = true;
            }
            pictures.set(on.clip.id, {
              key: `${slotId}:v${i}`,
              source: el,
              shown: on,
              ...(interp && { interp: { slot, target: media.at(on.time), flow: interp === "flow" } }),
            });
            status.offline ||= media.src === null || slot.failed;
            return;
          }
          slot.setAudio(1, true);
          if (next && id === next.id) {
            const media = this.mediaOf(next);
            slot.setSrc(media.src);
            slot.hold(media.at(sourceTime(next, next.start)));
          } else {
            slot.pause();
          }
        });

        layer.images.forEach((slot, i) => {
          if (!slot) return;
          const id = layer.imageIds[i];
          const on = shown.find((s) => s.clip.id === id && kindOf(s.clip) === "image");
          setShown(slot.el, !!on);
          if (on) {
            const src = this.srcOf(on.clip);
            slot.setSrc(src);
            if (!slot.el.complete || slot.el.naturalWidth === 0) status.unsettled = true;
            pictures.set(on.clip.id, { key: `${slotId}:i${i}`, source: slot.el, shown: on });
            status.offline ||= src === null || slot.failed;
            return;
          }
          // Loading the next still ahead of time makes the cut instant.
          if (next && id === next.id) slot.setSrc(this.srcOf(next));
        });
      }

      const pictureOf = (side: Shown | null) => (side && pictures.get(side.clip.id)) ?? null;
      if (transition) {
        drawn.push({ kind: "transition", trackId, plan: transition, from: pictureOf(transition.from), to: pictureOf(transition.to) });
      } else if (current && kindOf(current.clip) === "adjustment") drawn.push({ kind: "adjustment", trackId, shown: current });
      else if (current && pictures.has(current.clip.id)) drawn.push({ kind: "picture", trackId, picture: pictures.get(current.clip.id)! });
    }

    // Audio tracks: the pair plays the clip under the playhead and parks the next one on its in-point.
    for (const track of project.tracks) {
      if (track.kind !== "audio") continue;
      const { current, next } = planTrack(project, track.id, time);
      const muted = level.muted || track.muted;
      // A nested sequence of sound only: its own audio tracks play (a level with no picture).
      if (current && kindOf(current.clip) === "sequence") {
        const nest = this.nestLevel(level, track.id, current, muted);
        if (nest && depth < MAX_NESTING) this.planLevel(nest, status);
      }
      const layer = this.audio.get(prefix + track.id);
      if (!layer) continue;
      const playable = (c: Clip | null) => (c && kindOf(c) !== "sequence" ? c : null);
      layer.ids = assignSlots(layer.ids, playable(current?.clip ?? null)?.id ?? null, playable(next)?.id ?? null);
      layer.slots.forEach((slot, i) => {
        if (!slot) return;
        const id = layer.ids[i];
        if (current && id === current.clip.id) {
          const media = this.mediaOf(current.clip);
          slot.setSrc(media.src);
          const rate = scaledRate(media.rate(current.time), level.rate);
          slot.setAudio(volumeAt(current.clip, current.time) * level.gain, muted || !media.plays || rate === null, current.clip.keepPitch !== false);
          if (playing && media.plays && rate !== null) slot.follow(media.at(current.time), rate);
          else slot.hold(media.at(current.time));
          status.offline ||= media.src === null || slot.failed;
          return;
        }
        slot.setAudio(1, true);
        if (next && id === next.id) {
          const media = this.mediaOf(next);
          slot.setSrc(media.src);
          slot.hold(media.at(sourceTime(next, next.start)));
        } else {
          slot.pause();
        }
      });
    }

    // Track mattes: a clip that uses one is drawn through the picture on the track above, which isn't drawn itself.
    const trackIds = videoTracks(project).map((t) => t.id);
    return withTrackMattes(
      drawn,
      (id) => trackIds[trackIds.indexOf(id) - 1],
      (l) => {
        const shown = l.kind === "picture" ? l.picture.shown : l.kind === "adjustment" ? l.shown : null;
        return shown ? matteIndex(lookAt(shown.clip, shown.time).trackMatte) : 0;
      },
      (l) => l.kind === "picture",
      (l, m, mode) => (l.kind === "transition" || m.kind !== "picture" ? l : { ...l, matte: { mode, picture: m.picture } }),
    );
  }

  /**
   * The level a nested clip shows (on its track `trackId` of `outer`): its sequence at the
   * time the clip shows of it, playing at the clip's rate times the outer one's, as loud as
   * its volume times the outer level's. Null when it shows nothing then.
   */
  private nestLevel(outer: Level, trackId: string, { clip, time }: Shown, muted: boolean): Level | null {
    const seq = nestedSequence(outer.view, clip);
    if (!seq) return null;
    const t = mediaTime(clip, time);
    if (!(t >= -1e-6 && t < sequenceDuration(seq) - 1e-6)) return null;
    const media = this.mediaOf(clip);
    const rate = scaledRate(media.rate(time), outer.rate);
    // Where the nest's frame is at 100%: its sequence fitted to the canvas it's on.
    const canvas = fittedSize(outer.canvas, sequenceSize(seq), motionAt(clip, time).fit);
    return {
      view: sequenceView(outer.view, seq.id),
      prefix: `${outer.prefix}${trackId}/${seq.id}/`,
      time: Math.max(0, t),
      playing: outer.playing && rate !== null,
      rate: rate ?? 1,
      muted: muted || rate === null,
      gain: outer.gain * volumeAt(clip, time),
      canvas,
      depth: outer.depth + 1,
      hearing: nestedHearing(clip, outer.hearing),
    };
  }

  private reportStatus() {
    this.onStatusChange({ offline: this.offline, noWebGl: !!this.canvas && !this.compositor });
  }

  /** Composite the tracks' layers onto the canvas. */
  private draw(project: Project, layers: Layer[], stateful: boolean) {
    const compositor = this.compositor;
    const canvas = this.canvas;
    if (!compositor || !canvas || !(this.size.width > 0 && this.size.height > 0)) return;
    const gl = compositor.gl;
    if (gl.isContextLost()) return;
    // The GPU still drawing the last frames: this one waits for one of them (and is then drawn as it is by then).
    // Meanwhile the monitor shows an earlier moment: catching up, as a simulation stepping to its frame is.
    if (this.inFlight.length >= MAX_IN_FLIGHT) {
      this.waiting = true;
      setData(canvas, "frame", "draft");
      setData(canvas, "simulation", "catching-up");
      return;
    }
    const playing = this.source.get().playing;
    const now = performance.now();
    const moving = playing || now - this.movedAt < SETTLE_MS;
    const level = this.adaptiveResolution && moving && !stateful ? this.adaptive : 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1) * this.resolution * level;
    const query = this.timer && gl.createQuery();
    if (query) gl.beginQuery(this.timer!.TIME_ELAPSED_EXT, query);
    compositor.resize(this.size.width * dpr, this.size.height * dpr);
    compositor.clear();
    this.catchUpUntil = now + (playing ? CATCH_UP_MS.playing : CATCH_UP_MS.paused);
    this.caughtUp = true;
    let count: { transitions: number };
    try {
      count = this.drawLayers(compositor, project, layers, this.size, dpr);
      compositor.present();
    } finally {
      if (query) gl.endQuery(this.timer!.TIME_ELAPSED_EXT);
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    if (sync) {
      this.inFlight.push({ sync, sentAt: performance.now(), level, query });
      this.watchGpu();
    } else if (query) gl.deleteQuery(query);
    // A frame drawn at fewer pixels is drawn again in full once the picture holds still.
    if (level < 1 && !playing) this.settleLater();
    setData(canvas, "frame", level < 1 ? "draft" : "final");
    const state = count.transitions ? "transition" : layers.length ? "clips" : "empty";
    if (canvas.dataset.drawn !== state) canvas.dataset.drawn = state;
    // A simulation not caught up yet shows a close frame, and goes on catching up on the next draw.
    setData(canvas, "simulation", this.caughtUp ? "exact" : "catching-up");
    if (!this.caughtUp) this.requestDraw();
  }

  /**
   * Draw one level's layers over the frame being built: a canvas of `size` CSS px (the main
   * canvas, or a nested sequence's group), at `dpr` device px per CSS px.
   */
  private drawLayers(compositor: Compositor, project: Project, layers: Layer[], size: Size, dpr: number): { transitions: number } {
    return atFrameRate(project.settings.fps, () => this.drawLevel(compositor, project, layers, size, dpr));
  }

  private drawLevel(compositor: Compositor, project: Project, layers: Layer[], size: Size, dpr: number): { transitions: number } {
    const pixels = { width: Math.round(size.width * dpr), height: Math.round(size.height * dpr) };
    const options = { canvas: pixels, fps: project.settings.fps, maxSamples: PREVIEW_SAMPLES };
    /** Where a clip is on the canvas at source time `t` (a solid or an adjustment layer fills it at 100%; a 3D layer seen through the camera). */
    const camera = projectCamera(project, size);
    const affineAt = (clip: Clip) =>
      placer(
        clip,
        size,
        (t) => placeOnCanvas(project, clip, this.assetById.get(clip.assetId), size, t).placement,
        camera,
        parentAt(project, clip, size),
      );
    /** What the compositor draws itself (text, a solid, a shape layer) as a layer, at source time `time`. */
    const generated = (clip: Clip, time: number): Placed | null => {
      const layer = clipLayer(clip, time, affineAt(clip), options);
      if (!layer) return null;
      if (clipKind(clip) === "shape") return { ...layer, key: "", vector: shapeDrawingAt(clip, time, outputSize(project.settings.aspectRatio, "1080p")) };
      if (clipKind(clip) === "text") {
        // Laid out here (the tab knows the fonts), drawn by the compositor at the size it's shown.
        const { text } = placeOnCanvas(project, clip, undefined, size, time);
        return text && { ...layer, key: "", text: textDrawing(textStyleAt(clip, time), text, textUnit(size, project.settings.aspectRatio)) };
      }
      return { ...layer, key: "", solid: { color: solidColorAt(clip, time), ...pixels } };
    };
    /**
     * Step a clip's simulations up to the frame it shows, from the newest state the compositor has of them
     * (see `simulationFrom`), for as long as this draw may. What the compositor draws itself is stepped
     * exactly; a video or a nested sequence steps on the picture it shows now (its earlier frames aren't
     * at hand), close to what it was.
     */
    const catchUp = (picture: Picture, own: Placed) => {
      const sims = own.effects?.flatMap((fx) => (fx.simulation ? [fx.simulation] : [])) ?? [];
      if (!sims.length) return;
      const { frame, fps } = sims[0];
      const from = Math.min(...sims.map((sim) => compositor.simulationFrom(sim.id, sim.version, frame, sim.memory)));
      const { clip } = picture.shown;
      for (let k = from; k < frame; k++) {
        if (performance.now() > this.catchUpUntil) {
          this.caughtUp = false;
          return;
        }
        const time = frameSourceTime(clip, k, fps);
        const step = picture.source === null && !picture.nest ? generated(clip, time) : { ...own, effects: effectPasses(clip, time, fps), samples: undefined };
        if (step) compositor.advance(step);
      }
    };
    const placed = (picture: Picture | null): Placed | null => {
      const own = placedNow(picture);
      if (own && picture) catchUp(picture, own);
      return own;
    };
    const placedNow = (picture: Picture | null): Placed | null => {
      if (!picture) return null;
      const { clip, time } = picture.shown;
      if (picture.nest) {
        // The nested sequence first, into a group picture of its own at about the size it's shown.
        const { level, layers: inner, settled } = picture.nest;
        const zoom = Math.min(4, Math.max(1, Math.abs(motionAt(clip, time).scaleY)));
        const groupDpr = Math.min(4096 / Math.max(level.canvas.width, level.canvas.height, 1), dpr * zoom);
        const [w, h] = [Math.round(level.canvas.width * groupDpr), Math.round(level.canvas.height * groupDpr)];
        // A frame that depends only on the sequence and its time (everything in it loaded and in step) is kept;
        // one that reacts to sound also on where it's heard (the same nest placed twice hears two moments).
        const reader = currentSignalReader();
        const heard = level.hearing && reader && usesSignals(reader.document) ? `:${level.hearing.at(level.time).toFixed(4)}` : "";
        const cacheKey = settled
          ? `nest-frame:${this.contentVersion}:${viewKey(level.view)}:${level.time.toFixed(4)}${heard}:${w}x${h}:${level.canvas.width.toFixed(1)}x${level.canvas.height.toFixed(1)}`
          : null;
        let key = picture.key;
        if (cacheKey && compositor.hasPicture(cacheKey) && this.nestFrames.has(cacheKey)) {
          this.nestFrames.delete(cacheKey);
          this.nestFrames.set(cacheKey, w * h * 4);
          key = cacheKey;
        } else {
          compositor.beginGroup(w, h);
          withHearing(level.hearing, () => this.drawLayers(compositor, level.view, inner, level.canvas, groupDpr));
          if (cacheKey) {
            compositor.endGroup(cacheKey);
            this.keepNestFrame(compositor, cacheKey, w * h * 4);
            key = cacheKey;
          } else compositor.endGroup(picture.key);
        }
        const layer = clipLayer(clip, time, affineAt(clip), options);
        return layer && { ...layer, key };
      }
      if (picture.source === null) return generated(clip, time);
      if (!this.upload(compositor, picture)) return null;
      const layer = clipLayer(clip, time, affineAt(clip), options);
      if (!layer) return null;
      // Between the frame before and the newest one, when the moment wanted is.
      const frames = picture.interp && this.frames.get(picture.key);
      const previous = `${picture.key}~`;
      if (picture.interp && frames && frames.time > frames.before && compositor.hasPicture(previous)) {
        const step = frames.time - frames.before;
        const amount = (picture.interp.target - frames.before) / step;
        if (amount > -0.25 && amount < 1.25) {
          const interpolate = { key: picture.key, amount: Math.min(1, Math.max(0, amount)), flow: picture.interp.flow };
          return { ...layer, key: previous, interpolate };
        }
      }
      return { ...layer, key: picture.key };
    };
    let transitions = 0;
    const matteOf = (matte: LayerMatte | undefined) => {
      const picture = matte && placed(matte.picture);
      return matte && picture ? { matte: { mode: matte.mode, layer: picture } } : {};
    };
    // Pictures are placed first, so 3D layers on neighbouring tracks can be drawn far first.
    const resolved = layers.map((layer) => (layer.kind === "picture" ? { ...layer, own: placed(layer.picture) } : layer));
    const ordered = sortByDepth(resolved, (l) => (l.kind === "picture" ? (l.own as { depth?: number } | null)?.depth : undefined));
    for (const layer of ordered) {
      if (layer.kind === "adjustment") {
        const { clip, time } = layer.shown;
        const own = clipLayer(clip, time, affineAt(clip), options);
        if (!own) continue;
        const adjustment = { ...own, ...matteOf(layer.matte) };
        try {
          compositor.drawAdjustment(adjustment);
        } catch (err) {
          console.error("An adjustment layer's effects failed to draw", err);
          compositor.drawAdjustment({ ...adjustment, effects: undefined, samples: undefined });
        }
        continue;
      }
      if (layer.kind === "picture") {
        const { own } = layer;
        if (!own) continue;
        const picture = { ...own, ...matteOf(layer.matte) };
        try {
          compositor.drawPicture(picture);
        } catch (err) {
          // An effect that won't compile: the clip still shows, without its effects.
          console.error("A clip's effects failed to draw", err);
          compositor.drawPicture({ ...picture, effects: undefined, samples: undefined });
        }
        continue;
      }
      transitions++;
      const { def, transition } = layer.plan.window;
      try {
        compositor.drawTransition(
          transitionShader(def),
          transitionUniforms(def, transition.params),
          layer.plan.progress,
          placed(layer.from),
          placed(layer.to),
        );
      } catch (err) {
        console.error(`Transition "${def.label}" failed to draw`, err);
      }
    }
    return { transitions };
  }

  /** Check on the frames in flight once an animation frame (a fence's status only changes between tasks). */
  private watchGpu() {
    if (this.watchQueued) return;
    this.watchQueued = true;
    requestAnimationFrame(() => {
      this.watchQueued = false;
      const gl = this.compositor?.gl;
      if (!gl || gl.isContextLost()) {
        this.inFlight = [];
        return;
      }
      // Frames finish in order.
      while (this.inFlight.length && gl.getSyncParameter(this.inFlight[0].sync, gl.SYNC_STATUS) === gl.SIGNALED) this.finished(gl, this.inFlight.shift()!);
      if (this.inFlight.length) this.watchGpu();
      if (this.waiting && this.inFlight.length < MAX_IN_FLIGHT) {
        this.waiting = false;
        this.update();
      }
    });
  }

  /** A frame the GPU has drawn: what it cost says what level the next moving frames are drawn at. */
  private finished(gl: WebGL2RenderingContext, flight: Flight) {
    // What it cost: the GPU's timer, else the wait since it could start (up to a frame more than the work: about half off).
    const now = performance.now();
    let cost = Math.max(0, now - Math.max(flight.sentAt, this.lastFinished) - 8);
    this.lastFinished = now;
    const { query, level } = flight;
    if (query && this.timer && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(this.timer.GPU_DISJOINT_EXT)) {
      cost = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
    }
    this.forget(flight);
    this.adaptive = nextAdaptiveLevel(this.adaptive, level, cost);
  }

  /** Let go of a frame's fence and timer. */
  private forget({ sync, query }: Flight) {
    const gl = this.compositor?.gl;
    if (!gl || gl.isContextLost()) return;
    gl.deleteSync(sync);
    if (query) gl.deleteQuery(query);
  }

  /** Draw again when the picture has held still for `SETTLE_MS` (in full, see `draw`). */
  private settleLater() {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(
      () => {
        this.settleTimer = null;
        if (performance.now() - this.movedAt < SETTLE_MS) this.settleLater();
        else this.update();
      },
      Math.max(0, this.movedAt + SETTLE_MS - performance.now()) + 1,
    );
  }

  /** Remember a nested sequence's frame, letting go of the least recently shown past the budget. */
  private keepNestFrame(compositor: Compositor, key: string, bytes: number) {
    this.nestFrames.set(key, bytes);
    let total = 0;
    for (const b of this.nestFrames.values()) total += b;
    for (const [old, b] of this.nestFrames) {
      if (total <= NEST_CACHE_BYTES || old === key) break;
      compositor.deletePicture(old);
      this.nestFrames.delete(old);
      total -= b;
    }
  }

  private clearNestFrames() {
    for (const key of this.nestFrames.keys()) this.compositor?.deletePicture(key);
    this.nestFrames.clear();
  }

  /**
   * Make sure the compositor has the picture's current contents: a video's
   * frame is uploaded on every draw, a still only when it changes.
   * False when there's nothing to draw yet (e.g. the media is still loading).
   */
  private upload(compositor: Compositor, { key, source, interp }: Picture): boolean {
    if (!source) return true;
    if (interp && source instanceof HTMLVideoElement) this.keepFrame(compositor, key, source, interp.slot);
    let version: string | null;
    let ready: boolean;
    if (source instanceof HTMLVideoElement) {
      version = null;
      ready = source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && source.videoWidth > 0;
    } else {
      version = source.currentSrc;
      ready = source.complete && source.naturalWidth > 0;
    }
    const src = source.currentSrc;
    if (!ready) {
      // Not ready yet: keep showing its last picture only if it's of the same media.
      const last = this.uploaded.get(key);
      if (last !== undefined && last === `${src}@video`) return compositor.hasPicture(key);
      compositor.deletePicture(key);
      this.uploaded.delete(key);
      return false;
    }
    const tag = version ?? `${src}@video`;
    if (version === null || this.uploaded.get(key) !== tag || !compositor.hasPicture(key)) {
      try {
        compositor.setPicture(key, source);
      } catch (err) {
        console.warn("Couldn't draw a picture", err);
        return false;
      }
      this.uploaded.set(key, tag);
    }
    return true;
  }

  /**
   * A time-interpolated video showed a new frame: keep the one it replaces (under `${key}~`)
   * and remember both frames' media times.
   */
  private keepFrame(compositor: Compositor, key: string, video: HTMLVideoElement, slot: MediaSlot) {
    const last = this.frames.get(key);
    if (last && last.count === slot.presentedFrames && last.src === video.currentSrc) return;
    const same = !!last && last.src === video.currentSrc && compositor.hasPicture(key);
    if (same) compositor.shiftPicture(key, `${key}~`);
    else compositor.deletePicture(`${key}~`);
    const time = Number.isFinite(slot.presentedTime) ? slot.presentedTime : video.currentTime;
    this.frames.set(key, { count: slot.presentedFrames, src: video.currentSrc, time, before: same ? last!.time : Number.NaN });
  }

  /** The transition playing on a track at `time` (windows are cached per shown project, by the track's slot id). */
  private planTransitionOf(project: Project, slotId: string, trackId: string, time: number): TransitionPlan | null {
    let windows = this.windows.get(slotId);
    if (!windows) {
      windows = trackTransitions(project, trackId);
      this.windows.set(slotId, windows);
    }
    if (windows.length === 0) return null;
    return planTransition(project, windows, time, (clip) => clipSourceRange(clip, this.assetById.get(clip.assetId)));
  }

  private indexAssets(assets: MediaAsset[]) {
    if (assets === this.indexedAssets) return;
    this.indexedAssets = assets;
    this.contentVersion++;
    this.clearNestFrames();
    this.assetById = new Map(assets.map((a) => [a.id, a]));
  }

  /** The clip's playable URL, or null when its asset is missing. */
  private srcOf(clip: Clip): string | null {
    return this.assetById.get(clip.assetId)?.src ?? null;
  }

  /**
   * What a video or sound clip's element plays: its media, or, played
   * backwards, the media's reversed copy (a media element only plays
   * forwards), and where source time `s` is in it. Until the reversed copy is
   * made, the media itself is shown frame by frame (seeking, silent):
   * `plays` is false.
   */
  private mediaOf(clip: Clip): { src: string | null; plays: boolean; at: (s: number) => number; rate: (s: number) => number | null } {
    const asset = this.assetById.get(clip.assetId);
    const speed = () => clipSpeed(clip);
    if (isRemapped(clip)) {
      // The remap curve says where to be; the element plays at its slope, which it can only do
      // forwards and not too slowly or fast: elsewhere (a freeze, backwards) it's shown frame by frame.
      const rate = (s: number) => {
        const v = remapSpeed(clip, s);
        return v >= MIN_PLAYBACK_RATE && v <= MAX_PLAYBACK_RATE ? v : null;
      };
      return { src: asset?.src ?? null, plays: true, at: (s) => mediaTime(clip, s), rate };
    }
    if (!clip.reversed || !asset) return { src: asset?.src ?? null, plays: true, at: (s) => s, rate: speed };
    const reversed = asset.reversed?.status === "ready" ? asset.reversed.src : null;
    if (!reversed) return { src: asset.src, plays: false, at: (s) => s, rate: speed };
    return { src: reversed, plays: true, at: (s) => fileTime(clip, s, asset.duration), rate: speed };
  }
}

/** The slowest and fastest a media element plays smoothly (browsers mute outside about this range). */
const MIN_PLAYBACK_RATE = 0.0625;
const MAX_PLAYBACK_RATE = 16;

const withId = (ids: SlotIds, index: 0 | 1, id: string | null): SlotIds =>
  index === 0 ? [id, ids[1]] : [ids[0], id];

/** Set a data attribute only when it changes. */
function setData(el: HTMLElement, key: string, value: string) {
  if (el.dataset[key] !== value) el.dataset[key] = value;
}

/** Mark the media element that's on screen (for debugging and tests; the elements themselves are hidden). */
function setShown(el: HTMLElement, shown: boolean) {
  if (shown !== el.hasAttribute("data-shown")) el.toggleAttribute("data-shown", shown);
}
