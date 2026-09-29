import type { Clip, MediaAsset, Project } from "@shared/types";
import { type TextStyle, isTextClip, opacityAt, textStyleAt, volumeAt } from "@shared/effects";
import { TEXT_SOURCE_RANGE, clipEnd, sourceRange } from "@shared/timeline";
import { type TransitionRenderer, createTransitionRenderer, transitionShader, transitionUniforms } from "@shared/transition-gl";
import { type TransitionWindow, trackTransitions } from "@shared/transition-windows";
import { type Placement, type Size, cssMatrix, placementAffine } from "@shared/transform";
import { drawText, drawingScale, type TextLayout } from "@/lib/text-render";
import { useEditor } from "@/stores/editor";
import { useFonts } from "@/stores/fonts";
import { usePlayback } from "@/stores/playback";
import { ImageSlot, MediaSlot } from "./media-slot";
import { placeOnCanvas, textUnit } from "./placement";
import { type Shown, type TransitionPlan, assignSlots, planAudio, planTrack, planTransition, type SlotIds } from "./sync";

/**
 * The elements that show one video track: an A/B pair for video clips, one
 * for still images and a canvas for text, plus a WebGL canvas that draws the
 * track while a transition plays.
 */
interface VideoLayer {
  videos: [MediaSlot | null, MediaSlot | null];
  videoIds: SlotIds;
  images: [ImageSlot | null, ImageSlot | null];
  imageIds: SlotIds;
  text: TextSlot | null;
  /** Offscreen text drawings for the sides of a transition (created on first use). */
  transitionTexts: [TextSlot | null, TextSlot | null];
  canvas: HTMLCanvasElement | null;
  /** Created on the first transition (null until then, or when WebGL 2 isn't available). */
  renderer: TransitionRenderer | null;
  rendererFailed: boolean;
}

type ClipKind = "video" | "image" | "text";

