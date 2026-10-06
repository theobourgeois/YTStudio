import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { PiSpeakerHigh, PiSpeakerSlash } from "react-icons/pi";
import type { ProjectPreview, ProjectSummary } from "@shared/types";
import { errorMessage } from "@shared/errors";
import { clamp } from "@shared/math";
import { api, ApiRequestError } from "@/lib/api";
import { startPointerDrag } from "@/lib/pointer-drag";
import { clientSuite } from "@/suites";
import { useProjects } from "@/stores/projects";
import { cn } from "cn";

let currentMedia: HTMLMediaElement | null = null;

/** How long the pointer rests on a card before its preview starts. */
const HOVER_MS = 250;

/** One preview owns playback, including its intent while the renderer is still preparing it. */
const usePreviewPlayer = create<{ id: string | null; select: (id: string | null) => void }>((set) => ({
  id: null, select: (id) => { currentMedia?.pause(); set({ id }); },
}));

/**
 * A Home card's picture. A suite with a `preview` plays it while the pointer rests on the card, muted
 * (as a video site's thumbnails do): a button unmutes it, and the line along its bottom is where it's
 * got to, scrubbed by pressing it (which unmutes it too).
 */
export function ProjectPreviewPicture({ project }: { project: ProjectSummary }) {
  const { icon: Icon, tint, preview: plays } = clientSuite(project.suite);
  const container = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLMediaElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [muted, setMuted] = useState(true);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [retry, setRetry] = useState(0);
  const [time, setTime] = useState(0);
  const [loaded, setLoaded] = useState(false);
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
    void element.play().catch(() => {
      if (disposed) return;
      select(null);
      setPlayError("Playback failed. Try again.");
    });
    return () => { disposed = true; element.pause(); };
  }, [active, loaded, preview?.src, preview?.state, select]);

  // Where it's got to, every frame while it plays: `timeupdate` comes only a few times a second.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const element = media.current;
      if (element && !element.paused) setTime(element.currentTime);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => () => {
    clearTimeout(hoverTimer.current);
    if (usePreviewPlayer.getState().id === project.id) { select(null); currentMedia = null; }
  }, [project.id, select]);

  const busy = !preview || preview.state === "queued" || preview.state === "rendering";
  const failed = preview?.state === "error";
  const empty = preview?.state === "empty";
  const ready = !!plays && preview?.state === "ready";
  const progress = preview?.duration ? Math.min(1, time / preview.duration) : 0;
  const poster = preview?.poster ?? project.thumbnail;
  const waveform = plays === "sound" && !!preview?.peaks?.length;

  /** Hear it (or not): set on the element at once, inside the press, so the browser lets it sound. */
  const setSound = (on: boolean) => {
    if (media.current) media.current.muted = !on;
    setMuted(!on);
  };
  const seek = (fraction: number) => {
    const element = media.current;
    const at = fraction * (preview?.duration ?? 0);
    setTime(at);
    if (element && element.readyState >= 1) element.currentTime = at;
  };
  const events = {
    onLoadedMetadata: () => { if (media.current) media.current.currentTime = time; },
    onError: () => { select(null); setPlayError("Playback failed. Try again."); },
  };

  return (
    <div ref={container} className="relative"
      onPointerEnter={(e) => {
        if (!plays || e.pointerType !== "mouse" || empty || active) return;
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => {
          setPlayError(null);
          // A preview that failed is made again.
          if (failed) setRetry((n) => n + 1);
          select(project.id);
        }, HOVER_MS);
      }}
      onPointerLeave={(e) => {
        clearTimeout(hoverTimer.current);
        if (!plays || e.pointerType !== "mouse") return;
        if (usePreviewPlayer.getState().id === project.id) select(null);
        setSound(false);
        setTime(0);
        if (media.current && media.current.readyState >= 1) media.current.currentTime = 0;
      }}>
      <div className={cn("relative grid aspect-[16/10] place-items-center overflow-hidden", poster ? "bg-black" : tint)}>
        {poster ? (
          <>
            <img src={poster} alt="" loading="lazy" draggable={false} className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-md" />
            <img src={poster} alt="" loading="lazy" draggable={false} className="relative h-full object-contain" />
          </>
        ) : (
          <>
            <span aria-hidden className="absolute inset-0 bg-[linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.07]" />
            {waveform ? <Waveform peaks={preview!.peaks!} progress={active ? progress : 0} /> : (
              <span className="raised relative grid size-14 place-items-center rounded-md"><Icon className="size-8" /></span>
            )}
          </>
        )}
        {ready && plays === "video" && (
          <video ref={(node) => { media.current = node; }} src={loaded ? preview.src : undefined} preload="none" playsInline muted={muted} loop
            className={cn("absolute inset-0 size-full object-contain", !active && "invisible")} {...events} />
        )}
        {ready && plays === "sound" && (
          <audio ref={(node) => { media.current = node; }} src={loaded ? preview.src : undefined} preload="none" muted={muted} loop {...events} />
        )}
        {active && ready && (
          <button type="button" aria-label={`${muted ? "Unmute" : "Mute"} preview of ${project.name}`}
            title={muted ? "Unmute" : "Mute"}
            className="absolute right-2 bottom-3 grid size-7 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
            onClick={(e) => { e.stopPropagation(); setSound(muted); }} onKeyDown={(e) => e.stopPropagation()}>
            {muted ? <PiSpeakerSlash className="size-3.5" /> : <PiSpeakerHigh className="size-3.5" />}
          </button>
        )}
        {/* A still (a photo's cover) has nothing to play: its picture is all there is, not an empty project. */}
        {((empty && !poster) || (plays && active && (busy || failed)) || playError) && (
          <span className="pointer-events-none absolute right-2 bottom-2 left-2 truncate text-center text-[10px] text-current opacity-80"
            title={playError ?? preview?.error}>
            {playError ?? (empty ? `Empty ${plays === "sound" ? "song" : "timeline"}` : failed ? "Preview unavailable" : "Preparing preview…")}
          </span>
        )}
      </div>
      {active && ready && (
        <Scrubber label={`Seek preview of ${project.name}`} progress={progress} onSeek={(fraction) => { seek(fraction); setSound(true); }} />
      )}
    </div>
  );
}

