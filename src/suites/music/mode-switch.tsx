import { cn } from "cn";
import type { PlayMode } from "@shared/music/compile";

/**
 * FL Studio's PAT / SONG switch: the two stacked, the one lit (in FL's orange) is what play plays (the
 * pattern shown, looped, or the playlist). The toolbar's is the transport's (`ModeSwitch` in `toolbar.tsx`).
 */
export function ModeLights({ mode, onChange }: { mode: PlayMode; onChange: (mode: PlayMode) => void }) {
  return (
    <div className="flex flex-col gap-px" role="radiogroup" aria-label="Play mode (L)" title="What plays: the pattern, or the song (the playlist). L switches">
      {(["pattern", "song"] as const).map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={mode === id}
          aria-label={id === "pattern" ? "Pattern mode" : "Song mode"}
          className={cn(
            "h-[15px] w-11 rounded-[3px] text-[10px] leading-none font-bold tracking-wide",
            mode === id
              ? "bg-[var(--piano-start)] text-black/75 shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_0_6px_color-mix(in_srgb,var(--piano-start)_45%,transparent)]"
              : "text-muted-foreground/70 hover:text-foreground",
          )}
          onClick={() => onChange(id)}
        >
          {id === "pattern" ? "PAT" : "SONG"}
        </button>
      ))}
    </div>
  );
}