/**
 * Drives the preview's media elements from the playback clock and the project,
 * outside React: it subscribes to both stores and reconciles every element on
 * each change (every animation frame while playing).
 *
 * - Each video track has two <video> elements that double-buffer it: one shows
 *   the clip under the playhead, the other is parked on the next clip's first
 *   frame. Two <img> elements do the same for still images, and a <canvas>
 *   draws text clips (redrawn only when the text or its size changes). The
 *   stage stacks the tracks' elements in layer order.
 * - The visible element is sized and transformed to where the clip's Motion
 *   puts it on the canvas (`shared/transform.ts`, same as the export), and
 *   faded by its Opacity. Values are read at the current time, so they'll
 *   follow keyframes.
 * - While a transition plays, both of its clips play (past their edges into
 *   their media's handles if need be, silent outside the clip itself), their
 *   elements are hidden (a text side is drawn off screen instead), and the
 *   track's WebGL canvas draws them mixed by the transition's shader
 *   (`shared/transition-gl.ts`, same as the export).
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
    // Knowing the installed fonts can change which style a text is drawn in.
    const offFonts = useFonts.subscribe(this.update);
    this.unsubscribe = () => {
      offPlayback();
      offEditor();
      offFonts();
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

  attachText(trackId: string, el: HTMLCanvasElement) {
    const slot = new TextSlot(el);
    const layer = this.layer(trackId);
    layer.text = slot;
    this.update();
    return () => {
      if (layer.text !== slot) return;
      layer.text = null;
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
        text: null,
        transitionTexts: [null, null],
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
    if ([...layer.videos, ...layer.images, layer.text, layer.canvas].some(Boolean)) return;
    if (this.layers.get(trackId) === layer) this.layers.delete(trackId);
  }

  private update = () => {
    if (!this.unsubscribe) return;
    const { project, assets } = useEditor.getState();
    const { time, playing } = usePlayback.getState();
    this.indexAssets(assets);
    const trackMuted = new Map(project.tracks.map((t) => [t.id, t.muted]));
    const kindOf = (clip: Clip): ClipKind =>
      isTextClip(clip) ? "text" : this.assetById.get(clip.assetId)?.kind === "image" ? "image" : "video";
    let offline = false;

    // Video tracks: an A/B pair of elements for video clips, another for stills, a canvas for text.
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
      const ids = (want: ClipKind) => {
        const on = shown.filter((s) => kindOf(s.clip) === want).map((s) => s.clip.id);
        const upcoming = next && kindOf(next) === want && !shown.some((s) => s.clip.id === next.id) ? next.id : null;
        return [on[0] ?? null, on[1] ?? upcoming] as const;
      };
      layer.videoIds = assignSlots(layer.videoIds, ...ids("video"));
      layer.imageIds = assignSlots(layer.imageIds, ...ids("image"));
      const sources = new Map<string, TexImageSource>();

      if (layer.text) {
        if (current && !transition && kindOf(current.clip) === "text") {
          const { placement, text } = placeOnCanvas(project, current.clip, undefined, this.canvas, current.time);
          const unit = textUnit(this.canvas, project.settings.aspectRatio);
          layer.text.draw(textStyleAt(current.clip, current.time), text!, unit, placement);
          this.place(layer.text.el, current.clip, current.time, placement);
        } else {
          setStyle(layer.text.el, "opacity", "0");
        }
      }
      // A text side of a transition is drawn off screen for the transition's canvas.
      if (transition) {
        ([transition.from, transition.to] as const).forEach((side, i) => {
          if (!side || kindOf(side.clip) !== "text") return;
          const slot = (layer.transitionTexts[i] ??= new TextSlot(document.createElement("canvas")));
          const { placement, text } = placeOnCanvas(project, side.clip, undefined, this.canvas, side.time);
          slot.draw(textStyleAt(side.clip, side.time), text!, textUnit(this.canvas, project.settings.aspectRatio), placement);
          sources.set(side.clip.id, slot.el);
        });
      }

      layer.videos.forEach((slot, i) => {
        if (!slot) return;
        const id = layer.videoIds[i];
        const el = slot.el as HTMLVideoElement;
        const on = shown.find((s) => s.clip.id === id && kindOf(s.clip) === "video");
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
            this.place(el, on.clip, on.time, this.placementOf(on.clip, on.time));
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
        const on = shown.find((s) => s.clip.id === id && kindOf(s.clip) === "image");
        if (on) {
          const src = this.srcOf(on.clip);
          slot.setSrc(src);
          if (transition) {
            setStyle(slot.el, "opacity", "0");
            sources.set(on.clip.id, slot.el);
          } else {
            this.place(slot.el, on.clip, on.time, this.placementOf(on.clip, on.time));
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
      if (isTextClip(clip)) return TEXT_SOURCE_RANGE;
      const asset = this.assetById.get(clip.assetId);
      return asset ? sourceRange(asset) : { min: clip.in, max: clip.out };
    });
  }

  /** Draw a track's transition on its canvas (or hide the canvas when there's none). */
  private drawTransition(
    layer: VideoLayer,
    plan: TransitionPlan | null,
    sources: Map<string, TexImageSource>,
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
      const placement = this.placementOf(side.clip, side.time);
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

  private placementOf(clip: Clip, t: number): Placement {
    const { project } = useEditor.getState();
    return placeOnCanvas(project, clip, this.assetById.get(clip.assetId), this.canvas, t).placement;
  }

  /** Size and transform the element to where the clip is at source time `t`, and show it. */
  private place(el: HTMLElement, clip: Clip, t: number, p: Placement) {
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

/** The <canvas> showing a track's text clip, redrawn only when what it shows changes. */
class TextSlot {
  private drawn = "";

  constructor(readonly el: HTMLCanvasElement) {}

  draw(style: TextStyle, layout: TextLayout, unit: number, placement: Placement) {
    // Sharp on this screen at the clip's current scale.
    const zoom = Math.max(Math.abs(placement.scaleX), Math.abs(placement.scaleY), 0.05);
    const scale = drawingScale(layout, (window.devicePixelRatio || 1) * zoom);
    const width = Math.max(1, Math.ceil(layout.width * scale));
    const height = Math.max(1, Math.ceil(layout.height * scale));
    const key = JSON.stringify([style, layout.font, layout.stretch, unit, width, height]);
    if (key === this.drawn) return;
    this.drawn = key;
    if (this.el.width !== width) this.el.width = width;
    if (this.el.height !== height) this.el.height = height;
    const ctx = this.el.getContext("2d");
    if (ctx) drawText(ctx, style, layout, unit, scale);
  }
}

const withId = (ids: SlotIds, index: 0 | 1, id: string | null): SlotIds =>
  index === 0 ? [id, ids[1]] : [ids[0], id];

/** Whether an element has a picture to draw. */
function isReady(el: TexImageSource): boolean {
  if (el instanceof HTMLVideoElement) return el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && el.videoWidth > 0;
  if (el instanceof HTMLImageElement) return el.complete && el.naturalWidth > 0;
  return true;
}

function setStyle(el: HTMLElement, prop: "opacity" | "width" | "height" | "transform", value: string) {
  if (el.style[prop] !== value) el.style[prop] = value;
}
