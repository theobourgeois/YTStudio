import { cn } from "cn";
import type { PlayMode } from "@shared/music/compile";

/** A lit mode's face: a glow from its top, as FL's, in the colour given (a CSS colour). */
const litMode = (colour: string) =>
  `linear-gradient(to bottom, color-mix(in oklab, ${colour} 30%, #fff), color-mix(in oklab, ${colour} 70%, #fff) 50%, ${colour})`;

/**
 * FL Studio's PAT / SONG switch: the two stacked, the one lit is what play plays (the pattern shown, looped,
 * in the accent; or the playlist, in FL's orange: Théo's colours). It's the left end of the transport's pill
 * (`TransportPill` in `toolbar.tsx`), whose rounded edge cuts its corners; on its own it rounds its own.
 */
export function ModeLights({ mode, onChange, className }: { mode: PlayMode; onChange: (mode: PlayMode) => void; className?: string }) {
  return (
    <div
      className={cn("flex w-11 shrink-0 flex-col overflow-hidden", className)}
      role="radiogroup"
      aria-label="Play mode (L)"
      title="What plays: the pattern, or the song (the playlist). L switches"
    >
      {(["pattern", "song"] as const).map((id) => {
        const lit = mode === id;
        const colour = id === "pattern" ? "var(--brand)" : "var(--piano-start)";
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={lit}
            aria-label={id === "pattern" ? "Pattern mode" : "Song mode"}
            className={cn(
              "min-h-0 flex-1 text-[10px] leading-none font-bold tracking-wide",
              lit ? "shadow-[inset_0_1px_0_rgb(255_255_255/0.45)]" : "text-muted-foreground/75 hover:text-foreground",
            )}
            style={lit ? { backgroundImage: litMode(colour), color: `color-mix(in oklab, ${colour} 30%, #000)` } : undefined}
            onClick={() => onChange(id)}
          >
            {id === "pattern" ? "PAT" : "SONG"}
          </button>
        );
      })}
    </div>
  );
}
