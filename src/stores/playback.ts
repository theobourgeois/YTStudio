import { create } from "zustand";

/**
 * The playback clock. While playing, a requestAnimationFrame loop advances
 * `time` from the wall clock; media elements (see the preview) follow it.
 * `duration` is kept in sync with the project by the editor store.
 */
interface PlaybackState {
  time: number;
  playing: boolean;
  duration: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  setDuration: (duration: number) => void;
}

let raf = 0;
let anchorWall = 0;
let anchorTime = 0;

export const usePlayback = create<PlaybackState>((set, get) => {
  const tick = () => {
    const { playing, duration } = get();
    if (!playing) return;
    const t = anchorTime + (performance.now() - anchorWall) / 1000;
    if (t >= duration) {
      set({ time: duration, playing: false });
      return;
    }
    set({ time: t });
    raf = requestAnimationFrame(tick);
  };

  return {
    time: 0,
    playing: false,
    duration: 0,
    play() {
      const { duration, playing } = get();
      if (playing || duration <= 0) return;
      // Restart from the top when play is pressed at the end.
      const start = get().time >= duration - 1e-3 ? 0 : get().time;
      anchorTime = start;
      anchorWall = performance.now();
      set({ playing: true, time: start });
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    },
    pause() {
      cancelAnimationFrame(raf);
      set({ playing: false });
    },
    toggle() {
      if (get().playing) get().pause();
      else get().play();
    },
    seek(time) {
      const t = Math.min(Math.max(0, time), get().duration);
      anchorTime = t;
      anchorWall = performance.now();
      set({ time: t });
    },
    setDuration(duration) {
      set({ duration });
      if (get().time > duration) get().seek(duration);
    },
  };
});

// requestAnimationFrame stops in background tabs, which would freeze the clock
// while the media elements kept playing past their cut points. Pause instead.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) usePlayback.getState().pause();
});
