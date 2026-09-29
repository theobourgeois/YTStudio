import type { Clip, MediaAsset, Project } from "@shared/types";
import { type TextStyle, isTextClip, opacityAt, textStyleAt, volumeAt } from "@shared/effects";
import { type Compositor, type Placed, createCompositor } from "@shared/compositor";
import { effectPasses } from "@shared/effect-gl";
import { type Shown, type TransitionPlan, planTrack, planTransition } from "@shared/scene";
import { clipEnd, clipSourceRange, clipSpeed, fileTime, sourceTime, videoTracks } from "@shared/timeline";
import { transitionShader, transitionUniforms } from "@shared/transition-gl";
import { type TransitionWindow, trackTransitions } from "@shared/transition-windows";
import { type Placement, type Size, placementAffine } from "@shared/transform";
import { type TextLayout, rasterizeText, textUnit } from "@/lib/text-render";
import { useEditor } from "@/stores/editor";
import { useFonts } from "@/stores/fonts";
import { usePlayback } from "@/stores/playback";
import { ImageSlot, MediaSlot } from "./media-slot";
import { placeOnCanvas } from "./placement";
import { type SlotIds, assignSlots } from "./sync";

/**
 * The hidden elements that decode one video track's pictures: an A/B pair
 * for video clips, one for still images, and offscreen canvases for text
 * (one per side of a transition).
 */
interface VideoLayer {
  videos: [MediaSlot | null, MediaSlot | null];
  videoIds: SlotIds;
  images: [ImageSlot | null, ImageSlot | null];
  imageIds: SlotIds;
  texts: [TextSlot | null, TextSlot | null];
}

/** The hidden pair of elements that play one audio track (see `VideoLayer`). */
interface AudioLayer {
  slots: [MediaSlot | null, MediaSlot | null];
  ids: SlotIds;
}

type ClipKind = "video" | "image" | "text";

/** A picture to draw: the element (or text drawing) it comes from, and when in its clip. */
interface Picture {
  key: string;
  source: HTMLVideoElement | HTMLImageElement | TextSlot;
  shown: Shown;
}

/** What one track draws, bottom track first. */
type Layer = { kind: "picture"; picture: Picture } | { kind: "transition"; plan: TransitionPlan; from: Picture | null; to: Picture | null };

