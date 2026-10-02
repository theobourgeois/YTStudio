import { STRETCH_MODE_NAMES } from "@shared/music/stretch";
import { STRETCH_MODES, type StretchMode } from "@shared/music/types";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useMusic } from "./store";
import {
  BAR_CHOICES,
  BEAT_CHOICES,
  type StretchTarget,
  autodetectTempo,
  beatsPerBar,
  clearStretch,
  currentStretch,
  followChannel,
  hasOwnStretch,
  isPitched,
  resetTargetPitch,
  scaleTime,
  setBeats,
  setProjectTempo,
  setStretchMode,
  stretchLabel,
} from "./stretching";

/**
 * FL's MODE and TIME menu (its TIME knob's right-click), for audio clips (the clip menu's Stretch) or an
 * audio clip channel (its settings' Time stretching): the mode, and how long the file lasts.
 */
export function StretchMenuItems({ target }: { target: StretchTarget }) {
  const stretch = useMusic((s) => (s.history ? currentStretch(s.history.doc, target) : null));
  const own = useMusic((s) => (s.history ? hasOwnStretch(s.history.doc, target) : false));
  const barBeats = useMusic((s) => (s.history ? beatsPerBar(s.history.doc) : 4));
  const pitched = useMusic((s) => (s.history ? isPitched(s.history.doc, target) : false));
  return (
    <>
      <DropdownMenuLabel>Mode</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={stretch?.mode ?? ""} onValueChange={(mode) => setStretchMode(target, mode as StretchMode)}>
        {STRETCH_MODES.map((mode) => (
          <DropdownMenuRadioItem key={mode} value={mode} onSelect={(e) => e.preventDefault()}>
            {STRETCH_MODE_NAMES[mode]}
            <span className="ml-auto pl-4 text-[11px] text-muted-foreground">{mode === "stretch" ? "pitch kept" : "faster is higher"}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuItem
        disabled={!pitched}
        title={target.kind === "clips" ? "As fast as it plays now, at the pitch it was recorded at (a pitched channel goes back with all its clips)" : "As fast as it plays now, at the pitch it was recorded at"}
        onSelect={() => resetTargetPitch(target)}
      >
        Reset pitch, keep speed
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Time: {stretchLabel(stretch)}</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => clearStretch(target)}>None</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void autodetectTempo(target)}>Autodetect</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setProjectTempo(target)}>Project tempo</DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Beats / bars</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {BEAT_CHOICES.map((beats) => (
            <DropdownMenuItem key={`beat${beats}`} onSelect={() => setBeats(target, beats)}>
              {beats === 1 ? "1 beat" : `${beats} beats`}
            </DropdownMenuItem>
          ))}
          {BAR_CHOICES.map((bars) => (
            <DropdownMenuItem key={`bar${bars}`} onSelect={() => setBeats(target, bars * barBeats)}>
              {bars === 1 ? "1 bar" : `${bars} bars`}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onSelect={() => scaleTime(target, 2)}>Twice as long</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => scaleTime(target, 0.5)}>Half as long</DropdownMenuItem>
      {own && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => followChannel(target)}>Follow its channel's</DropdownMenuItem>
        </>
      )}
    </>
  );
}
