import { cn } from "cn";
import type { PlayMode } from "@shared/music/compile";

/**
 * FL Studio's PAT / SONG switch: the two stacked, the one lit is what play plays (the pattern shown, looped,
 * in the accent; or the playlist, in FL's orange: Théo's colours). The toolbar's is the transport's (`ModeSwitch` in `toolbar.tsx`).
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
            mode === id && id === "pattern" && "bg-brand text-brand-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_0_6px_color-mix(in_srgb,var(--brand)_45%,transparent)]",
            mode === id && id === "song" && "bg-[var(--piano-start)] text-black/75 shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_0_6px_color-mix(in_srgb,var(--piano-start)_45%,transparent)]",
            mode !== id && "text-muted-foreground/80 shadow-[inset_0_0_0_1px_var(--line)] hover:text-foreground",
          )}
          onClick={() => onChange(id)}
        >
          {id === "pattern" ? "PAT" : "SONG"}
        </button>
      ))}
    </div>
  );
}
