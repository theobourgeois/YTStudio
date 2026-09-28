import { memo, type ReactNode } from "react";
import { PiFilmStrip, PiMusicNotes, PiSpeakerHigh, PiSpeakerSlash, PiX } from "react-icons/pi";
import type { Track } from "@shared/types";
import { MAIN_TRACK_ID, removeTrack, setTrackMuted } from "@shared/timeline";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { HEADER_WIDTH } from "./constants";
import type { LaneLayout } from "./geometry";

/** Sticky left column; rows share the lanes' heights so they always line up. */
export function TrackHeaders({ tracks, lanes }: { tracks: Track[]; lanes: LaneLayout[] }) {
  return (
    <div
      className="sticky left-0 z-30 flex shrink-0 flex-col border-r bg-timeline"
      style={{ width: HEADER_WIDTH }}
    >
      {tracks.map((track, i) => (
        <TrackHeader key={track.id} track={track} height={lanes[i]?.height ?? 0} />
      ))}
    </div>
  );
}

const TrackHeader = memo(function TrackHeader({ track, height }: { track: Track; height: number }) {
  const isMain = track.id === MAIN_TRACK_ID;
  const Icon = track.kind === "video" ? PiFilmStrip : PiMusicNotes;
  const toggleMute = () =>
    useEditor.getState().commit((p) => setTrackMuted(p, track.id, !track.muted));
  const remove = () => useEditor.getState().commit((p) => removeTrack(p, track.id));

  return (
    <div className="group/track flex shrink-0 items-center gap-2 border-b pr-1.5 pl-3" style={{ height }}>
      <div
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-md",
          track.kind === "video" ? "bg-clip-video/15 text-clip-video" : "bg-clip-audio/15 text-clip-audio",
        )}
      >
        <Icon className="size-3.5" />
      </div>
      <span className={cn("min-w-0 flex-1 truncate text-xs font-medium", track.muted && "text-muted-foreground")}>
        {track.name}
      </span>
      <div className="flex shrink-0 items-center">
        {!isMain && (
          <HeaderButton
            label="Remove track"
            onClick={remove}
            className="opacity-0 group-hover/track:opacity-100 focus-visible:opacity-100"
          >
            <PiX />
          </HeaderButton>
        )}
        <HeaderButton
          label={track.muted ? "Unmute track" : "Mute track"}
          onClick={toggleMute}
          pressed={track.muted}
          className={cn(track.muted && "text-destructive hover:text-destructive")}
        >
          {track.muted ? <PiSpeakerSlash /> : <PiSpeakerHigh />}
        </HeaderButton>
      </div>
    </div>
  );
});

function HeaderButton({
  label,
  onClick,
  pressed,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn("text-muted-foreground", className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
