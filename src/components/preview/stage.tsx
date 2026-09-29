import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { PiCloudSlash, PiFilmSlate } from "react-icons/pi";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { useFonts } from "@/stores/fonts";
import { fitRect, isLightColor } from "./canvas";
import { PreviewEngine } from "./engine";
import { TransformOverlay } from "./transform-overlay";

/** The letterboxed canvas with the media elements the engine drives. */
export function Stage() {
  const aspectRatio = useEditor((s) => s.project.settings.aspectRatio);
  const background = useEditor((s) => s.project.settings.background);
  const isEmpty = useEditor((s) => s.project.clips.length === 0);
  const audioClipIds = useEditor(
    useShallow((s) => {
      const audio = new Set(s.project.tracks.filter((t) => t.kind === "audio").map((t) => t.id));
      return s.project.clips.filter((c) => audio.has(c.trackId)).map((c) => c.id);
    }),
  );
  // Video track ids, bottom layer first.
  const videoTrackIds = useEditor(
    useShallow((s) => s.project.tracks.filter((t) => t.kind === "video").map((t) => t.id).reverse()),
  );
  // Stable DOM order (moving a media element in the DOM can pause it); layering is by z-index.
  const domOrder = [...videoTrackIds].sort();

  const [offline, setOffline] = useState(false);
  const [engine] = useState(() => new PreviewEngine(setOffline));
  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);
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
  const light = isLightColor(background);
  useLayoutEffect(() => engine.setCanvasSize(size), [engine, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={areaRef}
      className="flex min-h-0 flex-1 items-center justify-center p-6"
      // A press around the canvas clears the selection, like one on an empty part of it.
      // (The canvas and its handles stop the event, so this only sees presses outside them.)
      onPointerDown={(e) => {
        if (e.button === 0 && !useEditor.getState().gestureBase) useEditor.getState().select(null);
      }}
    >
      {/* The transform handles live outside the clipped canvas so they can reach past its edges. */}
      <div className="relative" style={size}>
      <div
        data-slot="canvas"
        className="absolute inset-0 isolate overflow-hidden rounded-lg shadow-xl ring-1 shadow-black/20 ring-black/10 dark:ring-white/10"
        style={{ background }}
      >
        {domOrder.map((trackId) => (
          <VideoLayer key={trackId} trackId={trackId} layer={videoTrackIds.indexOf(trackId)} engine={engine} />
        ))}
        {audioClipIds.map((id) => (
          <AudioSink key={id} clipId={id} engine={engine} />
        ))}

        {isEmpty && (
          <div
            className={cn(
              "absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 px-6 text-center",
              light ? "text-black/55" : "text-white/60",
            )}
          >
            <div
              className={cn(
                "flex size-11 items-center justify-center rounded-full",
                light ? "bg-black/5" : "bg-white/8",
              )}
            >
              <PiFilmSlate className="size-5" />
            </div>
            <p className="max-w-52 text-xs leading-relaxed text-balance">
              Drag clips from the media panel onto the timeline, or press T and click here to add text
            </p>
          </div>
        )}

        {offline && !isEmpty && (
          <div className="absolute top-2.5 left-2.5 z-50 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm">
            <PiCloudSlash className="size-3.5" />
            Media offline
          </div>
        )}
      </div>
      <TransformOverlay canvas={size} />
      </div>
    </div>
  );
}

// Size, transform and opacity are set imperatively by the engine.
const mediaClass = "absolute top-0 left-0 max-w-none origin-top-left object-fill opacity-0 select-none";

function VideoLayer({ trackId, layer, engine }: { trackId: string; layer: number; engine: PreviewEngine }) {
  const videoA = useCallback((el: HTMLVideoElement) => engine.attachVideo(trackId, 0, el), [engine, trackId]);
  const videoB = useCallback((el: HTMLVideoElement) => engine.attachVideo(trackId, 1, el), [engine, trackId]);
  const imageA = useCallback((el: HTMLImageElement) => engine.attachImage(trackId, 0, el), [engine, trackId]);
  const imageB = useCallback((el: HTMLImageElement) => engine.attachImage(trackId, 1, el), [engine, trackId]);
  const text = useCallback((el: HTMLCanvasElement) => engine.attachText(trackId, el), [engine, trackId]);
  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: layer }}>
      <video ref={videoA} className={mediaClass} playsInline preload="auto" />
      <video ref={videoB} className={mediaClass} playsInline preload="auto" />
      <img ref={imageA} className={mediaClass} alt="" draggable={false} decoding="async" />
      <img ref={imageB} className={mediaClass} alt="" draggable={false} decoding="async" />
      <canvas ref={text} className={mediaClass} />
    </div>
  );
}

function AudioSink({ clipId, engine }: { clipId: string; engine: PreviewEngine }) {
  const ref = useCallback((el: HTMLAudioElement) => engine.attachAudio(clipId, el), [engine, clipId]);
  return <audio ref={ref} preload="auto" />;
}
