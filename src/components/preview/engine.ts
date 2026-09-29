import type { Clip, MediaAsset, Project } from "@shared/types";
import { motionAt, opacityAt, volumeAt } from "@shared/effects";
import { clipEnd, sourceRange } from "@shared/timeline";
import { type TransitionRenderer, createTransitionRenderer, transitionShader, transitionUniforms } from "@shared/transition-gl";
import { type TransitionWindow, trackTransitions } from "@shared/transition-windows";
import { type Size, cssMatrix, placeClip, placementAffine } from "@shared/transform";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { ImageSlot, MediaSlot } from "./media-slot";
import { type Shown, type TransitionPlan, assignSlots, planAudio, planTrack, planTransition, type SlotIds } from "./sync";

/**
 * The elements that play one video track: an A/B pair for video clips and one
 * for still images, plus a WebGL canvas that draws the track while a
 * transition plays.
 */
interface VideoLayer {
  videos: [MediaSlot | null, MediaSlot | null];
  videoIds: SlotIds;
  images: [ImageSlot | null, ImageSlot | null];
  imageIds: SlotIds;
  canvas: HTMLCanvasElement | null;
  /** Created on the first transition (null until then, or when WebGL 2 isn't available). */
  renderer: TransitionRenderer | null;
  rendererFailed: boolean;
}

/**
 * Drives the preview's media elements from the playback clock and the project,
 * outside React: it subscribes to both stores and reconciles every element on
 * each change (every animation frame while playing).
 *
 * - Each video track has two <video> elements that double-buffer it: one shows
 *   the clip under the playhead, the other is parked on the next clip's first
 *   frame. Two <img> elements do the same for still images. The stage stacks
 *   the tracks' elements in layer order.
 * - The visible element is sized and transformed to where the clip's Motion
 *   puts it on the canvas (`shared/transform.ts`, same as the export), and
 *   faded by its Opacity. Values are read at the current time, so they'll
 *   follow keyframes.
 * - While a transition plays, both of its clips play (past their edges into
 *   their media's handles if need be, silent outside the clip itself), their
 *   elements are hidden, and the track's canvas draws them mixed by the
 *   transition's shader (`shared/transition-gl.ts`, same as the export).
 * - Each audio-track clip has its own <audio> element, played only while the
 *   playhead is inside the clip and parked on its in-point before that.
 */
export class PreviewEngine {
  private layers = new Map<string, VideoLayer>();
  private audio = new Map<string, MediaSlot>();
  private unsubscribe: (() => void) | null = null;
  private offline = false;
  private indexedAssets: MediaAsset[] | null = null;
  private assetById = new Map<string, MediaAsset>();
  private canvas: Size = { width: 0, height: 0 };
  /** Transition windows per track, for `windowsOf`. */
  private windows = new Map<string, TransitionWindow[]>();
  private windowsOf: Project | null = null;

  constructor(private readonly onOfflineChange: (offline: boolean) => void) {}

