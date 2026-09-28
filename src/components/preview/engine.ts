import type { Clip, MediaAsset } from "@shared/types";
import { useEditor } from "@/stores/editor";
import { usePlayback } from "@/stores/playback";
import { MediaSlot } from "./media-slot";
import { assignSlots, planAudio, planMain, type SlotIds } from "./sync";

/**
 * Drives the preview's media elements from the playback clock and the project,
 * outside React: it subscribes to both stores and reconciles every element on
 * each change (every animation frame while playing).
 *
 * - Two <video> elements double-buffer the main track: one shows the clip under
 *   the playhead, the other is parked on the next clip's first frame.
 * - Each audio-track clip has its own <audio> element, played only while the
 *   playhead is inside the clip and parked on its in-point before that.
 */
export class PreviewEngine {
  private videos: [MediaSlot | null, MediaSlot | null] = [null, null];
  private slotIds: SlotIds = [null, null];
  private audio = new Map<string, MediaSlot>();
  private unsubscribe: (() => void) | null = null;
  private offline = false;
  private indexedAssets: MediaAsset[] | null = null;
  private assetById = new Map<string, MediaAsset>();

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
    for (const slot of [...this.videos, ...this.audio.values()]) slot?.pause();
  }

  /** Ref-callback helper: returns the cleanup that releases the element. */
  attachVideo(index: 0 | 1, el: HTMLVideoElement) {
    const slot = new MediaSlot(el, this.update);
    this.videos[index] = slot;
    this.setSlotId(index, null);
    this.update();
    return () => {
      slot.dispose();
      if (this.videos[index] !== slot) return;
      this.videos[index] = null;
      this.setSlotId(index, null);
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

  private setSlotId(index: 0 | 1, id: string | null) {
    this.slotIds = index === 0 ? [id, this.slotIds[1]] : [this.slotIds[0], id];
  }

  private update = () => {
    if (!this.unsubscribe) return;
    const { project, assets } = useEditor.getState();
    const { time, playing } = usePlayback.getState();
    const srcOf = this.srcResolver(assets);
    const trackMuted = new Map(project.tracks.map((t) => [t.id, t.muted]));
    let offline = false;

    // Main track: A/B video elements.
    const { current, next } = planMain(project, time);
    this.slotIds = assignSlots(this.slotIds, current?.clip.id ?? null, next?.id ?? null);
    this.videos.forEach((slot, i) => {
      if (!slot) return;
      const id = this.slotIds[i];
      const el = slot.el as HTMLVideoElement;
      if (current && id === current.clip.id) {
        const src = srcOf(current.clip);
        slot.setSrc(src);
        slot.setAudio(current.clip.volume, trackMuted.get(current.clip.trackId) ?? false);
        if (playing) slot.follow(current.time);
        else slot.hold(current.time);
        setStyle(el, "objectFit", current.clip.fit);
        setStyle(el, "opacity", "1");
        offline ||= src === null || slot.failed;
        return;
      }
      setStyle(el, "opacity", "0");
      slot.setAudio(1, true);
      if (next && id === next.id) {
        slot.setSrc(srcOf(next));
        slot.hold(next.in);
        setStyle(el, "objectFit", next.fit);
      } else {
        slot.pause();
      }
    });

    // Audio tracks: one element per clip.
    const planned = new Set<string>();
    for (const { clip, active, time: target } of planAudio(project, time)) {
      const slot = this.audio.get(clip.id);
      if (!slot) continue;
      planned.add(clip.id);
      const src = srcOf(clip);
      slot.setSrc(src);
      slot.setAudio(clip.volume, trackMuted.get(clip.trackId) ?? false);
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

  /** `clip -> playable URL`, or null when its asset is missing. */
  private srcResolver(assets: MediaAsset[]) {
    if (assets !== this.indexedAssets) {
      this.indexedAssets = assets;
      this.assetById = new Map(assets.map((a) => [a.id, a]));
    }
    return (clip: Clip) => {
      const asset = this.assetById.get(clip.assetId);
      return asset ? asset.src : null;
    };
  }
}

function setStyle(el: HTMLElement, prop: "opacity" | "objectFit", value: string) {
  if (el.style[prop] !== value) el.style[prop] = value;
}
