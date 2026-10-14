import { PiPauseFill, PiPlayFill, PiSkipBackFill, PiSkipForwardFill, PiWarning } from "react-icons/pi";
import { positionAt } from "@shared/now-playing";
import { cn } from "cn";
import { useNow } from "@/hooks/use-now";
import { useNowPlaying } from "@/stores/now-playing";

/**
 * What the music player is playing (docs/now-playing.md), at the right of the window's top bar: the cover, the
 * song and how far it's got; play and pause, and skipping on hover. Clicking it opens the visualizer. Nothing shows
 * when nothing plays (or Settings › General says not to).
 */
export function NowPlayingPill({ className }: { className?: string }) {
  const enabled = useNowPlaying((s) => s.enabled);
  const status = useNowPlaying((s) => s.status);
  // The progress line moves on between answers.
  const now = useNow(1000);
  if (!enabled || !status) return null;

  if (status.unavailable === "not-allowed") {
    return (
      <div data-now-playing="not-allowed" data-no-drag className={cn("flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground", className)} title={status.message}>
        <PiWarning className="size-4 text-amber-500" />
        {status.player}
      </div>
    );
  }
  const track = status.track;
  if (status.unavailable || !track) return null;
  const playing = status.state === "playing";
  const progress = track.duration > 0 ? positionAt(status, now) / track.duration : 0;
  const { command, openVisualizer } = useNowPlaying.getState();

  return (
    <div
      data-now-playing={status.state}
      data-no-drag
      className={cn(
        "group relative flex h-8 max-w-80 min-w-0 shrink items-center gap-0.5 overflow-hidden rounded-md border border-line/60 bg-surface-1/70 pr-0.5 pl-1",
        className,
      )}
    >
      <button
        type="button"
        onClick={openVisualizer}
        title="Open the visualizer"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-1 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {track.artwork ? (
          <img src={track.artwork} alt="" className="size-6 shrink-0 rounded-[3px] object-cover shadow-sm" draggable={false} />
        ) : (
          <span className="size-6 shrink-0 rounded-[3px] bg-muted" />
        )}
        <span className="min-w-0 truncate text-[12px] leading-none">
          <span className="font-medium text-foreground">{track.name}</span>
          {track.artist && <span className="text-muted-foreground"> · {track.artist}</span>}
        </span>
      </button>
      <PillButton label="Previous" onClick={() => void command({ action: "previous" })} hidden>
        <PiSkipBackFill />
      </PillButton>
      <PillButton label={playing ? "Pause" : "Play"} onClick={() => void command({ action: "toggle" })}>
        {playing ? <PiPauseFill /> : <PiPlayFill />}
      </PillButton>
      <PillButton label="Next" onClick={() => void command({ action: "next" })} hidden>
        <PiSkipForwardFill />
      </PillButton>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-foreground/8">
        <div className="h-full bg-brand/80 transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </div>
    </div>
  );
}

function PillButton({ label, onClick, hidden, children }: { label: string; onClick: () => void; hidden?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-3",
        // Previous and next only while the pointer's on it, so a narrow strip keeps the song's name.
        hidden && "hidden group-hover:grid group-focus-within:grid",
      )}
    >
      {children}
    </button>
  );
}
