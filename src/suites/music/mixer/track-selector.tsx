import { useRef } from "react";
import { routeChannels, trackName, trackNumber } from "@shared/music/mixer";
import { MASTER_TRACK_ID } from "@shared/music/project";
import type { Channel } from "@shared/music/types";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { Lcd } from "../lcd";
import { songGesture, useSong } from "../store";
import { useMusicUi } from "../ui";
import { routeToFreeTrack } from "./actions";

/**
 * Which mixer track a channel plays into, FL Studio's track selector (on the rack, Alt+M, and TRACK in
 * the channel's window): an LCD dragged up and down through the tracks' numbers, "---" for the master.
 */
export function TrackSelector({ channel, className }: { channel: Channel; className?: string }) {
  const number = useSong((song) => Math.max(0, trackNumber(song, channel.mixerTrack)));
  const count = useSong((song) => song.mixer.tracks.length);
  const name = useSong((song) => trackName(song, channel.mixerTrack));
  const gesture = useRef(songGesture()).current;
  const id = channel.id;
  return (
    <Lcd
      value={number}
      min={0}
      max={count - 1}
      label={`${channel.name}'s mixer track: ${name}`}
      text={number === 0 ? "---" : String(number)}
      className={className}
      onBegin={() => gesture.begin()}
      onChange={(n) => gesture.apply((song) => routeChannels(song, [id], song.mixer.tracks[n]?.id ?? MASTER_TRACK_ID))}
      onEnd={() => gesture.end()}
      onCancel={() => gesture.cancel()}
      menu={
        <>
          <ContextMenuItem onSelect={() => routeToFreeTrack(id)}>Route to a free track</ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              const ui = useMusicUi.getState();
              ui.setTrackSelection([channel.mixerTrack]);
              ui.setMixerOpen(true);
            }}
          >
            Show in the mixer
          </ContextMenuItem>
        </>
      }
    />
  );
}
