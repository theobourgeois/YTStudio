import { cn } from "cn";
import type { PlayMode } from "@shared/music/compile";

/**
 * FL Studio's PAT / SONG switch: two lights, the lit one is what play plays (the pattern shown, looped, or
 * the playlist). The toolbar's is the transport's (`ModeSwitch` in `toolbar.tsx`).
 */
export function ModeLights({ mode, onChange }: { mode: PlayMode; onChange: (mode: PlayMode) => void }) {
  return (
    <div className="sunken flex h-10 flex-col justify-center gap-0.5 rounded-sm px-1.5" role="radiogroup" aria-label="Play mode (L)" title="What plays: the pattern, or the song (the playlist). L switches">
      {(["pattern", "song"] as const).map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={mode === id}
          aria-label={id === "pattern" ? "Pattern mode" : "Song mode"}
          className="flex items-center gap-1.5 text-[10px] leading-none font-semibold tracking-wide"
          onClick={() => onChange(id)}
        >
          <span className={cn("size-2 rounded-full", mode === id ? "border border-brand-edge bg-brand shadow-[0_0_5px] shadow-brand/70" : "sunken")} />
          <span className={mode === id ? "text-foreground" : "text-muted-foreground"}>{id === "pattern" ? "PAT" : "SONG"}</span>
        </button>
      ))}
    </div>
  );
}
