import type { NowPlayingStatus } from "@shared/now-playing";
import type { GallerySection } from "@/gallery/types";
import { NowPlayingPillView } from "./now-playing-pill";

const NOW = Date.now();
const COVER = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#5b21b6"/><stop offset="1" stop-color="#ff3d9a"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/></svg>')}`;

const playing: NowPlayingStatus = {
  player: "Spotify",
  unavailable: null,
  state: "playing",
  track: { id: "spotify:track:1", name: "Midnight Drive", artist: "Neon Avenue", album: "Night Shift", duration: 214, artwork: COVER, url: null },
  position: 80,
  at: NOW,
  volume: 70,
  shuffling: false,
  repeating: false,
};

/** The pill's states: playing, paused, a long name, no cover, macOS not letting the app ask Spotify, and nothing playing. */
const STATES: { label: string; status: NowPlayingStatus }[] = [
  { label: "Playing", status: playing },
  { label: "Paused", status: { ...playing, state: "paused", position: 150 } },
  {
    label: "A long name",
    status: { ...playing, track: { ...playing.track!, name: "A Song Whose Name Goes On and On (Extended Club Mix)", artist: "Somebody feat. Somebody Else" } },
  },
  { label: "No cover", status: { ...playing, track: { ...playing.track!, artwork: null } } },
  { label: "Not allowed", status: { ...playing, unavailable: "not-allowed", message: "Allow YTStudio to control Spotify in System Settings › Privacy & Security › Automation.", track: null } },
  { label: "Nothing playing", status: { ...playing, unavailable: "not-running", state: "stopped", track: null } },
];

export const NOW_PLAYING_SECTIONS: GallerySection[] = [
  {
    id: "now-playing",
    title: "Now Playing",
    source: "components/now-playing/now-playing-pill.tsx",
    render: () => (
      <div className="flex flex-col gap-2 bg-surface-0 p-4">
        {STATES.map(({ label, status }) => (
          <div key={label} className="flex items-center gap-4">
            <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
            <div className="flex w-80 justify-end">
              <NowPlayingPillView status={status} now={NOW} onCommand={() => {}} onOpen={() => {}} />
            </div>
          </div>
        ))}
      </div>
    ),
  },
];