/**
 * Drives the preview outside React: it subscribes to the playback clock and
 * the project, keeps the media elements playing (or parked) in step, and
 * draws every frame with the compositor (`shared/compositor.ts`) on one
 * WebGL canvas, the same way the export does.
 *
 * - Each video track has two <video> elements that double-buffer it: one shows
 *   the clip under the playhead, the other is parked on the next clip's first
 *   frame. Two <img> elements do the same for still images, and text is drawn
 *   into offscreen canvases (redrawn only when the text or its size changes).
 *   The elements are hidden: they're only the compositor's sources.
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
  /** What each stored picture was made from (to know when it has to be uploaded again). */
  private uploaded = new Map<string, string>();
  private drawQueued = false;

  constructor(
    private readonly onStatusChange: (status: { offline: boolean; noWebGl: boolean }) => void,
  ) {}

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
    for (const layer of this.audio.values()) for (const slot of layer.slots) slot?.pause();
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
    if (!gl) console.warn("WebGL 2 isn't available, so the preview can't be drawn.");
    this.uploaded.clear();
    this.reportStatus();
  }

  private releaseCompositor(dispose: boolean) {
    if (dispose && !this.compositor?.gl.isContextLost()) this.compositor?.dispose();
    this.compositor = null;
    this.uploaded.clear();
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
        texts: [null, null],
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
    if (this.drawQueued || usePlayback.getState().playing) return; // playing: every tick draws anyway
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.update();
    });
  };

  private update = () => {
    if (!this.unsubscribe) return;
    const { project, assets } = useEditor.getState();
    const { time, playing } = usePlayback.getState();
    this.indexAssets(assets);
    const trackMuted = new Map(project.tracks.map((t) => [t.id, t.muted]));
    const kindOf = (clip: Clip): ClipKind =>
      isTextClip(clip) ? "text" : this.assetById.get(clip.assetId)?.kind === "image" ? "image" : "video";
    let offline = false;
    const drawn: Layer[] = [];

    // Video tracks, bottom first: an A/B pair of elements for video clips, another for stills, canvases for text.
    for (const track of [...videoTracks(project)].reverse()) {
      const trackId = track.id;
      const layer = this.layers.get(trackId);
      if (!layer) continue;
      const muted = trackMuted.get(trackId) ?? false;
      const { current, next } = planTrack(project, trackId, time);
      const transition = this.planTransitionOf(project, trackId, time);
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
      /** The picture showing each clip on screen, by clip id. */
      const pictures = new Map<string, Picture>();

      shown.forEach((side, i) => {
        if (kindOf(side.clip) !== "text") return;
        const slot = (layer.texts[i] ??= new TextSlot(document.createElement("canvas")));
        const { placement, text } = placeOnCanvas(project, side.clip, undefined, this.size, side.time);
        slot.draw(textStyleAt(side.clip, side.time), text!, textUnit(this.size, project.settings.aspectRatio), placement);
        pictures.set(side.clip.id, { key: `${trackId}:t${i}`, source: slot, shown: side });
      });

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
          slot.setAudio(volumeAt(on.clip, on.time), muted || (!!transition && !audible) || !media.plays, on.clip.keepPitch !== false);
          if (playing && media.plays) slot.follow(media.at(on.time), clipSpeed(on.clip));
          else slot.hold(media.at(on.time));
          pictures.set(on.clip.id, { key: `${trackId}:v${i}`, source: el, shown: on });
          offline ||= media.src === null || slot.failed;
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
          pictures.set(on.clip.id, { key: `${trackId}:i${i}`, source: slot.el, shown: on });
          offline ||= src === null || slot.failed;
          return;
        }
        // Loading the next still ahead of time makes the cut instant.
        if (next && id === next.id) slot.setSrc(this.srcOf(next));
      });

      const pictureOf = (side: Shown | null) => (side && pictures.get(side.clip.id)) ?? null;
      if (transition) drawn.push({ kind: "transition", plan: transition, from: pictureOf(transition.from), to: pictureOf(transition.to) });
      else if (current && pictures.has(current.clip.id)) drawn.push({ kind: "picture", picture: pictures.get(current.clip.id)! });
    }

    this.draw(project, drawn);

    // Audio tracks: the pair plays the clip under the playhead and parks the next one on its in-point.
    for (const track of project.tracks) {
      const layer = track.kind === "audio" ? this.audio.get(track.id) : undefined;
      if (!layer) continue;
      const { current, next } = planTrack(project, track.id, time);
      layer.ids = assignSlots(layer.ids, current?.clip.id ?? null, next?.id ?? null);
      layer.slots.forEach((slot, i) => {
        if (!slot) return;
        const id = layer.ids[i];
        if (current && id === current.clip.id) {
          const media = this.mediaOf(current.clip);
          slot.setSrc(media.src);
          slot.setAudio(volumeAt(current.clip, current.time), track.muted || !media.plays, current.clip.keepPitch !== false);
          if (playing && media.plays) slot.follow(media.at(current.time), clipSpeed(current.clip));
          else slot.hold(media.at(current.time));
          offline ||= media.src === null || slot.failed;
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

    if (offline !== this.offline) {
      this.offline = offline;
      this.reportStatus();
    }
  };

  private reportStatus() {
    this.onStatusChange({ offline: this.offline, noWebGl: !!this.canvas && !this.compositor });
  }

  /** Composite the tracks' layers onto the canvas. */
  private draw(project: Project, layers: Layer[]) {
    const compositor = this.compositor;
    const canvas = this.canvas;
    if (!compositor || !canvas || !(this.size.width > 0 && this.size.height > 0)) return;
    if (compositor.gl.isContextLost()) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    compositor.resize(this.size.width * dpr, this.size.height * dpr);
    const placed = (picture: Picture | null): Placed | null => {
      if (!picture || !this.upload(compositor, picture)) return null;
      const { clip, time } = picture.shown;
      const placement = placeOnCanvas(project, clip, this.assetById.get(clip.assetId), this.size, time).placement;
      const effects = effectPasses(clip, time);
      return {
        key: picture.key,
        affine: placementAffine(placement, this.size),
        opacity: opacityAt(clip, time),
        ...(effects.length && { effects }),
      };
    };
    compositor.clear();
    let transitions = 0;
    for (const layer of layers) {
      if (layer.kind === "picture") {
        const picture = placed(layer.picture);
        if (!picture) continue;
        try {
          compositor.drawPicture(picture);
        } catch (err) {
          // An effect that won't compile: the clip still shows, without its effects.
          console.error("A clip's effects failed to draw", err);
          compositor.drawPicture({ ...picture, effects: undefined });
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
    compositor.present();
    const state = transitions ? "transition" : layers.length ? "clips" : "empty";
    if (canvas.dataset.drawn !== state) canvas.dataset.drawn = state;
  }

  /**
   * Make sure the compositor has the picture's current contents: a video's
   * frame is uploaded on every draw, a still or a text only when it changes.
   * False when there's nothing to draw yet (e.g. the media is still loading).
   */
  private upload(compositor: Compositor, { key, source }: Picture): boolean {
    let version: string | null;
    let ready: boolean;
    if (source instanceof TextSlot) {
      version = source.drawn;
      ready = !!version;
    } else if (source instanceof HTMLVideoElement) {
      version = null;
      ready = source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && source.videoWidth > 0;
    } else {
      version = source.currentSrc;
      ready = source.complete && source.naturalWidth > 0;
    }
    const src = source instanceof TextSlot ? null : source.currentSrc;
    if (!ready) {
      // Not ready yet: keep showing its last picture only if it's of the same media.
      const last = this.uploaded.get(key);
      if (last !== undefined && src !== null && last === `${src}@video`) return compositor.hasPicture(key);
      compositor.deletePicture(key);
      this.uploaded.delete(key);
      return false;
    }
    const tag = version ?? `${src}@video`;
    if (version === null || this.uploaded.get(key) !== tag || !compositor.hasPicture(key)) {
      try {
        compositor.setPicture(key, source instanceof TextSlot ? source.el : source);
      } catch (err) {
        console.warn("Couldn't draw a picture", err);
        return false;
      }
      this.uploaded.set(key, tag);
    }
    return true;
  }

  /** The transition playing on a track at `time` (windows are cached per project). */
  private planTransitionOf(project: Project, trackId: string, time: number): TransitionPlan | null {
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
    return planTransition(project, windows, time, (clip) => clipSourceRange(clip, this.assetById.get(clip.assetId)));
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

  /**
   * What a video or sound clip's element plays: its media, or, played
   * backwards, the media's reversed copy (a media element only plays
   * forwards), and where source time `s` is in it. Until the reversed copy is
   * made, the media itself is shown frame by frame (seeking, silent):
   * `plays` is false.
   */
  private mediaOf(clip: Clip): { src: string | null; plays: boolean; at: (s: number) => number } {
    const asset = this.assetById.get(clip.assetId);
    if (!clip.reversed || !asset) return { src: asset?.src ?? null, plays: true, at: (s) => s };
    const reversed = asset.reversed?.status === "ready" ? asset.reversed.src : null;
    if (!reversed) return { src: asset.src, plays: false, at: (s) => s };
    return { src: reversed, plays: true, at: (s) => fileTime(clip, s, asset.duration) };
  }
}

/** An offscreen canvas with a text clip drawn on it, redrawn only when what it shows changes. */
class TextSlot {
  /** What's drawn (changes whenever the drawing does); "" until drawn. */
  drawn = "";

  constructor(readonly el: HTMLCanvasElement) {}

  draw(style: TextStyle, layout: TextLayout, unit: number, placement: Placement) {
    // Sharp on this screen at the clip's current scale.
    const zoom = Math.max(Math.abs(placement.scaleX), Math.abs(placement.scaleY), 0.05);
    try {
      this.drawn = rasterizeText(this.el, style, layout, unit, (window.devicePixelRatio || 1) * zoom, this.drawn).key;
    } catch {
      // No 2D context (e.g. too many canvases); the text just doesn't show.
      this.drawn = "";
    }
  }
}

const withId = (ids: SlotIds, index: 0 | 1, id: string | null): SlotIds =>
  index === 0 ? [id, ids[1]] : [ids[0], id];

/** Mark the media element that's on screen (for debugging and tests; the elements themselves are hidden). */
function setShown(el: HTMLElement, shown: boolean) {
  if (shown !== el.hasAttribute("data-shown")) el.toggleAttribute("data-shown", shown);
}
