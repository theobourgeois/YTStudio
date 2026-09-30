import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { PiCloudSlash, PiFilmSlate, PiWarning } from "react-icons/pi";
import { previewSlots } from "@shared/sequences";
import { useEditor } from "@/stores/editor";
import { useFonts } from "@/stores/fonts";
import { useLayout } from "@/stores/layout";
import { fitRect } from "./canvas";
import { PreviewEngine } from "./engine";
import { TransformOverlay } from "./transform-overlay";

/** The letterboxed canvas the engine draws on, with the (hidden) media elements it draws from. */
export function Stage() {
  const aspectRatio = useEditor((s) => s.project.settings.aspectRatio);
  const isEmpty = useEditor((s) => s.project.clips.length === 0);
  // A slot per track, and per track of each sequence nested on it (see `previewSlots`), in a stable DOM
  // order (moving a media element in the DOM can pause it); the engine draws them in layer order.
  const audioTrackIds = useEditor(useShallow((s) => previewSlots(s.project).audio));
  const videoTrackIds = useEditor(useShallow((s) => previewSlots(s.project).video));

  const [status, setStatus] = useState({ offline: false, noWebGl: false });
  const [engine] = useState(() => new PreviewEngine(setStatus));
  const attachCanvas = useCallback((el: HTMLCanvasElement) => engine.attachCanvas(el), [engine]);
  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);
  const resolution = useLayout((s) => s.previewResolution);
  useEffect(() => engine.setResolution(resolution), [engine, resolution]);
  // Text clips need to know which styles the installed fonts have.
  useEffect(() => useFonts.getState().load(), []);

  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = areaRef.current!;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setArea({ width, height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const size = fitRect(area.width, area.height, aspectRatio);
  useLayoutEffect(() => engine.setCanvasSize(size), [engine, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={areaRef}
      // Handles reach past the canvas, but not over the other panels (like Premiere's Program monitor).
      className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6"
      // A press around the canvas clears the selection, like one on an empty part of it.
      // (The canvas and its handles stop the event, so this only sees presses outside them.)
      onPointerDown={(e) => {
        if (e.button === 0 && !useEditor.getState().gestureBase) useEditor.getState().select(null);
      }}
    >
      {/* The transform handles live outside the clipped canvas so they can reach past its edges (within the monitor). */}
      <div className="relative" style={size}>
      <div
        data-slot="canvas"
        className="absolute inset-0 isolate overflow-hidden rounded-lg bg-black shadow-xl ring-1 shadow-black/20 ring-black/10 dark:ring-white/10"
      >
        {videoTrackIds.map((trackId) => (
          <TrackSources key={trackId} trackId={trackId} engine={engine} />
        ))}
        <canvas ref={attachCanvas} data-slot="preview-canvas" className="absolute inset-0 size-full" />
        {audioTrackIds.map((trackId) => (
          <AudioTrackSources key={trackId} trackId={trackId} engine={engine} />
        ))}

        {isEmpty && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/60">
            <div className="flex size-11 items-center justify-center rounded-full bg-white/8">
              <PiFilmSlate className="size-5" />
            </div>
            <p className="max-w-52 text-xs leading-relaxed text-balance">
              Drag clips from the media panel onto the timeline, or press T and click here to add text
            </p>
          </div>
        )}

        {status.noWebGl && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/70">
            <PiWarning className="size-5" />
            <p className="max-w-56 text-xs leading-relaxed text-balance">
              This browser can't draw the preview: it needs WebGL 2. Try turning on hardware acceleration.
            </p>
          </div>
        )}

        {status.offline && !isEmpty && (
          <div className="absolute top-2.5 left-2.5 z-50 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm">
            <PiCloudSlash className="size-3.5" />
            Media offline
          </div>
        )}
      </div>
      <TransformOverlay canvas={size} area={areaRef} />
      </div>
    </div>
  );
}

// Hidden: the engine only reads their pictures (they stay laid out and in view so browsers keep decoding them).
const mediaClass = "pointer-events-none absolute inset-0 size-full object-contain opacity-0 select-none";

/** One video track's decoders: an A/B pair of videos and of images. */
function TrackSources({ trackId, engine }: { trackId: string; engine: PreviewEngine }) {
  const videoA = useCallback((el: HTMLVideoElement) => engine.attachVideo(trackId, 0, el), [engine, trackId]);
  const videoB = useCallback((el: HTMLVideoElement) => engine.attachVideo(trackId, 1, el), [engine, trackId]);
  const imageA = useCallback((el: HTMLImageElement) => engine.attachImage(trackId, 0, el), [engine, trackId]);
  const imageB = useCallback((el: HTMLImageElement) => engine.attachImage(trackId, 1, el), [engine, trackId]);
  return (
    <>
      <video ref={videoA} className={mediaClass} playsInline preload="auto" />
      <video ref={videoB} className={mediaClass} playsInline preload="auto" />
      <img ref={imageA} className={mediaClass} alt="" draggable={false} decoding="async" />
      <img ref={imageB} className={mediaClass} alt="" draggable={false} decoding="async" />
    </>
  );
}

/** One audio track's players: an A/B pair, like a video track's. */
function AudioTrackSources({ trackId, engine }: { trackId: string; engine: PreviewEngine }) {
  const audioA = useCallback((el: HTMLAudioElement) => engine.attachAudio(trackId, 0, el), [engine, trackId]);
  const audioB = useCallback((el: HTMLAudioElement) => engine.attachAudio(trackId, 1, el), [engine, trackId]);
  return (
    <>
      <audio ref={audioA} preload="auto" />
      <audio ref={audioB} preload="auto" />
    </>
  );
}
