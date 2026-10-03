import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { PiPlayFill, PiPauseFill, PiCircleNotch, PiArrowClockwise } from "react-icons/pi";
import type { ProjectPreview, ProjectSummary } from "@shared/types";
import { formatDuration } from "@shared/format";
import { errorMessage } from "@shared/errors";
import { api, ApiRequestError } from "@/lib/api";
import { clientSuite } from "@/suites";
import { useProjects } from "@/stores/projects";
import { cn } from "cn";

let currentMedia: HTMLMediaElement | null = null;

/** One preview owns playback, including its intent while the renderer is still preparing it. */
const usePreviewPlayer = create<{ id: string | null; select: (id: string | null) => void }>((set) => ({
  id: null, select: (id) => { currentMedia?.pause(); set({ id }); },
}));

export function ProjectPreviewPicture({ project }: { project: ProjectSummary }) {
  const { icon: Icon, tint } = clientSuite(project.suite);
  const container = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLMediaElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [retry, setRetry] = useState(0);
  const [time, setTime] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const active = usePreviewPlayer((s) => s.id === project.id);
  const select = usePreviewPlayer.getState().select;

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
    }, { rootMargin: "100px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Fetch/render only cards near the viewport. Poll only while work is actually queued.
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPreview(null);
    setPlayError(null);
    const update = async (prepare: boolean) => {
      try {
        let next = await api.projectPreview(project.id);
        if (disposed) return;
        if (next.state === "idle" || (prepare && next.state === "error")) {
          const inputs = await clientSuite(project.suite).previewInputs?.(project.id) ?? {};
          if (disposed) return;
          next = await api.prepareProjectPreview(project.id, next.revision, inputs);
        }
        if (disposed) return;
        setPreview(next);
        if (next.state === "queued" || next.state === "rendering") timer = setTimeout(() => void update(false), 1000);
      } catch (err) {
        if (disposed) return;
        if (err instanceof ApiRequestError && err.status === 409) {
          void useProjects.getState().refresh();
          timer = setTimeout(() => void update(false), 1000);
        } else setPreview({ state: "error", revision: project.updatedAt, error: errorMessage(err) });
      }
    };
    void update(retry > 0);
    return () => { disposed = true; clearTimeout(timer); };
  }, [project.id, project.updatedAt, project.suite, visible, retry]);

  useEffect(() => {
    const element = media.current;
    if (!element) return;
    if (!active) { element.pause(); return; }
    if (preview?.state !== "ready") return;
    if (!loaded) { setLoaded(true); return; }
    if (currentMedia !== element) currentMedia?.pause();
    currentMedia = element;
    let disposed = false;
    void element.play().catch((err: unknown) => {
      if (disposed) return;
      select(null);
      setPlayError(err instanceof DOMException && err.name === "NotAllowedError" ? "Press play to start the preview." : "Playback failed. Try again.");
    });
    return () => { disposed = true; element.pause(); };
  }, [active, loaded, preview?.src, preview?.state, select]);

  useEffect(() => () => {
    if (usePreviewPlayer.getState().id === project.id) { select(null); currentMedia = null; }
  }, [project.id, select]);

  const busy = !preview || preview.state === "queued" || preview.state === "rendering";
  const failed = preview?.state === "error";
  const empty = preview?.state === "empty";
  const progress = preview?.duration ? Math.min(1, time / preview.duration) : 0;
  const poster = preview?.poster ?? project.thumbnail;
  const waveform = project.suite === "music" && !!preview?.peaks?.length;
  const toggle = () => {
    setPlayError(null);
    if (failed) { setRetry((n) => n + 1); select(project.id); return; }
    if (active) { select(null); return; }
    const element = media.current;
    select(project.id);
    setLoaded(true);
    if (element && loaded && preview?.state === "ready") {
      if (element.ended) element.currentTime = 0;
      // Call in the click handler as well, retaining the browser's user activation.
      void element.play().catch(() => setPlayError("Playback failed. Try again."));
    }
  };
  const events = {
    onLoadedMetadata: () => { if (media.current) media.current.currentTime = time; },
    onTimeUpdate: () => setTime(media.current?.currentTime ?? 0),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => select(null),
    onError: () => { select(null); setPlayError("Playback failed. Try again."); },
  };

  return (
    <div ref={container} className={cn("relative grid aspect-[16/10] place-items-center overflow-hidden", poster ? "bg-black" : tint)}>
      {poster ? (
        <>
          <img src={poster} alt="" loading="lazy" draggable={false} className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-md" />
          <img src={poster} alt="" loading="lazy" draggable={false} className="relative h-full object-contain" />
        </>
      ) : (
        <>
          <span aria-hidden className="absolute inset-0 bg-[linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.07]" />
          {waveform ? <Waveform peaks={preview!.peaks!} progress={progress} /> : (
            <span className="raised relative grid size-14 place-items-center rounded-md"><Icon className="size-8" /></span>
          )}
        </>
      )}
      {preview?.state === "ready" && project.suite === "video" && (
        <video ref={(node) => { media.current = node; }} src={loaded ? preview.src : undefined} preload="none" playsInline
          className={cn("absolute inset-0 size-full object-contain", !loaded && "invisible")} {...events} />
      )}
      {preview?.state === "ready" && project.suite === "music" && (
        <audio ref={(node) => { media.current = node; }} src={loaded ? preview.src : undefined} preload="none" {...events} />
      )}
      {!empty && (
        <button type="button" aria-label={`${failed ? "Retry" : active ? "Pause" : "Play"} preview of ${project.name}`}
          title={failed ? preview.error : "Preview the first 30 seconds"}
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn("absolute grid size-11 place-items-center rounded-full border border-white/25 bg-black/65 text-white shadow-lg backdrop-blur-sm transition hover:scale-105 hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
            !waveform && !poster && "translate-x-10 translate-y-8",
            playing && "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100")}
        >
          {failed ? <PiArrowClockwise className="size-5" /> : active && busy ? <PiCircleNotch className="size-5 animate-spin" /> : active ? <PiPauseFill className="size-5" /> : <PiPlayFill className="ml-0.5 size-5" />}
        </button>
      )}
      {preview?.state === "ready" && (
        <div className="absolute right-2 bottom-2 left-2 flex items-center gap-2 rounded bg-black/65 px-2 py-1 text-[10px] text-white backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <span className="shrink-0 tabular-nums">{active || time > 0 ? formatDuration(time) : "Preview"}</span>
          <input type="range" aria-label={`Seek preview of ${project.name}`} min={0} max={preview.duration ?? 0} step={0.1} value={time}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-white"
            onChange={(e) => {
              const next = Number(e.target.value);
              setTime(next);
              const element = media.current;
              if (element && element.readyState >= 1) element.currentTime = next;
            }} />
          <span className="tabular-nums">{formatDuration(preview.duration ?? 0)}</span>
        </div>
      )}
      {(empty || busy || failed || playError) && (
        <span className="pointer-events-none absolute right-2 bottom-2 left-2 truncate text-center text-[10px] text-current opacity-80"
          title={playError ?? preview?.error}>
          {playError ?? (empty ? `Empty ${project.suite === "music" ? "song" : "timeline"}` : failed ? "Preview unavailable · retry" : "Preparing preview…")}
        </span>
      )}
    </div>
  );
}

function Waveform({ peaks, progress }: { peaks: number[]; progress: number }) {
  return (
    <svg viewBox="0 0 720 120" role="img" aria-label="Song preview waveform" className="absolute inset-x-5 h-24 w-[calc(100%-2.5rem)]" preserveAspectRatio="none">
      {peaks.map((peak, i) => {
        const height = Math.max(1, Math.min(1, peak) * 108);
        return <rect key={i} x={i * 720 / peaks.length} y={(120 - height) / 2}
          width={Math.max(1, 720 / peaks.length - 1)} height={height} rx={0.7}
          fill="currentColor" opacity={i / peaks.length <= progress && progress > 0 ? 1 : 0.5} />;
      })}
      {progress > 0 && <line x1={progress * 720} x2={progress * 720} y1={0} y2={120} stroke="white" strokeWidth={2} />}
    </svg>
  );
}