  start() {
    if (this.unsubscribe) return;
    const offPlayback = usePlayback.subscribe(this.update);
    const offEditor = useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.assets !== prev.assets) this.update();
    });
    this.unsubscribe = () => {
      offPlayback();
      offEditor();
    };
    this.update();
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const layer of this.layers.values()) for (const slot of layer.videos) slot?.pause();
    for (const slot of this.audio.values()) slot.pause();
  }

  /** The canvas size in CSS px (elements are placed in it). */
  setCanvasSize(size: Size) {
    if (size.width === this.canvas.width && size.height === this.canvas.height) return;
    this.canvas = size;
    this.update();
  }

  /** Ref-callback helper: returns the cleanup that releases the element. */
  attachVideo(trackId: string, index: 0 | 1, el: HTMLVideoElement) {
    const slot = new MediaSlot(el, this.update);
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

  attachAudio(clipId: string, el: HTMLAudioElement) {
    const slot = new MediaSlot(el, this.update);
    this.audio.set(clipId, slot);
    this.update();
    return () => {
      slot.dispose();
      if (this.audio.get(clipId) === slot) this.audio.delete(clipId);
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
        canvas: null,
        renderer: null,
        rendererFailed: false,
      };
      this.layers.set(trackId, layer);
    }
    return layer;
  }

  attachCanvas(trackId: string, el: HTMLCanvasElement) {
    const layer = this.layer(trackId);
    layer.canvas = el;
    layer.renderer = null;
    layer.rendererFailed = false;
    this.update();
    return () => {
      if (layer.canvas !== el) return;
      layer.renderer?.dispose();
      layer.canvas = null;
      layer.renderer = null;
      this.dropIfEmpty(trackId, layer);
    };
  }

  private dropIfEmpty(trackId: string, layer: VideoLayer) {
    if ([...layer.videos, ...layer.images, layer.canvas].some(Boolean)) return;
    if (this.layers.get(trackId) === layer) this.layers.delete(trackId);
  }

  private update = () => {
    if (!this.unsubscribe) return;
    const { project, assets } = useEditor.getState();
    const { time, playing } = usePlayback.getState();
    this.indexAssets(assets);
    const trackMuted = new Map(project.tracks.map((t) => [t.id, t.muted]));
    const isStill = (clip: Clip | null | undefined) => this.assetById.get(clip?.assetId ?? "")?.kind === "image";
    let offline = false;

    // Video tracks: an A/B pair of elements for video clips, another for stills.
    for (const [trackId, layer] of this.layers) {
      const muted = trackMuted.get(trackId) ?? false;
      const { current, next } = planTrack(project, trackId, time);
      const transition = this.planTransition(project, trackId, time);
      // What's on screen: both sides of a transition, or the clip under the playhead.
      const shown: Shown[] = transition
        ? [transition.from, transition.to].filter((s): s is Shown => !!s)
        : current
          ? [current]
          : [];
      const ids = (wantStill: boolean) => {
        const on = shown.filter((s) => isStill(s.clip) === wantStill).map((s) => s.clip.id);
        const upcoming = next && isStill(next) === wantStill && !shown.some((s) => s.clip.id === next.id) ? next.id : null;
        return [on[0] ?? null, on[1] ?? upcoming] as const;
      };
      layer.videoIds = assignSlots(layer.videoIds, ...ids(false));
      layer.imageIds = assignSlots(layer.imageIds, ...ids(true));
      const sources = new Map<string, HTMLVideoElement | HTMLImageElement>();

      layer.videos.forEach((slot, i) => {
        if (!slot) return;
        const id = layer.videoIds[i];
        const el = slot.el as HTMLVideoElement;
        const on = shown.find((s) => s.clip.id === id && !isStill(s.clip));
        if (on) {
          const src = this.srcOf(on.clip);
          slot.setSrc(src);
          // A transition may show a clip past its edges; it's only heard inside them.
          const audible = time >= on.clip.start - 1e-6 && time < clipEnd(on.clip) - 1e-6;
          slot.setAudio(volumeAt(on.clip, on.time), muted || (!!transition && !audible));
          if (playing) slot.follow(on.time);
          else slot.hold(on.time);
          if (transition) {
            setStyle(el, "opacity", "0");
            sources.set(on.clip.id, el);
          } else {
            this.place(el, on.clip, on.time);
          }
          offline ||= src === null || slot.failed;
          return;
        }
        setStyle(el, "opacity", "0");
        slot.setAudio(1, true);
        if (next && id === next.id) {
          slot.setSrc(this.srcOf(next));
          slot.hold(next.in);
        } else {
          slot.pause();
        }
      });

      layer.images.forEach((slot, i) => {
        if (!slot) return;
        const id = layer.imageIds[i];
        const on = shown.find((s) => s.clip.id === id && isStill(s.clip));
        if (on) {
          const src = this.srcOf(on.clip);
          slot.setSrc(src);
          if (transition) {
            setStyle(slot.el, "opacity", "0");
            sources.set(on.clip.id, slot.el);
          } else {
            this.place(slot.el, on.clip, on.time);
          }
          offline ||= src === null || slot.failed;
          return;
        }
        setStyle(slot.el, "opacity", "0");
        // Loading the next still ahead of time makes the cut instant.
        if (next && id === next.id) slot.setSrc(this.srcOf(next));
      });

      this.drawTransition(layer, transition, sources);
    }

    // Audio tracks: one element per clip.
    const planned = new Set<string>();
    for (const { clip, active, time: target } of planAudio(project, time)) {
      const slot = this.audio.get(clip.id);
      if (!slot) continue;
      planned.add(clip.id);
      const src = this.srcOf(clip);
      slot.setSrc(src);
      slot.setAudio(volumeAt(clip, target ?? clip.in), trackMuted.get(clip.trackId) ?? false);
      if (target === null) slot.pause();
      else if (active && playing) slot.follow(target);
      else slot.hold(target);
      if (active) offline ||= src === null || slot.failed;
    }
    // Elements whose clip was just deleted (React unmounts them right after).
    for (const [id, slot] of this.audio) if (!planned.has(id)) slot.pause();

    if (offline !== this.offline) {
      this.offline = offline;
      this.onOfflineChange(offline);
    }
  };

  /** The transition playing on a track at `time` (windows are cached per project). */
  private planTransition(project: Project, trackId: string, time: number): TransitionPlan | null {
    if (project !== this.windowsOf) {
      this.windowsOf = project;
      this.windows.clear();
    }
    let windows = this.windows.get(trackId);
    if (!windows) {
      windows = trackTransitions(project, trackId);
      this.windows.set(trackId, windows);
    }
    if (windows.length === 0) return null;
    return planTransition(project, windows, time, (clip) => {
      const asset = this.assetById.get(clip.assetId);
      return asset ? sourceRange(asset) : { min: clip.in, max: clip.out };
    });
  }

  /** Draw a track's transition on its canvas (or hide the canvas when there's none). */
  private drawTransition(
    layer: VideoLayer,
    plan: TransitionPlan | null,
    sources: Map<string, HTMLVideoElement | HTMLImageElement>,
  ) {
    const canvas = layer.canvas;
    if (!canvas) return;
    const renderer = plan && this.rendererOf(layer);
    if (!plan || !renderer || this.canvas.width <= 0) {
      setStyle(canvas, "opacity", "0");
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.resize(this.canvas.width * dpr, this.canvas.height * dpr);
    setStyle(canvas, "width", `${this.canvas.width}px`);
    setStyle(canvas, "height", `${this.canvas.height}px`);
    ([plan.from, plan.to] as const).forEach((side, i) => {
      const el = side && sources.get(side.clip.id);
      if (!side || !el || !isReady(el)) {
        renderer.layer(i as 0 | 1, null);
        return;
      }
      const asset = this.assetById.get(side.clip.assetId);
      const media = asset?.width && asset.height ? { width: asset.width, height: asset.height } : this.canvas;
      const placement = placeClip(this.canvas, media, motionAt(side.clip, side.time));
      renderer.layer(i as 0 | 1, el, placementAffine(placement, this.canvas), opacityAt(side.clip, side.time));
    });
    const { def, transition } = plan.window;
    try {
      renderer.draw(transitionShader(def), transitionUniforms(def, transition.params), plan.progress);
    } catch (err) {
      console.error(`Transition "${def.label}" failed to draw`, err);
    }
    setStyle(canvas, "opacity", "1");
  }

  private rendererOf(layer: VideoLayer): TransitionRenderer | null {
    if (layer.renderer || layer.rendererFailed || !layer.canvas) return layer.renderer;
    const gl = layer.canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) {
      layer.rendererFailed = true;
      console.warn("WebGL 2 isn't available, so transitions can't be previewed.");
      return null;
    }
    layer.renderer = createTransitionRenderer(gl);
    return layer.renderer;
  }

  /** Size and transform the element to where the clip is at source time `t`, and show it. */
  private place(el: HTMLElement, clip: Clip, t: number) {
    const asset = this.assetById.get(clip.assetId);
    const media = asset?.width && asset.height ? { width: asset.width, height: asset.height } : this.canvas;
    const p = placeClip(this.canvas, media, motionAt(clip, t));
    setStyle(el, "width", `${p.width}px`);
    setStyle(el, "height", `${p.height}px`);
    setStyle(el, "transform", cssMatrix(p));
    setStyle(el, "opacity", String(opacityAt(clip, t)));
  }

  private indexAssets(assets: MediaAsset[]) {
    if (assets === this.indexedAssets) return;
    this.indexedAssets = assets;
    this.assetById = new Map(assets.map((a) => [a.id, a]));
  }

  /** The clip's playable URL, or null when its asset is missing. */
  private srcOf(clip: Clip): string | null {
    return this.assetById.get(clip.assetId)?.src ?? null;
  }
}

const withId = (ids: SlotIds, index: 0 | 1, id: string | null): SlotIds =>
  index === 0 ? [id, ids[1]] : [ids[0], id];

/** Whether an element has a picture to draw. */
function isReady(el: HTMLVideoElement | HTMLImageElement): boolean {
  return el instanceof HTMLVideoElement
    ? el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && el.videoWidth > 0
    : el.complete && el.naturalWidth > 0;
}

function setStyle(el: HTMLElement, prop: "opacity" | "width" | "height" | "transform", value: string) {
  if (el.style[prop] !== value) el.style[prop] = value;
}