/**
 * The line along the bottom of a playing card: how far it's got. On hover it thickens and shows its knob;
 * pressed and dragged, it scrubs. Outside the picture's clipping, so the knob can sit over the card's edge.
 */
function Scrubber({ label, progress, onSeek }: { label: string; progress: number; onSeek: (fraction: number) => void }) {
  const [held, setHeld] = useState(false);
  const fractionAt = (element: Element, x: number) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 ? clamp((x - box.left) / box.width, 0, 1) : 0;
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const element = e.currentTarget;
    onSeek(fractionAt(element, e.clientX));
    const done = () => setHeld(false);
    if (startPointerDrag(e, { threshold: 0, onMove: (ev) => onSeek(fractionAt(element, ev.clientX)), onEnd: done, onCancel: done, onClick: done })) setHeld(true);
  };
  return (
    <div role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
      data-held={held || undefined}
      className="group/seek absolute inset-x-0 bottom-0 z-10 h-3 cursor-pointer"
      onPointerDown={onPointerDown}
      // The card opens on a click: one here only scrubs.
      onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/25 transition-[height] duration-100 group-hover/seek:h-1 group-data-[held]/seek:h-1">
        <div className="h-full bg-brand" style={{ width: `${progress * 100}%` }} />
      </div>
      <span aria-hidden className="absolute bottom-0.5 size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-white opacity-0 shadow-sm transition-opacity duration-100 group-hover/seek:opacity-100 group-data-[held]/seek:opacity-100"
        style={{ left: `${progress * 100}%` }} />
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
