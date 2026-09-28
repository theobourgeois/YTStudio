import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Clapperboard, CloudOff } from "lucide-react";
import { MAIN_TRACK_ID } from "@shared/timeline";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { fitRect, isLightColor } from "./canvas";
import { PreviewEngine } from "./engine";

/** The letterboxed canvas with the media elements the engine drives. */
export function Stage() {
  const aspectRatio = useEditor((s) => s.project.settings.aspectRatio);
  const background = useEditor((s) => s.project.settings.background);
  const isEmpty = useEditor((s) => s.project.clips.length === 0);
  const audioClipIds = useEditor(
    useShallow((s) => s.project.clips.filter((c) => c.trackId !== MAIN_TRACK_ID).map((c) => c.id)),
  );

  const [offline, setOffline] = useState(false);
  const [engine] = useState(() => new PreviewEngine(setOffline));
  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);

  const videoA = useCallback((el: HTMLVideoElement) => engine.attachVideo(0, el), [engine]);
  const videoB = useCallback((el: HTMLVideoElement) => engine.attachVideo(1, el), [engine]);

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

  return (
    <div ref={areaRef} className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div
        className="relative overflow-hidden rounded-lg shadow-xl ring-1 shadow-black/20 ring-black/10 dark:ring-white/10"
        style={{ ...size, background }}
      >
        <video ref={videoA} className={videoClass} playsInline preload="auto" />
        <video ref={videoB} className={videoClass} playsInline preload="auto" />
        {audioClipIds.map((id) => (
          <AudioSink key={id} clipId={id} engine={engine} />
        ))}

        {isEmpty && (
          <div
            className={cn(
              "absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center",
              light ? "text-black/55" : "text-white/60",
            )}
          >
            <div
              className={cn(
                "flex size-11 items-center justify-center rounded-full",
                light ? "bg-black/5" : "bg-white/8",
              )}
            >
              <Clapperboard className="size-5" />
            </div>
            <p className="max-w-52 text-xs leading-relaxed text-balance">
              Drag clips from the media panel onto the timeline
            </p>
          </div>
        )}

        {offline && !isEmpty && (
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm">
            <CloudOff className="size-3.5" />
            Media offline
          </div>
        )}
      </div>
    </div>
  );
}

// Opacity and object-fit are set imperatively by the engine.
const videoClass = "absolute inset-0 size-full opacity-0";

function AudioSink({ clipId, engine }: { clipId: string; engine: PreviewEngine }) {
  const ref = useCallback((el: HTMLAudioElement) => engine.attachAudio(clipId, el), [engine, clipId]);
  return <audio ref={ref} preload="auto" />;
}
